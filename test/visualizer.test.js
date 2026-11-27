import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectToolpath, parseGcode } from '../src/gcode.js';
import { makeClayMesh } from '../src/clay.js';
import { makeOverhangSample, makeSample } from '../src/sample.js';
import { clayBodies, firedScale } from '../src/clay-bodies.js';
import { normalizeSettings } from '../src/settings.js';
import { solveBeadFlow } from '../src/bead-flow.js';
import { createVicContacts } from '../src/vic-contact.js';
import { simulateVic } from '../src/vic.js';
import { getOriginPlacement } from '../src/origin-guide.js';
import { depositedIndexCount, nozzlePosition } from '../src/toolpath.js';
import { exportClayModel } from '../src/fawn-export.js';
import { strFromU8, unzipSync } from 'three/addons/libs/fflate.module.js';

test('draws deposited moves and restarts a bead after travel and retraction', () => {
  const { paths, inferExtrusion, extrusion } = parseGcode(`
    G21
    G90
    M82
    G0 X1 Y3 Z1
    G1 X6 E1
    G1 E0
    G0 X10
    G1 X14 E2
  `);
  assert.deepEqual(paths, [
    [[1, 3, 1], [6, 3, 1]],
    [[12, 3, 1], [14, 3, 1]],
  ]);
  assert.equal(inferExtrusion, false);
  assert.deepEqual(extrusion, [[1], [1]]);
});

test('tracks relative motion, extrusion mode, inches, and coordinate resets', () => {
  const { paths } = parseGcode(`
    G20
    M83
    G90
    G0 X1 Z0.5
    G92 X0
    G1 X1 E0.1
    G91
    X1 E0.1
    G90
    X3 E0.1
  `);
  assert.equal(paths.length, 1);
  assert.deepEqual(paths[0].map(point => point.map(value => Number(value.toFixed(2)))), [
    [25.4, 0, 12.7], [50.8, 0, 12.7], [76.2, 0, 12.7], [101.6, 0, 12.7],
  ]);
});

test('tessellates XY arcs with relative centers and helical Z motion', () => {
  const { paths, skippedArcs } = parseGcode('M83\nG0 X10\nG3 X0 Y10 Z2 I-10 J0 E2');
  assert.equal(skippedArcs, 0);
  assert.deepEqual(paths[0].at(-1), [0, 10, 2]);
  assert.ok(paths[0].length > 9);
  const midpoint = paths[0][Math.floor(paths[0].length / 2)];
  assert.ok(Math.abs(Math.hypot(midpoint[0], midpoint[1]) - 10) < 0.001);
  assert.ok(midpoint[2] > 0.8 && midpoint[2] < 1.2);
});

test('keeps deposited sample timing through modal feed, travel and a dwell', () => {
  const model = parseGcode('G1 F600\nG0 Z1\nG1 X10 E1\nG4 P2500\nG0 X30\nG1 X40 E2');
  assert.deepEqual(model.times.map(run => run.map(time => Number(time.toFixed(2)))), [[0.1, 1.1], [5.6, 6.6]]);
});

test('uses motor-gated clay moves and skips unsupported arcs', () => {
  const { paths, skippedArcs } = parseGcode(`
    G0 X10
    M101
    G1 X20
    G18
    G2 X30 Z5 R10
    G17
    G1 Y10
    M103
    G1 Y20
  `);
  assert.deepEqual(paths, [
    [[10, 0, 0], [20, 0, 0]],
    [[30, 0, 5], [30, 10, 5]],
  ]);
  assert.equal(skippedArcs, 1);
});

test('infers horizontal print moves for files without extrusion commands', () => {
  const { paths, inferExtrusion } = parseGcode('G0 X10 Z1\nG1 X20\nG1 Z2\nG1 X30');
  assert.equal(inferExtrusion, true);
  assert.deepEqual(paths, [
    [[10, 0, 1], [20, 0, 1]],
    [[20, 0, 2], [30, 0, 2]],
  ]);
  assert.throws(() => parseGcode('G0 X5\nM2'), /No printable moves/);
  assert.throws(() => parseGcode('M83\nG1 E1\nG1 X10'), /No printable moves/);
});

test('G-code checks use the first deposited bead and flag out-of-order layers', () => {
  const travelFirst = parseGcode('G0 Z35\nG0 Z0\nG1 X10 E1');
  const seated = inspectToolpath(travelFirst, 2.4);
  assert.deepEqual(seated.alerts, []);
  assert.equal(seated.raisedHeight, 0);
  const printHighFirst = parseGcode('G0 Z8\nG1 X10 E1\nG0 Z1\nG1 X20 E2');
  const outOfOrder = inspectToolpath(printHighFirst, 2.4);
  assert.match(outOfOrder.alerts[0], /starts at Z 8 mm and later deposits at Z 1 mm/);
  assert.equal(outOfOrder.raisedHeight, 0);
});

test('the estimated first layer seats the clay and preserves genuine bed gaps in every preview quality', () => {
  const seated = parseGcode('G0 Z0\nG0 Z2\nG1 X10 E1');
  const raised = parseGcode('G0 Z0\nG0 Z6\nG1 X10 E1');
  assert.equal(inspectToolpath(seated, 4).raisedHeight, 0);
  assert.equal(inspectToolpath(raised, 4).raisedHeight, 4);
  for (const quality of ['fast', 'accurate', 'vic']) {
    for (const [model, expected] of [[seated, 0], [raised, 4]]) {
      const { positions } = makeClayMesh(model, { quality, nozzle: 4, viscosity: 65, gravity: true });
      let bottom = Infinity;
      for (let i = 1; i < positions.length; i += 3) bottom = Math.min(bottom, positions[i]);
      assert.equal(bottom, expected, quality);
    }
  }
  const below = parseGcode('G0 Z-1\nG1 X10 E1');
  const belowBed = inspectToolpath(below, 2.4);
  assert.equal(belowBed.raisedHeight, 0);
  assert.match(belowBed.alerts[0], /deposits below Z0/);
});

test('uses declared first-layer thickness ahead of the nozzle estimate', () => {
  const seated = parseGcode('G0 Z3\nG1 X10 E1\n; first_layer_height = 150%\n; layer_height = 2');
  assert.equal(seated.firstLayerHeight, 3);
  assert.equal(inspectToolpath(seated, 4).raisedHeight, 0);
  const raised = parseGcode('; initial_layer_print_height = 0.5\nG0 Z2\nG1 X10 E1');
  assert.equal(inspectToolpath(raised, 4).raisedHeight, 1.5);
});

test('warns when the deposited footprint is more than 50 mm from the XY origin', () => {
  const alertsFor = (x, y) => inspectToolpath(parseGcode(`
    G0 X500 Y500 Z1
    G0 X${x - 60} Y${y - 20}
    G1 X${x + 60} E1
    G1 Y${y + 20} E2
    G1 X${x - 60} E3
    G1 Y${y - 20} E4
  `), 4);

  assert.deepEqual(alertsFor(0, 0).alerts, []);
  assert.deepEqual(alertsFor(30, 39).alerts, []);
  assert.deepEqual(alertsFor(30, 40), { alerts: [], placementWarning: undefined, placementOrigin: undefined, raisedHeight: 0 });
  assert.deepEqual(alertsFor(-36, 48), {
    alerts: [],
    placementWarning: '60 mm off center from X0 Y0',
    placementOrigin: [36, 48],
    raisedHeight: 0,
  });
});

test('toolpath playback leaves clay unchanged during travel and dwell', () => {
  const model = parseGcode('M83\nG0 Z2 F60\nG1 X10 E1\nG4 P4000\nG1 X20 E1\nG0 Y10\nG1 X30 E1');
  assert.deepEqual(nozzlePosition(model.motionPoints, 14), [10, 0, 2]);
  assert.deepEqual(nozzlePosition(model.motionPoints, 31), [20, 5, 2]);
  for (const quality of ['fast', 'accurate', 'vic']) {
    const { replay, indices } = makeClayMesh(model, { quality, nozzle: 4, gravity: false });
    assert.equal(replay.duration, 44, quality);
    const count = seconds => depositedIndexCount(replay, seconds);
    assert.equal(count(0), 0, quality);
    assert.ok(count(10) > 0, quality);
    assert.equal(count(10), count(14), quality);
    assert.ok(count(18) > count(14), quality);
    assert.equal(count(24), count(33), quality);
    assert.equal(count(44), indices.length, quality);
  }
});

test('the origin guide uses the clay radius and true XY bearing and distance', () => {
  const vertices = [-10, 0, 0, 0, 26, -10, 12, 5, 9, 0, 10, 10];
  assert.deepEqual(getOriginPlacement(vertices, [600, -800]), {
    radius: 15, direction: [0.6, -0.8], distance: 1000,
  });
  assert.equal(getOriginPlacement(vertices), undefined);
});

test('VIC keeps a short vertical wall standing and demonstrates a failed overhang', () => {
  const options = { nozzle: 4, viscosity: 65, gravity: true, quality: 'vic' };
  const wall = Array.from({ length: 12 }, (_, i) => 'G0 Y0 Z' + (1 + 2.5 * i) + '\nG1 Y50 E10').join('\n');
  const stable = makeClayMesh(parseGcode('M83\n' + wall), options).analysis;
  assert.equal(stable.held, 1);
  assert.equal(stable.hotspots.length, 0);
  assert.equal(stable.deposited, stable.votes.length);
  assert.equal(stable.stopped, false);
  const result = makeClayMesh(parseGcode(makeOverhangSample()), options);
  const { analysis, replay } = result;
  assert.equal(analysis.hotspots[0].cases, analysis.totalCases);
  assert.ok(analysis.firstFailure > 1 && analysis.firstFailure < analysis.frames);
  assert.equal(analysis.firstFailure, analysis.buildFrames);
  assert.ok(analysis.held > 0 && analysis.held < 1);
  assert.equal(analysis.stopped, true);
  assert.ok(analysis.deposited > 0 && analysis.deposited < analysis.votes.length);
  const stop = analysis.times[analysis.buildFrames] - replay.start;
  assert.ok(depositedIndexCount(replay, stop) > 0);
  assert.ok(depositedIndexCount(replay, stop) < result.indices.length);
  assert.equal(analysis.nodeIds.length, result.positions.length / 3);
  assert.equal(analysis.centers[1], 0);
  assert.equal(analysis.times.length, analysis.frames);
  assert.equal(analysis.sections.length, analysis.frames * analysis.votes.length * 2);
  const lastFrame = analysis.trajectory.subarray((analysis.frames - 1) * analysis.votes.length * 4);
  let landed = false;
  for (let i = 0; i < analysis.votes.length; i++) {
    assert.equal(lastFrame[i * 4 + 3], Number(i < analysis.deposited));
    const base = analysis.centers[i * 3 + 1];
    const settled = base + lastFrame[i * 4 + 1];
    assert.ok(settled >= -0.001);
    if (base > 20 && settled < 0.01) landed = true;
  }
  assert.ok(landed);

  const gravityOff = makeClayMesh(parseGcode(makeOverhangSample()), { ...options, gravity: false }).analysis;
  assert.equal(gravityOff.trajectory, undefined);
  assert.equal(gravityOff.votes.some(Boolean), false);
  assert.equal(normalizeSettings({ quality: 'vic' }).quality, 'vic');
});

test('VIC catches a growing cantilever before it can reach its next pillar', () => {
  const width = 25;
  const floor = Array.from({ length: 2600 }, (_, x) => [x, -40, 0]);
  const runs = [{ points: floor, times: floor.map((_, x) => x / 20) }];
  for (let layer = 0; layer < 3; layer++) {
    for (const x of [0, width]) {
      const time = 132 + runs.length;
      runs.push({ points: [[x, -1, layer * 2.5], [x, 1, layer * 2.5]], times: [time, time + 0.1] });
    }
  }
  const points = Array.from({ length: width + 1 }, (_, x) => [x, 0, 7.5]);
  const times = points.map((_, x) => 141 + x / 20);
  const result = simulateVic([...runs, { points, times }], { diameter: 4, stiffness: 0.7, gravity: true });
  const stop = result.times[result.firstFailure];
  assert.equal(result.stopped, true);
  assert.ok(times.includes(stop));
  assert.ok(stop > times[0] && stop < times[width - 4]);
  assert.ok(result.failure.subarray(floor.length + 12, result.deposited).some(Boolean));
  assert.equal(result.failure.subarray(result.deposited).some(Boolean), false);
});

test('VIC checks the existing clay during a G-code dwell before adding more', () => {
  const model = parseGcode('M83\nG1 X10 E2 F600\nG4 S8\nG1 X20 E2');
  const { analysis, replay } = makeClayMesh(model, { nozzle: 4, viscosity: 65, gravity: true, quality: 'vic' });
  const before = depositedIndexCount(replay, 2);
  const during = analysis.times.filter(time => time - replay.start > 2 && time - replay.start < 8);
  assert.ok(during.length > 2);
  for (const time of during) assert.equal(depositedIndexCount(replay, time - replay.start), before);
  assert.equal(analysis.deposited, analysis.votes.length);
});

test('VIC debris stacks on other falling clay and slides sideways against a wall', () => {
  const nodes = [0, 1].map(run => ({ run, length: 0, width: 4, height: 3, volume: 10 }));
  const position = new Float32Array([0, 0, 0, 0.4, 0, -0.25]);
  const previousZ = new Float32Array([0, 3.5]);
  const velocity = new Float32Array([0, 0, 0, 0, 0, -360]);
  const contacts = createVicContacts(nodes, 4, position, previousZ, velocity);
  contacts.rebuild(2, [5, 5], [10, 10], [0, 0]);
  assert.equal(contacts.settle(1), 360);
  assert.ok(position[5] > 2);
  assert.equal(velocity[5], 0);

  position.set([2, 0, 0.6], 3);
  previousZ[1] = 0.6;
  contacts.rebuild(2, [0, 5], [10, 10], [0, 0]);
  contacts.settle(1);
  assert.ok(position[3] > 2.2);
  assert.ok(Math.abs(position[5] - 0.6) < 0.00001);
});

function meshSize({ positions, indices }) {
  assert.ok(positions.length);
  assert.ok(indices.length);
  assert.ok(indices.every(index => index < positions.length / 3));
  const low = [Infinity, Infinity, Infinity];
  const high = [-Infinity, -Infinity, -Infinity];
  positions.forEach((value, index) => {
    const axis = index % 3;
    low[axis] = Math.min(low[axis], value);
    high[axis] = Math.max(high[axis], value);
  });
  return high.map((value, axis) => value - low[axis]);
}

test('changes bead width with nozzle diameter or softer clay, even with gravity off', () => {
  const model = parseGcode('G0 Z1\nG1 X10 E1');
  const thinner = meshSize(makeClayMesh(model, { nozzle: 2, viscosity: 65, gravity: false }));
  const wider = meshSize(makeClayMesh(model, { nozzle: 4, viscosity: 65, gravity: false }));
  const softer = meshSize(makeClayMesh(model, { nozzle: 2, viscosity: 20, gravity: false }));
  assert.ok(wider[2] > thinner[2] * 1.9);
  assert.ok(softer[2] > thinner[2]);
  assert.ok(softer[1] < thinner[1]);
});

test('compresses the sample vase with gravity and responds to viscosity', () => {
  const model = parseGcode(makeSample());
  const measure = (viscosity, gravity) => meshSize(makeClayMesh(model, { nozzle: 2.4, viscosity, gravity }));
  const stiff = measure(100, true);
  const soft = measure(20, true);
  const withoutGravity = measure(20, false);
  assert.ok(soft[1] < stiff[1]);
  assert.ok(soft[1] < withoutGravity[1]);
  assert.ok(soft[0] > withoutGravity[0]);
  assert.equal(soft.every(Number.isFinite), true);
});

test('Accurate adds bead detail while preserving the dimensions of the toolpath', () => {
  const model = parseGcode('G0 Z1\nG1 X30 E1');
  const settings = { nozzle: 6, viscosity: 100, gravity: false };
  const fast = makeClayMesh(model, settings);
  const accurate = makeClayMesh(model, { ...settings, quality: 'accurate' });
  assert.ok(accurate.indices.length > fast.indices.length * 2);
  assert.deepEqual(meshSize(accurate), meshSize(fast));
});

test('Accurate carries deposition spacing across collinear G-code moves', () => {
  const settings = { nozzle: 6, viscosity: 60, gravity: true, quality: 'accurate' };
  const whole = makeClayMesh(parseGcode('M83\nG0 Z1\nG1 X30 E3'), settings);
  const split = makeClayMesh(parseGcode('M83\nG0 Z1\nG1 X7.5 E0.75\nG1 X21 E1.35\nG1 X30 E0.9'), settings);
  assert.equal(split.positions.length, whole.positions.length);
  assert.deepEqual(split.indices, whole.indices);
  assert.ok(split.positions.every((value, i) => Math.abs(value - whole.positions[i]) < 1e-5));
});

test('Accurate uses relative extrusion to vary deposited bead width', () => {
  const model = parseGcode('M83\nG0 Z1\nG1 X12 E0.5\nG1 X24 E1.5');
  const settings = { nozzle: 6, viscosity: 60, gravity: false };
  function widths(quality) {
    const { positions } = makeClayMesh(model, { ...settings, quality });
    const width = [0, 0];
    for (let i = 0; i < positions.length; i += 3) {
      const x = positions[i];
      if (Math.abs(x) > 3) {
        const half = Number(x > 0);
        width[half] = Math.max(width[half], Math.abs(positions[i + 2]));
      }
    }
    return width;
  }
  const [fastLeft, fastRight] = widths('fast');
  const [accurateLeft, accurateRight] = widths('accurate');
  assert.equal(fastLeft, fastRight);
  assert.ok(accurateRight > accurateLeft * 1.5);
});

test('fully stiff clay produces the same mesh with gravity on or off', () => {
  const model = parseGcode('G0 Z1\nG1 X20 E1\nG0 Y5 Z5\nG1 X0 E2');
  const settings = { nozzle: 6, viscosity: 100, quality: 'accurate' };
  const gravityOn = makeClayMesh(model, { ...settings, gravity: true });
  const gravityOff = makeClayMesh(model, { ...settings, gravity: false });
  assert.deepEqual(gravityOn, gravityOff);
});

test('the yield-stress solver moves clay downhill and conserves bead volume', () => {
  const path = [[0, 0, 0], [4, 0, 2], [8, 0, 4], [12, 0, 6]];
  const { area } = solveBeadFlow(path, {
    diameter: 6, buildHeight: 6, softness: 0.8, gaps: [0, 0, 0, 0], unsupportedLength: [0, 0, 0, 0], closed: false,
  });
  assert.ok(area[0] > 1.01);
  assert.ok(area[3] < 0.99);
  const weightedVolume = area[0] / 2 + area[1] + area[2] + area[3] / 2;
  assert.ok(Math.abs(weightedVolume - 3) < 1e-9);
});

test('the yield-stress solver holds its shape below the flow threshold', () => {
  const path = [[0, 0, 0], [4, 0, 0.1], [8, 0, 0.2]];
  const { area } = solveBeadFlow(path, {
    diameter: 6, buildHeight: 0.2, softness: 0.1, gaps: [0, 0, 0], unsupportedLength: [0, 0, 0], closed: false,
  });
  assert.deepEqual([...area], [1, 1, 1]);
});

test('near-closed perimeters share a seam ring while rising paths retain end caps', () => {
  const settings = { nozzle: 6, viscosity: 100, gravity: false };
  const perimeter = 'M83\nG0 Z1\nG1 X30 E1\nG1 Y30 E1\nG1 X0 E1\n';
  const closed = makeClayMesh(parseGcode(perimeter + 'G1 Y0.3 E1'), settings);
  const rising = makeClayMesh(parseGcode(perimeter + 'G1 Y0.3 Z1.4 E1'), settings);
  assert.equal(closed.indices.length, closed.positions.length * 2);
  assert.equal(rising.indices.length, rising.positions.length * 2 - 12);
});

test('a corner ring stays aligned when the incoming toolpath point is closer', () => {
  function cornerRing(moves) {
    const model = parseGcode('M83\nG0 X-12 Z1\n' + moves + '\nG1 X0 E1\nG1 Y12 E1');
    const { positions } = makeClayMesh(model, { nozzle: 6, viscosity: 100, gravity: false });
    const ringSize = 12 * 3;
    for (let i = 0; i + ringSize <= positions.length; i += ringSize) {
      const ring = positions.slice(i, i + ringSize);
      const centerX = ring.reduce((sum, value, axis) => sum + (axis % 3 === 0 ? value : 0), 0) / 12;
      const centerZ = ring.reduce((sum, value, axis) => sum + (axis % 3 === 2 ? value : 0), 0) / 12;
      if (Math.abs(centerX - 6) < 0.001 && Math.abs(centerZ - 6) < 0.001) return ring;
    }
    assert.fail('Corner ring was not found');
  }
  assert.deepEqual(cornerRing(''), cornerRing('G1 X-0.25 E1'));
});

test('soft clay sags more across a longer unsupported span when gravity is on', () => {
  function centerTop(span, gravity) {
    const model = parseGcode(`M83
      G0 X0 Z1
      G1 X1 E1
      G0 X0 Z5
      G1 X1 E1
      G0 X${span} Z1
      G1 X${span + 1} E1
      G0 X${span} Z5
      G1 X${span + 1} E1
      G0 X0 Z9
      G1 X${span} E1`);
    const { positions } = makeClayMesh(model, { nozzle: 6, viscosity: 20, gravity, quality: 'accurate' });
    let top = 0;
    for (let vertex = 0; vertex < positions.length; vertex += 3) {
      if (Math.abs(positions[vertex] + 0.5) < 2.5) top = Math.max(top, positions[vertex + 1]);
    }
    return top;
  }
  assert.equal(centerTop(12, false), centerTop(38, false));
  assert.ok(centerTop(12, true) > centerTop(38, true) + 0.5);
  assert.ok(centerTop(38, false) > centerTop(38, true));
});

test('fired dimensions compound drying and firing shrinkage', () => {
  assert.ok(Math.abs(firedScale(clayBodies.m340) - 0.8789) < 0.000001);
  assert.ok(Math.abs(firedScale(clayBodies.polarIce) - 0.84976) < 0.000001);
});

test('FAWN exports indexed clay in millimeters, Z-up, and scaled for firing', async () => {
  const positions = new Float32Array([1, 15, 2, 3, 15, 2, 1, 19, 2, 1, 15, 5]);
  const indices = new Uint32Array([0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3]);
  const stl = await exportClayModel({ positions, indices, format: 'stl', scale: 1 }).arrayBuffer();
  const data = new DataView(stl);
  assert.equal(stl.byteLength, 84 + 4 * 50);
  assert.equal(data.getUint32(80, true), 4);
  assert.deepEqual(Array.from({ length: 9 }, (_, axis) => data.getFloat32(96 + 4 * axis, true)),
    [1, -2, 0, 1, -2, 4, 3, -2, 0]);
  const step = await exportClayModel({ positions, indices, format: 'step', scale: 0.5 }).text();
  assert.match(step, /SI_UNIT\(\.MILLI\.,\.METRE\.\)/);
  assert.match(step, /COORDINATES_LIST\('',4,\(\n\(0\.5,-1\.,0\.\),\n\(1\.5,-1\.,0\.\),\n\(0\.5,-1\.,2\.\)/);
  assert.match(step, /TRIANGULATED_SURFACE_SET\('',#16,4,\(\),\(\),\(\n\(1,3,2\)/);
});

test('PSH Dark Granite uses the published total cone 6 shrinkage', () => {
  assert.equal(firedScale(clayBodies.darkGranite), 0.875);
});

test('FAWN bundles UV-mapped OBJ geometry with its clay material and PNG maps', async () => {
  const positions = new Float32Array([1, 15, 2, 3, 15, 2, 1, 19, 2, 1, 15, 5]);
  const indices = new Uint32Array([0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3]);
  const file = exportClayModel({ positions, indices, format: 'obj', scale: 0.5, finish: clayBodies.darkGranite.fired });
  const entries = unzipSync(new Uint8Array(await file.arrayBuffer()));
  const obj = strFromU8(entries['clay.obj']);
  const mtl = strFromU8(entries['clay.mtl']);
  assert.match(obj, /^mtllib clay\.mtl$/m);
  assert.match(obj, /^v 0\.500000 -1\.000000 0\.000000$/m);
  assert.match(obj, /^vt /m);
  assert.match(obj, /^vn /m);
  assert.match(obj, /^f 1\/\d+\/1 3\/\d+\/3 2\/\d+\/2$/m);
  assert.match(mtl, /^map_Kd clay-color\.png$/m);
  assert.match(mtl, /^map_Pr clay-roughness\.png$/m);
  assert.match(mtl, /^map_Bump clay-normal\.png$/m);
  for (const channel of ['color', 'roughness', 'normal', 'bump']) {
    const bytes = entries['clay-' + channel + '.png'];
    assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    const dimensions = new DataView(bytes.buffer, bytes.byteOffset);
    assert.equal(dimensions.getUint32(16), 1024);
    assert.equal(dimensions.getUint32(20), 1024);
  }
});

test('restores saved controls and uses Fast for a first visit', () => {
  const settings = normalizeSettings();
  assert.equal(settings.nozzle, 4);
  assert.equal(settings.quality, 'fast');
  assert.equal(settings.body, 'darkGranite');
  assert.equal(settings.finish, 'greenware');
  assert.equal(settings.renderQuality, 'low');
  assert.equal(settings.fawnStage, 'pre-fired');
  assert.equal(settings.fawnFormat, 'stl');
  assert.equal(normalizeSettings({ fawnFormat: 'obj' }).fawnFormat, 'obj');
  const saved = {
    nozzle: 6, viscosity: 83, gravity: false, quality: 'accurate',
    body: 'm390', finish: 'fired', rendering: true, renderQuality: 'high', drafting: true, comparing: true,
    fawnStage: 'fired', fawnFormat: 'step',
  };
  assert.deepEqual(normalizeSettings(JSON.parse(JSON.stringify(saved))), saved);
  assert.deepEqual(normalizeSettings({ nozzle: 70, quality: 'other', body: '__proto__' }), settings);
});
