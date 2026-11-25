import { inspectToolpath, parseGcode } from './gcode.js';
import { makeClayMesh } from './clay.js';

let model;

self.addEventListener('message', ({ data }) => {
  const { type, source, settings } = data;
  try {
    const next = type === 'load' ? parseGcode(source) : model;
    const { alerts, placementWarning, placementOrigin } = inspectToolpath(next, settings.nozzle);
    self.postMessage({ type: 'checks', alerts, placementWarning });
    const mesh = makeClayMesh(next, settings);
    model = next;
    const transfers = [mesh.positions.buffer, mesh.indices.buffer];
    if (mesh.analysis) {
      const { nodeIds, cuts, votes, trajectory, sections, centers, failure } = mesh.analysis;
      transfers.push(nodeIds.buffer, cuts.buffer, votes.buffer);
      if (trajectory) transfers.push(trajectory.buffer, sections.buffer, centers.buffer, failure.buffer);
      delete mesh.analysis.tears;
    }
    self.postMessage({ type, mesh, placementOrigin }, transfers);
  } catch (error) {
    self.postMessage({ type, error: error.message });
  }
});
