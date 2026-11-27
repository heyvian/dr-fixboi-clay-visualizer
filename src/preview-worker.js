import { inspectToolpath, parseGcode } from './gcode.js';
import { makeClayMesh } from './clay.js';

let model;

self.addEventListener('message', ({ data }) => {
  const { type, source, settings } = data;
  try {
    const next = type === 'load' ? parseGcode(source) : model;
    const { alerts, placementWarning, placementOrigin, raisedHeight } = inspectToolpath(next, settings.nozzle);
    self.postMessage({ type: 'checks', alerts, placementWarning, raisedHeight });
    const mesh = makeClayMesh(next, settings);
    model = next;
    const transfers = [mesh.positions.buffer, mesh.indices.buffer];
    if (mesh.collapse) transfers.push(mesh.collapse.positions.buffer, mesh.collapse.indices.buffer);
    if (mesh.replay) transfers.push(mesh.replay.times.buffer, mesh.replay.indexEnds.buffer);
    if (mesh.analysis) {
      const { nodeIds, cuts, votes, trajectory, sections, centers, tangents, failure, times } = mesh.analysis;
      transfers.push(nodeIds.buffer, cuts.buffer, votes.buffer);
      if (trajectory) transfers.push(trajectory.buffer, sections.buffer, centers.buffer, tangents.buffer, failure.buffer, times.buffer);
      delete mesh.analysis.tears;
    }
    const motion = type === 'load' ? next.motionPoints : undefined;
    self.postMessage({ type, quality: settings.quality, mesh, alerts, placementWarning, placementOrigin, raisedHeight, motion }, transfers);
  } catch (error) {
    self.postMessage({ type, error: error.message });
  }
});
