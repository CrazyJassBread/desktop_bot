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
    assert.equal(turtle.answer, "是");
    assert.equal(turtle.truth, null);

    const turtleGame = await fetch(`${baseUrl}/games/turtle-soup/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ theme: "AI 桌面打印机" })
    }).then((response) => response.json());
    assert.match(turtleGame.story, /。|纸|打印|AI/);
    assert.equal(turtleGame.truth, null);

    const turtleRound = await fetch(`${baseUrl}/games/turtle-soup/answer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question: "是定时任务自动打印的吗？",
        sessionId: turtleGame.id,
        history: []
      })
    }).then((response) => response.json());
    assert.equal(turtleRound.verdict, "YES");
    assert.equal(turtleRound.answer, "是");
    assert.equal(turtleRound.truth, null);

    const reveal = await fetch(`${baseUrl}/games/turtle-soup/answer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: "揭晓真相", sessionId: turtleGame.id })
    }).then((response) => response.json());
    assert.equal(reveal.verdict, "REVEAL");
    assert.ok(reveal.truth.length > 10);

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

    const printForm = new FormData();
    printForm.set("source", "camera");
    printForm.set("purpose", "print");
    printForm.set("pixelSize", "4");
    printForm.set("grayscaleLevels", "8");
    printForm.set("contrast", "1");
    printForm.set("cannyLow", "80");
    printForm.set("cannyHigh", "160");
    printForm.set("image", new Blob([png], { type: "image/png" }), "camera.png");
    const printableResponse = await fetch(`${baseUrl}/photos`, {
      method: "POST",
      headers: { "Idempotency-Key": crypto.randomUUID() },
      body: printForm
    });
    const printable = await printableResponse.json();
    assert.equal(printableResponse.status, 201);
    assert.equal(printable.photo.source, "camera");
    assert.equal(printable.photo.processed.profile, "print");
    assert.equal(printable.photo.processed.width, 384);
    assert.equal(printable.photo.processed.processing.pixelSize, 4);
    assert.equal(printable.photo.processed.processing.grayscaleLevels, 8);
    assert.equal(printable.photo.processed.processing.cannyLow, 80);
    assert.equal(printable.photo.processed.processing.cannyHigh, 160);

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

    const todo = await fetch(`${baseUrl}/ai/orchestrate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transcript: "今天我要去超市买东西，下午写论文，晚上给朋友发邮件。" })
    }).then((response) => response.json());
    assert.equal(todo.intent, "ORGANIZE_PLAN");
    assert.equal(todo.printable.kind, "todo");
    assert.ok(todo.todos.length >= 3);

    const fuzzyLetter = await fetch(`${baseUrl}/ai/orchestrate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transcript: "我想给一个喜欢二次元的朋友写封信" })
    }).then((response) => response.json());
    assert.equal(fuzzyLetter.intent, "WRITE_LETTER");
    assert.equal(fuzzyLetter.recipient, "Mina");
    assert.equal(fuzzyLetter.recipientId, "usr-mina");

    const image = await fetch(`${baseUrl}/ai/orchestrate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transcript: "生成一个生日祝福卡片" })
    }).then((response) => response.json());
    assert.equal(image.intent, "OPEN_IMAGE_STUDIO");
    assert.equal(image.navigation, "/images");
    assert.ok(image.imageDescription);

    const voiceGame = await fetch(`${baseUrl}/voice/turns`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transcript: "我要玩海龟汤", mode: "default", source: "text" })
    }).then((response) => response.json());
    assert.equal(voiceGame.decision.intent, "START_TURTLE_SOUP");
    assert.equal(voiceGame.decision.mode, "turtle_soup");
    assert.equal(voiceGame.conversation.turtleGame.truth, null);

    const voiceQuestion = await fetch(`${baseUrl}/voice/turns`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transcript: "是定时任务造成的吗？", mode: "turtle_soup", source: "text" })
    }).then((response) => response.json());
    assert.equal(voiceQuestion.decision.intent, "TURTLE_SOUP_ANSWER");
    assert.match(voiceQuestion.conversation.assistantText, /^(是|不是|无关)$/u);
    assert.equal(voiceQuestion.conversation.turtleGame.truth, null);

    const voiceReveal = await fetch(`${baseUrl}/voice/turns`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transcript: "结束游戏", mode: "turtle_soup", source: "text" })
    }).then((response) => response.json());
    assert.equal(voiceReveal.decision.intent, "TURTLE_SOUP_REVEAL");
    assert.equal(voiceReveal.decision.mode, "default");
    assert.ok(voiceReveal.conversation.turtleGame.truth.length > 10);
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

test("unified voice letter flow asks, drafts, and only sends after confirmation", async () => {
  await withApi(async (baseUrl) => {
    const start = await fetch(`${baseUrl}/voice/turns`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transcript: "小P，帮我给妈妈传个话", mode: "default", source: "text" })
    }).then((response) => response.json());
    assert.equal(start.decision.intent, "WRITE_LETTER");
    assert.equal(start.decision.recipient, "妈妈");
    assert.match(start.decision.reply, /想对妈妈说些什么/);
    assert.equal(start.conversation.letterDraft.status, "WAITING_CONTENT");

    const content = await fetch(`${baseUrl}/voice/turns`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transcript: "嗯，就是明天下午会议可能改到三点，然后提前准备资料", mode: "letter_waiting_content", source: "text" })
    }).then((response) => response.json());
    assert.equal(content.decision.intent, "LETTER_CONTENT");
    assert.equal(content.conversation.letterDraft.status, "COLLECTING_CONTENT");
    assert.match(content.decision.reply, /这一段已经记下/);

    const review = await fetch(`${baseUrl}/voice/turns`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transcript: "还有谢谢他上次帮忙，结束", mode: "letter_collecting", source: "text" })
    }).then((response) => response.json());
    assert.equal(review.decision.intent, "LETTER_REVIEW");
    assert.equal(review.conversation.letterDraft.status, "WAITING_CONFIRMATION");
    assert.match(review.conversation.letterDraft.body, /明天下午会议可能改到三点/);
    assert.doesNotMatch(review.conversation.letterDraft.body, /嗯|那个|就是/);

    const sentBefore = await fetch(`${baseUrl}/letters?box=sent`).then((response) => response.json());
    const confirm = await fetch(`${baseUrl}/voice/turns`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transcript: "确认发送", mode: "letter_review", source: "text" })
    }).then((response) => response.json());
    assert.equal(confirm.decision.intent, "LETTER_SENT");
    assert.equal(confirm.conversation.letterDraft.status, "SENT");
    const sentAfter = await fetch(`${baseUrl}/letters?box=sent`).then((response) => response.json());
    assert.equal(sentAfter.items.length, sentBefore.items.length + 1);
  });
});


