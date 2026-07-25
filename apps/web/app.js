import { api, ApiProblem } from "./services/api-client.js";
import { DeviceBus } from "./services/device-bus.js";
import { createCompanionStore, createPrintJob } from "./services/companion-store.js";

const app = document.querySelector("#app");
const toastRegion = document.querySelector("#toast-region");
const bus = new DeviceBus("ai-hub-web");
const companionStore = createCompanionStore();

const MATCH_INTEREST_OPTIONS = ["AI", "机器人", "ESP32", "摄影", "游戏", "阅读", "音乐", "旅行", "手帐", "插画", "开源", "自然", "生活", "猫"];
const MATCH_INTEREST_META = {
  AI: ["✦", "一起发现新鲜工具"], 机器人: ["◉", "聊机器人与陪伴"], ESP32: ["⌁", "分享小小创造"],
  摄影: ["▣", "交换镜头里的日常"], 游戏: ["◆", "找一个轻松玩伴"], 阅读: ["▤", "分享最近读到的句子"],
  音乐: ["♪", "交换循环播放的歌"], 旅行: ["⌖", "听彼此城市的故事"], 手帐: ["✎", "记录柔软的小事"],
  插画: ["◒", "一起画下灵感"], 开源: ["⌘", "让好点子彼此生长"], 自然: ["❋", "喜欢风、树和散步"],
  生活: ["☕", "聊普通却真实的一天"], 猫: ["⌁", "当然也聊猫"]
};
const MATCH_QUIZ_STEPS = [
  {
    key: "interests", eyebrow: "YOUR LITTLE UNIVERSE", title: "哪些事会让你眼睛发亮？",
    hint: "选 3–6 个就很好，我们会先从共同兴趣开始。", multiple: true,
    options: MATCH_INTEREST_OPTIONS.map((value) => ({ value, icon: MATCH_INTEREST_META[value][0], detail: MATCH_INTEREST_META[value][1] }))
  },
  {
    key: "goal", eyebrow: "A GOOD BEGINNING", title: "你想遇见怎样的关系？",
    hint: "没有标准答案，选此刻最期待的一种。", multiple: false,
    options: [
      { value: "慢慢写信", icon: "✉", detail: "认真写一封不着急的信" },
      { value: "兴趣搭子", icon: "✦", detail: "从共同爱好开始聊天" },
      { value: "学习伙伴", icon: "↗", detail: "互相鼓励，一起变得更好" },
      { value: "分享日常", icon: "☕", detail: "交换生活里微小的瞬间" }
    ]
  },
  {
    key: "pace", eyebrow: "YOUR RHYTHM", title: "怎样的联系频率最舒服？",
    hint: "之后随时可以回来修改。", multiple: false,
    options: [
      { value: "慢慢回信", icon: "◔", detail: "几天一封，给彼此留一点余白" },
      { value: "常常聊聊", icon: "◑", detail: "有空就分享，保持自然联系" },
      { value: "偶尔遇见", icon: "○", detail: "不设压力，想起时再打招呼" }
    ]
  },
  {
    key: "distance", eyebrow: "NEAR OR FAR", title: "你想遇见哪里的朋友？",
    hint: "距离只是故事的一部分。", multiple: false,
    options: [
      { value: "世界各地", icon: "◎", detail: "让不同文化带来新鲜视角" },
      { value: "附近城市", icon: "⌖", detail: "优先认识生活半径相近的人" },
      { value: "都可以", icon: "∞", detail: "只要聊得来，远近都很好" }
    ]
  }
];
const DAILY_BRIEFING_SOURCE_OPTIONS = ["AI新闻", "科技产品", "开源项目", "财经", "美股", "汇率", "天气", "日历"];

function matchProfileStorageKey(userId = "guest") {
  return `aihub-match-profile:${userId}`;
}

function loadMatchProfile(userId = "guest") {
  try {
    const saved = JSON.parse(localStorage.getItem(matchProfileStorageKey(userId)) ?? "null");
    if (saved && Array.isArray(saved.interests)) return saved;
  } catch {}
  return {
    interests: ["AI", "机器人", "阅读"],
    goal: "",
    pace: "",
    distance: "",
    completedAt: null
  };
}

const initialMatchProfile = loadMatchProfile();

function applyCurrentUser(user) {
  ui.currentUser = user;
  const profile = loadMatchProfile(user?.id);
  ui.matchProfile = profile;
  ui.matchPreferences = [...profile.interests];
}

const ui = {
  authChecked: false,
  currentUser: null,
  authBusy: false,
  authNotice: null,
  voiceState: "off",
  voiceEnabled: true,
  autoPrint: false,
  autoPrintMode: "assistant",
  unifiedBusy: false,
  unifiedTranscript: "",
  unifiedInterim: "",
  unifiedConversation: null,
  unifiedDevice: null,
  unifiedConversations: [],
  unifiedCommands: [],
  unifiedPrintJobs: [],
  unifiedPrintingId: null,
  category: "全部",
  query: "",
  matchPreferences: [...initialMatchProfile.interests],
  matchProfile: initialMatchProfile,
  matchQuizStep: 0,
  letterBox: "inbox",
  selectedLetterId: null,
  simulatorConnected: false,
  activePrintJobId: null,
  renderVersion: 0,
  wordRevealed: false,
  letterAttachment: null,
  fortuneResult: null,
  journalSummary: "",
  aiProvider: "checking",
  voiceListening: false,
  voiceProcessing: false,
  voicePrinting: false,
  voiceTranscript: "",
  voiceMode: "default",
  voiceRecipient: null,
  voiceResult: null,
  voiceLetterParts: [],
  voiceLetterSendKey: null,
  voiceSending: false
};

const nav = [
  ["/", "语音控制", "mic"],
  ["/community", "社区", "community"],
  ["/match", "匹配", "match"],
  ["/letter", "信件", "letter"],
  ["/conversations", "对话记录", "community"],
  ["/prints", "打印记录", "printer"],
  ["/device", "设备", "device"]
];

const mobileNav = [
  ["/", "语音", "mic"],
  ["/community", "社区", "community"],
  ["/match", "匹配", "match"],
  ["/letter", "信件", "letter"],
  ["/device", "设备", "device"]
];

const paths = {
  home: '<path d="m3 11 9-8 9 8"/><path d="M5 10v10h14V10"/><path d="M9 20v-6h6v6"/>',
  community: '<path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z"/><path d="M8 9h8M8 13h5"/>',
  match: '<circle cx="8" cy="8" r="4"/><circle cx="16" cy="16" r="4"/><path d="m11 11 2 2"/>',
  letter: '<rect width="18" height="14" x="3" y="5" rx="2"/><path d="m3 7 9 6 9-6"/>',
  device: '<rect width="16" height="20" x="4" y="2" rx="4"/><path d="M8 7h8v6H8z"/><path d="M9 18h.01M15 18h.01"/>',
  profile: '<circle cx="12" cy="8" r="4"/><path d="M4 22a8 8 0 0 1 16 0"/>',
  book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5Z"/><path d="M4 5.5v14A2.5 2.5 0 0 0 6.5 22H20"/>',
  camera: '<path d="M14.5 4 16 7h3a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3v-8a3 3 0 0 1 3-3h3l1.5-3Z"/><circle cx="12" cy="14" r="4"/>',
  eye: '<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  mic: '<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v3M8 22h8"/>',
  journal: '<path d="M5 4h14v16H5z"/><path d="M9 4v16M12 9h4M12 13h4"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>',
  heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21l7.8-7.5 1.1-1.1a5.5 5.5 0 0 0-.1-7.8Z"/>',
  comment: '<path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z"/>',
  bookmark: '<path d="M6 3h12v18l-6-4-6 4Z"/>',
  share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 10.5 6.8-4M8.6 13.5l6.8 4"/>',
  arrow: '<path d="m9 18 6-6-6-6"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  github: '<path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3.3-.4 6.8-1.6 6.8-7A5.4 5.4 0 0 0 19.4 4 5 5 0 0 0 19.3.5S18.2.1 15 1.8a13.4 13.4 0 0 0-6 0C5.8.1 4.7.5 4.7.5A5 5 0 0 0 4.6 4a5.4 5.4 0 0 0-1.4 3.7c0 5.4 3.5 6.6 6.8 7A4.8 4.8 0 0 0 9 18v4"/><path d="M9 19c-3 .9-3-1.5-4-2"/>',
  spark: '<path d="m12 3-1.2 3.8L7 8l3.8 1.2L12 13l1.2-3.8L17 8l-3.8-1.2Z"/><path d="m5 14-.8 2.2L2 17l2.2.8L5 20l.8-2.2L8 17l-2.2-.8Z"/>',
  printer: '<path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect width="12" height="8" x="6" y="14"/>',
  wifi: '<path d="M5 12.6a10 10 0 0 1 14 0M8.5 16.1a5 5 0 0 1 7 0M12 20h.01M2 9.1a15 15 0 0 1 20 0"/>',
  battery: '<rect width="18" height="12" x="2" y="6" rx="2"/><path d="M22 10v4M6 10h8"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.6v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20"/>',
  close: '<path d="M18 6 6 18M6 6l12 12"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/>',
  flag: '<path d="M5 22V4M5 4h12l-2 4 2 4H5"/>',
  pause: '<path d="M8 5v14M16 5v14"/>'
};

function icon(name, size = 20, filled = false) {
  return `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="${filled ? "currentColor" : "none"}" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] ?? paths.spark}</svg>`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  })[character]);
}

function formatTime(value) {
  const date = new Date(value);
  const diff = Date.now() - date.getTime();
  if (diff < 60 * 60 * 1000) return `${Math.max(1, Math.round(diff / 60000))} 分钟前`;
  if (diff < 24 * 60 * 60 * 1000) return `${Math.round(diff / 3600000)} 小时前`;
  return new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric" }).format(date);
}

function currentPath() {
  const path = window.location.pathname.replace(/\/+$/, "") || "/";
  const allowed = [
    "/", "/welcome", "/login", "/register", "/forgot-password", "/reset-password",
    "/community", "/create-post", "/match", "/match/preferences",
    "/letter", "/letter/create", "/profile",
    "/account", "/conversations", "/prints", "/device"
  ];
  return allowed.includes(path) ? path : "/";
}

function navigate(path) {
  document.body.classList.remove("mobile-menu-open");
  history.pushState({}, "", path);
  render();
  window.scrollTo({ top: 0, behavior: "instant" });
}

function toast(message, tone = "default") {
  const element = document.createElement("div");
  element.className = `toast ${tone}`;
  element.innerHTML = `<i></i><span>${escapeHtml(message)}</span>`;
  toastRegion.append(element);
  requestAnimationFrame(() => element.classList.add("show"));
  setTimeout(() => {
    element.classList.remove("show");
    setTimeout(() => element.remove(), 220);
  }, 2600);
}

function showLetterSendResult({ tone = "success", title, message, detail, actionLabel = "查看我的信件", onClose }) {
  document.querySelector("[data-send-result]")?.remove();
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay send-result-overlay";
  overlay.dataset.sendResult = "true";
  overlay.innerHTML = `<section class="send-result-card ${tone}" role="dialog" aria-modal="true" aria-labelledby="send-result-title">
    <div class="send-result-icon">${icon(tone === "success" ? "check" : tone === "warning" ? "clock" : "close", 28)}</div>
    <p class="eyebrow">LETTER DELIVERY</p>
    <h2 id="send-result-title">${escapeHtml(title)}</h2>
    <p>${escapeHtml(message)}</p>
    <div class="send-result-detail">${icon("printer", 17)}<span>${escapeHtml(detail)}</span></div>
    <button class="primary-button full" type="button" data-close-send-result>${escapeHtml(actionLabel)}${icon("arrow", 15)}</button>
  </section>`;
  document.body.append(overlay);
  const close = () => {
    overlay.remove();
    onClose?.();
  };
  overlay.querySelector("[data-close-send-result]").addEventListener("click", close);
  overlay.querySelector("[data-close-send-result]").focus();
}

function loading() {
  return `<div class="loading-view"><span class="loading-mark"><i></i><i></i><i></i></span><p>正在连接 AI Hub OS…</p></div>`;
}

function logo() {
  return `<span class="hub-logo-mark"><i></i><b>A</b></span><span class="hub-logo-copy"><strong>AI HUB</strong><small>OS / COMPANION</small></span>`;
}

function shell(content, activePath = currentPath()) {
  const active = activePath === "/create-post"
    ? "/community"
    : activePath.startsWith("/match/")
      ? "/match"
      : activePath.startsWith("/letter/")
        ? "/letter"
        : activePath;
  const status = ui.unifiedDevice ?? {};
  const printerStatus = status.printer?.status ?? "CHECKING";
  const user = ui.currentUser ?? {};
  return `<div class="hub-app">
    <header class="topbar">
      <button class="hub-logo" data-nav="/" aria-label="AI Hub OS 首页">${logo()}</button>
      <nav class="desktop-nav" aria-label="主导航">
        ${nav.map(([path, label]) => `<button data-nav="${path}" class="${active === path ? "active" : ""}">${label}</button>`).join("")}
      </nav>
      <div class="topbar-actions">
        <details class="account-menu">
          <summary><span class="avatar-button">${escapeHtml(user.avatar ?? user.displayName?.slice(0, 1) ?? "U")}</span><span><strong>${escapeHtml(user.displayName ?? "用户")}</strong><small>${escapeHtml(user.email ?? "")}</small></span>${icon("arrow", 13)}</summary>
          <div>
            <header><strong>${escapeHtml(user.displayName ?? "用户")}</strong><small>${escapeHtml(user.email ?? "")}</small></header>
            <button data-nav="/account">${icon("settings", 16)}账号设置</button>
            <button data-nav="/device">${icon("device", 16)}设备管理</button>
            <button data-nav="/conversations">${icon("community", 16)}对话记录</button>
            <button data-nav="/prints">${icon("printer", 16)}打印记录</button>
            <button data-logout>${icon("close", 16)}退出登录</button>
          </div>
        </details>
      </div>
    </header>
    <section class="control-statusbar" aria-label="系统状态">
      <div class="statusbar-brand"><i class="live-dot ${status.status === "ONLINE" ? "online" : ""}"></i><span><strong>${escapeHtml(status.displayName ?? "ESP32-S3")}</strong><small>${status.status === "ONLINE" ? "设备在线" : status.status === "UNBOUND" ? "尚未绑定" : "设备离线"}</small></span></div>
      <div class="statusbar-signals">
        <span>${icon("wifi", 15)}<i><b>网络</b><small>${escapeHtml(status.wifi ?? "检查中")}</small></i></span>
        <span>${icon("printer", 15)}<i><b>打印机</b><small>${escapeHtml(printerStatus)}</small></i></span>
      </div>
      <div class="statusbar-switches">
        <label><span><b>语音总控</b><small>${ui.voiceEnabled ? "已开启" : "已关闭"}</small></span><input type="checkbox" data-global-voice ${ui.voiceEnabled ? "checked" : ""}><i></i></label>
        <label><span><b>自动打印</b><small>默认关闭</small></span><input type="checkbox" data-auto-print ${ui.autoPrint ? "checked" : ""}><i></i></label>
      </div>
    </section>
    <main class="hub-main">${content}</main>
    <nav class="mobile-nav" aria-label="移动端导航">
      ${mobileNav.map(([path, label, iconName]) => `<button data-nav="${path}" class="${active === path ? "active" : ""}">${icon(iconName, 19)}<span>${label}</span></button>`).join("")}
    </nav>
  </div>`;
}

function pageHead(eyebrow, title, subtitle, action = "") {
  return `<header class="page-head"><div><p class="eyebrow">${eyebrow}</p><h1>${title}</h1><p>${subtitle}</p></div>${action ? `<div class="page-head-action">${action}</div>` : ""}</header>`;
}

function avatarTone(userId) {
  const colors = { "usr-aiko": "rose", "usr-noah": "blue", "usr-mina": "mint", "usr-chen": "amber", "usr-lin": "ink" };
  return colors[userId] ?? "blue";
}

function avatar(user, className = "") {
  return `<span class="user-avatar ${avatarTone(user.id)} ${className}">${escapeHtml(user.avatar ?? user.displayName?.slice(0, 1))}</span>`;
}

function tagList(tags, limit = 4) {
  return `<span class="tag-list">${(tags ?? []).slice(0, limit).map((tag) => `<i>${escapeHtml(typeof tag === "string" ? tag : tag.name)}</i>`).join("")}</span>`;
}

function cover(type) {
  const shapes = {
    robot: '<div class="cover-bot"><i></i><span>●　●</span><b>MORNING<br>26°C</b></div>',
    gesture: '<div class="cover-gesture"><span>✌</span><i>96%</i><b>V SIGN</b></div>',
    agent: '<div class="cover-agent"><i></i><i></i><i></i><strong>QUIET<br>BRIEF</strong></div>',
    letter: '<div class="cover-letter"><span>見字如面</span><i></i><b>AI LETTER / 07.20</b></div>',
    architecture: '<div class="cover-architecture"><span>LETTER</span><i>→</i><span>PRINT</span></div>',
    community: '<div class="cover-community"><span>此刻</span><span>兴趣</span><span>朋友</span></div>',
    journal: '<div class="cover-journal"><span>THU<br>23</span><div><i>今天的心情</i><strong>雨声、咖啡<br>和一小段安静。</strong><b>☁︎　☕</b></div></div>',
    reading: '<div class="cover-reading"><div><span>READ<br>SLOWLY</span></div><p>“真正喜欢的句子，<br>值得多停留一会儿。”</p></div>',
    egg: '<div class="cover-egg"><span>✦</span><strong>今天也会有<br>小小的好事。</strong><i>DAILY EGG</i></div>',
    desk: '<div class="cover-desk"><span>♪</span><div><i></i><b>我的桌面陪伴物</b></div><em>☕</em></div>'
  };
  return `<div class="post-cover cover-${type}">${shapes[type] ?? shapes.community}</div>`;
}

function typeBadge(type) {
  const map = { POST: ["讨论", "plain"], PROJECT: ["项目", "project"], AGENT: ["Agent", "agent"], LETTER_SHARE: ["Letter", "letter"] };
  const value = map[type] ?? map.POST;
  return `<span class="type-badge ${value[1]}">${value[0]}</span>`;
}

function postCard(post, compact = false) {
  return `<article class="post-card ${compact ? "compact" : ""}" data-post-card="${post.id}">
    <header class="post-author">
      ${avatar(post.author)}
      <span><strong>${escapeHtml(post.author.displayName)}</strong><small>@${escapeHtml(post.author.handle)} · ${formatTime(post.createdAt)}</small></span>
      ${typeBadge(post.type)}
      <button class="more-button">${icon("more", 17)}</button>
    </header>
    <div class="post-copy" data-open-post="${post.id}">
      <h2>${escapeHtml(post.title)}</h2>
      <p>${escapeHtml(post.content)}</p>
      ${tagList(post.tags)}
    </div>
    ${post.cover ? cover(post.cover) : ""}
    <footer class="post-actions">
      <button data-like-post="${post.id}" class="${post.viewer?.liked ? "active" : ""}">${icon("heart", 17, post.viewer?.liked)}<span>${post.metrics?.likes ?? post.likes}</span></button>
      <button data-open-post="${post.id}">${icon("comment", 17)}<span>${post.metrics?.comments ?? post.comments}</span></button>
      <button data-bookmark-post="${post.id}" class="${post.viewer?.bookmarked ? "active" : ""}">${icon("bookmark", 17, post.viewer?.bookmarked)}<span>收藏</span></button>
      <button data-share-post="${post.id}">${icon("share", 17)}<span>分享</span></button>
      <span class="post-views">${post.metrics?.views ?? post.views} 次浏览</span>
    </footer>
  </article>`;
}

function miniUser(match, reason = true) {
  const user = match.user;
  return `<article class="mini-user-card">
    ${avatar(user, "large")}
    <div class="mini-user-copy"><span><strong>${escapeHtml(user.displayName)}</strong><small>${escapeHtml(user.city)} · ${escapeHtml(user.country)}</small></span>${tagList(user.interests, 3)}${reason ? `<p>${escapeHtml(match.reasons?.[0] ?? "你们可能会聊得来")}</p>` : ""}</div>
    <div class="match-score"><strong>${match.score}%</strong><small>匹配</small></div>
    <button class="soft-icon" data-write-to="${user.id}" title="写信">${icon("letter", 17)}</button>
  </article>`;
}

function deviceMini(device) {
  return `<article class="device-mini">
    <div class="device-illustration"><span class="antenna"></span><div><i></i><i></i><b></b></div></div>
    <div><span class="online-label"><i></i>${device.status === "ONLINE" ? "Online" : "Offline"}</span><h3>${escapeHtml(device.displayName)}</h3><p>${escapeHtml(device.model)} · FW ${escapeHtml(device.firmwareVersion)}</p></div>
    <div class="device-mini-stats"><span>${icon("battery", 15)}${device.battery}%</span><span>${icon("printer", 15)}${escapeHtml(device.printer.status)}</span></div>
  </article>`;
}

function dailyBriefingCard(briefing) {
  const sources = new Set(briefing.sources ?? []);
  return `<article class="daily-briefing-card">
    <header>
      <span><p class="eyebrow">${briefing.category === "finance" ? "MARKET" : "DAILY NEWS"}</p><h3>${escapeHtml(briefing.title)}</h3></span>
      <button type="button" class="mini-switch ${briefing.enabled ? "active" : ""}" data-briefing-toggle="${escapeHtml(briefing.id)}" data-enabled="${briefing.enabled ? "true" : "false"}">${briefing.enabled ? "ON" : "OFF"}</button>
    </header>
    <label class="briefing-time">时间<span><input type="time" value="${escapeHtml(briefing.time)}" data-briefing-time="${escapeHtml(briefing.id)}"><button type="button" data-briefing-save-time="${escapeHtml(briefing.id)}">保存</button></span></label>
    <div class="briefing-source-list">
      ${DAILY_BRIEFING_SOURCE_OPTIONS.map((source) => `<button type="button" class="${sources.has(source) ? "active" : ""}" data-briefing-source="${escapeHtml(source)}" data-briefing-id="${escapeHtml(briefing.id)}">${escapeHtml(source)}</button>`).join("")}
    </div>
    <footer><span>${briefing.delivery?.includes("printer") ? "应用 + 打印机" : "仅应用"}</span><button type="button" data-briefing-print="${escapeHtml(briefing.id)}">${icon("printer", 14)}打印一次</button></footer>
  </article>`;
}

async function communityView() {
  const data = await api.posts({ category: ui.category, query: ui.query });
  const categories = ["全部", "日常", "心情", "兴趣", "交友", "创作", "设备"];
  const visibleItems = data.items.filter((post) => {
    const tags = (post.tags ?? []).map((tag) => typeof tag === "string" ? tag : tag.name);
    return post.cover !== "runner" && !tags.includes("小游戏") && !tags.includes("学习打卡");
  });
  return `<section class="page community-page" id="community-view">
    ${pageHead("COMMUNITY SQUARE", "社区广场", "聊今天、兴趣和心情，也认识生活节奏相近的人。", `<button class="primary-button" data-nav="/create-post">${icon("plus", 17)}分享此刻</button>`)}
    <div class="community-search">
      <form id="community-search-form">${icon("search", 19)}<input name="query" value="${escapeHtml(ui.query)}" placeholder="搜索日常、兴趣、城市或朋友"><button>搜索</button></form>
      <div class="category-tabs">${categories.map((category) => `<button data-category="${category}" class="${ui.category === category ? "active" : ""}">${category}</button>`).join("")}</div>
    </div>
    <div class="community-layout">
      <aside class="topic-sidebar">
        <p class="eyebrow">YOUR CORNERS</p>
        ${["今日手帐", "读书与电影", "晚安电台", "城市散步"].map((topic, index) => `<button data-topic="${topic}"><span>#</span>${topic}<small>${[268, 193, 121, 96][index]}</small></button>`).join("")}
        <div class="community-rule">${icon("shield", 19)}<p><strong>让交流保持真诚。</strong><br>不催促、不评判、不泄露隐私，给彼此舒服的距离。</p></div>
      </aside>
      <main class="feed-column">
        <div class="feed-sort"><span>${visibleItems.length} 条内容</span><div><button class="active">为你推荐</button><button>最新发布</button></div></div>
        ${visibleItems.length ? visibleItems.map((post) => postCard(post)).join("") : `<div class="empty-state">${icon("search", 28)}<h3>没有找到相关内容</h3><p>换个关键词或分类试试。</p></div>`}
      </main>
      <aside class="discover-sidebar">
        <article class="side-card">
          <div class="side-card-head"><p><span class="eyebrow">TRENDING</span><strong>本周热门</strong></p><button>查看更多</button></div>
          ${[["01", "今天的一件小事", "1.2k 分享"], ["02", "周末城市散步", "836 参与"], ["03", "来自远方的信", "619 封"]].map(([n, title, count]) => `<button class="trend-row"><i>${n}</i><span><strong>${title}</strong><small>${count}</small></span>${icon("arrow", 14)}</button>`).join("")}
        </article>
        <article class="side-card maker-card">
          <p class="eyebrow">STORYTELLER OF THE WEEK</p>
          <div class="maker-avatar">M</div><h3>Mina</h3><p>插画 · 旅行 · 猫 · 手帐</p>
          <button data-nav="/profile">查看主页</button>
        </article>
      </aside>
    </div>
  </section>`;
}

function postTypeFields(type) {
  if (type === "PROJECT") return `<div class="form-row two"><label>作品链接（可选）<input name="repositoryUrl" type="url" placeholder="相册、视频或项目地址"></label><label>使用了什么<input name="hardware" placeholder="水彩、相机、代码、旧纸张……"></label></div>`;
  if (type === "AGENT") return `<div class="form-row two"><label>这个 AI 能帮什么<input name="agentFunction" placeholder="整理旅行计划、陪练英语……"></label><label>适合什么时候用<input name="usage" placeholder="学习 / 生活 / 创作"></label></div><label>使用方法或 Prompt<textarea name="prompt" rows="4" placeholder="分享安全、可公开的使用方式"></textarea></label>`;
  if (type === "LETTER_SHARE") return `<div class="letter-share-note">${icon("shield", 18)}只分享你明确选择的公开节选。收件人、地址和完整私人正文默认不会公开。</div>`;
  return "";
}

async function createPostView() {
  return `<section class="page composer-page" id="create-post-view">
    ${pageHead("CREATE", "分享此刻", "可以是今天的一件小事、一段心情或新认识的兴趣。")}
    <div class="composer-layout">
      <form class="composer-card" id="post-form">
        <fieldset class="type-picker"><legend>内容类型</legend>
          ${[["POST", "日常分享", "心情与此刻"], ["PROJECT", "兴趣作品", "照片、手作与创作"], ["AGENT", "AI 小玩法", "好用的方法"], ["LETTER_SHARE", "信件故事", "公开节选"]].map(([value, title, detail], index) => `<label><input type="radio" name="type" value="${value}" ${index === 0 ? "checked" : ""}><span>${icon(value === "PROJECT" ? "sun" : value === "AGENT" ? "spark" : value === "LETTER_SHARE" ? "letter" : "community", 19)}<strong>${title}</strong><small>${detail}</small></span></label>`).join("")}
        </fieldset>
        <label>标题<input name="title" maxlength="200" placeholder="给这次分享一个清楚的标题" required><small class="field-count">0 / 200</small></label>
        <label>正文<textarea name="content" rows="9" placeholder="今天发生了什么？哪一个小瞬间想和大家分享？" required></textarea></label>
        <div id="post-type-fields"></div>
        <label>标签<div class="tag-input">${icon("plus", 15)}<input name="tags" placeholder="输入标签，用逗号分隔"></div><small>最多 8 个，例如：今日手帐、读书、上海散步</small></label>
        <div class="upload-box"><span>${icon("plus", 22)}</span><strong>添加图片或项目封面</strong><small>上传接口已预留；当前 MVP 使用安全占位图</small></div>
        <div class="composer-footer"><button type="button" class="ghost-button" data-save-draft>保存草稿</button><button class="primary-button" type="submit">发布到社区 ${icon("arrow", 16)}</button></div>
      </form>
      <aside class="composer-aside">
        <div class="paper-tip"><span>01</span><h3>普通的一天也值得记录</h3><p>不需要“有用”或“厉害”，真实的小事往往更容易让人产生共鸣。</p></div>
        <div class="paper-tip"><span>02</span><h3>给陌生人舒服的距离</h3><p>分享照片和位置前先检查隐私，也尊重别人不立刻回复的节奏。</p></div>
        <div class="paper-tip"><span>03</span><h3>AI 只是表达助手</h3><p>AI 可以润色，但请保留自己的事实、感受和语气。</p></div>
      </aside>
    </div>
  </section>`;
}

function studyProgress(tasks) {
  const completed = tasks.filter((task) => task.done).length;
  return tasks.length ? Math.round((completed / tasks.length) * 100) : 0;
}

function voiceIntentLabel(intent) {
  return {
    CHAT: "AI 对话",
    ORGANIZE_PLAN: "整理今日计划",
    PRINT_TODAY_PLAN: "今日计划待打印",
    PRINT_CONVERSATION: "对话摘要待打印",
    PRINT_WORDS: "单词卡待打印",
    START_TURTLE_SOUP: "海龟汤",
    WRITE_LETTER: "AI 写信 · 聆听内容",
    LETTER_CONTENT: "AI 信件 · 继续聆听",
    SEND_LETTER: "正在发送信件",
    LETTER_SENT: "信件已发送",
    CONFIRM_PRINT: "确认打印"
  }[intent] ?? "AI 助手";
}

function voiceAgentPanel(aiStatus) {
  const result = ui.voiceResult;
  const stateLabel = ui.voiceSending ? "正在发送信件" : ui.voiceListening ? "聆听中" : ui.voiceProcessing ? "AI 正在理解" : ui.voicePrinting ? "正在打印" : "等待指令";
  return `<article class="voice-agent-card ${ui.voiceListening ? "listening" : ""} ${ui.voiceProcessing ? "processing" : ""}">
    <div class="voice-agent-status">
      <button type="button" class="voice-orb" data-voice-toggle aria-label="开始语音输入">${icon("mic", 24)}<i></i><i></i></button>
      <span><p class="eyebrow">VOICE · AI · PRINT</p><h2>${stateLabel}</h2><small>${aiStatus.configured ? `${escapeHtml(aiStatus.model)} · Server-side` : "本地降级模式 · 请配置 DeepSeek"}</small></span>
      <b class="ai-live-badge ${aiStatus.configured ? "live" : "offline"}">${aiStatus.configured ? "DEEPSEEK LIVE" : "FALLBACK"}</b>
    </div>
    <form class="voice-command-form" id="voice-command-form">
      <input name="transcript" maxlength="1500" value="${escapeHtml(ui.voiceTranscript)}" placeholder="也可以输入：帮我打印今日计划 / 我要给妈妈写一封信" required>
      <button class="primary-button" ${ui.voiceProcessing ? "disabled" : ""}>让 MIMO 理解 ${icon("arrow", 15)}</button>
    </form>
    <div class="voice-examples">${["帮我打印今日计划", "把这些单词打印出来", "我要给妈妈写一封信", "最近想你了，记得照顾身体", "结束", "我要玩海龟汤"].map((text) => `<button type="button" data-voice-example="${text}">${text}</button>`).join("")}</div>
    ${result ? `<section class="voice-ai-result">
      <header><span><p class="eyebrow">${escapeHtml(voiceIntentLabel(result.intent))}</p><strong>${escapeHtml(result.reply)}</strong></span><i>${result.provider === "deepseek" ? "AI" : "LOCAL"}</i></header>
      ${result.warning ? `<p class="voice-warning">${escapeHtml(result.reply)}</p>` : ""}
      ${result.printable ? `<pre>${escapeHtml(result.printable.content)}</pre>` : ""}
      <footer>
        ${["WRITE_LETTER", "LETTER_CONTENT"].includes(result.intent) ? `<span>${icon("mic", 15)}继续说正文；说 over、发送信件或结束，将自动发送数字信件。</span>` : result.intent === "LETTER_SENT" ? `<span>${icon("check", 15)}本次提交已锁定，重复结束词不会重复发送。</span>` : result.requiresConfirmation ? `<span>${icon("shield", 15)}内容尚未发送到打印机，请先检查。</span>` : `<span>${icon("check", 15)}当前操作不需要打印。</span>`}
        ${result.requiresConfirmation && result.printable ? `<button type="button" class="primary-button" data-confirm-ai-print ${ui.voicePrinting ? "disabled" : ""}>${icon("printer", 15)}确认并打印</button>` : ""}
      </footer>
    </section>` : ""}
  </article>`;
}

async function educationView() {
  const state = companionStore.getState();
  const word = state.study.words[state.study.wordIndex % state.study.words.length];
  const progress = studyProgress(state.tasks);
  const aiStatus = await api.aiStatus().catch(() => ({ configured: false, model: "local-fallback" }));
  ui.aiProvider = aiStatus.configured ? "deepseek" : "local-fallback";
  return `<section class="page companion-page education-page" id="education-view">
    ${pageHead("LEARN WITH MIMO", "学习空间", "提问、记住一个单词，再完成一件今天真正做得到的小事。", `<span class="streak-pill">🔥 ${state.study.streak} 天连续学习</span>`)}
    ${voiceAgentPanel(aiStatus)}
    <div class="education-grid">
      <article class="tutor-card companion-card">
        <header class="companion-card-head"><div><i>${icon("spark", 18)}</i><span><h2>MIMO Tutor</h2><small>AI 学习助手 · Online</small></span></div><button class="round-button" data-clear-chat title="清空对话">↻</button></header>
        <div class="tutor-thread" id="tutor-thread">
          ${state.messages.map((message, index) => `<div class="chat-bubble ${message.role}">${message.role === "assistant" ? '<i>M</i>' : ""}<p>${escapeHtml(message.content)}${message.role === "assistant" ? `<button type="button" data-print-message="${index}" title="打印这条回复">${icon("printer", 12)}打印</button>` : ""}</p></div>`).join("")}
        </div>
        <form class="tutor-form" id="tutor-form">
          <input name="question" placeholder="问我任何问题，例如：为什么天空是蓝色的？" required>
          <button aria-label="发送问题">${icon("arrow", 17)}</button>
        </form>
        <div class="quick-prompts">
          ${["解释一个知识点", "制定英语计划", "给我出一道小测验"].map((prompt) => `<button data-tutor-prompt="${prompt}">${prompt}</button>`).join("")}
        </div>
      </article>
      <aside class="education-side">
        <article class="word-card companion-card">
          <header><div><p class="eyebrow">WORD OF THE DAY</p><h2>今日单词</h2></div><button class="round-button" data-next-word title="换一个单词">↻</button></header>
          <button class="flashcard ${ui.wordRevealed ? "revealed" : ""}" data-word-reveal aria-label="翻转单词卡">
            ${ui.wordRevealed
              ? `<small>中文释义</small><strong>${escapeHtml(word.meaning)}</strong><p>${escapeHtml(word.example)}</p>`
              : `<small>ENGLISH · B2</small><strong>${escapeHtml(word.word)}</strong><p>${escapeHtml(word.phonetic)}</p>`}
            <span>${ui.wordRevealed ? "点击回到单词" : "点击查看释义"}</span>
          </button>
          <div class="word-actions"><button class="outline-button" data-speak-word="${escapeHtml(word.word)}">♪ 听发音</button><button class="outline-button" data-print-word>${icon("printer", 14)}打印</button><button class="primary-button" data-next-word>下一个</button></div>
        </article>
        <article class="study-plan companion-card">
          <header><div><p class="eyebrow">STUDY PLAN</p><h2>今日计划</h2></div><button class="round-button" data-print-plan title="打印今日计划">${icon("printer", 15)}</button><span class="progress-ring" style="--progress:${progress}">${progress}%</span></header>
          <div class="study-task-list">
            ${state.tasks.map((task, index) => `<label class="${task.done ? "done" : ""}"><input type="checkbox" data-task-toggle="${task.id}" ${task.done ? "checked" : ""}><i>${task.done ? icon("check", 12) : index + 1}</i><span><strong>${escapeHtml(task.title)}</strong><small>${escapeHtml(task.time)}</small></span></label>`).join("")}
          </div>
          <form class="mini-add-form" id="study-plan-form"><input name="title" placeholder="添加一个小目标" required><button>${icon("plus", 15)}</button></form>
          <form class="study-ai-plan-form" id="study-ai-plan-form"><textarea name="plan" rows="3" maxlength="1000" placeholder="输入或说出今天要做的事，AI 会整理成 Todo List"></textarea><button class="outline-button">${icon("spark", 14)}AI 整理计划</button></form>
        </article>
      </aside>
    </div>
  </section>`;
}

async function lifeView() {
  const state = companionStore.getState();
  return `<section class="page companion-page life-page" id="life-view">
    ${pageHead("A QUIET LIFE", "生活空间", "写下一点心情，让 AI 帮你整理，但不替你定义今天。")}
    <div class="life-grid">
      <article class="journal-editor companion-card">
        <header class="companion-card-head"><div><i>${icon("journal", 18)}</i><span><h2>今日手帐</h2><small>${new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", weekday: "long" }).format(new Date())}</small></span></div><span class="autosave-label">本地保存</span></header>
        <form id="journal-form">
          <label>今天的心情<div class="mood-picker">${[["calm", "☁", "平静"], ["happy", "☀", "开心"], ["tired", "☾", "有点累"], ["excited", "✦", "期待"]].map(([value, face, label], index) => `<span><input type="radio" name="mood" value="${value}" ${index === 0 ? "checked" : ""}><i>${face}</i><b>${label}</b></span>`).join("")}</div></label>
          <label>标题<input name="title" placeholder="给今天一个小标题" required></label>
          <label>写下今天<textarea name="body" rows="8" placeholder="发生了什么？哪一个瞬间想被记住？" required></textarea></label>
          <div class="journal-actions"><button type="button" class="outline-button" data-journal-summary>${icon("spark", 15)}AI 帮我总结</button>${ui.journalSummary ? `<button type="button" class="outline-button" data-print-journal>${icon("printer", 15)}打印总结</button>` : ""}<button class="primary-button" type="submit">保存手帐</button></div>
          <div class="journal-summary ${ui.journalSummary ? "ready" : ""}" id="journal-summary">${escapeHtml(ui.journalSummary || "AI 总结会显示在这里，你可以确认后再保存。")}</div>
        </form>
      </article>
      <aside class="journal-history">
        <div class="section-head"><div><p class="eyebrow">RECENT PAGES</p><h2>最近记录</h2></div></div>
        ${state.journal.map((entry) => `<article class="journal-entry"><span class="mood-${escapeHtml(entry.mood)}">${{ calm: "☁", happy: "☀", tired: "☾", excited: "✦" }[entry.mood] ?? "·"}</span><div><small>${escapeHtml(entry.date)}</small><h3>${escapeHtml(entry.title)}</h3><p>${escapeHtml(entry.body)}</p><b>${escapeHtml(entry.summary ?? "")}</b></div></article>`).join("")}
      </aside>
      <article class="fortune-card companion-card">
        <div class="fortune-orbit"><i></i><i></i><span>✦</span></div>
        <div class="fortune-copy"><p class="eyebrow">JUST FOR FUN</p><h2>今日趣味预测</h2><p>它不是占卜建议，只是一张根据你的问题生成的轻松小卡片。</p>
          <form id="fortune-form"><input name="birthday" type="date" aria-label="生日" required><input name="question" placeholder="最近在意什么？" required><button class="primary-button">抽一张小卡</button>${ui.fortuneResult ? `<button type="button" class="outline-button" data-print-fortune>${icon("printer", 15)}打印小卡</button>` : ""}</form>
        </div>
        <div class="fortune-result" id="fortune-result">${ui.fortuneResult ? `<small>YOUR CARD</small><h3>${escapeHtml(ui.fortuneResult.title)}</h3><p>${escapeHtml(ui.fortuneResult.reading)}</p><b>${escapeHtml(ui.fortuneResult.disclaimer)}</b>` : `<span>?</span><p>答案不会替你做决定，<br>但也许会给今天一个新角度。</p>`}</div>
      </article>
    </div>
  </section>`;
}

function scoreRing(score) {
  return `<span class="score-ring" style="--score:${score}"><strong>${score}%</strong><small>MATCH</small></span>`;
}

function preferenceAdjustedMatch(match) {
  const selected = new Set(ui.matchPreferences);
  const interests = match.user.interests ?? [];
  const skills = match.user.skills ?? [];
  const hits = [...new Set([...interests, ...skills].filter((item) => selected.has(item)))];
  if (!selected.size) return { ...match, preferenceHits: hits };
  const missPenalty = Math.max(0, selected.size - hits.length) * 4;
  const score = Math.max(45, Math.min(99, match.score + hits.length * 5 - missPenalty));
  return { ...match, score, preferenceHits: hits };
}

function matchPreferencePanel() {
  const completed = Boolean(ui.matchProfile.completedAt);
  const interests = ui.matchPreferences.length ? ui.matchPreferences : ["还没有选择"];
  return `<article class="match-preference-entry ${completed ? "completed" : ""}">
    <div class="preference-entry-art" aria-hidden="true">
      <span>${MATCH_INTEREST_META[ui.matchPreferences[0]]?.[0] ?? "✦"}</span>
      <i></i><i></i><i></i>
    </div>
    <div class="preference-entry-copy">
      <p class="eyebrow">${completed ? "YOUR MATCH PROFILE" : "A TINY QUESTIONNAIRE"}</p>
      <h2>${completed ? "你的偏好，随时可以改变" : "先认识一下你的兴趣宇宙"}</h2>
      <p>${completed ? "新的选择会立即参与匹配排序，不需要重新注册。" : "只需要点选，不用填写长表格，大约 1 分钟完成。"}</p>
      <div class="preference-summary-chips">${interests.slice(0, 6).map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</div>
    </div>
    <button type="button" class="primary-button" data-nav="/match/preferences">${completed ? "调整偏好" : "开始选择"}${icon("arrow", 16)}</button>
  </article>`;
}

async function matchView() {
  const data = await api.matches();
  const matches = data.items.map(preferenceAdjustedMatch).sort((left, right) => right.score - left.score || (right.preferenceHits?.length ?? 0) - (left.preferenceHits?.length ?? 0));
  return `<section class="page match-page" id="match-view">
    ${pageHead("FIND YOUR PEOPLE", "遇见可能聊得来的人", "看看今天想和谁写一封信。", `<button class="outline-button match-head-preference" data-nav="/match/preferences">${icon("settings", 16)}偏好</button>`)}
    ${matchPreferencePanel()}
    <div class="match-grid">
      ${matches.map((match) => `<article class="match-card" data-match-card="${match.user.id}">
        <div class="match-card-art art-${match.user.id.split("-").at(-1)}"><span class="country-code">${match.user.countryCode}</span>${avatar(match.user, "hero")}<i></i><i></i></div>
        <div class="match-card-body">
          <div class="match-person"><div><h2>${escapeHtml(match.user.displayName)}</h2><p>@${escapeHtml(match.user.handle)} · ${escapeHtml(match.user.city)}, ${escapeHtml(match.user.country)}</p></div>${scoreRing(match.score)}</div>
          <p class="match-bio">${escapeHtml(match.user.bio)}</p>
          ${tagList(match.user.interests, 4)}
          <div class="match-actions"><button class="primary-button" data-write-to="${match.user.id}">${icon("letter", 16)}写一封信</button><button class="outline-button" data-follow-user="${match.user.id}">${match.followed ? "已关注" : "关注"}</button><button class="round-button" data-pass-user="${match.user.id}" title="暂不感兴趣">${icon("close", 16)}</button></div>
        </div>
      </article>`).join("")}
    </div>
  </section>`;
}

function matchPreferenceValue(step) {
  return step.multiple ? ui.matchPreferences : ui.matchProfile[step.key];
}

function matchPreferenceQuizView() {
  const stepIndex = Math.max(0, Math.min(MATCH_QUIZ_STEPS.length - 1, ui.matchQuizStep));
  const step = MATCH_QUIZ_STEPS[stepIndex];
  const value = matchPreferenceValue(step);
  const selected = new Set(Array.isArray(value) ? value : value ? [value] : []);
  const selectedInterests = ui.matchPreferences.length ? ui.matchPreferences : ["等待你的选择"];
  return `<section class="page match-preference-page">
    <button class="quiz-back-link" type="button" data-nav="/match">${icon("arrow", 15)}返回匹配</button>
    <div class="match-quiz-shell">
      <aside class="match-quiz-visual">
        <div class="quiz-constellation" aria-hidden="true">
          <span class="quiz-heart">✦</span>
          ${selectedInterests.slice(0, 6).map((item, index) => `<i style="--i:${index}">${escapeHtml(item)}</i>`).join("")}
        </div>
        <div>
          <p class="eyebrow">AI HUB MATCH</p>
          <h2>把喜欢的事，<br>变成认识彼此的开始。</h2>
          <p>这里没有考试，也没有标准答案。你每次改变兴趣，推荐都会跟着更新。</p>
        </div>
      </aside>
      <article class="match-quiz-card">
        <header class="quiz-progress">
          <span>STEP ${stepIndex + 1} / ${MATCH_QUIZ_STEPS.length}</span>
          <div>${MATCH_QUIZ_STEPS.map((_, index) => `<i class="${index <= stepIndex ? "active" : ""}"></i>`).join("")}</div>
        </header>
        <div class="quiz-question">
          <p class="eyebrow">${step.eyebrow}</p>
          <h1>${step.title}</h1>
          <p>${step.hint}</p>
        </div>
        <div class="quiz-options ${step.multiple ? "interest-options" : ""}">
          ${step.options.map((option) => `<button type="button" data-quiz-option="${escapeHtml(option.value)}" class="${selected.has(option.value) ? "selected" : ""}">
            <span>${escapeHtml(option.icon)}</span>
            <b>${escapeHtml(option.value)}</b>
            <small>${escapeHtml(option.detail)}</small>
            <i>${icon("check", 13)}</i>
          </button>`).join("")}
        </div>
        <footer class="quiz-footer">
          <button type="button" class="text-button" data-quiz-previous ${stepIndex === 0 ? "disabled" : ""}>上一步</button>
          <small>${step.multiple ? `已选择 ${selected.size} 项` : selected.size ? "很好，就选这个" : "请选择一项"}</small>
          <button type="button" class="primary-button" data-quiz-next>${stepIndex === MATCH_QUIZ_STEPS.length - 1 ? "完成并开始匹配" : "继续"}${icon("arrow", 15)}</button>
        </footer>
      </article>
    </div>
  </section>`;
}

const letterStatus = {
  DRAFT: ["草稿", "neutral"], SENT: ["已发送", "blue"], DELIVERING: ["正在送达", "blue"],
  RECEIVED: ["已收到", "green"], PRINTING: ["正在打印", "amber"], PRINTED: ["已打印", "green"],
  PRINT_FAILED: ["打印失败", "red"], PRINT_SKIPPED: ["未自动打印", "neutral"]
};

function letterCard(letter) {
  const [label, tone] = letterStatus[letter.status] ?? [letter.status, "neutral"];
  return `<button class="letter-row ${ui.selectedLetterId === letter.id ? "active" : ""}" data-letter-id="${letter.id}">
    ${avatar(letter.counterpart)}
    <span class="letter-row-copy"><span><strong>${escapeHtml(letter.counterpart.displayName)}</strong><i class="status-pill ${tone}">${label}</i></span><b>${escapeHtml(letter.subject)}</b><small>${escapeHtml(letter.body).replaceAll("\n", " ").slice(0, 60)}…</small></span>
    <time>${formatTime(letter.createdAt)}</time>${letter.unread ? '<i class="unread-dot"></i>' : ""}
  </button>`;
}

function letterDetail(letter) {
  if (!letter) return `<div class="letter-detail-empty"><span>${icon("letter", 28)}</span><h3>选择一封信</h3><p>数字送达与实体打印状态会显示在这里。</p></div>`;
  const assets = Array.isArray(letter.assets) ? letter.assets : [];
  const steps = [
    ["SENT", "已发送", true],
    ["RECEIVED", "数字送达", ["RECEIVED", "PRINTING", "PRINTED"].includes(letter.status)],
    ["PRINTING", "设备打印", ["PRINTING", "PRINTED"].includes(letter.status)],
    ["PRINTED", "实体信件", letter.status === "PRINTED"]
  ];
  return `<article class="letter-detail">
    <header><div>${avatar(letter.counterpart, "large")}<span><p class="eyebrow">${letter.direction === "sent" ? "TO" : "FROM"}</p><h2>${escapeHtml(letter.counterpart.displayName)}</h2><small>${escapeHtml(letter.counterpart.city)}, ${escapeHtml(letter.counterpart.country)}</small></span></div><button class="round-button">${icon("more", 18)}</button></header>
    <div class="delivery-timeline">${steps.map(([key, label, done], index) => `<span class="${done ? "done" : ""}"><i>${done ? icon("check", 12) : index + 1}</i><small>${label}</small></span>${index < 3 ? "<b></b>" : ""}`).join("")}</div>
    <div class="letter-paper"><span class="letter-paper-head">AI HUB LETTER / ${new Date(letter.createdAt).toLocaleDateString("zh-CN")}</span><h1>${escapeHtml(letter.subject)}</h1>${assets[0] ? `<img class="letter-paper-photo" src="${assets[0].processed.previewDataUrl}" alt="Letter 附图热敏预览">` : ""}<pre>${escapeHtml(letter.body)}</pre><span class="paper-end">· · · · · · · · · · ·</span></div>
    <footer><button class="outline-button" data-report-letter="${letter.id}">${icon("flag", 15)}举报</button><div><button class="outline-button" data-reply-letter="${letter.counterpart.id}">回复</button>${letter.printJob && letter.printJob.status !== "SUCCESS" ? `<button class="primary-button" data-print-letter="${letter.id}" data-print-job="${letter.printJob.id}">${icon("printer", 16)}发送到设备</button>` : ""}</div></footer>
  </article>`;
}

async function letterView() {
  const boxes = ["inbox", "sent", "draft", "print"];
  const results = await Promise.all(boxes.map((box) => api.letters(box)));
  const boxData = Object.fromEntries(boxes.map((box, index) => [box, results[index]]));
  const data = boxData[ui.letterBox] ?? boxData.inbox;
  if (!ui.selectedLetterId && data.items.length) ui.selectedLetterId = data.items[0].id;
  const selected = data.items.find((item) => item.id === ui.selectedLetterId) ?? data.items[0];
  return `<section class="page letters-page" id="letter-view">
    ${pageHead("LETTERS", "我的信件", "慢一点表达，让一封数字信最终成为真实纸张。", `<button class="primary-button" data-nav="/letter/create">${icon("edit", 16)}写一封信</button>`)}
    <div class="letter-tabs">
      ${[["inbox", "收件箱"], ["sent", "已发送"], ["draft", "草稿"], ["print", "打印状态"]].map(([box, label]) => {
        const count = boxData[box]?.items?.length ?? 0;
        return `<button data-letter-box="${box}" class="${ui.letterBox === box ? "active" : ""}">${label}${count ? `<i>${count}</i>` : ""}</button>`;
      }).join("")}
    </div>
    <div class="letter-layout">
      <div class="letter-list"><div class="letter-list-head"><span>${data.items.length} 封信</span><button>${icon("search", 16)}</button></div>${data.items.length ? data.items.map(letterCard).join("") : `<div class="empty-list">这里还没有信。</div>`}</div>
      <div class="letter-detail-wrap" id="letter-detail-wrap">${letterDetail(selected)}</div>
    </div>
  </section>`;
}

async function letterCreateView() {
  const matchData = await api.matches();
  const recipientId = sessionStorage.getItem("aihub-recipient") ?? matchData.items[0]?.user.id;
  const recipient = matchData.items.find((item) => item.user.id === recipientId)?.user ?? matchData.items[0]?.user;
  const initialPreview = await api.previewLetterPrint({
    subject: "你的主题",
    body: "信件内容会在这里预览。\n写下想被认真保存的一段话。",
    sender: "林安",
    recipient: recipient.displayName,
    letterId: "PREVIEW",
    ...(ui.letterAttachment ? {
      attachmentImageDataUrl: ui.letterAttachment.processed.previewDataUrl,
      attachmentWidth: ui.letterAttachment.processed.width,
      attachmentHeight: ui.letterAttachment.processed.height,
      attachmentCaption: ui.letterAttachment.title
    } : {})
  });
  return `<section class="page letter-compose-page" id="letter-create-view">
    ${pageHead("WRITE SLOWLY", "写一封信", "AI 可以帮助组织表达，但事实、语气与发送决定都属于你。")}
    <div class="letter-compose-layout">
      <form class="letter-editor" id="letter-form">
        <div class="letter-recipient">
          <label>写给谁<select name="recipientId">${matchData.items.map((item) => `<option value="${escapeHtml(item.user.id)}" data-avatar="${escapeHtml(item.user.avatar ?? item.user.displayName?.slice(0, 1))}" data-avatar-tone="${avatarTone(item.user.id)}" ${item.user.id === recipient.id ? "selected" : ""}>${escapeHtml(item.user.displayName)} · ${escapeHtml(item.user.city)}</option>`).join("")}</select></label>
          <span>${avatar(recipient, "letter-recipient-avatar")}<i>预计数字送达：即时<br>实体打印：依据对方设置</i></span>
        </div>
        <label>主题<input name="subject" maxlength="200" placeholder="例如：夏夜与最近的生活" required></label>
        <label>正文<textarea name="body" rows="13" placeholder="见字如面……" required></textarea></label>
        <div class="letter-photo-uploader">
          <label class="outline-button">${icon("camera", 15)}上传照片<input id="letter-photo-input" type="file" accept="image/*"></label>
          <div id="letter-photo-preview">${ui.letterAttachment ? `<figure><img src="${ui.letterAttachment.processed.previewDataUrl}" alt="信件附图热敏预览"><button type="button" class="text-button" data-remove-letter-photo>移除照片</button></figure>` : ""}</div>
        </div>
        <div class="ai-toolbar"><span>${icon("spark", 17)}AI 辅助</span><button type="button" data-ai-letter="generate">生成草稿</button><button type="button" data-ai-letter="polish">温和润色</button></div>
        <div class="letter-editor-footer"><button class="ghost-button" type="submit" name="intent" value="draft">保存草稿</button><button class="primary-button" type="submit" name="intent" value="send">确认并发送 ${icon("arrow", 16)}</button></div>
      </form>
      <aside class="paper-preview-panel">
        <div class="preview-controls"><span><p class="eyebrow">PRINT PREVIEW</p><strong>Warm Mono · 58mm</strong></span><button>${icon("settings", 16)}</button></div>
        <div class="compose-paper thermal-preview"><img id="letter-template-image" src="${initialPreview.previewDataUrl}" alt="384 像素热敏纸信件预览"></div>
        <p class="page-estimate" id="letter-page-estimate">${icon("printer", 15)}384 px · ${initialPreview.pageCount} 页 · 对方可选择仅数字接收</p>
      </aside>
    </div>
  </section>`;
}

function printJobRow(job) {
  const label = {
    SUCCESS: "打印成功", WAITING_DEVICE: "等待设备", DISPATCHED: "已下发",
    PRINTING: "正在打印", FAILED_RETRYABLE: "等待重试", CANCELLED: "已取消"
  }[job.status] ?? job.status;
  return `<div class="print-job-row"><i class="${job.status.toLowerCase()}">${icon("printer", 16)}</i><span><strong>${escapeHtml(job.title)}</strong><small>${formatTime(job.createdAt)} · ${job.format}</small></span><b>${label}</b><button class="round-button">${icon("more", 15)}</button></div>`;
}

async function deviceView() {
  const [devices, jobs] = await Promise.all([api.devices(), api.printJobs()]);
  const current = devices.items[0];
  return `<section class="page device-page" id="device-view">
    ${pageHead("HARDWARE", "设备中心", "管理 Letter 自动打印、设备状态和耗材安全。", `<button class="outline-button" data-open-simulator>${icon("device", 16)}打开模拟器</button>`)}
    <article class="device-hero">
      <div class="device-stage"><span class="device-online"><i></i>${ui.simulatorConnected ? "Simulator Live" : current.status}</span><div class="device-large"><span></span><div><i></i><i></i><b></b></div></div><span class="device-shadow"></span></div>
      <div class="device-overview">
        <div class="device-title"><div><p class="eyebrow">YOUR DEVICE</p><h2>${escapeHtml(current.displayName)}</h2><span>${escapeHtml(current.model)} · FW ${escapeHtml(current.firmwareVersion)}</span></div><button class="round-button">${icon("settings", 17)}</button></div>
        <div class="telemetry">
          <span>${icon("battery", 20)}<i><strong>${current.battery}%</strong><small>${current.charging ? "USB-C 充电中" : "Battery"}</small></i></span>
          <span>${icon("wifi", 20)}<i><strong>${escapeHtml(current.wifi)}</strong><small>${current.freshness}</small></i></span>
          <span>${icon("printer", 20)}<i><strong>${escapeHtml(current.printer.status)}</strong><small>纸张 ${escapeHtml(current.printer.paper)}</small></i></span>
        </div>
        <div class="printer-safety"><span><i class="ready-dot"></i><strong>打印机可以接收任务</strong><small>${current.printer.temperatureC}°C · 58mm thermal</small></span></div>
      </div>
    </article>
    <div class="device-content-grid">
      <article class="settings-card">
        <div class="card-head"><div><p class="eyebrow">AUTO PRINT POLICY</p><h2>Letter 自动打印</h2></div><label class="switch"><input id="print-paused" type="checkbox" ${current.printPolicy.paused ? "checked" : ""}><span></span></label></div>
        <div class="policy-options">
          ${[["OFF", "关闭", "所有信件仅数字接收"], ["CONFIRM_ALL", "每次确认", "预览后手动打印"], ["FRIENDS", "仅朋友", "已接受的朋友可以自动打印"], ["ALLOWLIST", "指定联系人", "只允许你选择的人"]].map(([value, title, detail]) => `<label><input type="radio" name="policyMode" value="${value}" ${current.printPolicy.mode === value ? "checked" : ""}><span><i></i><b>${title}</b><small>${detail}</small></span></label>`).join("")}
        </div>
        <div class="policy-fields"><label>安静时段<span><input name="quietStart" value="${current.printPolicy.quietHours.start}">—<input name="quietEnd" value="${current.printPolicy.quietHours.end}"></span></label><label>每日上限<span><input name="dailyLimit" type="number" value="${current.printPolicy.dailyJobLimit}">封信</span></label></div>
        <p class="policy-note">${icon("shield", 16)}陌生人的首封 Letter 永远不会自动打印。暂停后，数字信件仍可正常收到。</p>
        <button class="outline-button full" data-save-policy data-device-id="${current.id}" data-version="${current.printPolicy.version}">保存打印策略</button>
      </article>
      <article class="print-queue-card">
        <div class="card-head"><div><p class="eyebrow">PRINT QUEUE</p><h2>最近打印</h2></div><span>${jobs.items.length} jobs</span></div>
        <div class="print-job-list">${jobs.items.map(printJobRow).join("")}</div>
        <button class="text-button" data-nav="/letter">查看 Letter 时间线 ${icon("arrow", 14)}</button>
      </article>
    </div>
  </section>`;
}

function memoryPhotoCard(photo) {
  const sourceLabel = photo.source === "hardware" ? "硬件自动上传" : "相册上传";
  return `<article class="memory-photo-card">
    <img src="${photo.processed.previewDataUrl}" alt="${escapeHtml(photo.title)} 的热敏像素预览">
    <div><strong>${escapeHtml(photo.title)}</strong><span>${sourceLabel} · ${formatTime(photo.createdAt)}</span><small>${photo.processed.width}×${photo.processed.height} · ${escapeHtml(photo.processed.processor)}</small></div>
  </article>`;
}

async function profileView() {
  const [user, postData, photos, voiceData] = await Promise.all([api.me(), api.posts({ query: "" }), api.photos(), api.voiceBootstrap()]);
  const ownPosts = postData.items.filter((post) => post.author.id === user.id);
  return `<section class="page profile-page" id="profile-view">
    <article class="profile-hero">
      <div class="profile-pattern"><span>AI</span><span>MAKE</span><span>CONNECT</span></div>
      <div class="profile-main">${avatar(user, "profile-avatar")}<div><p>@${escapeHtml(user.handle)}</p><h1>${escapeHtml(user.displayName)}</h1><span>${escapeHtml(user.city)}, ${escapeHtml(user.country)} · ${user.languages.map(escapeHtml).join(" / ")}</span></div><button class="outline-button">${icon("edit", 15)}编辑资料</button></div>
      <p class="profile-bio">${escapeHtml(user.bio)}</p>
      <div class="profile-meta"><span><strong>${user.posts}</strong>发布</span><span><strong>${user.followers}</strong>关注者</span><span><strong>${user.following}</strong>正在关注</span></div>
    </article>
    <div class="profile-grid">
      <aside>
        <article class="profile-info-card"><p class="eyebrow">INTERESTS</p><h3>兴趣</h3>${tagList(user.interests, 8)}<p class="eyebrow spaced">SKILLS</p><h3>技能</h3>${tagList(user.skills, 8)}</article>
        <article class="profile-device-card">${voiceData.device.id
          ? deviceMini(voiceData.device)
          : `<div class="profile-device-empty">${icon("device", 20)}<strong>尚未绑定设备</strong><button type="button" data-nav="/device">前往设备管理</button></div>`}<p>${icon("shield", 15)}只公开设备型号，不公开设备 ID 和在线地址。</p></article>
      </aside>
      <main>
        <article class="memory-album">
          <div class="card-head"><div><p class="eyebrow">MEMORY ALBUM</p><h2>回忆相册</h2></div><label class="outline-button">${icon("camera", 15)}上传照片<input id="memory-photo-input" type="file" accept="image/*"></label></div>
          <div class="memory-photo-grid">${photos.items.map(memoryPhotoCard).join("")}</div>
        </article>
        <div class="profile-tabs"><button class="active">发布</button><button>项目</button><button>Agent</button><button>Letter 分享</button></div>${ownPosts.map((post) => postCard(post)).join("")}<div class="profile-empty"><span>更多作品正在路上。</span></div>
      </main>
    </div>
  </section>`;
}

async function adminView() {
  const [postsData, lettersData, jobs] = await Promise.all([api.posts(), api.letters("inbox"), api.printJobs()]);
  return `<section class="page admin-page" id="admin-view">
    ${pageHead("OPERATIONS", "Admin Console", "管理社区安全、Letter 元数据和设备打印任务。")}
    <div class="admin-alert">${icon("shield", 19)}<p><strong>隐私最小化模式</strong><br>管理员默认只能看到 Letter 元数据；查看正文必须使用单独权限并填写原因。</p></div>
    <div class="admin-stats"><span><i>${icon("profile", 19)}</i><b>1.0M</b><small>注册用户 · 容量基线</small></span><span><i>${icon("community", 19)}</i><b>${postsData.items.length}</b><small>演示帖子</small></span><span><i>${icon("letter", 19)}</i><b>${lettersData.items.length}</b><small>收件箱</small></span><span><i>${icon("printer", 19)}</i><b>${jobs.items.filter((job) => job.status !== "SUCCESS").length}</b><small>待处理打印</small></span></div>
    <div class="admin-table-card"><div class="card-head"><div><p class="eyebrow">PRINT OPERATIONS</p><h2>打印任务</h2></div><button class="outline-button">导出元数据</button></div><div class="admin-table"><div class="admin-table-head"><span>任务</span><span>Letter</span><span>设备</span><span>状态</span><span>时间</span></div>${jobs.items.map((job) => `<div><span>${escapeHtml(job.id.slice(0, 16))}</span><span>${escapeHtml(job.title)}</span><span>${escapeHtml(job.deviceId)}</span><span><i class="status-pill ${job.status === "SUCCESS" ? "green" : "amber"}">${job.status}</i></span><span>${formatTime(job.createdAt)}</span></div>`).join("")}</div></div>
  </section>`;
}

const VOICE_STATE_COPY = {
  off: ["语音已关闭", "打开语音总控后，我会在这里等你。"],
  idle: ["待机", "准备好了，随时可以开始说话。"],
  listening: ["聆听中", "我正在认真听你说。"],
  recognizing: ["识别中", "正在把声音变成文字。"],
  thinking: ["思考中", "正在理解你的意图。"],
  executing: ["执行中", "正在调用系统或设备能力。"],
  completed: ["已完成", "这轮操作已经完成。"],
  error: ["执行失败", "没有关系，可以再试一次。"],
  offline: ["设备离线", "AI 对话仍可使用，硬件操作会暂停。"]
};

const VOICE_EXAMPLES = [
  "打印刚才的对话",
  "帮我写一封信并打印",
  "打印系统刚才的回答",
  "拍一张照片",
  "打开设备状态",
  "调高音量",
  "把屏幕亮度调低一点",
  "进入聊天模式",
  "退出聊天模式",
  "重新打印上一条内容"
];

function voiceAssistantFace(state = "off") {
  return `<div class="unified-assistant assistant-state-${state}" aria-hidden="true">
    <div class="assistant-aura"></div>
    <div class="assistant-antenna"><i></i></div>
    <div class="assistant-shell">
      <div class="assistant-face">
        <i class="assistant-brow left"></i><i class="assistant-brow right"></i>
        <span class="assistant-eye left"></span><span class="assistant-eye right"></span>
        <b class="assistant-mouth"></b>
        <div class="assistant-thought"><i></i><i></i><i></i></div>
      </div>
      <div class="assistant-signal">${Array.from({ length: 7 }, (_, index) => `<i style="--bar:${index}"></i>`).join("")}</div>
    </div>
    <div class="assistant-shadow"></div>
  </div>`;
}

function printStatusLabel(status) {
  return {
    WAITING: "等待打印", SENDING: "正在发送", PRINTING: "正在打印",
    SUCCESS: "打印成功", FAILED: "打印失败", NOT_PRINTED: "未打印"
  }[status] ?? status ?? "未打印";
}

function conversationActions(conversation, compact = false) {
  if (!conversation) return "";
  return `<div class="conversation-print-actions ${compact ? "compact" : ""}">
    <button type="button" data-print-conversation="${conversation.id}" data-print-target="user">${icon("printer", 14)}打印我的话</button>
    <button type="button" data-print-conversation="${conversation.id}" data-print-target="assistant">${icon("printer", 14)}打印 AI 回复</button>
    <button type="button" data-print-conversation="${conversation.id}" data-print-target="result">${icon("printer", 14)}打印执行结果</button>
    <button type="button" class="primary-button" data-print-conversation="${conversation.id}" data-print-target="full">${icon("printer", 15)}打印完整对话</button>
  </div>`;
}

function conversationCard(conversation, { active = false } = {}) {
  return `<article class="voice-conversation-card ${active ? "active" : ""}">
    <header><span><i>${conversation.source === "microphone" ? icon("mic", 14) : icon("edit", 14)}</i><b>${escapeHtml(conversation.intent)}</b></span><time>${formatTime(conversation.createdAt)}</time></header>
    <div class="conversation-message user"><small>你说</small><p>${escapeHtml(conversation.userText)}</p></div>
    <div class="conversation-message assistant"><small>AI HUB</small><p>${escapeHtml(conversation.assistantText)}</p></div>
    <div class="conversation-execution ${conversation.executionResult?.status?.toLowerCase() ?? ""}">${icon(conversation.executionResult?.status === "FAILED" ? "close" : "check", 14)}<span><b>执行结果</b><small>${escapeHtml(conversation.executionResult?.message ?? "本轮没有设备操作")}</small></span></div>
    ${conversationActions(conversation, true)}
  </article>`;
}

function printJobCard(job) {
  return `<article class="voice-print-job status-${String(job.status).toLowerCase()}">
    <i>${icon("printer", 18)}</i>
    <span><strong>${escapeHtml(job.title)}</strong><small>${escapeHtml(job.target ?? "full")} · ${formatTime(job.createdAt)}</small>${job.error ? `<em>${escapeHtml(job.error)}</em>` : ""}</span>
    <b>${printStatusLabel(job.status)}</b>
    ${["FAILED", "WAITING"].includes(job.status) ? `<button type="button" class="outline-button" data-retry-voice-print="${job.id}">重试</button>` : ""}
  </article>`;
}

async function unifiedControlView() {
  const data = await api.voiceBootstrap();
  applyCurrentUser(data.user);
  ui.voiceEnabled = data.settings.voiceEnabled;
  ui.autoPrint = data.settings.autoPrint;
  ui.autoPrintMode = data.settings.autoPrintMode;
  ui.unifiedDevice = data.device;
  ui.unifiedConversations = data.conversations;
  ui.unifiedCommands = data.commands;
  ui.unifiedPrintJobs = data.printJobs;
  if (!ui.voiceEnabled && !ui.unifiedBusy) ui.voiceState = "off";
  if (ui.voiceEnabled && ui.voiceState === "off") ui.voiceState = "idle";
  const stateCopy = VOICE_STATE_COPY[ui.voiceState] ?? VOICE_STATE_COPY.idle;
  const conversation = ui.unifiedConversation ?? data.conversations[0] ?? null;
  return `<section class="page unified-control-page">
    <header class="control-welcome">
      <div><p class="eyebrow">VOICE COMMAND CENTER</p><h1>${escapeHtml(ui.currentUser.displayName)}，今天想让桌面助手做什么？</h1><p>说话、理解、执行、展示，再由你决定是否打印。</p></div>
      ${!ui.currentUser.emailVerified ? `<div class="verification-banner">${icon("shield", 17)}<span><b>邮箱尚未验证</b><small>验证后可以安全找回账号并接收设备通知。</small></span><button data-request-verification>发送验证邮件</button></div>` : ""}
    </header>
    <article class="voice-command-stage state-${ui.voiceState}">
      <div class="assistant-visual-wrap">
        ${voiceAssistantFace(ui.voiceState)}
        <div class="voice-state-text"><span class="state-dot"></span><h2>${stateCopy[0]}</h2><p>${stateCopy[1]}</p></div>
        <button class="listen-main-button" type="button" data-unified-listen ${!ui.voiceEnabled || ui.unifiedBusy ? "disabled" : ""}>
          ${icon(ui.voiceState === "listening" ? "pause" : "mic", 21)}
          <span>${ui.voiceState === "listening" ? "停止聆听" : ui.voiceEnabled ? "开始聆听" : "请先开启语音"}</span>
        </button>
      </div>
      <div class="voice-live-panel">
        <div class="live-panel-head"><div><p class="eyebrow">LIVE SESSION</p><h2>本轮交互</h2></div><span>${ui.unifiedBusy ? "处理中" : "READY"}</span></div>
        <div class="live-transcript">
          <small>语音识别文字</small>
          <p data-live-transcript>${escapeHtml(ui.unifiedInterim || ui.unifiedTranscript || conversation?.userText || "开始说话后，识别结果会实时显示在这里。")}</p>
        </div>
        <div class="live-response">
          <span>${icon("spark", 16)}</span>
          <div><small>系统回复</small><p>${escapeHtml(conversation?.assistantText || "我会先理解你的意图，再执行设备或打印操作。")}</p></div>
        </div>
        <div class="live-execution ${conversation?.executionResult?.status?.toLowerCase() ?? ""}">
          <span>${icon(conversation?.executionResult?.status === "FAILED" ? "close" : "check", 16)}</span>
          <div><small>指令执行结果</small><p>${escapeHtml(conversation?.executionResult?.message || "等待新的指令。")}</p></div>
        </div>
        ${conversationActions(conversation)}
        <form id="unified-command-form" class="unified-command-form">
          <input name="transcript" maxlength="1500" value="${escapeHtml(ui.unifiedTranscript)}" placeholder="麦克风不可用时，可以在这里输入指令" ${ui.unifiedBusy ? "disabled" : ""} required>
          <button type="submit" class="primary-button" ${ui.unifiedBusy ? "disabled" : ""}>${ui.unifiedBusy ? "处理中…" : "发送"}${icon("arrow", 15)}</button>
        </form>
      </div>
    </article>
    <section class="voice-example-section">
      <div class="section-head"><div><p class="eyebrow">TRY SAYING</p><h2>可以这样对我说</h2></div><div class="auto-print-config"><span>自动打印内容</span><select data-auto-print-mode ${ui.autoPrint ? "" : "disabled"}><option value="assistant" ${ui.autoPrintMode === "assistant" ? "selected" : ""}>只打印系统回复</option><option value="result" ${ui.autoPrintMode === "result" ? "selected" : ""}>只打印执行结果</option><option value="full" ${ui.autoPrintMode === "full" ? "selected" : ""}>打印完整对话</option></select></div></div>
      <div class="voice-example-list">${VOICE_EXAMPLES.map((example) => `<button type="button" data-voice-example="${escapeHtml(example)}" aria-label="${escapeHtml(example)}"><span>${icon("mic", 14)}</span>${escapeHtml(example)}</button>`).join("")}</div>
    </section>
    <div class="control-lower-grid">
      <section><div class="section-head compact"><div><p class="eyebrow">RECENT TALKS</p><h2>最近对话</h2></div><button data-nav="/conversations">查看全部</button></div><div class="recent-control-list">${data.conversations.slice(0, 3).map((item) => conversationCard(item)).join("") || '<div class="control-empty">完成第一轮对话后会显示在这里。</div>'}</div></section>
      <aside>
        <div class="section-head compact"><div><p class="eyebrow">PRINT QUEUE</p><h2>最近打印任务</h2></div><button data-nav="/prints">查看全部</button></div>
        <div class="recent-print-list">${data.printJobs.slice(0, 5).map(printJobCard).join("") || '<div class="control-empty">还没有打印任务。</div>'}</div>
      </aside>
    </div>
  </section>`;
}

async function conversationsView() {
  const data = await api.voiceConversations();
  return `<section class="page records-page">${pageHead("CONVERSATION HISTORY", "对话记录", "这里只展示当前账号产生的语音与文字交互。")}
    <div class="records-toolbar"><span>${icon("shield", 15)}按当前用户隔离</span><b>${data.items.length} 轮对话</b></div>
    <div class="conversation-record-grid">${data.items.map((item) => conversationCard(item)).join("") || '<div class="control-empty large">还没有对话记录，去语音控制中心说第一句话吧。</div>'}</div>
  </section>`;
}

async function printsView() {
  const data = await api.voicePrintJobs();
  return `<section class="page records-page">${pageHead("PRINT HISTORY", "打印记录", "查看等待、发送、打印成功和失败任务；失败任务可以安全重试。")}
    <div class="records-toolbar"><span>${icon("shield", 15)}command_id 防止重复打印</span><b>${data.items.length} 个任务</b></div>
    <div class="print-record-list">${data.items.map(printJobCard).join("") || '<div class="control-empty large">还没有打印任务。</div>'}</div>
  </section>`;
}

async function controlDeviceView() {
  const data = await api.voiceBootstrap();
  ui.unifiedDevice = data.device;
  const current = data.device;
  return `<section class="page control-device-page">${pageHead("DEVICE GATEWAY", "设备管理", "浏览器只连接平台 API；ESP32 地址和长期凭证不会进入前端。")}
    <article class="control-device-hero ${current.status === "ONLINE" ? "online" : "offline"}">
      ${voiceAssistantFace(current.status === "ONLINE" ? "idle" : "offline")}
      <div><p class="eyebrow">ESP32-S3 DESKTOP COMPANION</p><h2>${escapeHtml(current.displayName)}</h2><p>${current.status === "ONLINE" ? "设备在线，可以接收语音指令。" : current.status === "UNBOUND" ? "当前账号还没有绑定设备。" : "设备离线，硬件指令将被禁用。"}</p>
        <div class="device-facts"><span><b>状态</b><small>${escapeHtml(current.status)}</small></span><span><b>网络</b><small>${escapeHtml(current.wifi)}</small></span><span><b>打印机</b><small>${escapeHtml(current.printer.status)}</small></span><span><b>电量</b><small>${current.battery ?? "--"}%</small></span><span><b>音量</b><small>${current.volume ?? "--"}%</small></span><span><b>亮度</b><small>${current.brightness ?? "--"}%</small></span></div>
      </div>
    </article>
    <div class="device-security-note">${icon("shield", 18)}<div><h3>设备连接由 Device Gateway 管理</h3><p>网页不会硬编码局域网 IP，也不会直接连接 MQTT 或打印机。设备离线时不会显示虚假成功状态。</p></div></div>
  </section>`;
}

async function accountView() {
  const data = await api.account();
  applyCurrentUser(data.user);
  return `<section class="page account-page">${pageHead("YOUR ACCOUNT", "账号设置", "管理邮箱、昵称、会话和安全状态。")}
    ${!data.user.emailVerified ? `<div class="verification-banner wide">${icon("shield", 18)}<span><b>邮箱尚未验证</b><small>${escapeHtml(data.user.email)} · 建议现在完成验证。</small></span><button data-request-verification>发送验证邮件</button></div>` : ""}
    <div class="account-grid">
      <form class="account-card" id="account-profile-form"><p class="eyebrow">PROFILE</p><h2>基础资料</h2><label>邮箱<input value="${escapeHtml(data.user.email)}" disabled></label><label>昵称<input name="displayName" maxlength="32" value="${escapeHtml(data.user.displayName)}" required></label><button class="primary-button">保存修改</button></form>
      <article class="account-card security"><p class="eyebrow">SECURITY</p><h2>账号安全</h2><div><span>${icon("shield", 17)}<i><b>邮箱验证</b><small>${data.user.emailVerified ? "已验证" : "待验证"}</small></i></span><span>${icon("device", 17)}<i><b>有效会话</b><small>${data.sessions} 个</small></i></span><span>${icon("clock", 17)}<i><b>登录保护</b><small>短时 Access Token + 可撤销 Refresh Cookie</small></i></span></div><button type="button" class="outline-button" data-logout>退出当前账号</button></article>
      <article class="account-card linked-device"><p class="eyebrow">LINKED DEVICE</p><h2>绑定设备</h2><p>${escapeHtml(data.device.displayName)} · ${escapeHtml(data.device.status)}</p><button type="button" class="outline-button" data-nav="/device">查看设备</button></article>
    </div>
  </section>`;
}

function welcomeView() {
  return `<div class="public-welcome">
    <header><button class="hub-logo" data-nav="/welcome">${logo()}</button><div><button data-nav="/login">登录</button><button class="primary-button" data-nav="/register">免费注册</button></div></header>
    <main><div class="welcome-copy"><p class="eyebrow">VOICE · AI · ESP32 · PRINT</p><h1>说一句话，<br>让桌面设备理解并行动。</h1><p>AI Hub OS 把语音对话、ESP32 硬件和热敏打印统一在一个安全的控制中心里。</p><div><button class="primary-button" data-nav="/register">创建账号${icon("arrow", 16)}</button><button class="outline-button" data-nav="/login">已有账号</button></div></div><div class="welcome-assistant">${voiceAssistantFace("listening")}<span>“打印系统刚才的回答”</span></div></main>
    <section>${[["mic","统一语音控制","从一个入口控制 AI、设备与打印"],["device","ESP32 联动","设备状态与动作结果清晰可见"],["printer","确认后打印","所有实体输出都经过平台任务队列"]].map(([name,title,detail])=>`<article><i>${icon(name,21)}</i><h2>${title}</h2><p>${detail}</p></article>`).join("")}</section>
  </div>`;
}

function authView(type) {
  const login = type === "login";
  const register = type === "register";
  const forgot = type === "forgot-password";
  const reset = type === "reset-password";
  const resetToken = new URLSearchParams(location.search).get("token") ?? "";
  const heading = login ? "欢迎回来。" : register ? "创建你的 AI Hub 账号。" : forgot ? "找回密码。" : "设置新密码。";
  const description = login ? "登录后进入统一语音控制中心。" : register ? "使用邮箱和密码开始连接你的桌面设备。" : forgot ? "输入注册邮箱，我们会发送重置链接。" : "新密码至少 8 位，并同时包含字母和数字。";
  return `<div class="auth-page">
    <section class="auth-story">
      <button class="hub-logo light" data-nav="/welcome">${logo()}</button>
      <div class="auth-story-main">
        <div class="auth-story-device">${voiceAssistantFace("idle")}<span><i></i>VOICE READY</span></div>
        <div class="auth-story-copy"><p class="eyebrow">YOUR DESKTOP, NOW LISTENING</p><h1>一句话，<br>让桌面开始行动。</h1><p>对话、设备控制与热敏打印，现在汇聚在同一个语音入口。</p></div>
        <div class="auth-capability-row"><span>${icon("mic", 16)}语音理解</span><span>${icon("device", 16)}设备控制</span><span>${icon("printer", 16)}确认打印</span></div>
      </div>
      <span>VOICE · AI · ESP32 · PRINT</span>
    </section>
    <section class="auth-form-wrap"><form id="auth-form" data-auth="${type}" novalidate><button class="auth-back" type="button" data-nav="/welcome">${icon("arrow", 15)}返回产品首页</button><p class="eyebrow">${login ? "WELCOME BACK" : register ? "CREATE ACCOUNT" : "ACCOUNT RECOVERY"}</p><h2>${heading}</h2><p>${description}</p>
      ${reset ? `<input type="hidden" name="token" value="${escapeHtml(resetToken)}">` : `<label>邮箱<input name="email" type="email" autocomplete="email" placeholder="name@example.com" required><small data-field-error="email"></small></label>`}
      ${login || register || reset ? `<label>密码<span class="password-field"><input name="password" type="password" autocomplete="${login ? "current-password" : "new-password"}" minlength="8" placeholder="至少 8 位，包含字母和数字" required><button type="button" data-toggle-password aria-label="显示或隐藏密码">${icon("eye", 16)}</button></span><small data-field-error="password"></small></label>` : ""}
      ${register || reset ? `<label>确认密码<span class="password-field"><input name="confirmPassword" type="password" autocomplete="new-password" minlength="8" placeholder="再次输入密码" required><button type="button" data-toggle-password aria-label="显示或隐藏密码">${icon("eye", 16)}</button></span><small data-field-error="confirmPassword"></small></label>` : ""}
      ${register ? `<label class="terms-check"><input name="acceptTerms" type="checkbox"><i>${icon("check", 12)}</i><span>我已阅读并同意<a href="#terms">用户协议</a>和<a href="#privacy">隐私政策</a></span></label><small data-field-error="acceptTerms"></small>` : ""}
      ${login ? `<div class="login-options"><label><input name="remember" type="checkbox">记住我</label><button type="button" data-nav="/forgot-password">忘记密码？</button></div>` : ""}
      <div class="auth-form-error" data-auth-error hidden></div>
      <button class="primary-button full" type="submit">${login ? "登录" : register ? "创建账号" : forgot ? "发送重置邮件" : "重置密码"}${icon("arrow", 16)}</button>
      ${login ? `<div class="demo-account-panel"><span>本地快速体验</span><div>
        ${[
          ["林", "林安", "hello@aihub.local", "Demo1234"],
          ["あ", "Aiko", "aiko@aihub.local", "Aiko1234"],
          ["M", "Mina", "mina@aihub.local", "Mina1234"]
        ].map(([avatar, name, email, password]) => `<button type="button" data-demo-account data-email="${email}" data-password="${password}"><i>${avatar}</i><span><b>${name}</b><small>${email}</small></span></button>`).join("")}
      </div></div>` : ""}
      ${forgot || reset ? '<p class="auth-switch"><button type="button" data-nav="/login">返回登录</button></p>' : `<p class="auth-switch">${login ? "还没有账号？" : "已经有账号？"}<button type="button" data-nav="${login ? "/register" : "/login"}">${login ? "立即注册" : "去登录"}</button></p>`}
    </form></section>
  </div>`;
}

async function render() {
  const version = ++ui.renderVersion;
  const path = currentPath();
  const titles = {
    "/": "语音控制中心", "/welcome": "欢迎", "/conversations": "对话记录", "/prints": "打印记录",
    "/device": "设备管理", "/account": "账号设置", "/login": "登录", "/register": "注册",
    "/forgot-password": "忘记密码", "/reset-password": "重置密码",
    "/community": "社区广场", "/create-post": "发布内容", "/match": "匹配中心",
    "/match/preferences": "匹配偏好", "/letter": "我的信件", "/letter/create": "写信",
    "/profile": "个人主页"
  };
  document.title = `${titles[path] ?? "AI Hub OS"} · AI Hub OS`;

  if (!ui.authChecked) {
    app.innerHTML = loading();
    try {
      const session = await api.session();
      if (session.user) applyCurrentUser(session.user);
      else ui.currentUser = null;
    } catch {
      ui.currentUser = null;
    }
    ui.authChecked = true;
    if (version !== ui.renderVersion) return;
  }

  const publicPaths = new Set(["/welcome", "/login", "/register", "/forgot-password", "/reset-password"]);
  if (!publicPaths.has(path) && !ui.currentUser) {
    sessionStorage.setItem("aihub-return-path", `${location.pathname}${location.search}`);
    history.replaceState({}, "", "/login");
    render();
    return;
  }
  if (ui.currentUser && ["/login", "/register", "/forgot-password", "/reset-password", "/welcome"].includes(path)) {
    history.replaceState({}, "", "/");
    render();
    return;
  }
  if (path === "/welcome") {
    app.innerHTML = welcomeView();
    wire();
    return;
  }
  if (["/login", "/register", "/forgot-password", "/reset-password"].includes(path)) {
    app.innerHTML = authView(path.slice(1));
    wire();
    return;
  }

  app.innerHTML = shell(loading(), path);
  wireNavigation();
  try {
    const views = {
      "/": unifiedControlView,
      "/community": communityView,
      "/create-post": createPostView,
      "/match": matchView,
      "/match/preferences": matchPreferenceQuizView,
      "/letter": letterView,
      "/letter/create": letterCreateView,
      "/profile": profileView,
      "/conversations": conversationsView,
      "/prints": printsView,
      "/device": controlDeviceView,
      "/account": accountView
    };
    const content = await views[path]();
    if (version !== ui.renderVersion) return;
    app.innerHTML = shell(content, path);
    wire();
  } catch (error) {
    if (version !== ui.renderVersion) return;
    const detail = error instanceof ApiProblem ? `${error.code} · ${error.message}` : error.message;
    app.innerHTML = shell(`<div class="fatal-state">${icon("community", 32)}<h1>暂时无法连接社区</h1><p>${escapeHtml(detail)}</p><button class="primary-button" data-retry>重新加载</button></div>`, path);
    wire();
  }
}

function wireNavigation() {
  document.querySelectorAll("[data-nav]").forEach((element) => element.addEventListener("click", () => navigate(element.dataset.nav)));
  const setMobileMenu = (open) => {
    document.querySelector(".mobile-more-sheet")?.classList.toggle("open", open);
    document.querySelector(".mobile-more-backdrop")?.classList.toggle("open", open);
    document.querySelector(".mobile-more-sheet")?.setAttribute("aria-hidden", String(!open));
    document.body.classList.toggle("mobile-menu-open", open);
  };
  document.querySelector("[data-mobile-menu]")?.addEventListener("click", () => setMobileMenu(true));
  document.querySelectorAll("[data-mobile-menu-close]").forEach((element) => element.addEventListener("click", () => setMobileMenu(false)));
}

async function openPost(id) {
  try {
    const post = await api.post(id);
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = `<div class="post-modal"><button class="modal-close" data-close-modal>${icon("close", 18)}</button>${postCard(post, true)}<div class="comment-section"><h3>讨论 · ${post.comments.length}</h3>${post.comments.map((comment) => `<div class="comment-row">${avatar(comment.author)}<div><span><strong>${escapeHtml(comment.author.displayName)}</strong><small>${formatTime(comment.createdAt)}</small></span><p>${escapeHtml(comment.content)}</p></div></div>`).join("")}<form id="comment-form" data-post-id="${id}">${avatar({ id: "usr-lin", avatar: "林" })}<input name="content" placeholder="认真地回应这次分享……" required><button>${icon("arrow", 16)}</button></form></div></div>`;
    document.body.append(overlay);
    overlay.querySelector("[data-close-modal]").addEventListener("click", () => overlay.remove());
    overlay.addEventListener("click", (event) => { if (event.target === overlay) overlay.remove(); });
    overlay.querySelector("#comment-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const content = new FormData(event.currentTarget).get("content");
      await api.comment(id, content);
      overlay.remove();
      toast("评论已发布", "success");
      openPost(id);
    });
  } catch (error) {
    toast(error.message, "error");
  }
}

let letterPreviewTimer;
function previewLetter(form) {
  window.clearTimeout(letterPreviewTimer);
  letterPreviewTimer = window.setTimeout(async () => {
    const image = document.querySelector("#letter-template-image");
    if (!image || !form.isConnected) return;
    const recipient = form.querySelector('[name="recipientId"] option:checked')?.textContent?.split(" · ")[0] ?? "AI Hub Friend";
    try {
      const preview = await api.previewLetterPrint({
        subject: form.querySelector('[name="subject"]')?.value || "你的主题",
        body: form.querySelector('[name="body"]')?.value || "信件内容会在这里预览。",
        sender: "林安",
        recipient,
        letterId: "PREVIEW",
        ...(ui.letterAttachment ? {
          attachmentImageDataUrl: ui.letterAttachment.processed.previewDataUrl,
          attachmentWidth: ui.letterAttachment.processed.width,
          attachmentHeight: ui.letterAttachment.processed.height,
          attachmentCaption: ui.letterAttachment.title
        } : {})
      });
      image.src = preview.previewDataUrl;
      const estimate = document.querySelector("#letter-page-estimate");
      if (estimate) estimate.innerHTML = `${icon("printer", 15)}384 px · ${preview.pageCount} 页${preview.bodyWasClipped ? " · 正文过长已截断" : ""}`;
    } catch (error) {
      toast(`模板预览失败：${error.message}`, "error");
    }
  }, 260);
}

async function aiLetterAction(action) {
  if (action === "translate") {
    toast("翻译功能将在接入大模型后开放", "info");
    return;
  }
  const form = document.querySelector("#letter-form");
  const body = form?.querySelector('[name="body"]');
  const subject = form?.querySelector('[name="subject"]');
  if (!body || !subject) return;
  try {
    const result = await api.aiLetter(action, {
      subject: subject.value,
      body: body.value,
      targetLanguage: "zh-CN"
    });
    if (result.subject) subject.value = result.subject;
    body.value = result.suggestion;
    previewLetter(form);
    toast({ generate: "AI 草稿已生成，请确认事实", polish: "已完成温和润色" }[action], "success");
  } catch (error) {
    toast(error.message, "error");
  }
}

function syncLetterRecipient(form) {
  const select = form?.querySelector('[name="recipientId"]');
  const option = select?.selectedOptions?.[0];
  const avatarElement = form?.querySelector(".letter-recipient-avatar");
  if (!option || !avatarElement) return;

  avatarElement.textContent = option.dataset.avatar || option.textContent?.trim().slice(0, 1) || "友";
  avatarElement.classList.remove("rose", "blue", "mint", "amber", "ink");
  avatarElement.classList.add(option.dataset.avatarTone || "blue");
  sessionStorage.setItem("aihub-recipient", option.value);
  previewLetter(form);
}

function updateLetterAttachmentPreview(form) {
  const wrap = document.querySelector("#letter-photo-preview");
  if (!wrap) return;
  wrap.innerHTML = ui.letterAttachment
    ? `<figure><img src="${ui.letterAttachment.processed.previewDataUrl}" alt="信件附图热敏预览"><button type="button" class="text-button" data-remove-letter-photo>移除照片</button></figure>`
    : "";
  wrap.querySelector("[data-remove-letter-photo]")?.addEventListener("click", () => {
    ui.letterAttachment = null;
    updateLetterAttachmentPreview(form);
    previewLetter(form);
  });
}

async function createAndMaybeSendLetter(form, intent) {
  const values = Object.fromEntries(new FormData(form));
  const recipientName = form.querySelector('[name="recipientId"] option:checked')?.textContent?.split(" · ")[0] ?? "AI Hub Friend";
  const draft = await api.createLetter({
    recipientId: values.recipientId,
    subject: values.subject,
    body: values.body,
    sourceLanguage: "zh-CN",
    assetIds: ui.letterAttachment ? [ui.letterAttachment.id] : [],
    templateId: "warm-mono"
  });
  if (intent === "draft") {
    toast("草稿已保存", "success");
    ui.letterBox = "draft";
    navigate("/letter");
    return;
  }
  const result = await api.sendLetter(draft.id, values.recipientId, draft.version);
  form.dataset.deliveryCommitted = "true";
  ui.activePrintJobId = result.printJob?.id;
  if (result.printJob) {
    void printLetterToDevice({
        id: result.letterId,
        subject: values.subject,
        body: values.body,
        recipientName,
        attachment: ui.letterAttachment
      }, result.printJob.id)
      .then((printResult) => {
        toast(`实体信件打印完成 · ${printResult.batchCount} 页`, "success");
      })
      .catch(() => {
        toast("数字信件已发送，实体打印任务等待重试", "error");
      });
  }
  return { ...result, printQueued: Boolean(result.printJob) };
}

function formatPrinterText(title, content) {
  const cleanTitle = String(title ?? "AI Hub Letter").trim();
  const cleanContent = String(content ?? "").replace(/\r\n?/g, "\n").trim();
  return `AI HUB OS\n${cleanTitle}\n\n${cleanContent}`;
}

function printerLanguage(text) {
  return /[\u3400-\u9fff]/u.test(String(text)) ? "zh" : "en";
}

async function printLetterToDevice(letter, printJobId) {
  await api.updatePrintStatus(printJobId, "DISPATCHED");
  try {
    const result = await api.printLetter({
      subject: letter.subject,
      body: letter.body,
      sender: letter.author?.displayName ?? "林安",
      recipient: letter.recipientName ?? letter.recipient?.displayName ?? "AI Hub Friend",
      date: new Date().toISOString().slice(0, 10),
      letterId: letter.id,
      ...(letter.attachment ? {
        attachmentImageDataUrl: letter.attachment.processed.previewDataUrl,
        attachmentWidth: letter.attachment.processed.width,
        attachmentHeight: letter.attachment.processed.height,
        attachmentCaption: letter.attachment.title
      } : {}),
      jobId: printJobId,
      source: "letter"
    });
    await api.updatePrintStatus(printJobId, "SUCCESS");
    ui.activePrintJobId = null;
    return result;
  } catch (error) {
    await api.updatePrintStatus(printJobId, "FAILED_RETRYABLE").catch(() => {});
    throw error;
  }
}

async function printCompanionContent(title, content, kind) {
  const job = createPrintJob({ title, content, kind });
  companionStore.dispatch({ type: "print.queue", job });
  const templateKind = ["chat", "todo", "word", "story", "note"].includes(kind) ? kind : "note";
  try {
    const result = await api.printContent({ title, content, kind: templateKind, jobId: job.id, source: kind });
    companionStore.dispatch({ type: "print.status", id: job.id, status: "done" });
    toast(`《${title}》已发送到桌面设备 · ${result.pageCount} 页`, "success");
    return result;
  } catch (error) {
    companionStore.dispatch({ type: "print.status", id: job.id, status: "failed" });
    throw error;
  }
}

function stagePrintable(kind, title, content, extra = {}, reply = "内容已经排好版，请确认后打印。") {
  ui.voiceResult = {
    intent: kind === "todo" ? "PRINT_TODAY_PLAN" : kind === "word" ? "PRINT_WORDS" : kind === "chat" ? "PRINT_CONVERSATION" : "CHAT",
    reply,
    provider: ui.aiProvider,
    requiresConfirmation: true,
    printable: { kind, title, content, ...extra }
  };
  render().then(() => document.querySelector(".voice-agent-card")?.scrollIntoView({ behavior: "smooth", block: "start" }));
}

function splitBrowserLetterFinish(value) {
  const text = String(value ?? "").trim();
  const match = text.match(/(?:\bover\b|确认发送信件|发送信件|寄出信件|结束写信|结束)[\s，,。.!！?？;；]*$/iu);
  if (!match) return { finished: false, content: text, keyword: null };
  return {
    finished: true,
    content: text.slice(0, match.index).replace(/[\s，,。.!！?？;；]+$/u, "").trim(),
    keyword: match[0].trim()
  };
}

function appendBrowserLetterContent(value) {
  const text = String(value ?? "").trim();
  if (!text) return false;
  const existing = ui.voiceLetterParts.join("\n");
  const remaining = Math.max(0, 1_200 - existing.length - (existing ? 1 : 0));
  if (remaining <= 0) return false;
  ui.voiceLetterParts.push(text.slice(0, remaining));
  return text.length <= remaining;
}

async function autoSendBrowserVoiceLetter(finishKeyword) {
  const body = ui.voiceLetterParts.join("\n").trim();
  if (!body) {
    ui.voiceResult = { intent: "SEND_LETTER", reply: "还没有听到信件正文，请先说内容，再说“结束”。", provider: "local-rule", warning: "VOICE_LETTER_EMPTY", requiresConfirmation: false };
    toast("请先说出信件正文", "error");
    return null;
  }
  if (!ui.voiceRecipient) {
    ui.voiceResult = { intent: "SEND_LETTER", reply: "还不知道收件人，请重新说“我要给某某写信”。", provider: "local-rule", warning: "VOICE_RECIPIENT_REQUIRED", requiresConfirmation: false };
    toast("请先说出平台联系人昵称", "error");
    return null;
  }

  ui.voiceSending = true;
  ui.voiceResult = { intent: "SEND_LETTER", reply: `识别到“${finishKeyword}”，正在整理并发送。`, provider: "local-rule", requiresConfirmation: false };
  await render();
  const stableKey = ui.voiceLetterSendKey ?? `web-voice-letter-${crypto.randomUUID()}`;
  ui.voiceLetterSendKey = stableKey;
  try {
    const result = await api.sendVoiceLetter({
      sessionId: stableKey,
      recipient: ui.voiceRecipient,
      subject: "来自语音的一封信",
      body,
      source: "web_microphone"
    }, stableKey);
    ui.voiceMode = "default";
    ui.voiceLetterParts = [];
    ui.voiceResult = {
      intent: "LETTER_SENT",
      reply: `信件已发送给${result.recipient?.displayName ?? ui.voiceRecipient}。`,
      provider: result.provider ?? "deepseek",
      requiresConfirmation: false
    };
    showLetterSendResult({
      tone: "success",
      title: "已发送",
      message: `语音信件已经成功发送给${result.recipient?.displayName ?? ui.voiceRecipient}，重复结束词不会重复发送。`,
      detail: result.printJob ? "收件人的实体打印任务已经进入队列。" : "本次只完成数字送达。",
      actionLabel: "查看我的信件",
      onClose: () => { ui.letterBox = "sent"; navigate("/letter"); }
    });
    return result;
  } catch (error) {
    ui.voiceMode = "letter";
    ui.voiceResult = { intent: "SEND_LETTER", reply: `信件尚未发送：${error.message}`, provider: "local-rule", warning: error.code ?? "VOICE_LETTER_SEND_FAILED", requiresConfirmation: false };
    toast(`发送失败：${error.message}`, "error");
    return null;
  } finally {
    ui.voiceSending = false;
  }
}

async function confirmAiPrint(printable = ui.voiceResult?.printable) {
  if (!printable || ui.voicePrinting) return;
  ui.voicePrinting = true;
  const button = document.querySelector("[data-confirm-ai-print]");
  if (button) {
    button.disabled = true;
    button.textContent = "正在打印…";
  }
  try {
    if (printable.kind === "letter") {
      const job = createPrintJob({ title: printable.title, content: printable.content, kind: "letter" });
      companionStore.dispatch({ type: "print.queue", job });
      await api.printLetter({
        subject: printable.subject ?? printable.title,
        body: printable.content,
        sender: "林安",
        recipient: printable.recipient ?? ui.voiceRecipient ?? "收件人",
        date: new Date().toISOString().slice(0, 10),
        letterId: job.id,
        jobId: job.id,
        source: "voice-letter"
      });
      companionStore.dispatch({ type: "print.status", id: job.id, status: "done" });
    } else {
      await printCompanionContent(printable.title, printable.content, printable.kind ?? "note");
    }
    ui.voiceResult = { ...ui.voiceResult, requiresConfirmation: false, reply: "打印任务已经成功发送到设备。" };
    toast("打印任务已确认并发送", "success");
  } catch (error) {
    toast(`打印失败：${error.message}`, "error");
  } finally {
    ui.voicePrinting = false;
    render();
  }
}

async function processVoiceCommand(transcript) {
  const raw = String(transcript ?? "").trim();
  if (!raw || ui.voiceProcessing) return;
  const clipped = raw.length > 1_200;
  const text = clipped ? raw.slice(0, 1_200) : raw;
  const letterMode = String(ui.voiceMode).startsWith("letter");
  const letterFinish = letterMode ? splitBrowserLetterFinish(text) : { finished: false, content: text, keyword: null };
  const pendingPrintable = ui.voiceResult?.requiresConfirmation ? ui.voiceResult.printable : null;
  ui.voiceTranscript = text;
  ui.voiceProcessing = true;
  ui.voiceListening = false;
  document.querySelector(".voice-agent-status h2")?.replaceChildren("AI 正在理解");
  try {
    if (letterMode) {
      const complete = appendBrowserLetterContent(letterFinish.content);
      if (!complete && letterFinish.content) {
        ui.voiceResult = { intent: "LETTER_CONTENT", reply: "内容有点长了，我先帮你整理这一段。说“结束”即可发送。", provider: "local-rule", warning: "VOICE_CONTENT_CLIPPED", requiresConfirmation: false };
      }
      if (letterFinish.finished) {
        await autoSendBrowserVoiceLetter(letterFinish.keyword);
        return;
      }
    }
    const state = companionStore.getState();
    const orchestrationText = letterMode ? ui.voiceLetterParts.join("\n") : text;
    const result = await api.orchestrate(orchestrationText, {
      mode: letterMode ? "letter" : ui.voiceMode,
      recipient: ui.voiceRecipient,
      pendingPrintable,
      tasks: state.tasks,
      words: state.study.words,
      recentConversation: state.messages.slice(-8)
    });
    if (clipped && !result.warning) {
      result.warning = "VOICE_CONTENT_CLIPPED";
      result.reply = "内容有点长了，我先帮你整理这一段。";
    }
    if (result.intent === "CONFIRM_PRINT" && result.executeConfirmedPrint && pendingPrintable) {
      ui.voiceResult = { ...result, printable: pendingPrintable };
      await confirmAiPrint(pendingPrintable);
      return;
    }
    ui.voiceResult = result;
    if (result.intent === "WRITE_LETTER") {
      ui.voiceMode = "letter";
      ui.voiceLetterParts = [];
      ui.voiceLetterSendKey = `web-voice-letter-${crypto.randomUUID()}`;
      result.reply = `${result.reply} 说“over”“发送信件”或“结束”后会自动发送。`;
    } else if (letterMode && result.intent === "LETTER_CONTENT") {
      ui.voiceMode = "letter";
      result.reply = "这一段已经整理好了。可以继续说；说“over”“发送信件”或“结束”即可自动发送。";
      result.requiresConfirmation = false;
    } else if (result.mode) ui.voiceMode = result.mode;
    if (result.recipient) ui.voiceRecipient = result.recipient;
    if (Array.isArray(result.todos) && result.todos.length) {
      companionStore.dispatch({ type: "tasks.replace", tasks: result.todos });
    }
  } catch (error) {
    toast(`AI 暂时无法理解：${error.message}`, "error");
  } finally {
    ui.voiceProcessing = false;
    if (currentPath() === "/") render();
  }
}

function startVoiceRecognition() {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) {
    toast("当前浏览器不支持语音识别，请在输入框中输入指令", "error");
    document.querySelector('#voice-command-form input[name="transcript"]')?.focus();
    return;
  }
  const recognition = new Recognition();
  recognition.lang = "zh-CN";
  recognition.interimResults = true;
  recognition.continuous = false;
  let finalText = "";
  ui.voiceListening = true;
  document.querySelector(".voice-agent-card")?.classList.add("listening");
  document.querySelector(".voice-agent-status h2")?.replaceChildren("聆听中");
  companionStore.dispatch({ type: "device.transition", event: "listen" });
  recognition.addEventListener("result", (event) => {
    let interim = "";
    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const part = event.results[index][0]?.transcript ?? "";
      if (event.results[index].isFinal) finalText += part;
      else interim += part;
    }
    const input = document.querySelector('#voice-command-form input[name="transcript"]');
    if (input) input.value = `${finalText}${interim}`.slice(0, 1_500);
  });
  recognition.addEventListener("error", (event) => {
    ui.voiceListening = false;
    companionStore.dispatch({ type: "device.transition", event: "complete" });
    toast(event.error === "not-allowed" ? "请允许浏览器使用麦克风" : "没有听清，请再试一次", "error");
    render();
  });
  recognition.addEventListener("end", () => {
    ui.voiceListening = false;
    companionStore.dispatch({ type: "device.transition", event: "complete" });
    const transcript = finalText.trim();
    if (transcript) processVoiceCommand(transcript);
    else render();
  });
  recognition.start();
}

async function submitUnifiedCommand(transcript, source = "text") {
  const text = String(transcript ?? "").trim();
  if (!text || ui.unifiedBusy) return;
  ui.unifiedBusy = true;
  ui.unifiedTranscript = text.slice(0, 1_500);
  ui.unifiedInterim = "";
  ui.voiceState = source === "microphone" ? "recognizing" : "thinking";
  await render();
  if (source === "microphone") {
    ui.voiceState = "thinking";
    document.querySelector(".voice-command-stage")?.setAttribute("class", "voice-command-stage state-thinking");
    document.querySelector(".voice-state-text h2")?.replaceChildren("思考中");
  }
  try {
    const result = await api.voiceTurn({
      transcript: ui.unifiedTranscript,
      source,
      commandId: crypto.randomUUID(),
      mode: ui.voiceMode,
      recipient: ui.voiceRecipient,
      pendingPrintable: ui.unifiedConversation?.printable ?? null
    });
    ui.voiceState = result.command.status === "NOT_REQUIRED" ? "completed" : "executing";
    ui.unifiedConversation = result.conversation;
    ui.voiceMode = result.decision.mode ?? ui.voiceMode;
    ui.voiceRecipient = result.decision.recipient ?? ui.voiceRecipient;
    if (result.command.status === "FAILED") {
      ui.voiceState = result.command.result?.code === "DEVICE_OFFLINE" ? "offline" : "error";
    } else {
      ui.voiceState = "completed";
    }
    if (result.automaticPrintJob) {
      toast(result.automaticPrintJob.status === "SUCCESS" ? "自动打印已完成" : "自动打印任务已进入队列", result.automaticPrintJob.status === "FAILED" ? "error" : "success");
    }
  } catch (error) {
    ui.voiceState = error.code === "AUTHENTICATION_REQUIRED" ? "off" : "error";
    toast(error.message || "这次没有处理成功，请再试一次", "error");
  } finally {
    ui.unifiedBusy = false;
    await render();
  }
}

function startUnifiedRecognition() {
  if (ui.unifiedRecognition) {
    ui.unifiedRecognition.stop();
    return;
  }
  if (!ui.voiceEnabled) {
    toast("请先开启语音总控");
    return;
  }
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) {
    ui.voiceState = "error";
    toast("当前浏览器不支持语音识别，请使用下方文字输入", "error");
    render();
    return;
  }
  const recognition = new Recognition();
  recognition.lang = "zh-CN";
  recognition.interimResults = true;
  recognition.continuous = false;
  let finalText = "";
  let latestText = "";
  ui.unifiedRecognition = recognition;
  ui.voiceState = "listening";
  ui.unifiedInterim = "";
  render();
  recognition.addEventListener("result", (event) => {
    let interim = "";
    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const part = event.results[index][0]?.transcript ?? "";
      if (event.results[index].isFinal) finalText += part;
      else interim += part;
    }
    latestText = `${finalText}${interim}`.slice(0, 1_500);
    ui.unifiedInterim = latestText;
    document.querySelector("[data-live-transcript]")?.replaceChildren(ui.unifiedInterim || "我正在听…");
  });
  recognition.addEventListener("error", (event) => {
    ui.unifiedRecognition = null;
    ui.voiceState = "error";
    const message = event.error === "not-allowed"
      ? "麦克风权限被拒绝。请在浏览器地址栏允许麦克风，或使用文字输入。"
      : "这次没有听清，请重新说一次。";
    toast(message, "error");
    render();
  });
  recognition.addEventListener("end", () => {
    ui.unifiedRecognition = null;
    const transcript = (finalText || latestText).trim();
    ui.unifiedInterim = "";
    if (transcript) submitUnifiedCommand(transcript, "microphone");
    else if (ui.voiceState !== "error") {
      ui.voiceState = "idle";
      render();
    }
  });
  try {
    recognition.start();
  } catch {
    ui.unifiedRecognition = null;
    ui.voiceState = "error";
    toast("无法启动麦克风，请检查浏览器权限", "error");
    render();
  }
}

async function createUnifiedPrint(conversationId, target) {
  if (!conversationId || ui.unifiedPrintingId) return;
  const stableId = `voice-print-${conversationId}-${target}`;
  ui.unifiedPrintingId = stableId;
  try {
    const result = await api.createVoicePrintJob(conversationId, target, stableId);
    const status = result.printJob.status;
    toast(status === "SUCCESS" ? "打印成功" : status === "FAILED" ? "打印失败，可以在打印记录中重试" : "打印任务已进入等待队列", status === "FAILED" ? "error" : "success");
    await render();
  } catch (error) {
    toast(error.message, "error");
  } finally {
    ui.unifiedPrintingId = null;
  }
}

async function submitTutor(question) {
  const text = String(question ?? "").trim();
  if (!text) return;
  companionStore.dispatch({ type: "message.add", message: { role: "user", content: text } });
  render();
  try {
    const result = await api.tutor(text, companionStore.getState().messages.slice(-8));
    ui.aiProvider = result.provider ?? ui.aiProvider;
    companionStore.dispatch({ type: "message.add", message: { role: "assistant", content: result.answer } });
  } catch (error) {
    companionStore.dispatch({ type: "message.add", message: { role: "assistant", content: `暂时没有连上学习助手：${error.message}` } });
  }
  render();
}

function wire() {
  wireNavigation();
  document.querySelector("[data-retry]")?.addEventListener("click", render);
  document.querySelector("#unified-command-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const transcript = new FormData(event.currentTarget).get("transcript");
    submitUnifiedCommand(transcript, "text");
  });
  document.querySelector("[data-unified-listen]")?.addEventListener("click", startUnifiedRecognition);
  document.querySelectorAll("[data-voice-example]").forEach((element) => element.addEventListener("click", () => {
    const input = document.querySelector('#unified-command-form input[name="transcript"]');
    if (!input) return;
    input.value = element.dataset.voiceExample;
    input.focus();
  }));
  document.querySelector("[data-global-voice]")?.addEventListener("change", async (event) => {
    const enabled = event.currentTarget.checked;
    event.currentTarget.disabled = true;
    try {
      const result = await api.updateVoiceSettings({ voiceEnabled: enabled });
      ui.voiceEnabled = result.settings.voiceEnabled;
      ui.voiceState = enabled ? "idle" : "off";
      if (!enabled && ui.unifiedRecognition) ui.unifiedRecognition.stop();
      toast(enabled ? "语音总控已开启" : "语音总控已关闭", "success");
      render();
    } catch (error) {
      event.currentTarget.checked = !enabled;
      event.currentTarget.disabled = false;
      toast(error.message, "error");
    }
  });
  document.querySelector("[data-auto-print]")?.addEventListener("change", async (event) => {
    const enabled = event.currentTarget.checked;
    event.currentTarget.disabled = true;
    try {
      const result = await api.updateVoiceSettings({ autoPrint: enabled });
      ui.autoPrint = result.settings.autoPrint;
      toast(enabled ? "自动打印已开启" : "自动打印已关闭", "success");
      render();
    } catch (error) {
      event.currentTarget.checked = !enabled;
      event.currentTarget.disabled = false;
      toast(error.message, "error");
    }
  });
  document.querySelector("[data-auto-print-mode]")?.addEventListener("change", async (event) => {
    try {
      const result = await api.updateVoiceSettings({ autoPrintMode: event.currentTarget.value });
      ui.autoPrintMode = result.settings.autoPrintMode;
      toast("自动打印范围已更新", "success");
    } catch (error) { toast(error.message, "error"); }
  });
  document.querySelectorAll("[data-print-conversation]").forEach((element) => element.addEventListener("click", () => {
    createUnifiedPrint(element.dataset.printConversation, element.dataset.printTarget);
  }));
  document.querySelectorAll("[data-retry-voice-print]").forEach((element) => element.addEventListener("click", async () => {
    if (element.disabled) return;
    element.disabled = true;
    try {
      const result = await api.retryVoicePrintJob(element.dataset.retryVoicePrint);
      toast(result.printJob.status === "SUCCESS" ? "重新打印成功" : "打印机仍离线，任务继续等待", result.printJob.status === "FAILED" ? "error" : "success");
      render();
    } catch (error) {
      element.disabled = false;
      toast(error.message, "error");
    }
  }));
  document.querySelectorAll("[data-request-verification]").forEach((element) => element.addEventListener("click", async () => {
    if (element.disabled) return;
    element.disabled = true;
    try {
      const result = await api.requestEmailVerification();
      if (result.devVerificationToken) {
        const confirmed = await api.confirmEmailVerification(result.devVerificationToken);
        applyCurrentUser(confirmed.user);
        toast("邮箱验证完成", "success");
        render();
      } else {
        toast("验证邮件已发送，请检查邮箱", "success");
        element.disabled = false;
      }
    } catch (error) {
      element.disabled = false;
      toast(error.message, "error");
    }
  }));
  document.querySelector("#account-profile-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.currentTarget.querySelector('button[type="submit"]');
    if (button.disabled) return;
    button.disabled = true;
    try {
      const result = await api.updateAccount(Object.fromEntries(new FormData(event.currentTarget)));
      applyCurrentUser(result.user);
      toast("账号资料已保存", "success");
      render();
    } catch (error) {
      button.disabled = false;
      toast(error.message, "error");
    }
  });
  document.querySelectorAll("[data-logout]").forEach((element) => element.addEventListener("click", async () => {
    if (element.disabled) return;
    element.disabled = true;
    try { await api.logout(); } catch {}
    ui.currentUser = null;
    ui.authChecked = true;
    ui.unifiedDevice = null;
    ui.unifiedConversation = null;
    toast("已经安全退出");
    navigate("/login");
  }));
  document.querySelectorAll("[data-toggle-password]").forEach((element) => element.addEventListener("click", () => {
    const input = element.closest(".password-field")?.querySelector("input");
    if (!input) return;
    input.type = input.type === "password" ? "text" : "password";
  }));
  document.querySelectorAll("[data-demo-account]").forEach((element) => element.addEventListener("click", () => {
    const form = element.closest("#auth-form");
    const email = form?.querySelector('input[name="email"]');
    const password = form?.querySelector('input[name="password"]');
    if (!email || !password) return;
    email.value = element.dataset.email;
    password.value = element.dataset.password;
    password.focus();
    toast(`已填入 ${element.querySelector("b")?.textContent ?? "体验账号"}`);
  }));
  document.querySelector("#auth-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    if (button.disabled || ui.authBusy) return;
    form.querySelectorAll("[data-field-error]").forEach((element) => element.replaceChildren());
    const errorBox = form.querySelector("[data-auth-error]");
    errorBox.hidden = true;
    const values = Object.fromEntries(new FormData(form));
    values.email = String(values.email ?? "").trim().toLowerCase();
    values.acceptTerms = values.acceptTerms === "on";
    values.remember = values.remember === "on";
    const errors = [];
    if (["login", "register", "forgot-password"].includes(form.dataset.auth) && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(values.email)) errors.push(["email", "请输入正确的邮箱地址。"]);
    if (["register", "reset-password"].includes(form.dataset.auth) && (String(values.password).length < 8 || !/[A-Za-z]/u.test(values.password) || !/\d/u.test(values.password))) errors.push(["password", "密码至少 8 位，并包含字母和数字。"]);
    if (["register", "reset-password"].includes(form.dataset.auth) && values.password !== values.confirmPassword) errors.push(["confirmPassword", "两次输入的密码不一致。"]);
    if (form.dataset.auth === "register" && !values.acceptTerms) errors.push(["acceptTerms", "请先同意用户协议和隐私政策。"]);
    if (errors.length) {
      for (const [field, message] of errors) form.querySelector(`[data-field-error="${field}"]`)?.replaceChildren(message);
      return;
    }
    ui.authBusy = true;
    button.disabled = true;
    button.dataset.originalText = button.textContent;
    button.replaceChildren(document.createTextNode("请稍候…"));
    try {
      if (form.dataset.auth === "login") {
        const result = await api.login(values.email, values.password, values.remember);
        applyCurrentUser(result.user);
        ui.authChecked = true;
        const returnPath = sessionStorage.getItem("aihub-return-path") || "/";
        sessionStorage.removeItem("aihub-return-path");
        toast("登录成功", "success");
        navigate(returnPath);
      } else if (form.dataset.auth === "register") {
        const result = await api.register(values);
        applyCurrentUser(result.user);
        ui.authChecked = true;
        toast("注册成功，请完成邮箱验证", "success");
        navigate("/");
      } else if (form.dataset.auth === "forgot-password") {
        const result = await api.forgotPassword(values.email);
        toast(result.message, "success");
        if (result.devResetToken) navigate(`/reset-password?token=${encodeURIComponent(result.devResetToken)}`);
        else {
          errorBox.hidden = false;
          errorBox.classList.add("success");
          errorBox.replaceChildren(document.createTextNode(result.message));
          button.disabled = false;
        }
      } else {
        await api.resetPassword(values.token, values.password, values.confirmPassword);
        toast("密码已重置，请重新登录", "success");
        navigate("/login");
      }
    } catch (error) {
      for (const item of error.problem?.errors ?? []) form.querySelector(`[data-field-error="${item.field}"]`)?.replaceChildren(item.message);
      errorBox.hidden = false;
      errorBox.replaceChildren(document.createTextNode(error.message || "提交失败，请稍后重试。"));
      button.disabled = false;
      button.replaceChildren(document.createTextNode(button.dataset.originalText || "重新提交"));
    } finally {
      ui.authBusy = false;
    }
  });
  document.querySelectorAll("[data-category]").forEach((element) => element.addEventListener("click", () => {
    ui.category = element.dataset.category;
    render();
  }));
  document.querySelectorAll("[data-topic]").forEach((element) => element.addEventListener("click", () => {
    ui.query = element.dataset.topic;
    ui.category = "全部";
    render();
  }));
  document.querySelector("#community-search-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    ui.query = String(new FormData(event.currentTarget).get("query") ?? "");
    render();
  });
  document.querySelectorAll("[data-like-post]").forEach((element) => element.addEventListener("click", async () => {
    try {
      await api.reactToPost(element.dataset.likePost);
      await render();
    } catch (error) { toast(error.message, "error"); }
  }));
  document.querySelectorAll("[data-bookmark-post]").forEach((element) => element.addEventListener("click", async () => {
    try {
      const result = await api.toggleBookmark(element.dataset.bookmarkPost);
      toast(result.active ? "已收藏" : "已取消收藏");
      await render();
    } catch (error) { toast(error.message, "error"); }
  }));
  document.querySelectorAll("[data-open-post]").forEach((element) => element.addEventListener("click", () => openPost(element.dataset.openPost)));
  document.querySelectorAll("[data-share-post]").forEach((element) => element.addEventListener("click", async () => {
    await navigator.clipboard?.writeText(`${location.origin}/community?post=${element.dataset.sharePost}`);
    toast("帖子链接已复制");
  }));

  document.querySelectorAll('.type-picker input[name="type"]').forEach((input) => input.addEventListener("change", () => {
    document.querySelector("#post-type-fields").innerHTML = postTypeFields(input.value);
  }));
  const postTitle = document.querySelector('#post-form input[name="title"]');
  postTitle?.addEventListener("input", () => {
    const counter = document.querySelector(".field-count");
    if (counter) counter.textContent = `${postTitle.value.length} / 200`;
  });
  document.querySelector("#post-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    try {
      await api.createPost({
        type: values.type,
        category: values.type === "PROJECT" ? "创作" : values.type === "AGENT" ? "学习" : values.type === "LETTER_SHARE" ? "交友" : "日常",
        title: values.title, content: values.content,
        tags: String(values.tags ?? "").split(/[,，]/).map((item) => item.trim()).filter(Boolean),
        cover: values.type === "PROJECT" ? "journal" : values.type === "AGENT" ? "reading" : values.type === "LETTER_SHARE" ? "letter" : "community"
      });
      toast("内容已发布到社区", "success");
      ui.category = "全部"; ui.query = "";
      navigate("/community");
    } catch (error) { toast(error.message, "error"); }
  });
  document.querySelector("[data-save-draft]")?.addEventListener("click", () => toast("草稿已保存在当前浏览器"));

  document.querySelector("#tutor-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const question = new FormData(event.currentTarget).get("question");
    await submitTutor(question);
  });
  document.querySelectorAll("[data-tutor-prompt]").forEach((element) => element.addEventListener("click", () => submitTutor(element.dataset.tutorPrompt)));
  document.querySelector("[data-voice-toggle]")?.addEventListener("click", startVoiceRecognition);
  document.querySelector("#voice-command-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    await processVoiceCommand(new FormData(event.currentTarget).get("transcript"));
  });
  document.querySelectorAll("[data-voice-example]").forEach((button) => button.addEventListener("click", () => {
    const input = document.querySelector('#voice-command-form input[name="transcript"]');
    if (input) input.value = button.dataset.voiceExample;
    processVoiceCommand(button.dataset.voiceExample);
  }));
  document.querySelector("[data-confirm-ai-print]")?.addEventListener("click", () => confirmAiPrint());
  document.querySelectorAll("[data-print-message]").forEach((button) => button.addEventListener("click", () => {
    const message = companionStore.getState().messages[Number(button.dataset.printMessage)];
    if (message) stagePrintable("chat", "MIMO 学习对话", message.content, {}, "这条 AI 回复已经适配为 384px 对话卡，请确认后打印。");
  }));
  document.querySelector("[data-clear-chat]")?.addEventListener("click", () => {
    companionStore.dispatch({ type: "messages.clear" });
    render();
  });
  document.querySelector("[data-word-reveal]")?.addEventListener("click", () => {
    ui.wordRevealed = !ui.wordRevealed;
    render();
  });
  document.querySelectorAll("[data-next-word]").forEach((element) => element.addEventListener("click", () => {
    ui.wordRevealed = false;
    companionStore.dispatch({ type: "study.next" });
    render();
  }));
  document.querySelector("[data-speak-word]")?.addEventListener("click", (event) => {
    if ("speechSynthesis" in window) {
      speechSynthesis.cancel();
      speechSynthesis.speak(new SpeechSynthesisUtterance(event.currentTarget.dataset.speakWord));
      toast("正在朗读单词");
    } else {
      toast("当前浏览器不支持语音朗读");
    }
  });
  document.querySelector("[data-print-word]")?.addEventListener("click", () => {
    const state = companionStore.getState();
    const word = state.study.words[state.study.wordIndex % state.study.words.length];
    stagePrintable("word", `单词卡 · ${word.word}`, `${word.word}  ${word.phonetic}\n\n${word.meaning}\n\n例句\n${word.example}`, {}, "单词卡已经排好版，请确认后打印。");
  });
  document.querySelectorAll("[data-task-toggle]").forEach((element) => element.addEventListener("change", () => {
    companionStore.dispatch({ type: "task.toggle", id: element.dataset.taskToggle });
    render();
  }));
  document.querySelector("#study-plan-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const title = String(new FormData(event.currentTarget).get("title") ?? "").trim();
    if (!title) return;
    companionStore.dispatch({ type: "task.add", task: { id: `task-${Date.now()}`, title, time: "今天", done: false } });
    toast("学习计划已添加", "success");
    render();
  });
  document.querySelector("#study-ai-plan-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const plan = String(new FormData(event.currentTarget).get("plan") ?? "").trim();
    if (!plan) {
      toast("先输入今天准备完成的事情");
      return;
    }
    await processVoiceCommand(`请帮我整理今日计划：${plan}`);
  });
  document.querySelector("[data-print-plan]")?.addEventListener("click", () => {
    const tasks = companionStore.getState().tasks;
    const content = tasks.map((task) => `${task.done ? "[x]" : "[ ]"} ${task.time}  ${task.title}`).join("\n");
    stagePrintable("todo", "今日计划", content, {}, "今日计划已经整理为 Todo List，请确认后打印。");
  });

  document.querySelector("[data-journal-summary]")?.addEventListener("click", async () => {
    const form = document.querySelector("#journal-form");
    const body = form?.querySelector('[name="body"]')?.value;
    if (!body?.trim()) {
      toast("先写下一点今天的内容");
      return;
    }
    try {
      const result = await api.journalSummary(body);
      ui.journalSummary = result.summary;
      const summary = document.querySelector("#journal-summary");
      if (summary) {
        summary.textContent = result.summary;
        summary.classList.add("ready");
      }
    } catch (error) { toast(error.message, "error"); }
  });
  document.querySelector("[data-print-journal]")?.addEventListener("click", () => {
    const form = document.querySelector("#journal-form");
    const title = form?.querySelector('[name="title"]')?.value || "今日手帐";
    const body = form?.querySelector('[name="body"]')?.value || "";
    const content = `${title}\n\n${body}\n\nAI 总结\n${ui.journalSummary}`;
    stagePrintable("note", "手帐总结", content, {}, "手帐总结已经排好版，请确认后打印。");
  });
  document.querySelector("#journal-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    companionStore.dispatch({
      type: "journal.add",
      entry: {
        id: `journal-${Date.now()}`, date: "今天", mood: values.mood,
        title: values.title, body: values.body,
        summary: ui.journalSummary || "今天被认真地记录了下来。"
      }
    });
    ui.journalSummary = "";
    toast("手帐已保存", "success");
    render();
  });
  document.querySelector("#fortune-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    try {
      ui.fortuneResult = await api.fortune(values);
      render();
    } catch (error) { toast(error.message, "error"); }
  });
  document.querySelector("[data-print-fortune]")?.addEventListener("click", () => {
    if (!ui.fortuneResult) return;
    stagePrintable("note", ui.fortuneResult.title, `${ui.fortuneResult.reading}\n\n${ui.fortuneResult.disclaimer}`, {}, "趣味小卡已经排好版，请确认后打印。");
  });
  document.querySelectorAll("[data-briefing-toggle]").forEach((element) => element.addEventListener("click", async () => {
    try {
      const enabled = element.dataset.enabled !== "true";
      await api.updateDailyBriefing(element.dataset.briefingToggle, { enabled });
      toast(enabled ? "每日推送已开启" : "每日推送已暂停", "success");
      render();
    } catch (error) { toast(error.message, "error"); }
  }));
  const saveBriefingTime = async (element) => {
    if (!element?.value || element.dataset.lastSavedValue === element.value) return;
    try {
      await api.updateDailyBriefing(element.dataset.briefingTime, { time: element.value });
      element.dataset.lastSavedValue = element.value;
      toast("推送时间已更新", "success");
      render();
    } catch (error) { toast(error.message, "error"); }
  };
  document.querySelectorAll("[data-briefing-time]").forEach((element) => {
    element.dataset.lastSavedValue = element.value;
    element.addEventListener("change", () => saveBriefingTime(element));
    element.addEventListener("blur", () => saveBriefingTime(element));
    element.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        saveBriefingTime(element);
      }
    });
  });
  document.querySelectorAll("[data-briefing-save-time]").forEach((button) => button.addEventListener("click", () => {
    const input = document.querySelector(`[data-briefing-time="${CSS.escape(button.dataset.briefingSaveTime)}"]`);
    saveBriefingTime(input);
  }));
  document.querySelectorAll("[data-briefing-source]").forEach((element) => element.addEventListener("click", async () => {
    try {
      const data = await api.dailyBriefings();
      const briefing = data.items.find((item) => item.id === element.dataset.briefingId);
      const next = new Set(briefing?.sources ?? []);
      if (next.has(element.dataset.briefingSource)) next.delete(element.dataset.briefingSource);
      else next.add(element.dataset.briefingSource);
      await api.updateDailyBriefing(element.dataset.briefingId, { sources: [...next] });
      render();
    } catch (error) { toast(error.message, "error"); }
  }));
  document.querySelectorAll("[data-briefing-print]").forEach((element) => element.addEventListener("click", async () => {
    try {
      toast("正在发送每日推送到打印机…");
      const result = await api.printDailyBriefing(element.dataset.briefingPrint);
      toast(`每日推送已发送到打印机 · ${result.pageCount} 页`, "success");
      render();
    } catch (error) { toast(error.message, "error"); }
  }));

  document.querySelectorAll("[data-write-to]").forEach((element) => element.addEventListener("click", () => {
    sessionStorage.setItem("aihub-recipient", element.dataset.writeTo);
    navigate("/letter/create");
  }));
  document.querySelectorAll("[data-quiz-option]").forEach((element) => element.addEventListener("click", () => {
    const step = MATCH_QUIZ_STEPS[ui.matchQuizStep];
    const value = element.dataset.quizOption;
    if (step.multiple) {
      const next = new Set(ui.matchPreferences);
      if (next.has(value)) next.delete(value);
      else if (next.size < 6) next.add(value);
      else {
        toast("最多选择 6 个，留一点空间给新的兴趣");
        return;
      }
      ui.matchPreferences = [...next];
      ui.matchProfile = { ...ui.matchProfile, interests: [...next] };
    } else {
      ui.matchProfile = { ...ui.matchProfile, [step.key]: value };
    }
    render();
  }));
  document.querySelector("[data-quiz-previous]")?.addEventListener("click", () => {
    ui.matchQuizStep = Math.max(0, ui.matchQuizStep - 1);
    render();
  });
  document.querySelector("[data-quiz-next]")?.addEventListener("click", () => {
    const step = MATCH_QUIZ_STEPS[ui.matchQuizStep];
    const value = matchPreferenceValue(step);
    if ((Array.isArray(value) && !value.length) || (!Array.isArray(value) && !value)) {
      toast(step.multiple ? "先选一个让你感兴趣的话题吧" : "选一个最接近你的答案吧");
      return;
    }
    if (ui.matchQuizStep < MATCH_QUIZ_STEPS.length - 1) {
      ui.matchQuizStep += 1;
      render();
      return;
    }
    ui.matchProfile = {
      ...ui.matchProfile,
      interests: [...ui.matchPreferences],
      completedAt: new Date().toISOString()
    };
    localStorage.setItem(matchProfileStorageKey(ui.currentUser?.id), JSON.stringify(ui.matchProfile));
    ui.matchQuizStep = 0;
    toast("偏好已保存，正在为你重新匹配", "success");
    navigate("/match");
  });
  document.querySelectorAll("[data-follow-user]").forEach((element) => element.addEventListener("click", async () => {
    await api.matchFeedback(element.dataset.followUser, "FOLLOWED");
    toast("已关注，未来会在首页看到更多动态", "success");
    render();
  }));
  document.querySelectorAll("[data-pass-user]").forEach((element) => element.addEventListener("click", async () => {
    await api.matchFeedback(element.dataset.passUser, "PASSED");
    toast("已减少类似推荐");
    render();
  }));
  document.querySelector("#memory-photo-input")?.addEventListener("change", async (event) => {
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    try {
      await api.uploadPhoto(file, { source: "upload", purpose: "memory", title: file.name });
      toast("照片已加入回忆相册，并自动生成热敏像素版本", "success");
      render();
    } catch (error) {
      toast(`上传失败：${error.message}`, "error");
    }
  });

  document.querySelectorAll("[data-letter-box]").forEach((element) => element.addEventListener("click", () => {
    ui.letterBox = element.dataset.letterBox;
    ui.selectedLetterId = null;
    render();
  }));
  document.querySelectorAll("[data-letter-id]").forEach((element) => element.addEventListener("click", async () => {
    ui.selectedLetterId = element.dataset.letterId;
    try {
      const letter = await api.letter(ui.selectedLetterId);
      document.querySelectorAll(".letter-row").forEach((row) => row.classList.toggle("active", row.dataset.letterId === ui.selectedLetterId));
      document.querySelector("#letter-detail-wrap").innerHTML = letterDetail(letter);
      wireLetterDetail();
    } catch (error) { toast(error.message, "error"); }
  }));
  wireLetterDetail();

  const letterForm = document.querySelector("#letter-form");
  letterForm?.addEventListener("input", () => previewLetter(letterForm));
  letterForm?.querySelector('[name="recipientId"]')?.addEventListener("change", () => syncLetterRecipient(letterForm));
  updateLetterAttachmentPreview(letterForm);
  document.querySelector("#letter-photo-input")?.addEventListener("change", async (event) => {
    const file = event.currentTarget.files?.[0];
    if (!file || !letterForm) return;
    try {
      const result = await api.uploadPhoto(file, { source: "upload", purpose: "letter", title: file.name });
      ui.letterAttachment = result.photo;
      updateLetterAttachmentPreview(letterForm);
      previewLetter(letterForm);
      toast("照片已处理成热敏像素风格", "success");
    } catch (error) {
      toast(`照片处理失败：${error.message}`, "error");
    } finally {
      event.currentTarget.value = "";
    }
  });
  document.querySelectorAll("[data-ai-letter]").forEach((element) => element.addEventListener("click", () => aiLetterAction(element.dataset.aiLetter)));
  letterForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const intent = event.submitter?.value ?? "draft";
    const form = event.currentTarget;
    const submitButton = event.submitter;
    if (form.dataset.sending === "true" || form.dataset.deliveryCommitted === "true") return;
    form.dataset.sending = "true";
    const originalLabel = submitButton.innerHTML;
    submitButton.disabled = true;
    if (intent === "send") submitButton.textContent = "正在发送…";
    try {
      const result = await createAndMaybeSendLetter(form, intent);
      if (intent === "draft") return;
      form.querySelectorAll('button[type="submit"]').forEach((button) => { button.disabled = true; });
      showLetterSendResult({
        tone: "success",
        title: "已发送",
        message: "数字信件已经成功送达，本次提交已锁定，不会重复发送。",
        detail: result.printQueued
          ? "实体打印任务正在后台处理。你可以关闭此提示，稍后在打印状态中查看结果。"
          : "对方当前设置为仅接收数字信件，因此没有创建实体打印任务。",
        onClose: () => { ui.letterBox = "sent"; navigate("/letter"); }
      });
    } catch (error) {
      const committed = error.deliveryCommitted || form.dataset.deliveryCommitted === "true";
      if (committed) {
        form.querySelectorAll('button[type="submit"]').forEach((button) => { button.disabled = true; });
        showLetterSendResult({
          tone: "warning",
          title: "信件已发送，请勿重复提交",
          message: "数字信件已送达，但打印机回执暂未确认。系统已经保留打印任务。",
          detail: "请到“我的信件 → 打印状态”查看或稍后重试打印任务，不要重新发送整封信。",
          actionLabel: "查看打印状态",
          onClose: () => { ui.letterBox = "print"; navigate("/letter"); }
        });
      } else {
        submitButton.disabled = false;
        showLetterSendResult({
          tone: "error",
          title: "发送失败",
          message: "信件尚未送达，也没有创建打印任务。",
          detail: `可以安全重试：${error.message}`,
          actionLabel: "返回修改",
          onClose: () => submitButton.focus()
        });
      }
    } finally {
      form.dataset.sending = "false";
      if (form.dataset.deliveryCommitted !== "true") {
        submitButton.innerHTML = originalLabel;
      }
    }
  });

  document.querySelector("[data-open-simulator]")?.addEventListener("click", () => window.open("/simulator.html", "aihub-device-simulator"));
  document.querySelector("[data-save-policy]")?.addEventListener("click", async (event) => {
    const mode = document.querySelector('input[name="policyMode"]:checked')?.value ?? "FRIENDS";
    const paused = document.querySelector("#print-paused")?.checked ?? false;
    try {
      await api.updatePrintPolicy(event.currentTarget.dataset.deviceId, {
        mode, paused,
        dailyJobLimit: Number(document.querySelector('input[name="dailyLimit"]').value),
        quietHours: {
          start: document.querySelector('input[name="quietStart"]').value,
          end: document.querySelector('input[name="quietEnd"]').value,
          timeZone: "Asia/Shanghai"
        }
      }, Number(event.currentTarget.dataset.version));
      toast(paused ? "远程打印已暂停，数字信件仍正常接收" : "打印策略已更新", "success");
      render();
    } catch (error) { toast(error.message, "error"); }
  });

}

function wireLetterDetail() {
  document.querySelectorAll("[data-reply-letter]").forEach((element) => element.addEventListener("click", () => {
    sessionStorage.setItem("aihub-recipient", element.dataset.replyLetter);
    navigate("/letter/create");
  }));
  document.querySelectorAll("[data-print-letter]").forEach((element) => element.addEventListener("click", async () => {
    try {
      const letter = await api.letter(element.dataset.printLetter);
      await printLetterToDevice(letter, element.dataset.printJob);
      toast("Letter 已发送到真实打印机", "success");
      render();
    } catch (error) { toast(error.message, "error"); }
  }));
  document.querySelectorAll("[data-report-letter]").forEach((element) => element.addEventListener("click", () => toast("举报入口已记录；生产版将进入安全审核队列")));
}

bus.onMessage(async (message) => {
  if (["simulator.hello", "device.heartbeat", "device.reported"].includes(message.type)) {
    const connectionChanged = !ui.simulatorConnected;
    ui.simulatorConnected = true;
    if (currentPath() === "/device" && connectionChanged) render();
  }
  if (message.type === "device.ack" && message.payload?.command === "printer.print" && ui.activePrintJobId) {
    try { await api.updatePrintStatus(ui.activePrintJobId, "PRINTING"); } catch {}
    if (currentPath() === "/letter" || currentPath() === "/device") render();
  }
  if (message.type === "printer.completed" && ui.activePrintJobId) {
    try { await api.updatePrintStatus(ui.activePrintJobId, "SUCCESS"); } catch {}
    toast("设备已完成实体 Letter 打印", "success");
    ui.activePrintJobId = null;
    if (currentPath() === "/letter" || currentPath() === "/device") render();
  }
});

window.addEventListener("popstate", render);
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") document.querySelector(".modal-overlay")?.remove();
});
window.addEventListener("aihub:auth-expired", () => {
  if (!ui.currentUser) return;
  sessionStorage.setItem("aihub-return-path", `${location.pathname}${location.search}`);
  ui.currentUser = null;
  ui.authChecked = true;
  toast("登录状态已过期，请重新登录", "error");
  navigate("/login");
});

render();
bus.send("web.hello", { client: "ai-hub-os-web", version: "0.5.0" });

