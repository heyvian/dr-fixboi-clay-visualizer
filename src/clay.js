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

function applyGravity(paths, diameter, height, softness, supportSpacing) {
  const cells = new Map();
  const cellWidth = diameter * 1.3;
  const cellHeight = diameter * 1.12;
  const clearance = diameter * 0.19;
  const sampleSpacing = diameter * supportSpacing;
  const key = (x, y, z) => `${x}:${y}:${z}`;
  for (const { points: path, closed } of paths) {
    const support = [];
    for (const point of path) {
      const [x, y, z] = point;
      const cellX = Math.floor(x / cellWidth);
      const cellY = Math.floor(y / cellWidth);
      const cellZ = Math.floor(z / cellHeight);
      let nearest = 1;
      if (z > cellHeight) {
        for (let dx = -1; dx <= 1; dx++) {
          for (let dy = -1; dy <= 1; dy++) {
            for (let dz = -1; dz <= 0; dz++) {
              const bucket = cells.get(key(cellX + dx, cellY + dy, cellZ + dz));
              if (!bucket) continue;
              for (const neighbor of bucket.values()) {
                const rise = z - neighbor[2];
                if (rise <= clearance || rise > cellHeight) continue;
                const gap = Math.hypot(x - neighbor[0], y - neighbor[1]) / cellWidth;
                nearest = Math.min(nearest, gap);
              }
            }
          }
        }
      } else {
        nearest = 0;
      }
      support.push(nearest);
      const bucketKey = key(cellX, cellY, cellZ);
      const bucket = cells.get(bucketKey) ?? new Map();
      if (!bucket.size) cells.set(bucketKey, bucket);
      const sampleKey = key(Math.floor(x / sampleSpacing), Math.floor(y / sampleSpacing), Math.floor(z / sampleSpacing));
      bucket.set(sampleKey, point);
    }

    const unsupportedLength = distanceToSupport(support, path, closed);
    smoothSupport(support, path, diameter * 0.8, closed);
    path.forEach((point, i) => {
      const [x, y, z] = point;
      const fraction = clamp(z / Math.max(height, diameter), 0, 1);
      const compression = z * softness * (0.15 - 0.07 * fraction);
      const spanFactor = 1 - 0.65 * Math.exp(-unsupportedLength[i] / (2.2 * diameter));
      const sag = diameter * 2.7 * softness * support[i] ** 1.5 * spanFactor * Math.min(1, z / diameter / 2);
      const spread = 1 + 0.065 * softness * (1 - fraction) ** 2;
      path[i] = [x * spread, y * spread, Math.max(0, z - compression - sag), (1 - fraction) * softness];
    });
  }
}

export function makeClayMesh(model, options) {
  const diameter = clamp(Number(options.nozzle) || 2.4, 0.2, 30);
  const softness = 1 - clamp(Number(options.viscosity) || 0, 0, 100) / 100;
  const accurate = options.quality === 'accurate';
  const extent = Math.max(...model.dimensions, diameter);
  const origin = [(model.low[0] + model.high[0]) / 2, (model.low[1] + model.high[1]) / 2, model.low[2]];
  let length = 0;
  let points = 0;
  for (const path of model.paths) {
    points += path.length;
    for (let i = 1; i < path.length; i++) length += distance(path[i - 1], path[i]);
  }
  const step = Math.max(diameter * (accurate ? 0.4 : 0.7), extent / (accurate ? 330 : 200), length / (accurate ? 85_000 : 60_000));
  const minStep = points < 70_000 ? 0.001 : Math.max(0.001, step * 0.7);
  const paths = [];
  let rings = 0;
  let segments = 0;
  let caps = 0;
  for (const path of model.paths) {
    const sampled = samplePath(path, origin, step, minStep);
    if (sampled.length < 2) continue;
    const start = sampled[0];
    const end = sampled.at(-1);
    const closed = path.length >= 4 && sampled.length >= 4
      && Math.abs(start[2] - end[2]) <= 0.05
      && distance(start, end) <= Math.min(diameter * 0.12, 0.6);
    // A near-closed perimeter gets one shared ring in place of two overlapping caps.
    if (closed) sampled.pop();
    else caps += 2;
    paths.push({ points: sampled, closed });
    rings += sampled.length;
    segments += closed ? sampled.length : sampled.length - 1;
    if (rings > maximumRings) throw new Error('This toolpath is too detailed to display. Try a smaller print.');
  }

  const height = model.dimensions[2];
  if (options.gravity && softness > 0) {
    applyGravity(paths, diameter, height, softness, accurate ? 0.22 : 0.4);
  }

  const sides = Math.min(accurate ? 24 : 12, 4 * Math.floor(maximumRingVertices / (4 * rings)));
  const positions = new Float32Array((rings * sides + caps) * 3);
  const indices = new Uint32Array((segments * 2 + caps) * sides * 3);
  // A rounded rectangle gives adjacent layers wider contact than a round tube.
  const profile = Array.from({ length: sides }, (_, index) => {
    const angle = index * tau / sides;
    return [Math.cos(angle), Math.sin(angle)].map(value => Math.sign(value) * Math.abs(value) ** 0.58);
  });
  let vertex = 0;
  let face = 0;
  const beadRadius = diameter * (0.51 + 0.16 * softness);
  const beadHeight = diameter * (0.44 - 0.08 * softness);

  for (const { points: path, closed } of paths) {
    const startRing = vertex;
    let sideX = 1;
    let sideZ = 0;
    for (let i = 0; i < path.length; i++) {
      const [x, y, z, load = 0] = path[i];
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
      const loadedRadius = beadRadius * (1 + load * 0.27);
      const loadedHeight = beadHeight * (1 - load * 0.18);
      for (const [across, vertical] of profile) {
        const width = across * loadedRadius;
        const top = vertical * loadedHeight;
        positions.set([x + sideX * width + upX * top, Math.max(0, z + beadHeight + upY * top), -y + sideZ * width + upZ * top], vertex * 3);
        vertex++;
      }
    }
    const joins = closed ? path.length : path.length - 1;
    for (let i = 0; i < joins; i++) {
      const ring = startRing + i * sides;
      const following = startRing + ((i + 1) % path.length) * sides;
      for (let j = 0; j < sides; j++) {
        const next = (j + 1) % sides;
        indices.set([ring + j, ring + next, following + j, ring + next, following + next, following + j], face);
        face += 6;
      }
    }
    if (closed) continue;
    const endRing = vertex - sides;
    for (const [point, ring, reverse] of [[path[0], startRing, true], [path.at(-1), endRing, false]]) {
      positions.set([point[0], point[2] + beadHeight, -point[1]], vertex * 3);
      for (let j = 0; j < sides; j++) {
        const a = ring + j;
        const b = ring + (j + 1) % sides;
        indices.set(reverse ? [vertex, b, a] : [vertex, a, b], face);
        face += 3;
      }
      vertex++;
    }
  }

  return { positions, indices };
}
