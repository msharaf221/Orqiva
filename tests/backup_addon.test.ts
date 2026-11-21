import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { header, seedUsers, signIn, resetBusinessData } from './helpers';
import { run } from '../server/db';
import { runBackup, runScheduledBackup, listBackups } from '../server/modules/backup/service';
import { decryptFile } from '../server/modules/backup/crypto';

describe('Backup add-on', () => {
  let dir: string;
  let admin: Awaited<ReturnType<typeof signIn>>;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'orqiva-bk-'));
    process.env.ORQIVA_BACKUP_DIR = dir;
    resetBusinessData();
    run('DELETE FROM user_branches');
    run('DELETE FROM users');
    await seedUsers();
    admin = await signIn('admin@test.local');
  });
  afterEach(() => {
    for (const k of [
      'ORQIVA_BACKUP_DIR',
      'ORQIVA_BACKUP_KEEP',
      'ORQIVA_BACKUP_CLOUD_URL',
      'ORQIVA_BACKUP_PASSPHRASE',
      'ORQIVA_BACKUP_SCHEDULE',
      'ORQIVA_ADDONS',
    ])
      delete process.env[k];
    vi.unstubAllGlobals();
    rmSync(dir, { recursive: true, force: true });
  });

  it('creates a consistent local backup through the API and lists it', async () => {
    const res = await admin.post('/api/backup/run').set(header).send({}).expect(200);
    expect(res.body.cloud).toBe('skipped');
    const list = await admin.get('/api/backup').set(header).expect(200);
    expect(list.body.backups).toHaveLength(1);
    const copy = new DatabaseSync(join(dir, res.body.file.name));
    expect(copy.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' });
    copy.close();
  });

  it('downloads a listed backup and refuses path tricks', async () => {
    const res = await admin.post('/api/backup/run').set(header).send({}).expect(200);
    await admin.get(`/api/backup/download/${res.body.file.name}`).set(header).expect(200);
    await admin.get('/api/backup/download/..%2Fpackage.json').set(header).expect(404);
  });

  it('is admin only and disappears when the add-on is off', async () => {
    const staff = await signIn('staff@test.local');
    await staff.get('/api/backup').set(header).expect(403);
    process.env.ORQIVA_ADDONS = 'crm';
    await admin.get('/api/backup').set(header).expect(404);
  });

  it('keeps only the newest N backups', async () => {
    process.env.ORQIVA_BACKUP_KEEP = '2';
    for (let i = 0; i < 3; i++) {
      await runBackup();
      await new Promise((r) => setTimeout(r, 15));
    }
    expect(listBackups()).toHaveLength(2);
  });

  it('runs the daily schedule only when the newest backup is older than 24h', async () => {
    const first = await runScheduledBackup();
    expect(first).not.toBeNull();
    expect(await runScheduledBackup()).toBeNull();
    const old = new Date(Date.now() - 25 * 3_600_000);
    utimesSync(join(dir, listBackups()[0].name), old, old);
    expect(await runScheduledBackup()).not.toBeNull();
    process.env.ORQIVA_BACKUP_SCHEDULE = 'off';
    utimesSync(join(dir, listBackups()[0].name), old, old);
    expect(await runScheduledBackup()).toBeNull();
  });

  it('uploads an encrypted copy to the cloud URL that decrypts with the passphrase', async () => {
    process.env.ORQIVA_BACKUP_CLOUD_URL = 'https://cloud.example/backups/';
    process.env.ORQIVA_BACKUP_PASSPHRASE = 'correct horse';
    let sent: Buffer | null = null;
    let url = '';
    vi.stubGlobal('fetch', async (u: string, init: { body: Buffer }) => {
      url = u;
      sent = init.body;
      return { ok: true, status: 201 };
    });
    const res = await runBackup();
    expect(res.cloud).toBe('uploaded');
    expect(url).toBe(`https://cloud.example/backups/${res.file.name}.enc`);
    const enc = join(dir, 'in.enc');
    writeFileSync(enc, sent!);
    // The provider only ever sees ciphertext.
    expect(sent!.includes(Buffer.from('SQLite format 3'))).toBe(false);
    const out = join(dir, 'out.db');
    await decryptFile(enc, out, 'correct horse');
    expect(readFileSync(out).subarray(0, 15).toString()).toBe('SQLite format 3');
    await expect(decryptFile(enc, join(dir, 'bad.db'), 'wrong')).rejects.toThrow();
  });

  it('keeps the local copy and reports when the cloud upload fails', async () => {
    process.env.ORQIVA_BACKUP_CLOUD_URL = 'https://cloud.example/b';
    process.env.ORQIVA_BACKUP_PASSPHRASE = 'x';
    vi.stubGlobal('fetch', async () => ({ ok: false, status: 507 }));
    const res = await runBackup();
    expect(res.cloud).toBe('failed');
    expect(res.cloud_error).toContain('507');
    expect(listBackups()).toHaveLength(1);
  });
});
