const noop = () => {};

export function getSpeechRecognitionConstructor(scope = globalThis) {
  return scope?.SpeechRecognition ?? scope?.webkitSpeechRecognition ?? null;
}

export function createBrowserSpeechRecognition({
  Recognition,
  language = "zh-CN",
  silenceWindowMs = 4_000,
  restartDelayMs = 120,
  stopFallbackMs = 700,
  maxCharacters = 1_500,
  setTimer = globalThis.setTimeout.bind(globalThis),
  clearTimer = globalThis.clearTimeout.bind(globalThis),
  now = () => Date.now(),
  onTranscript = noop,
  onFinal = noop,
  onError = noop
} = {}) {
  if (typeof Recognition !== "function") {
    throw new TypeError("A SpeechRecognition constructor is required");
  }
  if (silenceWindowMs <= 0 || restartDelayMs < 0 || stopFallbackMs <= 0) {
    throw new RangeError("Speech recognition timing values are invalid");
  }

  const recognition = new Recognition();
  recognition.lang = language;
  recognition.interimResults = true;
  recognition.continuous = true;

  let finalText = "";
  let latestText = "";
  let lastSpeechAt = 0;
  let silenceTimer = null;
  let restartTimer = null;
  let stopFallbackTimer = null;
  let manualStop = false;
  let silenceReached = false;
  let finalized = false;

  const cancelTimer = (timer) => {
    if (timer !== null) clearTimer(timer);
  };

  const clearTimers = () => {
    cancelTimer(silenceTimer);
    cancelTimer(restartTimer);
    cancelTimer(stopFallbackTimer);
    silenceTimer = null;
    restartTimer = null;
    stopFallbackTimer = null;
  };

  const finish = () => {
    if (finalized) return;
    finalized = true;
    clearTimers();
    onFinal((latestText || finalText).trim());
  };

  const fail = (code, originalEvent = null) => {
    if (finalized) return;
    finalized = true;
    clearTimers();
    onError(code, originalEvent);
  };

  const requestStop = (manual = false) => {
    if (finalized) return;
    manualStop ||= manual;
    try {
      recognition.stop();
    } catch {
      finish();
      return;
    }
    cancelTimer(stopFallbackTimer);
    stopFallbackTimer = setTimer(finish, stopFallbackMs);
  };

  const scheduleSilenceStop = () => {
    cancelTimer(silenceTimer);
    silenceTimer = setTimer(() => {
      silenceReached = true;
      requestStop(false);
    }, silenceWindowMs);
  };

  const startOrResume = () => {
    if (finalized || manualStop || silenceReached) return;
    try {
      recognition.start();
    } catch (error) {
      if (latestText || finalText) finish();
      else fail("start-failed", error);
    }
  };

  recognition.addEventListener("result", (event) => {
    let interim = "";
    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const part = event.results[index][0]?.transcript ?? "";
      if (event.results[index].isFinal) finalText += `${part} `;
      else interim += part;
    }
    latestText = `${finalText}${interim}`.trim().slice(0, maxCharacters);
    lastSpeechAt = now();
    scheduleSilenceStop();
    onTranscript(latestText);
  });

  recognition.addEventListener("error", (event) => {
    if (["no-speech", "aborted"].includes(event.error) && !manualStop && !silenceReached) {
      return;
    }
    if (event.error === "aborted" && manualStop) {
      finish();
      return;
    }
    fail(event.error || "recognition-error", event);
  });

  recognition.addEventListener("end", () => {
    if (finalized) return;
    if (
      manualStop
      || silenceReached
      || (lastSpeechAt && now() - lastSpeechAt >= silenceWindowMs)
    ) {
      finish();
      return;
    }
    cancelTimer(restartTimer);
    restartTimer = setTimer(startOrResume, restartDelayMs);
  });

  return {
    recognition,
    start: startOrResume,
    stop: () => requestStop(true),
    get active() {
      return !finalized;
    }
  };
}
