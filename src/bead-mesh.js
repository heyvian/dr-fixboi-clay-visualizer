export function writeBeadStrip(indices, offset, ring, following, sides) {
  for (let j = 0; j < sides; j++) {
    const next = (j + 1) % sides;
    indices[offset++] = ring + j;
    indices[offset++] = ring + next;
    indices[offset++] = following + j;
    indices[offset++] = ring + next;
    indices[offset++] = following + next;
    indices[offset++] = following + j;
  }
  return offset;
}

export function writeRingCap(indices, offset, ring, sides, reverse) {
  for (let j = 1; j < sides - 1; j++) {
    indices[offset++] = ring;
    indices[offset++] = ring + (reverse ? j + 1 : j);
    indices[offset++] = ring + (reverse ? j : j + 1);
  }
  return offset;
}

export function tearTipCenter(positions, ring, sides, tangents, node, diameter, reverse) {
  const center = [0, 0, 0];
  const reach = diameter * (reverse ? -0.24 : 0.24);
  for (let axis = 0; axis < 3; axis++) {
    for (let j = 0; j < sides; j++) center[axis] += positions[(ring + j) * 3 + axis];
    center[axis] = center[axis] / sides + tangents[node * 3 + axis] * reach;
  }
  return center;
}

export function writeTearCap(indices, offset, ring, sides, tip, reverse) {
  for (let j = 0; j < sides; j++) {
    const next = (j + 1) % sides;
    indices[offset++] = tip;
    indices[offset++] = ring + (reverse ? next : j);
    indices[offset++] = ring + (reverse ? j : next);
  }
  return offset;
}
