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
          senderUserId: sender.body.user.id,
          recipient: "小明",
          content: "你好"
        }
      }
    );
    assert.equal(unauthorized.response.status, 401);

    const payload = {
      senderUserId: sender.body.user.id,
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
    const sender = await register(
      application.baseUrl,
      "林安",
      "lin@example.test"
    );
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
          senderUserId: sender.body.user.id,
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
          senderUserId: sender.body.user.id,
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
          senderUserId: sender.body.user.id,
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

test("logged-in user can bind an online computer and logout unbinds it", async () => {
  const directory = await mkdtemp(join(tmpdir(), "letter-space-"));
  const application = await listen(join(directory, "letters.sqlite"));
  try {
    const registered = await register(
      application.baseUrl,
      "林安",
      "lin@example.test"
    );
    const bridgeHeaders = { Authorization: `Bearer ${bridgeToken}` };

    const presence = await request(
      application.baseUrl,
      "/api/v1/app/gateways/presence",
      {
        method: "POST",
        headers: bridgeHeaders,
        body: {
          gatewayId: "computer-one",
          pairingCode: "482913",
          connected: true
        }
      }
    );
    assert.equal(presence.response.status, 200);
    assert.equal(presence.body.gateway.connected, true);
    assert.equal(presence.body.gateway.user, null);

    const anonymousBind = await request(
      application.baseUrl,
      "/api/v1/gateways/bind",
      {
        method: "POST",
        body: { pairingCode: "482913" }
      }
    );
    assert.equal(anonymousBind.response.status, 401);

    const bound = await request(
      application.baseUrl,
      "/api/v1/gateways/bind",
      {
        method: "POST",
        cookie: registered.cookie,
        body: { pairingCode: "482913" }
      }
    );
    assert.equal(bound.response.status, 200);
    assert.equal(bound.body.gateway.user.email, "lin@example.test");

    const owner = await request(
      application.baseUrl,
      "/api/v1/app/gateways/computer-one/owner",
      { headers: bridgeHeaders }
    );
    assert.equal(owner.response.status, 200);
    assert.equal(owner.body.user.id, registered.body.user.id);

    const logout = await request(
      application.baseUrl,
      "/api/v1/auth/logout",
      {
        method: "POST",
        cookie: registered.cookie,
        body: {}
      }
    );
    assert.equal(logout.response.status, 200);

    const unbound = await request(
      application.baseUrl,
      "/api/v1/app/gateways/computer-one/owner",
      { headers: bridgeHeaders }
    );
    assert.equal(unbound.response.status, 404);
    assert.equal(unbound.body.error.code, "GATEWAY_NOT_BOUND");
  } finally {
    await application.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("users can become pen pals, exchange web letters and manage drafts", async () => {
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

    const requestFriend = await request(
      application.baseUrl,
      "/api/v1/friends/request",
      {
        method: "POST",
        cookie: sender.cookie,
        body: { email: "ming@example.test" }
      }
    );
    assert.equal(requestFriend.response.status, 200);
    assert.equal(requestFriend.body.outgoing.length, 1);

    const beforeAccept = await request(
      application.baseUrl,
      "/api/v1/letters",
      {
        method: "POST",
        cookie: sender.cookie,
        body: {
          recipientUserId: recipient.body.user.id,
          subject: "寄不出去的信",
          content: "现在还不是笔友。"
        }
      }
    );
    assert.equal(beforeAccept.response.status, 403);

    const accept = await request(
      application.baseUrl,
      `/api/v1/friends/${sender.body.user.id}/accept`,
      {
        method: "POST",
        cookie: recipient.cookie,
        body: {}
      }
    );
    assert.equal(accept.response.status, 200);
    assert.equal(accept.body.friends.length, 1);

    const draft = await request(
      application.baseUrl,
      "/api/v1/drafts",
      {
        method: "POST",
        cookie: sender.cookie,
        body: {
          recipientUserId: recipient.body.user.id,
          subject: "周末",
          content: "这周末"
        }
      }
    );
    assert.equal(draft.response.status, 201);

    const updated = await request(
      application.baseUrl,
      `/api/v1/drafts/${draft.body.draft.id}`,
      {
        method: "PUT",
        cookie: sender.cookie,
        body: {
          recipientUserId: recipient.body.user.id,
          subject: "周末的来信",
          content: "这周末我去了西湖。"
        }
      }
    );
    assert.equal(updated.response.status, 200);
    assert.equal(updated.body.draft.content, "这周末我去了西湖。");

    const sent = await request(
      application.baseUrl,
      "/api/v1/letters",
      {
        method: "POST",
        cookie: sender.cookie,
        body: {
          recipientUserId: recipient.body.user.id,
          subject: updated.body.draft.subject,
          content: updated.body.draft.content,
          draftId: draft.body.draft.id
        }
      }
    );
    assert.equal(sent.response.status, 201);

    const recipientInbox = await request(
      application.baseUrl,
      "/api/v1/letters?box=inbox",
      { cookie: recipient.cookie }
    );
    assert.equal(recipientInbox.body.letters.length, 1);
    assert.equal(recipientInbox.body.letters[0].subject, "周末的来信");

    const draftsAfterSend = await request(
      application.baseUrl,
      "/api/v1/drafts",
      { cookie: sender.cookie }
    );
    assert.equal(draftsAfterSend.body.drafts.length, 0);
  } finally {
    await application.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("drafts are private to their owner", async () => {
  const directory = await mkdtemp(join(tmpdir(), "letter-space-"));
  const application = await listen(join(directory, "letters.sqlite"));
  try {
    const owner = await register(
      application.baseUrl,
      "林安",
      "lin@example.test"
    );
    const stranger = await register(
      application.baseUrl,
      "路人",
      "stranger@example.test"
    );
    const created = await request(application.baseUrl, "/api/v1/drafts", {
      method: "POST",
      cookie: owner.cookie,
      body: { subject: "私人草稿", content: "只属于我。" }
    });

    const deletion = await request(
      application.baseUrl,
      `/api/v1/drafts/${created.body.draft.id}`,
      { method: "DELETE", cookie: stranger.cookie }
    );
    assert.equal(deletion.response.status, 404);

    const ownerDrafts = await request(
      application.baseUrl,
      "/api/v1/drafts",
      { cookie: owner.cookie }
    );
    assert.equal(ownerDrafts.body.drafts.length, 1);
  } finally {
    await application.close();
    await rm(directory, { recursive: true, force: true });
  }
});
