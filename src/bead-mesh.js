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
