import assert from "node:assert/strict";
import test from "node:test";

import {
  createBrowserSpeechRecognition,
  getSpeechRecognitionConstructor
} from "../services/browser-speech-recognition.js";

class MockRecognition {
  constructor() {
    this.listeners = new Map();
    this.startCalls = 0;
    this.stopCalls = 0;
    MockRecognition.current = this;
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  emit(type, event = {}) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  start() {
    this.startCalls += 1;
  }

  stop() {
    this.stopCalls += 1;
  }
}

function fakeTimers() {
  let nextId = 1;
  const scheduled = new Map();
  return {
    setTimer(callback, delay) {
      const id = nextId++;
      scheduled.set(id, { callback, delay });
      return id;
    },
    clearTimer(id) {
      scheduled.delete(id);
    },
    runDelay(delay) {
      const match = [...scheduled].find(([, timer]) => timer.delay === delay);
      assert.ok(match, `expected a ${delay}ms timer`);
      const [id, timer] = match;
      scheduled.delete(id);
      timer.callback();
    }
  };
}

function speechResult(transcript, isFinal = false) {
  const result = [{ transcript }];
  result.isFinal = isFinal;
  return { resultIndex: 0, results: [result] };
}

test("constructor lookup supports standard and prefixed browser APIs", () => {
  assert.equal(
    getSpeechRecognitionConstructor({ SpeechRecognition: MockRecognition }),
    MockRecognition
  );
  assert.equal(
    getSpeechRecognitionConstructor({ webkitSpeechRecognition: MockRecognition }),
    MockRecognition
  );
  assert.equal(getSpeechRecognitionConstructor({}), null);
});

test("live transcript is finalized after four seconds of silence", () => {
  const timers = fakeTimers();
  const live = [];
  const completed = [];
  let currentTime = 1_000;
  const session = createBrowserSpeechRecognition({
    Recognition: MockRecognition,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    now: () => currentTime,
    onTranscript: (text) => live.push(text),
    onFinal: (text) => completed.push(text)
  });

  session.start();
  MockRecognition.current.emit("result", speechResult("打开设备状态", true));
  assert.deepEqual(live, ["打开设备状态"]);

  currentTime += 4_000;
  timers.runDelay(4_000);
  assert.equal(MockRecognition.current.stopCalls, 1);
  MockRecognition.current.emit("end");

  assert.deepEqual(completed, ["打开设备状态"]);
  assert.equal(session.active, false);
});

test("browser end events restart recognition before the silence window", () => {
  const timers = fakeTimers();
  const session = createBrowserSpeechRecognition({
    Recognition: MockRecognition,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer
  });

  session.start();
  MockRecognition.current.emit("end");
  timers.runDelay(120);

  assert.equal(MockRecognition.current.startCalls, 2);
  session.stop();
  MockRecognition.current.emit("end");
  assert.equal(session.active, false);
});

test("permission errors stop the session without submitting text", () => {
  const errors = [];
  const completed = [];
  const session = createBrowserSpeechRecognition({
    Recognition: MockRecognition,
    onError: (code) => errors.push(code),
    onFinal: (text) => completed.push(text)
  });

  session.start();
  MockRecognition.current.emit("error", { error: "not-allowed" });
  MockRecognition.current.emit("end");

  assert.deepEqual(errors, ["not-allowed"]);
  assert.deepEqual(completed, []);
  assert.equal(session.active, false);
});
