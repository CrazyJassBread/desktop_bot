import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createWebServer } from "../server.mjs";

const bridgeToken = "test-bridge-token-with-enough-entropy";

async function listen(databasePath) {
  const application = createWebServer({
    databasePath,
    bridgeToken,
    secureCookies: false
  });
  await new Promise((resolve) => {
    application.server.listen(0, "127.0.0.1", resolve);
  });
  return {
    ...application,
    baseUrl: `http://127.0.0.1:${application.server.address().port}`
  };
}

async function request(baseUrl, path, options = {}) {
  const headers = new Headers(options.headers);
  if (options.cookie) headers.set("Cookie", options.cookie);
  if (options.body) headers.set("Content-Type", "application/json");
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const body = await response.json();
  return {
    response,
    body,
    cookie: response.headers.get("set-cookie")?.split(";")[0] ?? null
  };
}

async function register(baseUrl, displayName, email) {
  return request(baseUrl, "/api/v1/auth/register", {
    method: "POST",
    body: {
      displayName,
      email,
      password: "correct-horse-battery-staple"
    }
  });
}

test("registration, login and protected sessions are durable", async () => {
  const directory = await mkdtemp(join(tmpdir(), "letter-space-"));
  const databasePath = join(directory, "letters.sqlite");
  let application = await listen(databasePath);
  try {
    const created = await register(
      application.baseUrl,
      "林安",
      "lin@example.test"
    );
    assert.equal(created.response.status, 201);
    assert.ok(created.cookie);
    assert.equal(created.body.user.email, "lin@example.test");

    const duplicate = await register(
      application.baseUrl,
      "另一个林安",
      "lin@example.test"
    );
    assert.equal(duplicate.response.status, 409);

    const anonymous = await request(
      application.baseUrl,
      "/api/v1/letters"
    );
    assert.equal(anonymous.response.status, 401);

    await application.close();
    application = await listen(databasePath);
    const login = await request(application.baseUrl, "/api/v1/auth/login", {
      method: "POST",
      body: {
        email: "lin@example.test",
        password: "correct-horse-battery-staple"
      }
    });
    assert.equal(login.response.status, 200);
    assert.equal(login.body.user.displayName, "林安");
  } finally {
    await application.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("one App voice letter appears in both users' letter spaces", async () => {
  const directory = await mkdtemp(join(tmpdir(), "letter-space-"));
  const application = await listen(join(directory, "letters.sqlite"));
  try {
    const sender = await register(
      application.baseUrl,
      "林安",
      "lin@example.test"
    );
    const recipient = await register(
      application.baseUrl,
      "小明",
      "ming@example.test"
    );

    const unauthorized = await request(
      application.baseUrl,
      "/api/v1/app/voice-letters",
      {
        method: "POST",
        body: {
          senderEmail: "lin@example.test",
          recipient: "小明",
          content: "你好"
        }
      }
    );
    assert.equal(unauthorized.response.status, 401);

    const payload = {
      senderEmail: "lin@example.test",
      recipient: "小明",
      subject: "来自杭州的信",
      content: "谢谢你一直以来的陪伴。",
      eventId: "llm-event-001"
    };
    const created = await request(
      application.baseUrl,
      "/api/v1/app/voice-letters",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${bridgeToken}` },
        body: payload
      }
    );
    assert.equal(created.response.status, 201);
    assert.equal(created.body.letter.box, "sent");

    const replayed = await request(
      application.baseUrl,
      "/api/v1/app/voice-letters",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${bridgeToken}` },
        body: payload
      }
    );
    assert.equal(replayed.response.status, 200);
    assert.equal(replayed.body.replayed, true);
    assert.equal(replayed.body.letter.id, created.body.letter.id);

    const sent = await request(
      application.baseUrl,
      "/api/v1/letters?box=sent",
      { cookie: sender.cookie }
    );
    const inbox = await request(
      application.baseUrl,
      "/api/v1/letters?box=inbox",
      { cookie: recipient.cookie }
    );
    assert.equal(sent.body.letters.length, 1);
    assert.equal(inbox.body.letters.length, 1);
    assert.equal(sent.body.letters[0].id, inbox.body.letters[0].id);
    assert.equal(sent.body.letters[0].box, "sent");
    assert.equal(inbox.body.letters[0].box, "inbox");
    assert.equal(inbox.body.letters[0].sender.displayName, "林安");
  } finally {
    await application.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("voice sync rejects unregistered or ambiguous recipients", async () => {
  const directory = await mkdtemp(join(tmpdir(), "letter-space-"));
  const application = await listen(join(directory, "letters.sqlite"));
  try {
    await register(application.baseUrl, "林安", "lin@example.test");
    await register(application.baseUrl, "小明", "ming-one@example.test");
    await register(application.baseUrl, "小明", "ming-two@example.test");
    const headers = { Authorization: `Bearer ${bridgeToken}` };

    const missing = await request(
      application.baseUrl,
      "/api/v1/app/voice-letters",
      {
        method: "POST",
        headers,
        body: {
          senderEmail: "lin@example.test",
          recipient: "不存在",
          content: "你好"
        }
      }
    );
    assert.equal(missing.response.status, 404);

    const ambiguous = await request(
      application.baseUrl,
      "/api/v1/app/voice-letters",
      {
        method: "POST",
        headers,
        body: {
          senderEmail: "lin@example.test",
          recipient: "小明",
          content: "你好"
        }
      }
    );
    assert.equal(ambiguous.response.status, 409);

    const exactEmail = await request(
      application.baseUrl,
      "/api/v1/app/voice-letters",
      {
        method: "POST",
        headers,
        body: {
          senderEmail: "lin@example.test",
          recipient: "ming-one@example.test",
          content: "你好"
        }
      }
    );
    assert.equal(exactEmail.response.status, 201);
  } finally {
    await application.close();
    await rm(directory, { recursive: true, force: true });
  }
});
