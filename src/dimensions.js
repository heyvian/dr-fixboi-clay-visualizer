import { Vector3 } from 'three';

const millimeters = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });
export const formatLength = value => millimeters.format(value);

function project(point, camera, width, height) {
  const screen = point.clone().project(camera);
  return [(screen.x + 1) * width / 2, (1 - screen.y) * height / 2];
}

function keepVisible(start, end, extent, padding) {
  return Math.max(padding - Math.min(start, end), Math.min(0, extent - padding - Math.max(start, end)));
}

function strokeDimension(context, color) {
  context.strokeStyle = '#392849';
  context.lineWidth = 2.8;
  context.stroke();
  context.strokeStyle = color;
  context.lineWidth = 1.15;
  context.stroke();
}

function drawMeasurementSet(context, camera, bounds, width, height, treatment, labels) {

  const { min, max } = bounds;
  const center = bounds.getCenter(new Vector3());
  const front = camera.position.z > center.z ? max.z : min.z;
  const side = camera.position.x > center.x ? max.x : min.x;
  const farSide = side === max.x ? min.x : max.x;
  const middle = project(center, camera, width, height);
  const sizes = [max.x - min.x, max.z - min.z, max.y - min.y];
  const edges = [
    [new Vector3(min.x, min.y, front), new Vector3(max.x, min.y, front), 'L'],
    [new Vector3(side, min.y, min.z), new Vector3(side, min.y, max.z), 'W'],
    [new Vector3(farSide, min.y, front), new Vector3(farSide, max.y, front), 'H'],
  ];

  edges.forEach(([start, end, axis], index) => {
    const [ax, ay] = project(start, camera, width, height);
    const [bx, by] = project(end, camera, width, height);
    const length = Math.hypot(bx - ax, by - ay);
    if (length < 9 || !Number.isFinite(length)) return;
    const ux = (bx - ax) / length;
    const uy = (by - ay) / length;
    const mx = (ax + bx) / 2;
    const my = (ay + by) / 2;
    const outward = ((mx - middle[0]) * -uy + (my - middle[1]) * ux) >= 0 ? 1 : -1;
    let offsetX = outward * -uy * treatment.spacing;
    let offsetY = outward * ux * treatment.spacing;
    offsetX += keepVisible(ax + offsetX, bx + offsetX, width, 12);
    offsetY += keepVisible(ay + offsetY, by + offsetY, height, treatment.verticalPadding);
    const qx = ax + offsetX;
    const qy = ay + offsetY;
    const rx = bx + offsetX;
    const ry = by + offsetY;

    context.beginPath();
    context.moveTo(qx, qy);
    context.lineTo(rx, ry);
    const arrow = Math.min(6, length / 4);
    for (const [x, y, direction] of [[qx, qy, 1], [rx, ry, -1]]) {
      context.moveTo(x + direction * ux * arrow - uy * 3, y + direction * uy * arrow + ux * 3);
      context.lineTo(x, y);
      context.lineTo(x + direction * ux * arrow + uy * 3, y + direction * uy * arrow - ux * 3);
    }
    strokeDimension(context, treatment.color);

    const label = axis + ' ' + formatLength(sizes[index]) + ' mm';
    const half = context.measureText(label).width / 2 + 5;
    const x = Math.min(width - half - 4, Math.max(half + 4, qx + (rx - qx) * treatment.labelPosition));
    const anchor = qy + (ry - qy) * treatment.labelPosition;
    const choices = [0, -20, 20, -40, 40].map(offset => Math.min(height - 11, Math.max(11, anchor + offset)));
    const y = choices.find(candidate => labels.every(label => Math.abs(x - label.x) >= half + label.half + 4
      || Math.abs(candidate - label.y) >= 20)) ?? choices[0];
    labels.push({ text: label, color: treatment.color, half, x, y });
  });
}

export function drawDimensions(canvas, camera, bounds, width, height, printedBounds) {
  const context = canvas.getContext('2d');
  context.setTransform(canvas.width / width, 0, 0, canvas.height / height, 0, 0);
  context.clearRect(0, 0, width, height);
  context.font = '700 12px "IBM Plex Mono", monospace';
  context.textBaseline = 'middle';
  context.textAlign = 'center';

  const labels = [];
  if (printedBounds) {
    drawMeasurementSet(context, camera, printedBounds, width, height, {
      color: '#9ce8ff', spacing: 43, labelPosition: 0.68, verticalPadding: 17,
    }, labels);
  }
  drawMeasurementSet(context, camera, bounds, width, height, {
    color: '#e4fa83',
    spacing: printedBounds ? 15 : 20,
    labelPosition: printedBounds ? 0.36 : 0.5,
    verticalPadding: printedBounds ? 38 : 23,
  }, labels);

  for (const { text, half, x, y, color } of labels) {
    context.fillStyle = '#231634';
    context.fillRect(x - half, y - 9, half * 2, 18);
    context.fillStyle = color;
    context.fillText(text, x, y + 0.5);
  }
}
