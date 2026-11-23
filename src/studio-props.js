import {
  CatmullRomCurve3, CylinderGeometry, Group, LatheGeometry, Mesh, MeshPhysicalMaterial,
  TubeGeometry, Vector2, Vector3,
} from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { surfaceBumpShader } from './surface-bump.js';

const materialCoordinates = `varying vec3 vPropPosition;\n`;

function setSurface(material, name, functions, color, bump = '') {
  material.customProgramCacheKey = () => name;
  material.onBeforeCompile = shader => {
    shader.vertexShader = materialCoordinates + shader.vertexShader.replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\nvPropPosition = position;',
    );
    shader.fragmentShader = materialCoordinates + functions + shader.fragmentShader.replace(
      '#include <color_fragment>', '#include <color_fragment>\n' + color,
    );
    if (bump) {
      shader.fragmentShader = surfaceBumpShader + shader.fragmentShader.replace(
        '#include <normal_fragment_maps>',
        '#include <normal_fragment_maps>\n' + bump,
      );
    }
  };
}

function createSponge() {
  const geometry = new RoundedBoxGeometry(106, 32, 72, 5, 9);
  const points = geometry.getAttribute('position');
  for (let i = 0; i < points.count; i++) {
    const x = points.getX(i);
    const y = points.getY(i);
    const z = points.getZ(i);
    const lift = (y + 16) / 32;
    const unevenness = Math.cos(x * 0.086) * Math.sin(z * 0.095);
    points.setXYZ(i, x * (0.97 + 0.03 * lift) + 1.1 * lift * unevenness,
      y + 1.5 * lift * unevenness, z + 0.9 * Math.sin(x * 0.08 + y * 0.14));
  }

  const material = new MeshPhysicalMaterial({ color: '#dfaa30', roughness: 0.92, sheen: 0.18, sheenColor: '#edc76c' });
  setSurface(material, 'sponge', `
    vec3 spongeHash(vec3 cell) {
      cell = fract(cell * vec3(0.1031, 0.11369, 0.13787));
      cell += dot(cell, cell.yzx + 19.19);
      return fract((cell.xxy + cell.yzz) * cell.zyx);
    }

    float spongePores(vec3 point) {
      vec3 cell = floor(point);
      vec3 within = fract(point);
      vec3 direction = step(vec3(0.5), within) * 2.0 - 1.0;
      float distanceToPore = 1.0;
      for (int i = 0; i < 8; i++) {
        vec3 neighbor = vec3(float(i & 1), float((i >> 1) & 1), float((i >> 2) & 1)) * direction;
        vec3 seed = spongeHash(cell + neighbor);
        vec3 offset = (within - neighbor - (0.26 + seed * 0.48)) * vec3(1.0, 0.84, 1.14);
        distanceToPore = min(distanceToPore, length(offset) / mix(0.34, 0.52, seed.y));
      }
      float footprint = max(length(dFdx(point)), length(dFdy(point)));
      return (1.0 - smoothstep(0.15, 1.0, distanceToPore)) * (1.0 - smoothstep(0.27, 0.88, footprint));
    }
  `, `
    float coarsePores = spongePores(vPropPosition / 4.1);
    float finePores = spongePores(vPropPosition / 1.45 + 8.5);
    float spongeBump = -0.82 * coarsePores - 0.19 * finePores;
    float damp = (1.0 - smoothstep(-16.0, -8.0, vPropPosition.y))
      * (0.54 + 0.46 * sin(vPropPosition.x * 0.11 + vPropPosition.z * 0.18));
    diffuseColor.rgb *= 1.03 - 0.59 * coarsePores - 0.20 * finePores - 0.11 * damp;
  `, 'normal = surfaceBumpNormal(-vViewPosition, normal, spongeBump, faceDirection);');

  const sponge = new Mesh(geometry, material);
  sponge.position.set(-23, 16, -29);
  sponge.rotation.y = -0.24;
  return sponge;
}

function createTrimmingLoop() {
  const tool = new Group();
  const wood = new MeshPhysicalMaterial({ color: '#a56434', roughness: 0.52, clearcoat: 0.12 });
  setSurface(wood, 'turned wood', '', `
    vec3 grain = vPropPosition * vec3(0.75, 0.035, 0.65);
    float layers = length(grain.xz - vec2(0.6, -1.2)) * 4.4
      + sin(grain.y + grain.x * 0.42) * 0.8 + sin(grain.z * 1.3) * 0.35;
    float rings = smoothstep(0.42, 0.94, sin(layers * 5.6));
    float grainDetail = 1.0 - smoothstep(0.7, 2.8, fwidth(layers));
    diffuseColor.rgb *= 0.96 + (0.16 * sin(layers * 0.9) - 0.19 * rings * grainDetail);
  `);
  const handleProfile = [
    [0, -51], [3.4, -51], [5.7, -49], [6.8, -45], [7.1, -38], [7.0, -27],
    [6.6, -15], [5.6, 1], [4.3, 18], [3.7, 34], [3.6, 46], [0, 46],
  ].map(([radius, axis]) => new Vector2(radius, axis));
  const handle = new Mesh(new LatheGeometry(handleProfile, 40), wood);
  handle.rotation.x = Math.PI / 2;
  handle.position.y = 7.1;
  tool.add(handle);

  const steel = new MeshPhysicalMaterial({ color: '#c1cad1', metalness: 0.91, roughness: 0.28 });
  for (const [top, bottom, length, z] of [[3.45, 3.8, 14, 48], [3.55, 3.55, 0.8, 54.6]]) {
    const ferrule = new Mesh(new CylinderGeometry(top, bottom, length, 24), steel);
    ferrule.rotation.x = Math.PI / 2;
    ferrule.position.set(0, 7.1, z);
    tool.add(ferrule);
  }

  const loopPath = new CatmullRomCurve3([
    [-1.4, 7.1, 53], [-5.8, 6.1, 62], [-9.0, 4.4, 74], [-4.8, 2.2, 85],
    [1, 1.5, 89], [8.5, 2.7, 80], [9.2, 4.5, 71], [5.0, 6.2, 62], [1.4, 7.1, 53],
  ].map(point => new Vector3(...point)));
  tool.add(new Mesh(new TubeGeometry(loopPath, 56, 0.95, 10), steel));
  tool.position.set(14, 0, 57);
  tool.rotation.y = 1.02;
  return tool;
}

export function createStudioProps() {
  const props = new Group();
  props.add(createSponge(), createTrimmingLoop());
  props.traverse(object => {
    if (object.isMesh) object.castShadow = object.receiveShadow = true;
  });
  return props;
}
