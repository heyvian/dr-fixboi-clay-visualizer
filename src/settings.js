import { clayBodies } from './clay-bodies.js';

export const defaultNozzle = 4;

const key = 'dr-fixboi-clay-visualizer.settings';

function numberOr(value, minimum, maximum, fallback) {
  return Number.isFinite(value) && value >= minimum && value <= maximum ? value : fallback;
}

export function normalizeSettings(saved) {
  const values = saved ?? {};
  return {
    nozzle: numberOr(values.nozzle, 0.2, 30, defaultNozzle),
    viscosity: numberOr(values.viscosity, 0, 100, 65),
    gravity: values.gravity !== false,
    quality: ['accurate', 'vic'].includes(values.quality) ? values.quality : 'fast',
    body: Object.hasOwn(clayBodies, values.body) ? values.body : 'darkGranite',
    finish: values.finish === 'fired' ? 'fired' : 'greenware',
    rendering: values.rendering === true,
    renderQuality: values.renderQuality === 'high' ? 'high' : 'low',
    drafting: values.drafting === true,
    comparing: values.comparing === true,
    fawnSource: values.fawnSource === 'collapse' ? 'collapse' : 'preview',
    fawnStage: values.fawnStage === 'fired' ? 'fired' : 'pre-fired',
    fawnFormat: ['step', 'obj'].includes(values.fawnFormat) ? values.fawnFormat : 'stl',
  };
}

export function loadSettings() {
  try {
    return normalizeSettings(JSON.parse(localStorage.getItem(key)));
  } catch {
    return normalizeSettings();
  }
}

export function saveSettings(settings) {
  try {
    localStorage.setItem(key, JSON.stringify(settings));
  } catch {
    // The current session still works when the browser blocks storage.
  }
}
