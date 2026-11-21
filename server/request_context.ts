import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

/**
 * Correlates everything a request touches. The id is accepted from the
 * `X-Request-Id` header when a trusted caller supplies one, otherwise generated.
 * It is echoed on the response, attached to error payloads, and stamped on every
 * audit row written while the request runs.
 */
const storage = new AsyncLocalStorage<string>();

export function currentRequestId(): string | null {
  return storage.getStore() ?? null;
}

const SAFE_ID = /^[\w-]{1,64}$/;

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.headers['x-request-id'];
  const candidate = Array.isArray(incoming) ? incoming[0] : incoming;
  const requestId = candidate && SAFE_ID.test(candidate) ? candidate : randomUUID();
  res.setHeader('X-Request-Id', requestId);
  storage.run(requestId, next);
}
