import { deepSeekChat } from "./deepseek-client.mjs";

const PRINT_CONFIRMATION = /^(打印|开始打印|确认打印|可以打印|帮我打印)$/u;
const LETTER_FINISH = /(?:\bover\b|确认发送信件|发送信件|寄出信件|结束写信|结束)[\s，,。.!！?？;；]*$/iu;

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
  const keywordMatch = match[0].match(/over|发送信件|确认发送信件|寄出信件|结束写信|结束/iu);
  return {
    finished: true,
    content: text.slice(0, match.index).trim(),
    keyword: keywordMatch?.[0] ?? "结束"
  };
}

export function extractVoiceLetterStart(value) {
  const text = cleanText(value, 1_500);
  const chinese = text.match(/(?:我要|我想|请|麻烦|帮我)?(?:给|向)(.{1,32}?)(?:写|寄)(?:一封)?(?:信|邮件)(?:[，,：:]?\s*(.*))?$/u);
  if (chinese) {
    return {
      started: true,
      recipient: cleanText(chinese[1], 32),
      content: cleanText(chinese[2], 1_200)
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
  if (/(?:帮我写信|我要写一封信|开始写信)/u.test(text)) {
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
  if (letterMode && letterFinish.finished) {
    return {
      intent: "SEND_LETTER",
      reply: "收到结束词，正在发送这封信。",
      requiresConfirmation: false,
      executeSendLetter: true,
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
  if (/海龟汤/u.test(text) && /(玩|开始|来一局|进入)/u.test(text)) {
    return { intent: "START_TURTLE_SOUP", reply: "好呀，正在进入海龟汤。你可以用只能回答 YES 或 NO 的问题来寻找真相。", navigation: "/entertainment", requiresConfirmation: false };
  }
  const letterStart = extractVoiceLetterStart(text);
  if (letterStart.started && letterStart.recipient) {
    const recipient = letterStart.recipient;
    return { intent: "WRITE_LETTER", reply: `好的，这封信写给${recipient}。我在听，请继续说你想写的内容。`, mode: "letter", recipient, requiresConfirmation: false };
  }
  if (letterStart.started) {
    return { intent: "WRITE_LETTER", reply: "好的，我在听。请先说收件人和想写的内容。", mode: "letter", recipient: null, requiresConfirmation: false };
  }
  if (letterMode) {
    const recipient = cleanText(context.recipient || "对方", 32);
    const clipped = text.length >= 1_200;
    const body = `${recipient}：\n\n${text.replace(/\b(嗯|呃|那个|就是)\b/gu, "").replace(/([，。！？])\1+/gu, "$1")}\n\n愿你一切都好。\n\n来自我`;
    return {
      intent: "LETTER_CONTENT",
      reply: clipped ? "内容有点长了，我先帮你整理这一段。请查看后再确认打印。" : "我已经把口语内容整理成一封自然的信，请查看后再确认打印。",
      mode: "letter_review",
      recipient,
      requiresConfirmation: true,
      warning: clipped ? "VOICE_CONTENT_CLIPPED" : null,
      printable: printable("letter", `写给${recipient}的信`, body, { recipient, subject: "一封想对你说的话" })
    };
  }
  if (/打印.*(刚才|最近).*(对话|聊天)|把.*(对话|聊天).*打印/u.test(text)) {
    const recent = (context.recentConversation ?? []).slice(-6).map((message) => `${message.role === "assistant" ? "MIMO" : "我"}：${message.content}`).join("\n\n");
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
  return { intent: "CHAT", reply: `我理解到你想聊的是：“${text}”。可以继续告诉我你最想弄清楚的部分。`, requiresConfirmation: false, printable: printable("chat", "MIMO 对话", text) };
}

const SYSTEM_PROMPT = `你是 AI Hub OS 的语音与打印意图路由器。你的输出必须是一个 JSON 对象，不要输出 markdown。
可用 intent：CHAT、ORGANIZE_PLAN、PRINT_TODAY_PLAN、PRINT_CONVERSATION、PRINT_WORDS、START_TURTLE_SOUP、WRITE_LETTER、LETTER_CONTENT、SEND_LETTER、CONFIRM_PRINT、UNKNOWN。
严格安全规则：你不能直接操作打印机；涉及打印时 requiresConfirmation 必须为 true。只有当用户当前话语明确是“打印/开始打印/确认打印”，并且上下文提供 pendingPrintable 时，才返回 CONFIRM_PRINT、executeConfirmedPrint=true、requiresConfirmation=false。SEND_LETTER 只表示发送数字信件，不代表直接打印。
JSON 字段：intent, reply, requiresConfirmation, executeConfirmedPrint, executeSendLetter, navigation, mode, recipient, warning, todos, printable。
printable 为 null 或 {kind,title,content,subject,recipient}；kind 只能是 chat、todo、word、story、letter、note。
WRITE_LETTER 只进入聆听写信模式并提取 recipient；LETTER_CONTENT 需要去掉口语赘词、重复表达，整理为自然温暖的信，包含称呼、正文、祝福和署名。如果原始内容超过 1200 字，warning=VOICE_CONTENT_CLIPPED，reply 中必须包含“内容有点长了，我先帮你整理这一段。”。
计划输出 todos 数组，每项为 {title,time}，最多 8 项。打印对话要摘要，不要超过 800 字。`;

export async function orchestrateTranscript(transcript, context = {}) {
  const clean = cleanText(transcript, 1_500);
  if (!clean) throw new TypeError("Voice transcript is required");
  const fallback = fallbackIntent(clean, context);
  if (fallback.intent === "SEND_LETTER") {
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
    const allowedIntents = new Set(["CHAT", "ORGANIZE_PLAN", "PRINT_TODAY_PLAN", "PRINT_CONVERSATION", "PRINT_WORDS", "START_TURTLE_SOUP", "WRITE_LETTER", "LETTER_CONTENT", "SEND_LETTER", "CONFIRM_PRINT", "UNKNOWN"]);
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
      title: cleanText(candidatePrintable.title || "MIMO Note", 80),
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
