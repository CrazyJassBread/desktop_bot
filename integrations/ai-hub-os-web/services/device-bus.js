const CHANNEL_NAME = "ai-hardware-hub-device-v1";
const FALLBACK_EVENT = "ai-hardware-hub:device-message";

export class DeviceBus {
  #channel = null;
  #listeners = new Set();
  #source;

  constructor(source) {
    this.#source = source;

    if (typeof BroadcastChannel !== "undefined") {
      this.#channel = new BroadcastChannel(CHANNEL_NAME);
      this.#channel.addEventListener("message", (event) => this.#emit(event.data));
    }

    if (typeof window !== "undefined") {
      window.addEventListener(FALLBACK_EVENT, (event) => this.#emit(event.detail));
      window.addEventListener("storage", (event) => {
        if (event.key !== FALLBACK_EVENT || !event.newValue) return;
        try {
          this.#emit(JSON.parse(event.newValue));
        } catch {
          // Ignore malformed fallback messages.
        }
      });
    }
  }

  send(type, payload = {}) {
    const message = {
      schema: "device.message.v1",
      messageId: crypto.randomUUID(),
      source: this.#source,
      type,
      occurredAt: new Date().toISOString(),
      payload
    };

    if (this.#channel) {
      this.#channel.postMessage(message);
    } else if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent(FALLBACK_EVENT, { detail: message }));
      try {
        localStorage.setItem(FALLBACK_EVENT, JSON.stringify(message));
      } catch {
        // Storage fallback is optional.
      }
    }

    return message;
  }

  onMessage(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  close() {
    this.#channel?.close();
    this.#listeners.clear();
  }

  #emit(message) {
    if (!message || message.source === this.#source) return;
    for (const listener of this.#listeners) listener(message);
  }
}
