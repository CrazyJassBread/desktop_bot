import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { handleApiRequest } from "../server/api/api.mjs";

async function withApi(run) {
  const server = createServer(async (request, response) => {
    if (!(await handleApiRequest(request, response, crypto.randomUUID()))) response.writeHead(404).end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try { await run(`http://127.0.0.1:${server.address().port}/api/v1`); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}

test("SQLite authentication persists a protected user session", async () => {
  await withApi(async (base) => {
    const login = await fetch(`${base}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "hello@aihub.local", password: "Demo1234" }) });
    assert.equal(login.status, 200);
    const cookie = login.headers.get("set-cookie").split(";")[0];
    const session = await fetch(`${base}/auth/session`, { headers: { Cookie: cookie } });
    assert.equal(session.status, 200);
    assert.equal((await session.json()).user.email, "hello@aihub.local");
    const dashboard = await fetch(`${base}/dashboard`, { headers: { Cookie: cookie } });
    assert.equal(dashboard.status, 200);
    assert.equal(typeof (await dashboard.json()).counts.records, "number");
  });
});

test("protected data endpoints reject anonymous requests", async () => {
  await withApi(async (base) => {
    for (const path of ["/dashboard", "/records", "/friends", "/letters", "/account"]) {
      assert.equal((await fetch(`${base}${path}`)).status, 401);
    }
  });
});

test("new accounts are stored and can update their language", async () => {
  await withApi(async (base) => {
    const email = `demo-${crypto.randomUUID()}@example.com`;
    const registered = await fetch(`${base}/auth/register`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ displayName: "Demo User", email, password: "Hackathon123", preferredLanguage: "en" }) });
    assert.equal(registered.status, 201);
    const cookie = registered.headers.get("set-cookie").split(";")[0];
    const updated = await fetch(`${base}/account`, { method: "PATCH", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify({ displayName: "演示用户", preferredLanguage: "zh" }) });
    assert.equal(updated.status, 200);
    assert.equal((await updated.json()).user.preferredLanguage, "zh");
  });
});

test("recording to AI letter to recipient print queue works end to end", async () => {
  await withApi(async (base) => {
    const login = async (email, password) => {
      const response = await fetch(`${base}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
      assert.equal(response.status, 200);
      return response.headers.get("set-cookie").split(";")[0];
    };
    const senderCookie = await login("hello@aihub.local", "Demo1234");
    const recipientCookie = await login("aiko@aihub.local", "Aiko1234");
    const authJson = (cookie, method = "GET", body) => ({ method, headers: { Cookie: cookie, ...(body ? { "Content-Type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });

    const recordingResponse = await fetch(`${base}/recordings/start`, authJson(senderCookie, "POST", { language: "en" }));
    assert.equal(recordingResponse.status, 201);
    const recording = await recordingResponse.json();
    assert.equal(recording.job.status, "ready");

    const summaryResponse = await fetch(`${base}/records/${recording.job.recordId}/summarize`, authJson(senderCookie, "POST", {}));
    assert.equal(summaryResponse.status, 200);
    assert.ok((await summaryResponse.json()).summary.length > 20);

    const generationResponse = await fetch(`${base}/records/${recording.job.recordId}/generate-letter`, authJson(senderCookie, "POST", { recipientId: "usr-aiko" }));
    assert.equal(generationResponse.status, 201);
    const generated = await generationResponse.json();
    assert.equal(generated.letter.status, "draft");

    const renderResponse = await fetch(`${base}/letters/${generated.letter.id}/render`, authJson(senderCookie, "POST", {}));
    assert.equal(renderResponse.status, 200);
    assert.match((await renderResponse.json()).imageUrl, /\/image$/);

    const sendResponse = await fetch(`${base}/letters/${generated.letter.id}/send`, authJson(senderCookie, "POST", {}));
    assert.equal(sendResponse.status, 200);
    const sent = await sendResponse.json();
    assert.equal(sent.status, "queued");

    const jobsResponse = await fetch(`${base}/print-jobs`, authJson(recipientCookie));
    assert.equal(jobsResponse.status, 200);
    const jobs = await jobsResponse.json();
    const queuedJob = jobs.items.find((job) => job.id === sent.printJob.id);
    assert.ok(queuedJob?.imageUrl.endsWith("/image"));
    const imageResponse = await fetch(`${base.replace(/\/api\/v1$/, "")}${queuedJob.imageUrl}`, authJson(recipientCookie));
    assert.equal(imageResponse.status, 200);
    assert.equal(imageResponse.headers.get("content-type"), "image/png");

    const printedResponse = await fetch(`${base}/print-jobs/${sent.printJob.id}/status`, authJson(recipientCookie, "POST", { status: "printed" }));
    assert.equal(printedResponse.status, 200);
    assert.equal((await printedResponse.json()).printJob.status, "printed");
  });
});
