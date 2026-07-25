export class ApiProblem extends Error {
  constructor(problem, status) {
    super(problem?.title || `Request failed with ${status}`);
    this.name = "ApiProblem";
    this.status = status;
    this.code = problem?.code || "REQUEST_FAILED";
  }
}

async function request(path, options = {}) {
  const headers = new Headers(options.headers);
  headers.set("Accept", "application/json");
  if (options.body) headers.set("Content-Type", "application/json");
  const response = await fetch(`/api/v1${path}`, { credentials: "same-origin", ...options, headers });
  const body = response.status === 204 ? null : await response.json();
  if (!response.ok) {
    if (response.status === 401 && !path.startsWith("/auth/")) window.dispatchEvent(new Event("aihub:auth-expired"));
    throw new ApiProblem(body, response.status);
  }
  return body;
}

const write = (path, method, payload = {}) => request(path, { method, body: JSON.stringify(payload) });

export const api = {
  session: () => request("/auth/session"),
  login: (email, password, remember = false) => write("/auth/login", "POST", { email, password, remember }),
  register: (payload) => write("/auth/register", "POST", payload),
  logout: () => write("/auth/logout", "POST"),
  dashboard: () => request("/dashboard"),
  records: () => request("/records"),
  record: (id) => request(`/records/${encodeURIComponent(id)}`),
  startRecording: (language) => write("/recordings/start", "POST", { language }),
  stopRecording: () => write("/recordings/stop", "POST"),
  recordingJob: (id) => request(`/recordings/${encodeURIComponent(id)}`),
  summarizeRecord: (id) => write(`/records/${encodeURIComponent(id)}/summarize`, "POST"),
  generateLetter: (id, recipientId) => write(`/records/${encodeURIComponent(id)}/generate-letter`, "POST", { recipientId }),
  friends: () => request("/friends"),
  addFriend: (email) => write("/friends", "POST", { email }),
  respondFriendRequest: (id, decision) => write(`/friend-requests/${encodeURIComponent(id)}/${decision}`, "POST"),
  notifications: () => request("/notifications"),
  readNotification: (id) => write(`/notifications/${encodeURIComponent(id)}/read`, "POST"),
  letters: (friendId = "") => request(`/letters${friendId ? `?friendId=${encodeURIComponent(friendId)}` : ""}`),
  createLetter: (payload) => write("/letters", "POST", payload),
  updateLetter: (id, payload) => write(`/letters/${encodeURIComponent(id)}`, "PATCH", payload),
  renderLetter: (id) => write(`/letters/${encodeURIComponent(id)}/render`, "POST"),
  sendLetter: (id) => write(`/letters/${encodeURIComponent(id)}/send`, "POST"),
  printJobs: () => request("/print-jobs"),
  updatePrintJob: (id, status) => write(`/print-jobs/${encodeURIComponent(id)}/status`, "POST", { status }),
  account: () => request("/account"),
  updateAccount: (payload) => write("/account", "PATCH", payload)
};
