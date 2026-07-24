import iconv from "iconv-lite";
import { Readable } from "node:stream";
import {
  renderThermalLetterBatches,
  thermalLetterPreviewDataUrl
} from "../services/thermal-letter.mjs";
import {
  acceptPerceptionEvent,
  getPerceptionStatus,
  listPerceptionEvents
} from "../services/perception-gateway.mjs";
import { deepSeekChat, deepSeekConfig } from "../services/deepseek-client.mjs";
import { orchestrateTranscript } from "../services/ai-orchestrator.mjs";
import {
  renderThermalContentBatches,
  thermalContentPreviewDataUrl
} from "../services/thermal-content.mjs";
import { desktopBotBridge } from "../services/desktop-bot-bridge.mjs";

const me = {
  id: "usr-lin",
  handle: "lin-lab",
  displayName: "林安",
  avatar: "林",
  bio: "在上海做 AI 硬件，也喜欢慢慢写信。",
  countryCode: "CN",
  country: "中国",
  city: "上海",
  languages: ["中文", "English"],
  interests: ["AI", "机器人", "ESP32", "阅读"],
  skills: ["产品设计", "TypeScript", "Arduino"],
  followers: 128,
  following: 86,
  posts: 14,
  matchEnabled: true,
  letterRequestPolicy: "MATCHES",
  version: 3
};

async function desktopBotHealth() {
  try {
    const upstream = await fetch(`${desktopBotBridge.baseUrl}/api/health`, { signal: AbortSignal.timeout(3_000) });
    if (!upstream.ok) return { available: false, error: `HEALTH_${upstream.status}` };
    return { available: true, ...(await upstream.json()) };
  } catch (error) {
    return { available: false, error: error.message };
  }
}

const users = [
  me,
  {
    id: "usr-mom", handle: "mom", displayName: "妈妈", avatar: "妈",
    bio: "家人联系人，用于语音信件联调。", countryCode: "CN", country: "中国", city: "杭州",
    languages: ["中文"], interests: ["生活", "家人", "阅读"],
    skills: ["生活"], followers: 1, following: 1, posts: 0
  },
  {
    id: "usr-aiko", handle: "aiko-makes", displayName: "Aiko", avatar: "あ",
    bio: "Kyoto maker. Cameras, paper and tiny robots.", countryCode: "JP", country: "日本", city: "京都",
    languages: ["日本語", "English"], interests: ["AI", "机器人", "摄影", "手帐"],
    skills: ["硬件设计", "摄影", "Arduino"], followers: 342, following: 151, posts: 27
  },
  {
    id: "usr-noah", handle: "northbyte", displayName: "Noah", avatar: "N",
    bio: "Building quiet devices in Helsinki.", countryCode: "FI", country: "芬兰", city: "赫尔辛基",
    languages: ["English", "Suomi"], interests: ["AI", "硬件", "音乐", "自然"],
    skills: ["Python", "嵌入式", "声音设计"], followers: 201, following: 93, posts: 18
  },
  {
    id: "usr-mina", handle: "minapaper", displayName: "Mina", avatar: "M",
    bio: "Illustrator, traveler and cat person.", countryCode: "TH", country: "泰国", city: "清迈",
    languages: ["English", "ไทย", "中文"], interests: ["插画", "旅行", "猫", "手帐"],
    skills: ["插画", "设计", "内容创作"], followers: 593, following: 178, posts: 46
  },
  {
    id: "usr-chen", handle: "chen-esp", displayName: "陈屿", avatar: "屿",
    bio: "ESP32、机械结构和会动的小东西。", countryCode: "CN", country: "中国", city: "深圳",
    languages: ["中文", "English"], interests: ["ESP32", "机器人", "开源", "游戏"],
    skills: ["ESP-IDF", "PCB", "机械设计"], followers: 418, following: 112, posts: 35
  }
];

const posts = [
  {
    id: "post-1", authorId: "usr-mina", type: "POST", category: "日常",
    title: "今天把雨声和一杯咖啡记进了手帐",
    content: "清迈下午下了一场很短的雨。我没有拍什么特别的照片，只写下咖啡凉得比平时快，以及窗边那只猫终于愿意靠近一点。普通的一天，好像也值得被认真收好。",
    tags: ["今日手帐", "咖啡", "慢生活"], cover: "journal", likes: 486, comments: 42, views: 5830,
    liked: false, bookmarked: true, createdAt: "2026-07-23T06:20:00.000Z"
  },
  {
    id: "post-2", authorId: "usr-aiko", type: "POST", category: "学习",
    title: "连续七天早起后，我终于记住了这个中文短句",
    content: "“慢慢来，也是一种前进。”我把它写在单词卡背面，每天读一次。学习没有突然变轻松，但开始变成一件愿意回来的小事。",
    tags: ["学习打卡", "中文", "单词卡"], cover: "reading", likes: 327, comments: 31, views: 4218,
    liked: true, bookmarked: false, createdAt: "2026-07-22T13:40:00.000Z"
  },
  {
    id: "post-3", authorId: "usr-chen", type: "POST", category: "兴趣",
    title: "Cloud Runner 打到 128 分时，我的猫踩到了键盘",
    content: "本来只是睡前玩两分钟，结果猫刚好踩中向下键，意外躲过障碍。现在它是这局真正的冠军。你们和宠物之间也有这种莫名其妙的配合吗？",
    tags: ["小游戏", "猫", "睡前两分钟"], cover: "runner", likes: 219, comments: 18, views: 2750,
    liked: false, bookmarked: false, createdAt: "2026-07-21T09:15:00.000Z"
  },
  {
    id: "post-4", authorId: "usr-mina", type: "POST", category: "创作",
    title: "当一封数字信真的从桌上慢慢长出来",
    content: "Aiko 从京都寄来的信在傍晚被打印出来。纸张很轻，内容也不长，但那一刻比通知栏里的红点真实很多。也许慢一点的社交，会让表达重新变得认真。",
    tags: ["AI Letter", "慢社交", "生活"], cover: "letter", likes: 612, comments: 67, views: 7042,
    liked: true, bookmarked: true, createdAt: "2026-07-20T11:08:00.000Z"
  },
  {
    id: "post-5", authorId: "usr-lin", type: "POST", category: "心情",
    title: "今天的 Egg 给了我一句刚刚好的话",
    content: "它说：“不用一次把所有事情想明白。”我知道只是随机出现的一句话，但在忙乱的下午看到时，还是安静了几分钟。",
    tags: ["Daily Egg", "今日心情", "小确幸"], cover: "egg", likes: 158, comments: 23, views: 1862,
    liked: false, bookmarked: false, createdAt: "2026-07-19T08:30:00.000Z"
  },
  {
    id: "post-6", authorId: "usr-noah", type: "POST", category: "交友",
    title: "你们的桌面上，有什么陪伴了很久的小东西？",
    content: "我的桌边一直放着一只旧木鸟，是搬到赫尔辛基时朋友送的。它没有功能，但每次看到都会想起那段路。想听听你们桌面上的故事。",
    tags: ["认识朋友", "桌面故事", "晚安电台"], cover: "desk", likes: 301, comments: 56, views: 3408,
    liked: false, bookmarked: false, createdAt: "2026-07-18T20:16:00.000Z"
  },
  {
    id: "post-7", authorId: "usr-aiko", type: "POST", category: "设备",
    title: "早晨收到一张提醒吃早餐的小纸条",
    content: "桌面设备没有催我完成目标，只打印了一句“先照顾好自己”。我喜欢这种不要求立刻回应的提醒，像有人轻轻敲了一下桌面。",
    tags: ["桌面陪伴", "打印纸条", "生活"], cover: "robot", likes: 274, comments: 39, views: 2981,
    liked: true, bookmarked: true, createdAt: "2026-07-17T07:32:00.000Z"
  }
];

const matches = [
  {
    userId: "usr-aiko", score: 92,
    components: { interest: 0.95, skill: 0.9, region: 0.7, activity: 0.85 },
    reasons: ["共同喜欢 AI 和机器人", "你的 ESP32 经验与她的硬件设计互补", "支持 English 交流"],
    followed: false
  },
  {
    userId: "usr-chen", score: 89,
    components: { interest: 0.93, skill: 0.88, region: 0.9, activity: 0.74 },
    reasons: ["都在开发 ESP32 项目", "同为中文用户", "对开源硬件有共同兴趣"],
    followed: true
  },
  {
    userId: "usr-noah", score: 84,
    components: { interest: 0.82, skill: 0.91, region: 0.5, activity: 0.83 },
    reasons: ["共同关注端侧 AI", "声音设计与语音设备方向互补", "支持 English 交流"],
    followed: false
  },
  {
    userId: "usr-mina", score: 78,
    components: { interest: 0.72, skill: 0.84, region: 0.6, activity: 0.89 },
    reasons: ["都喜欢手帐与纸面表达", "产品能力与插画设计互补", "支持中文交流"],
    followed: false
  }
];

const letters = [
  {
    id: "ltr-1", authorId: "usr-aiko", recipientId: "usr-lin", subject: "京都下雨了",
    body: "林安：\n\n京都今天下了一场很轻的雨。我把新做的机器人放在窗边，它第一次正确识别出了雨天。想起你也在做一台桌面伙伴，所以写来问问：你的 MIMO 最近学会了什么？\n\nAiko",
    status: "PRINTED", printStatus: "SUCCESS", createdAt: "2026-07-23T03:18:00.000Z", printedAt: "2026-07-23T03:22:00.000Z", unread: true, version: 6
  },
  {
    id: "ltr-2", authorId: "usr-lin", recipientId: "usr-noah", subject: "关于安静的设备",
    body: "Noah：\n\n看到你分享 Quiet Brief，很喜欢“只在重要时打扰”的想法。我们正在为桌面设备设计自动打印策略，也许可以交流一下。\n\n林安",
    status: "DELIVERING", printStatus: null, createdAt: "2026-07-22T12:40:00.000Z", unread: false, version: 3
  },
  {
    id: "ltr-3", authorId: "usr-mina", recipientId: "usr-lin", subject: "一张关于清迈的插画",
    body: "林安：\n\n随信附上一张今天画的小图。希望打印出来时，它能让你的桌面多一点绿色。\n\nMina",
    status: "RECEIVED", printStatus: "WAITING_DEVICE", createdAt: "2026-07-21T15:05:00.000Z", unread: false, version: 4
  },
  {
    id: "ltr-4", authorId: "usr-lin", recipientId: "usr-aiko", subject: "夏夜与像素屏",
    body: "Aiko：\n\n想和你分享 MIMO 新做好的像素表情。它会在打印时认真地眨眼，像是在读信。\n\n林安",
    status: "DRAFT", printStatus: null, createdAt: "2026-07-23T08:00:00.000Z", unread: false, version: 2
  }
];

const device = {
  id: "mimo-desk-01", displayName: "MIMO One", model: "DNESP32S3",
  status: "ONLINE", freshness: "LIVE", battery: 82, charging: true,
  firmwareVersion: "0.3.0-mvp", wifi: "Studio Wi-Fi", lastSeenAt: new Date().toISOString(),
  printer: { status: "READY", paper: "68%", temperatureC: 36, formats: ["thermal_58mm"] },
  remotePrintPaused: false,
  printPolicy: {
    mode: "FRIENDS", dailyJobLimit: 12, dailyPageLimit: 30,
    quietHours: { start: "22:30", end: "07:30", timeZone: "Asia/Shanghai" },
    photoPolicy: "CONFIRM", paused: false, version: 4
  }
};

const printJobs = [
  {
    id: "pj-1", userId: "usr-lin", letterId: "ltr-1", deviceId: device.id,
    title: "京都下雨了", status: "SUCCESS", format: "thermal_58mm", pageCount: 1,
    createdAt: "2026-07-23T03:19:00.000Z", finishedAt: "2026-07-23T03:22:00.000Z", version: 7
  },
  {
    id: "pj-2", userId: "usr-lin", letterId: "ltr-3", deviceId: device.id,
    title: "一张关于清迈的插画", status: "WAITING_DEVICE", format: "thermal_58mm", pageCount: 1,
    createdAt: "2026-07-21T15:06:00.000Z", finishedAt: null, version: 2
  }
];

const comments = {
  "post-1": [
    { id: "comment-1", authorId: "usr-lin", content: "这个晨间纸条的节制感很喜欢。打印资源是服务端渲染吗？", createdAt: "2026-07-23T07:10:00.000Z" },
    { id: "comment-2", authorId: "usr-noah", content: "The paper output makes the information feel intentional.", createdAt: "2026-07-23T07:32:00.000Z" }
  ]
};

const idempotency = new Map();
const processedPhotos = new Map();

function withUser(user) {
  return { ...user, relationship: user.id === "usr-chen" ? "FOLLOWING" : "NONE" };
}

function resolveVoiceLetterRecipient(value) {
  const target = String(value ?? "").trim().replace(/\s+/gu, "").toLocaleLowerCase();
  if (!target) return null;
  return users.find((user) => [user.id, user.handle, user.displayName]
    .some((candidate) => String(candidate ?? "").replace(/\s+/gu, "").toLocaleLowerCase() === target)) ?? null;
}

function hydratePost(post) {
  return {
    ...post,
    author: withUser(users.find((user) => user.id === post.authorId) ?? me),
    metrics: { likes: post.likes, comments: post.comments, views: post.views },
    viewer: { liked: post.liked, bookmarked: post.bookmarked, canComment: true }
  };
}

function hydrateLetter(letter) {
  const counterpartId = letter.authorId === me.id ? letter.recipientId : letter.authorId;
  const job = printJobs.find((item) => item.letterId === letter.id);
  return {
    ...letter,
    counterpart: withUser(users.find((user) => user.id === counterpartId)),
    direction: letter.authorId === me.id ? "sent" : "received",
    printJob: job ?? null
  };
}

function problem(status, code, title, detail, requestId, errors = []) {
  return {
    status,
    body: {
      type: `https://docs.aihub.local/problems/${code.toLowerCase().replaceAll("_", "-")}`,
      title,
      status,
      code,
      detail,
      requestId,
      errors
    }
  };
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1_000_000) throw new Error("PAYLOAD_TOO_LARGE");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function readMultipart(request) {
  const webRequest = new Request(`http://127.0.0.1${request.url}`, {
    method: request.method,
    headers: request.headers,
    body: Readable.toWeb(request),
    duplex: "half"
  });
  return webRequest.formData();
}

function page(items) {
  return { items, page: { nextCursor: null, hasMore: false } };
}

function send(response, status, body, requestId, headers = {}) {
  response.writeHead(status, {
    "Content-Type": status >= 400 ? "application/problem+json; charset=utf-8" : "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Request-ID": requestId,
    ...headers
  });
  response.end(status === 204 ? undefined : JSON.stringify(body));
}

function printerBaseUrl() {
  const configured = process.env.ESP_PRINTER_BASE_URL ?? process.env.ESP32_PRINTER_BASE_URL;
  if (configured) return configured.replace(/\/+$/, "");
  return `http://${process.env.ESP_PRINTER_IP ?? "10.76.7.129"}`;
}

function normalizePrintOptions(input = {}) {
  const language = input.language === "zh" || input.chinese === true ? "zh" : "en";
  const font = String(input.font ?? (language === "zh" ? "B" : "A")).toUpperCase() === "B" ? "B" : "A";
  const align = ["left", "center", "right"].includes(input.align) ? input.align : "center";
  const size = (value) => Math.max(1, Math.min(8, Number.parseInt(value ?? "1", 10) || 1));
  return {
    language,
    font,
    bold: Boolean(input.bold),
    underline: Boolean(input.underline),
    invert: Boolean(input.invert),
    width: size(input.width),
    height: size(input.height),
    align,
    feedAfter: Math.max(0, Math.min(8, Number.parseInt(input.feedAfter ?? input.feedLines ?? "3", 10) || 0))
  };
}

async function dispatchPrinterText({ text, options = {}, timeoutMs = 30_000 }) {
  const baseUrl = printerBaseUrl();
  const normalized = normalizePrintOptions(options);
  const endpoint = new URL(`${baseUrl}/printer/text`);
  let requestBody;
  let headers;
  let encodedBytes;
  let encodingLossy = false;

  if (normalized.language === "zh") {
    Object.entries({
      font: normalized.font,
      bold: Number(normalized.bold),
      underline: Number(normalized.underline),
      invert: Number(normalized.invert),
      width: normalized.width,
      height: normalized.height,
      align: normalized.align,
      feedAfter: normalized.feedAfter,
      chinese: 1
    }).forEach(([key, value]) => endpoint.searchParams.set(key, String(value)));
    requestBody = iconv.encode(text, "gb2312");
    encodedBytes = requestBody.byteLength;
    encodingLossy = iconv.decode(requestBody, "gb2312") !== text;
    headers = { "Content-Type": "application/octet-stream" };
  } else {
    const payload = {
      text,
      font: normalized.font,
      bold: normalized.bold,
      underline: normalized.underline,
      invert: normalized.invert,
      width: normalized.width,
      height: normalized.height,
      align: normalized.align,
      feedAfter: normalized.feedAfter
    };
    requestBody = JSON.stringify(payload);
    encodedBytes = Buffer.byteLength(requestBody, "utf8");
    headers = { "Content-Type": "application/json; charset=utf-8" };
  }

  const textResponse = await fetch(endpoint, {
    method: "POST",
    headers,
    body: requestBody,
    signal: AbortSignal.timeout(timeoutMs)
  });
  const textBody = await textResponse.text();
  if (!textResponse.ok) {
    throw new Error(`PRINTER_TEXT_FAILED:${textResponse.status}:${textBody}`);
  }

  return {
    baseUrl,
    language: normalized.language,
    options: normalized,
    encodedBytes,
    encodingLossy,
    textResponse: textBody,
  };
}

async function dispatchPrinterBitmap({ bitmap, width, height, timeoutMs = 30_000 }) {
  const baseUrl = printerBaseUrl();
  const endpoints = ["/printer/image", "/print-image"];
  let lastError;
  for (const path of endpoints) {
    const endpoint = new URL(`${baseUrl}${path}`);
    endpoint.searchParams.set("width", String(width));
    endpoint.searchParams.set("height", String(height));
    try {
      const printerResponse = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: bitmap,
        signal: AbortSignal.timeout(timeoutMs)
      });
      const responseBody = await printerResponse.text();
      if (printerResponse.ok) {
        return { baseUrl, endpoint: endpoint.toString(), responseBody };
      }
      lastError = new Error(`PRINTER_IMAGE_FAILED:${printerResponse.status}:${responseBody}`);
      if (printerResponse.status !== 404) break;
    } catch (error) {
      lastError = error;
      break;
    }
  }
  throw lastError ?? new Error("PRINTER_IMAGE_FAILED");
}

async function dispatchPrinterFeed(lines, timeoutMs = 15_000) {
  const safeLines = Math.max(0, Math.min(12, Number.parseInt(lines ?? "0", 10) || 0));
  if (!safeLines) return { skipped: true, lines: 0 };
  const endpoint = new URL(`${printerBaseUrl()}/printer/feed`);
  endpoint.searchParams.set("lines", String(safeLines));
  const printerResponse = await fetch(endpoint, {
    method: "POST",
    signal: AbortSignal.timeout(timeoutMs)
  });
  const responseBody = await printerResponse.text();
  if (!printerResponse.ok) {
    throw new Error(`PRINTER_FEED_FAILED:${printerResponse.status}:${responseBody}`);
  }
  return { skipped: false, lines: safeLines, responseBody };
}

function requireIdempotency(request, operation, body) {
  const key = request.headers["idempotency-key"];
  if (!key) return { error: "IDEMPOTENCY_KEY_REQUIRED" };
  const mapKey = `${operation}:${key}`;
  if (idempotency.has(mapKey)) return { cached: idempotency.get(mapKey) };
  return {
    commit(result) {
      idempotency.set(mapKey, result);
      return result;
    }
  };
}

export function getMockState() {
  return { me, users, posts, matches, letters, device, printJobs, comments };
}

export async function handleApiRequest(request, response, requestId) {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  if (!url.pathname.startsWith("/api/v1/")) return false;

  const method = request.method ?? "GET";
  const path = url.pathname.replace(/^\/api\/v1/, "");

  try {
    if (method === "GET" && path === "/dashboard") {
      send(response, 200, {
        user: me,
        featuredPosts: posts.slice(0, 3).map(hydratePost),
        matches: matches.slice(0, 2).map((item) => ({ ...item, user: withUser(users.find((user) => user.id === item.userId)) })),
        unreadLetters: letters.filter((letter) => letter.recipientId === me.id && letter.unread).length,
        waitingPrintJobs: printJobs.filter((job) => !["SUCCESS", "CANCELLED"].includes(job.status)).length,
        device
      }, requestId);
      return true;
    }

    if (method === "GET" && path === "/ai/status") {
      const config = deepSeekConfig();
      send(response, 200, {
        provider: "deepseek",
        configured: config.configured,
        model: config.model,
        keyExposed: false,
        capabilities: ["chat", "intent", "plan", "letter-polish", "summary"],
        requestId
      }, requestId);
      return true;
    }

    if (method === "GET" && path === "/hardware/bridge/status") {
      send(response, 200, { ...desktopBotBridge.status(), requestId }, requestId);
      return true;
    }

    if (method === "GET" && path === "/hardware/bridge/state") {
      try {
        const upstream = await fetch(`${desktopBotBridge.baseUrl}/api/state`, { signal: AbortSignal.timeout(5_000) });
        const state = await upstream.json();
        send(response, upstream.ok ? 200 : 502, { state, bridge: desktopBotBridge.status(), requestId }, requestId);
      } catch (error) {
        const issue = problem(502, "DESKTOP_BOT_UNAVAILABLE", "desktop_bot unavailable", error.message, requestId);
        send(response, issue.status, issue.body, requestId);
      }
      return true;
    }

    if (method === "POST" && path === "/hardware/photo/process") {
      try {
        const form = await readMultipart(request);
        const metadataRaw = String(form.get("metadata") ?? "{}");
        const metadata = JSON.parse(metadataRaw);
        const image = form.get("image");
        if (!image || typeof image.arrayBuffer !== "function" || image.type !== "image/jpeg") {
          const issue = problem(415, "JPEG_REQUIRED", "JPEG image required", "desktop_bot must send the multipart image field as image/jpeg.", requestId);
          send(response, issue.status, issue.body, requestId);
          return true;
        }
        const bytes = Buffer.from(await image.arrayBuffer());
        if (!bytes.length || bytes.length > 2_097_152) {
          const issue = problem(413, "PHOTO_TOO_LARGE", "Photo is too large", "The photo processor accepts JPEG files up to 2 MiB.", requestId);
          send(response, issue.status, issue.body, requestId);
          return true;
        }
        const captureId = String(metadata.capture_id ?? request.headers["idempotency-key"] ?? crypto.randomUUID()).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64);
        processedPhotos.set(captureId, { bytes, contentType: "image/jpeg", metadata, createdAt: Date.now() });
        while (processedPhotos.size > 20) processedPhotos.delete(processedPhotos.keys().next().value);
        send(response, 202, {
          status: "accepted",
          capture_id: captureId,
          image_url: `/api/v1/hardware/photos/${captureId}.jpg`,
          bytes: bytes.length,
          processing: "stored_for_photo_2_text",
          requestId
        }, requestId);
      } catch (error) {
        const issue = problem(400, "PHOTO_MULTIPART_INVALID", "Invalid photo upload", error.message, requestId);
        send(response, issue.status, issue.body, requestId);
      }
      return true;
    }

    const hardwarePhotoMatch = path.match(/^\/hardware\/photos\/([a-zA-Z0-9_-]+)\.jpg$/);
    if (method === "GET" && hardwarePhotoMatch) {
      const captureId = hardwarePhotoMatch[1];
      const stored = processedPhotos.get(captureId);
      if (stored) {
        response.writeHead(200, { "Content-Type": stored.contentType, "Cache-Control": "private, max-age=300", "X-Request-ID": requestId });
        response.end(stored.bytes);
        return true;
      }
      try {
        const upstream = await fetch(`${desktopBotBridge.baseUrl}/api/photos/${captureId}.jpg`, { signal: AbortSignal.timeout(5_000) });
        if (!upstream.ok) throw new Error(`PHOTO_${upstream.status}`);
        const bytes = Buffer.from(await upstream.arrayBuffer());
        response.writeHead(200, { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=60", "X-Request-ID": requestId });
        response.end(bytes);
      } catch {
        const issue = problem(404, "PHOTO_NOT_FOUND", "Photo not found", "The requested desktop_bot capture is unavailable.", requestId);
        send(response, issue.status, issue.body, requestId);
      }
      return true;
    }

    if (method === "GET" && path === "/users/me") {
      send(response, 200, me, requestId, { ETag: `"${me.version}"` });
      return true;
    }

    const publicUserMatch = path.match(/^\/users\/([^/]+)$/);
    if (method === "GET" && publicUserMatch) {
      const user = users.find((item) => item.handle === decodeURIComponent(publicUserMatch[1]) || item.id === publicUserMatch[1]);
      if (!user) {
        const issue = problem(404, "USER_NOT_FOUND", "User not found", "The requested profile is not available.", requestId);
        send(response, issue.status, issue.body, requestId);
      } else {
        send(response, 200, withUser(user), requestId);
      }
      return true;
    }

    if (method === "GET" && path === "/posts") {
      const category = url.searchParams.get("category");
      const query = String(url.searchParams.get("q") ?? "").trim().toLowerCase();
      let result = [...posts];
      if (category && category !== "全部") result = result.filter((post) => post.category === category || post.tags.includes(category));
      if (query) {
        result = result.filter((post) => `${post.title} ${post.content} ${post.tags.join(" ")}`.toLowerCase().includes(query)
          || users.find((user) => user.id === post.authorId)?.displayName.toLowerCase().includes(query));
      }
      send(response, 200, page(result.map(hydratePost)), requestId);
      return true;
    }

    if (method === "POST" && path === "/posts") {
      const body = await readJson(request);
      const idem = requireIdempotency(request, "create-post", body);
      if (idem.error) {
        const issue = problem(400, idem.error, "Idempotency key required", "Provide Idempotency-Key for this write.", requestId);
        send(response, issue.status, issue.body, requestId);
        return true;
      }
      if (idem.cached) {
        send(response, 201, idem.cached, requestId, { "Idempotent-Replayed": "true" });
        return true;
      }
      if (!body.title?.trim() || !body.content?.trim()) {
        const issue = problem(422, "POST_VALIDATION_FAILED", "Post validation failed", "Title and content are required.", requestId);
        send(response, issue.status, issue.body, requestId);
        return true;
      }
      const created = {
        id: `post-${crypto.randomUUID()}`, authorId: me.id, type: body.type ?? "POST",
        category: body.category ?? "AI", title: body.title.trim(), content: body.content.trim(),
        tags: Array.isArray(body.tags) ? body.tags.slice(0, 8) : [], cover: body.cover ?? "community",
        likes: 0, comments: 0, views: 1, liked: false, bookmarked: false, createdAt: new Date().toISOString()
      };
      posts.unshift(created);
      const result = hydratePost(created);
      idem.commit(result);
      send(response, 201, result, requestId, { ETag: '"1"' });
      return true;
    }

    const postMatch = path.match(/^\/posts\/([^/]+)$/);
    if (method === "GET" && postMatch) {
      const post = posts.find((item) => item.id === postMatch[1]);
      if (!post) {
        const issue = problem(404, "POST_NOT_FOUND", "Post not found", "The requested post does not exist.", requestId);
        send(response, issue.status, issue.body, requestId);
      } else {
        post.views += 1;
        send(response, 200, { ...hydratePost(post), comments: (comments[post.id] ?? []).map((item) => ({ ...item, author: withUser(users.find((user) => user.id === item.authorId)) })) }, requestId);
      }
      return true;
    }

    const reactionMatch = path.match(/^\/posts\/([^/]+)\/reactions$/);
    if (method === "POST" && reactionMatch) {
      const post = posts.find((item) => item.id === reactionMatch[1]);
      if (!post) {
        const issue = problem(404, "POST_NOT_FOUND", "Post not found", "The requested post does not exist.", requestId);
        send(response, issue.status, issue.body, requestId);
        return true;
      }
      post.liked = !post.liked;
      post.likes += post.liked ? 1 : -1;
      send(response, 200, { active: post.liked, likeCount: post.likes }, requestId);
      return true;
    }

    const bookmarkMatch = path.match(/^\/posts\/([^/]+)\/bookmark$/);
    if (method === "PUT" && bookmarkMatch) {
      const post = posts.find((item) => item.id === bookmarkMatch[1]);
      if (!post) {
        const issue = problem(404, "POST_NOT_FOUND", "Post not found", "The requested post does not exist.", requestId);
        send(response, issue.status, issue.body, requestId);
      } else {
        post.bookmarked = !post.bookmarked;
        send(response, 200, { active: post.bookmarked }, requestId);
      }
      return true;
    }

    const commentsMatch = path.match(/^\/posts\/([^/]+)\/comments$/);
    if (method === "POST" && commentsMatch) {
      const body = await readJson(request);
      const post = posts.find((item) => item.id === commentsMatch[1]);
      if (!post || !body.content?.trim()) {
        const issue = problem(422, "COMMENT_INVALID", "Comment is invalid", "A visible post and non-empty content are required.", requestId);
        send(response, issue.status, issue.body, requestId);
        return true;
      }
      const comment = { id: `comment-${crypto.randomUUID()}`, authorId: me.id, author: me, content: body.content.trim(), createdAt: new Date().toISOString() };
      comments[post.id] ??= [];
      comments[post.id].push(comment);
      post.comments += 1;
      send(response, 201, comment, requestId);
      return true;
    }

    if (method === "GET" && path === "/matches") {
      const result = matches.filter((item) => !item.passed).map((item) => ({
        ...item,
        user: withUser(users.find((user) => user.id === item.userId)),
        algorithmVersion: "rules-2026-07"
      }));
      send(response, 200, page(result), requestId);
      return true;
    }

    const matchFeedback = path.match(/^\/matches\/([^/]+)\/feedback$/);
    if (method === "POST" && matchFeedback) {
      const body = await readJson(request);
      const match = matches.find((item) => item.userId === matchFeedback[1]);
      if (!match) {
        const issue = problem(404, "MATCH_NOT_FOUND", "Match not found", "This recommendation is no longer available.", requestId);
        send(response, issue.status, issue.body, requestId);
      } else {
        if (body.action === "PASSED") match.passed = true;
        if (body.action === "FOLLOWED") match.followed = true;
        send(response, 204, null, requestId);
      }
      return true;
    }

    if (method === "POST" && path === "/ai/tutor") {
      const body = await readJson(request);
      const question = String(body.question ?? "").trim();
      if (!question) {
        const issue = problem(422, "TUTOR_QUESTION_REQUIRED", "Question is required", "Write a learning question before asking MIMO.", requestId);
        send(response, issue.status, issue.body, requestId);
        return true;
      }
      let answer = `可以把“${question}”拆成三步：先说清核心概念，再找一个生活里的例子，最后用自己的话复述一次。你想先听例子，还是做一道小测验？`;
      if (/天空|蓝色/.test(question)) {
        answer = "天空看起来是蓝色的，主要因为阳光进入大气后，波长较短的蓝光比红光更容易被空气分子散射到各个方向。你抬头时，来自四面八方的蓝光进入眼睛，于是看见蓝天。";
      } else if (/英语|单词|词汇|english|word/i.test(question)) {
        answer = "试试“看词义 → 大声读 → 用自己的生活造句 → 隔天复习”的四步法。一次 5–10 个词，比一次塞进很多词更容易记住。";
      } else if (/计划|安排|学习/.test(question)) {
        answer = "先给今天安排一个 15 分钟就能完成的小目标。完成后再决定要不要继续，这样比写一张很长的计划表更容易开始。";
      }
      let provider = "local-fallback";
      let model = null;
      try {
        const recentMessages = Array.isArray(body.messages) ? body.messages.slice(-8).map((message) => ({
          role: message.role === "assistant" ? "assistant" : "user",
          content: String(message.content ?? "").slice(0, 1_500)
        })) : [];
        const completion = await deepSeekChat({
          maxTokens: 800,
          temperature: 1,
          messages: [
            { role: "system", content: "你是 MIMO，一名温暖、准确、善于用生活例子解释知识的学习助手。用简体中文回答；先直接回答，再给一个小例子，最后给一个可执行的复习建议。控制在 500 字以内，不要假装调用设备或打印机。" },
            ...recentMessages,
            { role: "user", content: question.slice(0, 2_000) }
          ]
        });
        answer = completion.content;
        provider = "deepseek";
        model = completion.model;
      } catch {
        // The learning module remains usable offline and clearly reports degraded mode.
      }
      send(response, 200, {
        answer,
        suggestions: ["给我一个生活例子", "出一道小测验", "加入今日计划"],
        safety: { decision: "ALLOW", reasons: [] },
        runId: `airun-${crypto.randomUUID()}`,
        provider,
        model
      }, requestId);
      return true;
    }

    if (method === "POST" && path === "/ai/orchestrate") {
      const body = await readJson(request);
      const transcript = String(body.transcript ?? body.text ?? "").trim();
      if (!transcript) {
        const issue = problem(422, "AI_INPUT_REQUIRED", "Voice or text input is required", "Provide a transcript before asking the AI orchestrator.", requestId);
        send(response, issue.status, issue.body, requestId);
        return true;
      }
      const decision = await orchestrateTranscript(transcript, body.context ?? {});
      send(response, 200, { ...decision, runId: `airun-${crypto.randomUUID()}`, requestId }, requestId);
      return true;
    }

    if (method === "POST" && path === "/games/turtle-soup/answer") {
      const body = await readJson(request);
      const question = String(body.question ?? "").trim();
      if (!question) {
        const issue = problem(422, "TURTLE_QUESTION_REQUIRED", "Question is required", "Ask a yes-or-no question first.", requestId);
        send(response, issue.status, issue.body, requestId);
        return true;
      }
      let verdict = "IRRELEVANT";
      if (/设备|打印机|AI|定时|提醒|自己|设置/.test(question)) verdict = "YES";
      if (/陌生人|邻居|闯入|小偷|鬼|家人/.test(question)) verdict = "NO";
      send(response, 200, { verdict, answer: { YES: "是", NO: "否", IRRELEVANT: "无关" }[verdict] }, requestId);
      return true;
    }

    if (method === "POST" && path === "/ai/ocr") {
      const body = await readJson(request);
      const fileName = String(body.fileName ?? "photo.jpg").slice(0, 120);
      send(response, 200, {
        fileName,
        extractedText: "TODAY / 慢慢来，也是一种前进。",
        summary: "这是一张带有日期和鼓励短句的生活记录照片。",
        language: "zh-CN",
        confidence: 0.94
      }, requestId);
      return true;
    }

    if (method === "POST" && path === "/ai/journal/summary") {
      const body = await readJson(request);
      const journalBody = String(body.body ?? "").trim();
      if (!journalBody) {
        const issue = problem(422, "JOURNAL_BODY_REQUIRED", "Journal content is required", "Write something before requesting a summary.", requestId);
        send(response, issue.status, issue.body, requestId);
        return true;
      }
      send(response, 200, {
        summary: `今天的关键词是：留意、感受、慢一点。你认真记住了“${journalBody.slice(0, 24)}${journalBody.length > 24 ? "…" : ""}”这个片段。`,
        moodHint: "calm",
        safety: { decision: "ALLOW", reasons: [] }
      }, requestId);
      return true;
    }

    if (method === "POST" && path === "/ai/fortune") {
      const body = await readJson(request);
      if (!body.birthday || !String(body.question ?? "").trim()) {
        const issue = problem(422, "FORTUNE_INPUT_REQUIRED", "Birthday and question are required", "Complete both fields to draw a card.", requestId);
        send(response, issue.status, issue.body, requestId);
        return true;
      }
      send(response, 200, {
        title: "缓慢发光",
        reading: "最近不必急着得到一个完整答案。先完成眼前最小的一步，新的线索会在一次散步、一段对话或一杯热饮之后出现。",
        luckyColor: "雾蓝",
        tinyAction: "整理桌面上的一件小东西",
        disclaimer: "仅供娱乐，不构成医疗、投资或人生决策建议。"
      }, requestId);
      return true;
    }

    if (method === "POST" && path === "/printer/text") {
      const body = await readJson(request);
      const text = String(body.text ?? "").replace(/\r\n?/g, "\n").trimEnd();
      const options = normalizePrintOptions(body);

      if (!text) {
        const issue = problem(422, "PRINTER_TEXT_REQUIRED", "Printer text is required", "Provide non-empty text before sending a print job.", requestId);
        send(response, issue.status, issue.body, requestId);
        return true;
      }
      if (text.length > 1_000) {
        const issue = problem(413, "PRINTER_TEXT_TOO_LONG", "Printer text is too long", "The MVP thermal printer endpoint accepts up to 1000 characters per request.", requestId);
        send(response, issue.status, issue.body, requestId);
        return true;
      }

      try {
        const result = await dispatchPrinterText({ text: `${text}\n`, options });
        send(response, 202, {
          success: true,
          target: result.baseUrl,
          chars: text.length,
          utf8Bytes: Buffer.byteLength(text, "utf8"),
          encodedBytes: result.encodedBytes,
          encoding: result.language === "zh" ? "GB2312" : "UTF-8 JSON",
          encodingLossy: result.encodingLossy,
          options: result.options,
          printer: {
            text: result.textResponse
          },
          requestId
        }, requestId);
      } catch (error) {
        const issue = problem(502, "PRINTER_UNAVAILABLE", "Printer unavailable", `Could not dispatch the job to ESP32 printer: ${error.message}`, requestId);
        send(response, issue.status, issue.body, requestId);
      }
      return true;
    }

    if (method === "POST" && path === "/printer/letter/preview") {
      const body = await readJson(request);
      const preview = thermalLetterPreviewDataUrl(body);
      send(response, 200, {
        success: true,
        width: preview.width,
        height: preview.height,
        pageCount: preview.pageCount,
        totalHeight: preview.totalHeight,
        bodyWasClipped: preview.bodyWasClipped,
        previewDataUrl: preview.dataUrl,
        requestId
      }, requestId);
      return true;
    }

    if (method === "POST" && path === "/printer/content/preview") {
      const body = await readJson(request);
      const preview = thermalContentPreviewDataUrl(body);
      send(response, 200, { ...preview, template: `thermal-${body.kind ?? "note"}-v1`, requestId }, requestId);
      return true;
    }

    if (method === "POST" && path === "/printer/content") {
      const body = await readJson(request);
      const content = String(body.content ?? "").trim();
      if (!content) {
        const issue = problem(422, "PRINT_CONTENT_REQUIRED", "Printable content is required", "Generate or enter content before printing.", requestId);
        send(response, issue.status, issue.body, requestId);
        return true;
      }
      const idempotent = requireIdempotency(request, "printer.content", {
        kind: body.kind, title: body.title, content, jobId: body.jobId
      });
      if (idempotent.error) {
        const issue = problem(400, idempotent.error, "Idempotency key required", "Provide Idempotency-Key before printing.", requestId);
        send(response, issue.status, issue.body, requestId);
        return true;
      }
      if (idempotent.cached) {
        send(response, 200, idempotent.cached, requestId, { "Idempotent-Replayed": "true" });
        return true;
      }
      try {
        const feedBefore = Math.max(0, Math.min(8, Number(body.feedBefore ?? 3) || 0));
        const feedAfter = Math.max(0, Math.min(8, Number(body.feedAfter ?? 4) || 0));
        const rendered = await renderThermalContentBatches({
          kind: body.kind,
          title: body.title,
          content,
          date: body.date
        });
        const feedBeforeResult = await dispatchPrinterFeed(feedBefore);
        const batches = [];
        for (const batch of rendered.batches) {
          const dispatched = await dispatchPrinterBitmap(batch);
          batches.push({ index: batch.index + 1, width: batch.width, height: batch.height, bitmapBytes: batch.bitmap.byteLength, endpoint: dispatched.endpoint });
        }
        let feedAfterResult;
        try {
          feedAfterResult = await dispatchPrinterFeed(feedAfter);
        } catch (error) {
          feedAfterResult = { warning: error.message, lines: feedAfter };
        }
        const result = idempotent.commit({
          success: true,
          target: printerBaseUrl(),
          template: `thermal-${rendered.kind}-v1`,
          width: rendered.width,
          height: rendered.height,
          pageCount: rendered.pageCount,
          batchCount: rendered.batches.length,
          batches,
          feed: { before: feedBeforeResult, after: feedAfterResult },
          requestId
        });
        send(response, 202, result, requestId);
      } catch (error) {
        const issue = problem(502, "CONTENT_PRINTER_UNAVAILABLE", "Content printer unavailable", `Could not render or dispatch the 384px content: ${error.message}`, requestId);
        send(response, issue.status, issue.body, requestId);
      }
      return true;
    }

    if (method === "POST" && path === "/printer/letter") {
      const body = await readJson(request);
      const subject = String(body.subject ?? "").trim();
      const content = String(body.body ?? "").trim();
      if (!subject || !content) {
        const issue = problem(422, "LETTER_PRINT_CONTENT_REQUIRED", "Letter subject and body are required", "Provide both subject and body before printing the 384px letter template.", requestId);
        send(response, issue.status, issue.body, requestId);
        return true;
      }
      const idempotent = requireIdempotency(request, "printer.letter", {
        jobId: body.jobId,
        subject,
        content
      });
      if (idempotent.error) {
        const issue = problem(400, idempotent.error, "Idempotency key required", "Provide Idempotency-Key for physical Letter printing.", requestId);
        send(response, issue.status, issue.body, requestId);
        return true;
      }
      if (idempotent.cached) {
        send(response, 200, idempotent.cached, requestId, { "Idempotent-Replayed": "true" });
        return true;
      }
      try {
        const rotate180 = String(process.env.ESP_PRINTER_ROTATE_180 ?? "true").toLowerCase() !== "false";
        const feedBefore = Math.max(0, Math.min(12, Number.parseInt(body.feedBefore ?? "3", 10) || 0));
        const feedAfter = Math.max(0, Math.min(12, Number.parseInt(body.feedAfter ?? "4", 10) || 0));
        const rendered = await renderThermalLetterBatches(body, { rotate180 });
        const feedBeforeResult = await dispatchPrinterFeed(feedBefore);
        const batchResults = [];
        for (const batch of rendered.batches) {
          const dispatched = await dispatchPrinterBitmap(batch);
          batchResults.push({
            index: batch.index + 1,
            width: batch.width,
            height: batch.height,
            bitmapBytes: batch.bitmap.byteLength,
            endpoint: dispatched.endpoint,
            response: dispatched.responseBody
          });
        }
        let feedAfterResult;
        try {
          feedAfterResult = await dispatchPrinterFeed(feedAfter);
        } catch (error) {
          feedAfterResult = { warning: error.message, lines: feedAfter };
        }
        const responseBody = idempotent.commit({
          success: true,
          target: printerBaseUrl(),
          template: "paper-letter-v1",
          width: rendered.width,
          height: rendered.height,
          batchCount: rendered.batches.length,
          maxBatchHeight: rendered.maxBatchHeight,
          batches: batchResults,
          rotate180: rendered.rotate180,
          bodyWasClipped: rendered.bodyWasClipped,
          feed: { before: feedBeforeResult, after: feedAfterResult },
          requestId
        });
        send(response, 202, responseBody, requestId);
      } catch (error) {
        const issue = problem(502, "LETTER_PRINTER_UNAVAILABLE", "Letter printer unavailable", `Could not render or dispatch the 384px letter: ${error.message}`, requestId);
        send(response, issue.status, issue.body, requestId);
      }
      return true;
    }

    if (method === "GET" && path === "/perception/status") {
      const health = await desktopBotHealth();
      send(response, 200, { ...getPerceptionStatus(), desktopBot: health, requestId }, requestId);
      return true;
    }

    if (method === "GET" && path === "/perception/events") {
      const afterMs = Math.max(0, Number(url.searchParams.get("afterMs") ?? 0) || 0);
      send(response, 200, page(listPerceptionEvents(afterMs)), requestId);
      return true;
    }

    if (method === "POST" && path === "/perception/events") {
      const body = await readJson(request);
      try {
        const event = acceptPerceptionEvent(body);
        const transcript = String(event.payload?.transcript ?? event.payload?.payload_text ?? "").trim();
        const eventPrompts = {
          "feature.write_letter": "我要写一封信",
          "feature.print_plan": "帮我打印今日计划",
          "feature.play_turtle_soup": "我要玩海龟汤"
        };
        const decisionInput = transcript || eventPrompts[event.eventType];
        const decision = event.source === "audio" && decisionInput
          ? await orchestrateTranscript(decisionInput, body.context ?? {})
          : null;
        send(response, 202, { event, decision, requiresUserConfirmation: Boolean(decision?.requiresConfirmation), requestId }, requestId);
      } catch (error) {
        const issue = problem(422, "INVALID_PERCEPTION_EVENT", "Invalid perception event", error.message, requestId);
        send(response, issue.status, issue.body, requestId);
      }
      return true;
    }

    if (method === "GET" && path === "/letters") {
      const box = url.searchParams.get("box") ?? "inbox";
      const result = letters.filter((letter) => {
        if (box === "inbox") return letter.recipientId === me.id && letter.status !== "DRAFT";
        if (box === "sent") return letter.authorId === me.id && letter.status !== "DRAFT";
        if (box === "draft") return letter.authorId === me.id && letter.status === "DRAFT";
        if (box === "print") return printJobs.some((job) => job.letterId === letter.id);
        return true;
      }).map(hydrateLetter);
      send(response, 200, page(result), requestId);
      return true;
    }

    const aiLetterMatch = path.match(/^\/ai\/letter\/(generate|polish|translate)$/);
    if (method === "POST" && aiLetterMatch) {
      const body = await readJson(request);
      const action = aiLetterMatch[1];
      let suggestion = String(body.body ?? "").trim();
      let subject = String(body.subject ?? "").trim();
      let targetLanguage = body.targetLanguage ?? "zh-CN";
      if (action === "generate") {
        subject ||= "桌面上的一件小事";
        suggestion = "见字如面。\n\n最近我把一台会打印的桌面机器人真正连接到了社区。它让我开始重新思考：如果通知不再一闪而过，而是变成一张可以握在手里的纸，我们会不会更认真地表达？\n\n想知道你最近也在做什么有趣的小东西。\n\n愿你今天遇见一点小小的好事。";
      }
      if (action === "polish") {
        suggestion = `${suggestion || "最近完成了一个小项目，想和你分享。"}\n\n我没有急着把它写成结论，只是想把这个正在发生的瞬间寄给你。`;
      }
      if (action === "translate") {
        targetLanguage = "en";
        suggestion = `Dear friend,\n\n${suggestion || "It is lovely to meet someone who is also curious about AI hardware."}\n\nI hope this letter reaches you during a quiet moment.\n\nWarmly,\nLin`;
      }
      let provider = "local-fallback";
      let model = null;
      if (action !== "translate") {
        const inputWasClipped = suggestion.length > 1_200;
        try {
          const completion = await deepSeekChat({
            json: true,
            maxTokens: 1_200,
            temperature: action === "generate" ? 1.2 : 0.7,
            messages: [
              { role: "system", content: "你是 AI Hub OS 的写信助手。输出 json，字段只能包含 subject 和 suggestion。将用户口语或草稿整理成自然、温暖、清晰的中文信件；去掉嗯、呃、那个、重复句和不完整表达；必须保留用户事实，严禁编造人物、物品、时间、地点和共同经历。若原始内容为空，只能写通用问候，不得补充具体故事。正文以“见字如面。”开头，包含自然称呼、分段正文、结尾祝福和署名，不超过 1200 字。" },
              { role: "user", content: `动作：${action}\n主题：${subject}\n原始内容：${String(body.body ?? "").slice(0, 1_500)}\n请输出 json。` }
            ]
          });
          subject = String(completion.content.subject ?? subject ?? "想对你说的话").slice(0, 120);
          suggestion = String(completion.content.suggestion ?? suggestion).slice(0, 1_500);
          if (action === "generate" && !suggestion.includes("见字如面")) suggestion = `见字如面。\n\n${suggestion}`;
          provider = "deepseek";
          model = completion.model;
        } catch {
          // Keep the deterministic draft available while reporting fallback mode.
        }
        if (inputWasClipped) suggestion = suggestion.slice(0, 1_200);
      }
      send(response, 200, {
        action: action.toUpperCase(),
        subject,
        suggestion,
        targetLanguage,
        warnings: String(body.body ?? "").length > 1_200 ? ["内容有点长了，我先帮你整理这一段。"] : [],
        safety: { decision: "ALLOW", reasons: [] },
        runId: `airun-${crypto.randomUUID()}`,
        provider,
        model
      }, requestId);
      return true;
    }

    if (method === "POST" && path === "/letters/voice/send") {
      const body = await readJson(request);
      const idem = requireIdempotency(request, "voice-letter-send", body);
      if (idem.error) {
        const issue = problem(400, idem.error, "Idempotency key required", "Voice Letter sending requires one stable Idempotency-Key per recording session.", requestId);
        send(response, issue.status, issue.body, requestId);
        return true;
      }
      if (idem.cached) {
        send(response, 202, idem.cached, requestId, { "Idempotent-Replayed": "true" });
        return true;
      }

      const recipient = resolveVoiceLetterRecipient(body.recipientId ?? body.recipient);
      const rawBody = String(body.body ?? "").trim().slice(0, 1_200);
      if (!recipient) {
        const issue = problem(422, "VOICE_RECIPIENT_NOT_FOUND", "Voice recipient not found", "请说平台中的联系人昵称，例如 Aiko、Mina、Noah、陈屿或妈妈。", requestId);
        send(response, issue.status, issue.body, requestId);
        return true;
      }
      if (!rawBody) {
        const issue = problem(422, "VOICE_LETTER_EMPTY", "Voice Letter is empty", "请先说出信件正文，再说结束词。", requestId);
        send(response, issue.status, issue.body, requestId);
        return true;
      }

      const decision = await orchestrateTranscript(rawBody, {
        mode: "letter",
        recipient: recipient.displayName
      });
      const polishedBody = String(decision.printable?.content ?? rawBody).trim().slice(0, 2_400);
      const subject = String(body.subject ?? decision.printable?.subject ?? "来自语音的一封信").trim().slice(0, 200);
      const now = new Date().toISOString();
      const letter = {
        id: `ltr-${crypto.randomUUID()}`,
        authorId: me.id,
        recipientId: recipient.id,
        subject,
        body: polishedBody,
        status: "RECEIVED",
        printStatus: "WAITING_DEVICE",
        createdAt: now,
        unread: false,
        version: 2,
        source: String(body.source ?? "voice"),
        voiceSessionId: String(body.sessionId ?? "")
      };
      const job = {
        id: `pj-${crypto.randomUUID()}`,
        userId: recipient.id,
        letterId: letter.id,
        deviceId: device.id,
        title: letter.subject,
        status: "WAITING_DEVICE",
        format: "thermal_58mm",
        pageCount: 1,
        createdAt: now,
        finishedAt: null,
        version: 1
      };
      letters.unshift(letter);
      printJobs.unshift(job);
      const result = {
        letterId: letter.id,
        status: "SENT",
        delivery: { status: "RECEIVED" },
        printJob: job,
        recipient: withUser(recipient),
        polishedBody,
        provider: decision.provider,
        model: decision.model ?? null,
        requestId
      };
      idem.commit(result);
      send(response, 202, result, requestId);
      return true;
    }

    if (method === "POST" && path === "/letters") {
      const body = await readJson(request);
      const idem = requireIdempotency(request, "create-letter", body);
      if (idem.error) {
        const issue = problem(400, idem.error, "Idempotency key required", "Provide Idempotency-Key for this write.", requestId);
        send(response, issue.status, issue.body, requestId);
        return true;
      }
      if (idem.cached) {
        send(response, 201, idem.cached, requestId, { "Idempotent-Replayed": "true" });
        return true;
      }
      const recipient = users.find((item) => item.id === body.recipientId);
      if (!recipient || !body.subject?.trim() || !body.body?.trim()) {
        const issue = problem(422, "LETTER_VALIDATION_FAILED", "Letter validation failed", "Recipient, subject and body are required.", requestId);
        send(response, issue.status, issue.body, requestId);
        return true;
      }
      const letter = {
        id: `ltr-${crypto.randomUUID()}`, authorId: me.id, recipientId: recipient.id,
        subject: body.subject.trim(), body: body.body.trim(), status: "DRAFT", printStatus: null,
        createdAt: new Date().toISOString(), unread: false, version: 1
      };
      letters.unshift(letter);
      const result = hydrateLetter(letter);
      idem.commit(result);
      send(response, 201, result, requestId, { ETag: '"1"' });
      return true;
    }

    const letterMatch = path.match(/^\/letters\/([^/]+)$/);
    if (method === "GET" && letterMatch) {
      const letter = letters.find((item) => item.id === letterMatch[1]);
      if (!letter) {
        const issue = problem(404, "LETTER_NOT_FOUND", "Letter not found", "The requested Letter is not available.", requestId);
        send(response, issue.status, issue.body, requestId);
      } else {
        letter.unread = false;
        send(response, 200, hydrateLetter(letter), requestId, { "Cache-Control": "private, no-store", ETag: `"${letter.version}"` });
      }
      return true;
    }

    const sendLetterMatch = path.match(/^\/letters\/([^/]+)\/send$/);
    if (method === "POST" && sendLetterMatch) {
      const body = await readJson(request);
      const idem = requireIdempotency(request, `send-letter:${sendLetterMatch[1]}`, body);
      if (idem.error) {
        const issue = problem(400, idem.error, "Idempotency key required", "Provide Idempotency-Key for this write.", requestId);
        send(response, issue.status, issue.body, requestId);
        return true;
      }
      if (idem.cached) {
        send(response, 202, idem.cached, requestId, { "Idempotent-Replayed": "true" });
        return true;
      }
      const letter = letters.find((item) => item.id === sendLetterMatch[1] && item.authorId === me.id);
      if (!letter || letter.status !== "DRAFT") {
        const issue = problem(409, "LETTER_STATE_CONFLICT", "Letter cannot be sent", "Only an owned draft can be sent.", requestId);
        send(response, issue.status, issue.body, requestId);
        return true;
      }
      if (body.confirmRecipientId !== letter.recipientId) {
        const issue = problem(409, "LETTER_RECIPIENT_MISMATCH", "Recipient confirmation failed", "Confirm the current recipient before sending.", requestId);
        send(response, issue.status, issue.body, requestId);
        return true;
      }
      letter.status = "RECEIVED";
      letter.version += 1;
      const job = {
        id: `pj-${crypto.randomUUID()}`, userId: letter.recipientId, letterId: letter.id, deviceId: device.id,
        title: letter.subject, status: "WAITING_DEVICE", format: "thermal_58mm", pageCount: 1,
        createdAt: new Date().toISOString(), finishedAt: null, version: 1
      };
      printJobs.unshift(job);
      letter.printStatus = job.status;
      const result = {
        letterId: letter.id, status: "SENT",
        delivery: { status: "RECEIVED" }, printJob: job, requestId
      };
      idem.commit(result);
      send(response, 202, result, requestId);
      return true;
    }

    if (method === "GET" && path === "/devices") {
      send(response, 200, { items: [device] }, requestId);
      return true;
    }

    const deviceStatusMatch = path.match(/^\/devices\/([^/]+)\/status$/);
    if (method === "GET" && deviceStatusMatch) {
      if (deviceStatusMatch[1] !== device.id) {
        const issue = problem(404, "DEVICE_NOT_FOUND", "Device not found", "The requested device is not bound to this account.", requestId);
        send(response, issue.status, issue.body, requestId);
      } else {
        send(response, 200, device, requestId, { ETag: `"${device.printPolicy.version}"` });
      }
      return true;
    }

    const printPolicyMatch = path.match(/^\/devices\/([^/]+)\/print-policy$/);
    if (method === "PUT" && printPolicyMatch) {
      const body = await readJson(request);
      Object.assign(device.printPolicy, body, { version: device.printPolicy.version + 1 });
      device.remotePrintPaused = Boolean(device.printPolicy.paused);
      send(response, 200, device.printPolicy, requestId, { ETag: `"${device.printPolicy.version}"` });
      return true;
    }

    if (method === "GET" && path === "/print-jobs") {
      send(response, 200, page(printJobs), requestId);
      return true;
    }

    const printStatusMatch = path.match(/^\/print-jobs\/([^/]+)\/device-status$/);
    if (method === "POST" && printStatusMatch) {
      const body = await readJson(request);
      const job = printJobs.find((item) => item.id === printStatusMatch[1]);
      if (!job) {
        const issue = problem(404, "PRINT_JOB_NOT_FOUND", "Print job not found", "The print job does not exist.", requestId);
        send(response, issue.status, issue.body, requestId);
        return true;
      }
      const allowed = ["WAITING_DEVICE", "DISPATCHED", "PRINTING", "SUCCESS", "FAILED_RETRYABLE", "CANCELLED"];
      if (!allowed.includes(body.status)) {
        const issue = problem(422, "PRINT_STATUS_INVALID", "Print status is invalid", "The status is not allowed.", requestId);
        send(response, issue.status, issue.body, requestId);
        return true;
      }
      job.status = body.status;
      job.version += 1;
      if (body.status === "SUCCESS") job.finishedAt = new Date().toISOString();
      const letter = letters.find((item) => item.id === job.letterId);
      if (letter) {
        letter.printStatus = job.status;
        if (job.status === "SUCCESS") letter.status = "PRINTED";
        if (job.status === "PRINTING") letter.status = "PRINTING";
      }
      send(response, 200, job, requestId, { ETag: `"${job.version}"` });
      return true;
    }

    if (method === "POST" && path === "/auth/login") {
      const body = await readJson(request);
      if (!body.email || !body.password) {
        const issue = problem(401, "AUTHENTICATION_FAILED", "Authentication failed", "Email or password is invalid.", requestId);
        send(response, issue.status, issue.body, requestId);
      } else {
        send(response, 200, { user: me, sessionExpiresAt: new Date(Date.now() + 86_400_000).toISOString(), requestId }, requestId, {
          "Set-Cookie": "__Host-aihub_session=demo; Path=/; HttpOnly; SameSite=Lax"
        });
      }
      return true;
    }

    if (method === "POST" && path === "/auth/register") {
      const body = await readJson(request);
      if (!body.email || !body.password || !body.displayName) {
        const issue = problem(422, "REGISTRATION_INVALID", "Registration failed", "Email, password and display name are required.", requestId);
        send(response, issue.status, issue.body, requestId);
      } else {
        send(response, 201, { user: { ...me, displayName: body.displayName, email: body.email }, sessionExpiresAt: new Date(Date.now() + 86_400_000).toISOString(), requestId }, requestId);
      }
      return true;
    }

    const issue = problem(404, "API_ROUTE_NOT_FOUND", "API route not found", "The requested API endpoint does not exist.", requestId);
    send(response, issue.status, issue.body, requestId);
    return true;
  } catch (error) {
    const issue = problem(
      error?.message === "PAYLOAD_TOO_LARGE" ? 413 : 400,
      error?.message === "PAYLOAD_TOO_LARGE" ? "PAYLOAD_TOO_LARGE" : "INVALID_JSON",
      "Request could not be processed",
      error?.message === "PAYLOAD_TOO_LARGE" ? "The request body exceeds the MVP limit." : "The JSON request body is invalid.",
      requestId
    );
    send(response, issue.status, issue.body, requestId);
    return true;
  }
}
