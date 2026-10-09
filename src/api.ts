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

export async function api<T>(
  url: string,
  method = 'GET',
  body?: unknown,
  requestKey?: string,
): Promise<T> {
  const generation = sessionGeneration;
  const response = await fetch('/api' + url, {
    method,
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      'X-Orqiva-Request': '1',
      ...(requestKey ? { 'Idempotency-Key': requestKey } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) {
    const message = data.error + (data.details ? ' — ' + data.details.join('، ') : '');
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
