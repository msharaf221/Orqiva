import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { generateKeyPairSync, sign } from 'node:crypto';
import { header, seedUsers, signIn, resetBusinessData } from './helpers';
import { run } from '../server/db';
import { licenseStatus } from '../server/license';
import { isAddonEnabled, listAddons } from '../server/addons/registry';

const pair = generateKeyPairSync('ed25519');
const other = generateKeyPairSync('ed25519');
const pubB64 = pair.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');

function issue(
  fields: { addons?: string[]; expires?: string | null; customer?: string } = {},
  priv = pair.privateKey,
) {
  const payload = {
    v: 1,
    customer: fields.customer ?? 'عميل',
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

  it('turns add-ons off when enforced and no license is installed, but keeps the core', async () => {
    process.env.ORQIVA_LICENSE_PUBLIC_KEY = pubB64;
    expect(licenseStatus().state).toBe('missing');
    expect(listAddons().find((a) => a.id === 'crm')).toMatchObject({
      enabled: false,
      reason: 'unlicensed',
    });
    await admin.get('/api/crm/stages').set(header).expect(404);
    await admin.get('/api/company').set(header).expect(200);
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

  it('rejects an already expired key and turns add-ons off after expiry', async () => {
    process.env.ORQIVA_LICENSE_PUBLIC_KEY = pubB64;
    await admin
      .put('/api/license')
      .set(header)
      .send({ key: issue({ expires: '2020-01-01' }) })
      .expect(400);
    process.env.ORQIVA_LICENSE = issue({ expires: '2020-01-01' });
    expect(licenseStatus().state).toBe('expired');
    expect(isAddonEnabled('crm')).toBe(false);
    await admin.get('/api/company').set(header).expect(200);
  });

  it('only admins with user management can read or install a license', async () => {
    const staff = await signIn('staff@test.local');
    await staff.get('/api/license').set(header).expect(403);
  });
});
