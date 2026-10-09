import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

try {
  process.loadEnvFile();
} catch {
  /* Environment variables may be supplied by Docker. */
}
const path = process.env.DATABASE_PATH || './data/orqiva.db';
if (path !== ':memory:') mkdirSync(dirname(resolve(path)), { recursive: true });
export const db = new DatabaseSync(path);
db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
export const id = () => randomUUID();
export const now = () => new Date().toISOString();
export function all<T>(sql: string, ...params: SQLInputValue[]): T[] {
  return db.prepare(sql).all(...params) as T[];
}
export function one<T>(sql: string, ...params: SQLInputValue[]): T | undefined {
  return db.prepare(sql).get(...params) as T | undefined;
}
export function run(sql: string, ...params: SQLInputValue[]) {
  return db.prepare(sql).run(...params);
}
export function transaction<T>(fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const value = fn();
    db.exec('COMMIT');
    return value;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
/**
 * Applies pending SQL migrations in file-name order, each in its own transaction.
 * A migration whose first line is `-- orqiva:foreign_keys=off` may rebuild tables or add
 * referencing columns; foreign keys are paused for it and integrity is verified before commit.
 */
export function migrate() {
  db.exec(
    'CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)',
  );
  const dir = fileURLToPath(new URL('../database/migrations/', import.meta.url));
  for (const name of readdirSync(dir)
    .filter((n) => n.endsWith('.sql'))
    .sort()) {
    if (one('SELECT name FROM schema_migrations WHERE name=?', name)) continue;
    const sql = readFileSync(resolve(dir, name), 'utf8');
    const pauseForeignKeys = sql.startsWith('-- orqiva:foreign_keys=off');
    if (pauseForeignKeys) db.exec('PRAGMA foreign_keys=OFF');
    try {
      transaction(() => {
        db.exec(sql);
        if (pauseForeignKeys && all('PRAGMA foreign_key_check').length)
          throw new Error(`Foreign key violations found while applying ${name}`);
        run('INSERT INTO schema_migrations VALUES (?,?)', name, now());
      });
    } finally {
      if (pauseForeignKeys) db.exec('PRAGMA foreign_keys=ON');
    }
    console.log(`Applied migration: ${name}`);
  }
}
