import * as THREE from 'three';

const red = '#ff416d';
const ink = '#6a1038';
const cream = '#fffdf7';
const ringGap = 8;
const ringWidth = 10;
const groundHeight = 0.08;
const artworkScale = 2;

// The preview and studio canvas use the same mark in bed coordinates (millimeters).
export const placementMarkShader = `
uniform vec4 placementMark;

float placementMarkDistance(vec2 point) {
  float outer = placementMark.x;
  float reach = placementMark.y;
  vec2 direction = placementMark.zw;
  float radial = length(point);
  float ring = max(radial - outer, outer - ${ringWidth.toFixed(1)} - radial);

  float along = dot(point, direction) - outer;
  float across = abs(dot(point, vec2(-direction.y, direction.x)));
  float shoulder = reach * 0.42;
  float shaft = max(max(-${(ringWidth / 2).toFixed(1)} - along, along - reach * 0.64), across - reach * 0.22);
  float head = max(shoulder - along, max(along - reach, (across - (reach - along) * 0.86) * 0.76));
  return min(ring, min(shaft, head));
}
`;

function createPreviewMark(mark) {
  const material = new THREE.ShaderMaterial({
    uniforms: { placementMark: mark, markColor: { value: new THREE.Color(red) } },
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

export function getOriginPlacement(positions, origin) {
  if (!origin?.every(Number.isFinite)) return;
  const distance = Math.hypot(...origin);
  if (!distance || !Number.isFinite(distance)) return;
  let radiusSquared = 0;
  // The print is centered on the XY bounds of its toolpath in the viewer.
  for (let index = 0; index < positions.length; index += 3) {
    const x = positions[index];
    const z = positions[index + 2];
    radiusSquared = Math.max(radiusSquared, x * x + z * z);
  }
  return {
    radius: Math.sqrt(radiusSquared),
    direction: origin.map(axis => axis / distance),
    distance,
  };
}

const labelFont = '700 12px monospace';

function makeLabel(text) {
  const width = Math.ceil(text.length * 7.25) + 14;
  const height = 22;
  const canvas = document.createElement('canvas');
  canvas.width = width * artworkScale;
  canvas.height = height * artworkScale;
  const context = canvas.getContext('2d');
  context.scale(artworkScale, artworkScale);
  context.fillStyle = red;
  context.fillRect(0, 0, width, height);
  context.fillStyle = ink;
  context.fillRect(1, 1, width - 2, height - 2);
  context.font = labelFont;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillStyle = cream;
  context.fillText(text, width / 2, height / 2 + 0.5);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map, sizeAttenuation: false, depthWrite: false, toneMapped: false, fog: false,
  }));
  sprite.renderOrder = 6;
  return { sprite, width, height };
}

function arrowReach(radius) {
  return Math.max(14, radius * 0.37);
}

export function createOriginGuide() {
  const group = new THREE.Group();
  const mark = { value: new THREE.Vector4(0, 0, 0, 0) };
  const previewMark = createPreviewMark(mark);
  group.add(previewMark);
  group.visible = false;
  const projected = new THREE.Vector3();
  let placement;
  let label;
  let drawnScale;

  function setMesh(mesh, origin) {
    placement = mesh && getOriginPlacement(mesh.positions, origin);
    drawnScale = undefined;
    if (label) {
      label.sprite.removeFromParent();
      label.sprite.material.map.dispose();
      label.sprite.material.dispose();
      label = undefined;
    }
    if (placement) {
      const distance = Number(placement.distance.toFixed(2));
      label = makeLabel(distance + ' mm to X0 Y0');
      group.add(label.sprite);
    }
  }

  function getFramePoints(scale) {
    if (!placement) return [];
    const outer = placement.radius * scale + ringGap + ringWidth;
    const points = Array.from({ length: 24 }, (_, index) => {
      const angle = index / 24 * 2 * Math.PI;
      return new THREE.Vector3(Math.cos(angle) * outer, groundHeight, Math.sin(angle) * outer);
    });
    const [x, z] = placement.direction;
    const reach = outer + arrowReach(outer);
    points.push(new THREE.Vector3(x * reach, groundHeight, z * reach));
    return points;
  }

  function update(camera, width, height, scale, replaying, onCanvas) {
    group.visible = Boolean(placement && !replaying && width && height);
    // A zero radius also clears the mark on the canvas when nothing is visible.
    if (!group.visible) {
      mark.value.x = 0;
      return;
    }
    previewMark.visible = !onCanvas;
    const outer = placement.radius * scale + ringGap + ringWidth;
    const reach = arrowReach(outer);
    const [x, z] = placement.direction;
    mark.value.set(outer, reach, x, z);
    if (drawnScale !== scale) {
      const size = 2 * (outer + reach + 1);
      previewMark.scale.set(size, size, 1);
      const anchor = outer + reach * 0.78;
      label.sprite.position.set(x * anchor, groundHeight + 0.15, z * anchor);
      drawnScale = scale;
    }

    projected.copy(label.sprite.position).project(camera);
    const screenX = (projected.x + 1) * width / 2;
    const screenY = (1 - projected.y) * height / 2;
    label.sprite.visible = projected.z >= -1 && projected.z <= 1
      && screenX >= 8 && screenX <= width - 8 && screenY >= 34 && screenY <= height - 12;
    if (!label.sprite.visible) return;
    const labelX = THREE.MathUtils.clamp(screenX, label.width / 2 + 12, width - label.width / 2 - 12);
    const unit = 2 / (height * camera.projectionMatrix.elements[5]);
    label.sprite.center.set(0.5 + (screenX - labelX) / label.width, -0.56);
    label.sprite.scale.set(label.width * unit, label.height * unit, 1);
  }

  return { group, mark, setMesh, getFramePoints, update };
}
