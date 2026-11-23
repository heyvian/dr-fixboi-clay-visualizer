const steps = 24;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

// A reduced Bingham-flow model along a deposited bead. Lengths are expressed
// in nozzle diameters. The slider sets relative yield stress and mobility.
export function solveBeadFlow(path, { diameter, buildHeight, softness, gaps, unsupportedLength, closed }) {
  const count = path.length;
  const edgeCount = closed ? count : count - 1;
  const edges = new Float64Array(count);
  const cellLength = new Float64Array(count);
  for (let i = 0; i < edgeCount; i++) {
    const j = (i + 1) % count;
    const a = path[i];
    const b = path[j];
    const length = Math.max(0.025, Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) / diameter);
    edges[i] = length;
    cellLength[i] += length / 2;
    cellLength[j] += length / 2;
  }

  const referenceHeight = new Float64Array(count);
  const availableDrop = new Float64Array(count);
  const weight = new Float64Array(count);
  const volume = cellLength.slice();
  const freeSurface = new Float64Array(count);
  const thickness = new Float64Array(count);
  const volumeChange = new Float64Array(count);
  let drop = new Float64Array(count);
  let nextDrop = new Float64Array(count);

  const footprintHeight = Math.max(buildHeight, diameter);
  const yieldStress = 0.045 + 0.62 * (1 - softness) ** 2;
  const mobility = 0.27 * softness ** 0.72;
  const beadHeight = 0.88 - 0.16 * softness;

  for (let i = 0; i < count; i++) {
    const z = path[i][2];
    const fraction = clamp(z / footprintHeight, 0, 1);
    referenceHeight[i] = z / diameter * (1 - softness * (0.15 - 0.07 * fraction));
    const reach = 1 - Math.exp(-unsupportedLength[i] / (2.2 * diameter));
    availableDrop[i] = Math.min(referenceHeight[i], gaps[i] * (0.34 + 2.15 * reach));
    weight[i] = gaps[i] ** 1.45;
  }

  for (let step = 0; step < steps; step++) {
    volumeChange.fill(0);
    for (let i = 0; i < count; i++) {
      const area = volume[i] / cellLength[i];
      thickness[i] = Math.sqrt(area);
      freeSurface[i] = referenceHeight[i] - drop[i] + beadHeight * thickness[i];
      if (availableDrop[i] === 0) continue;

      const before = i > 0 ? i - 1 : (closed ? count - 1 : i);
      const after = i < count - 1 ? i + 1 : (closed ? 0 : i);
      const cohesion = 0.4 * ((drop[before] + drop[after]) / 2 - drop[i]);
      const support = 0.86 * drop[i] / availableDrop[i];
      const load = weight[i] * area - support + cohesion;
      const strainRate = Math.sign(load) * Math.max(0, Math.abs(load) - yieldStress);
      nextDrop[i] = clamp(drop[i] + mobility * strainRate, 0, availableDrop[i]);
    }

    // Finite-volume flux. Each transfer adds and removes the same material.
    for (let i = 0; i < edgeCount; i++) {
      const j = (i + 1) % count;
      const slope = (freeSurface[i] - freeSurface[j]) / edges[i];
      const donor = slope >= 0 ? i : j;
      const receiver = slope >= 0 ? j : i;
      const stress = Math.abs(slope) * thickness[donor];
      if (stress <= yieldStress) continue;

      const plug = yieldStress / stress;
      const yielded = 1 - 1.5 * plug + 0.5 * plug ** 3;
      const flux = mobility * thickness[donor] ** 3 * Math.abs(slope) * yielded * 0.35;
      const transfer = Math.max(0, Math.min(
        flux,
        (volume[donor] - 0.68 * cellLength[donor]) * 0.18,
        (1.42 * cellLength[receiver] - volume[receiver]) * 0.18,
      ));
      volumeChange[donor] -= transfer;
      volumeChange[receiver] += transfer;
    }
    for (let i = 0; i < count; i++) volume[i] += volumeChange[i];
    [drop, nextDrop] = [nextDrop, drop];
  }

  return {
    elevation: referenceHeight.map((height, i) => diameter * (height - drop[i])),
    area: volume.map((total, i) => total / cellLength[i]),
  };
}
