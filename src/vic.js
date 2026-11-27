import { createVicContacts } from './vic-contact.js';
import { createVicFilament } from './vic-filament.js';

const depositionChecks = 96;
const settlingTimes = [
  ...Array.from({ length: 35 }, (_, i) => (i + 1) * 0.02),
  ...Array.from({ length: 29 }, (_, i) => 0.7 + (i + 1) * 0.1),
];
const strengths = [0.56, 0.71, 0.85, 1, 1.17, 1.38, 1.65];
const density = 1850;
// Conversion from millimeters to meters in stress and beam equations.
const weightGradient = density * 9.81 / 1000;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const baseYield = stiffness => 610 + 6100 * stiffness ** 2.15;
const clayRecovery = age => 1 + 0.62 * (1 - Math.exp(-age / 36));

export const vicCauses = ['No load path', 'Span sag or tear', 'Overhang or bond yield', 'Compression yield'];

function buildGraph(runs, diameter, stiffness) {
  const nodes = [];
  const columns = new Map();
  const cell = diameter * 0.9;
  const gridKey = (x, y, z) => x + ':' + y + ':' + z;
  const ranges = [];
  for (const { points, edgeAreas, times, closed, endTime } of runs) {
    const start = nodes.length;
    const end = start + points.length;
    const range = { start, end, closed, endTime };
    ranges.push(range);
    let length = 0;
    let anchor;
    for (let i = 0; i < points.length; i++) {
      const [x, y, z] = points[i];
      const a = points[i - 1] ?? (closed ? points.at(-1) : points[i]);
      const b = points[i + 1] ?? (closed ? points[0] : points[i]);
      const incoming = Math.hypot(x - a[0], y - a[1], z - a[2]);
      const outgoing = Math.hypot(x - b[0], y - b[1], z - b[2]);
      const dx = (x - a[0]) / (incoming || 1) + (b[0] - x) / (outgoing || 1);
      const dy = (y - a[1]) / (incoming || 1) + (b[1] - y) / (outgoing || 1);
      const dz = (z - a[2]) / (incoming || 1) + (b[2] - z) / (outgoing || 1);
      const directionLength = Math.hypot(dx, dy, dz);
      const tangent = directionLength > 0.0001 ? [dx / directionLength, dz / directionLength, -dy / directionLength] : [1, 0, 0];
      if (i) length += incoming;
      const beforeArea = edgeAreas?.[i > 0 ? i - 1 : (closed ? points.length - 1 : 0)] ?? 1;
      const afterArea = edgeAreas?.[i] ?? beforeArea;
      const span = Math.max(diameter * 0.005, (incoming + outgoing) * 0.5);
      const widthScale = Math.sqrt(Math.max(0.15, (beforeArea * incoming + afterArea * outgoing) / (2 * span)));
      const width = diameter * (1.34 - 0.32 * stiffness) * widthScale;
      const height = diameter * (0.72 + 0.16 * stiffness) * widthScale;
      const index = nodes.length;
      // A fresh bead close enough to settle into the plate can bear on it.
      const ground = z <= Math.max(0.05, diameter * 0.12, height * 0.24);
      const voxelX = Math.floor(x / cell);
      const voxelY = Math.floor(y / cell);
      const voxelZ = Math.floor(z / cell);
      const section = width * height * 0.88;
      const node = { x, y, z, time: times?.[i] ?? index * diameter / 25, index, length, run: ranges.length - 1,
        width, height, span, ground, tangent, incoming: section * incoming / 2,
        outgoing: section * outgoing / 2, contacts: [] };
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
          const best = nodes[first.index];
          // Nearby distinct sections share load across the footprint as sampling gets finer.
          options.sort((a, b) => b.coverage - a.coverage);
          for (const option of options) {
            if (option.coverage < first.coverage * 0.60 || node.contacts.length >= 3) break;
            const other = nodes[option.index];
            if (Math.abs(other.z - best.z) > diameter * 0.31) continue;
            if (node.contacts.some(contact => {
              const point = nodes[contact.index];
              return (other.x - point.x) ** 2 + (other.y - point.y) ** 2 < (diameter * 0.22) ** 2;
            })) continue;
            node.contacts.push(option);
          }
        }
      }
      const key = gridKey(voxelX, voxelY, voxelZ);
      if (!columns.has(key)) columns.set(key, []);
      const bucket = columns.get(key);
      if (bucket.length >= 64) bucket.shift();
      bucket.push(node);
      nodes.push(node);
      if (ground || node.contacts.length) anchor = node;
      node.freeTail = anchor ? length - anchor.length : Infinity;
    }
    range.endTime ??= nodes[end - 1].time;
  }
  return { nodes, ranges };
}

function assignAnchors(nodes, ranges, direct, failure, count, clock, left, right) {
  for (const { start, end, closed, endTime } of ranges) {
    if (start >= count) break;
    const limit = Math.min(end, count);
    const wrap = closed && end <= count && endTime <= clock;
    let anchor = -1;
    for (let i = start; i < limit; i++) {
      if (failure[i]) anchor = -1;
      left[i] = anchor;
      if (direct[i]) anchor = i;
    }
    if (wrap && anchor >= 0) {
      for (let i = start; i < limit && left[i] < 0 && !direct[i] && !failure[i]; i++) left[i] = anchor;
    }
    anchor = -1;
    for (let i = limit - 1; i >= start; i--) {
      if (failure[i]) anchor = -1;
      right[i] = anchor;
      if (direct[i]) anchor = i;
    }
    if (wrap && anchor >= 0) {
      for (let i = limit - 1; i >= start && right[i] < 0 && !direct[i] && !failure[i]; i--) right[i] = anchor;
    }
    const first = nodes[start];
    const last = nodes[limit - 1];
    const perimeter = last.length + (wrap ? Math.hypot(first.x - last.x, first.y - last.y, first.z - last.z) : 0);
    for (let i = start; i < limit; i++) {
      nodes[i].perimeter = perimeter;
      nodes[i].loopLaid = wrap;
    }
  }
}

function depositedVolume(node, range, count, clock) {
  const closure = range.closed && count >= range.end && clock >= range.endTime;
  const incoming = node.index > range.start || closure ? node.incoming : 0;
  const outgoing = node.index + 1 < Math.min(range.end, count) || closure ? node.outgoing : 0;
  return incoming + outgoing;
}

function bendingRatio(length, height, yieldStress) {
  return 3 * weightGradient * length ** 2 / (1.73 * yieldStress * height);
}

function freeTailRisk(node, yieldStress, modulus) {
  if (!node.freeTail) return 0;
  const length = node.freeTail;
  return Math.max(bendingRatio(length, node.height, yieldStress),
    1.25 * weightGradient * length ** 4 / (modulus * node.height ** 3));
}

// Visit every new sample at nozzle time. Run the full load solve at regular
// intervals, and immediately when a free tail can fail before its next support.
function* depositionSteps({ nodes, ranges }, diameter, yieldStress, modulus) {
  const endTime = ranges.at(-1).endTime;
  const timeStep = Math.max(0.2, (endTime - nodes[0].time) / depositionChecks);
  const sampleStep = Math.ceil(nodes.length / depositionChecks);
  const cantileverStep = diameter * 2;
  let lastCount = 0;
  let lastTime = nodes[0].time;
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const previous = nodes[i - 1];
    if (previous && node.time - previous.time >= timeStep) {
      if (lastCount < i) {
        lastCount = i;
        lastTime = previous.time;
        yield { count: i, clock: lastTime };
      }
      // Assess aging and creep during travel or a dwell with the nozzle idle.
      while (lastTime + timeStep < node.time) {
        lastTime += timeStep;
        yield { count: i, clock: lastTime };
      }
    }

    const count = i + 1;
    const next = nodes[count];
    const risk = node.index > ranges[node.run].start ? freeTailRisk(node, yieldStress, modulus) : 0;
    // Recheck the anchor as a free end grows. It may yield under the added
    // leverage before the free end itself reaches its deflection limit.
    const longerCantilever = Number.isFinite(node.freeTail) && previous?.run === node.run
      && Math.floor(node.freeTail / cantileverStep) > Math.floor(previous.freeTail / cantileverStep);
    const beforeSupport = risk > 1 && (!next?.freeTail || next?.run !== node.run)
      && count - lastCount >= Math.ceil(sampleStep / 2);
    if (count === 1 || count === nodes.length || count - lastCount >= sampleStep
      || node.time - lastTime >= timeStep || risk >= 1.6 || longerCantilever || beforeSupport) {
      lastCount = count;
      lastTime = node.time;
      yield { count, clock: lastTime };
    }
  }
  if (lastTime < endTime) yield { count: nodes.length, clock: endTime };
}

function solveLoads(graph, diameter, stiffness, factor, onStep) {
  const { nodes, ranges } = graph;
  const size = nodes.length;
  const failure = new Uint16Array(size);
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
  const damage = new Float32Array(size);
  const yieldStress = baseYield(stiffness) * factor;
  const modulus = (6500 + 110000 * stiffness ** 2) * factor;
  const capillary = 62 / diameter;
  const times = [nodes[0].time];
  const counts = [0];
  let firstFailure = 0;

  function transfer(donor, receiver, fraction) {
    const amount = volume[donor.index] * fraction;
    volume[receiver.index] += amount;
    // Local force spreading into adjacent wet strands relaxes part of the carried moment.
    momentX[receiver.index] += momentX[donor.index] * fraction * 0.39 + amount * (donor.x - receiver.x);
    momentY[receiver.index] += momentY[donor.index] * fraction * 0.39 + amount * (donor.y - receiver.y);
  }

  function check({ count, clock, laidAt = clock }) {
    const frame = times.length;
    const elapsed = clock - times.at(-1);
    times.push(clock);
    counts.push(count);
    let lostSupport = false;
    direct.fill(0);
    momentX.fill(0);
    momentY.fill(0);
    for (let i = 0; i < count; i++) {
      const node = nodes[i];
      volume[i] = failure[i] ? 0 : depositedVolume(node, ranges[node.run], count, laidAt);
      if (volume[i] && (node.ground || node.contacts.some(contact => !failure[contact.index]))) direct[i] = 1;
    }
    assignAnchors(nodes, ranges, direct, failure, count, laidAt, left, right);
    for (let i = 0; i < count; i++) {
      if (!volume[i] || direct[i]) continue;
      const node = nodes[i];
      const before = nodes[left[i]];
      const after = nodes[right[i]];
      const a = before ? node.length - before.length + (left[i] > i ? node.perimeter : 0) : Infinity;
      const b = after ? after.length - node.length + (right[i] < i ? node.perimeter : 0) : Infinity;
      const spanned = before && after && before !== after;
      const reach = spanned ? a + b : Math.min(a, b);
      const aging = clayRecovery(Math.max(0, clock - node.time));
      const beamLength = spanned ? Math.sqrt(a * b) : reach;
      // Uniformly loaded beam, evaluated at the sample between its supports.
      const deflection = (spanned ? 0.15625 : 1.5) * weightGradient * reach ** 4 / (modulus * aging * node.height ** 2)
        * (spanned ? 4 * a * b / reach ** 2 : 1);
      const ratio = Math.max(bendingRatio(beamLength, node.height, yieldStress * aging), deflection / (node.height * 1.2));
      const mode = Number.isFinite(reach) ? 1 : 0;
      loading[i] = Number.isFinite(ratio) ? ratio : 20;
      cause[i] = mode;
      sag[i] = clamp(deflection, 0, node.height * 1.4);
      damage[i] += Math.min(elapsed, clock - node.time) * Math.max(0, loading[i] - 1) ** 1.4 * 2.9;
      if (loading[i] >= 1.6 || damage[i] >= 1) {
        failure[i] = frame;
        lostSupport = true;
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
      let coverage = 0;
      let shares = 0;
      let supportX = 0;
      let supportY = 0;
      for (const contact of node.contacts) {
        if (failure[contact.index]) continue;
        const receiver = nodes[contact.index];
        coverage = Math.max(coverage, contact.coverage);
        const share = contact.coverage ** 2;
        shares += share;
        supportX += (receiver.x - node.x) * share;
        supportY += (receiver.y - node.y) * share;
      }
      if (node.ground) coverage = 1;
      const age = Math.max(0, clock - node.time);
      const aging = clayRecovery(age);
      const footprint = node.width * Math.max(diameter * 0.19, node.span) * Math.max(0.27, coverage);
      const stress = weightGradient * volume[i] / footprint;
      const lever = Math.hypot(momentX[i], momentY[i]) / volume[i];
      const localLever = (shares ? Math.hypot(supportX, supportY) / shares * (1 - coverage) : 0) + lever;
      const compression = (stress + capillary) / (1.9 * yieldStress * aging);
      const overhang = node.ground ? 0 : stress * (2.4 * localLever / node.width + (1 - coverage) ** 2)
        / (yieldStress * aging);
      const ratio = coverage ? Math.max(compression, overhang) : 20;
      loading[i] = ratio;
      cause[i] = coverage === 0 ? 0 : compression > overhang ? 3 : 2;
      peak[i] = Math.max(peak[i], ratio);
      // A shear-thinning creep response once local stress approaches the yield envelope.
      const creep = Math.max(0, ratio - 0.47) ** 1.65 * (1.12 - 0.67 * stiffness);
      sag[i] = node.ground ? Math.max(0, node.z) : Math.min(node.height * 0.55, node.height * creep * (1 - Math.exp(-age / 4.0)));
      damage[i] += Math.min(elapsed, age) * Math.max(0, ratio - 1) ** 1.4 * 2.9;
      if (ratio >= 1.6 || damage[i] >= 1) {
        failure[i] = frame;
        lostSupport = true;
      } else if (shares) {
        for (const contact of node.contacts) {
          if (!failure[contact.index]) transfer(node, nodes[contact.index], contact.coverage ** 2 / shares);
        }
      }
    }
    if (lostSupport && !firstFailure) firstFailure = frame;
    onStep?.(frame, count, laidAt, elapsed, failure, sag, loading);
  }

  for (const step of depositionSteps(graph, diameter, yieldStress, modulus)) {
    check(step);
    if (firstFailure) break;
  }
  const buildFrames = times.length - 1;
  const count = counts.at(-1);
  const endClock = times.at(-1);
  const stopped = endClock < ranges.at(-1).endTime || count < size;
  for (const time of settlingTimes) check({ count, clock: endClock + time, laidAt: endClock });
  const frames = times.length;
  return { failure, cause, peak, times: Float64Array.from(times), buildFrames, frames, stopped,
    firstFailure: firstFailure || frames, deposited: count };
}

function captureMotion(graph, diameter, stiffness, factor, schedule) {
  const { nodes, ranges } = graph;
  const count = nodes.length;
  // Keep the last deposition check (the break, if printing stopped) and every
  // settling check. Coarser storage for stable motion keeps the GPU atlas small.
  const stride = Math.max(1, Math.ceil(schedule.buildFrames / 100));
  const earlier = Math.ceil(schedule.buildFrames / stride);
  const skipped = schedule.buildFrames - earlier;
  const frames = schedule.frames - skipped;
  const times = new Float64Array(frames);
  const trajectory = new Float32Array(frames * count * 4);
  const sections = new Uint8Array(frames * count * 4);
  const position = new Float32Array(count * 3);
  const velocity = new Float32Array(count * 3);
  const previousX = new Float32Array(count);
  const previousY = new Float32Array(count);
  const previousZ = new Float32Array(count);
  const inverseMass = new Float32Array(count);
  const amount = new Float64Array(count);
  const laidVolumes = new Float64Array(count);
  const exchange = new Float64Array(count);
  const level = new Float64Array(count);
  const pressure = new Float64Array(count);
  const localYield = new Float64Array(count);
  const impact = new Float64Array(count);
  const flatten = new Float64Array(count);
  const tears = new Uint16Array(count);
  const flowYield = baseYield(stiffness) * factor;
  const filament = createVicFilament(nodes, ranges, stiffness);
  const contacts = createVicContacts(nodes, diameter, position, previousZ, velocity, laidVolumes, filament.areaRatio);
  const step = 1 / 128;
  const creepRate = 2 + 6 * (1 - stiffness);
  for (const node of nodes) {
    position.set([node.x, node.y, node.z], node.index * 3);
  }

  times[0] = schedule.times[0];
  const result = solveLoads(graph, diameter, stiffness, factor, (frame, active, laidAt, elapsed, failure, sag, loading) => {
    let falling = false;
    for (let i = 0; i < active; i++) {
      const node = nodes[i];
      const p = 3 * i;
      const laid = depositedVolume(node, ranges[node.run], active, laidAt);
      amount[i] += laid - laidVolumes[i];
      laidVolumes[i] = laid;
      const released = Boolean(failure[i] && failure[i] < frame);
      inverseMass[i] = released ? 1 / Math.max(0.04, amount[i]) : 0;
      falling ||= released;
      const age = Math.max(0, schedule.times[frame] - node.time);
      localYield[i] = flowYield * clayRecovery(age);
      if (!failure[i]) {
        const wetTime = Math.min(elapsed, age);
        position[p + 2] += (1 - Math.exp(-wetTime * creepRate)) * (Math.max(0, node.z - sag[i]) - position[p + 2]);
        if (node.ground || node.contacts.length) {
          const spread = clamp(loading[i] - 0.26, 0, 1) * (0.27 - 0.16 * stiffness);
          flatten[i] += Math.max(0, spread - flatten[i]) * (1 - Math.exp(-wetTime * creepRate * 0.4));
        }
      }
    }

    const iterations = falling ? Math.ceil(elapsed / step) : Math.min(4, Math.ceil(elapsed / 0.03));
    const delta = iterations ? Math.min(falling ? step : 0.12, elapsed / iterations) : 0;
    const drag = Math.exp(-delta * 3.4);
    const pressureDecay = Math.exp(-delta * 9);
    const flattenRate = 1 - Math.exp(-delta * (6.4 - 2.9 * stiffness));
    for (let iteration = 0; iteration < iterations; iteration++) {
        // Yielded strands retain some stretch after the load is removed.
      if (falling) {
        for (let i = 0; i < active; i++) {
          if (!inverseMass[i]) continue;
          const p = i * 3;
          previousX[i] = position[p];
          previousY[i] = position[p + 1];
          previousZ[i] = position[p + 2];
          position[p] += velocity[p] * drag * delta;
          position[p + 1] += velocity[p + 1] * drag * delta;
          position[p + 2] += (velocity[p + 2] * drag - 9810 * delta) * delta;
        }
        filament.stretch(position, inverseMass, laidAt, delta, tears, frame);
        filament.sectionLengths(position, failure, laidAt);
        contacts.rebuild(active, inverseMass, amount, flatten, iteration > 0);
        for (let i = 0; i < active; i++) {
          if (!inverseMass[i]) continue;
          const p = i * 3;
          velocity[p] = (position[p] - previousX[i]) / delta;
          velocity[p + 1] = (position[p + 1] - previousY[i]) / delta;
          velocity[p + 2] = (position[p + 2] - previousZ[i]) / delta;
          const speed = contacts.settle(i);
          // Estimate the stopping stress from kinetic energy over the first
          // portion of bead compression. Plastic flattening continues after contact.
          impact[i] = Math.max(impact[i], 5.8 * density * (speed / 1000) ** 2);
          const spread = clamp((impact[i] / localYield[i] - 0.24) * 0.33, 0, 0.64);
          flatten[i] += Math.max(0, spread - flatten[i]) * flattenRate;
        }
      }

      // Pressure differences drive shear-thinning flow through wet connections.
      // Each transfer removes exactly the volume added at its other end.
      exchange.fill(0);
      for (let i = 0; i < active; i++) {
        const node = nodes[i];
        const area = laidVolumes[i] ? amount[i] / laidVolumes[i] * filament.areaRatio(i) : 0;
        level[i] = position[3 * i + 2] + 0.5 * node.height * Math.sqrt(area) * (1 - flatten[i]);
        pressure[i] = impact[i] + (failure[i] ? 0 : 0.52 * loading[i] * localYield[i]);
        impact[i] *= pressureDecay;
      }
      for (const { a, b, length, strand, torn, laidAt: birth } of filament.links) {
        if (torn || birth > laidAt || !strand || !laidVolumes[a] || !laidVolumes[b]) continue;
        const gradient = (weightGradient * (level[a] - level[b]) + pressure[a] - pressure[b]) / Math.max(length, diameter * 0.45);
        const shear = gradient * diameter * 0.47;
        const yieldLimit = 0.43 * (localYield[a] + localYield[b]) / 2;
        const yielded = Math.max(0, Math.abs(shear) / yieldLimit - 1);
        if (yielded === 0) continue;
        const donor = shear > 0 ? a : b;
        const receiver = shear > 0 ? b : a;
        const transfer = Math.max(0, Math.min(
          laidVolumes[donor] * delta * creepRate * 0.7 * yielded ** (1 / 0.6),
          (amount[donor] - 0.24 * laidVolumes[donor]) * 0.25,
          (1.92 * laidVolumes[receiver] - amount[receiver]) * 0.25,
        ));
        exchange[donor] -= transfer;
        exchange[receiver] += transfer;
      }
      for (let i = 0; i < active; i++) amount[i] += exchange[i];
    }
    if (frame < schedule.buildFrames && frame % stride) return;
    if (falling) filament.sectionLengths(position, failure, laidAt, true);
    const replayFrame = frame < schedule.buildFrames ? frame / stride : frame - skipped;
    times[replayFrame] = schedule.times[frame];
    for (let i = 0; i < active; i++) {
      const node = nodes[i];
      const p = i * 3;
      const base = (replayFrame * count + i) * 4;
      trajectory[base] = position[p] - node.x;
      trajectory[base + 1] = position[p + 2] - node.z;
      trajectory[base + 2] = node.y - position[p + 1];
      trajectory[base + 3] = 1;
      const section = (replayFrame * count + i) * 4;
      const area = laidVolumes[i] ? amount[i] / laidVolumes[i] * filament.areaRatio(i) : 1;
      sections[section] = Math.round(127 * clamp(area, 0.05, 2));
      sections[section + 1] = Math.round(255 * (1 - flatten[i]));
      if (falling) filament.writeDirection(i, sections, section + 2);
    }
  });
  for (let i = 0; i < count; i++) {
    if (result.failure[i]) result.failure[i] -= skipped;
    if (tears[i]) tears[i] -= skipped;
  }
  return { ...result, trajectory, sections, tears, times, frames, buildFrames: earlier, firstFailure: result.firstFailure - skipped };
}

function pickHotspots(nodes, votes, cases, diameter) {
  const order = nodes.map((node, i) => i).filter(i => votes[i]);
  const failedCase = nodes.map((node, i) => cases.find(result => result.failure[i]));
  order.sort((a, b) => votes[b] - votes[a] || failedCase[b].peak[b] - failedCase[a].peak[a] || nodes[a].z - nodes[b].z);
  const hotspots = [];
  for (const i of order) {
    const { x, y, z } = nodes[i];
    if (hotspots.some(spot => Math.hypot(spot.x - x, spot.y - y, spot.z - z) < diameter * 3)) continue;
    hotspots.push({ x, y, z, cases: votes[i], cause: failedCase[i].cause[i] });
    if (hotspots.length === 4) break;
  }
  return hotspots;
}

export function simulateVic(runs, { diameter, stiffness, gravity }) {
  const votes = new Uint8Array(runs.reduce((sum, run) => sum + run.points.length, 0));
  if (!gravity || !votes.length) return { votes, hotspots: [], totalCases: strengths.length, gravity: false };
  const graph = buildGraph(runs, diameter, stiffness);
  const { nodes } = graph;
  const cases = strengths.map(factor => solveLoads(graph, diameter, stiffness, factor));
  cases.forEach(({ failure }) => failure.forEach((when, i) => { if (when) votes[i]++; }));
  const nominal = strengths.indexOf(1);
  let chosen = nominal;
  if (!cases[nominal].failure.some(Boolean)) {
    while (chosen > 0 && !cases[chosen].failure.some(Boolean)) chosen--;
    if (!cases[chosen].failure.some(Boolean)) chosen = nominal;
  }
  const demo = captureMotion(graph, diameter, stiffness, strengths[chosen], cases[chosen]);
  const hotspots = pickHotspots(nodes, votes, cases, diameter);
  const failed = demo.failure.reduce((sum, when) => sum + Boolean(when), 0);
  return {
    votes, hotspots, totalCases: strengths.length, frames: demo.frames, buildFrames: demo.buildFrames, gravity,
    times: demo.times, stopped: demo.stopped, deposited: demo.deposited, trajectory: demo.trajectory, sections: demo.sections,
    centers: Float32Array.from(nodes.flatMap(node => [node.x, node.z, -node.y])),
    tangents: Float32Array.from(nodes.flatMap(node => node.tangent)),
    failure: demo.failure, tears: demo.tears,
    firstFailure: demo.firstFailure, strength: strengths[chosen], held: 1 - failed / demo.deposited,
  };
}
