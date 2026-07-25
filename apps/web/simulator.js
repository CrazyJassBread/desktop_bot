import { DeviceBus } from "./services/device-bus.js";
import { resolveDeviceTransition } from "./services/companion-store.js";

const bus = new DeviceBus("mimo-simulator");
const state = {
  id: "mimo-desk-01",
  name: "小P",
  connected: true,
  mode: "idle",
  power: "on",
  battery: 82,
  charging: true,
  wifi: "Studio Wi-Fi",
  language: "CN",
  firmware: "0.3.0-mvp"
};
let eventCount = 0;

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  })[character]);
}

function deviceFace(mode) {
  const asleep = mode === "sleeping" || mode === "soft_off";
  return `<div class="device-avatar mode-${mode}"><span class="antenna"></span><div class="device-screen"><i class="eye ${asleep ? "sleep" : ""}"></i><i class="eye ${asleep ? "sleep" : ""}"></i><i class="mouth"></i><span class="sound-wave"></span></div><span class="device-foot left"></span><span class="device-foot right"></span></div>`;
}

function modeLabel(mode) {
  return { idle: "IDLE", active: "ACTIVE", listening: "LISTENING", camera: "CAMERA", printing: "PRINTING", game: "GAME", sleeping: "SLEEPING", soft_off: "SOFT OFF" }[mode] ?? mode.toUpperCase();
}

function render() {
  document.querySelector("#sim-device-avatar").innerHTML = deviceFace(state.mode);
  document.querySelector("#sim-mode-label").textContent = `${modeLabel(state.mode)} · CONNECTED`;
  document.querySelector("#sim-battery").textContent = `${state.battery}%`;
  document.querySelector("#sim-language").textContent = state.language;
}

function log(type, message) {
  eventCount += 1;
  const now = new Date().toLocaleTimeString("zh-CN", { hour12: false });
  const row = document.createElement("p");
  row.innerHTML = `<time>${now}</time> <b>${escapeHtml(type)}</b> ${escapeHtml(message)}`;
  const target = document.querySelector("#sim-log");
  target.prepend(row);
  document.querySelector("#message-count").textContent = `${eventCount} EVENTS`;
}

function report(type = "device.reported", extra = {}) {
  bus.send(type, { state: { ...state }, ...extra });
}

function transition(event) {
  state.mode = resolveDeviceTransition(state.mode, event);
  state.power = state.mode === "soft_off" ? "soft_off" : "on";
  render();
}

function capturePhoto() {
  transition("camera");
  const frame = document.querySelector("#camera-frame");
  frame.classList.remove("captured");
  requestAnimationFrame(() => frame.classList.add("captured"));
  document.querySelector("#camera-status").textContent = "CAPTURED";
  bus.send("device.photo.captured", {
    capturedAt: new Date().toISOString(),
    width: 640,
    height: 480,
    preview: "local://mimo-camera/latest"
  });
  log("camera", "Photo captured and metadata returned");
  setTimeout(() => {
    transition("complete");
    document.querySelector("#camera-status").textContent = "READY";
    report();
  }, 650);
}

function printJob(job = {}) {
  transition("print");
  const receipt = document.querySelector("#receipt");
  document.querySelector("#receipt-content").textContent = job.content || "HELLO FROM PRINTPAL\n设备通信测试成功";
  document.querySelector("#printer-status").textContent = "PRINTING";
  receipt.classList.remove("printing");
  requestAnimationFrame(() => receipt.classList.add("printing"));
  log("printer", `Printing ${job.title || "PrintPal Test"}`);
  setTimeout(() => {
    document.querySelector("#printer-status").textContent = "DONE";
    transition("complete");
    bus.send("printer.completed", { jobId: job.id, title: job.title || "PrintPal Test", state: { ...state } });
    report();
  }, 1_100);
}

function handleCommand(command, payload = {}) {
  const commandName = command || "";
  log("command", commandName);
  switch (commandName) {
    case "device.record":
      transition("listen");
      setTimeout(() => { transition("complete"); report(); }, 1_700);
      break;
    case "camera.capture":
      capturePhoto();
      break;
    case "printer.print":
      printJob(payload.job);
      break;
    case "device.language":
      state.language = payload.language === "EN" ? "EN" : "CN";
      render();
      break;
    case "device.game":
      transition("game");
      break;
    case "game.control":
      transition("game");
      break;
    case "device.sync":
      report();
      break;
    case "device.mode":
      state.mode = payload.mode;
      render();
      break;
    case "device.power": {
      const event = payload.action === "soft_shutdown" ? "shutdown" : payload.action;
      transition(event);
      break;
    }
    default:
      log("warning", `Unknown command: ${commandName}`);
  }
  bus.send("device.ack", { command: commandName, message: `${commandName} 已执行`, state: { ...state } });
}

document.querySelector("#open-web").addEventListener("click", () => window.open("/", "mimo-web"));
document.querySelectorAll("[data-command]").forEach((button) => {
  button.addEventListener("click", () => {
    const value = button.dataset.command;
    if (value === "photo") return capturePhoto();
    if (value === "print") return printJob({ title: "Local Test", content: "PRINTPAL\nLOCAL PRINT TEST\n✓ Printer ready" });
    const event = value === "wake" ? "wake" : value === "listen" ? "listen" : value === "game" ? "game" : value;
    transition(event);
    log("local", `${value} button pressed`);
    report("device.ack", { message: `设备已切换为 ${modeLabel(state.mode)}` });
  });
});

document.querySelectorAll("[data-gesture]").forEach((button) => {
  button.addEventListener("click", () => {
    const gesture = button.dataset.gesture;
    if (gesture === "v_sign") state.language = state.language === "CN" ? "EN" : "CN";
    if (gesture === "open_palm") capturePhoto();
    if (gesture === "up" || gesture === "down") transition("game");
    render();
    bus.send("device.gesture.detected", { gesture, confidence: 0.96, state: { ...state } });
    log("gesture", `${gesture} confidence=0.96`);
    report();
  });
});

bus.onMessage((message) => {
  if (message.type === "web.hello") {
    log("web", "Web controller connected");
    report("simulator.hello");
    return;
  }
  if (message.type === "device.command") {
    handleCommand(message.payload?.command, message.payload);
  }
});

render();
log("boot", `小P firmware ${state.firmware} ready`);
report("simulator.hello");
setInterval(() => report("device.heartbeat", { uptime: Math.round(performance.now() / 1000) }), 5_000);
