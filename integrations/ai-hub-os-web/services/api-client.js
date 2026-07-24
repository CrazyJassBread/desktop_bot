export class ApiProblem extends Error {
  constructor(problem, status) {
    super(problem?.detail || problem?.title || `Request failed with ${status}`);
    this.name = "ApiProblem";
    this.status = status;
    this.code = problem?.code || "REQUEST_FAILED";
    this.problem = problem;
  }
}

function idempotencyKey() {
  return crypto.randomUUID();
}

async function request(path, options = {}) {
  const headers = new Headers(options.headers);
  headers.set("Accept", "application/json");
  if (options.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const response = await fetch(`/api/v1${path}`, {
    credentials: "same-origin",
    ...options,
    headers
  });
  const body = response.status === 204 ? null : await response.json();
  if (!response.ok) throw new ApiProblem(body, response.status);
  return body;
}

export const api = {
  dashboard: () => request("/dashboard"),
  me: () => request("/users/me"),
  profile: (handle) => request(`/users/${encodeURIComponent(handle)}`),
  posts: ({ category = "全部", query = "" } = {}) => {
    const params = new URLSearchParams();
    if (category) params.set("category", category);
    if (query) params.set("q", query);
    return request(`/posts?${params}`);
  },
  post: (id) => request(`/posts/${encodeURIComponent(id)}`),
  createPost: (payload) => request("/posts", {
    method: "POST",
    headers: { "Idempotency-Key": idempotencyKey() },
    body: JSON.stringify(payload)
  }),
  reactToPost: (id) => request(`/posts/${encodeURIComponent(id)}/reactions`, {
    method: "POST",
    headers: { "Idempotency-Key": idempotencyKey() },
    body: JSON.stringify({ type: "LIKE" })
  }),
  toggleBookmark: (id) => request(`/posts/${encodeURIComponent(id)}/bookmark`, {
    method: "PUT",
    headers: { "Idempotency-Key": idempotencyKey() },
    body: JSON.stringify({})
  }),
  comment: (id, content) => request(`/posts/${encodeURIComponent(id)}/comments`, {
    method: "POST",
    headers: { "Idempotency-Key": idempotencyKey() },
    body: JSON.stringify({ content })
  }),
  matches: () => request("/matches"),
  matchFeedback: (candidateId, action) => request(`/matches/${encodeURIComponent(candidateId)}/feedback`, {
    method: "POST",
    headers: { "Idempotency-Key": idempotencyKey() },
    body: JSON.stringify({ action })
  }),
  letters: (box = "inbox") => request(`/letters?box=${encodeURIComponent(box)}`),
  letter: (id) => request(`/letters/${encodeURIComponent(id)}`),
  createLetter: (payload) => request("/letters", {
    method: "POST",
    headers: { "Idempotency-Key": idempotencyKey() },
    body: JSON.stringify(payload)
  }),
  sendLetter: (letterId, recipientId, version = 1) => request(`/letters/${encodeURIComponent(letterId)}/send`, {
    method: "POST",
    headers: { "Idempotency-Key": idempotencyKey(), "If-Match": `"${version}"` },
    body: JSON.stringify({ confirmRecipientId: recipientId, scheduledAt: null })
  }),
  sendVoiceLetter: (payload, stableKey = idempotencyKey()) => request("/letters/voice/send", {
    method: "POST",
    headers: { "Idempotency-Key": stableKey },
    body: JSON.stringify(payload)
  }),
  aiLetter: (action, payload) => request(`/ai/letter/${encodeURIComponent(action)}`, {
    method: "POST",
    headers: { "Idempotency-Key": idempotencyKey() },
    body: JSON.stringify(payload)
  }),
  aiStatus: () => request("/ai/status"),
  tutor: (question, messages = []) => request("/ai/tutor", {
    method: "POST",
    body: JSON.stringify({ question, messages })
  }),
  orchestrate: (transcript, context = {}) => request("/ai/orchestrate", {
    method: "POST",
    body: JSON.stringify({ transcript, context })
  }),
  startTurtleSoup: (payload = {}) => request("/games/turtle-soup/start", {
    method: "POST",
    body: JSON.stringify(payload)
  }),
  turtleSoup: (question, game = {}) => request("/games/turtle-soup/answer", {
    method: "POST",
    body: JSON.stringify({ question, story: game.story, history: game.history })
  }),
  ocr: (fileName) => request("/ai/ocr", {
    method: "POST",
    body: JSON.stringify({ fileName })
  }),
  journalSummary: (body) => request("/ai/journal/summary", {
    method: "POST",
    body: JSON.stringify({ body })
  }),
  fortune: (payload) => request("/ai/fortune", {
    method: "POST",
    body: JSON.stringify(payload)
  }),
  devices: () => request("/devices"),
  deviceStatus: (id) => request(`/devices/${encodeURIComponent(id)}/status`),
  updatePrintPolicy: (id, policy, version) => request(`/devices/${encodeURIComponent(id)}/print-policy`, {
    method: "PUT",
    headers: { "If-Match": `"${version}"`, "Idempotency-Key": idempotencyKey() },
    body: JSON.stringify(policy)
  }),
  printJobs: () => request("/print-jobs"),
  updatePrintStatus: (jobId, status) => request(`/print-jobs/${encodeURIComponent(jobId)}/device-status`, {
    method: "POST",
    headers: { "Idempotency-Key": idempotencyKey() },
    body: JSON.stringify({ status })
  }),
  printText: ({
    text,
    language = "en",
    font,
    bold = false,
    underline = false,
    invert = false,
    width = 1,
    height = 1,
    align = "center",
    feedAfter = 3,
    jobId = null,
    source = "manual"
  }) => request("/printer/text", {
    method: "POST",
    headers: { "Idempotency-Key": idempotencyKey() },
    body: JSON.stringify({ text, language, font, bold, underline, invert, width, height, align, feedAfter, jobId, source })
  }),
  previewLetterPrint: (payload) => request("/printer/letter/preview", {
    method: "POST",
    body: JSON.stringify(payload)
  }),
  printLetter: (payload) => request("/printer/letter", {
    method: "POST",
    headers: { "Idempotency-Key": payload.jobId ? `letter-print-${payload.jobId}` : idempotencyKey() },
    body: JSON.stringify({ feedBefore: 3, feedAfter: 4, ...payload })
  }),
  previewContentPrint: (payload) => request("/printer/content/preview", {
    method: "POST",
    body: JSON.stringify(payload)
  }),
  printContent: (payload) => request("/printer/content", {
    method: "POST",
    headers: { "Idempotency-Key": payload.jobId ? `content-print-${payload.jobId}` : idempotencyKey() },
    body: JSON.stringify({ feedBefore: 3, feedAfter: 4, ...payload })
  }),
  login: (email, password) => request("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password })
  }),
  register: (displayName, email, password) => request("/auth/register", {
    method: "POST",
    body: JSON.stringify({ displayName, email, password, acceptTermsVersion: "2026-07" })
  })
};
