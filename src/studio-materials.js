import { surfaceBumpShader } from './surface-bump.js';

export const studioNoise = `
float studioHash(vec2 cell) {
  vec3 seed = fract(cell.xyx * vec3(0.1031, 0.11369, 0.13787));
  seed += dot(seed, seed.yzx + 19.19);
  return fract((seed.x + seed.y) * seed.z);
}

float studioNoise(vec2 point) {
  vec2 cell = floor(point);
  vec2 weight = smoothstep(vec2(0.0), vec2(1.0), fract(point));
  return mix(
    mix(studioHash(cell), studioHash(cell + vec2(1, 0)), weight.x),
    mix(studioHash(cell + vec2(0, 1)), studioHash(cell + vec2(1, 1)), weight.x),
    weight.y
  );
}

float visibleDetail(vec2 point) {
  float footprint = max(length(dFdx(point)), length(dFdy(point)));
  return 1.0 - smoothstep(0.3, 0.9, footprint);
}
`;

export function setStudioSurface(material, name, declarations, chunks, uniforms = {}) {
  const coordinates = 'varying vec3 vPropPosition;\n';
  material.customProgramCacheKey = () => name;
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = coordinates + shader.vertexShader.replace(
      '#include <begin_vertex>', '#include <begin_vertex>\nvPropPosition = position;',
    );
    shader.fragmentShader = coordinates + declarations + shader.fragmentShader;
    for (const [chunk, instructions] of Object.entries(chunks)) {
      const tag = '#include <' + chunk + '>';
      shader.fragmentShader = shader.fragmentShader.replace(tag, tag + '\n' + instructions);
    }
    if (chunks.normal_fragment_maps) shader.fragmentShader = surfaceBumpShader + shader.fragmentShader;
  };
}
