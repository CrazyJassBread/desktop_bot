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
const errors = [];
const checks = [];

function watch(page, name) {
  page.on("pageerror", (error) => errors.push({ page: name, type: "pageerror", message: error.message }));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push({ page: name, type: "console", message: message.text() });
  });
  page.on("requestfailed", (request) => {
    errors.push({ page: name, type: "requestfailed", message: `${request.url()} ${request.failure()?.errorText}` });
  });
}

function check(name, passed, detail = "") {
  checks.push({ name, passed, detail });
  if (!passed) throw new Error(`${name}: ${detail}`);
}

async function waitForPrintSuccess(jobTitle, timeout = 8_000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const response = await fetch(`${baseUrl}/api/v1/print-jobs`);
    const body = await response.json();
    const job = body.items.find((item) => item.title === jobTitle);
    if (job?.status === "SUCCESS") return job;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  throw new Error(`Print job did not reach SUCCESS: ${jobTitle}`);
}

try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1 });
  const main = await context.newPage();
  watch(main, "main");
  const simulator = await context.newPage();
  watch(simulator, "simulator");
  await simulator.goto(`${baseUrl}/simulator.html`, { waitUntil: "networkidle" });

  await main.goto(baseUrl, { waitUntil: "networkidle" });
  check("AI Hub home renders", await main.locator("#home-view").isVisible());
  check("companion navigation restores learning, play and life", await main.locator('.desktop-nav button[data-nav="/education"]').isVisible()
    && await main.locator('.desktop-nav button[data-nav="/entertainment"]').isVisible()
    && await main.locator('.desktop-nav button[data-nav="/life"]').isVisible());
  check("home exposes all companion spaces", await main.locator(".companion-launcher > button").count() === 3);
  check("home shows Letter and device summaries", await main.locator(".home-letter-callout").isVisible() && await main.locator(".device-mini").isVisible());
  await main.screenshot({ path: resolve(outputDir, "aihub-home-desktop.png"), fullPage: true });

  await main.goto(`${baseUrl}/community`, { waitUntil: "networkidle" });
  check("direct community route refresh works", await main.locator("#community-view").isVisible());
  check("community feed uses API data", await main.locator(".post-card").count() >= 5);
  await main.locator('[data-category="日常"]').click();
  await main.locator(".post-card").first().waitFor();
  check("category filtering works", await main.locator(".post-card").count() >= 1);
  await main.locator('#community-search-form input').fill("雨声");
  await main.locator("#community-search-form button").click();
  check("community search returns lifestyle content", (await main.locator(".post-card h2").first().textContent())?.includes("雨声"));

  const likeButton = main.locator(".post-card").first().locator("[data-like-post]");
  const wasLiked = await likeButton.evaluate((element) => element.classList.contains("active"));
  await Promise.all([
    main.waitForResponse((response) => response.url().includes("/reactions") && response.ok()),
    likeButton.click()
  ]);
  await main.locator(".post-card").first().locator(wasLiked ? "[data-like-post]:not(.active)" : "[data-like-post].active").waitFor();
  const isLiked = await main.locator(".post-card").first().locator("[data-like-post]").evaluate((element) => element.classList.contains("active"));
  check("post reaction API updates card", isLiked !== wasLiked);
  await main.locator(".post-card").first().locator("[data-open-post]").first().click();
  await main.locator(".post-modal").waitFor();
  await main.locator("#comment-form input").fill("这条评论来自真实浏览器 API 验收。");
  await Promise.all([
    main.waitForResponse((response) => response.url().includes("/api/v1/posts/") && response.url().endsWith("/comments") && response.ok()),
    main.locator("#comment-form button").click()
  ]);
  const qaComments = main.getByText("这条评论来自真实浏览器 API 验收。", { exact: true });
  await qaComments.first().waitFor();
  check("post comment API updates detail", (await qaComments.count()) >= 1 && await qaComments.first().isVisible());
  await main.locator("[data-close-modal]").click();
  await main.screenshot({ path: resolve(outputDir, "aihub-community-desktop.png"), fullPage: true });

  await main.goto(`${baseUrl}/create-post`, { waitUntil: "networkidle" });
  await main.locator('.type-picker label:has(input[value="PROJECT"])').click();
  await main.locator('input[name="title"]').fill("周末做了一页关于夏天的手帐拼贴");
  await main.locator('textarea[name="content"]').fill("收集了车票、落叶和一张旧照片，把这个周末慢慢贴进手帐里。");
  await main.locator('input[name="tags"]').fill("今日手帐, 拼贴, 周末");
  await main.locator("#post-form button[type=submit]").click();
  await main.locator("#community-view").waitFor();
  const qaProjects = main.getByText("周末做了一页关于夏天的手帐拼贴", { exact: true });
  check("create-post API publishes into feed", (await qaProjects.count()) >= 1 && await qaProjects.first().isVisible());

  await main.goto(`${baseUrl}/education`, { waitUntil: "networkidle" });
  check("education restores tutor, word card and study plan", await main.locator("#tutor-form").isVisible()
    && await main.locator(".flashcard").isVisible()
    && await main.locator(".study-plan").isVisible());
  await main.locator('#tutor-form input[name="question"]').fill("为什么天空是蓝色的？");
  await Promise.all([
    main.waitForResponse((response) => response.url().endsWith("/api/v1/ai/tutor") && response.ok()),
    main.locator("#tutor-form button").click()
  ]);
  await main.getByText(/蓝光比红光更容易/).waitFor();
  check("AI tutor answers through API", await main.getByText(/蓝光比红光更容易/).isVisible());
  await main.locator("[data-word-reveal]").click();
  check("word flashcard reveals knowledge", await main.getByText("意外发现美好事物的能力", { exact: true }).isVisible());
  const taskCount = await main.locator(".study-task-list label").count();
  await main.locator('#study-plan-form input[name="title"]').fill("听一段英文播客");
  await main.locator("#study-plan-form button").click();
  await main.getByText("听一段英文播客", { exact: true }).waitFor();
  check("study plan can add a task", await main.locator(".study-task-list label").count() === taskCount + 1);
  await main.screenshot({ path: resolve(outputDir, "aihub-education-desktop.png"), fullPage: true });

  await main.goto(`${baseUrl}/entertainment`, { waitUntil: "networkidle" });
  check("entertainment restores four components", await main.locator(".runner-card").isVisible()
    && await main.locator(".turtle-card").isVisible()
    && await main.locator(".photo-card").isVisible()
    && await main.locator(".egg-card").isVisible());
  await main.locator('[data-runner="up"]').click();
  check("runner responds to controls", await main.locator(".runner-stage.lane-up").isVisible());
  await main.locator('#turtle-form input[name="question"]').fill("是 AI 设备自己打印的吗？");
  await Promise.all([
    main.waitForResponse((response) => response.url().endsWith("/api/v1/games/turtle-soup/answer") && response.ok()),
    main.locator("#turtle-form button").click()
  ]);
  check("turtle soup returns YES or NO UI", await main.locator("#turtle-verdict").textContent() === "YES");
  await main.locator("[data-print-story]").click();
  await simulator.locator("#receipt.printing").waitFor({ state: "attached", timeout: 8_000 });
  check("turtle soup story can print on device", (await simulator.locator("#receipt-content").textContent()).includes("午夜的纸条"));
  await main.locator("#photo-input").setInputFiles({
    name: "journal.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="480" height="320"><rect width="100%" height="100%" fill="#e7dfd2"/><rect x="70" y="45" width="340" height="230" rx="16" fill="#fffaf0"/><text x="110" y="130" font-size="24" fill="#4c4a43">TODAY / 慢慢来</text><text x="110" y="175" font-size="18" fill="#80796e">也是一种前进。</text></svg>')
  });
  await main.locator(".photo-dropzone img").waitFor();
  await Promise.all([
    main.waitForResponse((response) => response.url().endsWith("/api/v1/ai/ocr") && response.ok()),
    main.locator("[data-run-ocr]").click()
  ]);
  check("Photo 2 Text shows OCR and summary", await main.getByText(/慢慢来，也是一种前进/).isVisible());
  await main.locator("[data-open-egg]").click();
  check("daily egg can be opened", await main.getByText("今天也会有小小的好事。", { exact: true }).isVisible());
  await main.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await main.waitForTimeout(100);
  await main.screenshot({ path: resolve(outputDir, "aihub-entertainment-desktop.png"), fullPage: true });

  await main.goto(`${baseUrl}/life`, { waitUntil: "networkidle" });
  check("life restores journal and fun fortune", await main.locator("#journal-form").isVisible() && await main.locator("#fortune-form").isVisible());
  await main.locator('#journal-form input[name="title"]').fill("雨停之后");
  await main.locator('#journal-form textarea[name="body"]').fill("雨停之后去楼下走了一圈，空气里有树叶和泥土的味道。");
  await Promise.all([
    main.waitForResponse((response) => response.url().endsWith("/api/v1/ai/journal/summary") && response.ok()),
    main.locator("[data-journal-summary]").click()
  ]);
  check("journal AI summary works", await main.locator("#journal-summary.ready").isVisible());
  await main.locator('#journal-form button[type="submit"]').click();
  check("journal entry persists locally", await main.getByText("雨停之后", { exact: true }).isVisible());
  await main.locator('#fortune-form input[name="birthday"]').fill("2000-01-01");
  await main.locator('#fortune-form input[name="question"]').fill("明天要不要去散步？");
  await Promise.all([
    main.waitForResponse((response) => response.url().endsWith("/api/v1/ai/fortune") && response.ok()),
    main.locator("#fortune-form button").click()
  ]);
  check("fortune is clearly entertainment-only", await main.getByText(/仅供娱乐/).isVisible());
  await main.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await main.waitForTimeout(100);
  await main.screenshot({ path: resolve(outputDir, "aihub-life-desktop.png"), fullPage: true });

  await main.goto(`${baseUrl}/match`, { waitUntil: "networkidle" });
  check("rule match cards render", await main.locator(".match-card").count() >= 4);
  check("92 percent match is explainable", await main.getByText("92%", { exact: true }).isVisible() && await main.getByText("WHY YOU MATCH", { exact: true }).first().isVisible());
  await main.locator('[data-match-card="usr-aiko"] [data-write-to]').click();
  await main.locator("#letter-create-view").waitFor();
  check("match-to-letter flow preserves recipient", await main.locator('select[name="recipientId"]').inputValue() === "usr-aiko");

  await Promise.all([
    main.waitForResponse((response) => response.url().includes("/api/v1/ai/letter/generate") && response.ok()),
    main.locator('[data-ai-letter="generate"]').click()
  ]);
  check("AI Letter endpoint fills draft", (await main.locator('textarea[name="body"]').inputValue()).includes("见字如面"));
  await main.locator('button[type="submit"][value="send"]').click();
  await main.locator("#letter-view").waitFor({ timeout: 8_000 });
  await simulator.locator("#receipt.printing").waitFor({ state: "attached", timeout: 8_000 });
  check("Letter send reaches device printer", (await simulator.locator("#receipt-content").textContent()).includes("桌面上的一件小事"));
  const job = await waitForPrintSuccess("桌面上的一件小事");
  check("device completion updates Print Job API", job.status === "SUCCESS");
  await main.screenshot({ path: resolve(outputDir, "aihub-letter-center-desktop.png"), fullPage: true });
  await simulator.screenshot({ path: resolve(outputDir, "aihub-letter-device-simulator.png"), fullPage: true });

  await main.goto(`${baseUrl}/device`, { waitUntil: "networkidle" });
  check("device and print policy render", await main.locator("#device-view").isVisible() && await main.locator(".policy-options").isVisible());
  await main.locator("#print-paused + span").click();
  await main.locator("[data-save-policy]").click();
  await main.locator("#device-view").waitFor();
  check("remote print pause persists through API", await main.locator("#print-paused").isChecked());
  await main.screenshot({ path: resolve(outputDir, "aihub-device-desktop.png"), fullPage: true });

  const auth = await context.newPage();
  watch(auth, "auth");
  await auth.goto(`${baseUrl}/register`, { waitUntil: "networkidle" });
  await auth.locator('input[name="displayName"]').fill("测试用户");
  await auth.locator('input[name="email"]').fill("test@example.com");
  await auth.locator('input[name="password"]').fill("password-123");
  await auth.locator("#auth-form button[type=submit]").click();
  await auth.locator("#home-view").waitFor();
  check("register API returns to product home", await auth.locator("#home-view").isVisible());

  const mobile = await context.newPage();
  watch(mobile, "mobile");
  await mobile.setViewportSize({ width: 390, height: 844 });
  await mobile.goto(`${baseUrl}/community`, { waitUntil: "networkidle" });
  const communityOverflow = await mobile.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check("mobile community has no horizontal overflow", communityOverflow <= 1, `overflow=${communityOverflow}`);
  check("mobile community navigation visible", await mobile.locator(".mobile-nav").isVisible());
  await mobile.screenshot({ path: resolve(outputDir, "aihub-community-mobile.png"), fullPage: true });
  await mobile.goto(`${baseUrl}/education`, { waitUntil: "networkidle" });
  const educationOverflow = await mobile.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check("mobile education has no horizontal overflow", educationOverflow <= 1, `overflow=${educationOverflow}`);
  check("mobile education retains all learning tools", await mobile.locator(".tutor-card").isVisible()
    && await mobile.locator(".word-card").isVisible()
    && await mobile.locator(".study-plan").isVisible());
  await mobile.screenshot({ path: resolve(outputDir, "aihub-education-mobile.png"), fullPage: true });
  await mobile.goto(`${baseUrl}/letter`, { waitUntil: "networkidle" });
  const letterOverflow = await mobile.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check("mobile Letter center has no horizontal overflow", letterOverflow <= 1, `overflow=${letterOverflow}`);
  await mobile.screenshot({ path: resolve(outputDir, "aihub-letter-mobile.png"), fullPage: true });

  await context.close();
} finally {
  await browser.close();
}

check("no browser/runtime/request errors", errors.length === 0, JSON.stringify(errors));
await writeFile(
  resolve(outputDir, "qa-report.json"),
  JSON.stringify({ passed: checks.every((item) => item.passed), checks, errors, generatedAt: new Date().toISOString() }, null, 2)
);

console.log(JSON.stringify({ checks: checks.length, errors: errors.length, outputDir }, null, 2));
