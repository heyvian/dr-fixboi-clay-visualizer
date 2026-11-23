import { inspectToolpath, parseGcode } from './gcode.js';
import { makeClayMesh } from './clay.js';

let model;

self.addEventListener('message', ({ data }) => {
  const { type, source, settings } = data;
  try {
    const next = type === 'load' ? parseGcode(source) : model;
    const mesh = makeClayMesh(next, settings);
    model = next;
    self.postMessage({
      type,
      mesh,
      alerts: inspectToolpath(model, settings.nozzle),
    }, [mesh.positions.buffer, mesh.indices.buffer]);
  } catch (error) {
    self.postMessage({ type, error: error.message });
  }
});
