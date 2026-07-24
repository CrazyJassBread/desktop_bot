import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { handleApiRequest } from "../api/mock-api.mjs";

async function withApi(run) {
  const server = createServer(async (request, response) => {
    const requestId = crypto.randomUUID();
    if (!(await handleApiRequest(request, response, requestId))) {
      response.writeHead(404).end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  try {
    await run(`http://127.0.0.1:${address.port}/api/v1`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("community API supports read, idempotent create and interaction", async () => {
  await withApi(async (baseUrl) => {
    const initial = await fetch(`${baseUrl}/posts`).then((response) => response.json());
    assert.ok(initial.items.length >= 5);

    const missingKey = await fetch(`${baseUrl}/posts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "No key", content: "Rejected" })
    });
    assert.equal(missingKey.status, 400);

    const idempotencyKey = crypto.randomUUID();
    const payload = { type: "PROJECT", title: "API 测试项目", content: "ESP32 + Letter", tags: ["ESP32"] };
    const create = () => fetch(`${baseUrl}/posts`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
      body: JSON.stringify(payload)
    });
    const first = await create();
    const firstBody = await first.json();
    const replay = await create();
    const replayBody = await replay.json();
    assert.equal(first.status, 201);
    assert.equal(replayBody.id, firstBody.id);
    assert.equal(replay.headers.get("idempotent-replayed"), "true");

    const reaction = await fetch(`${baseUrl}/posts/${firstBody.id}/reactions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify({ type: "LIKE" })
    }).then((response) => response.json());
    assert.equal(reaction.active, true);
    assert.equal(reaction.likeCount, 1);
  });
});

test("Letter send creates a Print Job that accepts device status", async () => {
  await withApi(async (baseUrl) => {
    const draftResponse = await fetch(`${baseUrl}/letters`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify({
        recipientId: "usr-aiko",
        subject: "测试 Letter",
        body: "这是一封接口测试信件。",
        sourceLanguage: "zh-CN"
      })
    });
    const draft = await draftResponse.json();
    assert.equal(draft.status, "DRAFT");

    const sentResponse = await fetch(`${baseUrl}/letters/${draft.id}/send`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": crypto.randomUUID(),
        "If-Match": `"${draft.version}"`
      },
      body: JSON.stringify({ confirmRecipientId: "usr-aiko" })
    });
    const sent = await sentResponse.json();
    assert.equal(sentResponse.status, 202);
    assert.equal(sent.delivery.status, "RECEIVED");
    assert.equal(sent.printJob.status, "WAITING_DEVICE");

    const completed = await fetch(`${baseUrl}/print-jobs/${sent.printJob.id}/device-status`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify({ status: "SUCCESS" })
    }).then((response) => response.json());
    assert.equal(completed.status, "SUCCESS");

    const detail = await fetch(`${baseUrl}/letters/${draft.id}`).then((response) => response.json());
    assert.equal(detail.status, "PRINTED");
  });
});

test("matching and AI Letter endpoints expose stable product contracts", async () => {
  await withApi(async (baseUrl) => {
    const matching = await fetch(`${baseUrl}/matches`).then((response) => response.json());
    assert.equal(matching.items[0].score, 92);
    assert.equal(matching.items[0].algorithmVersion, "rules-2026-07");
    assert.equal(Object.keys(matching.items[0].components).length, 4);

    const generated = await fetch(`${baseUrl}/ai/letter/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify({ subject: "", body: "" })
    }).then((response) => response.json());
    assert.match(generated.suggestion, /见字如面/);
    assert.equal(generated.safety.decision, "ALLOW");
  });
});

test("companion learning, play and life endpoints are interactive", async () => {
  await withApi(async (baseUrl) => {
    const tutor = await fetch(`${baseUrl}/ai/tutor`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: "为什么天空是蓝色的？" })
    }).then((response) => response.json());
    assert.match(tutor.answer, /蓝光/);
    assert.equal(tutor.safety.decision, "ALLOW");

    const turtle = await fetch(`${baseUrl}/games/turtle-soup/answer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: "是 AI 设备自己打印的吗？" })
    }).then((response) => response.json());
    assert.equal(turtle.verdict, "YES");

    const turtleGame = await fetch(`${baseUrl}/games/turtle-soup/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ theme: "AI 桌面打印机" })
    }).then((response) => response.json());
    assert.match(turtleGame.story, /。|纸|打印|AI/);
    assert.ok(turtleGame.truth.length > 10);

    const turtleRound = await fetch(`${baseUrl}/games/turtle-soup/answer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question: "是定时任务自动打印的吗？",
        story: turtleGame,
        history: []
      })
    }).then((response) => response.json());
    assert.ok(["YES", "CLOSE"].includes(turtleRound.verdict));

    const ocr = await fetch(`${baseUrl}/ai/ocr`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileName: "journal.png" })
    }).then((response) => response.json());
    assert.match(ocr.extractedText, /慢慢来/);
    assert.ok(ocr.confidence > 0.9);

    const summary = await fetch(`${baseUrl}/ai/journal/summary`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: "今天下雨了，我在窗边安静地读完了一章书。" })
    }).then((response) => response.json());
    assert.match(summary.summary, /关键词/);

    const fortune = await fetch(`${baseUrl}/ai/fortune`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ birthday: "2000-01-01", question: "明天要不要去散步？" })
    }).then((response) => response.json());
    assert.match(fortune.disclaimer, /仅供娱乐/);
  });
});

test("AI orchestrator requires confirmation before every print action", async () => {
  await withApi(async (baseUrl) => {
    const staged = await fetch(`${baseUrl}/ai/orchestrate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        transcript: "帮我打印今日计划",
        context: { tasks: [{ title: "复习单词", time: "09:00" }] }
      })
    }).then((response) => response.json());
    assert.equal(staged.intent, "PRINT_TODAY_PLAN");
    assert.equal(staged.requiresConfirmation, true);
    assert.equal(staged.printable.kind, "todo");
    assert.notEqual(staged.executeConfirmedPrint, true);

    const confirmed = await fetch(`${baseUrl}/ai/orchestrate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transcript: "开始打印", context: { pendingPrintable: staged.printable } })
    }).then((response) => response.json());
    assert.equal(confirmed.intent, "CONFIRM_PRINT");
    assert.equal(confirmed.requiresConfirmation, false);
    assert.equal(confirmed.executeConfirmedPrint, true);
  });
});

test("voice Letter finish sends once with a stable idempotency key", async () => {
  await withApi(async (baseUrl) => {
    const key = `voice-test-${crypto.randomUUID()}`;
    const payload = {
      sessionId: "web-test",
      recipient: "妈妈",
      subject: "语音测试信",
      body: "嗯，最近天气变化比较大，那个你要记得照顾好身体。",
      source: "web_microphone"
    };
    const send = () => fetch(`${baseUrl}/letters/voice/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": key },
      body: JSON.stringify(payload)
    });
    const firstResponse = await send();
    const first = await firstResponse.json();
    const replayResponse = await send();
    const replay = await replayResponse.json();
    assert.equal(firstResponse.status, 202);
    assert.equal(replayResponse.status, 202);
    assert.equal(first.status, "SENT");
    assert.equal(first.recipient.displayName, "妈妈");
    assert.equal(first.letterId, replay.letterId);
    assert.equal(replayResponse.headers.get("idempotent-replayed"), "true");
    assert.ok(first.printJob);
  });
});

test("desktop_bot multipart photo callback is accepted and can be displayed", async () => {
  await withApi(async (baseUrl) => {
    const form = new FormData();
    form.set("metadata", JSON.stringify({ capture_id: "abcdef0123456789abcdef0123456789", session_id: "bot" }));
    form.set("image", new Blob([Buffer.from([0xff, 0xd8, 0xff, 0xd9])], { type: "image/jpeg" }), "capture.jpg");
    const accepted = await fetch(`${baseUrl}/hardware/photo/process`, {
      method: "POST",
      headers: { "Idempotency-Key": "abcdef0123456789abcdef0123456789" },
      body: form
    });
    const body = await accepted.json();
    assert.equal(accepted.status, 202);
    assert.equal(body.status, "accepted");
    assert.match(body.image_url, /hardware\/photos/);

    const image = await fetch(`${baseUrl}/hardware/photos/abcdef0123456789abcdef0123456789.jpg`);
    assert.equal(image.status, 200);
    assert.equal(image.headers.get("content-type"), "image/jpeg");
    assert.equal((await image.arrayBuffer()).byteLength, 4);
  });
});
