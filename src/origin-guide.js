import * as THREE from 'three';
import { formatRaisedHeight } from './gcode.js';

const red = '#ff416d';
const ink = '#6a1038';
const ringGap = 8;
const ringWidth = 10;
const groundHeight = 0.08;
const artworkScale = 2;

// The preview and studio canvas use the same mark in bed coordinates (millimeters).
export const placementMarkShader = `
uniform vec4 placementMark;
uniform float raisedFootprint;

float placementMarkDistance(vec2 point) {
  float radial = length(point);
  float disk = raisedFootprint > 0.0 ? radial - raisedFootprint : 1.0e9;
  float outer = placementMark.x;
  if (outer <= 0.0) return disk;
  float reach = placementMark.y;
  vec2 direction = placementMark.zw;
  float ring = max(radial - outer, outer - ${ringWidth.toFixed(1)} - radial);

  float along = dot(point, direction) - outer;
  float across = abs(dot(point, vec2(-direction.y, direction.x)));
  float shoulder = reach * 0.42;
  float shaft = max(max(-${(ringWidth / 2).toFixed(1)} - along, along - reach * 0.64), across - reach * 0.22);
  float head = max(shoulder - along, max(along - reach, (across - (reach - along) * 0.86) * 0.76));
  return min(disk, min(ring, min(shaft, head)));
}
`;

function createPreviewMark(uniforms) {
  const material = new THREE.ShaderMaterial({
    uniforms: { ...uniforms, markColor: { value: new THREE.Color(red) } },
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -8,
    vertexShader: `
      varying vec2 markPoint;
      void main() {
        vec4 point = modelMatrix * vec4(position, 1.0);
        markPoint = point.xz;
        gl_Position = projectionMatrix * viewMatrix * point;
      }
    `,
    fragmentShader: `
      varying vec2 markPoint;
      uniform vec3 markColor;
      ${placementMarkShader}
      void main() {
        float edge = placementMarkDistance(markPoint);
        float feather = max(0.05, fwidth(edge) * 0.6);
        gl_FragColor = vec4(markColor, 0.8 * (1.0 - smoothstep(-feather, feather, edge)));
        #include <colorspace_fragment>
      }
    `,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = groundHeight;
  mesh.renderOrder = 4;
  return mesh;
}

function getFootprintRadius(positions) {
  let radiusSquared = 0;
  // The print is centered on the XY bounds of its toolpath in the viewer.
  for (let index = 0; index < positions.length; index += 3) {
    const x = positions[index];
    const z = positions[index + 2];
    radiusSquared = Math.max(radiusSquared, x * x + z * z);
  }
  return Math.sqrt(radiusSquared);
}

export function getOriginPlacement(positions, origin) {
  if (!origin?.every(Number.isFinite)) return;
  const distance = Math.hypot(...origin);
  if (!distance || !Number.isFinite(distance)) return;
  return { radius: getFootprintRadius(positions), direction: origin.map(axis => axis / distance), distance };
}

function makeLabel(plane, lines) {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  const font = '900 20px system-ui, sans-serif';
  context.font = font;
  const width = Math.ceil(Math.max(...lines.map(text => context.measureText(text).width))) + 8;
  const lineHeight = 24;
  const height = lines.length * lineHeight + 4;
  canvas.width = width * artworkScale;
  canvas.height = height * artworkScale;
  context.scale(artworkScale, artworkScale);
  context.font = font;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillStyle = red;
  context.strokeStyle = ink;
  context.lineWidth = 2.25;
  context.lineJoin = 'round';
  lines.forEach((text, index) => {
    const y = (index + 0.5) * lineHeight + 2;
    context.strokeText(text, width / 2, y);
    context.fillText(text, width / 2, y);
  });
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(plane, new THREE.MeshBasicMaterial({
    map, transparent: true, depthWrite: false, toneMapped: false, fog: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -8,
  }));
  mesh.renderOrder = 6;
  return { mesh, aspect: width / height };
}

function arrowReach(radius) {
  return Math.max(14, radius * 0.37);
}

export function createOriginGuide() {
  const group = new THREE.Group();
  const uniforms = {
    placementMark: { value: new THREE.Vector4() },
    raisedFootprint: { value: 0 },
  };
  const previewMark = createPreviewMark(uniforms);
  group.add(previewMark);
  group.visible = false;
  const labelPlane = new THREE.PlaneGeometry(1, 1);
  let placement;
  let footprintRadius = 0;
  let raisedHeight = 0;
  let originLabel;
  let raisedLabel;

  function setMesh(mesh, origin, height = 0) {
    placement = mesh && getOriginPlacement(mesh.positions, origin);
    footprintRadius = placement?.radius ?? (mesh && height ? getFootprintRadius(mesh.positions) : 0);
    raisedHeight = mesh ? height : 0;
    for (const label of [originLabel, raisedLabel]) {
      if (!label) continue;
      label.mesh.removeFromParent();
      label.mesh.material.map.dispose();
      label.mesh.material.dispose();
    }
    originLabel = placement ? makeLabel(labelPlane, [Number(placement.distance.toFixed(2)) + ' mm', 'to X0 Y0']) : undefined;
    raisedLabel = raisedHeight ? makeLabel(labelPlane, [formatRaisedHeight(raisedHeight), 'above Z0']) : undefined;
    for (const label of [originLabel, raisedLabel]) {
      if (label) group.add(label.mesh);
    }
  }

  function layOutLabels(radius, directionX, directionZ) {
    const yaw = Math.atan2(directionX, directionZ);
    const frontX = Math.sin(yaw);
    const frontZ = Math.cos(yaw);
    const gap = Math.max(2, radius * 0.08);
    const outer = placement ? radius + ringGap + ringWidth : radius;

    function halfSpan(width, depth, x, z) {
      return (width * Math.abs(x * frontZ - z * frontX) + depth * Math.abs(x * frontX + z * frontZ)) / 2;
    }

    function place({ mesh }, width, depth, x, z) {
      mesh.rotation.set(-Math.PI / 2, yaw, 0, 'YXZ');
      mesh.position.set(x, groundHeight, z);
      mesh.scale.set(width, depth, 1);
    }

    if (originLabel) {
      const width = Math.max(26, radius * 1.53);
      const depth = width / originLabel.aspect * 1.85;
      const [x, z] = placement.direction;
      const anchor = outer + arrowReach(outer) + gap + halfSpan(width, depth, x, z);
      place(originLabel, width, depth, x * anchor, z * anchor);
    }
    if (raisedLabel) {
      const width = radius * 1.45;
      const depth = radius * 0.90;
      let x = frontX;
      let z = frontZ;
      if (placement) {
        const [arrowX, arrowZ] = placement.direction;
        // Use the nearer side of the ring when the arrow is pointing at the camera.
        if (frontX * arrowX + frontZ * arrowZ > 0) {
          const side = frontZ * arrowX - frontX * arrowZ >= 0 ? 1 : -1;
          x = -arrowZ * side;
          z = arrowX * side;
        }
      }
      const anchor = outer + gap + halfSpan(width, depth, x, z);
      place(raisedLabel, width, depth, x * anchor, z * anchor);
    }
  }

  function getFramePoints(scale, direction) {
    if (!placement && !raisedHeight) return [];
    const radius = footprintRadius * scale;
    const outer = placement ? radius + ringGap + ringWidth : radius;
    const points = Array.from({ length: 24 }, (_, index) => {
      const angle = index / 24 * 2 * Math.PI;
      return new THREE.Vector3(Math.cos(angle) * outer, groundHeight, Math.sin(angle) * outer);
    });
    layOutLabels(radius, direction.x, direction.z);
    for (const label of [originLabel, raisedLabel]) {
      if (!label) continue;
      label.mesh.updateMatrix();
      for (const x of [-0.5, 0.5]) {
        for (const y of [-0.5, 0.5]) points.push(new THREE.Vector3(x, y, 0).applyMatrix4(label.mesh.matrix));
      }
    }
    return points;
  }

  function update(camera, scale, replaying, onCanvas) {
    group.visible = Boolean((placement || raisedHeight) && !replaying);
    const radius = footprintRadius * scale;
    const outer = group.visible && placement ? radius + ringGap + ringWidth : 0;
    uniforms.placementMark.value.x = 0;
    uniforms.raisedFootprint.value = group.visible && raisedHeight ? radius : 0;
    if (!group.visible) return;
    previewMark.visible = !onCanvas;
    if (outer) uniforms.placementMark.value.set(outer, arrowReach(outer), ...placement.direction);
    const size = 2 * (Math.max(radius, outer ? outer + arrowReach(outer) : 0) + 1);
    previewMark.scale.set(size, size, 1);
    const view = camera.matrixWorld.elements;
    layOutLabels(radius, view[8], view[10]);
  }

  return { group, uniforms, setMesh, getFramePoints, update, get hasMark() { return Boolean(placement || raisedHeight); } };
}
