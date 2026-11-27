// Inelastic contact between falling bead sections, surviving clay, and the plate.
// Positions are in G-code axes and refer to the bottom of each section.
export function createVicContacts(nodes, diameter, position, previousZ, velocity, laidVolumes, sectionAreaRatio) {
  const cell = diameter * 0.95;
  const stable = new Map();
  const debris = new Map();
  const widths = new Float32Array(nodes.length);
  const heights = new Float32Array(nodes.length);
  const predicted = new Float32Array(position.length);
  const key = (x, y) => x + ':' + y;
  const heightOrder = (a, b) => predicted[a * 3 + 2] - predicted[b * 3 + 2];
  let tallest = 0;
  let tallestStable = 0;

  function insert(grid, i) {
    const p = i * 3;
    const column = key(Math.floor(position[p] / cell), Math.floor(position[p + 1] / cell));
    const bucket = grid.get(column);
    if (bucket) bucket.push(i);
    else grid.set(column, [i]);
  }

  function rebuild(active, moving, amount, flatten, keepStable = false, movers) {
    debris.clear();
    if (!keepStable) {
      stable.clear();
      tallestStable = 0;
    }
    tallest = tallestStable;

    function add(i) {
      const node = nodes[i];
      const laid = laidVolumes?.[i] ?? node.volume;
      if (!laid) return;
      const p = i * 3;
      predicted[p] = position[p];
      predicted[p + 1] = position[p + 1];
      predicted[p + 2] = position[p + 2];
      const size = Math.sqrt(amount[i] / laid * (sectionAreaRatio?.(i) ?? 1));
      widths[i] = node.width * size / (1 - flatten[i]);
      heights[i] = node.height * size * (1 - flatten[i]);
      tallest = Math.max(tallest, heights[i]);
      if (moving[i]) insert(debris, i);
      else if (!keepStable) {
        tallestStable = Math.max(tallestStable, heights[i]);
        insert(stable, i);
      }
    }

    if (keepStable && movers) for (const i of movers) add(i);
    else for (let i = 0; i < active; i++) add(i);
    if (!keepStable) for (const bucket of stable.values()) bucket.sort(heightOrder);
    for (const bucket of debris.values()) bucket.sort(heightOrder);
  }

  function settle(i) {
    const p = i * 3;
    const x = position[p];
    const y = position[p + 1];
    const bottom = position[p + 2];
    const oldBottom = previousZ[i];
    const gx = Math.floor(x / cell);
    const gy = Math.floor(y / cell);
    const node = nodes[i];
    const reach = widths[i] > diameter * 1.45 ? 2 : 1;
    let floor = 0;
    let pushX = 0;
    let pushY = 0;
    let pressures = 0;
    const lowest = bottom - tallest;
    const highest = Math.max(oldBottom, bottom + heights[i]) + diameter * 0.18;

    function examine(bucket, fixed) {
      if (!bucket) return;
      let first = 0;
      let end = bucket.length;
      while (first < end) {
        const mid = (first + end) >>> 1;
        if (predicted[bucket[mid] * 3 + 2] < lowest) first = mid + 1;
        else end = mid;
      }
      for (let offset = first; offset < bucket.length; offset++) {
        const j = bucket[offset];
        const q = j * 3;
        const otherBottom = predicted[q + 2];
        if (otherBottom > highest) break;
        if (j === i) continue;
        const other = nodes[j];
        const along = Math.abs(node.length - other.length);
        if (other.run === node.run && (along < diameter * 1.4
          || (node.loopLaid && node.perimeter - along < diameter * 1.4))) continue;
        const oldTop = (fixed ? otherBottom : previousZ[j]) + heights[j] * 0.8;
        const top = otherBottom + heights[j];
        if (top < bottom) continue;
        const dx = x - predicted[q];
        const dy = y - predicted[q + 1];
        const radius = (widths[i] + widths[j]) * 0.44;
        const d2 = dx ** 2 + dy ** 2;
        if (d2 >= radius ** 2) continue;
        const distance = Math.sqrt(d2);
        if (oldTop <= oldBottom + diameter * 0.12) {
          // Contact nearer the rounded shoulder of a bead supports less of the falling section.
          const shoulder = Math.sqrt(1 - 0.68 * d2 / (radius ** 2));
          floor = Math.max(floor, Math.min(oldBottom + diameter * 0.12, otherBottom + heights[j] * 0.82 * shoulder));
        } else {
          const overlap = Math.min(bottom + heights[i], top) - Math.max(bottom, otherBottom);
          if (overlap < diameter * 0.1 || distance < 0.00001) continue;
          const nudge = (radius - distance) * (fixed ? 0.43 : 0.26) / distance;
          pushX += dx * nudge;
          pushY += dy * nudge;
          pressures++;
        }
      }
    }

    for (let dy = -reach; dy <= reach; dy++) {
      for (let dx = -reach; dx <= reach; dx++) {
        const column = key(gx + dx, gy + dy);
        examine(stable.get(column), true);
        examine(debris.get(column), false);
      }
    }

    if (pressures) {
      const scale = Math.min(1 / Math.sqrt(pressures), diameter * 0.15 / Math.max(0.00001, Math.hypot(pushX, pushY)));
      position[p] += pushX * scale;
      position[p + 1] += pushY * scale;
    }
    if (bottom > floor) return 0;
    const speed = Math.max(0, -velocity[p + 2]);
    position[p + 2] = floor;
    velocity[p] *= floor > 0 ? 0.64 : 0.55;
    velocity[p + 1] *= floor > 0 ? 0.64 : 0.55;
    velocity[p + 2] = 0;
    return speed;
  }

  return { rebuild, settle };
}
