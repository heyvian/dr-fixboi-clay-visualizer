import '@fontsource/archivo-black/latin-400.css';
import '@fontsource/dm-sans/latin-400.css';
import '@fontsource/dm-sans/latin-700.css';
import '@fontsource/ibm-plex-mono/latin-500.css';
import '@fontsource/ibm-plex-mono/latin-700.css';
import './style.css';
import { formatRaisedHeight } from './gcode.js';
import { setupFawnPanel } from './fawn-panel.js';
import { makeOverhangSample, makeSample } from './sample.js';
import { createViewer } from './scene.js';
import { setupRenderPanel } from './render-panel.js';
import { loadSettings, saveSettings } from './settings.js';
import { setupToolpathPanel } from './toolpath-panel.js';
import { setupVicPanel } from './vic-panel.js';

const byId = id => document.getElementById(id);
const nozzle = byId('nozzle');
const viscosity = byId('viscosity');
const gravity = byId('gravity');
const fileInput = byId('file-input');
const browse = byId('browse');
const dropZone = byId('drop-zone');
const restoreSample = byId('restore-sample');
const status = byId('upload-status');
const sceneStatus = byId('scene-status');
const scenePlacement = byId('scene-placement');
const scenePlacementDetail = byId('scene-placement-detail');
const vicLoading = byId('vic-loading');
const sceneError = byId('scene-error');
const cameraButtons = ['zoom-in', 'zoom-out', 'reset-view'].map(byId);
const sampleName = 'sample-vase.gcode';
const sample = makeSample();
const settings = loadSettings();
let schedulePreview = () => {};

nozzle.value = settings.nozzle.toFixed(1);
viscosity.value = settings.viscosity;
gravity.checked = settings.gravity;
document.querySelector('input[name="quality"][value="' + settings.quality + '"]').checked = true;

function updateSimulationSettings() {
  settings.viscosity = viscosity.valueAsNumber;
  settings.gravity = gravity.checked;
  settings.quality = document.querySelector('input[name="quality"]:checked').value;
  byId('quality-note').hidden = settings.quality === 'vic';
  saveSettings(settings);
  schedulePreview();
}

function changeNozzle(commit) {
  const value = nozzle.valueAsNumber;
  const minimum = Number(nozzle.min);
  const maximum = Number(nozzle.max);
  if (!commit && (!Number.isFinite(value) || value < minimum || value > maximum)) return;
  const next = Number.isFinite(value) ? Math.round(Math.min(maximum, Math.max(minimum, value)) * 10) / 10 : settings.nozzle;
  if (commit) nozzle.value = next.toFixed(1);
  settings.nozzle = next;
  updateSimulationSettings();
}

function stepNozzle(direction) {
  nozzle.value = settings.nozzle + direction * 0.1;
  changeNozzle(true);
}

function reflectViscosity() {
  byId('viscosity-value').textContent = viscosity.value + '%';
  viscosity.style.setProperty('--progress', viscosity.value + '%');
}

nozzle.addEventListener('input', () => changeNozzle(false));
nozzle.addEventListener('change', () => changeNozzle(true));
byId('nozzle-smaller').addEventListener('click', () => stepNozzle(-1));
byId('nozzle-larger').addEventListener('click', () => stepNozzle(1));
viscosity.addEventListener('input', () => {
  reflectViscosity();
  updateSimulationSettings();
});
gravity.addEventListener('change', updateSimulationSettings);
byId('quality').addEventListener('change', updateSimulationSettings);
reflectViscosity();

const sampleUrl = URL.createObjectURL(new Blob([sample], { type: 'text/plain' }));
byId('sample-link').href = sampleUrl;
window.addEventListener('pagehide', event => {
  if (!event.persisted) URL.revokeObjectURL(sampleUrl);
});

for (const name of ['help', 'credits']) {
  const dialog = byId(name + '-dialog');
  byId(name + '-button').addEventListener('click', () => dialog.showModal());
  dialog.addEventListener('click', event => {
    if (event.target === dialog) {
      const bounds = dialog.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right
        || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
    }
  });
}

let viewer;
try {
  viewer = createViewer(byId('scene'), byId('axis-key'), byId('drafting'));
} catch {
  sceneError.textContent = 'The 3D preview needs WebGL 2. Try a browser with hardware acceleration enabled.';
  sceneError.hidden = false;
  sceneStatus.textContent = '3D unavailable';
  byId('model-stats').textContent = 'WebGL 2 required';
  cameraButtons.forEach(button => { button.disabled = true; });
}

const renderPanel = setupRenderPanel(viewer, settings);
const fawnPanel = setupFawnPanel(settings);
byId('quality-note').hidden = settings.quality === 'vic';

if (viewer) {
  const vicPanel = setupVicPanel(viewer, () => toolpathPanel.close());
  const toolpathPanel = setupToolpathPanel(viewer, () => vicPanel.close());
  const worker = new Worker(new URL('./preview-worker.js', import.meta.url), { type: 'module' });
  const sizeLimit = 25 * 1024 * 1024;
  let currentName;
  let currentIsSample = false;
  let upcoming;
  let loadingFile = false;
  let busy = false;
  let pendingSettings = false;
  let previewTimer;
  let shownAlerts = [];

  function updateStatus(message, renderError = false) {
    status.textContent = message;
    status.hidden = !message;
    status.dataset.renderError = String(renderError);
  }

  function updateSceneStatus() {
    const working = busy || loadingFile || upcoming || (pendingSettings && currentName);
    toolpathPanel.setBusy(Boolean(working));
    fawnPanel.setBusy(Boolean(working));
    const computingVic = working && settings.quality === 'vic';
    vicLoading.hidden = !computingVic;
    sceneStatus.textContent = working ? (computingVic ? 'Computing VIC…' : 'Building preview…')
      : !currentName ? 'No preview' : gravity.checked ? 'Gravity on' : 'Gravity off';
  }

  function setFileBusy(isBusy) {
    browse.disabled = isBusy;
    restoreSample.disabled = isBusy;
    dropZone.setAttribute('aria-busy', String(isBusy));
  }

  function send(type, source) {
    busy = true;
    if (type === 'load') {
      viewer.clearPlacement();
      showChecks([]);
    }
    vicPanel.begin(settings.quality === 'vic');
    updateSceneStatus();
    const { nozzle, viscosity, gravity, quality } = settings;
    worker.postMessage({
      type,
      source,
      settings: { nozzle, viscosity, gravity, quality },
    });
  }

  function flush() {
    clearTimeout(previewTimer);
    if (busy || loadingFile) return;
    if (upcoming) {
      pendingSettings = false;
      send('load', upcoming.text);
    } else if (pendingSettings && currentName) {
      pendingSettings = false;
      send('render');
    }
  }

  schedulePreview = () => {
    pendingSettings = true;
    vicPanel.begin(settings.quality === 'vic');
    updateSceneStatus();
    clearTimeout(previewTimer);
    previewTimer = setTimeout(flush, 80);
  };

  function showChecks(alerts, placementWarning, raisedHeight) {
    const heightWarning = raisedHeight && formatRaisedHeight(raisedHeight) + ' above Z0';
    const warning = [placementWarning, heightWarning].filter(Boolean).join(' · ');
    scenePlacement.hidden = !warning;
    if (scenePlacementDetail.textContent !== warning) scenePlacementDetail.textContent = warning;
    if (shownAlerts.length === alerts.length && shownAlerts.every((message, index) => message === alerts[index])) return;
    shownAlerts = alerts;
    byId('code-alert-content').hidden = !alerts.length;
    byId('code-alert-list').replaceChildren(...alerts.map(message => {
      const item = document.createElement('li');
      item.textContent = message;
      return item;
    }));
  }

  worker.addEventListener('message', ({ data }) => {
    if (data.type === 'checks') {
      showChecks(data.alerts, data.placementWarning, data.raisedHeight);
      return;
    }
    busy = false;
    const isLoad = data.type === 'load';

    if (data.error) {
      updateStatus(data.error, !isLoad);
      if (!isLoad) fawnPanel.clearCollapse();
      if (settings.quality === 'vic') vicPanel.error();
      if (!currentName) byId('model-stats').textContent = 'Open a G-code file';
    } else {
      if (isLoad) {
        currentName = upcoming.name;
        currentIsSample = upcoming.sample;
        byId('file-name').textContent = currentName;
        byId('file-name').title = currentName;
        restoreSample.hidden = currentIsSample;
      }
      const { dimensions, raisedHeight } = viewer.setMesh(data.mesh, isLoad, data.placementOrigin, data.raisedHeight, data.motion);
      fawnPanel.setMesh(data.mesh, currentName, dimensions);
      toolpathPanel.setDuration(data.mesh.replay?.duration);
      showChecks(data.alerts, data.placementWarning, raisedHeight);
      renderPanel.setMeasurements(dimensions);
      if (isLoad || status.dataset.renderError === 'true') updateStatus('');
      if (!pendingSettings && !loadingFile && (isLoad || !upcoming)) vicPanel.finish(data.mesh.analysis);
      cameraButtons.forEach(button => { button.disabled = false; });
    }

    if (isLoad) {
      upcoming = undefined;
      setFileBusy(false);
    }
    updateSceneStatus();
    flush();
  });

  worker.addEventListener('error', () => {
    busy = false;
    upcoming = undefined;
    pendingSettings = false;
    clearTimeout(previewTimer);
    fawnPanel.clearCollapse();
    if (settings.quality === 'vic') vicPanel.error();
    setFileBusy(false);
    updateStatus('The preview could not start. Reload the page and try again.');
    updateSceneStatus();
  });

  function loadExample(name, text) {
    if (loadingFile || upcoming) return;
    upcoming = { name, text, sample: name === sampleName };
    updateStatus('');
    setFileBusy(true);
    flush();
  }

  async function loadFile(file) {
    if (!file || loadingFile || upcoming) return;
    if (file.size > sizeLimit) {
      updateStatus('Choose a G-code file up to 25 MB.');
      return;
    }
    loadingFile = true;
    setFileBusy(true);
    updateStatus('');
    updateSceneStatus();
    try {
      upcoming = { name: file.name, text: await file.text(), sample: false };
    } catch {
      updateStatus('This file could not be read. Try opening it again.');
      setFileBusy(false);
    } finally {
      loadingFile = false;
      updateSceneStatus();
      flush();
    }
  }

  browse.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    void loadFile(fileInput.files[0]);
    fileInput.value = '';
  });
  restoreSample.addEventListener('click', () => loadExample(sampleName, sample));
  byId('vic-sample').addEventListener('click', () => loadExample('vic-overhang.gcode', makeOverhangSample()));

  for (const eventName of ['dragenter', 'dragover', 'dragleave', 'drop']) {
    dropZone.addEventListener(eventName, event => {
      event.preventDefault();
      const active = eventName === 'dragenter' || eventName === 'dragover';
      if (eventName === 'dragleave' && dropZone.contains(event.relatedTarget)) return;
      dropZone.classList.toggle('is-dragging', active && !loadingFile && !upcoming);
      if (eventName === 'dragover') event.dataTransfer.dropEffect = loadingFile || upcoming ? 'none' : 'copy';
      if (eventName === 'drop') void loadFile(event.dataTransfer.files[0]);
    });
  }

  cameraButtons[0].addEventListener('click', () => viewer.zoom(0.84));
  cameraButtons[1].addEventListener('click', () => viewer.zoom(1 / 0.84));
  cameraButtons[2].addEventListener('click', viewer.reset);
  cameraButtons.forEach(button => { button.disabled = true; });
  loadExample(sampleName, sample);
} else {
  browse.disabled = true;
}
