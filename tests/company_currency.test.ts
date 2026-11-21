import { describe, expect, it, beforeEach } from 'vitest';
import { header, seedUsers, signIn, resetBusinessData } from './helpers';
import { one, run } from '../server/db';
import { currencySymbol } from '../src/currency';
import { currencyLabel } from '../server/currency';

describe('Company currency setting', () => {
  let admin: Awaited<ReturnType<typeof signIn>>;

  beforeEach(async () => {
    resetBusinessData();
    run('DELETE FROM user_branches');
    run('DELETE FROM users');
    await seedUsers();
    run("UPDATE company SET currency='EGP' WHERE id=1");
    admin = await signIn('admin@test.local');
  });

  const body = (extra: object = {}) => ({
    name: 'شركة اختبار',
    email: '',
    phone: '',
    address: '',
    invoice_note: '',
    ...extra,
  });

  it('defaults to EGP', async () => {
    const res = await admin.get('/api/company').set(header).expect(200);
    expect(res.body.currency).toBe('EGP');
    expect(currencyLabel()).toBe('ج.م');
  });

  it('can be changed per company', async () => {
    await admin
      .put('/api/company')
      .set(header)
      .send(body({ currency: 'SAR' }))
      .expect(200);
    expect(one<{ currency: string }>('SELECT currency FROM company WHERE id=1')!.currency).toBe(
      'SAR',
    );
    expect(currencyLabel()).toBe('ر.س');
  });

  it('keeps the current currency when the field is omitted', async () => {
    await admin
      .put('/api/company')
      .set(header)
      .send(body({ currency: 'USD' }))
      .expect(200);
    await admin.put('/api/company').set(header).send(body()).expect(200);
    expect(one<{ currency: string }>('SELECT currency FROM company WHERE id=1')!.currency).toBe(
      'USD',
    );
  });

  it('rejects malformed currency codes', async () => {
    await admin
      .put('/api/company')
      .set(header)
      .send(body({ currency: 'sa' }))
      .expect(400);
    await admin
      .put('/api/company')
      .set(header)
      .send(body({ currency: 'EGPX' }))
      .expect(400);
  });

  it('shows the code itself for a currency without a known symbol', () => {
    expect(currencySymbol('CHF')).toBe('CHF');
    expect(currencySymbol('EGP')).toBe('ج.م');
  });
});
