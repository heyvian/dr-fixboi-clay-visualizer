import * as THREE from 'three';
import { formatRaisedHeight } from './gcode.js';

const red = '#ff416d';
const ringGap = 8;
const ringWidth = 10;
const groundHeight = 0.08;
const artworkScale = 2;

// The preview and studio canvas use the same mark in bed coordinates (millimeters).
export const placementMarkShader = `
uniform vec4 placementMark;
uniform float raisedFootprint;
uniform vec2 labelFacing;
uniform vec4 originLabelBounds;
uniform vec4 raisedLabelBounds;
uniform sampler2D originGlyphs;
uniform sampler2D raisedGlyphs;

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

float labelCoverage(sampler2D glyphs, vec4 bounds, vec2 point) {
  if (bounds.z <= 0.0) return 0.0;
  vec2 offset = point - bounds.xy;
  vec2 right = vec2(labelFacing.y, -labelFacing.x);
  vec2 uv = 0.5 + vec2(dot(offset, right), -dot(offset, labelFacing)) / bounds.zw;
  vec2 inside = step(vec2(0.0), uv) * step(uv, vec2(1.0));
  return texture2D(glyphs, uv).a * inside.x * inside.y;
}

float placementCoverage(vec2 point, float minFeather, float filterWidth) {
  float edge = placementMarkDistance(point);
  float feather = max(minFeather, fwidth(edge) * filterWidth);
  float marks = 1.0 - smoothstep(-feather, feather, edge);
  float origin = labelCoverage(originGlyphs, originLabelBounds, point);
  float raised = labelCoverage(raisedGlyphs, raisedLabelBounds, point);
  return max(marks, max(origin, raised));
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
        gl_FragColor = vec4(markColor, 0.8 * placementCoverage(markPoint, 0.05, 0.6));
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

function setLabel(label, lines) {
  label.glyphs.value?.dispose();
  label.glyphs.value = null;
  label.bounds.value.set(0, 0, 0, 0);
  if (!lines) return;

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
  context.fillStyle = '#ffffff';
  lines.forEach((text, index) => {
    const y = (index + 0.5) * lineHeight + 2;
    context.fillText(text, width / 2, y);
  });
  label.glyphs.value = new THREE.CanvasTexture(canvas);
  label.aspect = width / height;
}

function arrowReach(radius) {
  return Math.max(14, radius * 0.37);
}

export function createOriginGuide() {
  const group = new THREE.Group();
  const uniforms = {
    placementMark: { value: new THREE.Vector4() },
    raisedFootprint: { value: 0 },
    labelFacing: { value: new THREE.Vector2(0, 1) },
    originLabelBounds: { value: new THREE.Vector4() },
    raisedLabelBounds: { value: new THREE.Vector4() },
    originGlyphs: { value: null },
    raisedGlyphs: { value: null },
  };
  const previewMark = createPreviewMark(uniforms);
  group.add(previewMark);
  group.visible = false;
  const originLabel = { bounds: uniforms.originLabelBounds, glyphs: uniforms.originGlyphs };
  const raisedLabel = { bounds: uniforms.raisedLabelBounds, glyphs: uniforms.raisedGlyphs };
  const labels = [originLabel, raisedLabel];
  let placement;
  let footprintRadius = 0;
  let raisedHeight = 0;

  function setMesh(mesh, origin, height = 0) {
    placement = mesh && getOriginPlacement(mesh.positions, origin);
    footprintRadius = placement?.radius ?? (mesh && height ? getFootprintRadius(mesh.positions) : 0);
    raisedHeight = mesh ? height : 0;
    setLabel(originLabel, placement ? [Number(placement.distance.toFixed(2)) + ' mm to origin'] : undefined);
    setLabel(raisedLabel, raisedHeight ? [formatRaisedHeight(raisedHeight), 'above Z0'] : undefined);
  }

  function layOutLabels(radius, directionX, directionZ) {
    const { x: frontX, y: frontZ } = uniforms.labelFacing.value.set(directionX, directionZ).normalize();
    const gap = Math.max(2, radius * 0.08);
    const outer = placement ? radius + ringGap + ringWidth : radius;

    function halfSpan(width, depth, x, z) {
      return (width * Math.abs(x * frontZ - z * frontX) + depth * Math.abs(x * frontX + z * frontZ)) / 2;
    }

    if (placement) {
      const width = Math.max(36, radius * 2.48);
      const depth = width / originLabel.aspect * 2.3;
      const [x, z] = placement.direction;
      const anchor = outer + arrowReach(outer) + gap + halfSpan(width, depth, x, z);
      originLabel.bounds.value.set(x * anchor, z * anchor, width, depth);
    }
    if (raisedHeight) {
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
      raisedLabel.bounds.value.set(x * anchor, z * anchor, width, depth);
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
    const { x: frontX, y: frontZ } = uniforms.labelFacing.value;
    for (const { bounds } of labels) {
      const { x, y: z, z: width, w: depth } = bounds.value;
      if (!width) continue;
      for (const u of [-width / 2, width / 2]) {
        for (const v of [-depth / 2, depth / 2]) {
          points.push(new THREE.Vector3(x + u * frontZ - v * frontX, groundHeight, z - u * frontX - v * frontZ));
        }
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
    const view = camera.matrixWorld.elements;
    layOutLabels(radius, view[8], view[10]);
    if (previewMark.visible) {
      let extent = Math.max(radius, outer ? outer + arrowReach(outer) : 0);
      for (const { bounds } of labels) {
        const { x, y, z: width, w: depth } = bounds.value;
        extent = Math.max(extent, Math.max(Math.abs(x), Math.abs(y)) + Math.hypot(width, depth) / 2);
      }
      const size = 2 * (extent + 1);
      previewMark.scale.set(size, size, 1);
    }
  }

  return { group, uniforms, setMesh, getFramePoints, update, get hasMark() { return Boolean(placement || raisedHeight); } };
}
