import { rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
const path = resolve('data/e2e.db');
if (resolve(process.env.DATABASE_PATH || '') !== path)
  throw new Error('E2E setup only allows data/e2e.db');
for (const suffix of ['', '-wal', '-shm']) rmSync(path + suffix, { force: true });
execFileSync(process.execPath, ['--import', 'tsx', 'server/seed.ts'], {
  stdio: 'inherit',
  env: process.env,
});
