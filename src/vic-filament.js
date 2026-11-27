// Short, volume-weighted links between sections of the extruded filament.
// Intact sections can anchor a yielded strand until its wet neck gives way.
export function createVicFilament(nodes, ranges, stiffness) {
  const links = [];
  const neighbors = nodes.map(() => []);
  const originalLengths = new Float32Array(nodes.length);
  const stretchedLengths = new Float32Array(nodes.length);
  const directions = new Float32Array(nodes.length * 3);
  const creep = 4.2 - 3.5 * stiffness;
  const elasticTime = 0.036 - 0.018 * stiffness;
  const extensionLimit = 1.72 - 0.95 * stiffness;

  function join(a, b, strand, laidAt, coverage) {
    const from = nodes[a];
    const to = nodes[b];
    const length = Math.hypot(from.x - to.x, from.y - to.y, from.z - to.z);
    if (length < 0.0001) return;
    neighbors[a].push(links.length);
    neighbors[b].push(links.length);
    links.push({ a, b, strand, laidAt, length, rest: length, damage: 0, torn: false,
      limit: strand ? extensionLimit : 0.12 + coverage * 0.20 });
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

  function stretch(position, inverseMass, laidAt, elapsed, tears, frame, movingLinks) {
    const relaxation = 1 - Math.exp(-elapsed / elasticTime);
    for (let pass = 0; pass < 2; pass++) {
      for (const link of movingLinks) {
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
          const strain = distance / length - 1;
          link.damage += elapsed * 9 * Math.max(0, strain / limit - 0.48) ** 1.55;
          if (strain > limit || link.damage >= 1) {
            link.torn = true;
            if (strand) tears[a] = frame;
            continue;
          }
          // Stress above the elastic range draws the wet strand permanently longer.
          const plasticStrain = Math.max(0, distance / link.rest - 1 - (0.06 + stiffness * 0.11));
          if (strand) link.rest += elapsed * creep * link.rest * plasticStrain ** 1.35;
        }
        const extension = distance - link.rest;
        const compression = strand ? Math.min(0, distance - 0.71 * link.rest) : 0;
        const correction = (Math.max(0, extension) + 0.48 * compression) * relaxation / (distance * movable);
        const moveA = inverseMass[a] * correction;
        const moveB = inverseMass[b] * correction;
        position[i] += dx * moveA;
        position[i + 1] += dy * moveA;
        position[i + 2] += dz * moveA;
        position[j] -= dx * moveB;
        position[j + 1] -= dy * moveB;
        position[j + 2] -= dz * moveB;
      }
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
    return stretchedLengths[i] ? originalLengths[i] / stretchedLengths[i] : 1;
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
