import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { generateKeyPairSync, sign } from 'node:crypto';
import request from 'supertest';
import { app } from '../server/app';
import { header, seedUsers, signIn, resetBusinessData } from './helpers';
import { run } from '../server/db';
import { licenseStatus } from '../server/license';
import { isAddonEnabled, listAddons } from '../server/addons/registry';

const pair = generateKeyPairSync('ed25519');
const other = generateKeyPairSync('ed25519');
const pubB64 = pair.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');

function issue(
  fields: {
    addons?: string[];
    expires?: string | null;
    customer?: string;
    base?: boolean | 'omit';
  } = {},
  priv = pair.privateKey,
) {
  const payload = {
    v: 1,
    customer: fields.customer ?? 'عميل',
    ...(fields.base === 'omit' ? {} : { base: fields.base ?? true }),
    addons: fields.addons ?? ['crm'],
    issued: '2026-01-01',
    expires: fields.expires === undefined ? null : fields.expires,
  };
  const bytes = Buffer.from(JSON.stringify(payload));
  return `${bytes.toString('base64url')}.${sign(null, bytes, priv).toString('base64url')}`;
}

describe('License keys and add-on gating', () => {
  let admin: Awaited<ReturnType<typeof signIn>>;

  beforeEach(async () => {
    resetBusinessData();
    run('DELETE FROM user_branches');
    run('DELETE FROM users');
    run('DELETE FROM license');
    await seedUsers();
    admin = await signIn('admin@test.local');
  });
  afterEach(() => {
    delete process.env.ORQIVA_LICENSE_PUBLIC_KEY;
    delete process.env.ORQIVA_LICENSE;
  });

  it('is open (everything enabled) when no public key is configured', () => {
    expect(licenseStatus()).toEqual({ enforced: false, state: 'open' });
    expect(isAddonEnabled('crm')).toBe(true);
  });

  it('locks the whole app when enforced and no license is installed', async () => {
    process.env.ORQIVA_LICENSE_PUBLIC_KEY = pubB64;
    expect(licenseStatus().state).toBe('missing');
    expect(listAddons().find((a) => a.id === 'crm')).toMatchObject({
      enabled: false,
      reason: 'unlicensed',
    });
    const locked = await admin.get('/api/company').set(header).expect(402);
    expect(locked.body.code).toBe('LICENSE_REQUIRED');
    await admin.get('/api/crm/stages').set(header).expect(402);
    await admin.get('/api/pos/sessions').set(header).expect(402);
    // Health, session and license endpoints stay reachable so the buyer can activate.
    await request(app).get('/api/health').expect(200);
    await admin.get('/api/auth/me').set(header).expect(200);
    await admin.get('/api/license').set(header).expect(200);
  });

  it('activates from the public screen, once, before anyone signs in', async () => {
    process.env.ORQIVA_LICENSE_PUBLIC_KEY = pubB64;
    const status = await request(app).get('/api/license/status').expect(200);
    expect(status.body).toMatchObject({ enforced: true, state: 'missing', locked: true });
    await request(app)
      .put('/api/license/activate')
      .set(header)
      .send({ key: issue({}, other.privateKey) })
      .expect(400);
    await request(app)
      .put('/api/license/activate')
      .set(header)
      .send({ key: issue({ addons: [] }) })
      .expect(200);
    await admin.get('/api/company').set(header).expect(200);
    // Once valid, the public route cannot replace the key.
    await request(app)
      .put('/api/license/activate')
      .set(header)
      .send({ key: issue({ addons: ['*'] }) })
      .expect(409);
  });

  it('a base-only key opens the system but keeps every add-on off, backup included', async () => {
    process.env.ORQIVA_LICENSE_PUBLIC_KEY = pubB64;
    await admin
      .put('/api/license')
      .set(header)
      .send({ key: issue({ addons: [] }) })
      .expect(200);
    await admin.get('/api/company').set(header).expect(200);
    expect(isAddonEnabled('crm')).toBe(false);
    expect(isAddonEnabled('loyalty')).toBe(false);
    expect(isAddonEnabled('backup')).toBe(false);
  });

  it('keys issued before the base entitlement existed still count as base-licensed', async () => {
    process.env.ORQIVA_LICENSE_PUBLIC_KEY = pubB64;
    await admin
      .put('/api/license')
      .set(header)
      .send({ key: issue({ base: 'omit' }) })
      .expect(200);
    await admin.get('/api/company').set(header).expect(200);
  });

  it('refuses a key that explicitly excludes the base license', async () => {
    process.env.ORQIVA_LICENSE_PUBLIC_KEY = pubB64;
    await admin
      .put('/api/license')
      .set(header)
      .send({ key: issue({ base: false }) })
      .expect(400);
  });

  it('installs a valid key and unlocks the listed add-on', async () => {
    process.env.ORQIVA_LICENSE_PUBLIC_KEY = pubB64;
    const res = await admin.put('/api/license').set(header).send({ key: issue() }).expect(200);
    expect(res.body).toMatchObject({ state: 'valid', customer: 'عميل', addons: ['crm'] });
    await admin.get('/api/crm/stages').set(header).expect(200);
  });

  it('a license that does not list the add-on keeps it off', async () => {
    process.env.ORQIVA_LICENSE_PUBLIC_KEY = pubB64;
    await admin
      .put('/api/license')
      .set(header)
      .send({ key: issue({ addons: ['other'] }) })
      .expect(200);
    expect(isAddonEnabled('crm')).toBe(false);
  });

  it('wildcard license unlocks every add-on', async () => {
    process.env.ORQIVA_LICENSE_PUBLIC_KEY = pubB64;
    await admin
      .put('/api/license')
      .set(header)
      .send({ key: issue({ addons: ['*'] }) })
      .expect(200);
    expect(isAddonEnabled('crm')).toBe(true);
  });

  it('rejects keys signed by another key or tampered with', async () => {
    process.env.ORQIVA_LICENSE_PUBLIC_KEY = pubB64;
    await admin
      .put('/api/license')
      .set(header)
      .send({ key: issue({}, other.privateKey) })
      .expect(400);
    const good = issue();
    const [p, s] = good.split('.');
    const forged = Buffer.from(
      JSON.stringify({ v: 1, customer: 'x', addons: ['*'], issued: '2026-01-01', expires: null }),
    ).toString('base64url');
    await admin
      .put('/api/license')
      .set(header)
      .send({ key: `${forged}.${s}` })
      .expect(400);
    expect(p).toBeTruthy();
  });

  it('rejects an already expired key and locks the app after expiry', async () => {
    process.env.ORQIVA_LICENSE_PUBLIC_KEY = pubB64;
    await admin
      .put('/api/license')
      .set(header)
      .send({ key: issue({ expires: '2020-01-01' }) })
      .expect(400);
    process.env.ORQIVA_LICENSE = issue({ expires: '2020-01-01' });
    expect(licenseStatus().state).toBe('expired');
    expect(isAddonEnabled('crm')).toBe(false);
    await admin.get('/api/company').set(header).expect(402);
  });

  it('a release build with a compiled-in key ignores the environment and stays locked', () => {
    const g = globalThis as { __ORQIVA_RELEASE_KEY__?: string };
    g.__ORQIVA_RELEASE_KEY__ = pubB64;
    try {
      // Removing or blanking the env var (the old "delete the key file" bypass) changes nothing.
      delete process.env.ORQIVA_LICENSE_PUBLIC_KEY;
      expect(licenseStatus()).toMatchObject({ enforced: true, state: 'missing' });
      process.env.ORQIVA_LICENSE_PUBLIC_KEY = '';
      expect(licenseStatus().enforced).toBe(true);
      // Pointing the env var at another key does not swap the vendor key either.
      process.env.ORQIVA_LICENSE_PUBLIC_KEY = other.publicKey
        .export({ type: 'spki', format: 'der' })
        .toString('base64');
      process.env.ORQIVA_LICENSE = issue();
      expect(licenseStatus().state).toBe('valid');
      process.env.ORQIVA_LICENSE = issue({}, other.privateKey);
      expect(licenseStatus().state).toBe('invalid');
      // An empty compiled-in key is still enforced (never open).
      g.__ORQIVA_RELEASE_KEY__ = '';
      expect(licenseStatus().enforced).toBe(true);
    } finally {
      delete g.__ORQIVA_RELEASE_KEY__;
    }
  });

  it('only admins with user management can read or install a license', async () => {
    const staff = await signIn('staff@test.local');
    await staff.get('/api/license').set(header).expect(403);
  });
});
