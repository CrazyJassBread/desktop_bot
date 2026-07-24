import { api, ApiProblem } from "./services/api-client.js";
import { DeviceBus } from "./services/device-bus.js";
import { createCompanionStore, createPrintJob } from "./services/companion-store.js";

const app = document.querySelector("#app");
const toastRegion = document.querySelector("#toast-region");
const bus = new DeviceBus("ai-hub-web");
const companionStore = createCompanionStore();

const DEFAULT_TURTLE_GAME = {
  id: "turtle-morning-printer",
  title: "午夜的纸条",
  story: "女孩每天睡前都会确认打印机里没有纸。第二天早上，桌上却总会出现一张写着“今天也要记得吃早餐”的纸条。她检查了门窗，家里没有别人。",
  truth: "她曾经让 AI 桌面助手每天早晨自动打印一句照顾自己的提醒。后来她忘记关闭定时任务，而热敏打印机里其实还留着一小段纸卷。",
  rules: "你只能提出能用 YES / NO / 无关 / 接近 回答的问题，直到猜出汤底。",
  difficulty: "warm-mystery",
  provider: "local-fallback",
  model: null,
  history: [],
  revealed: false,
  loading: false
};

const ui = {
  category: "全部",
  query: "",
  letterBox: "inbox",
  selectedLetterId: null,
  simulatorConnected: false,
  activePrintJobId: null,
  renderVersion: 0,
  wordRevealed: false,
  runnerLane: "down",
  runnerScore: 24,
  turtleVerdict: null,
  turtleGame: structuredClone(DEFAULT_TURTLE_GAME),
  turtleLastAnswer: "",
  turtleQuestion: "",
  photoPreview: null,
  photoFileName: null,
  photoResult: null,
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
  ["/", "首页", "home"],
  ["/community", "社区", "community"],
  ["/education", "学习", "book"],
  ["/entertainment", "娱乐", "game"],
  ["/life", "生活", "heart"],
  ["/match", "匹配", "match"],
  ["/letter", "信件", "letter"],
  ["/device", "设备", "device"]
];

const mobileNav = [
  ["/", "首页", "home"],
  ["/education", "学习", "book"],
  ["/entertainment", "娱乐", "game"],
  ["/life", "生活", "heart"],
  ["/community", "社区", "community"]
];

const paths = {
  home: '<path d="m3 11 9-8 9 8"/><path d="M5 10v10h14V10"/><path d="M9 20v-6h6v6"/>',
  community: '<path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z"/><path d="M8 9h8M8 13h5"/>',
  match: '<circle cx="8" cy="8" r="4"/><circle cx="16" cy="16" r="4"/><path d="m11 11 2 2"/>',
  letter: '<rect width="18" height="14" x="3" y="5" rx="2"/><path d="m3 7 9 6 9-6"/>',
  device: '<rect width="16" height="20" x="4" y="2" rx="4"/><path d="M8 7h8v6H8z"/><path d="M9 18h.01M15 18h.01"/>',
  profile: '<circle cx="12" cy="8" r="4"/><path d="M4 22a8 8 0 0 1 16 0"/>',
  book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5Z"/><path d="M4 5.5v14A2.5 2.5 0 0 0 6.5 22H20"/>',
  game: '<path d="M8.5 6h7a6.5 6.5 0 0 1 6.2 8.5l-1.1 3.2a2 2 0 0 1-3.2.8L15 16H9l-2.4 2.5a2 2 0 0 1-3.2-.8l-1.1-3.2A6.5 6.5 0 0 1 8.5 6Z"/><path d="M7 11v4M5 13h4M16 12h.01M19 14h.01"/>',
  camera: '<path d="M14.5 4 16 7h3a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3v-8a3 3 0 0 1 3-3h3l1.5-3Z"/><circle cx="12" cy="14" r="4"/>',
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
  const allowed = ["/", "/community", "/create-post", "/education", "/entertainment", "/life", "/match", "/letter", "/letter/create", "/device", "/profile", "/login", "/register", "/admin"];
  return allowed.includes(path) ? path : "/";
}

function navigate(path) {
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
  const active = activePath.startsWith("/letter") ? "/letter" : activePath;
  return `<div class="hub-app">
    <header class="topbar">
      <button class="hub-logo" data-nav="/" aria-label="AI Hub OS 首页">${logo()}</button>
      <nav class="desktop-nav" aria-label="主导航">
        ${nav.map(([path, label]) => `<button data-nav="${path}" class="${active === path ? "active" : ""}">${label}${path === "/letter" ? '<i class="nav-count">2</i>' : ""}</button>`).join("")}
      </nav>
      <div class="topbar-actions">
        <button class="top-search" data-nav="/community">${icon("search", 17)}<span>搜索</span><kbd>⌘ K</kbd></button>
        <button class="create-button" data-nav="/create-post">${icon("plus", 17)}<span>发布</span></button>
        <button class="circle-button" title="通知">${icon("bell", 18)}<i class="notification-dot"></i></button>
        <button class="avatar-button" data-nav="/profile">林</button>
      </div>
    </header>
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
    runner: '<div class="cover-runner"><i></i><span>24</span><b>JUMP!</b><em>☁︎</em></div>',
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

async function homeView() {
  const data = await api.dashboard();
  const companion = companionStore.getState();
  const openTasks = companion.tasks.filter((task) => !task.done).length;
  return `<section class="page home-page" id="home-view">
    <div class="home-welcome">
      <div><p class="eyebrow">THURSDAY · JUL 23</p><h1>下午好，${escapeHtml(data.user.displayName)}。</h1><p>学习一点，玩一会儿，也记录今天普通但真实的生活。</p></div>
      <button class="primary-button" data-nav="/create-post">${icon("plus", 17)}分享此刻</button>
    </div>
    <div class="companion-launcher" aria-label="AI 伴侣功能">
      <button data-nav="/education" class="launcher-learn"><i>${icon("book", 21)}</i><span><small>LEARN</small><strong>学习空间</strong><b>AI 问答 · 单词 · ${openTasks} 项计划</b></span>${icon("arrow", 16)}</button>
      <button data-nav="/entertainment" class="launcher-play"><i>${icon("game", 21)}</i><span><small>PLAY</small><strong>轻松一下</strong><b>跑酷 · 海龟汤 · Photo 2 Text</b></span>${icon("arrow", 16)}</button>
      <button data-nav="/life" class="launcher-life"><i>${icon("journal", 21)}</i><span><small>LIFE</small><strong>生活记录</strong><b>手帐 · 心情 · 今日趣味预测</b></span>${icon("arrow", 16)}</button>
    </div>
    <div class="home-grid">
      <div class="home-feed">
        <div class="section-head"><div><p class="eyebrow">FROM YOUR CIRCLE</p><h2>朋友们的日常</h2></div><button data-nav="/community">进入社区 ${icon("arrow", 15)}</button></div>
        ${data.featuredPosts.map((post) => postCard(post)).join("")}
      </div>
      <aside class="home-aside">
        <article class="home-letter-callout">
          <span class="paper-stamp">NEW LETTER</span>
          <h2>有 ${data.unreadLetters} 封信<br>从远方抵达。</h2>
          <p>其中一封已经由 MIMO 打印成了纸面。</p>
          <button data-nav="/letter">打开信箱 ${icon("arrow", 16)}</button>
          <div class="envelope-art"><i></i><span>見字如面</span></div>
        </article>
        <div class="section-head compact"><div><p class="eyebrow">PEOPLE TO MEET</p><h2>可能聊得来</h2></div><button data-nav="/match">全部</button></div>
        <div class="mini-user-list">${data.matches.map((item) => miniUser(item, false)).join("")}</div>
        <div class="section-head compact"><div><p class="eyebrow">YOUR HARDWARE</p><h2>桌面设备</h2></div><button data-nav="/device">管理</button></div>
        ${deviceMini(data.device)}
      </aside>
    </div>
  </section>`;
}

async function communityView() {
  const data = await api.posts({ category: ui.category, query: ui.query });
  const categories = ["全部", "日常", "心情", "学习", "兴趣", "交友", "创作", "设备"];
  return `<section class="page community-page" id="community-view">
    ${pageHead("COMMUNITY SQUARE", "社区广场", "聊今天、兴趣和心情，也认识生活节奏相近的人。", `<button class="primary-button" data-nav="/create-post">${icon("plus", 17)}分享此刻</button>`)}
    <div class="community-search">
      <form id="community-search-form">${icon("search", 19)}<input name="query" value="${escapeHtml(ui.query)}" placeholder="搜索日常、兴趣、城市或朋友"><button>搜索</button></form>
      <div class="category-tabs">${categories.map((category) => `<button data-category="${category}" class="${ui.category === category ? "active" : ""}">${category}</button>`).join("")}</div>
    </div>
    <div class="community-layout">
      <aside class="topic-sidebar">
        <p class="eyebrow">YOUR CORNERS</p>
        ${["今日手帐", "读书与电影", "学习打卡", "晚安电台", "城市散步"].map((topic, index) => `<button data-topic="${topic}"><span>#</span>${topic}<small>${[268, 193, 174, 121, 96][index]}</small></button>`).join("")}
        <div class="community-rule">${icon("shield", 19)}<p><strong>让交流保持真诚。</strong><br>不催促、不评判、不泄露隐私，给彼此舒服的距离。</p></div>
      </aside>
      <main class="feed-column">
        <div class="feed-sort"><span>${data.items.length} 条内容</span><div><button class="active">为你推荐</button><button>最新发布</button></div></div>
        ${data.items.length ? data.items.map((post) => postCard(post)).join("") : `<div class="empty-state">${icon("search", 28)}<h3>没有找到相关内容</h3><p>换个关键词或分类试试。</p></div>`}
      </main>
      <aside class="discover-sidebar">
        <article class="side-card">
          <div class="side-card-head"><p><span class="eyebrow">TRENDING</span><strong>本周热门</strong></p><button>查看更多</button></div>
          ${[["01", "今天的一件小事", "1.2k 分享"], ["02", "七日学习打卡", "836 参与"], ["03", "来自远方的信", "619 封"]].map(([n, title, count]) => `<button class="trend-row"><i>${n}</i><span><strong>${title}</strong><small>${count}</small></span>${icon("arrow", 14)}</button>`).join("")}
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
    ${pageHead("CREATE", "分享此刻", "可以是今天的一件小事、一段心情、一次学习或新认识的兴趣。")}
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

function turtleAnswerLabel(verdict) {
  return {
    YES: ["YES", "是的，这个方向很接近。"],
    NO: ["NO", "不是这样，换一个角度想想。"],
    CLOSE: ["接近", "很接近了，把线索再连完整一点。"],
    IRRELEVANT: ["无关", "这个问题与真相没有直接关系。"]
  }[verdict] ?? ["ASK", "请提出一个只能用“是 / 否”回答的问题。"];
}

function turtleHistoryRows(history = []) {
  return history.length
    ? history.slice(-8).map((item, index) => `<div class="turtle-message">
        <span><b>Q${Math.max(1, history.length - Math.min(history.length, 8) + index + 1)}</b>${escapeHtml(item.question)}</span>
        <p><strong>${escapeHtml(item.verdict)}</strong>${escapeHtml(item.answer)}${item.hint ? `<small>${escapeHtml(item.hint)}</small>` : ""}</p>
      </div>`).join("")
    : `<div class="turtle-empty">对 MIMO 说“我要玩海龟汤”，或直接问第一个 YES / NO 问题。</div>`;
}

function turtlePrintable(game = ui.turtleGame) {
  const history = (game.history ?? []).map((item, index) => `${index + 1}. Q: ${item.question}\n   A: ${item.verdict} · ${item.answer}`).join("\n\n");
  return `海龟汤 · ${game.title}\n\n汤面\n${game.story}\n\n规则\n${game.rules}\n\n${history ? `已提问\n${history}\n\n` : ""}请用只能回答 YES / NO 的问题找出真相。`;
}

async function entertainmentView() {
  const state = companionStore.getState();
  const game = ui.turtleGame ?? DEFAULT_TURTLE_GAME;
  const [verdict, verdictText] = turtleAnswerLabel(ui.turtleVerdict);
  const eggOpened = Boolean(state.eggOpenedAt);
  return `<section class="page companion-page entertainment-page" id="entertainment-view">
    ${pageHead("PLAY WITH MIMO", "娱乐空间", "小游戏、故事和彩蛋，都是让桌面陪伴变得有趣的小入口。")}
    <div class="entertainment-grid">
      <article class="runner-card companion-card">
        <header class="companion-card-head"><div><i>${icon("game", 18)}</i><span><h2>Cloud Runner</h2><small>键盘 ↑ ↓ · 手势 Up / Down</small></span></div><b class="runner-score">${ui.runnerScore} m</b></header>
        <div class="runner-stage lane-${ui.runnerLane}" tabindex="0" aria-label="跑酷小游戏">
          <span class="runner-sun">☀</span><i class="cloud cloud-one">☁</i><i class="cloud cloud-two">☁</i>
          <div class="runner-character"><span>●　●</span></div>
          <div class="runner-obstacle"></div><b class="runner-ground"></b>
        </div>
        <div class="runner-controls"><button data-runner="up">↑ 跳起</button><button data-runner="down">↓ 蹲下</button><span>也可以在设备模拟器使用 Up / Down 手势</span></div>
      </article>
      <article class="turtle-card companion-card">
        <header class="companion-card-head">
          <div><i>?</i><span><h2>海龟汤</h2><small>${game.provider === "deepseek" ? "DeepSeek 主持中" : "本地主持 · 可离线"}</small></span></div>
          <div class="turtle-tools"><button class="round-button" data-new-turtle title="AI 开新局">${icon("spark", 16)}</button><button class="round-button" data-print-story title="打印故事">${icon("printer", 16)}</button></div>
        </header>
        <div class="turtle-story"><p class="eyebrow">STORY</p><h3>${escapeHtml(game.title)}</h3><p>${escapeHtml(game.story)}</p><small>${escapeHtml(game.rules)}</small></div>
        <div class="verdict-panel ${String(ui.turtleVerdict ?? "").toLowerCase()}"><strong id="turtle-verdict">${verdict}</strong><span>${escapeHtml(ui.turtleLastAnswer ?? verdictText)}</span></div>
        <div class="turtle-dialogue">${turtleHistoryRows(game.history)}</div>
        <form class="turtle-form" id="turtle-form">
          <input name="question" value="${escapeHtml(ui.turtleQuestion ?? "")}" placeholder="例如：是设备自己打印的吗？" required>
          <button ${game.loading ? "disabled" : ""}>${game.loading ? "思考中" : "提问"}</button>
          <button class="outline-button" type="button" data-turtle-voice title="语音提问">${icon("mic", 14)}</button>
        </form>
        <div class="turtle-footer"><button class="text-button" data-turtle-answer>揭晓汤底 ${icon("arrow", 14)}</button><span>${game.model ? escapeHtml(game.model) : "fallback"}</span></div>
        ${game.revealed ? `<div class="turtle-truth"><strong>汤底</strong><p>${escapeHtml(game.truth)}</p></div>` : ""}
      </article>
      <article class="photo-card companion-card">
        <header class="companion-card-head"><div><i>${icon("camera", 18)}</i><span><h2>Photo 2 Text</h2><small>照片 → OCR → AI 摘要</small></span></div></header>
        <div class="photo-workspace">
          <label class="photo-dropzone">
            <input id="photo-input" type="file" accept="image/*">
            ${ui.photoPreview ? `<img src="${ui.photoPreview}" alt="待识别照片预览">` : `${icon("camera", 27)}<strong>选择一张照片</strong><small>支持 JPG、PNG；当前 MVP 使用本地预览</small>`}
          </label>
          <div class="ocr-result" id="ocr-result">
            ${ui.photoResult
              ? `<p class="eyebrow">OCR RESULT</p><strong>${escapeHtml(ui.photoResult.extractedText)}</strong><span>${escapeHtml(ui.photoResult.summary)}</span>`
              : `<p class="eyebrow">WAITING</p><strong>文字会显示在这里</strong><span>上传后可复制、总结或打印。</span>`}
          </div>
        </div>
        <div class="photo-actions"><button class="primary-button" data-run-ocr ${ui.photoPreview ? "" : "disabled"}>${icon("spark", 15)}识别文字</button>${ui.photoResult ? `<button class="outline-button" data-print-ocr>${icon("printer", 15)}打印结果</button>` : ""}</div>
      </article>
      <article class="egg-card companion-card ${eggOpened ? "opened" : ""}">
        <div class="egg-sparkles">✦　·　✧　·　✦</div>
        <p class="eyebrow">DAILY EGG</p>
        <h2>${eggOpened ? "今天也会有小小的好事。" : "今天的彩蛋，还没有打开。"}</h2>
        <p>${eggOpened ? "给未来的自己留一句话：我正在慢慢成为一个更会照顾生活的人。" : "每天只能打开一次，可能是一句话、一个故事或一张适合打印的小纸条。"}</p>
        <div><button class="primary-button" data-open-egg ${eggOpened ? "disabled" : ""}>${eggOpened ? "今日已打开" : "打开彩蛋"}</button>${eggOpened ? `<button class="outline-button" data-print-egg>${icon("printer", 15)}打印</button>` : ""}</div>
      </article>
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

async function matchView() {
  const data = await api.matches();
  return `<section class="page match-page" id="match-view">
    ${pageHead("FIND YOUR PEOPLE", "遇见可能聊得来的人", "匹配来自共同兴趣、互补技能、语言与活跃度，不评价外貌。", `<button class="outline-button">${icon("settings", 16)}调整偏好</button>`)}
    <div class="match-summary">
      <div><span class="match-orbit"><i></i><i></i><b>4</b></span><p><strong>本周的新推荐</strong><small>规则版本 rules-2026-07</small></p></div>
      <div class="formula"><span><b>40%</b>兴趣</span><i>+</i><span><b>30%</b>技能</span><i>+</i><span><b>20%</b>地区</span><i>+</i><span><b>10%</b>活跃度</span></div>
    </div>
    <div class="match-grid">
      ${data.items.map((match) => `<article class="match-card" data-match-card="${match.user.id}">
        <div class="match-card-art art-${match.user.id.split("-").at(-1)}"><span class="country-code">${match.user.countryCode}</span>${avatar(match.user, "hero")}<i></i><i></i></div>
        <div class="match-card-body">
          <div class="match-person"><div><h2>${escapeHtml(match.user.displayName)}</h2><p>@${escapeHtml(match.user.handle)} · ${escapeHtml(match.user.city)}, ${escapeHtml(match.user.country)}</p></div>${scoreRing(match.score)}</div>
          <p class="match-bio">${escapeHtml(match.user.bio)}</p>
          ${tagList(match.user.interests, 4)}
          <div class="why-match"><p class="eyebrow">WHY YOU MATCH</p>${match.reasons.map((reason) => `<span>${icon("check", 13)}${escapeHtml(reason)}</span>`).join("")}</div>
          <div class="match-actions"><button class="primary-button" data-write-to="${match.user.id}">${icon("letter", 16)}写一封信</button><button class="outline-button" data-follow-user="${match.user.id}">${match.followed ? "已关注" : "关注"}</button><button class="round-button" data-pass-user="${match.user.id}" title="暂不感兴趣">${icon("close", 16)}</button></div>
        </div>
      </article>`).join("")}
    </div>
    <div class="match-safety">${icon("shield", 20)}<p><strong>由你决定关系如何开始。</strong><br>陌生人的首封信只会作为请求送达，不会自动消耗对方设备的纸张。</p></div>
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
  const data = await api.letters(ui.letterBox);
  if (!ui.selectedLetterId && data.items.length) ui.selectedLetterId = data.items[0].id;
  const selected = data.items.find((item) => item.id === ui.selectedLetterId) ?? data.items[0];
  return `<section class="page letters-page" id="letter-view">
    ${pageHead("LETTERS", "我的信件", "慢一点表达，让一封数字信最终成为真实纸张。", `<button class="primary-button" data-nav="/letter/create">${icon("edit", 16)}写一封信</button>`)}
    <div class="letter-tabs">
      ${[["inbox", "收件箱", "2"], ["sent", "已发送", ""], ["draft", "草稿", "1"], ["print", "打印状态", "1"]].map(([box, label, count]) => `<button data-letter-box="${box}" class="${ui.letterBox === box ? "active" : ""}">${label}${count ? `<i>${count}</i>` : ""}</button>`).join("")}
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
          <div><p class="eyebrow">PHOTO ATTACHMENT</p><strong>附上一张热敏像素照片</strong><span>手机端也可以直接从相册上传；系统会自动裁到适合 58mm 热敏纸的尺寸。</span></div>
          <label class="outline-button">${icon("camera", 15)}上传照片<input id="letter-photo-input" type="file" accept="image/*"></label>
          <div id="letter-photo-preview">${ui.letterAttachment ? `<figure><img src="${ui.letterAttachment.processed.previewDataUrl}" alt="信件附图热敏预览"><figcaption>${escapeHtml(ui.letterAttachment.title)} · ${ui.letterAttachment.processed.width}×${ui.letterAttachment.processed.height}</figcaption><button type="button" class="text-button" data-remove-letter-photo>移除照片</button></figure>` : '<small>尚未添加照片。</small>'}</div>
        </div>
        <div class="ai-toolbar"><span>${icon("spark", 17)}AI 辅助</span><button type="button" data-ai-letter="generate">生成草稿</button><button type="button" data-ai-letter="polish">温和润色</button></div>
        <div class="privacy-hint">${icon("shield", 17)}发送前会再次确认收件人。手机号、地址和其他敏感内容不会被公开。</div>
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
        <div class="printer-safety"><span><i class="ready-dot"></i><strong>打印机可以接收任务</strong><small>${current.printer.temperatureC}°C · 58mm thermal</small></span><button class="primary-button" data-test-print>${icon("printer", 15)}测试打印</button></div>
      </div>
    </article>
    <article class="printer-test-console">
      <div class="card-head">
        <div><p class="eyebrow">REAL DEVICE TEST · 10.76.7.129</p><h2>中英文打印测试</h2></div>
        <span id="printer-test-result">等待发送</span>
      </div>
      <form id="printer-test-form">
        <label class="printer-test-text">打印内容<textarea name="text" rows="4" maxlength="1000">A</textarea></label>
        <div class="printer-test-controls">
          <label>语言<select name="language"><option value="en" selected>English · JSON</option><option value="zh">中文 · GB2312</option></select></label>
          <label>字体<select name="font"><option value="A" selected>Font A</option><option value="B">Font B</option></select></label>
          <label>对齐<select name="align"><option value="left">左对齐</option><option value="center" selected>居中</option><option value="right">右对齐</option></select></label>
          <label>宽度<select name="width"><option value="1" selected>1×</option><option value="2">2×</option></select></label>
          <label>高度<select name="height"><option value="1" selected>1×</option><option value="2">2×</option></select></label>
          <label>打印后走纸<select name="feedAfter"><option value="0">0 行</option><option value="2" selected>2 行</option><option value="3">3 行</option></select></label>
        </div>
        <div class="printer-test-footer">
          <div class="printer-style-toggles">
            <label><input type="checkbox" name="bold" checked>粗体</label>
            <label><input type="checkbox" name="underline" checked>下划线</label>
            <label><input type="checkbox" name="invert">反白</label>
          </div>
          <div class="printer-test-actions">
            <button class="ghost-button" type="button" data-printer-sample="en">英文示例</button>
            <button class="ghost-button" type="button" data-printer-sample="zh">中文示例</button>
            <button class="primary-button" type="submit">${icon("printer", 15)}发送到打印机</button>
          </div>
        </div>
      </form>
      <p class="policy-note">${icon("shield", 16)}中文会由本地服务转换为 GB2312 二进制；英文使用 JSON。请求只从本机后端发送到局域网设备，不暴露设备 IP 给公网浏览器。</p>
    </article>
    <article class="printer-link-console">
      <div class="card-head">
        <div><p class="eyebrow">WEB VOICE · PRINTER ONLY</p><h2>网页语音与打印联动</h2></div>
        <span class="link-state active">SIMPLIFIED</span>
      </div>
      <div class="printer-link-layout">
        <div class="printer-link-channels">
          <div><i class="live">${icon("mic", 18)}</i><span><strong>Browser Speech</strong><small>SpeechRecognition / webkitSpeechRecognition</small><b>WEB ONLY</b></span></div>
          <div><i class="live">${icon("printer", 18)}</i><span><strong>ESP32 Printer</strong><small>POST /api/v1/printer/{text|content|letter}</small><b>HARDWARE OUTPUT</b></span></div>
          <p>当前 Web 端不再接入板载麦克风 ASR、手势事件或摄像头回调。用户在浏览器里说话/输入后，后端调用 DeepSeek 做意图识别与整理；只有用户确认打印时，后端才把 384px 热敏位图或文本发送到 ESP32 打印机。</p>
          <div class="bridge-contract"><span><b>VOICE</b><small>browser local input</small></span><span><b>AI</b><small>DeepSeek on server</small></span><span><b>PRINT</b><small>${escapeHtml(current.printer.status)} · ${escapeHtml(current.printer.paper)}</small></span></div>
        </div>
        <div class="printable-capability-feed"><div class="printable-capability-head"><strong>可打印能力</strong><span>384 px thermal</span></div>
          ${["AI 对话回复", "今日计划 Todo", "单词学习卡片", "海龟汤故事", "Photo 2 Text 结果", "手帐总结", "趣味小卡", "AI Letter"].map((item) => `<div class="printable-capability"><i class="printable">${icon("printer", 15)}</i><span><strong>${item}</strong><small>生成预览后再确认打印，避免误出纸。</small></span><time>PRINT</time></div>`).join("")}
        </div>
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
  const [user, postData, photos] = await Promise.all([api.me(), api.posts({ query: "" }), api.photos()]);
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
        <article class="profile-device-card">${deviceMini({ id: "mimo-desk-01", displayName: "MIMO One", model: "DNESP32S3", status: "ONLINE", firmwareVersion: "0.3.0", battery: 82, printer: { status: "READY" } })}<p>${icon("shield", 15)}只公开设备型号，不公开设备 ID 和在线地址。</p></article>
      </aside>
      <main>
        <article class="memory-album">
          <div class="card-head"><div><p class="eyebrow">MEMORY ALBUM</p><h2>回忆相册</h2></div><label class="outline-button">${icon("camera", 15)}从相册上传<input id="memory-photo-input" type="file" accept="image/*"></label></div>
          <p class="policy-note">${icon("shield", 16)}网页不负责控制硬件拍照。你直接和硬件交互完成拍照后，设备会上传到 <code>POST /api/v1/photos/hardware</code> 并自动出现在这里。</p>
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

function authView(type) {
  const login = type === "login";
  return `<div class="auth-page">
    <section class="auth-story"><button class="hub-logo light" data-nav="/">${logo()}</button><div><p class="eyebrow">DIGITAL WORDS, PHYSICAL HEART</p><h1>让一封信，<br>从屏幕抵达桌面。</h1><p>加入 AI 硬件创作者社区，认识有趣的人，让设备打印真正值得留下的内容。</p></div><span>AI · HARDWARE · COMMUNITY · LETTER</span></section>
    <section class="auth-form-wrap"><form id="auth-form" data-auth="${type}"><p class="eyebrow">${login ? "WELCOME BACK" : "JOIN THE COMMUNITY"}</p><h2>${login ? "欢迎回来。" : "创建你的 AI Hub 身份。"}</h2><p>${login ? "继续社区、朋友和实体信件。" : "完善兴趣后，我们会推荐真正可能聊得来的人。"}</p>
      ${login ? "" : '<label>昵称<input name="displayName" placeholder="如何称呼你" required></label>'}
      <label>邮箱<input name="email" type="email" placeholder="name@example.com" required></label>
      <label>密码<input name="password" type="password" minlength="10" placeholder="至少 10 个字符" required></label>
      <button class="primary-button full" type="submit">${login ? "登录" : "创建账号"}${icon("arrow", 16)}</button>
      <div class="auth-divider"><span>第三方登录将在生产版开放</span></div>
      <p class="auth-switch">${login ? "还没有账号？" : "已经有账号？"}<button type="button" data-nav="${login ? "/register" : "/login"}">${login ? "立即注册" : "登录"}</button></p>
    </form></section>
  </div>`;
}

async function render() {
  const version = ++ui.renderVersion;
  const path = currentPath();
  const titles = {
    "/": "首页", "/community": "社区广场", "/create-post": "发布",
    "/education": "学习空间", "/entertainment": "娱乐空间", "/life": "生活空间",
    "/match": "匹配中心", "/letter": "我的信件", "/letter/create": "写信",
    "/device": "设备中心", "/profile": "个人主页", "/admin": "Admin",
    "/login": "登录", "/register": "注册"
  };
  document.title = `${titles[path]} · AI Hub OS`;
  if (path === "/login" || path === "/register") {
    app.innerHTML = authView(path.slice(1));
    wire();
    return;
  }

  app.innerHTML = shell(loading(), path);
  wireNavigation();
  try {
    const views = {
      "/": homeView,
      "/community": communityView,
      "/create-post": createPostView,
      "/education": educationView,
      "/entertainment": entertainmentView,
      "/life": lifeView,
      "/match": matchView,
      "/letter": letterView,
      "/letter/create": letterCreateView,
      "/device": deviceView,
      "/profile": profileView,
      "/admin": adminView
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
    ? `<figure><img src="${ui.letterAttachment.processed.previewDataUrl}" alt="信件附图热敏预览"><figcaption>${escapeHtml(ui.letterAttachment.title)} · ${ui.letterAttachment.processed.width}×${ui.letterAttachment.processed.height}</figcaption><button type="button" class="text-button" data-remove-letter-photo>移除照片</button></figure>`
    : "<small>尚未添加照片。</small>";
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

async function startTurtleSoupGame(theme = "AI 桌面设备与热敏打印机") {
  ui.turtleGame = { ...structuredClone(DEFAULT_TURTLE_GAME), loading: true };
  ui.turtleVerdict = null;
  ui.turtleLastAnswer = "AI 正在准备一个新的汤面。";
  ui.voiceMode = "turtle";
  await render();
  try {
    const game = await api.startTurtleSoup({ theme, tone: "温暖轻悬疑，适合语音互动" });
    ui.turtleGame = { ...game, history: [], revealed: false, loading: false };
    ui.turtleLastAnswer = "新汤面已准备好。你可以开始提问。";
    ui.voiceResult = { intent: "START_TURTLE_SOUP", reply: "海龟汤已开始。你可以用语音提出 YES / NO 问题。", provider: game.provider ?? "deepseek", requiresConfirmation: false };
    toast("海龟汤新局已开始", "success");
  } catch (error) {
    ui.turtleGame = { ...structuredClone(DEFAULT_TURTLE_GAME), loading: false };
    ui.turtleLastAnswer = error.message;
    toast(error.message, "error");
  }
  await render();
}

async function submitTurtleQuestion(question, source = "typed") {
  const text = String(question ?? "").trim();
  if (!text) return;
  if (/^(汤底|答案|揭晓|真相)$/u.test(text)) {
    ui.turtleGame.revealed = true;
    ui.turtleVerdict = "YES";
    ui.turtleLastAnswer = "汤底已揭晓。";
    await render();
    return;
  }
  ui.turtleQuestion = text;
  ui.turtleGame = { ...(ui.turtleGame ?? DEFAULT_TURTLE_GAME), loading: true };
  await render();
  try {
    const result = await api.turtleSoup(text, ui.turtleGame);
    const entry = {
      question: text,
      verdict: result.verdict,
      answer: result.answer,
      hint: result.hint,
      source,
      provider: result.provider,
      createdAt: new Date().toISOString()
    };
    ui.turtleGame = {
      ...ui.turtleGame,
      history: [...(ui.turtleGame.history ?? []), entry],
      loading: false,
      revealed: Boolean(ui.turtleGame.revealed || result.solved)
    };
    ui.turtleVerdict = result.verdict;
    ui.turtleLastAnswer = result.solved ? `${result.answer} 汤底已经猜中。` : result.answer;
    ui.turtleQuestion = "";
    ui.voiceMode = "turtle";
    ui.voiceResult = {
      intent: "START_TURTLE_SOUP",
      reply: `${result.verdict} · ${result.answer}`,
      provider: result.provider ?? "deepseek",
      requiresConfirmation: false
    };
  } catch (error) {
    ui.turtleGame = { ...ui.turtleGame, loading: false };
    toast(error.message, "error");
  }
  await render();
}

function startTurtleVoiceQuestion() {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) {
    toast("当前浏览器不支持语音识别，请先用输入框提问。", "error");
    document.querySelector('#turtle-form input[name="question"]')?.focus();
    return;
  }
  const recognition = new Recognition();
  recognition.lang = "zh-CN";
  recognition.interimResults = true;
  recognition.continuous = false;
  let finalText = "";
  ui.voiceListening = true;
  ui.voiceMode = "turtle";
  document.querySelector(".turtle-card")?.classList.add("listening");
  toast("海龟汤正在听你的问题");
  recognition.addEventListener("result", (event) => {
    let interim = "";
    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const part = event.results[index][0]?.transcript ?? "";
      if (event.results[index].isFinal) finalText += part;
      else interim += part;
    }
    const input = document.querySelector('#turtle-form input[name="question"]');
    if (input) input.value = `${finalText}${interim}`.trim();
  });
  recognition.addEventListener("end", () => {
    ui.voiceListening = false;
    document.querySelector(".turtle-card")?.classList.remove("listening");
    const transcript = finalText.trim();
    if (transcript) submitTurtleQuestion(transcript, "web_microphone");
  });
  recognition.addEventListener("error", () => {
    ui.voiceListening = false;
    document.querySelector(".turtle-card")?.classList.remove("listening");
    toast("没有听清，请再问一次", "error");
  });
  recognition.start();
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
  const turtleMode = ui.voiceMode === "turtle" || currentPath() === "/entertainment";
  const letterFinish = letterMode ? splitBrowserLetterFinish(text) : { finished: false, content: text, keyword: null };
  const pendingPrintable = ui.voiceResult?.requiresConfirmation ? ui.voiceResult.printable : null;
  ui.voiceTranscript = text;
  ui.voiceProcessing = true;
  ui.voiceListening = false;
  document.querySelector(".voice-agent-status h2")?.replaceChildren("AI 正在理解");
  try {
    if (turtleMode && !/我要玩海龟汤|开始海龟汤|来一局海龟汤/u.test(text)) {
      await submitTurtleQuestion(text, "web_voice_agent");
      return;
    }
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
    if (result.intent === "START_TURTLE_SOUP") {
      ui.voiceMode = "turtle";
      toast(result.reply, "success");
      navigate("/entertainment");
      await startTurtleSoupGame();
      return;
    }
  } catch (error) {
    toast(`AI 暂时无法理解：${error.message}`, "error");
  } finally {
    ui.voiceProcessing = false;
    if (["/education", "/entertainment"].includes(currentPath())) render();
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

  document.querySelectorAll("[data-runner]").forEach((element) => element.addEventListener("click", () => {
    ui.runnerLane = element.dataset.runner;
    ui.runnerScore += 8;
    render();
  }));
  document.querySelector("#turtle-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const question = new FormData(event.currentTarget).get("question");
    await submitTurtleQuestion(question, "typed");
  });
  document.querySelector("[data-new-turtle]")?.addEventListener("click", () => {
    startTurtleSoupGame();
  });
  document.querySelector("[data-turtle-voice]")?.addEventListener("click", startTurtleVoiceQuestion);
  document.querySelector("#turtle-form input[name='question']")?.addEventListener("input", (event) => {
    ui.turtleQuestion = event.currentTarget.value;
  });
  document.querySelector("[data-turtle-answer]")?.addEventListener("click", () => {
    ui.turtleVerdict = "YES";
    ui.turtleGame.revealed = true;
    ui.turtleLastAnswer = "汤底已揭晓。";
    toast(`汤底：${ui.turtleGame.truth}`);
    render();
  });
  document.querySelector("[data-print-story]")?.addEventListener("click", async () => {
    try {
      await printCompanionContent(`海龟汤 · ${ui.turtleGame.title}`, turtlePrintable(ui.turtleGame), "story");
    } catch (error) { toast(error.message, "error"); }
  });
  document.querySelector("#photo-input")?.addEventListener("change", (event) => {
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    ui.photoFileName = file.name;
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      ui.photoPreview = reader.result;
      ui.photoResult = null;
      render();
    });
    reader.readAsDataURL(file);
  });
  document.querySelector("[data-run-ocr]")?.addEventListener("click", async () => {
    try {
      ui.photoResult = await api.ocr(ui.photoFileName ?? "photo.jpg");
      render();
    } catch (error) { toast(error.message, "error"); }
  });
  document.querySelector("[data-print-ocr]")?.addEventListener("click", () => {
    if (!ui.photoResult) return;
    stagePrintable("note", "Photo 2 Text", `${ui.photoResult.extractedText}\n\nAI 总结\n${ui.photoResult.summary}`, {}, "OCR 结果已经排好版，请确认后打印。");
  });
  document.querySelector("[data-open-egg]")?.addEventListener("click", () => {
    companionStore.dispatch({ type: "egg.open" });
    render();
  });
  document.querySelector("[data-print-egg]")?.addEventListener("click", async () => {
    try {
      await printCompanionContent("今日彩蛋", "今天也会有小小的好事。\n\n我正在慢慢成为一个更会照顾生活的人。", "egg");
    } catch (error) { toast(error.message, "error"); }
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

  document.querySelectorAll("[data-write-to]").forEach((element) => element.addEventListener("click", () => {
    sessionStorage.setItem("aihub-recipient", element.dataset.writeTo);
    navigate("/letter/create");
  }));
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
  const printerTestForm = document.querySelector("#printer-test-form");
  const submitPrinterTest = async () => {
    if (!printerTestForm) return;
    const values = Object.fromEntries(new FormData(printerTestForm));
    const submitButton = printerTestForm.querySelector('button[type="submit"]');
    const resultLabel = document.querySelector("#printer-test-result");
    submitButton.disabled = true;
    if (resultLabel) resultLabel.textContent = "正在发送…";
    try {
      const result = await api.printText({
        text: values.text,
        language: values.language,
        font: values.font,
        bold: printerTestForm.elements.bold.checked,
        underline: printerTestForm.elements.underline.checked,
        invert: printerTestForm.elements.invert.checked,
        width: Number(values.width),
        height: Number(values.height),
        align: values.align,
        feedAfter: Number(values.feedAfter),
        jobId: `test-${Date.now()}`,
        source: "device-test"
      });
      if (resultLabel) resultLabel.textContent = `${result.encoding} · ${result.encodedBytes} bytes · 已接收`;
      toast(result.encodingLossy ? "已打印，但内容含 GB2312 不支持的字符" : "测试内容已发送到真实打印机", result.encodingLossy ? "default" : "success");
    } catch (error) {
      if (resultLabel) resultLabel.textContent = "发送失败";
      toast(error.message, "error");
    } finally {
      submitButton.disabled = false;
    }
  };
  printerTestForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    await submitPrinterTest();
  });
  document.querySelector("[data-test-print]")?.addEventListener("click", submitPrinterTest);
  document.querySelectorAll("[data-printer-sample]").forEach((button) => button.addEventListener("click", () => {
    const chinese = button.dataset.printerSample === "zh";
    printerTestForm.elements.text.value = chinese ? "你好呀！\n我是打印机~" : "A";
    printerTestForm.elements.language.value = chinese ? "zh" : "en";
    printerTestForm.elements.font.value = chinese ? "B" : "A";
    printerTestForm.elements.bold.checked = true;
    printerTestForm.elements.underline.checked = !chinese;
    printerTestForm.elements.invert.checked = false;
    printerTestForm.elements.width.value = "1";
    printerTestForm.elements.height.value = "1";
    printerTestForm.elements.align.value = "center";
    printerTestForm.elements.feedAfter.value = chinese ? "3" : "2";
    printerTestForm.elements.text.focus();
  }));
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

  document.querySelector("#auth-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    try {
      if (event.currentTarget.dataset.auth === "login") await api.login(values.email, values.password);
      else await api.register(values.displayName, values.email, values.password);
      toast("欢迎进入 AI Hub OS", "success");
      navigate("/");
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
  if (currentPath() === "/entertainment" && ["ArrowUp", "ArrowDown"].includes(event.key)) {
    event.preventDefault();
    ui.runnerLane = event.key === "ArrowUp" ? "up" : "down";
    ui.runnerScore += 8;
    render();
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    navigate("/community");
    setTimeout(() => document.querySelector('#community-search-form input')?.focus(), 50);
  }
  if (event.key === "Escape") document.querySelector(".modal-overlay")?.remove();
});

render();
bus.send("web.hello", { client: "ai-hub-os-web", version: "0.5.0" });

