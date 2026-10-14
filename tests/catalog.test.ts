import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { header, resetBusinessData, seedUsers, signIn, stockAt } from './helpers';

describe('Catalog & Inventory Adjustments API', () => {
  let admin: ReturnType<typeof request.agent>;
  let staff: ReturnType<typeof request.agent>;

  beforeAll(async () => {
    await seedUsers();
    admin = await signIn('admin@test.local');
    staff = await signIn('staff@test.local');
  });

  beforeEach(() => {
    resetBusinessData();
  });

  it('creates and lists products with initial branch stock', async () => {
    const res = await admin
      .post('/api/products')
      .set(header)
      .send({
        sku: 'CAT-SKU-100',
        name: 'منتج تجريبي كتالوج',
        category: 'أجهزة',
        unit: 'قطعة',
        sale_price: 15000,
        cost_price: 10000,
        min_stock: 5,
        stock: 25,
        branch_id: 'main',
      })
      .expect(201);

    expect(res.body.sku).toBe('CAT-SKU-100');
    expect(res.body.name).toBe('منتج تجريبي كتالوج');
    expect(stockAt(res.body.id, 'main')).toBe(25);

    const listRes = await staff.get('/api/products?branch_id=main').set(header).expect(200);
    const item = listRes.body.find((p: any) => p.sku === 'CAT-SKU-100');
    expect(item).toBeDefined();
    expect(item.stock).toBe(25);
  });

  it('rejects duplicate SKU case-insensitively', async () => {
    await admin
      .post('/api/products')
      .set(header)
      .send({
        sku: 'UNIQUE-SKU',
        name: 'منتج أ',
        category: 'عام',
        unit: 'قطعة',
        sale_price: 1000,
        cost_price: 500,
        min_stock: 0,
      })
      .expect(201);

    const dup = await admin
      .post('/api/products')
      .set(header)
      .send({
        sku: 'unique-sku',
        name: 'منتج ب',
        category: 'عام',
        unit: 'قطعة',
        sale_price: 1000,
        cost_price: 500,
        min_stock: 0,
      })
      .expect(409);

    expect(dup.body.error).toContain('مستخدم بالفعل');
  });

  it('adjusts stock safely and prevents negative inventory', async () => {
    const p = await admin
      .post('/api/products')
      .set(header)
      .send({
        sku: 'ADJ-SKU',
        name: 'منتج تسوية',
        category: 'عام',
        unit: 'قطعة',
        sale_price: 1000,
        cost_price: 500,
        min_stock: 0,
        stock: 10,
        branch_id: 'main',
      })
      .expect(201);

    const productId = p.body.id;

    // 1. Positive adjustment (+5)
    await admin
      .post(`/api/products/${productId}/adjust`)
      .set(header)
      .send({
        branch_id: 'main',
        quantity: 5,
        reason: 'جرد إضافي',
      })
      .expect(200);

    expect(stockAt(productId, 'main')).toBe(15);

    // 2. Negative adjustment (-7)
    await admin
      .post(`/api/products/${productId}/adjust`)
      .set(header)
      .send({
        branch_id: 'main',
        quantity: -7,
        reason: 'تالف مخزني',
      })
      .expect(200);

    expect(stockAt(productId, 'main')).toBe(8);

    // 3. Negative adjustment exceeding current balance (-10 when balance is 8) -> rejected
    const failedAdj = await admin
      .post(`/api/products/${productId}/adjust`)
      .set(header)
      .send({
        branch_id: 'main',
        quantity: -10,
        reason: 'تسوية مفرطة سالبة',
      })
      .expect(400);

    expect(failedAdj.body.error).toContain('الكمية الجديدة خارج النطاق المسموح');
    expect(stockAt(productId, 'main')).toBe(8);
  });

  it('updates product metadata and archives/reactivates product', async () => {
    const p = await admin
      .post('/api/products')
      .set(header)
      .send({
        sku: 'ARCH-SKU',
        name: 'منتج قابل للأرشفة',
        category: 'قديم',
        unit: 'كرتونة',
        sale_price: 5000,
        cost_price: 3000,
        min_stock: 2,
      })
      .expect(201);

    const productId = p.body.id;

    // Update metadata
    await admin
      .put(`/api/products/${productId}`)
      .set(header)
      .send({
        sku: 'ARCH-SKU-V2',
        name: 'منتج محدث',
        category: 'جديد',
        unit: 'كرتونة',
        sale_price: 6000,
        cost_price: 3500,
        min_stock: 4,
      })
      .expect(200);

    // Archive
    await admin
      .patch(`/api/products/${productId}/active`)
      .set(header)
      .send({ active: false })
      .expect(200);

    const listArchived = await admin.get('/api/products').set(header).expect(200);
    const archivedItem = listArchived.body.find((x: any) => x.id === productId);
    expect(archivedItem.active).toBe(0);

    // Reactivate
    await admin
      .patch(`/api/products/${productId}/active`)
      .set(header)
      .send({ active: true })
      .expect(200);

    const listActive = await admin.get('/api/products').set(header).expect(200);
    const activeItem = listActive.body.find((x: any) => x.id === productId);
    expect(activeItem.active).toBe(1);
  });

  it('returns stock matrix across branches', async () => {
    const matrixRes = await admin.get('/api/stock/matrix').set(header).expect(200);
    expect(matrixRes.body.branches).toBeDefined();
    expect(Array.isArray(matrixRes.body.branches)).toBe(true);
    expect(matrixRes.body.rows).toBeDefined();
    expect(Array.isArray(matrixRes.body.rows)).toBe(true);
  });
});
