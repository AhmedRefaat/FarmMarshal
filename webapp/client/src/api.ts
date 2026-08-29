/**
 * api.ts — typed HTTP client for the FarmMarshal REST API.
 * ---------------------------------------------------------------------------
 * All network access funnels through `request()`:
 *   • prefixes the API base URL (/api → Vite proxy → server)
 *   • attaches the Bearer token from localStorage
 *   • throws descriptive Error objects on non-2xx responses
 *
 * OFFLINE DEMO: when the bundle is built with VITE_DEMO_MODE=1 (the GitHub
 * Pages build), `request` never touches the network — it is answered by
 * src/demo/demoApi.ts. Every endpoint wrapper below is unchanged either way,
 * which is the point: one code path, two data sources.
 * See docs/STATIC_DEMO_DEPLOYMENT.md.
 */

import { DEMO_MODE, demoAudioComment, demoEndSession, demoRequest } from './demo/demoApi';

/** API base path — Vite proxies this to the Node trail in dev. */
const BASE = '/api';

function token(): string | null {
  return localStorage.getItem('farmmarshal_token');
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

/** Error carrying the HTTP status so the UI can map it to localized copy. */
export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * The locale the user is currently reading, read straight from storage rather
 * than from React context so this module stays framework-free. The API itself
 * is language-neutral (ADR-029); the header exists for future server-rendered
 * artefacts such as emailed PDFs and for request-log diagnostics.
 */
function acceptLanguage(): string {
  try {
    return localStorage.getItem('farmmarshal_locale') === 'en'
      ? 'en-GB, en;q=0.9, ar;q=0.8'
      : 'ar-EG, ar;q=0.9, en;q=0.8';
  } catch {
    return 'ar-EG, ar;q=0.9, en;q=0.8';
  }
}

/**
 * Generic JSON request helper used by every endpoint function below.
 * @param path   route beginning with '/'
 * @param opts   standard fetch options
 */
async function request<T>(path: string, opts: RequestInit = {}): Promise<T> {
  if (DEMO_MODE) {
    const { status, body } = await demoRequest(path, opts);
    if (status >= 400) {
      if (status === 401 && path !== '/auth/login') endSession();
      throw new ApiError(body?.error ?? `Request failed (${status})`, status);
    }
    return body as T;
  }
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: {
      ...buildHeaders(token()),
      'accept-language': acceptLanguage(),
      ...(opts.headers ?? {}),
    },
  });
  if (!res.ok) {
    // A 401 on any authenticated call means the stored token is no longer
    // accepted (expired, or the server was restarted and re-minted its dev
    // signing key). Keeping the cached user makes the app *look* signed in
    // while every request fails, so drop the session and return to login.
    // The login call itself is exempt: there, 401 means "wrong password".
    if (res.status === 401 && path !== '/auth/login') {
      endSession();
    }
    // The server's text is developer-facing English; it is carried for logs
    // while the UI renders its own localized message keyed off `status`.
    const body = await res.json().catch(() => ({}));
    throw new ApiError(
      (body as any).error ?? `Request failed (${res.status})`,
      res.status
    );
  }
  return res.json() as Promise<T>;
}

/** Clear the persisted session and send the user back to the login screen. */
function endSession(): void {
  localStorage.removeItem('farmmarshal_token');
  localStorage.removeItem('farmmarshal_user');
  if (DEMO_MODE) demoEndSession();
  // BASE_URL carries the deploy sub-path ('/' in dev, '/FarmMarshal/' on Pages).
  const login = `${import.meta.env.BASE_URL}login`.replace('//', '/');
  if (window.location.pathname !== login) {
    window.location.replace(login);
  }
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
    if (DEMO_MODE) return demoAudioComment(taskId, blob);
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

  // ---- Farm portfolio + universal issue workflow -------------------------

  /** Full farm records the caller is bound to (owner OR member). */
  v2Farms: () => request<import('./types').Farm[]>('/v2/farms'),

  /**
   * Issues of ONE farm. `farmId` is mandatory by design: an unscoped read
   * collapses the farm-scoped authorization check to admin-only, so the UI
   * fans out per farm instead.
   */
  issues: (farmId: string) =>
    request<import('./types').Issue[]>(
      `/v2/issues?farmId=${encodeURIComponent(farmId)}`
    ),

  issueEvents: (issueId: string) =>
    request<import('./types').IssueEvent[]>(`/v2/issues/${issueId}/events`),

  /** Single-call aggregate behind the per-task report page. */
  taskReport: (id: string) =>
    request<import('./types').TaskReport>(`/tasks/${id}/report`),

  // ---- Agriculture expert network (marketplace) --------------------------

  consultations: () =>
    request<import('./types').Consultation[]>('/v2/consultations'),

  consultation: (id: string) =>
    request<import('./types').ConsultationDetail>(`/v2/consultations/${id}`),

  postConsultation: (body: {
    question: string;
    bountyEgp: number;
    language: string;
    scope?: 'public' | 'targeted';
  }) =>
    request<import('./types').Consultation>('/v2/consultations', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  respondConsultation: (id: string, answer: string) =>
    request<{ ok: true; id: string }>(`/v2/consultations/${id}/responses`, {
      method: 'POST',
      body: JSON.stringify({ answer }),
    }),

  /** Requester-only: releases the bounty and opens the 1:1 expert thread. */
  chooseResponse: (id: string, responseId: string) =>
    request<{
      consultation: import('./types').Consultation;
      conversationId?: string;
      netPayoutEgp?: number;
    }>(`/v2/consultations/${id}/choose`, {
      method: 'PATCH',
      body: JSON.stringify({ responseId }),
    }),

  rateConsultation: (id: string, stars: number) =>
    request<{ avgStars: number }>(`/v2/consultations/${id}/rate`, {
      method: 'POST',
      body: JSON.stringify({ stars }),
    }),

  /** Verified experts available to the network. */
  experts: () => request<import('./types').ExpertProfile[]>('/v2/experts'),

  /** The caller's own expert profile, or null if they are not an expert. */
  myExpert: () =>
    request<import('./types').ExpertProfile | null>('/v2/experts/me'),

  // ---- Chat --------------------------------------------------------------

  chatInbox: () => request<any[]>('/v2/chat/inbox'),

  chatMessages: (conversationId: string) =>
    request<import('./types').ChatMessage[]>(
      `/v2/chat/${conversationId}/messages`
    ),

  sendChat: (conversationId: string, text: string) =>
    request<import('./types').ChatMessage>(
      `/v2/chat/${conversationId}/messages`,
      {
        method: 'POST',
        body: JSON.stringify({
          type: 'text',
          text,
          // Retry-safe: the server de-duplicates on this key (exactly-once).
          idempotencyKey: `${conversationId}-${Date.now()}-${Math.random()
            .toString(36)
            .slice(2)}`,
        }),
      }
    ),
};
