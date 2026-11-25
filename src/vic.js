const buildFrames = 20;
const frames = 36;
const strengths = [0.56, 0.71, 0.85, 1, 1.17, 1.38, 1.65];
const density = 1850;
// Conversion from millimeters to meters in stress and beam equations.
const weightGradient = density * 9.81 / 1000;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export const vicCauses = ['No load path', 'Span sag or tear', 'Overhang or bond yield', 'Compression yield'];

function buildGraph(runs, diameter, stiffness) {
  const nodes = [];
  const columns = new Map();
  const cell = diameter * 0.9;
  const gridKey = (x, y, z) => x + ':' + y + ':' + z;
  const ranges = [];
  for (const { points, edgeAreas, times, closed } of runs) {
    const start = nodes.length;
    const end = start + points.length;
    ranges.push({ start, end, closed });
    let length = 0;
    for (let i = 0; i < points.length; i++) {
      const [x, y, z] = points[i];
      const a = points[i - 1] ?? (closed ? points.at(-1) : points[i]);
      const b = points[i + 1] ?? (closed ? points[0] : points[i]);
      const incoming = Math.hypot(x - a[0], y - a[1], z - a[2]);
      const outgoing = Math.hypot(x - b[0], y - b[1], z - b[2]);
      if (i) length += incoming;
      const widthScale = Math.sqrt(((edgeAreas?.[i] ?? edgeAreas?.[i - 1] ?? 1) + (edgeAreas?.[i - 1] ?? 1)) / 2);
      const width = diameter * (1.34 - 0.32 * stiffness) * widthScale;
      const height = diameter * (0.72 + 0.16 * stiffness) * widthScale;
      const span = Math.max(diameter * 0.22, (incoming + outgoing) * 0.5);
      const index = nodes.length;
      const ground = z <= Math.max(0.22, diameter * 0.72);
      const voxelX = Math.floor(x / cell);
      const voxelY = Math.floor(y / cell);
      const voxelZ = Math.floor(z / cell);
      const node = { x, y, z, time: times?.[i] ?? index * diameter / 25, index, length,
        width, height, span, ground, volume: width * height * span * 0.88, contacts: [] };
      if (!ground) {
        let first;
        const options = [];
        for (let dz = -2; dz <= 0; dz++) {
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              const bucket = columns.get(gridKey(voxelX + dx, voxelY + dy, voxelZ + dz));
              if (!bucket) continue;
              for (const candidate of bucket) {
                if (candidate.index >= start && length - candidate.length < diameter * 1.8) continue;
                const rise = z - candidate.z;
                const depth = (height + candidate.height) / 2;
                if (rise < diameter * 0.13 || rise > depth + diameter * 0.19) continue;
                const lateral = Math.hypot(x - candidate.x, y - candidate.y);
                const overlap = (width + candidate.width) / 2 - lateral;
                if (overlap < diameter * 0.11) continue;
                const coverage = clamp(overlap / width, 0.04, 1)
                  * clamp(1 - Math.max(0, rise - depth) / (diameter * 0.32), 0.3, 1);
                const contact = { index: candidate.index, coverage, pitch: rise };
                options.push(contact);
                if (!first || coverage > first.coverage) first = contact;
              }
            }
          }
        }
        if (first) {
          node.contacts.push(first);
          // A second contact shares the load without counting the same footprint twice.
          let second;
          for (const option of options) {
            if (option === first || option.coverage < first.coverage * 0.65) continue;
            const other = nodes[option.index];
            const best = nodes[first.index];
            if (Math.hypot(other.x - best.x, other.y - best.y) < diameter * 0.39) continue;
            if (Math.abs(other.z - best.z) > diameter * 0.35) continue;
            if (!second || option.coverage > second.coverage) second = option;
          }
          if (second) node.contacts.push(second);
        }
      }
      const key = gridKey(voxelX, voxelY, voxelZ);
      if (!columns.has(key)) columns.set(key, []);
      const bucket = columns.get(key);
      if (bucket.length >= 64) bucket.shift();
      bucket.push(node);
      nodes.push(node);
    }
  }
  return { nodes, ranges };
}

function assignAnchors(nodes, ranges, direct, count, left, right) {
  for (const { start, end, closed } of ranges) {
    if (start >= count) break;
    const limit = Math.min(end, count);
    const wrap = closed && end <= count;
    let anchor = -1;
    for (let i = start; i < limit; i++) {
      left[i] = anchor;
      if (direct[i]) anchor = i;
    }
    if (wrap && anchor >= 0) {
      for (let i = start; i < limit && left[i] < 0 && !direct[i]; i++) left[i] = anchor;
    }
    anchor = -1;
    for (let i = limit - 1; i >= start; i--) {
      right[i] = anchor;
      if (direct[i]) anchor = i;
    }
    if (wrap && anchor >= 0) {
      for (let i = limit - 1; i >= start && right[i] < 0 && !direct[i]; i--) right[i] = anchor;
    }
    const first = nodes[start];
    const last = nodes[limit - 1];
    const perimeter = last.length + Math.hypot(first.x - last.x, first.y - last.y, first.z - last.z);
    for (let i = start; i < limit; i++) nodes[i].perimeter = perimeter;
  }
}

function solveLoads(graph, diameter, stiffness, factor, onStep) {
  const { nodes, ranges } = graph;
  const size = nodes.length;
  const failure = new Uint8Array(size);
  const cause = new Uint8Array(size);
  const peak = new Float32Array(size);
  const direct = new Uint8Array(size);
  const left = new Int32Array(size);
  const right = new Int32Array(size);
  const volume = new Float32Array(size);
  const momentX = new Float32Array(size);
  const momentY = new Float32Array(size);
  const sag = new Float32Array(size);
  const loading = new Float32Array(size);
  const yieldStress = (610 + 6100 * stiffness ** 2.15) * factor;
  const modulus = (6500 + 110000 * stiffness ** 2) * factor;
  const capillary = 62 / diameter;

  function transfer(donor, receiver, fraction) {
    const amount = volume[donor.index] * fraction;
    volume[receiver.index] += amount;
    // Local force spreading into adjacent wet strands relaxes part of the carried moment.
    momentX[receiver.index] += momentX[donor.index] * fraction * 0.39 + amount * (donor.x - receiver.x);
    momentY[receiver.index] += momentY[donor.index] * fraction * 0.39 + amount * (donor.y - receiver.y);
  }

  for (let frame = 1; frame < frames; frame++) {
    const count = Math.min(size, Math.ceil(size * frame / buildFrames));
    const clock = nodes[count - 1].time + Math.max(0, frame - buildFrames) * 0.34;
    direct.fill(0);
    momentX.fill(0);
    momentY.fill(0);
    for (let i = 0; i < count; i++) {
      const node = nodes[i];
      volume[i] = failure[i] ? 0 : node.volume;
      if (!failure[i] && (node.ground || node.contacts.some(contact => !failure[contact.index]))) direct[i] = 1;
    }
    assignAnchors(nodes, ranges, direct, count, left, right);
    for (let i = 0; i < count; i++) {
      if (failure[i] || direct[i]) continue;
      const node = nodes[i];
      const before = nodes[left[i]];
      const after = nodes[right[i]];
      const a = before ? (node.length - before.length + node.perimeter) % node.perimeter : Infinity;
      const b = after ? (after.length - node.length + node.perimeter) % node.perimeter : Infinity;
      const spanned = before && after && before !== after;
      const reach = spanned ? a + b : Math.min(a, b);
      const aging = 1 + 0.62 * (1 - Math.exp(-Math.max(0, clock - node.time) / 36));
      const beamLength = spanned ? Math.sqrt(a * b) : reach;
      const bending = 3 * weightGradient * beamLength ** 2 / node.height;
      // Uniformly loaded beam, evaluated at the sample between its supports.
      const deflection = (spanned ? 0.15625 : 1.5) * weightGradient * reach ** 4 / (modulus * aging * node.height ** 2)
        * (spanned ? 4 * a * b / reach ** 2 : 1);
      const ratio = Math.max(bending / (1.73 * yieldStress * aging), deflection / (node.height * 1.2));
      const mode = Number.isFinite(reach) ? 1 : 0;
      loading[i] = Number.isFinite(ratio) ? ratio : 20;
      cause[i] = mode;
      sag[i] = clamp(deflection, 0, node.height * 1.4);
      if (loading[i] > 1) {
        failure[i] = frame;
      } else if (spanned) {
        transfer(node, before, b / reach);
        transfer(node, after, a / reach);
      } else {
        transfer(node, nodes[a < b ? left[i] : right[i]], 1);
      }
      peak[i] = Math.max(peak[i], loading[i]);
    }

    for (let i = count - 1; i >= 0; i--) {
      if (failure[i] || !direct[i]) continue;
      const node = nodes[i];
      const first = node.contacts.find(contact => !failure[contact.index]);
      const second = first === node.contacts[0] && node.contacts[1] && !failure[node.contacts[1].index] ? node.contacts[1] : undefined;
      const coverage = node.ground ? 1 : first?.coverage ?? 0;
      const age = Math.max(0, clock - node.time);
      const aging = 1 + 0.62 * (1 - Math.exp(-age / 36));
      const footprint = node.width * node.span * Math.max(0.27, coverage);
      const stress = weightGradient * volume[i] / footprint;
      const lever = Math.hypot(momentX[i], momentY[i]) / volume[i];
      const supportX = first ? nodes[first.index].x - node.x : 0;
      const supportY = first ? nodes[first.index].y - node.y : 0;
      const localLever = Math.hypot(supportX, supportY) * (1 - coverage) + lever;
      const compression = (stress + capillary) / (1.9 * yieldStress * aging);
      const overhang = node.ground ? 0 : stress * (2.4 * localLever / node.width + (1 - coverage) ** 2)
        / (yieldStress * aging);
      const ratio = coverage ? Math.max(compression, overhang) : 20;
      loading[i] = ratio;
      cause[i] = coverage === 0 ? 0 : compression > overhang ? 3 : 2;
      peak[i] = Math.max(peak[i], ratio);
      // A shear-thinning creep response once local stress approaches the yield envelope.
      const creep = Math.max(0, ratio - 0.47) ** 1.65 * (1.12 - 0.67 * stiffness);
      sag[i] = node.ground ? 0 : Math.min(node.height * 0.55, node.height * creep * (1 - Math.exp(-age / 4.0)));
      if (ratio > 1) failure[i] = frame;
      else if (second) {
        const share = first.coverage / (first.coverage + second.coverage);
        transfer(node, nodes[first.index], share);
        transfer(node, nodes[second.index], 1 - share);
      } else if (first) transfer(node, nodes[first.index], 1);
    }
    onStep?.(frame, count, failure, sag, loading);
  }
  return { failure, cause, peak };
}

function captureMotion(graph, diameter, stiffness, factor) {
  const { nodes, ranges } = graph;
  const count = nodes.length;
  const trajectory = new Float32Array(frames * count * 4);
  const sections = new Uint8Array(frames * count * 2);
  const position = new Float32Array(count * 3);
  const velocity = new Float32Array(count * 3);
  const previousZ = new Float32Array(count);
  const amount = Float64Array.from(nodes, node => node.volume);
  const exchange = new Float64Array(count);
  const level = new Float64Array(count);
  const impact = new Float64Array(count);
  const flatten = new Float64Array(count);
  const flowYield = (610 + 6100 * stiffness ** 2.15) * factor;
  const voxel = diameter * 0.8;
  const key = (x, y) => x + ':' + y;
  const step = 1 / 36;
  const edges = [];

  function addEdge(i, j, flows) {
    const a = nodes[i];
    const b = nodes[j];
    edges.push({ a: i, b: j, length: Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z), flows });
  }

  for (const { start, end, closed } of ranges) {
    for (let i = start; i < end - 1; i++) addEdge(i, i + 1, true);
    if (closed) addEdge(end - 1, start, true);
  }
  for (const node of nodes) {
    if (node.contacts[0]) addEdge(node.index, node.contacts[0].index);
    position.set([node.x, node.y, node.z], node.index * 3);
  }

  const result = solveLoads(graph, diameter, stiffness, factor, (frame, active, failure, sag, loading) => {
    const solid = new Map();
    for (let i = 0; i < active; i++) {
      const node = nodes[i];
      const p = 3 * i;
      if (failure[i]) {
        if (failure[i] === frame) {
          const prior = node.contacts[0] && nodes[node.contacts[0].index];
          velocity[p] = prior ? clamp((node.x - prior.x) * 6, -65, 65) : 0;
          velocity[p + 1] = prior ? clamp((node.y - prior.y) * 6, -65, 65) : 0;
        }
        continue;
      }
      // Damping keeps the stable wall from snapping between coarse load checkpoints.
      position[p + 2] += 0.68 * (Math.max(0, node.z - sag[i]) - position[p + 2]);
      const column = key(Math.floor(node.x / voxel), Math.floor(node.y / voxel));
      if (!solid.has(column)) solid.set(column, []);
      solid.get(column).push(i);
    }

    for (let iteration = 0; iteration < 4; iteration++) {
      for (let i = 0; i < active; i++) {
        if (!failure[i]) continue;
        const p = i * 3;
        previousZ[i] = position[p + 2];
        velocity[p] *= 0.84;
        velocity[p + 1] *= 0.84;
        velocity[p + 2] = velocity[p + 2] * 0.91 - 9810 * step;
        position[p] += velocity[p] * step;
        position[p + 1] += velocity[p + 1] * step;
        position[p + 2] += velocity[p + 2] * step;
      }

      for (const edge of edges) {
        if (!failure[edge.a] || failure[edge.a] !== failure[edge.b] || edge.length < 0.0001) continue;
        const a = edge.a * 3;
        const b = edge.b * 3;
        const dx = position[b] - position[a];
        const dy = position[b + 1] - position[a + 1];
        const dz = position[b + 2] - position[a + 2];
        const length = Math.hypot(dx, dy, dz);
        if (length <= edge.length * 0.7) continue;
        // Cohesive clumps retain some axial tension as failed material folds.
        const correction = (length - edge.length) / length * (0.12 + 0.20 * stiffness);
        position[a] += dx * correction;
        position[a + 1] += dy * correction;
        position[a + 2] += dz * correction;
        position[b] -= dx * correction;
        position[b + 1] -= dy * correction;
        position[b + 2] -= dz * correction;
      }

      // Contact with surviving clay and the build plate is inelastic.
      const debris = new Map();
      for (let i = 0; i < active; i++) {
        if (!failure[i]) continue;
        const p = 3 * i;
        const node = nodes[i];
        const x = position[p];
        const y = position[p + 1];
        const cx = Math.floor(x / voxel);
        const cy = Math.floor(y / voxel);
        let floor = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const bucket = solid.get(key(cx + dx, cy + dy));
            if (!bucket) continue;
            for (const j of bucket) {
              const other = nodes[j];
              const surface = position[3 * j + 2] + other.height * 0.78;
              if (surface < floor || surface > previousZ[i] + diameter * 0.16) continue;
              if ((x - other.x) ** 2 + (y - other.y) ** 2 < (node.width + other.width) ** 2 * 0.115) floor = surface;
            }
          }
        }
        const column = key(cx, cy);
        const rest = debris.get(column);
        if (rest && rest.time !== failure[i] && rest.height <= previousZ[i] + diameter * 0.12) floor = Math.max(floor, rest.height);
        if (position[p + 2] <= floor) {
          const pressure = density * (Math.min(0, velocity[p + 2]) / 1000) ** 2;
          impact[i] = Math.max(impact[i], pressure);
          flatten[i] = Math.min(0.43, flatten[i] + Math.max(0, pressure / flowYield - 0.6) * 0.08);
          position[p + 2] = floor;
          velocity[p + 2] = 0;
          debris.set(column, { height: floor + node.height * 0.60, time: failure[i] });
        }
      }

      // Equal-and-opposite fluxes along unbroken bead edges conserve deposited volume.
      // An impact can yield a clump and drive shear-thinning flow even when self-weight alone cannot.
      exchange.fill(0);
      for (let i = 0; i < active; i++) {
        const node = nodes[i];
        level[i] = position[3 * i + 2] + node.height * Math.sqrt(amount[i] / node.volume) * (1 - flatten[i]);
        impact[i] *= 0.72;
      }
      for (const edge of edges) {
        const { a, b, length } = edge;
        if (!edge.flows || a >= active || b >= active || failure[a] !== failure[b] || length < 0.0001) continue;
        const slope = (level[a] - level[b]) / Math.max(length, diameter * 0.15);
        const pressure = (failure[a] ? impact[a] - impact[b] : 0.42 * (loading[a] - loading[b]) * flowYield);
        const drive = weightGradient * diameter * slope + pressure;
        const yielded = Math.max(0, Math.abs(drive) / flowYield - 1);
        if (yielded === 0) continue;
        const donor = drive > 0 ? a : b;
        const receiver = drive > 0 ? b : a;
        const transfer = Math.max(0, Math.min(
          nodes[donor].volume * 0.048 * yielded ** (1 / 0.6),
          (amount[donor] - 0.45 * nodes[donor].volume) * 0.25,
          (1.92 * nodes[receiver].volume - amount[receiver]) * 0.25,
        ));
        exchange[donor] -= transfer;
        exchange[receiver] += transfer;
      }
      for (let i = 0; i < active; i++) amount[i] += exchange[i];
    }
    for (let i = 0; i < active; i++) {
      const node = nodes[i];
      const p = i * 3;
      const base = (frame * count + i) * 4;
      trajectory[base] = position[p] - node.x;
      trajectory[base + 1] = position[p + 2] - node.z;
      trajectory[base + 2] = node.y - position[p + 1];
      trajectory[base + 3] = 1;
      const section = (frame * count + i) * 2;
      sections[section] = Math.round(127 * amount[i] / node.volume);
      sections[section + 1] = Math.round(255 * (1 - flatten[i]));
    }
  });
  return { trajectory, sections, ...result };
}

function pickHotspots(nodes, votes, cases, diameter) {
  const order = nodes.map((node, i) => i).filter(i => votes[i]);
  order.sort((a, b) => votes[b] - votes[a] || cases.peak[b] - cases.peak[a] || nodes[a].z - nodes[b].z);
  const hotspots = [];
  for (const i of order) {
    const { x, y, z } = nodes[i];
    if (hotspots.some(spot => Math.hypot(spot.x - x, spot.y - y, spot.z - z) < diameter * 3)) continue;
    hotspots.push({ x, y, z, cases: votes[i], cause: cases.cause[i] });
    if (hotspots.length === 4) break;
  }
  return hotspots;
}

export function simulateVic(runs, { diameter, stiffness, gravity }) {
  const votes = new Uint8Array(runs.reduce((sum, run) => sum + run.points.length, 0));
  if (!gravity) return { votes, hotspots: [], totalCases: strengths.length, frames, buildFrames, gravity };
  const graph = buildGraph(runs, diameter, stiffness);
  const { nodes } = graph;
  const count = nodes.length;

  const cases = strengths.map(factor => solveLoads(graph, diameter, stiffness, factor));
  cases.forEach(({ failure }) => failure.forEach((when, i) => { if (when) votes[i]++; }));
  const nominal = strengths.indexOf(1);
  let chosen = nominal;
  if (!cases[nominal].failure.some(Boolean)) {
    while (chosen > 0 && !cases[chosen].failure.some(Boolean)) chosen--;
    if (!cases[chosen].failure.some(Boolean)) chosen = nominal;
  }
  const demo = captureMotion(graph, diameter, stiffness, strengths[chosen]);
  const hotspots = pickHotspots(nodes, votes, cases[0], diameter);
  return {
    votes, hotspots, totalCases: strengths.length, frames, buildFrames, gravity, trajectory: demo.trajectory, sections: demo.sections,
    centers: Float32Array.from(nodes.flatMap(node => [node.x, node.z, -node.y])),
    failure: demo.failure,
    firstFailure: demo.failure.reduce((first, when) => when ? Math.min(first, when) : first, frames),
    strength: strengths[chosen], held: demo.failure.reduce((sum, when) => sum + (when === 0), 0) / count,
  };
}
