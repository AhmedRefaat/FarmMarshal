/**
 * api.ts — typed HTTP client for the AgriTasks REST API.
 * ---------------------------------------------------------------------------
 * All network access funnels through `request()`:
 *   • prefixes the API base URL (/api → Vite proxy → server)
 *   • attaches the Bearer token from localStorage
 *   • throws descriptive Error objects on non-2xx responses
 */

/** API base path — Vite proxies this to the Node trail in dev. */
const BASE = '/api';

function token(): string | null {
  return localStorage.getItem('agritasks_token');
}

/**
 * Build the authorization header set for a request.
 * Exported PURE (no localStorage) so it is unit-testable (G3).
 */
export function buildHeaders(authToken: string | null): Record<string, string> {
  return {
    'content-type': 'application/json',
    ...(authToken ? { authorization: `Bearer ${authToken}` } : {}),
  };
}

/**
 * Generic JSON request helper used by every endpoint function below.
 * @param path   route beginning with '/'
 * @param opts   standard fetch options
 */
async function request<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: { ...buildHeaders(token()), ...(opts.headers ?? {}) },
  });
  if (!res.ok) {
    // Surface server-provided error text for inline UI display.
    const body = await res.json().catch(() => ({}));
    throw new Error((body as any).error ?? `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Endpoint wrappers — one function per REST operation (self-documenting API).
// ---------------------------------------------------------------------------

export const api = {
  login: (email: string, password: string) =>
    request<{ token: string; user: import('./types').User }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  users: () => request<import('./types').User[]>('/users'),

  userStats: (id: string) =>
    request<{ user: import('./types').User; avgStars: number; count: number }>(
      `/users/${id}/stats`
    ),

  tasks: () => request<import('./types').Task[]>('/tasks'),

  task: (id: string) => request<import('./types').Task>(`/tasks/${id}`),

  createTask: (body: {
    title: string;
    description: string;
    lat: number;
    lng: number;
    workerId: string;
  }) =>
    request<import('./types').Task>('/tasks', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  transitionTask: (id: string, action: string, note?: string) =>
    request<import('./types').Task>(`/tasks/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ action, note }),
    }),

  comments: (taskId: string) =>
    request<import('./types').Comment[]>(`/tasks/${taskId}/comments`),

  addComment: (taskId: string, text: string) =>
    request<import('./types').Comment>(`/tasks/${taskId}/comments`, {
      method: 'POST',
      body: JSON.stringify({ text }),
    }),

  /**
   * Upload an audio comment. Multipart is built manually because we must NOT
   * set content-type ourselves (the browser adds the boundary).
   */
  addAudioComment: async (taskId: string, blob: Blob) => {
    const form = new FormData();
    form.append('file', new File([blob], 'voice.webm', { type: blob.type }));
    const res = await fetch(`/api/tasks/${taskId}/comments/audio`, {
      method: 'POST',
      headers: token() ? { authorization: `Bearer ${token()}` } : {},
      body: form,
    });
    if (!res.ok) throw new Error('Audio upload failed');
    return res.json() as Promise<import('./types').Comment>;
  },

  ratings: (rateeId: string) =>
    request<import('./types').Rating[]>(`/ratings?rateeId=${rateeId}`),

  rate: (rateeId: string, stars: number, comment?: string) =>
    request<import('./types').Rating>('/ratings', {
      method: 'POST',
      body: JSON.stringify({ rateeId, stars, comment }),
    }),

  // ---- R4/R5: farms + financial ledger ----------------------------------

  farms: () => request<{ id: string; name: string }[]>('/farms'),

  /** Ledger rows, optionally scoped to one farm. */
  finances: (farmId?: string) =>
    request<any[]>(`/finances?farmId=${farmId ?? ''}`),

  /** KPI aggregates for the accountant cards. */
  financeSummary: (farmId?: string) =>
    request<any>(`/finances/summary${farmId ? `?farmId=${farmId}` : ''}`),

  /** Append a ledger row. */
  addFinance: (body: Record<string, unknown>) =>
    request<any>('/finances', { method: 'POST', body: JSON.stringify(body) }),
};
