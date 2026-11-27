import { vicCauses } from './vic.js';
import { formatLength } from './dimensions.js';

export function setupVicPanel(viewer, { closeToolpath, onPlaybackChange }) {
  const byId = id => document.getElementById(id);
  const panel = byId('vic-panel');
  const status = byId('vic-status');
  const results = byId('vic-results');
  const hotspots = byId('vic-hotspots');
  const map = byId('vic-map');
  const settled = byId('vic-settled');
  const demo = byId('vic-demo');
  const player = byId('vic-player');
  const play = byId('vic-play');
  const slider = byId('vic-progress');
  const stage = byId('vic-stage');
  const caseNote = byId('vic-case');
  const viewport = byId('viewport');
  let analysis;
  let mode;
  let beforeDemo;
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
    const printed = Math.min(99, Math.floor(100 * analysis.deposited / analysis.votes.length));
    const state = loss && analysis.stopped ? (progress >= 1 ? 'Settled' : 'Print stopped · settling') + ' · ' + printed + '% deposited'
      : progress >= 1 ? (fails ? 'After collapse' : analysis.failed ? 'Complete · local tears' : 'Complete · bead sections held')
        : loss ? 'Settling after failure' : frame >= analysis.buildFrames ? 'Checking the completed print' : 'Depositing';
    const label = 'VIC · ' + state;
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
    if (view) closeToolpath();
    pause();
    mode = view;
    const playing = view === 'demo';
    map.setAttribute('aria-pressed', String(view === 'map'));
    settled.setAttribute('aria-pressed', String(view === 'settled'));
    demo.setAttribute('aria-expanded', String(playing));
    player.hidden = !playing;
    caseNote.hidden = !playing && view !== 'settled';
    viewport.classList.toggle('vic-view', Boolean(view));
    if (playing) seek(progress);
    else viewer.setVicView(view);
    onPlaybackChange(Boolean(analysis?.trajectory), playing);
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
    const outcome = analysis.stopped ? 'Print stopped' : analysis.failed ? 'Completed with local tears' : 'Print held';
    const sag = analysis.sag >= 0.05 ? ' · up to ' + formatLength(analysis.sag) + ' mm sag in clay still standing' : '';
    caseNote.textContent = outcome + sag + '.';
    results.hidden = false;
    show(analysis.firstFailure < analysis.frames ? 'map' : 'settled');
  }

  map.addEventListener('click', () => show(mode === 'map' ? undefined : 'map'));
  settled.addEventListener('click', () => show(mode === 'settled' ? undefined : 'settled'));
  function toggleDemo() {
    if (!analysis?.trajectory) return;
    if (mode === 'demo') {
      show(beforeDemo);
      return;
    }
    beforeDemo = mode;
    progress = 0;
    show('demo');
    viewer.reset();
    viewport.scrollIntoView({ block: 'nearest' });
    resume();
  }
  demo.addEventListener('click', toggleDemo);
  byId('vic-return').addEventListener('click', () => show('map'));
  slider.addEventListener('input', () => {
    pause();
    seek(slider.valueAsNumber / 1000);
    pause();
  });
  play.addEventListener('click', () => { if (animation) pause(); else resume(); });

  return { begin, finish, toggleDemo, close() { if (mode) show(undefined); }, error() { status.textContent = 'VIC could not analyze this toolpath.'; } };
}
