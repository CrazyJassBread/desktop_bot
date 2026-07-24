import { acceptPerceptionEvent } from "./perception-gateway.mjs";
import {
  extractVoiceLetterStart,
  orchestrateTranscript,
  splitVoiceLetterFinish
} from "./ai-orchestrator.mjs";

const MAX_SEEN_EVENTS = 500;
const MAX_LETTER_CHARS = 1_200;
const LETTER_SESSION_TTL_MS = 30 * 60 * 1_000;
const TURTLE_SESSION_TTL_MS = 45 * 60 * 1_000;

function normalizeBaseUrl(value) {
  return String(value || "http://127.0.0.1:8090").replace(/\/+$/, "");
}

function websocketUrl(baseUrl) {
  const url = new URL(baseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = process.env.DESKTOP_BOT_WEBSOCKET_PATH ?? "/api/events";
  url.search = "";
  return url.toString();
}

function commandParameters(event) {
  return event?.payload?.parameters && typeof event.payload.parameters === "object" ? event.payload.parameters : {};
}

function normalizedText(value) {
  return String(value ?? "").trim().replace(/\s+/gu, " ").toLocaleLowerCase();
}

export class DesktopBotBridge {
  constructor({
    baseUrl = process.env.DESKTOP_BOT_BASE_URL,
    reconnectMs = Number(process.env.DESKTOP_BOT_RECONNECT_MS ?? 2_000),
    aiHubBaseUrl = process.env.AI_HUB_INTERNAL_URL ?? "http://127.0.0.1:18000",
    onEvent = acceptPerceptionEvent,
    orchestrate = orchestrateTranscript,
    deliverLetter = null,
    fetchImpl = fetch,
    WebSocketImpl = globalThis.WebSocket
  } = {}) {
    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.reconnectMs = Math.max(500, reconnectMs || 2_000);
    this.aiHubBaseUrl = normalizeBaseUrl(aiHubBaseUrl);
    this.onEvent = onEvent;
    this.orchestrate = orchestrate;
    this.deliverLetter = deliverLetter ?? ((payload) => this.deliverVoiceLetter(payload));
    this.fetch = fetchImpl;
    this.WebSocketImpl = WebSocketImpl;
    this.socket = null;
    this.timer = null;
    this.stopped = true;
    this.seen = new Set();
    this.lastSequence = 0;
    this.lastEventAt = null;
    this.lastError = null;
    this.connectionState = "DISCONNECTED";
    this.letterSessions = new Map();
    this.turtleSessions = new Map();
  }

  start() {
    if (process.env.DESKTOP_BOT_BRIDGE_ENABLED === "false" || !this.stopped) return;
    this.stopped = false;
    this.connect();
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.socket?.close();
    this.socket = null;
    this.connectionState = "DISCONNECTED";
  }

  status() {
    return {
      service: "desktop_bot bridge",
      state: this.connectionState,
      baseUrl: this.baseUrl,
      websocketUrl: websocketUrl(this.baseUrl),
      lastSequence: this.lastSequence,
      lastEventAt: this.lastEventAt,
      lastError: this.lastError,
      contracts: {
        health: `${this.baseUrl}/api/health`,
        state: `${this.baseUrl}/api/state`,
        history: `${this.baseUrl}/api/events?after_sequence=${this.lastSequence}`,
        results: `${this.baseUrl}/api/results`,
        websocket: websocketUrl(this.baseUrl)
      }
    };
  }

  connect() {
    if (this.stopped || this.socket || !this.WebSocketImpl) return;
    this.connectionState = "CONNECTING";
    const socket = new this.WebSocketImpl(websocketUrl(this.baseUrl));
    this.socket = socket;
    socket.addEventListener("open", () => {
      this.connectionState = "CONNECTED";
      this.lastError = null;
      this.catchUp().catch((error) => { this.lastError = error.message; });
    });
    socket.addEventListener("message", (message) => {
      try {
        const event = JSON.parse(typeof message.data === "string" ? message.data : String(message.data));
        void this.consume(event);
      } catch (error) {
        this.lastError = `INVALID_EVENT:${error.message}`;
      }
    });
    socket.addEventListener("error", () => {
      this.lastError = "WEBSOCKET_ERROR";
    });
    socket.addEventListener("close", () => {
      this.socket = null;
      this.connectionState = "DISCONNECTED";
      this.scheduleReconnect();
    });
  }

  scheduleReconnect() {
    if (this.stopped || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.connect();
    }, this.reconnectMs);
    this.timer.unref?.();
  }

  async catchUp() {
    const response = await this.fetch(`${this.baseUrl}/api/events?after_sequence=${this.lastSequence}`, { signal: AbortSignal.timeout(5_000) });
    if (!response.ok) throw new Error(`HISTORY_${response.status}`);
    const payload = await response.json();
    for (const event of payload.events ?? []) await this.consume(event);
  }

  remember(eventId) {
    this.seen.add(eventId);
    if (this.seen.size > MAX_SEEN_EVENTS) this.seen.delete(this.seen.values().next().value);
  }

  async consume(event) {
    const eventId = String(event?.event_id ?? event?.eventId ?? "");
    if (!eventId || this.seen.has(eventId)) return null;
    this.remember(eventId);
    this.lastSequence = Math.max(this.lastSequence, Number(event.sequence ?? 0) || 0);
    this.lastEventAt = new Date(Number(event.timestamp_ms ?? Date.now())).toISOString();
    this.onEvent(event);

    const parameters = commandParameters(event);
    if (event.event_type === "speech.transcribed") {
      const letterResult = await this.handleLetterTranscript(event);
      if (letterResult) return letterResult;
      return this.handleTurtleTranscript(event);
    }

    if (event.event_type === "command.chat.ask") {
      const question = String(parameters.question ?? "").trim();
      if (!question) return null;
      const decision = await this.orchestrate(question, { mode: "chat" });
      await this.postResult("chat.completed", event, {
        question,
        answer: decision.reply,
        intent: decision.intent,
        printable: decision.printable ?? null,
        requires_confirmation: Boolean(decision.requiresConfirmation),
        provider: decision.provider,
        model: decision.model ?? null
      });
      return decision;
    }

    if (event.event_type === "command.letter.compose") {
      return this.handleLetterCommand(event, parameters);
    }

    if (event.event_type === "command.letter.send") {
      const session = this.letterSessions.get(String(event.session_id ?? "bot"));
      if (!session) {
        await this.postResult("letter.send_failed", event, {
          code: "VOICE_LETTER_SESSION_NOT_FOUND",
          message: "当前没有正在编辑的信件，请先说“我要给某某写信”。"
        });
        return { intent: "SEND_LETTER", sent: false, reason: "SESSION_NOT_FOUND" };
      }
      this.appendLetterContent(session, parameters.text);
      return this.finalizeLetter(event, session, "hardware_keyword");
    }

    if (event.event_type.startsWith("command.") && parameters.text) {
      const decision = await this.orchestrate(String(parameters.text), {});
      await this.postResult("ai.intent_ready", event, {
        intent: decision.intent,
        reply: decision.reply,
        printable: decision.printable ?? null,
        requires_confirmation: Boolean(decision.requiresConfirmation)
      });
      return decision;
    }
    return null;
  }

  purgeTurtleSessions() {
    const cutoff = Date.now() - TURTLE_SESSION_TTL_MS;
    for (const [sessionId, session] of this.turtleSessions) {
      if (session.updatedAt < cutoff) this.turtleSessions.delete(sessionId);
    }
  }

  isTurtleStart(text) {
    return /海龟汤/u.test(text) && /(玩|开始|来一局|进入|开局)/u.test(text);
  }

  isTurtleStop(text) {
    return /(?:退出|结束|停止|不玩了).{0,8}海龟汤|海龟汤.{0,8}(?:退出|结束|停止|不玩了)/u.test(text);
  }

  async handleTurtleTranscript(event) {
    this.purgeTurtleSessions();
    const transcript = String(event.payload?.transcript ?? "").trim();
    if (!transcript) return null;
    const sessionId = String(event.session_id ?? "bot");
    let session = this.turtleSessions.get(sessionId);

    if (this.isTurtleStop(transcript)) {
      this.turtleSessions.delete(sessionId);
      await this.postResult("turtle.stopped", event, { message: "海龟汤已结束。" });
      return { intent: "STOP_TURTLE_SOUP" };
    }

    if (this.isTurtleStart(transcript)) {
      const game = await this.startTurtleGame({
        theme: transcript,
        tone: "温暖轻悬疑，适合语音互动"
      });
      session = {
        sessionId,
        story: game,
        history: [],
        updatedAt: Date.now()
      };
      this.turtleSessions.set(sessionId, session);
      await this.postResult("turtle.started", event, {
        ...game,
        message: "海龟汤已开始。请继续用语音提出 YES / NO 问题。"
      });
      return { intent: "START_TURTLE_SOUP", game };
    }

    if (!session) return null;
    const result = await this.askTurtleGame({
      question: transcript,
      story: session.story,
      history: session.history
    });
    const entry = {
      question: transcript,
      verdict: result.verdict,
      answer: result.answer,
      hint: result.hint,
      provider: result.provider,
      createdAt: new Date().toISOString()
    };
    session.history.push(entry);
    session.updatedAt = Date.now();
    await this.postResult("turtle.answered", event, {
      ...result,
      question: transcript,
      story: session.story,
      history: session.history,
      message: `${result.verdict} · ${result.answer}`
    });
    return { intent: "TURTLE_QUESTION", ...result };
  }

  purgeLetterSessions() {
    const cutoff = Date.now() - LETTER_SESSION_TTL_MS;
    for (const [sessionId, session] of this.letterSessions) {
      if (session.updatedAt < cutoff) this.letterSessions.delete(sessionId);
    }
  }

  newLetterSession(sessionId, recipient = null) {
    const session = {
      sessionId,
      recipient: recipient || null,
      parts: [],
      state: "listening",
      sendKey: `voice-letter-${sessionId}-${crypto.randomUUID()}`,
      lastInput: "",
      lastInputAt: 0,
      updatedAt: Date.now(),
      delivery: null
    };
    this.letterSessions.set(sessionId, session);
    return session;
  }

  async handleLetterTranscript(event) {
    this.purgeLetterSessions();
    const transcript = String(event.payload?.transcript ?? "").trim();
    if (!transcript) return null;
    const sessionId = String(event.session_id ?? "bot");
    const start = extractVoiceLetterStart(transcript);
    let session = this.letterSessions.get(sessionId);

    if (start.started && (!session || session.state === "sent")) {
      session = this.newLetterSession(sessionId, start.recipient);
      await this.postResult("letter.listening", event, {
        recipient: session.recipient,
        message: session.recipient
          ? `正在写给${session.recipient}。请继续说内容，说“over”“发送信件”或“结束”即可自动发送。`
          : "已进入写信模式。请说出收件人和内容，说“over”“发送信件”或“结束”即可自动发送。"
      });
      if (start.content) return this.handleLetterInput(event, session, start.content);
      return { intent: "WRITE_LETTER", recipient: session.recipient };
    }

    if (!session) return null;
    return this.handleLetterInput(event, session, transcript);
  }

  async handleLetterCommand(event, parameters) {
    this.purgeLetterSessions();
    const sessionId = String(event.session_id ?? "bot");
    const content = String(parameters.content ?? "").trim();
    const start = extractVoiceLetterStart(content);
    let session = this.letterSessions.get(sessionId);
    if (!session || session.state === "sent") {
      session = this.newLetterSession(sessionId, start.recipient);
      await this.postResult("letter.listening", event, {
        recipient: session.recipient,
        message: "聆听中，请继续说出信件内容；说“over”“发送信件”或“结束”即可自动发送。"
      });
    }
    if (start.recipient && !session.recipient) session.recipient = start.recipient;
    const nextContent = start.started ? start.content : content;
    if (!nextContent) return { intent: "WRITE_LETTER", recipient: session.recipient };
    return this.handleLetterInput(event, session, nextContent);
  }

  appendLetterContent(session, value) {
    const text = String(value ?? "").trim();
    if (!text) return { added: false, clipped: false };
    const normalized = normalizedText(text);
    if (normalized === session.lastInput && Date.now() - session.lastInputAt < 4_000) {
      return { added: false, clipped: false, duplicate: true };
    }
    const existing = session.parts.join("\n");
    const remaining = Math.max(0, MAX_LETTER_CHARS - existing.length - (existing ? 1 : 0));
    const clippedText = text.slice(0, remaining);
    if (clippedText) session.parts.push(clippedText);
    session.lastInput = normalized;
    session.lastInputAt = Date.now();
    session.updatedAt = Date.now();
    return { added: Boolean(clippedText), clipped: clippedText.length < text.length };
  }

  async handleLetterInput(event, session, input) {
    if (session.state === "sent") {
      await this.postResult("letter.sent", event, { ...session.delivery, idempotent_replay: true });
      return session.delivery;
    }
    const finish = splitVoiceLetterFinish(input);
    const append = this.appendLetterContent(session, finish.content);
    if (finish.finished) return this.finalizeLetter(event, session, finish.keyword);
    await this.postResult("letter.content_buffered", event, {
      recipient: session.recipient,
      character_count: session.parts.join("\n").length,
      clipped: append.clipped,
      message: append.clipped
        ? "内容有点长了，我先帮你整理这一段。说“结束”即可发送。"
        : "这一段已经记下了。可以继续说；说“over”“发送信件”或“结束”即可自动发送。"
    });
    return { intent: "LETTER_CONTENT", buffered: true, clipped: append.clipped };
  }

  async finalizeLetter(event, session, finishKeyword) {
    if (session.state === "sending") return { intent: "SEND_LETTER", sending: true };
    const body = session.parts.join("\n").trim();
    if (!body) {
      await this.postResult("letter.send_failed", event, {
        code: "VOICE_LETTER_EMPTY",
        message: "还没有听到信件正文，请先说内容，再说“结束”。"
      });
      return { intent: "SEND_LETTER", sent: false, reason: "EMPTY_BODY" };
    }
    if (!session.recipient) {
      await this.postResult("letter.recipient_required", event, {
        code: "VOICE_RECIPIENT_REQUIRED",
        message: "还不知道收件人。请说“我要给某某写信”，然后再继续。"
      });
      return { intent: "SEND_LETTER", sent: false, reason: "RECIPIENT_REQUIRED" };
    }

    session.state = "sending";
    session.updatedAt = Date.now();
    await this.postResult("letter.sending", event, {
      recipient: session.recipient,
      finish_keyword: finishKeyword,
      message: "结束词已确认，正在整理并发送信件。"
    });
    try {
      const delivery = await this.deliverLetter({
        sessionId: session.sessionId,
        recipient: session.recipient,
        subject: "来自语音的一封信",
        body,
        source: "desktop_bot_microphone",
        idempotencyKey: session.sendKey
      });
      session.state = "sent";
      session.delivery = {
        message: `信件已发送给${delivery.recipient?.displayName ?? session.recipient}。`,
        letter_id: delivery.letterId,
        status: delivery.status,
        delivery: delivery.delivery,
        print_job: delivery.printJob ?? null,
        recipient: delivery.recipient ?? { displayName: session.recipient },
        provider: delivery.provider ?? null
      };
      session.updatedAt = Date.now();
      await this.postResult("letter.sent", event, session.delivery);
      return { intent: "SEND_LETTER", sent: true, ...session.delivery };
    } catch (error) {
      session.state = "listening";
      session.updatedAt = Date.now();
      await this.postResult("letter.send_failed", event, {
        code: error.code ?? "VOICE_LETTER_SEND_FAILED",
        message: `信件尚未发送，可以再次说“发送信件”重试：${error.message}`
      });
      return { intent: "SEND_LETTER", sent: false, error: error.message };
    }
  }

  async deliverVoiceLetter(payload) {
    const response = await this.fetch(`${this.aiHubBaseUrl}/api/v1/letters/voice/send`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": payload.idempotencyKey
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30_000)
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(result.detail ?? result.title ?? `VOICE_LETTER_${response.status}`);
      error.code = result.code ?? "VOICE_LETTER_SEND_FAILED";
      throw error;
    }
    return result;
  }

  async startTurtleGame(payload = {}) {
    const response = await this.fetch(`${this.aiHubBaseUrl}/api/v1/games/turtle-soup/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30_000)
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(result.detail ?? result.title ?? `TURTLE_START_${response.status}`);
    }
    return result;
  }

  async askTurtleGame(payload = {}) {
    const response = await this.fetch(`${this.aiHubBaseUrl}/api/v1/games/turtle-soup/answer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30_000)
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(result.detail ?? result.title ?? `TURTLE_ANSWER_${response.status}`);
    }
    return result;
  }

  async postResult(eventType, trigger, payload) {
    const response = await this.fetch(`${this.baseUrl}/api/results`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event_type: eventType,
        session_id: trigger.session_id ?? "bot",
        payload: { trigger_event_id: trigger.event_id, ...payload }
      }),
      signal: AbortSignal.timeout(10_000)
    });
    if (!response.ok) throw new Error(`RESULT_${response.status}`);
    return response.json();
  }
}

export const desktopBotBridge = new DesktopBotBridge();
