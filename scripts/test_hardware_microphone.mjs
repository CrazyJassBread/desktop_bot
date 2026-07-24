const baseUrl = String(process.env.DESKTOP_BOT_BASE_URL ?? "http://127.0.0.1:8090").replace(/\/+$/, "");
const wsUrl = new URL(process.env.DESKTOP_BOT_WEBSOCKET_PATH ?? "/api/events", baseUrl);
wsUrl.protocol = wsUrl.protocol === "https:" ? "wss:" : "ws:";

function line(label, message) {
  const time = new Date().toLocaleTimeString("zh-CN", { hour12: false });
  process.stdout.write(`[${time}] ${label.padEnd(10)} ${message}\n`);
}

async function main() {
  let health;
  try {
    const response = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(5_000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    health = await response.json();
  } catch (error) {
    console.error(`无法连接 desktop_bot：${baseUrl}/api/health (${error.message})`);
    console.error("请先在 desktop_bot 仓库执行：python -m app --audio-only");
    process.exitCode = 1;
    return;
  }

  line("CONNECTED", `${baseUrl} · audio frames ${health.metrics?.audio_frames_received ?? 0}`);
  line("STEP 1", "对板载麦克风说：我要给妈妈写一封信");
  line("STEP 2", "继续说一段正文");
  line("STEP 3", "最后说：over、发送信件 或 结束");
  line("WAITING", "正在等待 ESP32 麦克风、ASR 与 Letter 回执……");

  const socket = new WebSocket(wsUrl);
  const timeout = setTimeout(() => {
    line("TIMEOUT", "5 分钟内没有收到 letter.sent，请检查 ESP32 是否连接 PC 的 TCP 8081。");
    socket.close();
    process.exitCode = 2;
  }, 5 * 60 * 1_000);

  socket.addEventListener("open", () => line("WEBSOCKET", wsUrl.toString()));
  socket.addEventListener("message", ({ data }) => {
    let event;
    try {
      event = JSON.parse(String(data));
    } catch {
      return;
    }
    const payload = event.payload ?? {};
    if (event.event_type === "speech.transcribed") {
      line("ASR", payload.transcript ?? "(empty)");
      return;
    }
    if (event.event_type?.startsWith("letter.")) {
      line(event.event_type.toUpperCase(), payload.message ?? JSON.stringify(payload));
    }
    if (event.event_type === "letter.sent") {
      clearTimeout(timeout);
      line("PASS", `信件 ${payload.letter_id ?? ""} 已发送，幂等保护已生效。`);
      socket.close();
    }
  });
  socket.addEventListener("error", () => line("ERROR", "WebSocket 连接失败，请确认 desktop_bot API 已启用 8090 端口。"));
  socket.addEventListener("close", () => clearTimeout(timeout));
}

await main();
