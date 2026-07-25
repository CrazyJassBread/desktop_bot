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
  const isFormData = typeof FormData !== "undefined" && options.body instanceof FormData;
  if (options.body && !headers.has("Content-Type") && !isFormData) headers.set("Content-Type", "application/json");
  const response = await fetch(`/api/v1${path}`, {
    credentials: "same-origin",
    ...options,
    headers
  });
  const body = response.status === 204 ? null : await response.json();
  if (!response.ok) {
    if (response.status === 401 && !path.startsWith("/auth/")) {
      window.dispatchEvent(new CustomEvent("aihub:auth-expired"));
    }
    throw new ApiProblem(body, response.status);
  }
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
  ocr: (fileName) => request("/ai/ocr", {
    method: "POST",
    body: JSON.stringify({ fileName })
  }),
  photos: (purpose = "") => request(`/photos${purpose ? `?purpose=${encodeURIComponent(purpose)}` : ""}`),
  uploadPhoto: (file, { source = "upload", purpose = "memory", title = "" } = {}) => {
    const form = new FormData();
    form.set("image", file);
    form.set("source", source);
    form.set("purpose", purpose);
    if (title) form.set("title", title);
    return request(source === "hardware" ? "/photos/hardware" : "/photos", {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey() },
      body: form
    });
  },
  journalSummary: (body) => request("/ai/journal/summary", {
    method: "POST",
    body: JSON.stringify({ body })
  }),
  fortune: (payload) => request("/ai/fortune", {
    method: "POST",
    body: JSON.stringify(payload)
  }),
  dailyBriefings: () => request("/daily-briefings"),
  updateDailyBriefing: (id, payload) => request(`/daily-briefings/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "Idempotency-Key": idempotencyKey() },
    body: JSON.stringify(payload)
  }),
  previewDailyBriefing: (id) => request(`/daily-briefings/${encodeURIComponent(id)}/preview`, {
    method: "POST",
    headers: { "Idempotency-Key": idempotencyKey() }
  }),
  printDailyBriefing: (id) => request(`/daily-briefings/${encodeURIComponent(id)}/print`, {
    method: "POST",
    headers: { "Idempotency-Key": idempotencyKey() }
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
  session: () => request("/auth/session"),
  login: (email, password, remember = false) => request("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password, remember })
  }),
  register: ({ displayName, email, password, confirmPassword, acceptTerms }) => request("/auth/register", {
    method: "POST",
    body: JSON.stringify({ displayName, email, password, confirmPassword, acceptTerms })
  }),
  logout: () => request("/auth/logout", { method: "POST", body: JSON.stringify({}) }),
  forgotPassword: (email) => request("/auth/forgot-password", {
    method: "POST",
    body: JSON.stringify({ email })
  }),
  resetPassword: (token, password, confirmPassword) => request("/auth/reset-password", {
    method: "POST",
    body: JSON.stringify({ token, password, confirmPassword })
  }),
  requestEmailVerification: () => request("/auth/verification/request", {
    method: "POST",
    body: JSON.stringify({})
  }),
  confirmEmailVerification: (token) => request("/auth/verification/confirm", {
    method: "POST",
    body: JSON.stringify({ token })
  }),
  account: () => request("/account"),
  updateAccount: (payload) => request("/account", {
    method: "PATCH",
    body: JSON.stringify(payload)
  }),
  voiceBootstrap: () => request("/voice/bootstrap"),
  updateVoiceSettings: (payload) => request("/voice/settings", {
    method: "PATCH",
    body: JSON.stringify(payload)
  }),
  voiceTurn: (payload) => request("/voice/turns", {
    method: "POST",
    body: JSON.stringify(payload)
  }),
  voiceConversations: () => request("/voice/conversations"),
  voiceCommands: () => request("/voice/commands"),
  voicePrintJobs: () => request("/voice/print-jobs"),
  createVoicePrintJob: (conversationId, target, commandId) => request("/voice/print-jobs", {
    method: "POST",
    headers: { "Idempotency-Key": commandId },
    body: JSON.stringify({ conversationId, target, commandId })
  }),
  retryVoicePrintJob: (jobId) => request(`/voice/print-jobs/${encodeURIComponent(jobId)}/retry`, {
    method: "POST",
    headers: { "Idempotency-Key": idempotencyKey() },
    body: JSON.stringify({})
  })
};
