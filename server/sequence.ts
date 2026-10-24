import { now, one, run } from './db';

/**
 * Annual, gap-free sequence per prefix, e.g. `INV-2026-0001`.
 * The upsert is atomic, so concurrent callers cannot receive the same number.
 * Must run inside the same transaction as the document it numbers.
 */
export function nextNumber(prefix: string, year: string): string {
  const key = `${prefix}-${year}`;
  run(
    'INSERT INTO sequences(id,value) VALUES(?,1) ON CONFLICT(id) DO UPDATE SET value=value+1',
    key,
  );
  const sequence = one<{ value: number }>('SELECT value FROM sequences WHERE id=?', key);
  if (!sequence) throw new Error(`Unable to allocate sequence ${key} at ${now()}`);
  return `${key}-${String(sequence.value).padStart(4, '0')}`;
}
