export class ApiProblem extends Error {
  constructor(body, status) {
    super(body?.error?.message ?? `请求失败 (${status})`);
    this.name = "ApiProblem";
    this.status = status;
    this.code = body?.error?.code ?? "REQUEST_FAILED";
  }
}

async function request(path, options = {}) {
  const headers = new Headers(options.headers);
  headers.set("Accept", "application/json");
  if (options.body) headers.set("Content-Type", "application/json");
  const response = await fetch(`/api/v1${path}`, {
    credentials: "same-origin",
    ...options,
    headers
  });
  const body = await response.json();
  if (!response.ok) throw new ApiProblem(body, response.status);
  return body;
}

export const api = {
  session: () => request("/auth/session"),
  register: (payload) => request("/auth/register", {
    method: "POST",
    body: JSON.stringify(payload)
  }),
  login: (payload) => request("/auth/login", {
    method: "POST",
    body: JSON.stringify(payload)
  }),
  logout: () => request("/auth/logout", {
    method: "POST",
    body: JSON.stringify({})
  }),
  letters: (box = "all") => request(
    `/letters?box=${encodeURIComponent(box)}`
  )
};
