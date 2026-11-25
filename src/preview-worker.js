import { inspectToolpath, parseGcode } from './gcode.js';
import { makeClayMesh } from './clay.js';

let model;

self.addEventListener('message', ({ data }) => {
  const { type, source, settings } = data;
  try {
    const next = type === 'load' ? parseGcode(source) : model;
    const mesh = makeClayMesh(next, settings);
    model = next;
    const transfers = [mesh.positions.buffer, mesh.indices.buffer];
    if (mesh.analysis) {
      const { nodeIds, cuts, votes, trajectory, sections, centers, failure } = mesh.analysis;
      transfers.push(nodeIds.buffer, cuts.buffer, votes.buffer);
      if (trajectory) transfers.push(trajectory.buffer, sections.buffer, centers.buffer, failure.buffer);
      delete mesh.analysis.tears;
    }
    self.postMessage({
      type,
      mesh,
      alerts: inspectToolpath(model, settings.nozzle),
    }, transfers);
  } catch (error) {
    self.postMessage({ type, error: error.message });
  }
});
