const DEFAULT_BASE_URL = "https://api.deepseek.com";
const DEFAULT_MODEL = "deepseek-v4-flash";

export class DeepSeekError extends Error {
  constructor(message, { code = "DEEPSEEK_REQUEST_FAILED", status = 502, cause } = {}) {
    super(message, { cause });
    this.name = "DeepSeekError";
    this.code = code;
    this.status = status;
  }
}

export function deepSeekConfig() {
  const testMode = process.env.NODE_ENV === "test";
  return {
    configured: Boolean(process.env.DEEPSEEK_API_KEY) && (!testMode || process.env.DEEPSEEK_ALLOW_IN_TESTS === "true"),
    baseUrl: String(process.env.DEEPSEEK_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, ""),
    model: process.env.DEEPSEEK_MODEL ?? DEFAULT_MODEL
  };
}

function parseJsonContent(content) {
  const clean = String(content ?? "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  if (!clean) throw new DeepSeekError("DeepSeek returned an empty JSON response", { code: "DEEPSEEK_EMPTY_RESPONSE" });
  try {
    return JSON.parse(clean);
  } catch (cause) {
    throw new DeepSeekError("DeepSeek returned malformed JSON", { code: "DEEPSEEK_INVALID_JSON", cause });
  }
}

export async function deepSeekChat({
  messages,
  json = false,
  maxTokens = 900,
  temperature = 1,
  userId = "aihub_mvp_user",
  timeoutMs = 40_000
}) {
  const config = deepSeekConfig();
  if (!config.configured) {
    throw new DeepSeekError("DEEPSEEK_API_KEY is not configured", {
      code: "DEEPSEEK_NOT_CONFIGURED",
      status: 503
    });
  }

  let response;
  try {
    response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: config.model,
        messages,
        max_tokens: Math.max(64, Math.min(4_000, Number(maxTokens) || 900)),
        temperature,
        stream: false,
        user_id: String(userId).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 128),
        ...(json ? { response_format: { type: "json_object" } } : {})
      }),
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (cause) {
    throw new DeepSeekError("Unable to connect to DeepSeek", {
      code: cause?.name === "TimeoutError" ? "DEEPSEEK_TIMEOUT" : "DEEPSEEK_NETWORK_ERROR",
      status: 502,
      cause
    });
  }

  const raw = await response.text();
  let payload;
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    payload = {};
  }
  if (!response.ok) {
    throw new DeepSeekError(payload?.error?.message || `DeepSeek request failed with ${response.status}`, {
      code: "DEEPSEEK_UPSTREAM_ERROR",
      status: response.status === 429 ? 429 : 502
    });
  }

  const content = payload?.choices?.[0]?.message?.content;
  if (!String(content ?? "").trim()) {
    throw new DeepSeekError("DeepSeek returned an empty response", { code: "DEEPSEEK_EMPTY_RESPONSE" });
  }
  return {
    content: json ? parseJsonContent(content) : String(content).trim(),
    model: payload.model ?? config.model,
    usage: payload.usage ?? null,
    finishReason: payload?.choices?.[0]?.finish_reason ?? null
  };
}
