import { Color, DoubleSide, MeshPhysicalMaterial } from 'three';

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

vec3 clayBump(vec3 surface, vec3 surfaceNormal, float elevation, float facing) {
  vec3 tangentX = dFdx(surface);
  vec3 tangentY = dFdy(surface);
  vec3 acrossX = cross(tangentY, surfaceNormal);
  vec3 acrossY = cross(surfaceNormal, tangentX);
  float orientation = dot(tangentX, acrossX) * facing;
  vec3 gradient = sign(orientation) * (dFdx(elevation) * acrossX + dFdy(elevation) * acrossY);
  return normalize(max(abs(orientation), 0.00000001) * surfaceNormal - gradient);
}
`;

const applyClayColor = `
#include <color_fragment>
vec3 grainPoint = vClayPosition * 1.8;
float grain = (clayNoise(grainPoint) - 0.5) * clayDetailVisibility(grainPoint);
float variation = clayNoise(vClayPosition * 0.12) - 0.5;
vec3 fleckPoint = vClayPosition * 1.15;
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
diffuseColor.rgb *= 1.0 + uClayGrain * (variation * 2.0 + grain * 2.7);
diffuseColor.rgb = mix(diffuseColor.rgb, uFleckColor, fleck);
`;

export function createClayMaterial() {
  const material = new MeshPhysicalMaterial({ metalness: 0, ior: 1.48, side: DoubleSide });
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
    shader.fragmentShader = claySurface + shader.fragmentShader
      .replace('#include <color_fragment>', applyClayColor)
      .replace('#include <roughnessmap_fragment>', `
        #include <roughnessmap_fragment>
        roughnessFactor = clamp(roughnessFactor + grain * uClayGrain * 2.4, 0.35, 1.0);
      `)
      .replace('#include <normal_fragment_maps>', `
        #include <normal_fragment_maps>
        normal = clayBump(-vViewPosition, normal, uClayGrain * (grain + 0.22 * variation), faceDirection);
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
