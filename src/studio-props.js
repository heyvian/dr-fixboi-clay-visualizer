import {
  Box3, BoxGeometry, CylinderGeometry, ExtrudeGeometry, Group, LatheGeometry, Mesh, MeshPhysicalMaterial,
  Path, Shape, Vector2, Vector3,
} from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { setStudioSurface, studioNoise } from './studio-materials.js';
import { createStudioRuler } from './studio-ruler.js';

function spongeGeometry() {
  const half = new Vector3(53, 16, 36);
  const radius = 8;
  const core = half.clone().addScalar(-radius);
  const box = new BoxGeometry(half.x * 2, half.y * 2, half.z * 2, 54, 18, 36);
  const points = box.getAttribute('position');
  const point = new Vector3();
  const center = new Vector3();
  const normal = new Vector3();
  for (let i = 0; i < points.count; i++) {
    point.fromBufferAttribute(points, i);
    center.set(
      Math.min(core.x, Math.max(-core.x, point.x)),
      Math.min(core.y, Math.max(-core.y, point.y)),
      Math.min(core.z, Math.max(-core.z, point.z)),
    );
    normal.subVectors(point, center).normalize();
    point.copy(center).addScaledVector(normal, radius);
    const { x, y, z } = point;
    const wrinkles = Math.cos(x * 0.21 + y * 0.37) * Math.sin(z * 0.31 - y * 0.28);
    const cornerChip = Math.exp(-(((x - 46) / 8) ** 2 + ((y - 13) / 8) ** 2 + ((z - 31) / 7) ** 2));
    const splitEdge = Math.exp(-(((x + 12) / 13) ** 2 + ((y - 8) / 3.2) ** 2 + ((z - 34) / 5) ** 2));
    const roundedWear = Math.exp(-(((x + 48) / 9) ** 2 + ((y - 9) / 10) ** 2 + ((z + 29) / 11) ** 2));
    const damage = (6.6 * cornerChip + 3.8 * splitEdge + 3.4 * roundedWear) * (1 + 0.22 * wrinkles);
    const grain = 0.43 * wrinkles + 0.23 * Math.sin(x * 1.3 - y * 0.77 + z * 0.66);
    point.addScaledVector(normal, grain - damage);
    points.setXYZ(i, point.x, Math.max(-half.y, point.y), point.z);
  }
  box.deleteAttribute('normal');
  box.deleteAttribute('uv');
  const geometry = mergeVertices(box, 0.001);
  box.dispose();
  geometry.computeVertexNormals();
  return geometry;
}

const spongePores = `
vec3 spongeHash(vec3 cell) {
  cell = fract(cell * vec3(0.1031, 0.11369, 0.13787));
  cell += dot(cell, cell.yzx + 19.19);
  return fract((cell.xxy + cell.yzz) * cell.zyx);
}

float measurePores(vec3 point) {
  vec3 cell = floor(point);
  vec3 within = fract(point);
  vec3 direction = step(vec3(0.5), within) * 2.0 - 1.0;
  float distanceToPore = 1.0;
  for (int i = 0; i < 8; i++) {
    vec3 neighbor = vec3(float(i & 1), float((i >> 1) & 1), float((i >> 2) & 1)) * direction;
    vec3 seed = spongeHash(cell + neighbor);
    vec3 offset = (within - neighbor - (0.24 + seed * 0.52)) * mix(vec3(0.88, 0.72, 1.0), vec3(1.13, 1.20, 1.28), seed);
    float bowl = length(offset) * (1.0 + 0.17 * sin(offset.x * 16.1 + offset.z * 13.7));
    distanceToPore = min(distanceToPore, bowl / mix(0.37, 0.68, seed.y));
  }
  float footprint = max(length(dFdx(point)), length(dFdy(point)));
  return (1.0 - smoothstep(0.13, 0.95, distanceToPore)) * (1.0 - smoothstep(0.29, 0.91, footprint));
}
`;

function createSponge() {
  const material = new MeshPhysicalMaterial({ color: '#e1ad38', roughness: 0.9, sheen: 0.19, sheenColor: '#e4c87d' });
  setStudioSurface(material, 'worn sponge', studioNoise + spongePores, {
    color_fragment: `
      vec3 foamPoint = vPropPosition + 0.53 * sin(vPropPosition.yzx * vec3(0.75, 0.59, 0.82));
      float coarsePores = measurePores(foamPoint / 3.85);
      float finePores = measurePores(foamPoint / 1.17 + 8.5);
      vec2 stainPoint = vPropPosition.xz + vec2(0.29, 0.67) * vPropPosition.y;
      float cloud = studioNoise(stainPoint * vec2(0.085, 0.113));
      float dust = studioNoise(stainPoint * vec2(0.58, 0.82) + 26.5);
      float stainedCorner = 1.0 - smoothstep(0.22, 1.25, length((stainPoint - vec2(40.0, 27.0)) / vec2(34.0, 30.0)) + 0.6 * (cloud - 0.5));
      float wipingStreak = 1.0 - smoothstep(0.12, 0.95, length((stainPoint - vec2(-14.0, 7.0)) / vec2(26.0, 9.0)) + 0.55 * (cloud - 0.5));
      float damp = (1.0 - smoothstep(-16.0, -7.0, vPropPosition.y)) * cloud;
      float stain = max(0.74 * stainedCorner, 0.57 * wipingStreak) * (0.41 + 0.59 * dust);
      float residue = smoothstep(0.12, 0.75, stain + damp * 0.27 + 0.14 * finePores);
      float cavities = coarsePores * (1.0 - 0.42 * residue);
      vec3 drySlip = mix(vec3(0.17, 0.115, 0.07), vec3(0.45, 0.36, 0.24), dust);
      vec3 foamColor = diffuseColor.rgb * (0.90 + 0.22 * cloud - 0.20 * damp);
      diffuseColor.rgb = mix(foamColor, drySlip, residue) * (1.0 - 0.63 * cavities - 0.25 * finePores);
      float spongeBump = -0.91 * cavities - 0.22 * finePores + 0.16 * residue * dust;
    `,
    roughnessmap_fragment: 'roughnessFactor = clamp(roughnessFactor + 0.075 * residue - 0.11 * damp + 0.05 * finePores, 0.75, 1.0);',
    normal_fragment_maps: 'normal = surfaceBumpNormal(-vViewPosition, normal, spongeBump, faceDirection);',
  });

  const sponge = new Mesh(spongeGeometry(), material);
  sponge.position.set(-23, 16, -29);
  sponge.rotation.y = -0.24;
  return sponge;
}

function traceLoop(path, width, length, shoulder, inset) {
  const side = width - inset;
  const tip = length - inset;
  const base = 2.65 - inset * 0.4;
  path.moveTo(-base, inset);
  path.quadraticCurveTo(-side * 0.62, tip * 0.25, -side, tip * shoulder);
  path.quadraticCurveTo(-side * 1.1, tip, 0, tip);
  path.quadraticCurveTo(side * 1.1, tip, side, tip * shoulder);
  path.quadraticCurveTo(side * 0.62, tip * 0.25, base, inset);
  path.closePath();
}

function loopGeometry(width, length, shoulder) {
  const outline = new Shape();
  traceLoop(outline, width, length, shoulder, 0);
  const opening = new Path();
  traceLoop(opening, width, length, shoulder, 0.86);
  outline.holes.push(opening);
  return new ExtrudeGeometry(outline, {
    depth: 1.65, bevelEnabled: true, bevelSize: 0.1, bevelThickness: 0.12, bevelSegments: 2, curveSegments: 16,
  });
}

function createTrimmingLoop() {
  const tool = new Group();
  const wood = new MeshPhysicalMaterial({ color: '#a56434', roughness: 0.55, clearcoat: 0.12 });
  setStudioSurface(wood, 'turned wood', '', {
    color_fragment: `
      vec3 grain = vPropPosition * vec3(0.75, 0.035, 0.65);
      float layers = length(grain.xz - vec2(0.6, -1.2)) * 4.4
        + sin(grain.y + grain.x * 0.42) * 0.8 + sin(grain.z * 1.3) * 0.35;
      float rings = smoothstep(0.42, 0.94, sin(layers * 5.6));
      float grainDetail = 1.0 - smoothstep(0.7, 2.8, fwidth(layers));
      diffuseColor.rgb *= 0.96 + (0.16 * sin(layers * 0.9) - 0.19 * rings * grainDetail);
    `,
  });
  const handleProfile = [
    [0, -49], [3.6, -49], [3.7, -40], [4.8, -30], [6.5, -20], [7.0, -8],
    [7.1, 1], [6.8, 12], [5.5, 24], [4.0, 36], [3.6, 49], [0, 49],
  ].map(([radius, axis]) => new Vector2(radius, axis));
  const handle = new Mesh(new LatheGeometry(handleProfile, 40), wood);
  handle.rotation.x = Math.PI / 2;
  handle.position.y = 7.1;
  tool.add(handle);

  const steel = new MeshPhysicalMaterial({ color: '#bec5c9', metalness: 0.9, roughness: 0.3 });
  for (const [sign, width, length, shoulder] of [[1, 11.4, 34, 0.62], [-1, 8.5, 27, 0.42]]) {
    const ferrule = new Mesh(new CylinderGeometry(3.4, 3.85, 13.2, 24), steel);
    ferrule.rotation.x = sign * Math.PI / 2;
    ferrule.position.set(0, 7.1, sign * 49.1);
    const blade = new Mesh(loopGeometry(width, length, shoulder), steel);
    blade.rotation.set(Math.PI / 2 + 0.1, sign < 0 ? Math.PI : 0, 0, 'YXZ');
    blade.position.set(0, 6.9, sign * 54.5);
    tool.add(ferrule, blade);
  }
  tool.position.set(14, 0, 57);
  tool.rotation.y = 1.02;
  return tool;
}

export function createStudioProps() {
  const group = new Group();
  const tools = new Group();
  const ruler = createStudioRuler();
  tools.add(createSponge(), createTrimmingLoop());
  group.add(tools, ruler);
  group.traverse(object => {
    if (object.isMesh) object.castShadow = object.receiveShadow = true;
  });
  const toolsBounds = new Box3().setFromObject(tools, true);
  const rulerBounds = new Box3().setFromObject(ruler, true);
  const worldBounds = new Box3();

  return {
    group,
    placeBeside(vesselBounds, ground, depth) {
      const side = vesselBounds.max.x;
      tools.position.set(side - toolsBounds.min.x + 300, ground, -depth * 0.16);
      const centerX = (vesselBounds.min.x + side) / 2;
      ruler.position.set(centerX - 30, ground, vesselBounds.max.z - rulerBounds.min.z + 200);
      vesselBounds.union(worldBounds.copy(toolsBounds).translate(tools.position));
      vesselBounds.union(worldBounds.copy(rulerBounds).translate(ruler.position));
    },
  };
}
