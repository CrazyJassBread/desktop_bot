import { api } from "./services/api-client.js";

const root = document.querySelector("#app");
const toastRegion = document.querySelector("#toast");
const state = {
  user: null,
  letters: [],
  friends: [],
  incoming: [],
  outgoing: [],
  drafts: [],
  box: "inbox",
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

function formatDate(value) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function brand() {
  return `
    <a class="brand" href="/letters" data-link>
      <span class="brand-mark">笺</span>
      <span><strong>Letter Space</strong><small>写给远方，也写给此刻</small></span>
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
          <p class="eyebrow">A QUIET PLACE FOR LETTERS</p>
          <h1>慢一点写，<br>让心意抵达。</h1>
          <p>创建自己的信箱，认识笔友，把想说的话写成一封值得保存的信。</p>
        </div>
        <div class="letter-preview" aria-hidden="true">
          <span>TO · MY PEN PAL</span>
          <p>见字如面。今天的风很好，<br>想把这份轻快也寄给你。</p>
          <i>LETTER SPACE</i>
        </div>
      </section>
      <section class="auth-panel">
        <div class="auth-card">
          <p class="eyebrow">${register ? "CREATE ACCOUNT" : "WELCOME BACK"}</p>
          <h2>${register ? "建立你的信箱" : "回到你的信箱"}</h2>
          <p class="auth-note">${register ? "注册后即可添加笔友、写信与保存草稿" : "登录继续读信和写信"}</p>
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
              <input name="password" type="password" minlength="8" maxlength="128"
                autocomplete="${register ? "new-password" : "current-password"}" required>
            </label>
            <button class="primary" type="submit">${register ? "注册并进入" : "登录"}</button>
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

function appHeader() {
  const path = window.location.pathname;
  const links = [
    ["/letters", "信箱"],
    ["/friends", "笔友"],
    ["/drafts", `草稿 ${state.drafts.length ? `<b>${state.drafts.length}</b>` : ""}`]
  ];
  return `
    <header class="topbar">
      ${brand()}
      <nav class="main-nav" aria-label="主要功能">
        ${links.map(([href, label]) => `
          <a href="${href}" data-link class="${path === href ? "active" : ""}">${label}</a>
        `).join("")}
      </nav>
      <div class="account">
        <a class="compose-button" href="/compose" data-link>写一封信</a>
        <span class="avatar">${escapeHtml(state.user.displayName.slice(0, 1))}</span>
        <span><strong>${escapeHtml(state.user.displayName)}</strong><small>${escapeHtml(state.user.email)}</small></span>
        <button id="logout" type="button">退出</button>
      </div>
    </header>
  `;
}

function letterCard(letter) {
  const received = letter.box === "inbox";
  const person = received ? letter.sender : letter.recipient;
  return `
    <article class="letter-card">
      <header>
        <span class="direction ${letter.box}">${received ? "收到" : "寄出"}</span>
        <time>${formatDate(letter.createdAt)}</time>
      </header>
      <p class="counterpart">${received ? "来自" : "写给"} · ${escapeHtml(person.displayName)}</p>
      <h2>${escapeHtml(letter.subject)}</h2>
      <p class="letter-content">${escapeHtml(letter.content)}</p>
      <footer>
        <span>${letter.source === "app_voice" ? "语音来信" : "网页信件"}</span>
        <span>${escapeHtml(person.email)}</span>
      </footer>
    </article>
  `;
}

function lettersPage() {
  const visible = state.box === "all"
    ? state.letters
    : state.letters.filter((letter) => letter.box === state.box);
  return `
    <main class="page">
      <section class="page-head">
        <div>
          <p class="eyebrow">YOUR LETTER BOX</p>
          <h1>与你有关的信</h1>
          <p>每一封寄出的信，也会留在自己的时光里。</p>
        </div>
        <a class="large-action" href="/compose" data-link><span>＋</span>开始写信</a>
      </section>
      <nav class="filters" aria-label="信箱筛选">
        ${[["inbox", "收件箱"], ["sent", "已寄出"], ["all", "全部"]].map(([value, label]) => `
          <button type="button" data-box="${value}" class="${state.box === value ? "active" : ""}">
            ${label}
          </button>
        `).join("")}
      </nav>
      <section class="letter-grid">
        ${state.loading ? `<div class="empty">正在打开信箱…</div>` : ""}
        ${!state.loading && visible.length === 0 ? `
          <div class="empty">
            <span>✦</span><h2>这里还没有信</h2>
            <p>${state.friends.length ? "给笔友写下第一封信吧。" : "先添加一位笔友，再开始通信。"}</p>
            <a href="${state.friends.length ? "/compose" : "/friends"}" data-link>
              ${state.friends.length ? "开始写信" : "添加笔友"}
            </a>
          </div>
        ` : visible.map(letterCard).join("")}
      </section>
    </main>
  `;
}

function friendRow(item, action = "") {
  return `
    <article class="person-row">
      <span class="person-avatar">${escapeHtml(item.user.displayName.slice(0, 1))}</span>
      <div><strong>${escapeHtml(item.user.displayName)}</strong><small>${escapeHtml(item.user.email)}</small></div>
      ${action === "accept"
        ? `<button class="small-primary" data-accept="${escapeHtml(item.user.id)}">接受</button>`
        : action === "pending"
          ? `<span class="pending">等待回应</span>`
          : `<a href="/compose?to=${encodeURIComponent(item.user.id)}" data-link>写信</a>`}
    </article>
  `;
}

function friendsPage() {
  return `
    <main class="page narrow">
      <section class="page-head">
        <div>
          <p class="eyebrow">PEN PALS</p>
          <h1>我的笔友</h1>
          <p>通过注册邮箱找到朋友，双方确认后即可通信。</p>
        </div>
      </section>
      <section class="friend-layout">
        <div class="panel">
          <h2>添加笔友</h2>
          <p>输入对方注册 Letter Space 时使用的邮箱。</p>
          <form id="friend-form" class="inline-form">
            <input name="email" type="email" placeholder="friend@example.com" required>
            <button class="primary" type="submit">发送申请</button>
          </form>
        </div>
        ${state.incoming.length ? `
          <div class="panel"><h2>收到的申请</h2>${state.incoming.map((item) => friendRow(item, "accept")).join("")}</div>
        ` : ""}
        <div class="panel">
          <h2>笔友名单 <span>${state.friends.length}</span></h2>
          ${state.friends.length
            ? state.friends.map((item) => friendRow(item)).join("")
            : `<div class="soft-empty">还没有笔友，向认识的人发送第一份申请吧。</div>`}
        </div>
        ${state.outgoing.length ? `
          <div class="panel"><h2>已发送的申请</h2>${state.outgoing.map((item) => friendRow(item, "pending")).join("")}</div>
        ` : ""}
      </section>
    </main>
  `;
}

function draftCard(draft) {
  return `
    <article class="draft-card">
      <div>
        <span>${draft.recipient ? `写给 ${escapeHtml(draft.recipient.displayName)}` : "尚未选择收件人"}</span>
        <time>更新于 ${formatDate(draft.updatedAt)}</time>
      </div>
      <h2>${escapeHtml(draft.subject || "无主题草稿")}</h2>
      <p>${escapeHtml(draft.content || "还没有写下正文。")}</p>
      <footer>
        <a href="/compose?draft=${encodeURIComponent(draft.id)}" data-link>继续写</a>
        <button data-delete-draft="${escapeHtml(draft.id)}">删除</button>
      </footer>
    </article>
  `;
}

function draftsPage() {
  return `
    <main class="page">
      <section class="page-head">
        <div>
          <p class="eyebrow">UNFINISHED THOUGHTS</p>
          <h1>草稿箱</h1>
          <p>未说完的话会安静地留在这里，等你回来。</p>
        </div>
        <a class="large-action" href="/compose" data-link><span>＋</span>新建草稿</a>
      </section>
      <section class="draft-grid">
        ${state.drafts.length
          ? state.drafts.map(draftCard).join("")
          : `<div class="empty"><span>✎</span><h2>没有未完成的信</h2><p>开始写信后，可以随时保存到草稿箱。</p></div>`}
      </section>
    </main>
  `;
}

function composePage() {
  const params = new URLSearchParams(location.search);
  const draft = state.drafts.find((item) => item.id === params.get("draft"));
  const selectedRecipient = draft?.recipient?.id ?? params.get("to") ?? "";
  return `
    <main class="compose-page">
      <a class="back-link" href="${draft ? "/drafts" : "/letters"}" data-link>← 返回</a>
      <section class="compose-paper">
        <header>
          <div><p class="eyebrow">NEW LETTER</p><h1>${draft ? "继续写这封信" : "写一封信"}</h1></div>
          <span>见字如面</span>
        </header>
        ${state.friends.length === 0 ? `
          <div class="compose-empty">
            <h2>先添加一位笔友</h2>
            <p>双方成为笔友后，才可以互相寄信。</p>
            <a href="/friends" data-link>前往添加笔友</a>
          </div>
        ` : `
          <form id="compose-form" data-draft-id="${escapeHtml(draft?.id ?? "")}">
            <label>写给
              <select name="recipientUserId" required>
                <option value="">选择一位笔友</option>
                ${state.friends.map(({ user }) => `
                  <option value="${escapeHtml(user.id)}" ${user.id === selectedRecipient ? "selected" : ""}>
                    ${escapeHtml(user.displayName)} · ${escapeHtml(user.email)}
                  </option>
                `).join("")}
              </select>
            </label>
            <label>主题
              <input name="subject" maxlength="120" value="${escapeHtml(draft?.subject ?? "")}" placeholder="这封信想说什么？" required>
            </label>
            <label>正文
              <textarea name="content" maxlength="20000" placeholder="见字如面……" required>${escapeHtml(draft?.content ?? "")}</textarea>
            </label>
            <div class="compose-actions">
              <button class="secondary" name="intent" value="draft" type="submit">保存到草稿箱</button>
              <button class="primary" name="intent" value="send" type="submit">寄出这封信</button>
            </div>
          </form>
        `}
      </section>
    </main>
  `;
}

async function loadData() {
  state.loading = true;
  render();
  try {
    const [letters, friendships, drafts] = await Promise.all([
      api.letters("all"),
      api.friends(),
      api.drafts()
    ]);
    state.letters = letters.letters;
    state.friends = friendships.friends;
    state.incoming = friendships.incoming;
    state.outgoing = friendships.outgoing;
    state.drafts = drafts.drafts;
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
    const button = form.querySelector("button");
    button.disabled = true;
    try {
      const data = Object.fromEntries(new FormData(form));
      const result = form.dataset.mode === "register"
        ? await api.register(data)
        : await api.login(data);
      state.user = result.user;
      history.replaceState({}, "", "/letters");
      await loadData();
    } catch (error) {
      toast(error.message);
      button.disabled = false;
    }
  });

  document.querySelector("#logout")?.addEventListener("click", async () => {
    await api.logout();
    Object.assign(state, {
      user: null, letters: [], friends: [], incoming: [], outgoing: [], drafts: []
    });
    navigate("/login");
  });

  document.querySelectorAll("[data-box]").forEach((button) => {
    button.addEventListener("click", () => {
      state.box = button.dataset.box;
      render();
    });
  });

  document.querySelector("#friend-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector("button");
    button.disabled = true;
    try {
      const result = await api.requestFriend(new FormData(form).get("email"));
      Object.assign(state, result);
      form.reset();
      render();
      toast("笔友申请已发送", "success");
    } catch (error) {
      toast(error.message);
      button.disabled = false;
    }
  });

  document.querySelectorAll("[data-accept]").forEach((button) => {
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        Object.assign(state, await api.acceptFriend(button.dataset.accept));
        render();
        toast("你们已经成为笔友", "success");
      } catch (error) {
        toast(error.message);
        button.disabled = false;
      }
    });
  });

  document.querySelectorAll("[data-delete-draft]").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!confirm("确定删除这封草稿吗？")) return;
      try {
        await api.deleteDraft(button.dataset.deleteDraft);
        state.drafts = state.drafts.filter(
          (draft) => draft.id !== button.dataset.deleteDraft
        );
        render();
        toast("草稿已删除", "success");
      } catch (error) {
        toast(error.message);
      }
    });
  });

  document.querySelector("#compose-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const submitter = event.submitter;
    const data = Object.fromEntries(new FormData(form));
    form.querySelectorAll("button").forEach((button) => {
      button.disabled = true;
    });
    try {
      if (submitter.value === "draft") {
        const result = form.dataset.draftId
          ? await api.updateDraft(form.dataset.draftId, data)
          : await api.createDraft(data);
        const index = state.drafts.findIndex((item) => item.id === result.draft.id);
        if (index >= 0) state.drafts[index] = result.draft;
        else state.drafts.unshift(result.draft);
        navigate("/drafts");
        toast("草稿已保存", "success");
      } else {
        await api.sendLetter({ ...data, draftId: form.dataset.draftId || null });
        await loadData();
        state.box = "sent";
        navigate("/letters");
        toast("信已经寄出", "success");
      }
    } catch (error) {
      toast(error.message);
      form.querySelectorAll("button").forEach((button) => {
        button.disabled = false;
      });
    }
  });
}

function render() {
  const path = window.location.pathname;
  if (!state.user) {
    const mode = path === "/register" ? "register" : "login";
    if (!["/login", "/register"].includes(path)) {
      history.replaceState({}, "", "/login");
    }
    root.innerHTML = authPage(mode);
  } else {
    const allowed = ["/letters", "/friends", "/drafts", "/compose"];
    if (!allowed.includes(path)) {
      history.replaceState({}, "", "/letters");
    }
    const current = window.location.pathname;
    const content = current === "/friends"
      ? friendsPage()
      : current === "/drafts"
        ? draftsPage()
        : current === "/compose"
          ? composePage()
          : lettersPage();
    root.innerHTML = `<div class="app-shell">${appHeader()}${content}</div>`;
  }
  bindEvents();
}

window.addEventListener("popstate", render);

async function boot() {
  try {
    state.user = (await api.session()).user;
  } catch {
    state.user = null;
  }
  state.loading = false;
  render();
  if (state.user) await loadData();
}

boot();
