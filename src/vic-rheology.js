// Characteristic properties for fresh extruded clay. These are preset inputs
// to an experimental model. See the rheology references in the README.
export function vicMaterial(stiffness, factor = 1) {
  return {
    yieldStress: (610 + 6100 * stiffness ** 2.15) * factor,
    modulus: (6500 + 110000 * stiffness ** 2) * factor,
    consistency: (360 + 1800 * stiffness ** 2) * factor,
    flowIndex: 0.6,
  };
}

export function clayRecovery(age) {
  return 1 + 0.62 * (1 - Math.exp(-Math.max(0, age) / 36));
}

// Inverse Herschel–Bulkley law. Stress is in Pa and the result is in s⁻¹.
export function postYieldRate(stress, yieldStress, consistency, flowIndex) {
  const excess = Math.max(0, stress - yieldStress);
  return (excess / consistency) ** (1 / flowIndex);
}
