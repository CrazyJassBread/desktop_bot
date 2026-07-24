const MAX_EVENTS = 100;
const events = [];
const channelStatus = {
  audio: { connected: false, lastSeenAt: null, protocol: "TCP PCM · :8081 · 16kHz mono s16le" },
  vision: { connected: false, lastSeenAt: null, protocol: "HTTP JPEG · :8082/upload · 640×480" }
};

const allowedSources = new Set(["audio", "vision", "simulator", "controller", "camera", "photo", "external", "bridge"]);

export function acceptPerceptionEvent(input = {}) {
  const eventType = String(input.event_type ?? input.eventType ?? "").trim();
  const source = String(input.source ?? "").trim();
  if (!eventType || !allowedSources.has(source)) {
    throw new TypeError("event_type and a valid source are required");
  }
  const eventId = String(input.event_id ?? input.eventId ?? input.id ?? `evt-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`);
  const event = {
    id: eventId,
    eventId,
    eventType,
    source,
    timestampMs: Number(input.timestamp_ms ?? input.timestampMs ?? Date.now()),
    sessionId: String(input.session_id ?? input.sessionId ?? "bot"),
    payload: input.payload && typeof input.payload === "object" ? input.payload : {},
    sequence: Math.max(0, Number(input.sequence ?? 0) || 0),
    schemaVersion: Math.max(1, Number(input.schema_version ?? input.schemaVersion ?? 1) || 1)
  };
  if (events.some((item) => item.eventId === event.eventId)) return events.find((item) => item.eventId === event.eventId);
  events.push(event);
  if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
  const channel = source === "simulator" ? null : channelStatus[source];
  if (channel) {
    channel.connected = true;
    channel.lastSeenAt = new Date(event.timestampMs).toISOString();
  }
  return event;
}

export function listPerceptionEvents(afterMs = 0) {
  return events.filter((event) => event.timestampMs > afterMs).slice(-30);
}

export function getPerceptionStatus() {
  return {
    service: "desktop_bot perception gateway",
    state: events.length ? "ACTIVE" : "WAITING_FOR_EVENTS",
    channels: channelStatus,
    bufferedEvents: events.length,
    supportedEvents: [
      "wake", "mode.enter_chat", "mode.exit_chat", "feature.write_letter",
      "command.letter.send", "letter.listening", "letter.content_buffered",
      "letter.sending", "letter.sent", "letter.send_failed",
      "turtle.started", "turtle.answered", "turtle.stopped",
      "mode.toggle", "gesture.thumb_up", "gesture.thumb_down", "gesture.open_palm"
    ],
    updatedAt: new Date().toISOString()
  };
}
