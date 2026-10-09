import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterAll } from 'vitest';
const dir = mkdtempSync(join(tmpdir(), 'orqiva-tests-'));
process.env.DATABASE_PATH = join(dir, 'test.db');
process.env.NODE_ENV = 'test';
process.env.COOKIE_SECURE = 'false';
process.env.COOKIE_PARTITIONED = 'false';
afterAll(async () => {
  const { db } = await import('../server/db');
  db.close();
  rmSync(dir, { recursive: true, force: true });
});
