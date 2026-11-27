import { exportClayModel } from './fawn-export.js';

self.addEventListener('message', ({ data }) => {
  try {
    self.postMessage({ file: exportClayModel(data) });
  } catch (error) {
    self.postMessage({ error: error.message });
  }
});
