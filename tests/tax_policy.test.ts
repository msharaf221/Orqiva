import { describe, expect, it, beforeEach } from 'vitest';
import { header, seedUsers, signIn, resetBusinessData } from './helpers';
import { one, run, now } from '../server/db';
import { taxPolicy, calculateTax, etaEnabled } from '../server/tax_policy';

describe('Per-company tax policy', () => {
  let admin: Awaited<ReturnType<typeof signIn>>;

  beforeEach(async () => {
    resetBusinessData();
    run('DELETE FROM user_branches');
    run('DELETE FROM users');
    await seedUsers();
    run("UPDATE company SET tax_mode='NONE', eta_enabled=0, payroll_tax_enabled=0 WHERE id=1");
    run(
      'INSERT OR REPLACE INTO parties VALUES(?,?,?,?,?,?,?,?,?,?)',
      'customer',
      'CUSTOMER',
      'عميل',
      '',
      '',
      '',
      '',
      '',
      1,
      now(),
    );
    run(
      'INSERT OR REPLACE INTO products VALUES(?,?,?,?,?,?,?,?,?,?)',
      'product',
      'SKU-01',
      'منتج',
      'عام',
      'قطعة',
      10000,
      6000,
      3,
      1,
      now(),
    );
    run(
      "INSERT OR IGNORE INTO branch_products(branch_id,product_id,active) VALUES('main','product',1)",
    );
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
  const sale = (rate = 1400) => ({
    type: 'SALE',
    branch_id: 'main',
    party_id: 'customer',
    date: '2026-10-01',
    due_date: '2026-10-15',
    discount: 1000,
    tax_rate: rate,
    notes: '',
    lines: [{ product_id: 'product', quantity: 2, unit_price: 10000 }],
  });

  it('is tax-free by default', async () => {
    expect(taxPolicy().vat).toBe(false);
    expect(calculateTax(10000, 1400)).toBe(0);
    const res = await admin.post('/api/documents').set(header).send(sale()).expect(201);
    expect(res.body.tax).toBe(0);
    expect(res.body.total).toBe(19000);
  });

  it('charges 14% once VAT is enabled', async () => {
    await admin
      .put('/api/company')
      .set(header)
      .send(body({ tax_mode: 'VAT', tax_rate: 1400, tax_number: '123' }))
      .expect(200);
    expect(taxPolicy().vat).toBe(true);
    const res = await admin.post('/api/documents').set(header).send(sale()).expect(201);
    expect(res.body.tax).toBe(2660);
    expect(res.body.total).toBe(21660);
  });

  it('lets the company edit the rate', async () => {
    await admin
      .put('/api/company')
      .set(header)
      .send(body({ tax_mode: 'VAT', tax_rate: 500 }))
      .expect(200);
    expect(one<{ tax_rate: number }>('SELECT tax_rate FROM company WHERE id=1')!.tax_rate).toBe(
      500,
    );
    const res = await admin.post('/api/documents').set(header).send(sale(500)).expect(201);
    expect(res.body.tax).toBe(950);
  });

  it('zeroes the rate and tax identity when switched back to no tax', async () => {
    await admin
      .put('/api/company')
      .set(header)
      .send(body({ tax_mode: 'VAT', tax_rate: 1400, tax_number: '123' }))
      .expect(200);
    await admin
      .put('/api/company')
      .set(header)
      .send(body({ tax_mode: 'NONE' }))
      .expect(200);
    const c = one<{ tax_rate: number; tax_number: string }>('SELECT * FROM company WHERE id=1')!;
    expect(c.tax_rate).toBe(0);
    expect(c.tax_number).toBe('');
  });

  it('only enables ETA together with VAT', async () => {
    await admin
      .put('/api/company')
      .set(header)
      .send(body({ eta_enabled: true }))
      .expect(200);
    expect(etaEnabled()).toBe(false);
    await admin
      .put('/api/company')
      .set(header)
      .send(body({ tax_mode: 'VAT', eta_enabled: true }))
      .expect(200);
    expect(etaEnabled()).toBe(true);
  });

  it('toggles payroll tax independently of VAT', async () => {
    expect(taxPolicy().payrollTax).toBe(false);
    await admin
      .put('/api/company')
      .set(header)
      .send(body({ payroll_tax_enabled: true }))
      .expect(200);
    expect(taxPolicy().payrollTax).toBe(true);
    expect(taxPolicy().vat).toBe(false);
  });

  describe('tax-inclusive entry', () => {
    const vat = () =>
      admin
        .put('/api/company')
        .set(header)
        .send(body({ tax_mode: 'VAT', tax_rate: 1400 }))
        .expect(200);

    it('keeps the entered gross as the total and splits out the tax', async () => {
      await vat();
      const res = await admin
        .post('/api/documents')
        .set(header)
        .send({ ...sale(), discount: 0, prices_include_tax: true })
        .expect(201);
      // 2 x 100.00 gross = 200.00 total, tax portion = 200 - 200/1.14
      expect(res.body.total).toBe(20000);
      expect(res.body.tax).toBe(2456);
      expect(res.body.subtotal - res.body.discount + res.body.tax).toBe(res.body.total);
    });

    it('applies the discount to the gross and still reconciles', async () => {
      await vat();
      const res = await admin
        .post('/api/documents')
        .set(header)
        .send({ ...sale(), discount: 1140, prices_include_tax: true })
        .expect(201);
      expect(res.body.total).toBe(20000 - 1140);
      expect(res.body.subtotal - res.body.discount + res.body.tax).toBe(res.body.total);
    });

    it('stays exclusive when the flag is absent', async () => {
      await vat();
      const res = await admin
        .post('/api/documents')
        .set(header)
        .send({ ...sale(), discount: 0 })
        .expect(201);
      expect(res.body.tax).toBe(2800);
      expect(res.body.total).toBe(22800);
    });

    it('ignores the flag in tax-free mode', async () => {
      const res = await admin
        .post('/api/documents')
        .set(header)
        .send({ ...sale(), discount: 0, prices_include_tax: true })
        .expect(201);
      expect(res.body.tax).toBe(0);
      expect(res.body.total).toBe(20000);
    });

    it('stores the company default for entry mode', async () => {
      await admin
        .put('/api/company')
        .set(header)
        .send(body({ tax_mode: 'VAT', prices_include_tax: true }))
        .expect(200);
      const c = await admin.get('/api/company').set(header).expect(200);
      expect(c.body.prices_include_tax).toBe(1);
    });
  });
});
