import { solveBeadFlow } from './bead-flow.js';
import { defaultNozzle } from './settings.js';
import { simulateVic } from './vic.js';

const maximumRings = 150_000;
const maximumRingVertices = 1_800_000;
const tau = Math.PI * 2;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function distance(a, b) {
  return Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
}

function samplePath(path, origin, maxStep, minStep) {
  const first = path[0].map((value, axis) => value - origin[axis]);
  const samples = [first];
  let previous = first;
  for (let i = 1; i < path.length; i++) {
    const point = path[i].map((value, axis) => value - origin[axis]);
    const length = distance(previous, point);
    if (length < minStep && i < path.length - 1) continue;
    if (length < 0.00001) continue;
    const steps = Math.ceil(length / maxStep);
    for (let step = 1; step <= steps; step++) {
      samples.push(point.map((value, axis) => previous[axis] + (value - previous[axis]) * step / steps));
    }
    previous = point;
  }
  return samples;
}

function turnsAt(previous, point, next, incomingLength) {
  const outgoingLength = distance(point, next);
  let dot = 0;
  for (let axis = 0; axis < 3; axis++) dot += (point[axis] - previous[axis]) * (next[axis] - point[axis]);
  return dot < 0.992 * incomingLength * outgoingLength;
}

function sampleDeposition(path, amounts, origin, spacing, typicalRate, times) {
  const points = [path[0].map((value, axis) => value - origin[axis])];
  const edgeAreas = [];
  const sampledTimes = times ? [times[0]] : undefined;
  let covered = 0;
  let volume = 0;
  for (let i = 1; i < path.length; i++) {
    const previous = path[i - 1];
    const point = path[i];
    const length = distance(previous, point);
    if (length < 1e-8) continue;
    const amount = amounts?.[i - 1];
    const area = amount > 0 && typicalRate > 0 ? clamp(amount / (length * typicalRate), 0.4, 1.9) : 1;
    let traveled = 0;

    // Keep the cell spacing through G-code command boundaries, including collinear split moves.
    while (length - traveled + covered >= spacing) {
      const step = spacing - covered;
      traveled += step;
      volume += step * area;
      points.push(previous.map((value, axis) => value - origin[axis] + (point[axis] - value) * traveled / length));
      if (times) sampledTimes.push(times[i - 1] + (times[i] - times[i - 1]) * traveled / length);
      edgeAreas.push(volume / spacing);
      covered = 0;
      volume = 0;
    }
    covered += Math.max(0, length - traveled);
    volume += Math.max(0, length - traveled) * area;
    const end = i === path.length - 1;
    if (covered > 1e-7 && (end || (covered > spacing * 0.18 && turnsAt(previous, point, path[i + 1], length)))) {
      points.push(point.map((value, axis) => value - origin[axis]));
      if (times) sampledTimes.push(times[i]);
      edgeAreas.push(volume / covered);
      covered = 0;
      volume = 0;
    }
  }
  return { points, edgeAreas, times: sampledTimes };
}

function sampleRuns(model, origin, diameter, spacing, minStep, accurate, typicalRate, vic) {
  const paths = [];
  let rings = 0;
  let segments = 0;
  let caps = 0;
  for (const [index, path] of model.paths.entries()) {
    const run = accurate ? sampleDeposition(path, model.extrusion?.[index], origin, spacing, typicalRate, vic ? model.times?.[index] : undefined)
      : { points: samplePath(path, origin, spacing, minStep) };
    const samples = run.points;
    if (samples.length < 2) continue;
    const start = samples[0];
    const end = samples.at(-1);
    const closed = path.length >= 4 && samples.length >= 4
      && Math.abs(start[2] - end[2]) <= 0.05
      && distance(start, end) <= Math.min(diameter * 0.12, 0.6);
    // A near-closed perimeter gets one shared ring in place of two overlapping caps.
    if (closed) {
      samples.pop();
      run.times?.pop();
    }
    else caps += 2;
    paths.push({ ...run, closed });
    rings += samples.length;
    segments += closed ? samples.length : samples.length - 1;
    if (rings > (vic ? 18_000 : maximumRings)) return undefined;
  }
  return { paths, rings, segments, caps };
}

function smoothSupport(gaps, path, radius, closed) {
  const last = path.length - 1;
  const steps = last + (closed ? path.length : 0);
  for (const direction of [1, -1]) {
    for (let offset = 1; offset <= steps; offset++) {
      const index = offset % path.length;
      const i = direction === 1 ? index : last - index;
      const previous = (i - direction + path.length) % path.length;
      const blend = 1 - Math.exp(-distance(path[i], path[previous]) / radius);
      gaps[i] = gaps[previous] + blend * (gaps[i] - gaps[previous]);
    }
  }
}

function distanceToSupport(gaps, path, closed) {
  const distances = new Float32Array(path.length).fill(Infinity);
  const last = path.length - 1;
  const steps = last + (closed ? path.length : 0);
  for (const direction of [1, -1]) {
    let unsupportedLength = Infinity;
    for (let offset = 0; offset <= steps; offset++) {
      const index = offset % path.length;
      const i = direction === 1 ? index : last - index;
      if (gaps[i] <= 0.45) unsupportedLength = 0;
      else if (offset > 0) unsupportedLength += distance(path[i], path[(i - direction + path.length) % path.length]);
      distances[i] = Math.min(distances[i], unsupportedLength);
    }
  }
  return distances;
}

function applyGravity(paths, diameter, height, softness, accurate) {
  const cells = new Map();
  const cellWidth = diameter * 1.3;
  const cellHeight = diameter * 1.12;
  const clearance = diameter * (accurate ? 0.045 : 0.19);
  const sampleSpacing = diameter * (accurate ? 0.12 : 0.4);
  const key = (x, y, z) => `${x}:${y}:${z}`;
  for (const { points: path, edgeAreas, closed } of paths) {
    const support = [];
    const deposited = [];
    let travel = 0;
    for (const [i, point] of path.entries()) {
      const [x, y, z] = point;
      if (accurate && i > 0) travel += distance(path[i - 1], point);
      const fraction = clamp(z / Math.max(height, diameter), 0, 1);
      const elevation = z * (1 - softness * (0.15 - 0.07 * fraction));
      const cellX = Math.floor(x / cellWidth);
      const cellY = Math.floor(y / cellWidth);
      const cellZ = Math.floor(z / cellHeight);
      let nearestSquared = 1;
      if (z > diameter * (accurate ? 0.84 : 1.12)) {
        for (let dx = -1; dx <= 1; dx++) {
          for (let dy = -1; dy <= 1; dy++) {
            for (let dz = -1; dz <= 0; dz++) {
              const bucket = cells.get(key(cellX + dx, cellY + dy, cellZ + dz));
              if (!bucket) continue;
              for (const neighbor of bucket.values()) {
                const rise = z - neighbor.z;
                if (rise <= clearance || rise > cellHeight) continue;
                if (accurate && neighbor.path === path && travel - neighbor.travel < diameter * 1.6) continue;
                const lateral = ((x - neighbor.x) ** 2 + (y - neighbor.y) ** 2) / cellWidth ** 2;
                const separation = accurate ? Math.max(0, elevation - neighbor.elevation - diameter * 0.84 * neighbor.sectionScale) / diameter : 0;
                nearestSquared = Math.min(nearestSquared, lateral + separation ** 2);
              }
            }
          }
        }
      } else {
        nearestSquared = 0;
      }
      support.push(Math.sqrt(nearestSquared));
      const bucketKey = key(cellX, cellY, cellZ);
      const bucket = cells.get(bucketKey) ?? new Map();
      if (!bucket.size) cells.set(bucketKey, bucket);
      const sampleKey = key(Math.floor(x / sampleSpacing), Math.floor(y / sampleSpacing), Math.floor(z / sampleSpacing));
      const sample = { x, y, z, elevation, path, travel, sectionScale: Math.sqrt(edgeAreas?.[i] ?? edgeAreas?.[i - 1] ?? 1) };
      bucket.set(sampleKey, sample);
      if (accurate) deposited.push(sample);
    }

    const unsupportedLength = distanceToSupport(support, path, closed);
    smoothSupport(support, path, diameter * (accurate ? 0.44 : 0.8), closed);
    const flow = accurate ? solveBeadFlow(path, {
      diameter, buildHeight: height, softness, gaps: support, unsupportedLength, closed, edgeAreas,
    }) : undefined;
    path.forEach((point, i) => {
      const [x, y, z] = point;
      const fraction = clamp(z / Math.max(height, diameter), 0, 1);
      let elevation = flow?.elevation[i];
      if (!flow) {
        const compression = z * softness * (0.15 - 0.07 * fraction);
        const spanFactor = 1 - 0.65 * Math.exp(-unsupportedLength[i] / (2.2 * diameter));
        const sag = diameter * 2.7 * softness * support[i] ** 1.5 * spanFactor * Math.min(1, z / diameter / 2);
        elevation = Math.max(0, z - compression - sag);
      }
      const spread = 1 + 0.065 * softness * (1 - fraction) ** 2;
      const sectionScale = flow ? Math.sqrt(flow.area[i]) : 1;
      const contactSpread = flow ? 1 + 0.24 * softness * (1 - support[i]) ** 2 : 1;
      if (flow) {
        deposited[i].elevation = elevation;
        deposited[i].sectionScale = sectionScale / contactSpread;
      }
      path[i] = [x * spread, y * spread, elevation, (1 - fraction) * softness, sectionScale, contactSpread];
    });
  }
}

export function makeClayMesh(model, options) {
  const diameter = clamp(Number(options.nozzle) || defaultNozzle, 0.2, 30);
  const softness = 1 - clamp(Number(options.viscosity) || 0, 0, 100) / 100;
  const vic = options.quality === 'vic';
  const accurate = options.quality === 'accurate' || vic;
  const extent = Math.max(...model.dimensions, diameter);
  const origin = [(model.low[0] + model.high[0]) / 2, (model.low[1] + model.high[1]) / 2, model.low[2]];
  if (vic) origin[2] = Math.min(0, origin[2]);
  let length = 0;
  let points = 0;
  let totalExtrusion = 0;
  let measuredLength = 0;
  for (const [runIndex, path] of model.paths.entries()) {
    const amounts = accurate ? model.extrusion?.[runIndex] : undefined;
    points += path.length;
    for (let i = 1; i < path.length; i++) {
      const segmentLength = distance(path[i - 1], path[i]);
      length += segmentLength;
      if (amounts?.[i - 1] > 0 && segmentLength >= Math.min(0.05 * diameter, 0.1)) {
        totalExtrusion += amounts[i - 1];
        measuredLength += segmentLength;
      }
    }
  }
  const step = vic ? Math.max(diameter * 0.45, length / 12_000)
    : accurate ? Math.max(Math.min(diameter * 0.12, 0.9), length / 115_000)
    : Math.max(diameter * 0.7, extent / 200, length / 60_000);
  const minStep = points < 70_000 ? 0.001 : Math.max(0.001, step * 0.7);
  const typicalRate = measuredLength ? totalExtrusion / measuredLength : 0;
  let sampled = sampleRuns(model, origin, diameter, step, minStep, accurate, typicalRate, vic);
  if (accurate) {
    for (const factor of (vic ? [1.7, 3.2, 6.4, 12.8] : [1.7, 3.2])) {
      if (sampled) break;
      sampled = sampleRuns(model, origin, diameter, step * factor, minStep, true, typicalRate, vic);
    }
  }
  if (!sampled) throw new Error(vic ? 'This toolpath is too detailed for VIC. Try Accurate mode or a smaller print.'
    : 'This toolpath is too detailed to display. Try a smaller print.');
  const { paths, rings, segments, caps } = sampled;

  const height = model.dimensions[2];
  if (!vic && options.gravity && softness > 0) {
    applyGravity(paths, diameter, height, softness, accurate);
  }

  const sides = Math.min(vic ? 16 : accurate ? 32 : 12, 4 * Math.floor(maximumRingVertices / (4 * rings)));
  const positions = new Float32Array((rings * sides + caps) * 3);
  const indices = new Uint32Array((segments * 2 + caps) * sides * 3);
  const analysis = vic ? simulateVic(paths, { diameter, stiffness: 1 - softness, gravity: options.gravity }) : undefined;
  const nodeIds = vic ? new Float32Array(positions.length / 3) : undefined;
  const cuts = [];
  let nodeIndex = 0;
  // A rounded rectangle gives adjacent layers wider contact than a round tube.
  const profile = Array.from({ length: sides }, (_, index) => {
    const angle = index * tau / sides;
    return [Math.cos(angle), Math.sin(angle)].map(value => Math.sign(value) * Math.abs(value) ** 0.58);
  });
  let vertex = 0;
  let face = 0;
  const beadRadius = diameter * (0.51 + 0.16 * softness);
  const beadHeight = diameter * (0.44 - 0.08 * softness);

  for (const { points: path, edgeAreas, closed } of paths) {
    const firstNode = nodeIndex;
    const startRing = vertex;
    let sideX = 1;
    let sideZ = 0;
    for (let i = 0; i < path.length; i++) {
      const [x, y, z, load = 0, flowScale, contactSpread = 1] = path[i];
      const beforeArea = edgeAreas?.[i > 0 ? i - 1 : (closed ? path.length - 1 : 0)] ?? 1;
      const afterArea = edgeAreas?.[i] ?? beforeArea;
      const sectionScale = flowScale ?? Math.sqrt((beforeArea + afterArea) * 0.5);
      const previous = path[i - 1] ?? (closed ? path.at(-1) : path[i]);
      const next = path[i + 1] ?? (closed ? path[0] : path[i]);
      const incoming = distance(previous, path[i]) || 1;
      const outgoing = distance(path[i], next) || 1;
      // Give both segments equal influence at a turn, regardless of their sampled lengths.
      const dx = (x - previous[0]) / incoming + (next[0] - x) / outgoing;
      const dy = (y - previous[1]) / incoming + (next[1] - y) / outgoing;
      const dz = (z - previous[2]) / incoming + (next[2] - z) / outgoing;
      const horizontal = Math.hypot(dx, dy);
      const tangentLength = Math.hypot(horizontal, dz) || 1;
      if (horizontal > 0.00001) {
        sideX = -dy / horizontal;
        sideZ = -dx / horizontal;
      }
      const upX = dz * sideZ / tangentLength;
      const upY = (-dy * sideX - dx * sideZ) / tangentLength;
      const upZ = -dz * sideX / tangentLength;
      const loadedRadius = beadRadius * (1 + load * 0.27) * sectionScale * contactSpread;
      const loadedHeight = beadHeight * (1 - load * 0.18) * sectionScale / contactSpread;
      const centerHeight = z + beadHeight * sectionScale / contactSpread;
      for (const [across, vertical] of profile) {
        const width = across * loadedRadius;
        const top = vertical * loadedHeight;
        positions.set([x + sideX * width + upX * top, Math.max(0, centerHeight + upY * top), -y + sideZ * width + upZ * top], vertex * 3);
        if (nodeIds) nodeIds[vertex] = nodeIndex;
        vertex++;
      }
      nodeIndex++;
    }
    const joins = closed ? path.length : path.length - 1;
    for (let i = 0; i < joins; i++) {
      const ring = startRing + i * sides;
      const following = startRing + ((i + 1) % path.length) * sides;
      const failure = analysis?.failure;
      if (failure) {
        const a = failure[firstNode + i];
        const b = failure[firstNode + (i + 1) % path.length];
        if (a !== b) cuts.push(face, Math.min(a || Infinity, b || Infinity));
      }
      for (let j = 0; j < sides; j++) {
        const next = (j + 1) % sides;
        indices.set([ring + j, ring + next, following + j, ring + next, following + next, following + j], face);
        face += 6;
      }
    }
    if (closed) continue;
    const endRing = vertex - sides;
    for (const [point, ring, reverse] of [[path[0], startRing, true], [path.at(-1), endRing, false]]) {
      const scale = point[4] ?? Math.sqrt((reverse ? edgeAreas?.[0] : edgeAreas?.at(-1)) ?? 1);
      positions.set([point[0], point[2] + beadHeight * scale / (point[5] ?? 1), -point[1]], vertex * 3);
      if (nodeIds) nodeIds[vertex] = reverse ? firstNode : nodeIndex - 1;
      for (let j = 0; j < sides; j++) {
        const a = ring + j;
        const b = ring + (j + 1) % sides;
        indices.set(reverse ? [vertex, b, a] : [vertex, a, b], face);
        face += 3;
      }
      vertex++;
    }
  }

  if (analysis) {
    analysis.nodeIds = nodeIds;
    analysis.cuts = new Uint32Array(cuts);
    analysis.stripLength = sides * 6;
  }
  return { positions, indices, analysis };
}
