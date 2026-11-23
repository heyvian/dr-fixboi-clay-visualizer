import { MeshPhysicalMaterial } from 'three';
import { surfaceBumpShader } from './surface-bump.js';

const canvasSurface = `
varying vec2 vCanvasPosition;

float canvasHash(vec2 point) {
  vec3 seed = fract(point.xyx * vec3(0.1031, 0.1030, 0.0973));
  seed += dot(seed, seed.yzx + 33.33);
  return fract((seed.x + seed.y) * seed.z);
}

float canvasNoise(vec2 point) {
  vec2 cell = floor(point);
  vec2 blend = smoothstep(vec2(0.0), vec2(1.0), fract(point));
  return mix(
    mix(canvasHash(cell), canvasHash(cell + vec2(1, 0)), blend.x),
    mix(canvasHash(cell + vec2(0, 1)), canvasHash(cell + vec2(1, 1)), blend.x),
    blend.y
  );
}

float resolveCanvasDetail(vec2 point) {
  float footprint = max(length(dFdx(point)), length(dFdy(point)));
  return 1.0 - smoothstep(0.24, 0.8, footprint);
}
`;

const canvasMaps = `
#include <color_fragment>
vec2 clothPoint = vCanvasPosition;
float dye = canvasNoise(clothPoint * 0.036);
float cotton = canvasNoise(clothPoint * 0.16 + 13.0);
vec2 drift = vec2(canvasNoise(clothPoint * 0.11), canvasNoise(clothPoint * 0.09 + 34.0)) - 0.5;
vec2 threads = clothPoint / 1.07 + 0.46 * drift;
vec2 strand = floor(threads);
vec2 ridge = pow(sin(fract(threads) * 3.14159265), vec2(1.4));
float warp = ridge.x * (0.71 + 0.22 * sin(3.14159265 * (threads.y + strand.x)));
float weft = ridge.y * (0.71 - 0.22 * sin(3.14159265 * (threads.x + strand.y)));
float weave = max(warp, weft);
float yarnTone = mix(canvasHash(vec2(strand.x, 12.0)), canvasHash(vec2(-24.0, strand.y)), step(warp, weft));
float detail = resolveCanvasDetail(threads);
vec2 napPoint = clothPoint * 4.0;
float nap = (canvasNoise(napPoint) - 0.5) * resolveCanvasDetail(napPoint);
float canvasHeight = 0.17 * (weave - 0.5) * detail + 0.032 * nap + 0.16 * cotton;
float surfaceRoughness = 0.06 * (cotton - 0.5) + 0.09 * (0.5 - weave) * detail;
float canvasTone = 0.91 + 0.12 * dye + 0.065 * cotton
  + detail * (0.075 * (yarnTone - 0.5) + 0.04 * (weave - 0.5));
#ifdef HIGH_SURFACE_DETAIL
  // Stretch grain along the top thread so the warp and weft have distinct fiber normals.
  vec2 warpFiber = vec2(threads.x * 6.3 + 0.7 * threads.y, threads.y * 0.78);
  vec2 weftFiber = vec2(threads.y * 6.3 - 0.7 * threads.x, threads.x * 0.78);
  float warpNap = (canvasNoise(warpFiber) - 0.5) * resolveCanvasDetail(warpFiber);
  float weftNap = (canvasNoise(weftFiber) - 0.5) * resolveCanvasDetail(weftFiber);
  float fibers = mix(warpNap, weftNap, smoothstep(-0.05, 0.05, weft - warp));
  float yarnSlub = (canvasNoise(threads * 0.39 + 21.0) - 0.5) * detail;
  canvasHeight += 0.058 * fibers + 0.048 * yarnSlub;
  surfaceRoughness += 0.15 * fibers + 0.05 * yarnSlub;
  canvasTone += 0.085 * fibers + 0.04 * yarnSlub;
#endif
diffuseColor.rgb *= canvasTone;
`;

export function createCanvasMaterial(high) {
  const material = new MeshPhysicalMaterial({
    color: '#a89b86',
    roughness: 0.94,
    metalness: 0,
    ior: 1.46,
    sheen: 0.25,
    sheenColor: '#c8bba4',
    sheenRoughness: 0.94,
  });
  if (high) material.defines.HIGH_SURFACE_DETAIL = 1;

  // Use world-space millimeters so every yarn can vary without a repeated texture tile.
  material.onBeforeCompile = shader => {
    shader.vertexShader = `varying vec2 vCanvasPosition;\n` + shader.vertexShader.replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\nvCanvasPosition = (modelMatrix * vec4(position, 1.0)).xz;',
    );
    shader.fragmentShader = canvasSurface + surfaceBumpShader + shader.fragmentShader
      .replace('#include <color_fragment>', canvasMaps)
      .replace('#include <roughnessmap_fragment>', `
        #include <roughnessmap_fragment>
        roughnessFactor = clamp(roughnessFactor + surfaceRoughness, 0.8, 1.0);
      `)
      .replace('#include <normal_fragment_maps>', `
        #include <normal_fragment_maps>
        normal = surfaceBumpNormal(-vViewPosition, normal, canvasHeight, faceDirection);
      `);
  };

  return material;
}
