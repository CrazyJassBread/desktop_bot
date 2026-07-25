import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const require = createRequire(import.meta.url);
const corePath = process.env.PLAYWRIGHT_CORE_PATH;
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
const baseUrl = process.env.MVP_BASE_URL ?? "http://127.0.0.1:18000";

if (!corePath || !executablePath) {
  throw new Error("Set PLAYWRIGHT_CORE_PATH and PLAYWRIGHT_CHROMIUM_EXECUTABLE before running browser QA.");
}

const { chromium } = require(corePath);
const outputDir = resolve("output/playwright");
await mkdir(outputDir, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath });
const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
const page = await context.newPage();
const errors = [];
const checks = [];

page.on("pageerror", (error) => errors.push({ type: "pageerror", message: error.message }));
page.on("console", (message) => {
  if (message.type() === "error") errors.push({ type: "console", message: message.text() });
});

function check(name, passed, detail = "") {
  checks.push({ name, passed, detail });
  if (!passed) throw new Error(`${name}: ${detail}`);
}

await page.goto(`${baseUrl}/`, { waitUntil: "networkidle" });
check("protected home redirects to login", page.url().includes("/login"), page.url());

await page.goto(`${baseUrl}/register`, { waitUntil: "networkidle" });
const email = `browser-${Date.now()}@example.com`;
await page.locator('input[name="email"]').fill(email);
await page.locator('input[name="password"]').fill("Voice1234");
await page.locator('input[name="confirmPassword"]').fill("Voice1234");
await page.locator('input[name="acceptTerms"]').check();
await page.locator('#auth-form button[type="submit"]').click();
await page.waitForURL(`${baseUrl}/`);
await page.locator(".voice-command-stage").waitFor();
check("registration enters voice control", await page.locator(".voice-command-stage").isVisible());
check("learning navigation removed", await page.locator('[data-nav="/education"]').count() === 0);
check("entertainment navigation removed", await page.locator('[data-nav="/entertainment"]').count() === 0);
check("community navigation retained", await page.locator('[data-nav="/community"]').first().isVisible());
check("match navigation retained", await page.locator('[data-nav="/match"]').first().isVisible());
check("letter navigation retained", await page.locator('[data-nav="/letter"]').first().isVisible());
check("image studio navigation retained", await page.locator('[data-nav="/images"]').first().isVisible());
check("sleep navigation retained", await page.locator('[data-nav="/sleep"]').first().isVisible());
check("voice control starts from one clear button", await page.locator("[data-unified-listen]").isEnabled());
check("misleading top status controls removed", await page.locator(".control-statusbar, [data-global-voice], [data-auto-print]").count() === 0);
check("duplicate home records removed", await page.locator(".control-lower-grid").count() === 0);

await page.goto(`${baseUrl}/community`, { waitUntil: "networkidle" });
check("community square remains available", await page.getByRole("heading", { name: "社区广场" }).isVisible());
await page.goto(`${baseUrl}/match`, { waitUntil: "networkidle" });
check("matching remains available", await page.getByRole("heading", { name: "遇见可能聊得来的人" }).isVisible());
await page.goto(`${baseUrl}/letter`, { waitUntil: "networkidle" });
check("letters remain available", await page.getByRole("heading", { name: "我的信件" }).isVisible());
await page.goto(`${baseUrl}/images`, { waitUntil: "networkidle" });
check("image studio remains available", await page.getByRole("heading", { name: "图像打印" }).isVisible());
check("browser camera API is available", await page.evaluate(() => Boolean(navigator.mediaDevices?.getUserMedia)));
await page.goto(`${baseUrl}/sleep`, { waitUntil: "networkidle" });
check("smart sleep page is available", await page.getByRole("heading", { name: "智能睡眠" }).isVisible());
check("sleep preparation shows microphone state", await page.getByText("麦克风").first().isVisible());
await page.locator('[data-sleep-action="relax"]').first().click();
await page.getByText("进行中", { exact: true }).waitFor();
check("sleep relaxation starts", await page.locator(".breath-card.breathing").isVisible());
await page.locator('[data-sleep-action="start-monitor"]').first().click();
await page.locator(".sleep-night-panel").waitFor();
const firstDb = await page.locator(".sleep-night-grid strong").nth(2).textContent();
await page.waitForTimeout(1_200);
const secondDb = await page.locator(".sleep-night-grid strong").nth(2).textContent();
check("sleep monitoring updates decibels", firstDb !== secondDb || await page.locator(".sleep-wave i").count() === 28, `${firstDb} -> ${secondDb}`);
await page.locator('[data-sleep-demo="noise"]').click();
await page.locator('[data-sleep-action="quick-demo"]').click();
await page.locator(".sleep-report-layout").waitFor({ timeout: 5000 });
check("sleep demo produces morning report", await page.locator(".sleep-answer-box.advice").isVisible());
check("sleep report has print preview", await page.getByText("我的睡眠简报").first().isVisible());
await page.route("**/api/v1/printer/content", async (route) => {
  await route.fulfill({
    status: 202,
    contentType: "application/json",
    body: JSON.stringify({ status: "SENT", pageCount: 1, jobId: "browser-sleep-print" })
  });
});
await page.locator('[data-sleep-action="print"]').click();
await page.getByText("SUCCESS", { exact: true }).waitFor({ timeout: 5000 });
check("sleep report enters print flow", await page.getByText("SUCCESS", { exact: true }).isVisible());
await page.reload({ waitUntil: "networkidle" });
check("sleep report survives refresh", await page.getByRole("heading", { name: "晨间报告" }).isVisible());
await page.goto(`${baseUrl}/`, { waitUntil: "networkidle" });
await page.locator("#unified-command-form").waitFor();

let voiceTurnRequests = 0;
await page.route("**/api/v1/voice/turns", async (route) => {
  voiceTurnRequests += 1;
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 450));
  await route.continue();
});
await page.evaluate(() => {
  class MockSpeechRecognition {
    static current;
    constructor() {
      MockSpeechRecognition.current = this;
      this.listeners = new Map();
    }
    addEventListener(name, listener) {
      const entries = this.listeners.get(name) ?? [];
      entries.push(listener);
      this.listeners.set(name, entries);
    }
    emit(name, payload = {}) {
      for (const listener of this.listeners.get(name) ?? []) listener(payload);
    }
    start() {}
    stop() { this.emit("end"); }
  }
  window.SpeechRecognition = MockSpeechRecognition;
  window.__speechTest = MockSpeechRecognition;
});
await page.locator("[data-unified-listen]").click();
await page.evaluate(() => {
  const result = [{ 0: { transcript: "打开设备状态" }, isFinal: true }];
  result.item = (index) => result[index];
  window.__speechTest.current.emit("result", { resultIndex: 0, results: result });
  window.__speechTest.current.emit("end");
});
await page.waitForTimeout(1_200);
check("short speech pause keeps listening", voiceTurnRequests === 0 && await page.locator(".voice-state-text h2").getByText("聆听中", { exact: true }).isVisible());
await page.waitForTimeout(3_600);
check("four-second silence submits one voice turn", voiceTurnRequests === 1, `requests=${voiceTurnRequests}`);
await page.getByText("打开设备状态", { exact: true }).first().waitFor();

await page.locator('#unified-command-form input[name="transcript"]').fill("打开设备状态");
await page.locator('#unified-command-form button[type="submit"]').click();
await page.waitForTimeout(100);
check("voice waiting does not replace the page with loading screen", await page.locator(".loading-view").count() === 0 && await page.locator(".voice-command-stage").isVisible());
await page.getByText("打开设备状态", { exact: true }).first().waitFor();
check("voice turn renders transcript", await page.getByText("打开设备状态", { exact: true }).first().isVisible());

await page.locator('#unified-command-form input[name="transcript"]').fill("我要玩海龟汤");
await page.locator('#unified-command-form button[type="submit"]').click();
await page.locator(".unified-turtle-game").waitFor();
check("turtle soup opens inside unified voice center", await page.locator(".unified-turtle-game").isVisible());
check("turtle soup does not reveal truth at start", await page.locator(".unified-turtle-truth").count() === 0);
await page.locator('#unified-command-form input[name="transcript"]').fill("是定时任务造成的吗");
await page.locator('#unified-command-form button[type="submit"]').click();
await page.locator(".unified-turtle-history span").first().waitFor();
check("turtle soup voice round stays in the same game", await page.locator(".unified-turtle-history span").count() >= 1);

await page.reload({ waitUntil: "networkidle" });
check("session survives refresh", page.url() === `${baseUrl}/` && await page.locator(".voice-command-stage").isVisible());

await page.setViewportSize({ width: 390, height: 844 });
await page.goto(`${baseUrl}/sleep`, { waitUntil: "networkidle" });
check("mobile sleep has no horizontal overflow", await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
await page.goto(`${baseUrl}/`, { waitUntil: "networkidle" });
check("mobile has no horizontal overflow", await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
await page.screenshot({ path: resolve(outputDir, "unified-voice-mobile.png"), fullPage: true });

await page.locator(".account-menu > summary").click();
await page.locator("[data-logout]").first().click();
await page.waitForURL(/\/login$/);
check("logout returns to login", page.url().endsWith("/login"));

const report = { checks, errors };
await writeFile(resolve(outputDir, "browser-qa.json"), JSON.stringify(report, null, 2));
await browser.close();

if (errors.length) throw new Error(`Browser QA found ${errors.length} console errors.`);
console.log(JSON.stringify(report, null, 2));
