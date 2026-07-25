# Integrations

This directory contains companion applications that consume the `desktop_bot`
perception API instead of running on the ESP32 firmware itself.

## `ai-hub-os-web`

An MVP Web + API app for AI Hub OS:

- browser/local microphone voice commands;
- DeepSeek intent routing through server-side environment variables;
- AI Letter drafting and voice-send flow;
- 384 px thermal letter/content rendering;
- ESP32 printer dispatch;
- `desktop_bot` WebSocket bridge for board microphone events.

The hardware runtime remains at the repository root. The Web app is intentionally
kept in this integration directory so hardware perception code and product UI code
can evolve independently.
