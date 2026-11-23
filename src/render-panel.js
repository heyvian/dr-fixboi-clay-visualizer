import { clayBodies, firedScale } from './clay-bodies.js';
import { formatLength } from './dimensions.js';
import { saveSettings } from './settings.js';

export function setupRenderPanel(viewer, settings) {
  const dimensionToggle = document.getElementById('dimension-toggle');
  const modelStats = document.getElementById('model-stats');
  const renderButton = document.getElementById('render-button');
  const compareButton = document.getElementById('compare-button');
  const comparisonKey = document.getElementById('comparison-key');
  const viewport = document.getElementById('viewport');
  const bodySelect = document.getElementById('clay-body');
  const reference = document.getElementById('clay-reference');
  const printedRow = document.getElementById('printed-sizes');
  const firedRow = document.getElementById('fired-sizes');
  const shrinkageNote = document.getElementById('shrinkage-note');
  const percent = new Intl.NumberFormat(undefined, { style: 'percent', maximumFractionDigits: 1 });
  const stages = ['greenware', 'fired'];
  let dimensions;
  let scale;
  const isComparing = () => Boolean(viewer && settings.comparing);
  const isFired = () => isComparing() || settings.finish === 'fired';

  for (const [id, body] of Object.entries(clayBodies)) {
    bodySelect.add(new Option(body.name, id));
  }
  bodySelect.value = settings.body;
  renderButton.disabled = !viewer;

  function showMeasurements() {
    if (!dimensions) return;
    const lengths = dimensions.map(formatLength);
    const firedLengths = dimensions.map(value => formatLength(value * scale));
    lengths.forEach((length, index) => {
      printedRow.cells[index + 1].textContent = length;
      firedRow.cells[index + 1].textContent = firedLengths[index];
    });
    const current = isFired() ? firedLengths : lengths;
    modelStats.textContent = current.join(' × ') + ' mm';
  }

  function updateAppearance() {
    const body = clayBodies[settings.body];
    const fired = isFired();
    const stage = fired ? 'fired' : 'greenware';
    const comparing = isComparing();
    scale = firedScale(body);
    reference.href = body.reference;
    shrinkageNote.textContent = percent.format(1 - scale) + ' estimated linear shrinkage from print to firing.';
    printedRow.classList.toggle('current-stage', !fired);
    firedRow.classList.toggle('current-stage', fired);
    document.getElementById('stage-' + stage).checked = true;
    compareButton.setAttribute('aria-pressed', String(comparing));
    comparisonKey.hidden = !comparing;

    for (const stage of stages) {
      const swatch = document.getElementById('swatch-' + stage);
      swatch.style.setProperty('--clay-swatch', body[stage].color);
      swatch.style.setProperty('--fleck', body[stage].fleck ?? 'transparent');
    }

    const rendering = Boolean(viewer && settings.rendering);
    renderButton.setAttribute('aria-pressed', String(rendering));
    viewport.classList.toggle('material-view', rendering);
    viewer?.setScale(fired ? scale : 1);
    viewer?.setAppearance(rendering ? body[stage] : undefined);
    viewer?.setComparison(comparing);
    updateDrafting();
    showMeasurements();
  }

  function updateDrafting() {
    dimensionToggle.disabled = !viewer || isComparing();
    dimensionToggle.setAttribute('aria-pressed', String(settings.drafting || isComparing()));
    viewer?.setDrafting(settings.drafting);
  }

  function showViewport() {
    const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    viewport.scrollIntoView({ block: 'nearest', behavior: reduceMotion ? 'instant' : 'smooth' });
  }

  dimensionToggle.addEventListener('click', () => {
    settings.drafting = !settings.drafting;
    saveSettings(settings);
    updateDrafting();
  });
  bodySelect.addEventListener('change', () => {
    settings.body = bodySelect.value;
    saveSettings(settings);
    updateAppearance();
  });
  document.getElementById('clay-stage').addEventListener('change', event => {
    settings.finish = event.target.value;
    settings.comparing = false;
    saveSettings(settings);
    updateAppearance();
  });
  renderButton.addEventListener('click', () => {
    settings.rendering = !settings.rendering;
    saveSettings(settings);
    updateAppearance();
    if (settings.rendering) showViewport();
  });
  compareButton.addEventListener('click', () => {
    settings.comparing = !settings.comparing;
    saveSettings(settings);
    updateAppearance();
    if (settings.comparing) showViewport();
  });

  updateAppearance();
  return {
    setMeasurements(size) {
      dimensions = size;
      compareButton.disabled = !viewer;
      showMeasurements();
    },
  };
}
