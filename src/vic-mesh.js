import { Quaternion, Vector3 } from 'three';
import { tearTipCenter, writeBeadStrip, writeRingCap, writeTearCap } from './bead-mesh.js';
import { depositedIndexCount } from './toolpath.js';

export function bakeVicCollapse({ positions, indices, analysis, replay }, stripRanges) {
  const { frames, failed, stripLength, trajectory, sections, centers, tangents, diameter, nodeIds } = analysis;
  if (!trajectory || !failed) return undefined;

  const frame = frames - 1;
  const nodeCount = centers.length / 3;
  const frameStart = frame * nodeCount * 4;
  const cutoff = replay ? depositedIndexCount(replay, analysis.times[analysis.buildFrames] - replay.start) : indices.length;
  const sides = stripLength / 6;
  const starts = new Int32Array(nodeCount).fill(-1);
  const incoming = new Uint8Array(nodeCount);
  const outgoing = new Uint8Array(nodeCount);
  const tornEnds = new Uint8Array(nodeCount);
  const span = new Float32Array(nodeCount);
  const strips = [];
  const torn = new Set();
  let tipCount = 0;
  for (let i = 0; i < analysis.cuts.length; i += 2) {
    if (analysis.cuts[i + 1] <= frame) torn.add(analysis.cuts[i]);
  }

  // Follow the same deposition cutoff and break points as the visible replay.
  for (let range = 0; range < stripRanges.length; range += 2) {
    const end = Math.min(stripRanges[range + 1], cutoff);
    for (let strip = stripRanges[range]; strip + stripLength <= end; strip += stripLength) {
      const before = indices[strip];
      const after = indices[strip + 2];
      const a = nodeIds[before];
      const b = nodeIds[after];
      if (!trajectory[frameStart + a * 4 + 3] || !trajectory[frameStart + b * 4 + 3]) continue;
      starts[a] = before;
      starts[b] = after;
      const length = Math.hypot(centers[a * 3] - centers[b * 3], centers[a * 3 + 1] - centers[b * 3 + 1],
        centers[a * 3 + 2] - centers[b * 3 + 2]);
      span[a] += length / 2;
      span[b] += length / 2;
      if (torn.has(strip)) {
        tornEnds[a] |= 2;
        tornEnds[b] |= 1;
        tipCount += 2;
        continue;
      }
      outgoing[a] = 1;
      incoming[b] = 1;
      strips.push(a, b);
    }
  }

  let rings = 0;
  let caps = 0;
  let isolated = 0;
  for (let node = 0; node < nodeCount; node++) {
    if (starts[node] < 0) continue;
    rings++;
    caps += 2 - incoming[node] - outgoing[node];
    if (!incoming[node] && !outgoing[node]) isolated++;
  }
  if (!rings) return undefined;

  const bakedPositions = new Float32Array(((rings + isolated) * sides + tipCount) * 3);
  const bakedIndices = new Uint32Array((strips.length / 2 + isolated) * stripLength + caps * (sides - 2) * 3 + tipCount * 6);
  const ends = new Uint32Array(nodeCount);
  const rotation = new Quaternion();
  const rest = new Vector3();
  const tangent = new Vector3();
  const point = new Vector3();
  let vertex = 0;
  let face = 0;
  for (let node = 0; node < nodeCount; node++) {
    const source = starts[node];
    if (source < 0) continue;
    const section = frameStart + node * 4;
    const area = Math.sqrt(Math.max(0.01, sections[section] / 127));
    const flatten = Math.max(0.1, sections[section + 1] / 255);
    const widthScale = area / flatten;
    const heightScale = area * flatten;
    const center = node * 3;
    const cx = centers[center];
    const cy = centers[center + 1];
    const cz = centers[center + 2];
    rest.fromArray(tangents, center);
    const bend = readTangent(tangent, sections[section + 2], sections[section + 3], rest);
    const pivot = bend ? diameter * 0.33 * heightScale : 0;
    if (bend) {
      if (rest.dot(tangent) < -0.999) {
        if (Math.abs(rest.y) < 0.9) point.set(0, 1, 0);
        else point.set(1, 0, 0);
        point.crossVectors(rest, point).normalize();
        rotation.set(point.x, point.y, point.z, 0);
      } else rotation.setFromUnitVectors(rest, tangent);
    }
    function writePoint(x, y, z, vertexIndex) {
      point.set((x - cx) * widthScale, (y - cy) * heightScale - pivot, (z - cz) * widthScale);
      if (bend) point.applyQuaternion(rotation);
      const target = vertexIndex * 3;
      bakedPositions[target] = cx + point.x + trajectory[section];
      bakedPositions[target + 1] = Math.max(0, cy + point.y + pivot + trajectory[section + 1]);
      bakedPositions[target + 2] = cz + point.z + trajectory[section + 2];
    }
    for (let j = 0; j < sides; j++) {
      const index = (source + j) * 3;
      writePoint(positions[index], positions[index + 1], positions[index + 2], vertex + j);
    }

    // A section cut at both ends still represents a finite length of deposited clay.
    let endRing = vertex;
    if (!incoming[node] && !outgoing[node]) {
      endRing += sides;
      const half = Math.max(diameter * 0.03, Math.min(diameter * 0.35, span[node] / 2));
      point.copy(tangent).multiplyScalar(half);
      let bottom = Infinity;
      for (let j = 0; j < sides; j++) bottom = Math.min(bottom, bakedPositions[(vertex + j) * 3 + 1]);
      const lift = Math.max(0, Math.abs(point.y) - bottom);
      for (let j = 0; j < sides; j++) {
        const a = (vertex + j) * 3;
        const b = (endRing + j) * 3;
        bakedPositions[a + 1] += lift;
        bakedPositions[b] = bakedPositions[a] + point.x;
        bakedPositions[b + 1] = bakedPositions[a + 1] + point.y;
        bakedPositions[b + 2] = bakedPositions[a + 2] + point.z;
        bakedPositions[a] -= point.x;
        bakedPositions[a + 1] -= point.y;
        bakedPositions[a + 2] -= point.z;
      }
      face = writeBeadStrip(bakedIndices, face, vertex, endRing, sides);
    }
    ends[node] = vertex;
    const startRing = vertex;
    vertex = endRing + sides;
    for (const reverse of [true, false]) {
      if (reverse ? incoming[node] : outgoing[node]) continue;
      const ring = reverse ? startRing : endRing;
      if (tornEnds[node] & (reverse ? 1 : 2)) {
        const [x, y, z] = tearTipCenter(positions, source, sides, tangents, node, diameter, reverse);
        writePoint(x, y, z, vertex);
        face = writeTearCap(bakedIndices, face, ring, sides, vertex++, reverse);
      } else face = writeRingCap(bakedIndices, face, ring, sides, reverse);
    }
  }
  for (let i = 0; i < strips.length; i += 2) {
    face = writeBeadStrip(bakedIndices, face, ends[strips[i]], ends[strips[i + 1]], sides);
  }

  const bounds = [Infinity, Infinity, Infinity];
  const top = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < bakedPositions.length; i += 3) {
    for (let axis = 0; axis < 3; axis++) {
      bounds[axis] = Math.min(bounds[axis], bakedPositions[i + axis]);
      top[axis] = Math.max(top[axis], bakedPositions[i + axis]);
    }
  }
  const size = [0, 2, 1].map(axis => top[axis] - bounds[axis]);
  return { positions: bakedPositions, indices: bakedIndices, size };
}

// This decodes the direction stored in the last VIC replay frame, as in the shader.
function readTangent(tangent, packedX, packedY, rest) {
  if (!packedX && !packedY) {
    tangent.copy(rest);
    return false;
  }
  const x = (packedX - 128) / 127;
  const y = (packedY - 128) / 127;
  const z = 1 - Math.abs(x) - Math.abs(y);
  const fold = Math.max(0, -z);
  tangent.set(x - (x < 0 ? -fold : fold), y - (y < 0 ? -fold : fold), z).normalize();
  return true;
}
