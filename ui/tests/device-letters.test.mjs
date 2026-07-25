import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

// Configure the environment before the app modules read it.
process.env.DATABASE_PATH = join(mkdtempSync(join(tmpdir(), "paperbridge-test-")), "test.sqlite");
process.env.DEVICE_API_TOKEN = "test-device-token";
process.env.DEVICE_USER_EMAIL = "hello@aihub.local";
const { handleApiRequest } = await import("../server/api/api.mjs");

async function withApi(run) {
  const server = createServer(async (request, response) => {
    if (!(await handleApiRequest(request, response, crypto.randomUUID()))) response.writeHead(404).end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try { await run(`http://127.0.0.1:${server.address().port}/api/v1`); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}

const deviceJson = (body, token = "test-device-token") => ({
  method: "POST",
  headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  body: JSON.stringify(body)
});

async function login(base, email, password) {
  const response = await fetch(`${base}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
  assert.equal(response.status, 200);
  return response.headers.get("set-cookie").split(";")[0];
}

const authJson = (cookie, method = "GET", body) => ({ method, headers: { Cookie: cookie, ...(body ? { "Content-Type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });

test("device letters endpoint rejects missing or wrong tokens", async () => {
  await withApi(async (base) => {
    const missing = await fetch(`${base}/device/letters`, deviceJson({ body: "hi" }, ""));
    assert.equal(missing.status, 401);
    const wrong = await fetch(`${base}/device/letters`, deviceJson({ body: "hi" }, "not-the-token"));
    assert.equal(wrong.status, 401);
    const empty = await fetch(`${base}/device/letters`, deviceJson({ body: "" }));
    assert.equal(empty.status, 422);
  });
});

test("matched friend letters are rendered and queued for printing", async () => {
  await withApi(async (base) => {
    const response = await fetch(`${base}/device/letters`, deviceJson({
      recipientName: "  aiko ",
      subject: "问候",
      body: "亲爱的Aiko，最近好吗？",
      rawTranscript: "告诉Aiko 最近好吗",
      sessionId: "sess-1"
    }));
    assert.equal(response.status, 201);
    const result = await response.json();
    assert.equal(result.status, "queued");
    assert.equal(result.matchedRecipient, "Aiko");

    const senderCookie = await login(base, "hello@aihub.local", "Demo1234");
    const letters = await (await fetch(`${base}/letters`, authJson(senderCookie))).json();
    const letter = letters.items.find((item) => item.id === result.letterId);
    assert.equal(letter.status, "queued");
    assert.equal(letter.recipientName, "Aiko");
    assert.ok(letter.imageUrl);
    assert.ok(letter.sourceRecordId);
    const records = await (await fetch(`${base}/records`, authJson(senderCookie))).json();
    assert.ok(records.items.some((record) => record.id === letter.sourceRecordId && record.transcript.includes("告诉Aiko")));

    const recipientCookie = await login(base, "aiko@aihub.local", "Aiko1234");
    const jobs = await (await fetch(`${base}/print-jobs`, authJson(recipientCookie))).json();
    assert.ok(jobs.items.some((job) => job.letterId === result.letterId && job.status === "queued"));
  });
});

test("unmatched recipients land in the sender's draft box", async () => {
  await withApi(async (base) => {
    const response = await fetch(`${base}/device/letters`, deviceJson({
      recipientName: "妈妈",
      subject: "",
      body: "妈妈，我很想你。",
      rawTranscript: "开始写信 告诉妈妈 我很想你"
    }));
    assert.equal(response.status, 201);
    const result = await response.json();
    assert.equal(result.status, "draft");
    assert.equal(result.matchedRecipient, null);

    const senderCookie = await login(base, "hello@aihub.local", "Demo1234");
    const letters = await (await fetch(`${base}/letters`, authJson(senderCookie))).json();
    const draft = letters.items.find((item) => item.id === result.letterId);
    assert.equal(draft.status, "draft");
    assert.equal(draft.recipientId, null);
    assert.equal(draft.recipientName, null);

    // Rendering and sending are blocked until a recipient is chosen.
    assert.equal((await fetch(`${base}/letters/${result.letterId}/render`, authJson(senderCookie, "POST", {}))).status, 409);
    assert.equal((await fetch(`${base}/letters/${result.letterId}/send`, authJson(senderCookie, "POST", {}))).status, 409);
  });
});

test("drafts can be assigned a recipient and then sent", async () => {
  await withApi(async (base) => {
    const created = await (await fetch(`${base}/device/letters`, deviceJson({ recipientName: null, subject: "补寄", body: "这封信先存草稿。" }))).json();
    assert.equal(created.status, "draft");

    const senderCookie = await login(base, "hello@aihub.local", "Demo1234");
    const stranger = await fetch(`${base}/letters/${created.letterId}`, authJson(senderCookie, "PATCH", { recipientId: "usr-nobody" }));
    assert.equal(stranger.status, 422);

    const patched = await fetch(`${base}/letters/${created.letterId}`, authJson(senderCookie, "PATCH", { recipientId: "usr-mina", body: "这封信现在寄给Mina。" }));
    assert.equal(patched.status, 200);
    assert.equal((await patched.json()).letter.recipientId, "usr-mina");

    assert.equal((await fetch(`${base}/letters/${created.letterId}/render`, authJson(senderCookie, "POST", {}))).status, 200);
    const sent = await fetch(`${base}/letters/${created.letterId}/send`, authJson(senderCookie, "POST", {}));
    assert.equal(sent.status, 200);
    assert.equal((await sent.json()).status, "queued");

    const recipientCookie = await login(base, "mina@aihub.local", "Mina1234");
    const jobs = await (await fetch(`${base}/print-jobs`, authJson(recipientCookie))).json();
    assert.ok(jobs.items.some((job) => job.letterId === created.letterId));
  });
});
