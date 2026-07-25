import { api } from "./services/api-client.js";

const root = document.querySelector("#app");
const toastRegion = document.querySelector("#toast");
const state = {
  user: null,
  letters: [],
  box: "all",
  loading: true
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function toast(message, kind = "error") {
  toastRegion.textContent = message;
  toastRegion.className = `show ${kind}`;
  setTimeout(() => {
    toastRegion.className = "";
  }, 3_000);
}

function navigate(path) {
  history.pushState({}, "", path);
  render();
}

function brand() {
  return `
    <a class="brand" href="/letters" data-link>
      <span class="brand-mark">L</span>
      <span><strong>Letter Space</strong><small>VOICE TO HEART</small></span>
    </a>
  `;
}

function authPage(mode) {
  const register = mode === "register";
  return `
    <main class="auth-shell">
      <section class="auth-story">
        ${brand()}
        <div class="story-copy">
          <p class="eyebrow">PRIVATE LETTER ARCHIVE</p>
          <h1>说出口的心意，<br>会抵达两个人的信箱。</h1>
          <p>Bot 完成语音写信后，信件会同时保存在发件人和收件人的 Letter Space。</p>
        </div>
        <div class="letter-preview" aria-hidden="true">
          <span>TO · SOMEONE SPECIAL</span>
          <p>愿每一次认真说出的话，<br>都能被好好保存。</p>
          <i>07 / 25</i>
        </div>
      </section>
      <section class="auth-panel">
        <div class="auth-card">
          <p class="eyebrow">${register ? "CREATE ACCOUNT" : "WELCOME BACK"}</p>
          <h2>${register ? "建立你的信件空间" : "回到你的信件空间"}</h2>
          <p class="auth-note">${register ? "注册后即可接收或保存 Bot 写下的信。" : "登录查看与你有关的全部信件。"}</p>
          <form id="auth-form" data-mode="${mode}">
            ${register ? `
              <label>昵称
                <input name="displayName" maxlength="40" autocomplete="name" required>
              </label>
            ` : ""}
            <label>邮箱
              <input name="email" type="email" autocomplete="email" required>
            </label>
            <label>密码
              <input
                name="password"
                type="password"
                minlength="8"
                maxlength="128"
                autocomplete="${register ? "new-password" : "current-password"}"
                required
              >
            </label>
            <button class="primary" type="submit">
              ${register ? "注册并进入" : "登录"}
            </button>
          </form>
          <p class="auth-switch">
            ${register ? "已经有账户？" : "第一次来到这里？"}
            <a href="${register ? "/login" : "/register"}" data-link>
              ${register ? "直接登录" : "创建账户"}
            </a>
          </p>
        </div>
      </section>
    </main>
  `;
}

function formatDate(value) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function letterCard(letter) {
  const received = letter.box === "inbox";
  const person = received ? letter.sender : letter.recipient;
  return `
    <article class="letter-card">
      <header>
        <span class="direction ${letter.box}">
          ${received ? "收到" : "寄出"}
        </span>
        <time>${formatDate(letter.createdAt)}</time>
      </header>
      <p class="counterpart">${received ? "来自" : "写给"} · ${escapeHtml(person.displayName)}</p>
      <h2>${escapeHtml(letter.subject)}</h2>
      <p class="letter-content">${escapeHtml(letter.content)}</p>
      <footer>
        <span>${letter.source === "app_voice" ? "Bot 语音写信" : "Letter Space"}</span>
        <span>${escapeHtml(person.email)}</span>
      </footer>
    </article>
  `;
}

function mailboxPage() {
  const filters = [
    ["all", "全部"],
    ["inbox", "收件箱"],
    ["sent", "已寄出"]
  ];
  return `
    <div class="mailbox-shell">
      <header class="topbar">
        ${brand()}
        <div class="account">
          <span class="avatar">${escapeHtml(state.user.displayName.slice(0, 1))}</span>
          <span><strong>${escapeHtml(state.user.displayName)}</strong><small>${escapeHtml(state.user.email)}</small></span>
          <button id="logout" type="button">退出</button>
        </div>
      </header>
      <main class="mailbox">
        <section class="mailbox-head">
          <div>
            <p class="eyebrow">SHARED LETTERS</p>
            <h1>与你有关的信</h1>
            <p>一封信只保存一次，却会同时出现在发件人与收件人的空间里。</p>
          </div>
          <div class="sync-badge"><i></i><span>支持 App 语音写信同步</span></div>
        </section>
        <nav class="filters" aria-label="信箱筛选">
          ${filters.map(([value, label]) => `
            <button
              type="button"
              data-box="${value}"
              class="${state.box === value ? "active" : ""}"
            >${label}</button>
          `).join("")}
        </nav>
        <section class="letter-grid">
          ${state.loading ? `<div class="empty">正在打开信箱…</div>` : ""}
          ${!state.loading && state.letters.length === 0 ? `
            <div class="empty">
              <span>✦</span>
              <h2>这里还没有信</h2>
              <p>在 Bot 上完成一次语音写信，它就会出现在这里。</p>
            </div>
          ` : state.letters.map(letterCard).join("")}
        </section>
      </main>
    </div>
  `;
}

async function loadLetters(box = state.box) {
  state.loading = true;
  state.box = box;
  render();
  try {
    const result = await api.letters(box);
    state.letters = result.letters;
  } catch (error) {
    if (error.status === 401) {
      state.user = null;
      navigate("/login");
      return;
    }
    toast(error.message);
  } finally {
    state.loading = false;
    render();
  }
}

function bindEvents() {
  document.querySelectorAll("[data-link]").forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      navigate(link.getAttribute("href"));
    });
  });

  document.querySelector("#auth-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form));
    const button = form.querySelector("button");
    button.disabled = true;
    try {
      const result = form.dataset.mode === "register"
        ? await api.register(data)
        : await api.login(data);
      state.user = result.user;
      history.replaceState({}, "", "/letters");
      await loadLetters("all");
    } catch (error) {
      toast(error.message);
    } finally {
      button.disabled = false;
    }
  });

  document.querySelector("#logout")?.addEventListener("click", async () => {
    await api.logout();
    state.user = null;
    state.letters = [];
    navigate("/login");
  });

  document.querySelectorAll("[data-box]").forEach((button) => {
    button.addEventListener("click", () => loadLetters(button.dataset.box));
  });
}

function render() {
  const path = window.location.pathname;
  if (state.user) {
    if (path !== "/letters") history.replaceState({}, "", "/letters");
    root.innerHTML = mailboxPage();
  } else {
    const mode = path === "/register" ? "register" : "login";
    if (!["/login", "/register"].includes(path)) {
      history.replaceState({}, "", "/login");
    }
    root.innerHTML = authPage(mode);
  }
  bindEvents();
}

window.addEventListener("popstate", render);

async function boot() {
  try {
    const result = await api.session();
    state.user = result.user;
  } catch {
    state.user = null;
  }
  state.loading = false;
  render();
  if (state.user) await loadLetters("all");
}

boot();
