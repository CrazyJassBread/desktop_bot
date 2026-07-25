# Paper Bridge full-stack MVP

Frontend, database, TCP audio receiver, OpenAI transcription, letter generation, and thermal-printer delivery run on one computer.

## Structure

```text
paper-bridge/
├── public/                     Browser UI
├── server/
│   ├── api/                    Login, records, letters, print jobs
│   ├── printing/               384px bitmap transport and queue worker
│   ├── services/               DeepSeek and thermal rendering
│   ├── transcription/          TCP PCM receiver, WAV encoder, OpenAI client
│   └── config.mjs              Central server configuration
├── data/                       SQLite and generated letter PNGs
├── tests/                      API, TCP, WAV, and printer tests
├── scripts/                    Production build
├── server.mjs                  HTTP and TCP entry point
└── .env.example                Configuration template
```

## Run

Copy `.env.example` to `.env.local`, add `OPENAI_API_KEY`, then run:

```bash
npm install
npm run dev
```

Services:

- Web and REST API: `http://device-ip:18000`
- Raw PCM transcription input: `device-ip:8080`
- SQLite: `data/ai-hub.sqlite`

## PCM TCP protocol

The ESP32 may connect before or after the browser requests a transcription. When the PCM stream ends, the recording is assigned to the oldest authenticated web request that is waiting.

Each TCP connection contains exactly one utterance:

```text
sample rate: 16000 Hz
channels: 1 (mono)
sample type: signed 16-bit PCM
byte order: little-endian
container/header: none
```

The audio sender must:

1. Connect to TCP port `8080`; the server accepts the audio connection even if the user has not clicked yet.
2. Send raw PCM bytes continuously.
3. Either close its write side when the utterance ends, or keep streaming: after speech starts, about 1.2 seconds of PCM silence automatically finalizes the utterance.
4. Optionally read one newline-terminated JSON response before closing the socket.

Success reply:

```json
{"ok":true,"transcript":"recognized text"}
```

Failure reply:

```json
{"ok":false,"code":"INVALID_PCM","message":"..."}
```

Pure PCM contains no identity or end marker. Therefore this MVP binds a completed utterance to the oldest waiting web request and uses either TCP end-of-stream or PCM silence as the boundary. The user must click “Request transcription” before that boundary. For multiple recording devices, add a versioned binary preamble containing a job ID before the PCM bytes.

The server receives sockets asynchronously and permits several OpenAI requests concurrently. Worker threads are intentionally not used: network and OpenAI calls are I/O-bound, and copying audio between threads would add overhead. `TRANSCRIPTION_CONCURRENCY` limits simultaneous OpenAI calls.

## OpenAI transcription

Raw PCM is wrapped in-memory as a 16 kHz mono PCM WAV, then uploaded to `/v1/audio/transcriptions` as multipart form data. The default model is `gpt-4o-mini-transcribe`.

Required configuration:

```dotenv
OPENAI_API_KEY=your-server-only-key
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_TRANSCRIPTION_MODEL=gpt-4o-mini-transcribe
TRANSCRIPTION_TCP_PORT=8080
TRANSCRIPTION_CONCURRENCY=4
```

The OpenAI key never enters browser code.

## Printer protocol

Letters are rendered into 384-pixel-wide 1-bit packed bitmap batches. When automatic printing is enabled, each batch is sent sequentially:

```http
POST http://ESP_IP/printer/image?width=384&height=BATCH_HEIGHT
Content-Type: application/octet-stream

<packed bitmap bytes>
```

Configuration:

```dotenv
ESP_PRINTER_BASE_URL=http://192.168.1.100
PRINTER_AUTO_SEND=true
PRINTER_TIMEOUT_MS=30000
PRINTER_ROTATE_180=true
```

Keep `PRINTER_AUTO_SEND=false` until the ESP address and paper direction are confirmed. Print jobs remain queued when no printer is configured. Printing does not depend on the recipient's browser being open.

## Demo accounts

- `hello@aihub.local` / `Demo1234`
- `aiko@aihub.local` / `Aiko1234`
- `mina@aihub.local` / `Mina1234`
- `noah@aihub.local` / `Noah1234`

## Verification

```bash
npm test
npm run build
```
