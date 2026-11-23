import assert from 'node:assert/strict';
import test from 'node:test';
import { parseGcode } from '../src/gcode.js';
import { makeClayMesh } from '../src/clay.js';
import { makeSample } from '../src/sample.js';

test('draws deposited moves and restarts a bead after travel and retraction', () => {
  const { paths, inferExtrusion } = parseGcode(`
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

test('fully stiff clay produces the same mesh with gravity on or off', () => {
  const model = parseGcode('G0 Z1\nG1 X20 E1\nG0 Y5 Z5\nG1 X0 E2');
  const settings = { nozzle: 6, viscosity: 100, quality: 'accurate' };
  const gravityOn = makeClayMesh(model, { ...settings, gravity: true });
  const gravityOff = makeClayMesh(model, { ...settings, gravity: false });
  assert.deepEqual(gravityOn, gravityOff);
});
