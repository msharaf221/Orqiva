import { describe, expect, it, afterEach, beforeAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPairSync } from 'node:crypto';
import { resetBusinessData } from './helpers';
import { one, run, now } from '../server/db';
import { pruneIdempotencyKeys } from '../server/idempotency';
import { isAddonEnabled } from '../server/addons/registry';
import { encryptFile, decryptFile } from '../server/modules/backup/crypto';

describe('review follow-ups', () => {
  beforeAll(() => resetBusinessData());
  afterEach(() => {
    delete process.env.ORQIVA_LICENSE_PUBLIC_KEY;
  });

  it('prunes idempotency keys older than the retention window only', () => {
    run('DELETE FROM idempotency_keys');
    const user = one<{ id: string }>('SELECT id FROM users LIMIT 1');
    const actor = user?.id ?? 'u';
    run('PRAGMA foreign_keys=OFF');
    const old = new Date(Date.now() - 40 * 86_400_000).toISOString();
    for (const [k, at] of [
      ['old', old],
      ['new', now()],
    ])
      run(
        'INSERT INTO idempotency_keys(id,actor_id,endpoint,key,request_hash,status,response,created_at) VALUES(?,?,?,?,?,?,?,?)',
        `id-${k}`,
        actor,
        'e',
        k,
        'h',
        200,
        '{}',
        at,
      );
    run('PRAGMA foreign_keys=ON');
    expect(pruneIdempotencyKeys(30)).toBe(1);
    expect(one('SELECT 1 FROM idempotency_keys WHERE key=?', 'new')).toBeTruthy();
    expect(one('SELECT 1 FROM idempotency_keys WHERE key=?', 'old')).toBeFalsy();
    run('DELETE FROM idempotency_keys');
  });

  it('backup is a normal add-on: off when the license is missing', () => {
    process.env.ORQIVA_LICENSE_PUBLIC_KEY = generateKeyPairSync('ed25519')
      .publicKey.export({ type: 'spki', format: 'der' })
      .toString('base64');
    run('DELETE FROM license');
    expect(isAddonEnabled('backup')).toBe(false);
    expect(isAddonEnabled('crm')).toBe(false);
  });

  it('leaves no plaintext behind when decryption fails', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'orqiva-dec-'));
    try {
      const src = join(dir, 'a.db');
      writeFileSync(src, 'secret data '.repeat(100));
      await encryptFile(src, join(dir, 'a.enc'), 'right');
      await expect(decryptFile(join(dir, 'a.enc'), join(dir, 'out.db'), 'wrong')).rejects.toThrow();
      expect(existsSync(join(dir, 'out.db'))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
