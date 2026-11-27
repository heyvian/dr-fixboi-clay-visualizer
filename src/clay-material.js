import { Color, DoubleSide, MeshPhysicalMaterial } from 'three';
import { surfaceBumpShader } from './surface-bump.js';

export const clayFrequencies = { grain: 1.8, variation: 0.12, fleck: 1.15, aggregate: 0.52, pores: 5.4, grit: 10.8 };

const claySurface = `
varying vec3 vClayPosition;
uniform float uClayGrain;
uniform float uFleckDensity;
uniform vec3 uFleckColor;

float clayHash(vec3 point) {
  point = fract(point * vec3(0.1031, 0.1099, 0.0973));
  point += dot(point, point.yzx + 33.33);
  return fract((point.x + point.y) * point.z);
}

float clayNoise(vec3 point) {
  vec3 cell = floor(point);
  vec3 blend = smoothstep(vec3(0.0), vec3(1.0), fract(point));
  return mix(
    mix(
      mix(clayHash(cell), clayHash(cell + vec3(1, 0, 0)), blend.x),
      mix(clayHash(cell + vec3(0, 1, 0)), clayHash(cell + vec3(1, 1, 0)), blend.x),
      blend.y
    ),
    mix(
      mix(clayHash(cell + vec3(0, 0, 1)), clayHash(cell + vec3(1, 0, 1)), blend.x),
      mix(clayHash(cell + vec3(0, 1, 1)), clayHash(cell + vec3(1, 1, 1)), blend.x),
      blend.y
    ),
    blend.z
  );
}

float clayDetailVisibility(vec3 point) {
  float footprint = max(length(dFdx(point)), length(dFdy(point)));
  return 1.0 - smoothstep(0.35, 1.15, footprint);
}

`;

const applyClayColor = `
#include <color_fragment>
vec3 grainPoint = vClayPosition * ${clayFrequencies.grain};
float grain = (clayNoise(grainPoint) - 0.5) * clayDetailVisibility(grainPoint);
float variation = clayNoise(vClayPosition * ${clayFrequencies.variation}) - 0.5;
vec3 fleckPoint = vClayPosition * ${clayFrequencies.fleck};
vec3 fleckCell = floor(fleckPoint);
float occupied = step(1.0 - uFleckDensity, clayHash(fleckCell + 19.0));
vec3 fleckCenter = 0.26 + 0.48 * vec3(
  clayHash(fleckCell + 1.0),
  clayHash(fleckCell + 2.0),
  clayHash(fleckCell + 3.0)
);
float fleckRadius = mix(0.13, 0.26, clayHash(fleckCell + 7.0));
float fleck = occupied * (1.0 - smoothstep(fleckRadius - 0.065, fleckRadius, length(fract(fleckPoint) - fleckCenter)));
fleck *= clayDetailVisibility(fleckPoint);
float bump = grain + 0.22 * variation;
float surfaceRoughness = grain * 2.4;
float clayTone = variation * 2.0 + grain * 2.7;
#ifdef HIGH_SURFACE_DETAIL
  vec3 aggregatePoint = vClayPosition * ${clayFrequencies.aggregate};
  float aggregate = clayNoise(aggregatePoint) - 0.5;
  vec3 porePoint = vClayPosition * ${clayFrequencies.pores};
  float pores = smoothstep(0.12, 0.32, clayNoise(porePoint)) - 1.0;
  pores *= clayDetailVisibility(porePoint);
  vec3 gritPoint = vClayPosition * ${clayFrequencies.grit};
  float grit = (clayNoise(gritPoint) - 0.5) * clayDetailVisibility(gritPoint);
  bump += 0.28 * aggregate + 0.32 * pores + 0.11 * grit;
  surfaceRoughness += 0.80 * aggregate - 0.70 * pores + 0.35 * grit;
  clayTone += 0.80 * aggregate + 0.82 * pores + 0.36 * grit;
#endif
diffuseColor.rgb *= 1.0 + uClayGrain * clayTone;
diffuseColor.rgb = mix(diffuseColor.rgb, uFleckColor, fleck);
`;

export function createClayMaterial(high) {
  const material = new MeshPhysicalMaterial({ metalness: 0, ior: 1.48, side: DoubleSide });
  if (high) material.defines.HIGH_SURFACE_DETAIL = 1;
  const uniforms = {
    uClayGrain: { value: 0 },
    uFleckDensity: { value: 0 },
    uFleckColor: { value: new Color() },
  };

  // Sample in model coordinates so grain remains at the same scale on every bead.
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = `varying vec3 vClayPosition;\n` + shader.vertexShader.replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\nvClayPosition = position;',
    );
    shader.fragmentShader = claySurface + surfaceBumpShader + shader.fragmentShader
      .replace('#include <color_fragment>', applyClayColor)
      .replace('#include <roughnessmap_fragment>', `
        #include <roughnessmap_fragment>
        roughnessFactor = clamp(roughnessFactor + surfaceRoughness * uClayGrain, 0.35, 1.0);
      `)
      .replace('#include <normal_fragment_maps>', `
        #include <normal_fragment_maps>
        normal = surfaceBumpNormal(-vViewPosition, normal, uClayGrain * bump, faceDirection);
      `);
  };

  function update(finish) {
    material.color.set(finish.color);
    material.roughness = finish.roughness;
    uniforms.uClayGrain.value = finish.grain;
    uniforms.uFleckDensity.value = finish.density ?? 0;
    uniforms.uFleckColor.value.set(finish.fleck ?? finish.color);
  }

  return { material, update };
}
