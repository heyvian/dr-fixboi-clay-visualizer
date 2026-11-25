import * as THREE from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { formatLength } from './dimensions.js';

const red = '#ff416d';
const ink = '#6a1038';
const cream = '#fffdf7';

function cross(ax, az, bx, bz) {
  return ax * bz - az * bx;
}

// Every mesh triangle projects onto the print bed. The closest point of their union
// is on a projected edge unless the origin itself lies within the footprint.
export function nearestFootprintPoint(positions, indices, x, z) {
  let edgeX = positions[0];
  let edgeY = positions[1];
  let edgeZ = positions[2];
  let distanceSquared = (x - edgeX) ** 2 + (z - edgeZ) ** 2;
  let limit = Math.sqrt(distanceSquared);

  function considerEdge(a, b, ax, az, bx, bz) {
    const dx = bx - ax;
    const dz = bz - az;
    const lengthSquared = dx * dx + dz * dz;
    const t = lengthSquared ? Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / lengthSquared)) : 0;
    const nextX = ax + dx * t;
    const nextZ = az + dz * t;
    const squared = (x - nextX) ** 2 + (z - nextZ) ** 2;
    if (squared > distanceSquared) return;
    const nextY = positions[a + 1] + (positions[b + 1] - positions[a + 1]) * t;
    if (squared === distanceSquared && nextY >= edgeY) return;
    edgeX = nextX;
    edgeY = nextY;
    edgeZ = nextZ;
    distanceSquared = squared;
    limit = Math.sqrt(squared);
  }

  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i] * 3;
    const b = indices[i + 1] * 3;
    const c = indices[i + 2] * 3;
    const ax = positions[a], az = positions[a + 2];
    const bx = positions[b], bz = positions[b + 2];
    const cx = positions[c], cz = positions[c + 2];
    if (Math.min(ax, bx, cx) - x > limit || x - Math.max(ax, bx, cx) > limit
      || Math.min(az, bz, cz) - z > limit || z - Math.max(az, bz, cz) > limit) continue;

    if (cross(bx - ax, bz - az, cx - ax, cz - az) !== 0) {
      const ab = cross(bx - ax, bz - az, x - ax, z - az);
      const bc = cross(cx - bx, cz - bz, x - bx, z - bz);
      const ca = cross(ax - cx, az - cz, x - cx, z - cz);
      if ((ab >= 0 && bc >= 0 && ca >= 0) || (ab <= 0 && bc <= 0 && ca <= 0)) return;
    }
    considerEdge(a, b, ax, az, bx, bz);
    considerEdge(b, c, bx, bz, cx, cz);
    considerEdge(c, a, cx, cz, ax, az);
  }
  if (limit > 0.01) return [edgeX, edgeY, edgeZ];
}

function makeSprite() {
  const canvas = document.createElement('canvas');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: texture, sizeAttenuation: false, depthWrite: false, toneMapped: false, fog: false,
  }));
  return { sprite, canvas, texture, width: 0, height: 0 };
}

function paint(art, width, height) {
  art.width = width;
  art.height = height;
  art.canvas.width = width * 2;
  art.canvas.height = height * 2;
  const context = art.canvas.getContext('2d');
  context.scale(2, 2);
  art.texture.needsUpdate = true;
  return context;
}

const labelFont = '700 12px monospace';

function paintLabel(art, text) {
  const context = art.canvas.getContext('2d');
  context.font = labelFont;
  const width = Math.ceil(context.measureText(text).width) + 14;
  paint(art, width, 22);
  context.fillStyle = red;
  context.fillRect(0, 0, width, 22);
  context.fillStyle = ink;
  context.fillRect(1, 1, width - 2, 20);
  context.font = labelFont;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillStyle = cream;
  context.fillText(text, width / 2, 11.5);
}

function makeLine(width, opacity) {
  const geometry = new LineGeometry().setPositions([0, 0, 0, 1, 0, 0]);
  const line = new Line2(geometry, new LineMaterial({
    color: red, linewidth: width, opacity, transparent: opacity < 1, depthWrite: false, toneMapped: false, fog: false,
  }));
  line.renderOrder = 4;
  return line;
}

function setSegment({ geometry }, start, end) {
  const buffer = geometry.getAttribute('instanceStart').data;
  buffer.array.set([start.x, start.y, start.z, end.x, end.y, end.z]);
  buffer.needsUpdate = true;
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
}

export function createOriginGuide() {
  const group = new THREE.Group();
  const line = makeLine(3.5, 1);
  const extension = makeLine(1.5, 0.7);
  const dot = makeSprite();
  const originLabel = makeSprite();
  const distanceLabel = makeSprite();
  const circle = paint(dot, 16, 16);
  circle.fillStyle = cream;
  circle.beginPath();
  circle.arc(8, 8, 7, 0, 2 * Math.PI);
  circle.fill();
  circle.fillStyle = red;
  circle.beginPath();
  circle.arc(8, 8, 5.25, 0, 2 * Math.PI);
  circle.fill();
  paintLabel(originLabel, 'X0 Y0');
  group.add(line, extension, dot.sprite, originLabel.sprite, distanceLabel.sprite);
  group.visible = false;

  // Keep the guide just above the ground plane, in the same frame as the clay.
  const start = new THREE.Vector3(0, 0.02, 0);
  const end = start.clone();
  const surface = start.clone();
  const middle = start.clone();
  const projected = new THREE.Vector3();
  const edges = new Map();
  let footprint;
  let drawnScale;
  let drawnLabel;

  function setMesh(mesh, origin) {
    footprint = mesh && origin?.every(Number.isFinite) ? mesh : undefined;
    if (footprint) start.set(origin[0], start.y, origin[1]);
    edges.clear();
    drawnScale = undefined;
  }

  function update(camera, width, height, scale, replaying) {
    group.visible = false;
    if (!footprint || replaying || !width || !height) return;

    function project(point) {
      projected.copy(point).project(camera);
      return { x: (projected.x + 1) * width / 2, y: (1 - projected.y) * height / 2, z: projected.z };
    }

    function inFrame(point) {
      return point.z >= -1 && point.z <= 1 && point.x >= 12 && point.x <= width - 12
        && point.y >= 12 && point.y <= height - 12;
    }

    const a = project(start);
    if (!inFrame(a)) return;
    if (!edges.has(scale)) {
      edges.set(scale, nearestFootprintPoint(footprint.positions, footprint.indices, start.x / scale, start.z / scale));
    }
    const edge = edges.get(scale);
    if (!edge) return;
    end.set(edge[0] * scale, start.y, edge[2] * scale);
    const b = project(end);
    if (!inFrame(b) || Math.hypot(b.x - a.x, b.y - a.y) < 28) return;
    middle.lerpVectors(start, end, 0.5);
    const m = project(middle);

    if (drawnScale !== scale) {
      setSegment(line, start, end);
      // Link the bed measurement to the actual clay edge when it overhangs.
      surface.copy(end).setY(edge[1] * scale);
      extension.visible = surface.y - end.y > 0.2;
      if (extension.visible) setSegment(extension, end, surface);
      const label = formatLength(start.distanceTo(end)) + ' mm to edge';
      if (label !== drawnLabel) {
        paintLabel(distanceLabel, label);
        drawnLabel = label;
      }
      drawnScale = scale;
    }

    function placeLabel(art, anchor, point, side) {
      const half = art.width / 2;
      const x = Math.max(half + 12, Math.min(width - half - 12, point.x));
      const y = point.y + side * (art.height / 2 + 9);
      art.sprite.visible = art.width + 24 <= width && y - art.height / 2 >= 42 && y + art.height / 2 <= height - 42;
      art.sprite.position.copy(anchor);
      art.sprite.center.set(0.5 + (point.x - x) / art.width, side < 0 ? -9 / art.height : 1 + 9 / art.height);
      return art.sprite.visible;
    }

    let direction = m.y <= a.y ? -1 : 1;
    if (!placeLabel(distanceLabel, middle, m, direction)) {
      direction *= -1;
      if (!placeLabel(distanceLabel, middle, m, direction)) return;
    }
    placeLabel(originLabel, start, a, -direction);
    dot.sprite.position.copy(start);
    const unit = 2 / (height * camera.projectionMatrix.elements[5]);
    for (const art of [dot, distanceLabel, originLabel]) art.sprite.scale.set(art.width * unit, art.height * unit, 1);
    group.visible = true;
  }

  return { group, setMesh, update };
}
