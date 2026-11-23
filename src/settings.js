import { clayBodies } from './clay-bodies.js';

const key = 'dr-fixboi-clay-visualizer.settings';

function numberOr(value, minimum, maximum, fallback) {
  return Number.isFinite(value) && value >= minimum && value <= maximum ? value : fallback;
}

export function normalizeSettings(saved) {
  const values = saved ?? {};
  return {
    nozzle: numberOr(values.nozzle, 0.2, 30, 2.4),
    viscosity: numberOr(values.viscosity, 0, 100, 65),
    gravity: values.gravity !== false,
    quality: values.quality === 'accurate' ? 'accurate' : 'fast',
    body: Object.hasOwn(clayBodies, values.body) ? values.body : 'm340',
    finish: values.finish === 'fired' ? 'fired' : 'greenware',
    rendering: values.rendering === true,
    drafting: values.drafting === true,
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
