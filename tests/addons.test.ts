import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { Router } from 'express';
import { header, seedUsers, signIn, resetBusinessData } from './helpers';
import { run } from '../server/db';
import { listAddons, isAddonEnabled, registerAddon } from '../server/addons/registry';

describe('Add-on kernel', () => {
  let admin: Awaited<ReturnType<typeof signIn>>;

  beforeEach(async () => {
    resetBusinessData();
    run('DELETE FROM user_branches');
    run('DELETE FROM users');
    await seedUsers();
    admin = await signIn('admin@test.local');
  });
  afterEach(() => {
    delete process.env.ORQIVA_ADDONS;
  });

  it('lists built-in add-ons, all enabled by default', async () => {
    const res = await admin.get('/api/addons').set(header).expect(200);
    const crm = res.body.find((a: { id: string }) => a.id === 'crm');
    expect(crm).toMatchObject({ id: 'crm', enabled: true, version: '1.0.0' });
  });

  it('CRM routes work when the add-on is enabled', async () => {
    await admin.get('/api/crm/stages').set(header).expect(200);
  });

  it('disabled add-on answers 404 and reports why', async () => {
    process.env.ORQIVA_ADDONS = 'something_else';
    expect(isAddonEnabled('crm')).toBe(false);
    const res = await admin.get('/api/crm/stages').set(header).expect(404);
    expect(res.body.error).toContain('غير مفعّلة');
    const list = await admin.get('/api/addons').set(header).expect(200);
    expect(list.body.find((a: { id: string }) => a.id === 'crm')).toMatchObject({
      enabled: false,
      reason: 'disabled',
    });
  });

  it('an explicit list or * enables add-ons', () => {
    process.env.ORQIVA_ADDONS = 'crm';
    expect(isAddonEnabled('crm')).toBe(true);
    process.env.ORQIVA_ADDONS = '*';
    expect(isAddonEnabled('crm')).toBe(true);
  });

  it('turns off an add-on whose dependency is off, and rejects bad ids and duplicates', () => {
    registerAddon({
      id: 'crm_extra',
      name: 'اختبار',
      version: '0.0.1',
      depends: ['crm'],
      mountPath: '/api/crm-extra',
      router: Router(),
    });
    process.env.ORQIVA_ADDONS = 'crm_extra';
    const extra = listAddons().find((a) => a.id === 'crm_extra');
    expect(extra).toMatchObject({ enabled: false, reason: 'missing_dependency' });
    process.env.ORQIVA_ADDONS = 'crm,crm_extra';
    expect(isAddonEnabled('crm_extra')).toBe(true);
    expect(() =>
      registerAddon({ id: 'Bad Id', name: 'x', version: '1', mountPath: '/x', router: Router() }),
    ).toThrow();
    expect(() =>
      registerAddon({ id: 'crm', name: 'x', version: '1', mountPath: '/x', router: Router() }),
    ).toThrow();
  });
});
