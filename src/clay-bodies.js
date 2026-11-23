export const clayBodies = {
  m340: {
    name: 'Plainsman M340 · buff stoneware',
    reference: 'https://www.plainsmanclays.com/product/m340/',
    dryingShrinkage: [6.0, 7.0],
    firingShrinkage: [5.5, 6.5],
    greenware: { color: '#8e8173', roughness: 0.8, grain: 0.055 },
    fired: { color: '#bd9b77', roughness: 0.73, grain: 0.037 },
  },
  m340s: {
    name: 'Plainsman M340S · speckled stoneware',
    reference: 'https://www.plainsmanclays.com/product/m340s/',
    dryingShrinkage: [7.0, 7.6],
    firingShrinkage: [4.3, 5.0],
    greenware: { color: '#77716d', roughness: 0.82, grain: 0.059, fleck: '#534740', density: 0.16 },
    fired: { color: '#c0a488', roughness: 0.71, grain: 0.043, fleck: '#483029', density: 0.39 },
  },
  m370: {
    name: 'Plainsman M370 · white stoneware',
    reference: 'https://www.plainsmanclays.com/product/m370-2/',
    dryingShrinkage: [5.5, 6.9],
    firingShrinkage: [6.0, 7.4],
    greenware: { color: '#aaa49a', roughness: 0.8, grain: 0.041 },
    fired: { color: '#dfd5c4', roughness: 0.69, grain: 0.029 },
  },
  m390: {
    name: 'Plainsman M390 · red stoneware',
    reference: 'https://www.plainsmanclays.com/product/m390/',
    dryingShrinkage: [6.4, 7.5],
    firingShrinkage: [4.8, 5.1],
    greenware: { color: '#976f5a', roughness: 0.8, grain: 0.044 },
    fired: { color: '#7a4434', roughness: 0.67, grain: 0.027 },
  },
  polarIce: {
    name: 'Plainsman Polar Ice · porcelain',
    reference: 'https://www.plainsmanclays.com/product/polarice/',
    dryingShrinkage: [5.5, 6.5],
    firingShrinkage: [9.5, 9.7],
    greenware: { color: '#c2beb6', roughness: 0.78, grain: 0.027 },
    fired: { color: '#eeeae2', roughness: 0.57, grain: 0.016 },
  },
};

export function firedScale({ dryingShrinkage, firingShrinkage }) {
  const remainingLength = ([low, high]) => 1 - (low + high) / 200;
  return remainingLength(dryingShrinkage) * remainingLength(firingShrinkage);
}
