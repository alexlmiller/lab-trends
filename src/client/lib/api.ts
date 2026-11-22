export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    /** Set by the Worker's sign-in check (src/worker/auth.ts) when it refuses a request. */
    public code?: string,
    public detail: { team?: string; email?: string } = {},
  ) {
    super(message)
  }
}

const RELOADED_KEY = 'lab-trends.reloaded'

/** Reload so the browser goes through Access again, but never in a loop. */
function reloadOnce() {
  try {
    if (Date.now() - Number(sessionStorage.getItem(RELOADED_KEY) ?? 0) < 15_000) return
    sessionStorage.setItem(RELOADED_KEY, String(Date.now()))
  } catch {
    /* storage unavailable */
  }
  window.location.reload()
}

/** Fired when a change is refused because this is the read-only demo. */
export const DEMO_READ_ONLY_EVENT = 'lab-trends:demo-read-only'

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method, headers: {}, credentials: 'same-origin' }
  if (body instanceof FormData) init.body = body
  else if (body !== undefined) {
    init.body = JSON.stringify(body)
    ;(init.headers as Record<string, string>)['Content-Type'] = 'application/json'
  }
  const res = await fetch(`/api${path}`, init)
  const text = await res.text()
  let data: (Record<string, unknown> & { error?: string; code?: string }) | null = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    /* not JSON: an Access page rather than the app */
  }
  // An expired Access session is answered by Access, not the app, so it carries no code.
  if ((res.status === 401 || res.status === 403) && method === 'GET' && (!data?.code || data.code === 'unauthenticated')) reloadOnce()
  if (!res.ok) {
    // The demo banner says why, wherever the change was attempted.
    if (data?.code === 'demo_read_only') window.dispatchEvent(new Event(DEMO_READ_ONLY_EVENT))
    throw new ApiError(res.status, data?.error || `Request failed (${res.status})`, data?.code, { team: data?.team as string | undefined, email: data?.email as string | undefined })
  }
  return data as T
}

export const api = {
  get: <T,>(path: string) => request<T>('GET', path),
  post: <T,>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  put: <T,>(path: string, body: unknown) => request<T>('PUT', path, body),
  patch: <T,>(path: string, body: unknown) => request<T>('PATCH', path, body),
  del: <T,>(path: string) => request<T>('DELETE', path),
}
