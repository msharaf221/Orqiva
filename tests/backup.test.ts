import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, unlinkSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { migrate } from '../server/db';

describe('Database Backup Script', () => {
  it('creates an online consistent backup with verified integrity', () => {
    migrate();
    const backupDir = resolve('backups/test');
    mkdirSync(backupDir, { recursive: true });
    const targetFile = resolve(backupDir, `test-backup-${Date.now()}.db`);

    try {
      // Execute backup CLI using the current test database
      const output = execFileSync('npx', ['tsx', 'server/backup.ts', targetFile], {
        encoding: 'utf-8',
        env: { ...process.env, DATABASE_PATH: process.env.DATABASE_PATH },
      });
      expect(output).toContain('Consistent SQLite backup created');
      expect(existsSync(targetFile)).toBe(true);

      // Verify backup database integrity
      const backupDb = new DatabaseSync(targetFile);
      const integrity = backupDb.prepare('PRAGMA integrity_check').get() as {
        integrity_check: string;
      };
      expect(integrity.integrity_check).toBe('ok');

      const userTable = backupDb
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'")
        .get();
      expect(userTable).toBeDefined();

      backupDb.close();
    } finally {
      if (existsSync(targetFile)) {
        unlinkSync(targetFile);
      }
    }
  });
});
