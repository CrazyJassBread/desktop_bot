// WebSocket bridge that connects to the desktop_bot perception event stream
// (port 8090) and dispatches normalised events to an onEvent callback.
//
// Requires Node.js 22+ for the global WebSocket constructor.

const MAX_BACKOFF_MS = 30_000;
const MAX_DEDUP_SIZE = 1000;
const INITIAL_BACKOFF_MS = 1000;

/**
 * Start a WebSocket bridge to the desktop_bot event stream.
 *
 * @param {Object} options
 * @param {string} options.baseUrl    - HTTP base URL of desktop_bot (e.g. http://127.0.0.1:8090)
 * @param {string} options.wsPath     - WebSocket path (e.g. /api/events)
 * @param {boolean} options.enabled   - Whether the bridge should actively connect
 * @param {Function} options.onEvent  - Callback receiving normalised event objects
 * @param {Function} options.onStatus - Callback receiving connection status snapshots
 * @returns {{ stop: Function, status: Function, handleExternalEvent: Function }}
 */
export function startDesktopBotBridge(options = {}) {
  const {
    baseUrl = "http://127.0.0.1:8090",
    wsPath = "/api/events",
    enabled = false,
    onEvent = () => {},
    onStatus = () => {}
  } = options;

  if (!enabled) {
    return {
      stop() {},
      status() {
        return { connected: false, enabled: false, last_event_sequence: 0, event_count: 0 };
      },
      handleExternalEvent() {}
    };
  }

  const wsBaseUrl = baseUrl.replace(/^http/, "ws");
  const wsUrl = `${wsBaseUrl}${wsPath}`;
  const httpBaseUrl = baseUrl.replace(/\/$/, "");

  let ws = null;
  let reconnectTimer = null;
  let backoffMs = INITIAL_BACKOFF_MS;
  let stopped = false;
  let lastEventSequence = 0;
  let eventCount = 0;
  const seenEventIds = new Set();

  function currentStatus() {
    return {
      connected: ws !== null && ws.readyState === WebSocket.OPEN,
      enabled: true,
      last_event_sequence: lastEventSequence,
      event_count: eventCount
    };
  }

  function isDuplicate(eventId) {
    if (!eventId) return false;
    if (seenEventIds.has(eventId)) return true;
    seenEventIds.add(eventId);
    if (seenEventIds.size > MAX_DEDUP_SIZE) {
      const oldest = seenEventIds.values().next().value;
      seenEventIds.delete(oldest);
    }
    return false;
  }

  // Map a raw PerceptionEvent to a normalised event and invoke onEvent.
  // Reference: docs/desktop-bot-integration.md lines 58-66.
  function dispatchEvent(event) {
    if (isDuplicate(event.event_id)) return;

    const eventType = String(event.event_type ?? "");
    const payload = event.payload ?? {};

    if (typeof event.sequence === "number" && event.sequence > lastEventSequence) {
      lastEventSequence = event.sequence;
    }
    eventCount += 1;

    switch (eventType) {
      case "speech.transcribed":
        onEvent({ type: "speech_transcribed", transcript: payload.transcript ?? "", event });
        break;
      case "command.chat.start":
        onEvent({ type: "chat_start", event });
        break;
      case "command.chat.ask":
        onEvent({ type: "chat_ask", transcript: payload.transcript ?? "", event });
        break;
      case "command.chat.stop":
        onEvent({ type: "chat_stop", event });
        break;
      case "command.letter.compose":
        onEvent({ type: "letter_compose", event });
        break;
      case "command.language.set":
      case "language.changed":
        onEvent({ type: "language_set", language: payload.language ?? "", event });
        break;
      case "command.camera.capture_after":
        onEvent({ type: "camera_capture", delay: payload.delay_seconds ?? 0, event });
        break;
      case "photo.captured":
      case "photo.completed":
        onEvent({ type: "photo_captured", capture_id: payload.capture_id ?? "", event });
        break;
      default:
        if (eventType.startsWith("letter.")) {
          onEvent({ type: "letter_event", ...payload, event });
        } else {
          onEvent({ type: "raw", event });
        }
    }
  }

  // After reconnecting, fetch any events that were emitted while we were
  // disconnected using the after_sequence cursor.
  async function backfillEvents() {
    if (lastEventSequence <= 0) return;
    try {
      const res = await fetch(`${httpBaseUrl}${wsPath}?after_sequence=${lastEventSequence}`);
      if (!res.ok) return;
      const data = await res.json();
      const events = Array.isArray(data.events) ? data.events : [];
      for (const evt of events) {
        dispatchEvent(evt);
      }
    } catch {
      // Non-fatal: the live WebSocket will continue delivering new events.
    }
  }

  function scheduleReconnect() {
    if (stopped || reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, backoffMs);
    backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
  }

  function connect() {
    if (stopped) return;

    try {
      ws = new WebSocket(wsUrl);
    } catch {
      scheduleReconnect();
      return;
    }

    ws.addEventListener("open", () => {
      backoffMs = INITIAL_BACKOFF_MS;
      onStatus(currentStatus());
      backfillEvents();
    });

    ws.addEventListener("message", (messageEvent) => {
      try {
        const event = JSON.parse(messageEvent.data);
        dispatchEvent(event);
      } catch {
        // Ignore malformed payloads.
      }
    });

    ws.addEventListener("close", () => {
      ws = null;
      onStatus(currentStatus());
      scheduleReconnect();
    });

    ws.addEventListener("error", () => {
      // The subsequent "close" event drives reconnection logic.
    });
  }

  function handleExternalEvent(event) {
    dispatchEvent(event);
  }

  connect();

  return {
    stop() {
      stopped = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (ws) {
        ws.close();
        ws = null;
      }
      onStatus(currentStatus());
    },
    status() {
      return currentStatus();
    },
    handleExternalEvent
  };
}
