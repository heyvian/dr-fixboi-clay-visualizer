import { clayRecovery, postYieldRate } from './vic-rheology.js';

// Solve axial deformation along each continuous deposited filament. Contact
// bonds between layers carry a strand until they release independently.
export function createVicFilament(nodes, ranges, diameter, stiffness, material) {
  const links = [];
  const neighbors = nodes.map(() => []);
  const originalLengths = new Float32Array(nodes.length);
  const stretchedLengths = new Float32Array(nodes.length);
  const endLengths = new Float32Array(nodes.length);
  const endStretch = new Float32Array(nodes.length);
  const directions = new Float32Array(nodes.length * 3);
  const tearSites = ranges.map(() => []);
  const perimeters = ranges.map(({ start, end, closed }) => {
    if (!closed) return Infinity;
    const a = nodes[start];
    const b = nodes[end - 1];
    return b.length + Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  });
  const candidates = [];
  const elasticTime = 0.012 - 0.006 * stiffness;
  const neckLimit = 0.32 + 0.15 * stiffness;
  const shortestFragment = diameter * 1.75;

  function join(a, b, strand, laidAt, coverage) {
    const from = nodes[a];
    const to = nodes[b];
    const length = Math.hypot(from.x - to.x, from.y - to.y, from.z - to.z);
    if (length < 0.0001) return;
    neighbors[a].push(links.length);
    neighbors[b].push(links.length);
    links.push({ a, b, strand, laidAt, length, rest: length, damage: 0, torn: false,
      limit: strand ? 0 : 0.11 + coverage * 0.23 });
  }

  for (const { start, end, closed, endTime } of ranges) {
    for (let i = start; i < end - 1; i++) join(i, i + 1, true, nodes[i + 1].time);
    if (closed) join(end - 1, start, true, endTime);
  }
  for (const node of nodes) {
    const contact = node.contacts[0];
    if (contact) join(node.index, contact.index, false, node.time, contact.coverage);
  }

  function linksFor(movers) {
    const indices = new Set();
    for (const i of movers) for (const link of neighbors[i]) indices.add(link);
    return [...indices].sort((a, b) => a - b).map(i => links[i]);
  }

  function stretch(position, inverseMass, laidAt, clock, elapsed, tears, frame, movingLinks) {
    const relaxation = 1 - Math.exp(-elapsed / elasticTime);
    candidates.length = 0;
    for (let pass = 0; pass < 4; pass++) {
      const reverse = pass % 2;
      for (let offset = 0; offset < movingLinks.length; offset++) {
        const link = movingLinks[reverse ? movingLinks.length - 1 - offset : offset];
        const { a, b, strand, laidAt: birth, length, limit } = link;
        const movable = inverseMass[a] + inverseMass[b];
        if (link.torn || birth > laidAt || !movable) continue;
        const i = a * 3;
        const j = b * 3;
        const dx = position[j] - position[i];
        const dy = position[j + 1] - position[i + 1];
        const dz = position[j + 2] - position[i + 2];
        const distance = Math.hypot(dx, dy, dz);
        if (distance < 0.0001) continue;
        if (pass === 0) {
          if (strand) {
            const recovery = clayRecovery(clock - birth);
            const tensileStress = material.modulus * recovery * Math.max(0, distance / link.rest - 1);
            const rate = postYieldRate(tensileStress, 1.45 * material.yieldStress * recovery,
              2.8 * material.consistency * recovery, material.flowIndex);
            link.rest = Math.min(3.2 * length, link.rest * (1 + elapsed * Math.min(7, rate)));
          } else {
            const strain = distance / length - 1;
            link.damage += elapsed * 8 * Math.max(0, strain / limit - 0.45) ** 1.45;
            if (strain > limit || link.damage >= 1) {
              link.torn = true;
              continue;
            }
          }
        }
        const extension = distance - link.rest;
        const compression = strand ? Math.min(0, distance - 0.76 * link.rest) : 0;
        const correction = (Math.max(0, extension) + 0.48 * compression) * relaxation / (distance * movable);
        const moveA = inverseMass[a] * correction;
        const moveB = inverseMass[b] * correction;
        position[i] += dx * moveA;
        position[i + 1] += dy * moveA;
        position[i + 2] += dz * moveA;
        position[j] -= dx * moveB;
        position[j + 1] -= dy * moveB;
        position[j + 2] -= dz * moveB;
        if (pass === 3 && strand) {
          // Estimate the local area from conserved volume and the stretched length.
          // Take the measurement after the strand has shared the applied tension.
          const deformed = Math.max(link.rest, distance - Math.max(0, extension) * relaxation);
          const neck = length / deformed;
          if (neck < neckLimit + 0.11) {
            link.damage += elapsed * (2 + 40 * ((neckLimit + 0.11 - neck) / 0.23) ** 2);
            if (neck <= neckLimit && link.damage >= 0.54) candidates.push({ link, neck });
          } else link.damage = Math.max(0, link.damage - elapsed * 0.45);
        }
      }
    }

    // Let tension concentrate at one neck over a physical distance. Sample
    // spacing does not set the size of the pieces that come apart.
    candidates.sort((a, b) => a.neck - b.neck);
    for (const { link, neck } of candidates) {
      const { a, b, length } = link;
      const node = nodes[a];
      const location = node.length + length / 2;
      const loop = perimeters[node.run];
      if (tearSites[node.run].some(site => {
        const gap = Math.abs(site - location);
        return Math.min(gap, loop - gap) < shortestFragment;
      })) continue;
      tearSites[node.run].push(location);
      link.torn = true;
      tears[a] = frame;
      endLengths[a] += length / 2;
      endLengths[b] += length / 2;
      endStretch[a] += length / (2 * neck);
      endStretch[b] += length / (2 * neck);
    }
  }

  function sectionLengths(position, failure, laidAt, captureDirections = false, measuredLinks = links) {
    originalLengths.fill(0);
    stretchedLengths.fill(0);
    if (captureDirections) directions.fill(0);
    for (const { a, b, strand, length, laidAt: birth, torn } of measuredLinks) {
      const yielded = failure[a] || failure[b];
      if (!strand || torn || birth > laidAt || (!captureDirections && !yielded)) continue;
      const i = a * 3;
      const j = b * 3;
      const dx = position[j] - position[i];
      const dy = position[j + 1] - position[i + 1];
      const dz = position[j + 2] - position[i + 2];
      const distance = Math.hypot(dx, dy, dz);
      if (captureDirections && distance > 0.0001) {
        directions[i] += dx / distance;
        directions[i + 1] += dz / distance;
        directions[i + 2] -= dy / distance;
        directions[j] += dx / distance;
        directions[j + 1] += dz / distance;
        directions[j + 2] -= dy / distance;
      }
      if (!yielded) continue;
      const span = Math.max(length * 0.58, distance);
      originalLengths[a] += length;
      originalLengths[b] += length;
      stretchedLengths[a] += span;
      stretchedLengths[b] += span;
    }
  }

  function areaRatio(i) {
    const length = stretchedLengths[i] + endStretch[i];
    return length ? (originalLengths[i] + endLengths[i]) / length : 1;
  }

  // Encode the changed 3D tangent into two bytes for the replay texture.
  function writeDirection(i, data, offset) {
    const index = 3 * i;
    const x = directions[index];
    const y = directions[index + 1];
    const z = directions[index + 2];
    const length = Math.hypot(x, y, z);
    const [tx, ty, tz] = nodes[i].tangent;
    if (length < 0.0001 || x * tx + y * ty + z * tz >= 0.9995 * length) return;
    const sum = Math.abs(x) + Math.abs(y) + Math.abs(z);
    const u = z >= 0 ? x / sum : (1 - Math.abs(y) / sum) * (x < 0 ? -1 : 1);
    const v = z >= 0 ? y / sum : (1 - Math.abs(x) / sum) * (y < 0 ? -1 : 1);
    data[offset] = Math.round(128 + 127 * u);
    data[offset + 1] = Math.round(128 + 127 * v);
  }

  return { links, linksFor, stretch, sectionLengths, areaRatio, writeDirection };
}
