let sessionGeneration = 0;
let expiryNotified = false;

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// The application handles this centrally; individual actions must not add more toasts.
export class SessionExpiredError extends ApiError {}

type ErrorBody = { error?: string; details?: string[] };

async function parseBody(response: Response): Promise<unknown> {
  if (response.status === 204 || response.status === 205) return null;
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    const text = await response.text().catch(() => '');
    return { error: text.trim() || `تعذر إكمال الطلب (${response.status})` } satisfies ErrorBody;
  }
  try {
    return await response.json();
  } catch {
    return { error: 'تعذر قراءة استجابة الخادم' } satisfies ErrorBody;
  }
}

/**
 * The single HTTP entry point for the whole ERP. Domain modules build typed wrappers on top.
 * `signal` lets screens abort stale requests when the user navigates or changes filters.
 */
export async function api<T>(
  url: string,
  method = 'GET',
  body?: unknown,
  requestKey?: string,
  signal?: AbortSignal,
): Promise<T> {
  const generation = sessionGeneration;
  const response = await fetch('/api' + url, {
    method,
    credentials: 'same-origin',
    signal,
    headers: {
      'Content-Type': 'application/json',
      'X-Orqiva-Request': '1',
      ...(requestKey ? { 'Idempotency-Key': requestKey } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await parseBody(response);
  if (!response.ok) {
    const errorBody = (data ?? {}) as ErrorBody;
    const message =
      (errorBody.error || 'تعذر إكمال الطلب') +
      (errorBody.details?.length ? ' — ' + errorBody.details.join('، ') : '');
    if (response.status === 401 && !url.startsWith('/auth/')) {
      // Parallel requests and late replies from an old session must not log out a new one.
      if (generation === sessionGeneration && !expiryNotified) {
        expiryNotified = true;
        window.dispatchEvent(new Event('session-expired'));
      }
      throw new SessionExpiredError(message, response.status);
    }
    throw new ApiError(message, response.status);
  }
  if (url === '/auth/login' || url === '/auth/me') {
    sessionGeneration++;
    expiryNotified = false;
  } else if (url === '/auth/logout') {
    sessionGeneration++;
    expiryNotified = true;
  }
  return data as T;
}
