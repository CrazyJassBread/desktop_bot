# Paper Bridge

Hackathon MVP for bilingual voice records, a private social circle, AI-assisted letters, and thermal-printer delivery.

## Project structure

```text
frontend/
├── public/                 Browser UI and API client
├── server/
│   ├── api/                Authentication, records, letters, print jobs
│   ├── services/           DeepSeek and thermal-letter rendering
│   └── config.mjs          Validated server-side configuration
├── data/                   SQLite database and generated letter pictures
├── tests/                  End-to-end API tests
├── scripts/                Production build validation
├── server.mjs              Web/API server entry point
├── .env.example            Safe configuration template
└── package.json
```

## Run

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:18000`. To open it from another device on the same Wi-Fi, use the host computer's LAN address, such as `http://192.168.1.20:18000`.

Demo accounts:

- `hello@aihub.local` / `Demo1234`
- `aiko@aihub.local` / `Aiko1234`
- `mina@aihub.local` / `Mina1234`
- `noah@aihub.local` / `Noah1234`

## Network architecture

The browser always calls same-origin `/api/v1` URLs. It does not need or receive the LAN backend IP, DeepSeek key, database path, or backend token.

The Node server uses `BACKEND_BASE_URL` to reach a separate backend computer or device over Wi-Fi:

```text
Browser -> http://frontend-host:18000/api/v1 -> Node app -> http://backend-host:8000
```

This avoids CORS and cross-origin cookie problems. Running the browser frontend directly on one port and calling the backend from browser JavaScript on another port is possible, but is needlessly fragile for this demo.

Copy `.env.example` to `.env.local` and set:

- `HOST=0.0.0.0` to accept connections from the LAN.
- `PUBLIC_APP_URL` to the frontend computer's LAN URL.
- `BACKEND_BASE_URL` to the backend computer's IP and port.
- `BACKEND_API_TOKEN` if the LAN backend authenticates machine-to-machine requests.
- `BACKEND_TRANSCRIBE_PATH` and `BACKEND_PRINT_PATH` to match the backend routes.
- `DEEPSEEK_API_KEY`, `DEEPSEEK_BASE_URL`, and `DEEPSEEK_MODEL` for server-side AI.
- `DATABASE_PATH` for SQLite.
- `COOKIE_SECURE=true` only when serving through HTTPS.

## Incoming-letter behavior

The frontend does not send a second request when it “receives” a letter. The backend is the source of truth:

1. Sender submits a letter to the backend.
2. Backend stores the letter for both users.
3. Backend immediately creates the recipient's print job.
4. The printer service reads or receives that job and reports its status to the backend.
5. The recipient UI refreshes letters and print jobs every 10 seconds while the Letters screen is open.

Polling is intentionally used for the hackathon because it is simple and resilient. Later, Server-Sent Events are preferable to WebSockets for instant UI notifications because updates are one-way. Printing must never depend on the recipient having a browser open.

## External backend contract to implement next

The existing transcription adapter sends:

```json
{
  "user": {
    "id": "usr-id",
    "email": "user@example.com",
    "displayName": "User"
  },
  "language": "en"
}
```

The backend should return:

```json
{
  "transcript": "Transcribed text",
  "provider": "device-or-model-name"
}
```

The print adapter should eventually receive the letter ID, recipient ID, PNG bytes or protected download URL, and an idempotency key. Its exact request format should be agreed with the backend before implementation.

## Verification

```bash
npm test
npm run build
```
