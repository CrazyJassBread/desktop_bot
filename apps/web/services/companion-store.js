const STORAGE_KEY = "mimo-companion-state-v1";

export const DEVICE_MODES = Object.freeze([
  "idle",
  "active",
  "listening",
  "camera",
  "printing",
  "game",
  "sleeping",
  "soft_off"
]);

export const initialCompanionState = Object.freeze({
  session: {
    signedIn: true,
    user: { name: "小绪", email: "hello@mimo.local", plan: "Explorer" }
  },
  device: {
    id: "mimo-desk-01",
    name: "小P",
    connected: false,
    mode: "idle",
    power: "on",
    battery: 82,
    charging: true,
    wifi: "Studio Wi-Fi",
    language: "CN",
    firmware: "0.3.0-mvp",
    latency: null,
    hardware: {
      microphone: "ready",
      camera: "ready",
      printer: "ready",
      distance: "ready",
      display: "ready"
    }
  },
  profile: {
    city: "上海",
    companionTone: "温暖、简洁",
    wakeWord: "Hi 小P"
  },
  tasks: [
    { id: "task-1", title: "复习 20 个英语单词", time: "09:30", done: false },
    { id: "task-2", title: "安静阅读 15 分钟", time: "14:00", done: false },
    { id: "task-3", title: "给未来的自己写封信", time: "20:30", done: true }
  ],
  study: {
    streak: 7,
    wordIndex: 0,
    words: [
      { word: "serendipity", phonetic: "/ˌserənˈdɪpəti/", meaning: "意外发现美好事物的能力", example: "Meeting 小P was pure serendipity." },
      { word: "curious", phonetic: "/ˈkjʊəriəs/", meaning: "好奇的；求知欲强的", example: "Stay curious about how things work." },
      { word: "companion", phonetic: "/kəmˈpænjən/", meaning: "伙伴；陪伴者", example: "A quiet companion sits on the desk." },
      { word: "gentle", phonetic: "/ˈdʒentl/", meaning: "温和的；轻柔的", example: "Be gentle with your unfinished plans." },
      { word: "wander", phonetic: "/ˈwɒndə(r)/", meaning: "漫步；闲逛", example: "We wandered through the city after the rain." }
    ]
  },
  journal: [
    { id: "journal-1", date: "今天", mood: "calm", title: "一个安静的下午", body: "把设备和网页真正连起来了，事情开始变得具体。", summary: "今天的关键词是：连接、进展、平静。" }
  ],
  messages: [
    { role: "assistant", content: "下午好，我是小P。今天想一起学点什么？" }
  ],
  letters: [],
  printJobs: [
    { id: "print-1", title: "Morning Brief", kind: "brief", status: "done", createdAt: "08:02", content: "上海 26°C · 今日 3 项任务 · AI 芯片简报已更新" }
  ],
  automations: [
    { id: "auto-1", name: "Morning Brief", time: "08:00", sources: ["天气", "日历", "AI 新闻"], enabled: true },
    { id: "auto-2", name: "Night Note", time: "22:30", sources: ["Todo", "手帐"], enabled: false }
  ],
  activity: [
    { id: "log-1", time: "08:02", type: "print", text: "Morning Brief 已打印" },
    { id: "log-2", time: "07:58", type: "sync", text: "设备数据已同步" }
  ],
  eggOpenedAt: null
});

export function cloneInitialState() {
  return JSON.parse(JSON.stringify(initialCompanionState));
}

export function resolveDeviceTransition(currentMode, event) {
  const current = DEVICE_MODES.includes(currentMode) ? currentMode : "idle";
  const transitions = {
    wake: "active",
    idle: "idle",
    listen: "listening",
    camera: "camera",
    print: "printing",
    game: "game",
    sleep: "sleeping",
    shutdown: "soft_off",
    complete: current === "soft_off" ? "soft_off" : "active",
    reboot: "idle"
  };

  if (current === "soft_off" && !["wake", "reboot"].includes(event)) return current;
  return transitions[event] ?? current;
}

export function mapGestureToAction(gesture, language = "CN") {
  const actions = {
    v_sign: { type: "language", value: language === "CN" ? "EN" : "CN", label: "切换语言" },
    open_palm: { type: "camera.capture", value: null, label: "拍照" },
    up: { type: "game.control", value: "up", label: "游戏：向上" },
    down: { type: "game.control", value: "down", label: "游戏：向下" },
    wave: { type: "device.wake", value: null, label: "唤醒设备" }
  };
  return actions[gesture] ?? { type: "unknown", value: gesture, label: "未知手势" };
}

export function createPrintJob(input, now = new Date()) {
  const title = String(input?.title ?? "PrintPal Note").trim().slice(0, 80) || "PrintPal Note";
  const content = String(input?.content ?? "").trim().slice(0, 2_000);
  return {
    id: `print-${now.getTime()}`,
    title,
    content,
    kind: input?.kind ?? "note",
    status: "queued",
    createdAt: now.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false })
  };
}

export function createLetter({ recipient, subject, keywords, tone = "温暖" }) {
  const who = String(recipient || "远方的朋友").trim();
  const topic = String(subject || "最近的生活").trim();
  const detail = String(keywords || "分享一些平凡但闪亮的瞬间").trim();
  return {
    subject: topic,
    body: `${who}：\n\n见字如面。\n\n想和你聊聊「${topic}」。${detail}。有时生活像桌边缓慢亮起的一盏小灯，不催促，却让人安心。希望这封信抵达时，你刚好有一段安静的时间。\n\n愿你今天也遇见一点小小的好事。\n\n来自小P与我`,
    tone
  };
}

export function answerLearningQuestion(question) {
  const text = String(question || "").trim();
  if (!text) return "先写下你的问题吧，我会把它拆成容易理解的步骤。";
  if (/esp32|单片机|mqtt/i.test(text)) {
    return "可以把它理解成三层：设备负责感知与执行，MQTT 负责可靠传递消息，Web/Agent 负责理解意图并下发命令。MVP 先用设备影子保存状态，再逐步接入真实 Broker。";
  }
  if (/英语|英文|word|vocabulary/i.test(text)) {
    return "试试“看词义 → 朗读 → 用自己的生活造句 → 隔天复习”的四步法。一次学习 5–10 个词，比一次塞进很多词更容易形成长期记忆。";
  }
  return `我们可以这样理解「${text}」：先找出核心概念，再用一个生活例子验证，最后用一句自己的话复述。你想让我继续给出例子，还是出一道小测验？`;
}

export function reduceCompanionState(state, action) {
  const next = JSON.parse(JSON.stringify(state));
  const now = new Date();

  switch (action.type) {
    case "session.signIn":
      next.session.signedIn = true;
      next.session.user = { ...next.session.user, ...action.user };
      return next;
    case "session.signOut":
      next.session.signedIn = false;
      return next;
    case "device.patch":
      next.device = { ...next.device, ...action.patch };
      return next;
    case "device.transition":
      next.device.mode = resolveDeviceTransition(next.device.mode, action.event);
      next.device.power = next.device.mode === "soft_off" ? "soft_off" : "on";
      return next;
    case "task.toggle": {
      const task = next.tasks.find((item) => item.id === action.id);
      if (task) task.done = !task.done;
      return next;
    }
    case "task.add":
      next.tasks.push(action.task);
      return next;
    case "tasks.replace":
      next.tasks = (action.tasks ?? []).slice(0, 12).map((task, index) => ({
        id: task.id ?? `task-ai-${now.getTime()}-${index}`,
        title: String(task.title ?? "").trim(),
        time: String(task.time ?? "今天").trim(),
        done: Boolean(task.done)
      })).filter((task) => task.title);
      return next;
    case "study.next":
      next.study.wordIndex = (next.study.wordIndex + 1) % next.study.words.length;
      return next;
    case "message.add":
      next.messages.push(action.message);
      return next;
    case "messages.clear":
      next.messages = [{ role: "assistant", content: "对话已经清空。今天想一起学点什么？" }];
      return next;
    case "journal.add":
      next.journal.unshift(action.entry);
      return next;
    case "letter.add":
      next.letters.unshift(action.letter);
      return next;
    case "print.queue":
      next.printJobs.unshift(action.job);
      next.activity.unshift({ id: `log-${now.getTime()}`, time: action.job.createdAt, type: "print", text: `${action.job.title} 等待打印` });
      return next;
    case "print.status": {
      const job = next.printJobs.find((item) => item.id === action.id);
      if (job) job.status = action.status;
      return next;
    }
    case "automation.toggle": {
      const item = next.automations.find((automation) => automation.id === action.id);
      if (item) item.enabled = !item.enabled;
      return next;
    }
    case "egg.open":
      next.eggOpenedAt = now.toISOString().slice(0, 10);
      return next;
    default:
      return next;
  }
}

export function createCompanionStore(storage = globalThis.localStorage) {
  let state = cloneInitialState();
  const listeners = new Set();

  try {
    const saved = storage?.getItem(STORAGE_KEY);
    if (saved) state = { ...state, ...JSON.parse(saved) };
  } catch {
    // The product remains usable when storage is unavailable.
  }

  function persist() {
    try {
      storage?.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Persistence is optional in the no-database MVP.
    }
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispatch(action) {
      state = reduceCompanionState(state, action);
      persist();
      listeners.forEach((listener) => listener(state, action));
      return state;
    },
    reset() {
      state = cloneInitialState();
      persist();
      listeners.forEach((listener) => listener(state, { type: "reset" }));
    }
  };
}
