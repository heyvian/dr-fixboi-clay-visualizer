import { clayBodies, firedScale } from './clay-bodies.js';
import { formatLength } from './dimensions.js';
import { saveSettings } from './settings.js';

export function setupFawnPanel(settings) {
  const form = document.getElementById('fawn-form');
  const button = document.getElementById('fawn-download');
  const dimensions = document.getElementById('fawn-dimensions');
  const formatNote = document.getElementById('fawn-format-note');
  const status = document.getElementById('fawn-status');
  let current;
  let busy = false;
  let exporting = false;

  form.elements.fawnStage.value = settings.fawnStage;
  form.elements.fawnFormat.value = settings.fawnFormat;

  function scale() {
    return settings.fawnStage === 'fired' ? firedScale(clayBodies[settings.body]) : 1;
  }

  function refresh() {
    button.disabled = !current || busy || exporting;
    button.textContent = exporting ? 'Preparing file…' : 'Download ' + settings.fawnFormat.toUpperCase();
    dimensions.textContent = current
      ? current.size.map(length => formatLength(length * scale())).join(' × ') + ' mm'
      : 'Load a model to export.';
    formatNote.textContent = settings.fawnFormat === 'step'
      ? 'Faceted STEP (AP242). Requires a CAD app that supports tessellated STEP.'
      : 'Binary STL in millimeters. Merge intersecting beads in your slicer if needed.';
  }

  form.addEventListener('change', () => {
    settings.fawnStage = form.elements.fawnStage.value;
    settings.fawnFormat = form.elements.fawnFormat.value;
    status.textContent = '';
    saveSettings(settings);
    refresh();
  });
  document.getElementById('clay-body').addEventListener('change', refresh);

  form.addEventListener('submit', event => {
    event.preventDefault();
    if (button.disabled) return;
    const { positions, indices, name } = current;
    const { fawnFormat: format, fawnStage: stage } = settings;
    const stem = name.replace(/\.[^.]+$/, '').replace(/[^a-z0-9._-]+/gi, '-').slice(0, 96) || 'clay-model';
    const filename = stem + '-' + stage + '.' + format;
    exporting = true;
    status.textContent = '';
    refresh();
    let worker;

    function finish(message) {
      worker?.terminate();
      exporting = false;
      status.textContent = message;
      refresh();
    }

    try {
      worker = new Worker(new URL('./fawn-worker.js', import.meta.url), { type: 'module' });
      worker.addEventListener('error', () => finish('Could not prepare the file. Try exporting again.'), { once: true });
      worker.addEventListener('message', ({ data }) => {
        if (data.error) {
          finish(data.error);
          return;
        }
        const url = URL.createObjectURL(data.file);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.append(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 30_000);
        finish('Download started.');
      }, { once: true });
      worker.postMessage({ positions, indices, format, scale: scale() });
    } catch {
      finish('Could not prepare the file. Try exporting again.');
    }
  });

  refresh();
  return {
    setMesh({ positions, indices }, name, size) {
      current = indices.length ? { positions, indices, name, size } : undefined;
      status.textContent = '';
      refresh();
    },
    setBusy(working) {
      busy = working;
      refresh();
    },
  };
}
