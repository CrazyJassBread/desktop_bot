import assert from "node:assert/strict";
import { createServer } from "node:http";
import { rm } from "node:fs/promises";
import test from "node:test";
import sharp from "sharp";
import { handleApiRequest } from "../server/api/api.mjs";
import { db } from "../server/api/database.mjs";

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

test("friendship is created only after the recipient approves the request", async () => {
  await withApi(async (base) => {
    const register = async (displayName) => {
      const email = `${crypto.randomUUID()}@example.com`;
      const response = await fetch(`${base}/auth/register`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ displayName, email, password: "Hackathon123", preferredLanguage: "en" }) });
      assert.equal(response.status, 201);
      return { email, cookie: response.headers.get("set-cookie").split(";")[0] };
    };
    const first = await register("First User");
    const second = await register("Second User");
    const added = await fetch(`${base}/friends`, { method: "POST", headers: { Cookie: first.cookie, "Content-Type": "application/json" }, body: JSON.stringify({ email: second.email }) });
    assert.equal(added.status, 201);
    const requestId = (await added.json()).request.id;
    const firstFriends = await (await fetch(`${base}/friends`, { headers: { Cookie: first.cookie } })).json();
    const secondFriends = await (await fetch(`${base}/friends`, { headers: { Cookie: second.cookie } })).json();
    assert.equal(firstFriends.items.some((friend) => friend.displayName === "Second User"), false);
    assert.ok(secondFriends.incomingRequests.some((request) => request.id === requestId));
    const approved = await fetch(`${base}/friend-requests/${requestId}/accept`, { method: "POST", headers: { Cookie: second.cookie, "Content-Type": "application/json" }, body: "{}" });
    assert.equal(approved.status, 200);
    const firstAfter = await (await fetch(`${base}/friends`, { headers: { Cookie: first.cookie } })).json();
    const secondAfter = await (await fetch(`${base}/friends`, { headers: { Cookie: second.cookie } })).json();
    assert.ok(firstAfter.items.some((friend) => friend.displayName === "Second User"));
    assert.ok(secondAfter.items.some((friend) => friend.displayName === "First User"));
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

    const photoPng = await sharp({
      create: { width: 384, height: 288, channels: 3, background: "#aaaaaa" }
    }).png().toBuffer();
    const photoResponse = await fetch(`${base}/photos`, authJson(senderCookie, "POST", {
      imageDataUrl: `data:image/png;base64,${photoPng.toString("base64")}`,
      width: 384,
      height: 288
    }));
    assert.equal(photoResponse.status, 201);
    const photo = (await photoResponse.json()).photo;
    const attachResponse = await fetch(`${base}/letters/${generated.letter.id}`, authJson(senderCookie, "PATCH", {
      subject: generated.letter.subject,
      body: generated.letter.body,
      photoId: photo.id
    }));
    assert.equal(attachResponse.status, 200);
    assert.equal((await attachResponse.json()).letter.photoId, photo.id);
    const wallResponse = await fetch(`${base}/photos`, authJson(senderCookie));
    assert.equal(wallResponse.status, 200);
    assert.ok((await wallResponse.json()).items.some((item) => item.id === photo.id));

    const renderResponse = await fetch(`${base}/letters/${generated.letter.id}/render`, authJson(senderCookie, "POST", {}));
    assert.equal(renderResponse.status, 200);
    assert.match((await renderResponse.json()).imageUrl, /\/image$/);

    const sendResponse = await fetch(`${base}/letters/${generated.letter.id}/send`, authJson(senderCookie, "POST", {}));
    assert.equal(sendResponse.status, 200);
    const sent = await sendResponse.json();
    assert.equal(sent.status, "queued");

    const recipientPhotoResponse = await fetch(`${base}/photos/${photo.id}/image`, authJson(recipientCookie));
    assert.equal(recipientPhotoResponse.status, 200);
    assert.equal(recipientPhotoResponse.headers.get("content-type"), "image/png");
    const recipientLetters = await (await fetch(`${base}/letters`, authJson(recipientCookie))).json();
    assert.ok(recipientLetters.items.some((letter) => letter.id === generated.letter.id && letter.photoUrl.endsWith("/image")));

    const notificationsResponse = await fetch(`${base}/notifications`, authJson(recipientCookie));
    assert.equal(notificationsResponse.status, 200);
    const notifications = await notificationsResponse.json();
    assert.ok(notifications.items.some((notification) => notification.letterId === sent.letterId && !notification.read));

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
    db.prepare("DELETE FROM photos WHERE id=?").run(photo.id);
    await rm(new URL(`../data/generated/${photo.id}.png`, import.meta.url), { force: true });
  });
});

test("a record can generate a letter to the signed-in user", async () => {
  await withApi(async (base) => {
    const login = await fetch(`${base}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "hello@aihub.local", password: "Demo1234" })
    });
    const cookie = login.headers.get("set-cookie").split(";")[0];
    const user = (await login.json()).user;
    const records = await (await fetch(`${base}/records`, { headers: { Cookie: cookie } })).json();
    const generatedResponse = await fetch(`${base}/records/${records.items[0].id}/generate-letter`, {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ recipientId: user.id })
    });
    assert.equal(generatedResponse.status, 201);
    const letter = (await generatedResponse.json()).letter;
    assert.equal(letter.recipientId, user.id);
    assert.equal(letter.recipientName, user.displayName);

    const changeRecipient = async (recipientId) => {
      const response = await fetch(`${base}/letters/${letter.id}`, {
        method: "PATCH",
        headers: { Cookie: cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ recipientId, subject: letter.subject, body: letter.body })
      });
      assert.equal(response.status, 200);
      return (await response.json()).letter;
    };
    assert.equal((await changeRecipient("usr-aiko")).recipientId, "usr-aiko");
    assert.equal((await changeRecipient(user.id)).recipientId, user.id);

    const renderResponse = await fetch(`${base}/letters/${letter.id}/render`, {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: "{}"
    });
    assert.equal(renderResponse.status, 200);
    const sendResponse = await fetch(`${base}/letters/${letter.id}/send`, {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: "{}"
    });
    assert.equal(sendResponse.status, 200);
    const jobs = await (await fetch(`${base}/print-jobs`, { headers: { Cookie: cookie } })).json();
    assert.ok(jobs.items.some((job) => job.letterId === letter.id && job.status === "queued"));

    db.prepare("DELETE FROM letters WHERE id=?").run(letter.id);
    await rm(new URL(`../data/generated/${letter.id}.png`, import.meta.url), { force: true });
  });
});
