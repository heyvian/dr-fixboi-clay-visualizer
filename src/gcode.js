const wordPattern = /([A-Z])\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))/g;
const tau = 2 * Math.PI;
const maximumSegments = 300_000;

function mix(start, end, amount) {
  return start + (end - start) * amount;
}

function interpolate(start, end, amount) {
  return start.map((value, axis) => mix(value, end[axis], amount));
}

function xyArc(start, end, words, scale, offset, absolute, clockwise) {
  const [sx, sy] = start;
  const [ex, ey] = end;
  let cx;
  let cy;
  if (words.has('I') || words.has('J')) {
    cx = words.has('I') ? words.get('I') * scale + (absolute ? offset[0] : sx) : sx;
    cy = words.has('J') ? words.get('J') * scale + (absolute ? offset[1] : sy) : sy;
  } else if (words.has('R')) {
    const radius = words.get('R') * scale;
    const chord = Math.hypot(ex - sx, ey - sy);
    if (!chord || chord > Math.abs(radius) * 2) return null;
    const height = Math.sqrt(radius ** 2 - (chord / 2) ** 2);
    const side = clockwise === (radius > 0) ? -1 : 1;
    cx = (sx + ex) / 2 - side * height * (ey - sy) / chord;
    cy = (sy + ey) / 2 + side * height * (ex - sx) / chord;
  } else {
    return null;
  }
  const radius = Math.hypot(sx - cx, sy - cy);
  if (radius < 0.0001 || Math.abs(Math.hypot(ex - cx, ey - cy) - radius) > Math.max(0.05, radius * 0.01)) return null;
  const startAngle = Math.atan2(sy - cy, sx - cx);
  const endAngle = Math.atan2(ey - cy, ex - cx);
  const distance = clockwise ? (startAngle - endAngle + tau) % tau : (endAngle - startAngle + tau) % tau;
  const sweep = (distance || tau) * (clockwise ? -1 : 1);
  const steps = Math.min(1_200, Math.max(4, Math.ceil(Math.abs(sweep) / 0.09), Math.ceil(Math.abs(sweep) * radius / 2)));
  return { steps, length: Math.hypot(radius * sweep, end[2] - start[2]), point(fraction) {
    if (fraction === 1) return end;
    const angle = startAngle + sweep * fraction;
    return [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle), mix(start[2], end[2], fraction)];
  } };
}

export function parseGcode(source) {
  let position = [0, 0, 0];
  const offset = [0, 0, 0];
  let xyzAbsolute = true;
  let extrusionOverride;
  let arcAbsolute = false;
  let xyPlane = true;
  let scale = 1;
  let motion;
  let motorOn = false;
  let motorCommands = false;
  let hasExtrusionWords = false;
  let activeTool = 0;
  let segmentCount = 0;
  let skippedArcs = 0;
  let run;
  let runAmounts;
  let runTimes;
  let lastMode;
  let elapsed = 0;
  let feed = 1500;
  const axes = ['X', 'Y', 'Z'];
  const tools = new Map([[0, { e: 0, retracted: 0 }]]);
  const explicit = [];
  const extrusion = [];
  const inferred = [];
  const explicitTimes = [];
  const inferredTimes = [];

  for (const rawLine of source.split(/\r?\n|\r/)) {
    const line = rawLine.split(';', 1)[0].replace(/\([^)]*\)/g, '').split('*', 1)[0].toUpperCase();
    const words = new Map();
    let moves = false;
    let suppressMove = false;
    for (const [, letter, rawValue] of line.matchAll(wordPattern)) {
      const value = Number(rawValue);
      if (!Number.isFinite(value)) continue;
      words.set(letter, value);
      if (letter === 'T' && !words.has('M')) {
        activeTool = value;
        if (!tools.has(value)) tools.set(value, { e: 0, retracted: 0 });
        run = undefined;
        suppressMove = true;
      }
      if (letter === 'G') {
        if ([0, 1, 2, 3].includes(value)) {
          motion = value;
          moves = true;
        } else {
          suppressMove = true;
          if (value === 20 || value === 21) scale = value === 20 ? 25.4 : 1;
          if (value === 90 || value === 91) xyzAbsolute = value === 90;
          if (value === 90.1 || value === 91.1) arcAbsolute = value === 90.1;
          if ([17, 18, 19].includes(value)) xyPlane = value === 17;
        }
      }
      if (letter === 'M') {
        suppressMove = true;
        if (value === 82 || value === 83) extrusionOverride = value === 82;
        if (value === 101 || value === 102 || value === 103) {
          motorCommands = true;
          motorOn = value === 101;
          if (!motorOn) run = undefined;
        }
      }
    }

    const tool = tools.get(activeTool);
    if (words.get('F') > 0 && (moves || !suppressMove)) feed = words.get('F') * scale;
    if (words.get('G') === 4) {
      elapsed += Math.max(0, words.get('S') ?? (words.get('P') ?? 0) / 1000);
      continue;
    }
    if (words.get('G') === 92) {
      axes.forEach((axis, index) => {
        if (words.has(axis)) offset[index] = position[index] - words.get(axis) * scale;
      });
      if (words.has('E')) tool.e = words.get('E') * scale;
      continue;
    }
    if ((!moves && suppressMove) || motion === undefined) continue;
    if (!axes.some(axis => words.has(axis)) && !['E', 'I', 'J', 'R'].some(word => words.has(word))) continue;

    const start = position;
    position = axes.map((axis, index) => {
      if (!words.has(axis)) return start[index];
      const value = words.get(axis) * scale;
      return value + (xyzAbsolute ? offset[index] : start[index]);
    });
    let depositedFraction = 0;
    let depositedAmount = 0;
    if (words.has('E')) {
      hasExtrusionWords = true;
      const eAbsolute = extrusionOverride ?? xyzAbsolute;
      const next = words.get('E') * scale + (eAbsolute ? 0 : tool.e);
      const extruded = next - tool.e;
      tool.e = next;
      if (extruded > 0.00001) {
        depositedFraction = Math.max(0, 1 - tool.retracted / extruded);
        depositedAmount = extruded * depositedFraction;
      }
      tool.retracted = Math.max(0, tool.retracted - extruded);
    }
    const isArc = motion === 2 || motion === 3;
    const arc = isArc && xyPlane ? xyArc(start, position, words, scale, offset, arcAbsolute, motion === 2) : null;
    const length = Math.hypot(position[0] - start[0], position[1] - start[1], position[2] - start[2]);
    const started = elapsed;
    elapsed += (arc?.length ?? length) * 60 / Math.max(3, feed);
    const horizontal = arc || Math.hypot(position[0] - start[0], position[1] - start[1]) > 0.0001;
    const traveling = !arc && length < 0.0001;
    if (traveling) continue;

    const isExplicit = depositedFraction > 0 || (motorOn && motion !== 0 && !words.has('E'));
    const canInfer = motion !== 0 && !words.has('E') && horizontal;
    if (isArc && !arc && (isExplicit || canInfer)) skippedArcs++;
    if ((!isExplicit && !canInfer) || (isArc && !arc)) {
      run = undefined;
      continue;
    }

    const mode = isExplicit ? explicit : inferred;
    const from = depositedFraction > 0 ? 1 - depositedFraction : 0;
    const point = arc ? arc.point : fraction => interpolate(start, position, fraction);
    if (!run || lastMode !== mode || from > 0) {
      run = [point(from)];
      mode.push(run);
      runTimes = [mix(started, elapsed, from)];
      (isExplicit ? explicitTimes : inferredTimes).push(runTimes);
      if (isExplicit) {
        runAmounts = [];
        extrusion.push(runAmounts);
      }
    }
    const steps = arc ? Math.max(1, Math.ceil(arc.steps * (1 - from))) : 1;
    for (let step = 1; step <= steps; step++) {
      const fraction = mix(from, 1, step / steps);
      run.push(point(fraction));
      runTimes.push(mix(started, elapsed, fraction));
    }
    if (isExplicit) {
      for (let step = 0; step < steps; step++) runAmounts.push(depositedAmount / steps);
    }
    lastMode = mode;
    segmentCount += steps;
    if (segmentCount > maximumSegments) throw new Error('This file exceeds the 300,000-move preview limit. Try a smaller print.');
  }

  const inferExtrusion = !hasExtrusionWords && !motorCommands;
  const paths = inferExtrusion ? inferred : explicit;
  if (!paths.length) {
    const detail = skippedArcs ? ' Preview supports G2 and G3 arcs in the XY plane.' : '';
    throw new Error('No printable moves were found.' + detail);
  }

  const low = [Infinity, Infinity, Infinity];
  const high = [-Infinity, -Infinity, -Infinity];
  for (const path of paths) {
    for (const point of path) {
      point.forEach((value, axis) => {
        low[axis] = Math.min(low[axis], value);
        high[axis] = Math.max(high[axis], value);
      });
    }
  }
  const dimensions = high.map((value, axis) => value - low[axis]);
  if (Math.max(...dimensions) > 1_000_000 || !dimensions.every(Number.isFinite)) {
    throw new Error('The print dimensions exceed the preview range. Check the file units.');
  }
  return { paths, low, high, dimensions, inferExtrusion, skippedArcs,
    extrusion: inferExtrusion ? undefined : extrusion, times: inferExtrusion ? inferredTimes : explicitTimes };
}

export function inspectToolpath(model, nozzle) {
  const alerts = [];
  const firstHeight = model.paths[0][0][2];
  const lowestHeight = model.low[2];
  const tolerance = Math.max(0.05, nozzle * 0.12);
  const height = value => 'Z ' + Number(value.toFixed(2)) + ' mm';

  if (firstHeight - lowestHeight > tolerance) {
    alerts.push('The print starts at ' + height(firstHeight) + ' and later deposits at ' + height(lowestHeight) + '. Check the layer order.');
  } else if (firstHeight > nozzle + tolerance) {
    alerts.push('The first bead is at ' + height(firstHeight) + ', more than one nozzle diameter above Z0. Check the first layer and work offset.');
  }
  if (lowestHeight < -tolerance) {
    alerts.push('The toolpath deposits below Z0 at ' + height(lowestHeight) + '. Check the work offset.');
  }
  const centerX = (model.low[0] + model.high[0]) / 2;
  const centerY = (model.low[1] + model.high[1]) / 2;
  const centerOffset = Math.hypot(centerX, centerY);
  const placementWarning = centerOffset > 50 ? Number(centerOffset.toFixed(2)) + ' mm off center from X0 Y0' : undefined;
  // The preview centers the mesh on the toolpath and maps printer Y to world -Z.
  const placementOrigin = placementWarning ? [-centerX, centerY] : undefined;
  if (model.inferExtrusion) alerts.push('No extrusion commands found. Showing horizontal print moves.');
  if (model.skippedArcs) alerts.push('Some arcs could not be drawn. The preview supports valid XY arcs.');
  return { alerts, placementWarning, placementOrigin };
}
