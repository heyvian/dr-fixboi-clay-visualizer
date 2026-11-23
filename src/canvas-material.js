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

float canvasDiscoloration(vec2 point, float cotton) {
  vec2 grid = point / 76.0;
  vec2 cell = floor(grid);
  vec2 center = 0.25 + 0.5 * vec2(canvasHash(cell + 7.0), canvasHash(cell - 23.0));
  vec2 shape = (fract(grid) - center) * vec2(6.6, 10.5);
  float edge = length(shape) + (cotton - 0.5) * 0.45;
  float pigment = smoothstep(0.19, 0.91, canvasHash(cell + vec2(7.0, -19.0)));
  return pigment * (1.0 - smoothstep(0.07, 1.0, edge));
}

// Each worn spot has a shallow groove and a raised fringe of exposed yarn.
vec2 canvasAbrasion(vec2 point) {
  vec2 grid = (point + vec2(32.0, 17.0)) / 86.0;
  vec2 cell = floor(grid);
  float seed = canvasHash(cell - 29.0);
  vec2 center = 0.15 + 0.7 * vec2(canvasHash(cell + 13.0), canvasHash(cell - 47.0));
  vec2 offset = (fract(grid) - center) * 86.0;
  float angle = 6.2831853 * canvasHash(cell + 37.0);
  vec2 direction = vec2(cos(angle), sin(angle));
  float along = dot(offset, direction);
  float across = dot(offset, vec2(-direction.y, direction.x));
  float reach = mix(1.3, 3.6, canvasHash(cell + 83.0));
  float taper = 1.0 - smoothstep(reach * 0.35, reach, abs(along));
  float width = 0.15 + 0.14 * taper;
  float distanceToGroove = abs(across - 0.20 * sin(along * 1.9) * taper);
  float footprint = max(length(dFdx(point)), length(dFdy(point)));
  float blur = max(0.06, footprint * 0.4);
  float groove = 1.0 - smoothstep(width * 0.3, width + blur, distanceToGroove);
  float fringe = 1.0 - smoothstep(0.08, 0.22 + blur, abs(distanceToGroove - width));
  float fibers = 0.62 + 0.38 * sin(along * 5.4 + seed * 9.0);
  float wear = step(0.36, seed) * taper * (1.0 - smoothstep(0.52, 1.45, footprint));
  return wear * vec2(groove, fringe * fibers);
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
float pigment = canvasDiscoloration(clothPoint, cotton);
vec2 abrasion = canvasAbrasion(clothPoint);
canvasHeight += 0.085 * abrasion.y - 0.11 * abrasion.x;
surfaceRoughness += 0.025 * pigment + 0.07 * (abrasion.x + abrasion.y);
canvasTone += 0.10 * abrasion.y - 0.11 * abrasion.x;
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
diffuseColor.rgb *= canvasTone * (1.0 - pigment * vec3(0.05, 0.075, 0.10));
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
