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

function strokeDimension(context) {
  context.strokeStyle = '#392849';
  context.lineWidth = 2.8;
  context.stroke();
  context.strokeStyle = '#e4fa83';
  context.lineWidth = 1.15;
  context.stroke();
}

export function drawDimensions(canvas, camera, bounds, width, height) {
  const context = canvas.getContext('2d');
  context.setTransform(canvas.width / width, 0, 0, canvas.height / height, 0, 0);
  context.clearRect(0, 0, width, height);

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

  context.fillStyle = '#e4fa83';
  context.font = '700 12px "IBM Plex Mono", monospace';
  context.textBaseline = 'middle';
  context.textAlign = 'center';

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
    let offsetX = outward * -uy * 20;
    let offsetY = outward * ux * 20;
    offsetX += keepVisible(ax + offsetX, bx + offsetX, width, 12);
    offsetY += keepVisible(ay + offsetY, by + offsetY, height, 23);
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
    strokeDimension(context);

    const label = axis + ' ' + formatLength(sizes[index]) + ' mm';
    const half = context.measureText(label).width / 2 + 5;
    const tx = Math.min(width - half - 4, Math.max(half + 4, mx + offsetX));
    const ty = Math.min(height - 11, Math.max(11, my + offsetY));
    context.fillStyle = '#231634';
    context.fillRect(tx - half, ty - 9, half * 2, 18);
    context.fillStyle = '#e4fa83';
    context.fillText(label, tx, ty + 0.5);
  });
}
