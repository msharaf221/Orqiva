import { api } from './api';

/**
 * Sends a POST with an `Idempotency-Key` so a double click or a retry after a flaky network
 * cannot post the same business action twice. The key is reused while the same request is
 * retried (same scope and same body) and dropped after a success, so the next legitimate
 * action, even an identical one, gets a fresh key.
 */
const attempts = new Map<string, { sig: string; key: string }>();

export async function idempotentApi<T>(scope: string, url: string, body: unknown): Promise<T> {
  const sig = JSON.stringify(body ?? null);
  let attempt = attempts.get(scope);
  if (!attempt || attempt.sig !== sig) {
    attempt = { sig, key: crypto.randomUUID() };
    attempts.set(scope, attempt);
  }
  const result = await api<T>(url, 'POST', body, attempt.key);
  attempts.delete(scope);
  return result;
}
