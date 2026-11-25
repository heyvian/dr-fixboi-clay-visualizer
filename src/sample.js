const tau = Math.PI * 2;
const profile = [
  [0, 18.5], [0.08, 24], [0.23, 35], [0.39, 40], [0.51, 38.4],
  [0.63, 29.5], [0.75, 18], [0.85, 16.5], [0.92, 20], [1, 24],
];

function radiusAt(height) {
  const index = profile.findIndex(([fraction]) => fraction >= height);
  if (index <= 0) return profile[Math.max(0, index)][1];
  const [firstHeight, firstRadius] = profile[index - 1];
  const [lastHeight, lastRadius] = profile[index];
  const before = profile[Math.max(0, index - 2)];
  const after = profile[Math.min(profile.length - 1, index + 1)];
  const leftSlope = (lastRadius - before[1]) / (lastHeight - before[0]);
  const rightSlope = (after[1] - firstRadius) / (after[0] - firstHeight);
  const length = lastHeight - firstHeight;
  const t = (height - firstHeight) / length;
  const t2 = t * t;
  const t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * firstRadius + (t3 - 2 * t2 + t) * length * leftSlope
    + (-2 * t3 + 3 * t2) * lastRadius + (t3 - t2) * length * rightSlope;
}

export function makeSample() {
  const lines = ['; Dr. FixBoi®’s sample vase', 'G21', 'G90', 'M83', 'G0 X0 Y0 Z0', 'G1 F1200'];
  let previous = [0, 0, 0];
  const add = (radius, angle, height) => {
    const coordinates = [radius * Math.cos(angle), radius * Math.sin(angle), height].map(value => value.toFixed(3));
    const [x, y, z] = coordinates;
    const length = Math.hypot(...coordinates.map((value, axis) => Number(value) - previous[axis]));
    lines.push(`G1 X${x} Y${y} Z${z} E${(length * 0.09).toFixed(5)}`);
    previous = coordinates.map(Number);
  };
  const seedSteps = 7 * 86;
  for (let i = 1; i <= seedSteps; i++) add(18.5 * i / seedSteps, tau * i / 86, 0);
  const pointsPerTurn = 144;
  const turns = 62;
  for (let i = 1; i <= turns * pointsPerTurn; i++) {
    const height = i / (turns * pointsPerTurn);
    const angle = tau * i / pointsPerTurn;
    const fluting = (0.23 + 2.0 * Math.sin(Math.PI * height) ** 2) * Math.sin(11 * angle + height * 9);
    const ripple = 0.65 * Math.sin(angle * 3 - height * 4) * height;
    add(radiusAt(height) + fluting + ripple, angle, 95 * height);
  }
  lines.push('G0 Z110', 'M2', '');
  return lines.join('\n');
}

export function makeOverhangSample() {
  const lines = ['; VIC overhang sample', 'G21', 'G90', 'M83', 'G1 F1200'];
  for (let layer = 0; layer < 20; layer++) {
    const height = layer * 2.5;
    const offset = Math.min(layer, 8) * 0.3 + Math.max(0, layer - 8) * 4.5;
    for (let i = 0; i <= 18; i++) {
      const along = i / 18 * 2 - 1;
      const x = (offset + 9 * along ** 2).toFixed(3);
      const y = (along * 32).toFixed(3);
      lines.push(i ? `G1 X${x} Y${y} E0.4` : `G0 X${x} Y${y} Z${height}`);
    }
  }
  return lines.join('\n');
}
