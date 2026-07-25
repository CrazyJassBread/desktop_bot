import { config } from "../config.mjs";

const active = { happy: 0, laugh: 0 };
let shown = "default";
let queue = Promise.resolve();

function desiredExpression() {
  if (active.laugh > 0) return "laugh";
  if (active.happy > 0) return "happy";
  return "default";
}

export async function sendExpression(expression, options = {}) {
  const baseUrl = options.baseUrl || config.oled.baseUrl;
  if (!baseUrl) return false;
  const url = new URL("/oled/expression", `${baseUrl.replace(/\/+$/, "")}/`);
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ expression }),
    signal: AbortSignal.timeout(options.timeoutMs || config.oled.timeoutMs)
  });
  if (!response.ok) throw new Error(`OLED returned HTTP ${response.status}`);
  return true;
}

function refreshExpression() {
  const next = desiredExpression();
  if (next === shown) return;
  shown = next;
  queue = queue.then(() => sendExpression(next)).catch(() => {});
}

export function beginOledActivity(expression) {
  if (!(expression in active)) return () => {};
  active[expression] += 1;
  refreshExpression();
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    active[expression] = Math.max(0, active[expression] - 1);
    refreshExpression();
  };
}
