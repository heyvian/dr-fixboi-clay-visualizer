function lastAtOrBefore(values, time, stride = 1) {
  let low = 0;
  let high = values.length / stride;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (values[stride * middle] <= time) low = middle + 1;
    else high = middle;
  }
  return low - 1;
}

export function depositedIndexCount(replay, seconds) {
  if (seconds >= replay.duration) return replay.indexEnds.at(-1);
  return replay.indexEnds[lastAtOrBefore(replay.times, replay.start + seconds)] ?? 0;
}

export function nozzlePosition(motion, time) {
  const stride = 4;
  const start = Math.max(0, lastAtOrBefore(motion, time, stride)) * stride;
  const end = Math.min(motion.length - stride, start + stride);
  const duration = motion[end] - motion[start];
  const fraction = duration > 0 ? Math.max(0, Math.min(1, (time - motion[start]) / duration)) : 0;
  return [1, 2, 3].map(axis => motion[start + axis] + (motion[end + axis] - motion[start + axis]) * fraction);
}
