import { describe, expect, it, beforeEach } from 'vitest';
import { header, seedUsers, signIn, resetBusinessData } from './helpers';
import { run } from '../server/db';

describe('Product barcodes', () => {
  let admin: Awaited<ReturnType<typeof signIn>>;

  beforeEach(async () => {
    resetBusinessData();
    run('DELETE FROM user_branches');
    run('DELETE FROM users');
    await seedUsers();
    admin = await signIn('admin@test.local');
  });

  const product = (sku: string, extra: object = {}) => ({
    sku,
    name: `منتج ${sku}`,
    category: 'عام',
    unit: 'قطعة',
    sale_price: 10000,
    cost_price: 6000,
    min_stock: 1,
    stock: 0,
    ...extra,
  });

  it('saves several barcodes on create and returns them in the product list', async () => {
    const res = await admin
      .post('/api/products')
      .set(header)
      .send(product('BC-1', { barcodes: ['6221111111111', '6222222222222'] }))
      .expect(201);
    expect(res.body.barcodes).toEqual(['6221111111111', '6222222222222']);
    const list = await admin.get('/api/products').set(header).expect(200);
    expect(list.body.find((p: { sku: string }) => p.sku === 'BC-1').barcodes).toHaveLength(2);
  });

  it('keeps barcodes when omitted on update and replaces them when sent', async () => {
    const created = await admin
      .post('/api/products')
      .set(header)
      .send(product('BC-2', { barcodes: ['111'] }))
      .expect(201);
    const { stock: _s, ...fields } = product('BC-2');
    void _s;
    let res = await admin
      .put(`/api/products/${created.body.id}`)
      .set(header)
      .send(fields)
      .expect(200);
    expect(res.body.barcodes).toEqual(['111']);
    res = await admin
      .put(`/api/products/${created.body.id}`)
      .set(header)
      .send({ ...fields, barcodes: ['222'] })
      .expect(200);
    expect(res.body.barcodes).toEqual(['222']);
  });

  it('rejects a barcode already used by another product', async () => {
    await admin
      .post('/api/products')
      .set(header)
      .send(product('BC-3', { barcodes: ['999'] }))
      .expect(201);
    const res = await admin
      .post('/api/products')
      .set(header)
      .send(product('BC-4', { barcodes: ['999'] }))
      .expect(409);
    expect(res.body.error).toContain('مستخدم');
  });

  it('POS search finds a product by barcode and returns its barcodes', async () => {
    await admin
      .post('/api/products')
      .set(header)
      .send(product('BC-5', { barcodes: ['5551234'] }))
      .expect(201);
    const res = await admin
      .get('/api/pos/products?branch_id=main&search=5551234')
      .set(header)
      .expect(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].barcodes).toEqual(['5551234']);
  });
});
