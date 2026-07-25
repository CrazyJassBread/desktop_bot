import { deepSeekChat } from "./deepseek-client.mjs";

const PRINT_CONFIRMATION = /^(打印|开始打印|确认打印|可以打印|帮我打印)$/u;
const LETTER_FINISH = /(?:\bover\b|发送信件|帮我整理一下|写好了|可以了|就这些|说完了|结束写信|结束)[\s，,。.!！?？;；]*$/iu;
const LETTER_CONFIRMATION = /^(确认发送|可以发|就这样发|发送吧|确认|发吧|可以发送|按这个版本发送)$/u;
const LETTER_CANCEL = /^(取消|不要发了|退出写信|取消发送)$/u;

function cleanText(value, max = 1_500) {
  return String(value ?? "").replace(/\r\n?/g, "\n").trim().slice(0, max);
}

function planItems(text) {
  return cleanText(text, 1_200)
    .split(/[\n，,；;。]+/u)
    .map((item) => item.replace(/^(今天|然后|接着|还要|需要|我要|我想)\s*/u, "").trim())
    .filter((item) => item.length >= 2)
    .slice(0, 8)
    .map((title, index) => ({ title, time: index < 2 ? "上午" : index < 5 ? "下午" : "晚上" }));
}

function printable(kind, title, content, extra = {}) {
  return { kind, title, content: cleanText(content, 2_400), ...extra };
}

export function splitVoiceLetterFinish(value) {
  const text = cleanText(value, 1_500);
  const match = text.match(LETTER_FINISH);
  if (!match) return { finished: false, content: text, keyword: null };
  const keywordMatch = match[0].match(/over|发送信件|帮我整理一下|写好了|可以了|就这些|说完了|结束写信|结束/iu);
  return {
    finished: true,
    content: text.slice(0, match.index).trim(),
    keyword: keywordMatch?.[0] ?? "结束"
  };
}

export function extractVoiceLetterStart(value) {
  const text = cleanText(value, 1_500);
  const chinese = text.match(/(?:小P[，,]?\s*)?(?:我要|我想|请|麻烦|帮我)?(?:给|向|把这些话发给)(.{1,32}?)(?:写|寄|发|传|转告|留言|告诉)(?:一?封|一段话|个话)?(?:信|邮件|消息|话|留言)?(?:[，,：:]?\s*(.*))?$/u);
  if (chinese) {
    return {
      started: true,
      recipient: cleanText(chinese[1].replace(/^(一个|那位|这个)/u, ""), 32),
      content: cleanText(chinese[2], 1_200)
    };
  }
  const relay = text.match(/(?:帮我)?(?:告诉|转告)(.{1,32}?)(?:[，,：:]?\s*(.*))?$/u);
  if (relay) {
    return {
      started: true,
      recipient: cleanText(relay[1].replace(/^(一个|那位|这个)/u, ""), 32),
      content: cleanText(relay[2], 1_200)
    };
  }
  const english = text.match(/(?:please\s+)?(?:write|send)\s+(?:a\s+)?(?:letter|mail)\s+to\s+(.{1,32}?)(?:[,:]\s*(.*))?$/iu);
  if (english) {
    return {
      started: true,
      recipient: cleanText(english[1], 32),
      content: cleanText(english[2], 1_200)
    };
  }
  if (/(?:发邮件|帮我写信|我要写一封信|开始写信|写封信|传个话|转告一下|发一段话|留言)/u.test(text)) {
    return { started: true, recipient: null, content: "" };
  }
  return { started: false, recipient: null, content: "" };
}

export function fallbackIntent(transcript, context = {}) {
  const text = cleanText(transcript, 1_500);
  const lower = text.toLowerCase();
  const pending = context.pendingPrintable;
  const letterMode = String(context.mode ?? "").startsWith("letter");
  const letterFinish = splitVoiceLetterFinish(text);
  if (letterMode && LETTER_CANCEL.test(text)) {
    return { intent: "LETTER_CANCELLED", reply: "好的，已经取消这封信。", mode: "default", requiresConfirmation: false };
  }
  if (letterMode && LETTER_CONFIRMATION.test(text)) {
    return { intent: "LETTER_CONFIRM_SEND", reply: "好的，正在发送这封信。", mode: "letter_sending", requiresConfirmation: false, executeSendLetter: true };
  }
  if (letterMode && letterFinish.finished) {
    return {
      intent: "LETTER_REVIEW",
      reply: "我已经整理好了。要按这个版本发送给对方吗？",
      mode: "letter_review",
      requiresConfirmation: true,
      finishKeyword: letterFinish.keyword,
      trailingContent: letterFinish.content
    };
  }
  if (PRINT_CONFIRMATION.test(text) && pending) {
    return {
      intent: "CONFIRM_PRINT",
      reply: `好的，准备打印《${pending.title || "这份内容"}》。`,
      requiresConfirmation: false,
      executeConfirmedPrint: true,
      printable: pending
    };
  }
  if (/(生成|画|做|打印).*(图片|图像|像素图|动漫图|卡片|生日祝福)|动漫图片|生日祝福卡片/u.test(text)) {
    const prompt = text
      .replace(/^(帮我|请|麻烦|我想|我要)/u, "")
      .replace(/(生成|画|做|打印|一张|一个|图片|图像|像素图)/gu, "")
      .trim() || "高对比度 8-bit 像素艺术图片";
    return {
      intent: "OPEN_IMAGE_STUDIO",
      reply: "已经打开图像处理。请拍照或上传图片，系统会自动像素化并生成热敏打印预览。",
      navigation: "/images",
      imageDescription: prompt,
      requiresConfirmation: false
    };
  }
  if (/拍(一张)?照片|打开相机|拍照/u.test(text)) {
    return { intent: "CAMERA_CAPTURE", reply: "好的，正在让桌面设备拍一张照片。", requiresConfirmation: false, deviceAction: { type: "camera.capture" } };
  }
  if (/打开|查看|显示/u.test(text) && /设备状态/u.test(text)) {
    return { intent: "DEVICE_STATUS", reply: "正在读取设备、网络和打印机状态。", requiresConfirmation: false, deviceAction: { type: "device.status" } };
  }
  if (/调高|增大|大一点/u.test(text) && /音量/u.test(text)) {
    return { intent: "VOLUME_UP", reply: "音量已经调高。", requiresConfirmation: false, deviceAction: { type: "audio.volume", delta: 10 } };
  }
  if (/调低|减小|小一点/u.test(text) && /音量/u.test(text)) {
    return { intent: "VOLUME_DOWN", reply: "音量已经调低。", requiresConfirmation: false, deviceAction: { type: "audio.volume", delta: -10 } };
  }
  if (/亮度/u.test(text) && /调低|降低|暗一点/u.test(text)) {
    return { intent: "BRIGHTNESS_DOWN", reply: "屏幕亮度已经调低。", requiresConfirmation: false, deviceAction: { type: "display.brightness", delta: -10 } };
  }
  if (/亮度/u.test(text) && /调高|提高|亮一点/u.test(text)) {
    return { intent: "BRIGHTNESS_UP", reply: "屏幕亮度已经调高。", requiresConfirmation: false, deviceAction: { type: "display.brightness", delta: 10 } };
  }
  if (/进入聊天模式/u.test(text)) {
    return { intent: "ENTER_CHAT_MODE", reply: "已经进入聊天模式，我会专心听你说。", mode: "chat", requiresConfirmation: false };
  }
  if (/退出聊天模式/u.test(text)) {
    return { intent: "EXIT_CHAT_MODE", reply: "已经退出聊天模式。", mode: "default", requiresConfirmation: false };
  }
  if (/重新打印|再打印/u.test(text) && /(上一条|刚才|上一个)/u.test(text)) {
    return { intent: "REPRINT_LAST", reply: "我找到了上一条打印内容，请确认后重新打印。", requiresConfirmation: true, reprintLast: true };
  }
  if (/打印.*(系统|AI).*(回答|回复)|把.*(回答|回复).*打印/u.test(text)) {
    const assistant = [...(context.recentConversation ?? [])].reverse().find((message) => message.role === "assistant");
    return {
      intent: "PRINT_ASSISTANT_REPLY",
      reply: assistant ? "系统刚才的回复已经整理好了，请确认后打印。" : "目前还没有可以打印的系统回复。",
      requiresConfirmation: Boolean(assistant),
      printable: assistant ? printable("chat", "AI 回复", assistant.content) : null
    };
  }
  if (/海龟汤/u.test(text) && /(玩|开始|来一局|进入)/u.test(text)) {
    return { intent: "START_TURTLE_SOUP", reply: "好呀，正在准备海龟汤。", mode: "turtle_soup", requiresConfirmation: false };
  }
  if (/昨天|上次|保存|草稿|历史/u.test(text) && /信/u.test(text) && /打印/u.test(text)) {
    return {
      intent: "PRINT_SAVED_LETTER",
      reply: "我理解为要打印之前保存的信。请先在信件列表里确认具体信件，避免误打印。",
      navigation: "/letter",
      requiresConfirmation: false
    };
  }
  if (/(今天|今日|上午|下午|晚上|早上).*(要|准备|需要|打算)/u.test(text) && /[，,；;。]/u.test(text)) {
    const todos = planItems(text);
    return {
      intent: "ORGANIZE_PLAN",
      reply: todos.length ? "我把今天的安排整理成 Todo List 了。" : "请告诉我今天准备做哪些事情。",
      requiresConfirmation: false,
      todos,
      printable: todos.length ? printable("todo", "今日计划", [
        "====== 今日计划 ======",
        "",
        `日期：${new Date().toISOString().slice(0, 10)}`,
        "",
        ...todos.map((item, index) => `${index + 1}. ☐ ${item.title}`),
        "",
        "================"
      ].join("\n")) : null
    };
  }
  const letterStart = extractVoiceLetterStart(text);
  if (letterStart.started && letterStart.recipient) {
    const recipient = letterStart.recipient;
    return {
      intent: "WRITE_LETTER",
      reply: letterStart.content ? "我先记下这段内容，整理好后会给你确认。" : `好的，你想对${recipient}说些什么？`,
      mode: letterStart.content ? "letter_collecting" : "letter_waiting_content",
      recipient,
      rawContent: letterStart.content,
      requiresConfirmation: false
    };
  }
  if (letterStart.started) {
    return { intent: "WRITE_LETTER", reply: "这封信想发给谁？", mode: "letter_waiting_recipient", recipient: null, requiresConfirmation: false };
  }
  if (letterMode) {
    const recipient = cleanText(context.recipient || "对方", 32);
    const clipped = text.length >= 1_200;
    const body = `${recipient}：\n\n${text.replace(/(嗯|啊|呃|那个|就是|然后|怎么说呢)/gu, "").replace(/([，。！？])\1+/gu, "$1")}\n\n愿你一切都好。\n\n来自我`;
    return {
      intent: "LETTER_CONTENT",
      reply: clipped ? "内容有点长了，我先帮你整理这一段。" : "好的，这一段已经记下了。你可以继续说，说“结束”后我帮你整理。",
      mode: "letter_collecting",
      recipient,
      requiresConfirmation: false,
      warning: clipped ? "VOICE_CONTENT_CLIPPED" : null,
      printable: printable("letter", `写给${recipient}的信`, body, { recipient, subject: "一封想对你说的话" })
    };
  }
  if (/打印.*(刚才|最近).*(对话|聊天)|把.*(对话|聊天).*打印/u.test(text)) {
    const recent = (context.recentConversation ?? []).slice(-6).map((message) => `${message.role === "assistant" ? "小P" : "我"}：${message.content}`).join("\n\n");
    return { intent: "PRINT_CONVERSATION", reply: "我已整理最近的对话，请确认后打印。", requiresConfirmation: true, printable: printable("chat", "最近对话", recent || "目前还没有可打印的对话。") };
  }
  if (/打印.*(单词|词汇)|把.*(单词|词汇).*打印/u.test(text)) {
    const words = (context.words ?? []).slice(0, 8).map((word) => `${word.word}  ${word.phonetic}\n${word.meaning}\n${word.example}`).join("\n\n");
    return { intent: "PRINT_WORDS", reply: "单词复习卡已经排好版，请确认后打印。", requiresConfirmation: true, printable: printable("word", "单词复习卡", words || text) };
  }
  if (/(打印|整理).*(今日|今天).*(计划|待办)|今日计划.*打印/u.test(text)) {
    const todos = context.tasks?.length ? context.tasks.map(({ title, time }) => ({ title, time })) : planItems(text);
    const content = todos.map((item) => `[ ] ${item.time ? `${item.time}  ` : ""}${item.title}`).join("\n");
    return { intent: "PRINT_TODAY_PLAN", reply: todos.length ? "今日计划已经整理好了，请确认内容后再打印。" : "请先告诉我今天想完成哪些事情，我会帮你整理。", requiresConfirmation: todos.length > 0, todos, printable: todos.length ? printable("todo", "今日计划", content) : null };
  }
  if (/(计划|待办|todo)/i.test(lower)) {
    const todos = planItems(text);
    return { intent: "ORGANIZE_PLAN", reply: todos.length ? "我把计划整理成了可以完成的小步骤。" : "请告诉我今天准备做哪些事情。", requiresConfirmation: false, todos, printable: todos.length ? printable("todo", "今日计划", todos.map((item) => `[ ] ${item.time}  ${item.title}`).join("\n")) : null };
  }
  return { intent: "CHAT", reply: `我理解到你想聊的是：“${text}”。可以继续告诉我你最想弄清楚的部分。`, requiresConfirmation: false, printable: printable("chat", "小P 对话", text) };
}

const SYSTEM_PROMPT = `你是 PrintPal 的语音与打印意图路由器，桌面机器人叫“小P”。你的输出必须是一个 JSON 对象，不要输出 markdown。
可用 intent：CHAT、ORGANIZE_PLAN、PRINT_TODAY_PLAN、PRINT_CONVERSATION、PRINT_ASSISTANT_REPLY、PRINT_WORDS、WRITE_LETTER、LETTER_CONTENT、LETTER_REVIEW、LETTER_CONFIRM_SEND、LETTER_CANCELLED、CONFIRM_PRINT、OPEN_IMAGE_STUDIO、START_TURTLE_SOUP、PRINT_SAVED_LETTER、CAMERA_CAPTURE、DEVICE_STATUS、VOLUME_UP、VOLUME_DOWN、BRIGHTNESS_UP、BRIGHTNESS_DOWN、ENTER_CHAT_MODE、EXIT_CHAT_MODE、REPRINT_LAST、UNKNOWN。
严格安全规则：你不能直接操作打印机；涉及打印时 requiresConfirmation 必须为 true。只有当用户当前话语明确是“打印/开始打印/确认打印”，并且上下文提供 pendingPrintable 时，才返回 CONFIRM_PRINT、executeConfirmedPrint=true、requiresConfirmation=false。LETTER_CONFIRM_SEND 只能在用户明确确认发送时使用。
JSON 字段：intent, reply, requiresConfirmation, executeConfirmedPrint, executeSendLetter, navigation, mode, recipient, warning, todos, printable, imageDescription。
printable 为 null 或 {kind,title,content,subject,recipient}；kind 只能是 chat、todo、word、story、letter、note。
WRITE_LETTER 进入写信模式并尽量提取 recipient；如果缺收件人回复“这封信想发给谁？”；如果缺正文回复“好的，你想对对方说些什么？”。LETTER_CONTENT 只收集内容，不发送。结束词只返回 LETTER_REVIEW，必须再次询问是否发送。整理信件要去掉口语赘词、重复表达，保留事实和语气，不编造信息。
计划输出 todos 数组，每项为 {title,time}，最多 8 项。打印对话要摘要，不要超过 800 字。图片、动漫图片、生日祝福卡片等需求只能返回 OPEN_IMAGE_STUDIO、navigation="/images"、imageDescription，引导用户拍照或上传图片；不要调用任何大模型生成图片。海龟汤开始请求返回 START_TURTLE_SOUP、mode="turtle_soup"。`;

export async function orchestrateTranscript(transcript, context = {}) {
  const clean = cleanText(transcript, 1_500);
  if (!clean) throw new TypeError("Voice transcript is required");
  const fallback = fallbackIntent(clean, context);
  const deterministicIntents = new Set([
    "LETTER_CONFIRM_SEND", "LETTER_CANCELLED", "CONFIRM_PRINT", "CAMERA_CAPTURE", "DEVICE_STATUS",
    "VOLUME_UP", "VOLUME_DOWN", "BRIGHTNESS_UP", "BRIGHTNESS_DOWN",
    "ENTER_CHAT_MODE", "EXIT_CHAT_MODE", "REPRINT_LAST", "PRINT_ASSISTANT_REPLY",
    "OPEN_IMAGE_STUDIO", "START_TURTLE_SOUP"
  ]);
  if (deterministicIntents.has(fallback.intent)) {
    return { ...fallback, transcript: clean, provider: "local-rule" };
  }
  try {
    const result = await deepSeekChat({
      json: true,
      maxTokens: 1_200,
      temperature: 0.3,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `请根据下面输入输出 json。\n用户话语：${clean}\n上下文：${JSON.stringify({
          mode: context.mode ?? "default",
          recipient: context.recipient ?? null,
          pendingPrintable: context.pendingPrintable ?? null,
          tasks: (context.tasks ?? []).slice(0, 10),
          words: (context.words ?? []).slice(0, 10),
          recentConversation: (context.recentConversation ?? []).slice(-8)
        })}` }
      ]
    });
    const decision = result.content && typeof result.content === "object" ? result.content : {};
    const allowedIntents = new Set(["CHAT", "ORGANIZE_PLAN", "PRINT_TODAY_PLAN", "PRINT_CONVERSATION", "PRINT_ASSISTANT_REPLY", "PRINT_WORDS", "WRITE_LETTER", "LETTER_CONTENT", "LETTER_REVIEW", "LETTER_CONFIRM_SEND", "LETTER_CANCELLED", "CONFIRM_PRINT", "OPEN_IMAGE_STUDIO", "START_TURTLE_SOUP", "PRINT_SAVED_LETTER", "CAMERA_CAPTURE", "DEVICE_STATUS", "VOLUME_UP", "VOLUME_DOWN", "BRIGHTNESS_UP", "BRIGHTNESS_DOWN", "ENTER_CHAT_MODE", "EXIT_CHAT_MODE", "REPRINT_LAST", "UNKNOWN"]);
    const explicitConfirmation = PRINT_CONFIRMATION.test(clean) && Boolean(context.pendingPrintable);
    const intent = allowedIntents.has(decision.intent) ? decision.intent : fallback.intent;
    const safeIntent = intent === "CONFIRM_PRINT" && !explicitConfirmation ? fallback.intent : intent;
    const candidatePrintable = explicitConfirmation
      ? context.pendingPrintable
      : decision.printable && typeof decision.printable === "object"
        ? decision.printable
        : fallback.printable;
    const safePrintable = candidatePrintable ? {
      ...candidatePrintable,
      kind: ["chat", "todo", "word", "story", "letter", "note"].includes(candidatePrintable.kind) ? candidatePrintable.kind : "note",
      title: cleanText(candidatePrintable.title || "PrintPal Note", 80),
      content: cleanText(candidatePrintable.content, 2_400)
    } : null;
    return {
      ...fallback,
      ...decision,
      intent: safeIntent,
      printable: safePrintable,
      executeConfirmedPrint: safeIntent === "CONFIRM_PRINT" && explicitConfirmation,
      transcript: clean,
      provider: "deepseek",
      model: result.model,
      usage: result.usage ?? null,
      requiresConfirmation: safeIntent === "CONFIRM_PRINT" ? false : Boolean(safePrintable)
    };
  } catch (error) {
    return {
      ...fallback,
      requiresConfirmation: fallback.intent === "CONFIRM_PRINT" ? false : Boolean(fallback.printable),
      transcript: clean,
      provider: "local-fallback",
      degraded: true,
      providerError: error.code ?? "AI_PROVIDER_ERROR"
    };
  }
}
