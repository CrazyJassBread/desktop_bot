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
check("voice control defaults on", await page.locator("[data-global-voice]").isChecked());
check("auto print defaults off", !(await page.locator("[data-auto-print]").isChecked()));

await page.goto(`${baseUrl}/community`, { waitUntil: "networkidle" });
check("community square remains available", await page.getByRole("heading", { name: "社区广场" }).isVisible());
await page.goto(`${baseUrl}/match`, { waitUntil: "networkidle" });
check("matching remains available", await page.getByRole("heading", { name: "遇见可能聊得来的人" }).isVisible());
await page.goto(`${baseUrl}/letter`, { waitUntil: "networkidle" });
check("letters remain available", await page.getByRole("heading", { name: "我的信件" }).isVisible());
await page.goto(`${baseUrl}/`, { waitUntil: "networkidle" });
await page.locator("#unified-command-form").waitFor();

await page.locator("[data-global-voice]").check();
await page.locator('#unified-command-form input[name="transcript"]').fill("打开设备状态");
await page.locator('#unified-command-form button[type="submit"]').click();
await page.locator(".voice-conversation-card").first().waitFor();
check("voice turn renders transcript", await page.getByText("打开设备状态", { exact: true }).first().isVisible());

await page.reload({ waitUntil: "networkidle" });
check("session survives refresh", page.url() === `${baseUrl}/` && await page.locator(".voice-command-stage").isVisible());

await page.setViewportSize({ width: 390, height: 844 });
await page.reload({ waitUntil: "networkidle" });
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
