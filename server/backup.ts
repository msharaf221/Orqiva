import { backup } from 'node:sqlite';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { db, one } from './db';
const destination = resolve(
  process.argv[2] || `backups/orqiva-${new Date().toISOString().replace(/[:.]/g, '-')}.db`,
);
if (existsSync(destination))
  throw new Error('Backup destination already exists. Choose a new filename.');
if (!one("SELECT name FROM sqlite_master WHERE type='table' AND name='users'"))
  throw new Error('Source database is uninitialized. Check DATABASE_PATH.');
mkdirSync(dirname(destination), { recursive: true });
await backup(db, destination);
console.log(`Consistent SQLite backup created: ${destination}`);
db.close();
