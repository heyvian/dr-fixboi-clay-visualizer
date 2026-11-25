import { vicCauses } from './vic.js';

export function setupVicPanel(viewer) {
  const byId = id => document.getElementById(id);
  const panel = byId('vic-panel');
  const status = byId('vic-status');
  const results = byId('vic-results');
  const hotspots = byId('vic-hotspots');
  const map = byId('vic-map');
  const demo = byId('vic-demo');
  const player = byId('vic-player');
  const play = byId('vic-play');
  const slider = byId('vic-progress');
  const stage = byId('vic-stage');
  const caseNote = byId('vic-case');
  const viewport = byId('viewport');
  let analysis;
  let mode;
  let progress = 0;
  let animation = 0;
  let start = 0;
  const duration = 9500;

  function pause() {
    if (animation) cancelAnimationFrame(animation);
    animation = 0;
    play.textContent = progress >= 1 ? 'Replay' : 'Play';
  }

  function seek(value) {
    progress = value;
    slider.value = String(Math.round(progress * 1000));
    const frame = progress * (analysis.frames - 1);
    const fails = analysis.firstFailure < analysis.frames;
    const loss = frame >= analysis.firstFailure;
    const label = progress >= 1 ? (fails ? 'After collapse' : 'Complete · bead sections held')
      : frame >= analysis.buildFrames ? (loss ? 'Settling after failure' : 'Checking the completed print')
        : loss ? 'Depositing after first failure' : 'Depositing';
    if (stage.textContent !== label) stage.textContent = label;
    slider.setAttribute('aria-valuetext', Math.round(100 * progress) + '% · ' + label);
    viewer.setVicView('demo', progress);
  }

  function tick(time) {
    seek(Math.min(1, (time - start) / duration));
    if (progress < 1) animation = requestAnimationFrame(tick);
    else pause();
  }

  function resume() {
    if (progress >= 1) seek(0);
    start = performance.now() - progress * duration;
    animation = requestAnimationFrame(tick);
    play.textContent = 'Pause';
  }

  function show(view) {
    pause();
    mode = view;
    map.setAttribute('aria-pressed', String(view === 'map'));
    demo.setAttribute('aria-expanded', String(view === 'demo'));
    player.hidden = view !== 'demo';
    caseNote.hidden = view !== 'demo';
    viewport.classList.toggle('vic-view', Boolean(view));
    if (view === 'demo') seek(progress);
    else viewer.setVicView(view);
  }

  function begin(enabled) {
    panel.hidden = !enabled;
    analysis = undefined;
    results.hidden = true;
    status.textContent = enabled ? 'Solving support, sag, and failure cases…' : '';
    show(undefined);
  }

  function finish(result) {
    if (panel.hidden || !result) return;
    analysis = result;
    progress = 0;
    if (!analysis.gravity) {
      status.textContent = 'Enable gravity to evaluate failure and play the demonstration.';
      return;
    }
    const { totalCases } = analysis;
    status.textContent = analysis.hotspots.length
      ? 'Peak hotspot fails in ' + analysis.hotspots[0].cases + ' of ' + totalCases + ' cases.'
      : 'All ' + totalCases + ' tested cases held.';
    hotspots.replaceChildren(...analysis.hotspots.map((spot, index) => {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      const height = Number(spot.z.toFixed(1));
      button.textContent = 'Z ' + height + ' mm · ' + vicCauses[spot.cause] + ' · ' + spot.cases + '/' + totalCases;
      button.setAttribute('aria-label', 'Focus hotspot ' + (index + 1) + ', ' + button.textContent);
      button.addEventListener('click', () => {
        show('map');
        viewer.focusVic(spot);
        viewport.scrollIntoView({ block: 'nearest' });
      });
      item.append(button);
      return item;
    }));
    hotspots.hidden = !analysis.hotspots.length;
    const label = analysis.strength === 1 ? 'Nominal clay case' : 'Softer clay case at ' + Math.round(analysis.strength * 100) + '% of nominal strength and stiffness';
    caseNote.textContent = label + ' · ' + Math.round(analysis.held * 100) + '% of sampled bead sections held.';
    results.hidden = false;
    show('map');
  }

  map.addEventListener('click', () => show(mode === 'map' ? undefined : 'map'));
  demo.addEventListener('click', () => {
    if (mode === 'demo') {
      show('map');
      return;
    }
    progress = 0;
    show('demo');
    viewer.reset();
    viewport.scrollIntoView({ block: 'nearest' });
    resume();
  });
  byId('vic-return').addEventListener('click', () => show('map'));
  slider.addEventListener('input', () => {
    pause();
    seek(slider.valueAsNumber / 1000);
    pause();
  });
  play.addEventListener('click', () => { if (animation) pause(); else resume(); });

  return { begin, finish, error() { status.textContent = 'VIC could not analyze this toolpath.'; } };
}
