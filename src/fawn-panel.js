import { clayBodies, firedScale } from './clay-bodies.js';
import { formatLength } from './dimensions.js';
import { saveSettings } from './settings.js';

export function setupFawnPanel(settings) {
  const form = document.getElementById('fawn-form');
  const button = document.getElementById('fawn-download');
  const dimensions = document.getElementById('fawn-dimensions');
  const collapse = document.getElementById('fawn-collapse');
  const sourceNote = document.getElementById('fawn-source-note');
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

  function selectedMesh() {
    return form.elements.fawnSource.value === 'collapse' ? current?.collapse : current;
  }

  function refresh() {
    const vicEnabled = settings.quality === 'vic' && settings.gravity;
    const available = vicEnabled && Boolean(current?.collapse);
    collapse.disabled = !available || busy;
    form.elements.fawnSource.value = available ? settings.fawnSource : 'preview';
    sourceNote.textContent = !vicEnabled ? 'Turn on VIC and gravity to export a collapse.'
      : busy ? 'Waiting for VIC…' : available ? 'Exports the settled shape and fallen pieces.'
        : current ? 'VIC found no collapse to export.' : 'Load a print to run VIC.';
    const mesh = selectedMesh();
    button.disabled = !mesh || busy || exporting;
    const label = settings.fawnFormat === 'obj' ? 'OBJ ZIP' : settings.fawnFormat.toUpperCase();
    button.textContent = exporting ? 'Preparing file…' : 'Download ' + label;
    dimensions.textContent = mesh
      ? mesh.size.map(length => formatLength(length * scale())).join(' × ') + ' mm'
      : 'Load a model to export.';
    const notes = {
      stl: 'Binary STL in millimeters. Merge intersecting beads in your slicer if needed.',
      step: 'Faceted STEP (AP242). Requires a CAD app that supports tessellated STEP.',
      obj: 'Unzip before opening the OBJ. Includes material, color, roughness, normal, and bump maps.',
    };
    formatNote.textContent = notes[settings.fawnFormat];
  }

  form.addEventListener('change', event => {
    settings.fawnStage = form.elements.fawnStage.value;
    settings.fawnFormat = form.elements.fawnFormat.value;
    if (event.target.name === 'fawnSource') settings.fawnSource = form.elements.fawnSource.value;
    status.textContent = '';
    saveSettings(settings);
    refresh();
  });
  document.getElementById('clay-body').addEventListener('change', refresh);

  form.addEventListener('submit', event => {
    event.preventDefault();
    if (button.disabled) return;
    const { positions, indices } = selectedMesh();
    const { name } = current;
    const { fawnFormat: format, fawnStage: stage } = settings;
    const stem = name.replace(/\.[^.]+$/, '').replace(/[^a-z0-9._-]+/gi, '-').slice(0, 96) || 'clay-model';
    const variant = form.elements.fawnSource.value === 'collapse' ? '-vic-collapse' : '';
    const filename = stem + variant + '-' + stage + (format === 'obj' ? '-obj.zip' : '.' + format);
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
      const body = clayBodies[settings.body];
      worker.postMessage({ positions, indices, format, scale: scale(), finish: body[stage === 'fired' ? 'fired' : 'greenware'] });
    } catch {
      finish('Could not prepare the file. Try exporting again.');
    }
  });

  refresh();
  return {
    setMesh({ positions, indices, collapse }, name, size) {
      current = indices.length ? { positions, indices, collapse, name, size } : undefined;
      status.textContent = '';
      refresh();
    },
    setBusy(working) {
      busy = working;
      refresh();
    },
    clearCollapse() {
      if (current) current.collapse = undefined;
      refresh();
    },
  };
}
