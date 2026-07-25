let activeRecording = null;

export function registerActiveRecording(stop) {
  if (activeRecording) return false;
  activeRecording = { stop, timer: null };
  return true;
}

export function clearActiveRecording(stop) {
  if (activeRecording?.stop === stop) {
    if (activeRecording.timer) clearTimeout(activeRecording.timer);
    activeRecording = null;
  }
}

export function isStopPending(stop) {
  return activeRecording?.stop === stop && Boolean(activeRecording.timer);
}

export function stopActiveRecording(graceMs = 0) {
  if (!activeRecording) return false;
  if (activeRecording.timer) return true;
  const delay = Math.max(0, Number(graceMs) || 0);
  if (!delay) {
    const { stop } = activeRecording;
    activeRecording = null;
    stop();
    return true;
  }
  activeRecording.timer = setTimeout(() => {
    if (!activeRecording) return;
    const { stop } = activeRecording;
    activeRecording = null;
    stop();
  }, delay);
  return true;
}
