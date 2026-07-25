import { DeviceBus } from "./device-bus.js";

const DEFAULT_BASE = "http://127.0.0.1:8090";
const STORAGE_KEY = "ai-hub-bot-bridge-base";
const RECONNECT_DELAY_MS = 3_000;
const HEARTBEAT_INTERVAL_MS = 10_000;

function resolveBase() {
  const fromQuery = new URLSearchParams(window.location.search).get("bot");
  if (fromQuery) {
    const base = fromQuery.replace(/\/$/, "");
    try {
      localStorage.setItem(STORAGE_KEY, base);
    } catch {
      // Persisting the override is optional.
    }
    return base;
  }
  try {
    return localStorage.getItem(STORAGE_KEY) || DEFAULT_BASE;
  } catch {
    return DEFAULT_BASE;
  }
}

function toWebSocketUrl(base) {
  return `${base.replace(/^http/, "ws")}/api/events`;
}

// Maps desktop-bot PerceptionEvents onto DeviceBus message types the web
// companion already understands (or new device.* types handled in app.js).
function mapEvent(event, base) {
  const type = String(event.event_type ?? "");
  const payload = event.payload ?? {};

  if (type.startsWith("gesture.")) {
    return {
      type: "device.gesture.detected",
      payload: {
        gesture: String(payload.label ?? type.slice("gesture.".length)).toLowerCase(),
        confidence: payload.confidence ?? null
      }
    };
  }
  if (type === "photo.captured") {
    return {
      type: "device.photo.captured",
      payload: {
        captureId: payload.capture_id ?? null,
        photoUrl: payload.photo_url ? `${base}${payload.photo_url}` : null,
        capturedAt: new Date(payload.captured_at_ms ?? event.timestamp_ms ?? Date.now()).toISOString(),
        width: 640,
        height: 480
      }
    };
  }
  if (type === "photo.capture_failed") {
    return { type: "device.photo.failed", payload: { reason: payload.reason ?? "unknown" } };
  }
  if (type === "speech.transcribed") {
    return {
      type: "device.speech.transcribed",
      payload: {
        transcript: payload.transcript ?? "",
        matchedEvent: payload.matched_event ?? null,
        durationSeconds: payload.audio_duration_seconds ?? null
      }
    };
  }
  if (type === "command.letter.compose") {
    return { type: "device.letter.started", payload: { sessionId: event.session_id ?? "bot" } };
  }
  if (type === "letter.completed" || type === "llm.letter_completed") {
    return {
      type: "device.letter.completed",
      payload: {
        recipient: payload.recipient ?? payload.recipient_name ?? null,
        subject: payload.subject ?? null,
        body: payload.body ?? payload.content ?? "",
        sessionId: event.session_id ?? "bot"
      }
    };
  }
  return null;
}

// Bridges the Python bot process (ws://…:8090/api/events) onto the in-page
// DeviceBus so existing handlers react to real hardware events. The bridge
// owns its own DeviceBus instance because DeviceBus drops same-source
// messages; a distinct source lets the page receive what the bridge relays.
export function startBotBridge() {
  const base = resolveBase();
  const bus = new DeviceBus("desktop-bot");
  let socket = null;
  let heartbeatTimer = null;
  let reconnectTimer = null;
  let closed = false;

  function heartbeat() {
    bus.send("device.heartbeat", { bridge: "desktop-bot", base });
  }

  function connect() {
    if (closed) return;
    socket = new WebSocket(toWebSocketUrl(base));

    socket.addEventListener("open", () => {
      heartbeat();
      clearInterval(heartbeatTimer);
      heartbeatTimer = setInterval(heartbeat, HEARTBEAT_INTERVAL_MS);
    });

    socket.addEventListener("message", (raw) => {
      let event;
      try {
        event = JSON.parse(raw.data);
      } catch {
        return;
      }
      const mapped = mapEvent(event, base);
      if (mapped) bus.send(mapped.type, mapped.payload);
    });

    socket.addEventListener("close", () => {
      clearInterval(heartbeatTimer);
      if (!closed) reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS);
    });

    socket.addEventListener("error", () => {
      socket?.close();
    });
  }

  connect();

  return {
    base,
    stop() {
      closed = true;
      clearInterval(heartbeatTimer);
      clearTimeout(reconnectTimer);
      socket?.close();
      bus.close();
    }
  };
}
