function formatTime(seconds, total) {
  if (total < 1) return seconds.toFixed(2) + ' s';
  const whole = Math.floor(seconds);
  return Math.floor(whole / 60) + ':' + String(whole % 60).padStart(2, '0');
}

const qualityNames = { fast: 'Fast', accurate: 'Accurate', vic: 'VIC' };

export function setupToolpathPanel(viewer, { closeVic, toggleVic }) {
  const byId = id => document.getElementById(id);
  const toggle = byId('toolpath-toggle');
  const player = byId('toolpath-player');
  const slider = byId('toolpath-progress');
  const play = byId('toolpath-play');
  const label = byId('toolpath-time');
  const viewport = byId('viewport');
  const replayMilliseconds = 12_000;
  let duration = 0;
  let qualityName = qualityNames.fast;
  let busy = false;
  let hasVicReplay = false;
  let vicOpen = false;
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
    label.textContent = qualityName + ' · ' + percent + ' · ' + time;
    slider.value = String(Math.round(value * 1000));
    slider.setAttribute('aria-valuetext', qualityName + ', ' + percent + ', ' + time);
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

  function updateToggle() {
    toggle.disabled = busy || (!duration && !hasVicReplay);
    toggle.setAttribute('aria-controls', hasVicReplay ? 'vic-player' : player.id);
    toggle.setAttribute('aria-expanded', String(hasVicReplay ? vicOpen : !player.hidden));
  }

  function close() {
    if (player.hidden) return;
    pause();
    player.hidden = true;
    updateToggle();
    viewport.classList.remove('toolpath-view');
    viewer.setToolpathTime();
  }

  toggle.addEventListener('click', () => {
    if (hasVicReplay) {
      toggleVic();
      return;
    }
    if (!player.hidden) {
      close();
      return;
    }
    closeVic();
    player.hidden = false;
    updateToggle();
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
    setDuration(seconds = 0, quality) {
      close();
      duration = seconds;
      qualityName = qualityNames[quality] ?? qualityNames.fast;
      updateToggle();
    },
    setVicPlayback(available, open) {
      hasVicReplay = available;
      vicOpen = open;
      updateToggle();
    },
    setBusy(working) {
      busy = working;
      if (working) {
        close();
        if (vicOpen) closeVic();
      }
      updateToggle();
    },
  };
}
