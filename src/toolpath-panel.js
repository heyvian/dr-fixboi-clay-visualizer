function formatTime(seconds, total) {
  if (total < 1) return seconds.toFixed(2) + ' s';
  const whole = Math.floor(seconds);
  return Math.floor(whole / 60) + ':' + String(whole % 60).padStart(2, '0');
}

export function setupToolpathPanel(viewer, onOpen) {
  const byId = id => document.getElementById(id);
  const toggle = byId('toolpath-toggle');
  const player = byId('toolpath-player');
  const slider = byId('toolpath-progress');
  const play = byId('toolpath-play');
  const label = byId('toolpath-time');
  const viewport = byId('viewport');
  const replayMilliseconds = 12_000;
  let duration = 0;
  let busy = false;
  let amount = 0;
  let animation = 0;
  let start = 0;

  function pause() {
    if (animation) cancelAnimationFrame(animation);
    animation = 0;
    play.textContent = amount >= 1 ? 'Replay' : 'Play';
  }

  function seek(value) {
    amount = value;
    const percent = Math.round(value * 100) + '%';
    const time = formatTime(value * duration, duration) + ' / ' + formatTime(duration, duration);
    label.textContent = percent + ' · ' + time;
    slider.value = String(Math.round(value * 1000));
    slider.setAttribute('aria-valuetext', percent + ', ' + time);
    viewer.setToolpathTime(value * duration);
  }

  function tick(time) {
    seek(Math.min(1, (time - start) / replayMilliseconds));
    if (amount < 1) animation = requestAnimationFrame(tick);
    else pause();
  }

  function resume() {
    if (amount >= 1) seek(0);
    start = performance.now() - amount * replayMilliseconds;
    animation = requestAnimationFrame(tick);
    play.textContent = 'Pause';
  }

  function close() {
    if (player.hidden) return;
    pause();
    player.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
    viewport.classList.remove('toolpath-view');
    viewer.setToolpathTime();
  }

  toggle.addEventListener('click', () => {
    if (!player.hidden) {
      close();
      return;
    }
    onOpen();
    player.hidden = false;
    toggle.setAttribute('aria-expanded', 'true');
    viewport.classList.add('toolpath-view');
    seek(0);
    resume();
  });
  byId('toolpath-close').addEventListener('click', () => {
    close();
    toggle.focus();
  });
  slider.addEventListener('input', () => {
    seek(slider.valueAsNumber / 1000);
    pause();
  });
  play.addEventListener('click', () => { if (animation) pause(); else resume(); });

  return {
    close,
    setDuration(seconds = 0) {
      close();
      duration = seconds;
      toggle.disabled = !duration || busy;
    },
    setBusy(working) {
      busy = working;
      if (working) close();
      toggle.disabled = !duration || working;
    },
  };
}
