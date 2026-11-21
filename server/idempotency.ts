import { createHash } from 'node:crypto';
import type { Request, Response } from 'express';
import { id, now, one, run, transaction } from './db';
import { AppError } from './service';
import type { Actor } from './scope';

/**
 * Shared retry-safety for unsafe POSTs (POS checkout, payroll confirmation, PO
 * receiving, transfer receiving, stocktake approval, quotation conversion, ...).
 *
 * The client sends an `Idempotency-Key` header (a fresh UUID per business action).
 * The first execution runs the handler inside one transaction together with the
 * key insert, so a crash either persists both or neither. A replay with the same
 * key and an identical body returns the stored response without re-executing; a
 * replay with a different body is rejected as a conflict.
 */

export interface IdempotentResult<T> {
  status: number;
  body: T;
  replayed: boolean;
}

interface StoredKey {
  request_hash: string;
  status: number;
  response: string;
}

/** Canonical JSON: object keys sorted recursively so hash equality means equality. */
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`);
  return `{${entries.join(',')}}`;
}

function hashPayload(payload: unknown): string {
  return createHash('sha256').update(canonical(payload)).digest('hex');
}

/** Reads and validates the `Idempotency-Key` header; absent means "no protection". */
export function idempotencyKey(req: Request): string | undefined {
  const raw = req.headers['idempotency-key'];
  const key = Array.isArray(raw) ? raw[0] : raw;
  if (key === undefined || key === '') return undefined;
  if (key.length > 128) throw new AppError(400, 'مفتاح عدم التكرار طويل جدًا');
  return key;
}

export function withIdempotency<T>(
  actor: Pick<Actor, 'id'>,
  endpoint: string,
  key: string | undefined,
  payload: unknown,
  status: number,
  fn: () => T,
): IdempotentResult<T> {
  if (!key) return { status, body: fn(), replayed: false };

  const requestHash = hashPayload(payload);
  const existing = one<StoredKey>(
    'SELECT request_hash, status, response FROM idempotency_keys WHERE actor_id=? AND endpoint=? AND key=?',
    actor.id,
    endpoint,
    key,
  );
  if (existing) return replay(existing, requestHash);

  try {
    const body = transaction(() => {
      const result = fn();
      run(
        'INSERT INTO idempotency_keys(id, actor_id, endpoint, key, request_hash, status, response, created_at) VALUES(?,?,?,?,?,?,?,?)',
        id(),
        actor.id,
        endpoint,
        key,
        requestHash,
        status,
        JSON.stringify(result ?? null),
        now(),
      );
      return result;
    });
    return { status, body, replayed: false };
  } catch (error) {
    // A concurrent request with the same key won the race: return its stored response.
    if (error instanceof Error && error.message.includes('UNIQUE constraint')) {
      const winner = one<StoredKey>(
        'SELECT request_hash, status, response FROM idempotency_keys WHERE actor_id=? AND endpoint=? AND key=?',
        actor.id,
        endpoint,
        key,
      );
      if (winner) return replay(winner, requestHash);
    }
    throw error;
  }
}

/** Sends an idempotent result, marking replays so clients can tell them apart. */
export function sendIdempotent<T>(res: Response, result: IdempotentResult<T>): void {
  if (result.replayed) res.setHeader('Idempotency-Replayed', 'true');
  res.status(result.status).json(result.body);
}

function replay<T>(stored: StoredKey, requestHash: string): IdempotentResult<T> {
  if (stored.request_hash !== requestHash) {
    throw new AppError(409, 'مفتاح عدم التكرار استُخدم من قبل ببيانات مختلفة');
  }
  return {
    status: stored.status,
    body: JSON.parse(stored.response) as T,
    replayed: true,
  };
}

/** Deletes stored keys older than `days`. Retries never come that late, so the table stays small. */
export function pruneIdempotencyKeys(days = 30, at: Date = new Date()): number {
  const cutoff = new Date(at.getTime() - days * 86_400_000).toISOString();
  const r = run('DELETE FROM idempotency_keys WHERE created_at < ?', cutoff);
  return Number((r as { changes?: number | bigint } | undefined)?.changes ?? 0);
}
