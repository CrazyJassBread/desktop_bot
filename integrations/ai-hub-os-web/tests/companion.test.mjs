import assert from "node:assert/strict";
import test from "node:test";
import {
  answerLearningQuestion,
  cloneInitialState,
  createLetter,
  createPrintJob,
  mapGestureToAction,
  reduceCompanionState,
  resolveDeviceTransition
} from "../services/companion-store.js";

test("FSM supports idle, active, sleep and soft-off transitions", () => {
  assert.equal(resolveDeviceTransition("idle", "wake"), "active");
  assert.equal(resolveDeviceTransition("active", "sleep"), "sleeping");
  assert.equal(resolveDeviceTransition("sleeping", "wake"), "active");
  assert.equal(resolveDeviceTransition("active", "shutdown"), "soft_off");
  assert.equal(resolveDeviceTransition("soft_off", "print"), "soft_off");
  assert.equal(resolveDeviceTransition("soft_off", "wake"), "active");
});

test("gesture map preserves product control contract", () => {
  assert.deepEqual(mapGestureToAction("v_sign", "CN"), {
    type: "language", value: "EN", label: "切换语言"
  });
  assert.equal(mapGestureToAction("open_palm").type, "camera.capture");
  assert.equal(mapGestureToAction("up").value, "up");
  assert.equal(mapGestureToAction("down").value, "down");
});

test("print job and state queue work without a database", () => {
  const now = new Date("2026-07-23T08:00:00+08:00");
  const job = createPrintJob({ title: "Morning Brief", content: "天气晴朗", kind: "brief" }, now);
  assert.equal(job.status, "queued");
  assert.equal(job.kind, "brief");

  const state = reduceCompanionState(cloneInitialState(), { type: "print.queue", job });
  assert.equal(state.printJobs[0].title, "Morning Brief");
  assert.match(state.activity[0].text, /等待打印/);
});

test("AI learning and letter helpers return useful MVP content", () => {
  assert.match(answerLearningQuestion("MQTT 是什么？"), /设备/);
  const letter = createLetter({
    recipient: "Aiko",
    subject: "夏夜",
    keywords: "最近完成了一个硬件项目",
    tone: "温暖"
  });
  assert.match(letter.body, /Aiko/);
  assert.match(letter.body, /夏夜/);
  assert.equal(letter.tone, "温暖");
});

test("task toggle is immutable from caller perspective", () => {
  const state = cloneInitialState();
  const originalDone = state.tasks[0].done;
  const next = reduceCompanionState(state, { type: "task.toggle", id: state.tasks[0].id });
  assert.equal(state.tasks[0].done, originalDone);
  assert.equal(next.tasks[0].done, !originalDone);
});
