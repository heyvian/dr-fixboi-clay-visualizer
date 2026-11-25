import * as THREE from 'three';

const red = '#ff416d';
const ink = '#6a1038';
const cream = '#fffdf7';
const ringGap = 8;
const ringWidth = 10;
const groundHeight = 0.08;
const artworkScale = 2;

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

function makeSprite(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width * artworkScale;
  canvas.height = height * artworkScale;
  const context = canvas.getContext('2d');
  context.scale(artworkScale, artworkScale);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map, sizeAttenuation: false, depthTest: false, depthWrite: false, toneMapped: false, fog: false,
  }));
  sprite.renderOrder = 5;
  return { sprite, context, width, height };
}

function makeArrow() {
  const arrow = makeSprite(56, 24);
  const { sprite, context } = arrow;
  sprite.center.set(0, 0.5);
  context.fillStyle = red;
  context.strokeStyle = cream;
  context.lineWidth = 2;
  context.lineJoin = 'round';
  context.beginPath();
  for (const [x, y] of [[1, 8], [35, 8], [35, 2], [54, 12], [35, 22], [35, 16], [1, 16]]) context.lineTo(x, y);
  context.closePath();
  context.stroke();
  context.fill();
  return sprite;
}

const labelFont = '700 12px monospace';

function makeLabel(text) {
  const label = makeSprite(Math.ceil(text.length * 7.25) + 14, 22);
  const { context, width, height } = label;
  context.fillStyle = red;
  context.fillRect(0, 0, width, height);
  context.fillStyle = ink;
  context.fillRect(1, 1, width - 2, height - 2);
  context.font = labelFont;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillStyle = cream;
  context.fillText(text, width / 2, height / 2 + 0.5);
  label.sprite.renderOrder = 6;
  return label;
}

function arrowReach(radius) {
  return Math.max(14, radius * 0.37);
}

export function createOriginGuide() {
  const group = new THREE.Group();
  const ring = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({
    color: red, side: THREE.DoubleSide, transparent: true, opacity: 0.8, depthWrite: false, toneMapped: false, fog: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -8,
  }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = groundHeight;
  ring.renderOrder = 4;
  const arrow = makeArrow();
  group.add(ring, arrow);
  group.visible = false;
  const start = new THREE.Vector3();
  const tip = new THREE.Vector3();
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

  function update(camera, width, height, scale, replaying) {
    group.visible = Boolean(placement && !replaying && width && height);
    if (!group.visible) return;
    if (drawnScale !== scale) {
      const inner = placement.radius * scale + ringGap;
      const outer = inner + ringWidth;
      const [x, z] = placement.direction;
      ring.geometry.dispose();
      ring.geometry = new THREE.RingGeometry(inner, outer, 96);
      start.set(x * outer, groundHeight, z * outer);
      const reach = outer + arrowReach(outer);
      tip.set(x * reach, groundHeight, z * reach);
      drawnScale = scale;
    }

    const a = arrow.position.copy(start).project(camera);
    const b = label.sprite.position.copy(tip).project(camera);
    const x = (a.x + 1) * width / 2;
    const y = (1 - a.y) * height / 2;
    const dx = (b.x - a.x) * width / 2;
    const dy = (a.y - b.y) * height / 2;
    const projectedLength = Math.hypot(dx, dy);
    const visible = a.z >= -1 && a.z <= 1 && b.z >= -1 && b.z <= 1 && projectedLength >= 0.5
      && x >= 8 && x <= width - 8 && y >= 8 && y <= height - 8;
    arrow.visible = label.sprite.visible = visible;
    if (!visible) return;

    const length = THREE.MathUtils.clamp(projectedLength, 26, 72);
    const unit = 2 / (height * camera.projectionMatrix.elements[5]);
    arrow.position.copy(start);
    arrow.material.rotation = Math.atan2(-dy, dx);
    arrow.scale.set(length * unit, 22 * unit, 1);
    const labelX = THREE.MathUtils.clamp(x + dx / projectedLength * length * 0.77, label.width / 2 + 12, width - label.width / 2 - 12);
    const labelAnchorY = y + dy / projectedLength * length * 0.77;
    const labelY = THREE.MathUtils.clamp(labelAnchorY + (dy > 0 ? 24 : -24), 47, height - 47);
    label.sprite.position.copy(start);
    label.sprite.center.set(0.5 + (x - labelX) / label.width, 0.5 + (labelY - y) / label.height);
    label.sprite.scale.set(label.width * unit, label.height * unit, 1);
  }

  return { group, setMesh, getFramePoints, update };
}
