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

test("email auth hashes credentials, restores a cookie session and revokes logout", async () => {
  await withApi(async (baseUrl) => {
    const email = `voice-${crypto.randomUUID().slice(0, 8)}@example.com`;
    const invalid = await fetch(`${baseUrl}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "short", confirmPassword: "short", acceptTerms: false })
    });
    assert.equal(invalid.status, 422);

    const registered = await fetch(`${baseUrl}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email.toUpperCase(), password: "Voice1234", confirmPassword: "Voice1234", acceptTerms: true })
    });
    assert.equal(registered.status, 201);
    const cookie = registered.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
    assert.match(cookie, /aihub_access=/);
    assert.match(cookie, /aihub_refresh=/);
    const registration = await registered.json();
    assert.equal(registration.user.email, email);
    assert.equal(registration.user.emailVerified, false);

    const session = await fetch(`${baseUrl}/auth/session`, { headers: { Cookie: cookie } });
    assert.equal(session.status, 200);
    assert.equal((await session.json()).authenticated, true);

    const duplicate = await fetch(`${baseUrl}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "Voice1234", confirmPassword: "Voice1234", acceptTerms: true })
    });
    assert.equal(duplicate.status, 409);

    const forgot = await fetch(`${baseUrl}/auth/forgot-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email })
    });
    assert.equal(forgot.status, 202);
    const resetToken = (await forgot.json()).devResetToken;
    assert.ok(resetToken);

    const reset = await fetch(`${baseUrl}/auth/reset-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: resetToken, password: "Changed1234", confirmPassword: "Changed1234" })
    });
    assert.equal(reset.status, 200);

    const relogin = await fetch(`${baseUrl}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "Changed1234", remember: false })
    });
    assert.equal(relogin.status, 200);

    const logout = await fetch(`${baseUrl}/auth/logout`, { method: "POST", headers: { Cookie: cookie } });
    assert.equal(logout.status, 204);
  });
});

test("prebuilt virtual accounts can log in without an email provider", async () => {
  await withApi(async (baseUrl) => {
    for (const [email, password, displayName] of [
      ["aiko@aihub.local", "Aiko1234", "Aiko"],
      ["mina@aihub.local", "Mina1234", "Mina"],
      ["noah@aihub.local", "Noah1234", "Noah"]
    ]) {
      const response = await fetch(`${baseUrl}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, remember: false })
      });
      assert.equal(response.status, 200);
      const result = await response.json();
      assert.equal(result.user.displayName, displayName);
      assert.equal(result.user.emailVerified, true);
    }
  });
});

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

test("Letter send creates a recipient-owned Print Job the sender cannot mutate", async () => {
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

    const forbidden = await fetch(`${baseUrl}/print-jobs/${sent.printJob.id}/device-status`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify({ status: "SUCCESS" })
    });
    assert.equal(forbidden.status, 404);

    const detail = await fetch(`${baseUrl}/letters/${draft.id}`).then((response) => response.json());
    assert.equal(detail.status, "RECEIVED");
    assert.equal(detail.printJob, null);
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

test("photo uploads create thermal album assets usable by Letters", async () => {
  await withApi(async (baseUrl) => {
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=", "base64");
    const form = new FormData();
    form.set("source", "upload");
    form.set("purpose", "letter");
    form.set("title", "手机相册照片");
    form.set("image", new Blob([png], { type: "image/png" }), "memory.png");
    const uploadedResponse = await fetch(`${baseUrl}/photos`, {
      method: "POST",
      headers: { "Idempotency-Key": crypto.randomUUID() },
      body: form
    });
    const uploaded = await uploadedResponse.json();
    assert.equal(uploadedResponse.status, 201);
    assert.equal(uploaded.photo.purpose, "letter");
    assert.equal(uploaded.photo.processed.profile, "letter");
    assert.match(uploaded.photo.processed.previewDataUrl, /^data:image\/png;base64,/);

    const album = await fetch(`${baseUrl}/photos`).then((response) => response.json());
    assert.ok(album.items.some((item) => item.id === uploaded.photo.id));

    const draft = await fetch(`${baseUrl}/letters`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify({
        recipientId: "usr-aiko",
        subject: "带照片的信",
        body: "这是一封带照片的信。",
        assetIds: [uploaded.photo.id]
      })
    }).then((response) => response.json());
    assert.equal(draft.assets[0].id, uploaded.photo.id);
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


