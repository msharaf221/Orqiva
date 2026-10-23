/**
 * Pack 2.3 — Warehouse Locations (Bins, Aisles, Shelves) & Barcode Stocktake.
 *
 * Covers:
 *  - Warehouse location CRUD with hierarchical coordinates (Aisle, Rack, Shelf, Bin).
 *  - Enforcing unique location codes per branch.
 *  - Assigning products to primary/secondary warehouse locations.
 *  - Barcode scan-to-count mode during active stocktake sessions.
 *  - Preserving transactional integrity and variance posting on approval.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { header, seedUsers, signIn, resetBusinessData } from './helpers';
import { one, run, now } from '../server/db';

beforeEach(async () => {
  resetBusinessData();
  run('DELETE FROM user_branches');
  run('DELETE FROM users');
  await seedUsers();

  // Create test products
  run(
    `INSERT INTO products(id,sku,name,category,unit,sale_price,cost_price,min_stock,active,created_at)
     VALUES('loc-p1','BARCODE-001','شاشة سامسونج 27','إلكترونيات','قطعة',650000,450000,5,1,?)`,
    now(),
  );
  run(
    `INSERT INTO products(id,sku,name,category,unit,sale_price,cost_price,min_stock,active,created_at)
     VALUES('loc-p2','BARCODE-002','لوحة مفاتيح ميكانيكية','إلكترونيات','قطعة',120000,80000,10,1,?)`,
    now(),
  );

  for (const pid of ['loc-p1', 'loc-p2']) {
    run(`INSERT INTO branch_stock(branch_id,product_id,quantity) VALUES('main',?,10)`, pid);
    run(`INSERT INTO branch_products(branch_id,product_id,active) VALUES('main',?,1)`, pid);
    run(
      `INSERT INTO branch_cost(branch_id,product_id,avg_cost,total_value,updated_at) VALUES('main',?,450000,4500000,?)`,
      pid,
      now(),
    );
  }
});

async function admin() {
  return signIn('admin@test.local');
}

describe('Pack 2.3 — Warehouse Locations & Barcode Stocktake', () => {
  it('creates, lists and updates warehouse locations', async () => {
    const client = await admin();

    // 1. Create a location
    const createRes = await client
      .post('/api/warehouse-locations')
      .set(header)
      .send({
        branch_id: 'main',
        code: 'A1-R02-S3',
        name: 'ممر الشاشات - رف 2',
        aisle: 'A1',
        rack: 'R02',
        shelf: 'S3',
        bin: 'B01',
        notes: 'مخصص للشاشات 27 بوصة فما فوق',
      })
      .expect(201);

    expect(createRes.body.code).toBe('A1-R02-S3');
    expect(createRes.body.aisle).toBe('A1');

    // 2. Reject duplicate code in the same branch
    await client
      .post('/api/warehouse-locations')
      .set(header)
      .send({
        branch_id: 'main',
        code: 'A1-R02-S3',
        name: 'موقع مكرر',
      })
      .expect(409);

    // 3. List locations
    const listRes = await client
      .get('/api/warehouse-locations?branch_id=main')
      .set(header)
      .expect(200);
    expect(listRes.body).toHaveLength(1);
    expect(listRes.body[0].code).toBe('A1-R02-S3');

    // 4. Update location
    const updateRes = await client
      .put(`/api/warehouse-locations/${createRes.body.id}`)
      .set(header)
      .send({
        branch_id: 'main',
        code: 'A1-R02-S3-MOD',
        name: 'ممر الشاشات المحدث',
        aisle: 'A1',
        rack: 'R02',
        shelf: 'S4',
        bin: 'B02',
      })
      .expect(200);

    expect(updateRes.body.code).toBe('A1-R02-S3-MOD');
    expect(updateRes.body.shelf).toBe('S4');
  });

  it('assigns products to primary and secondary warehouse locations', async () => {
    const client = await admin();

    // Create 2 locations
    const loc1 = await client
      .post('/api/warehouse-locations')
      .set(header)
      .send({
        branch_id: 'main',
        code: 'LOC-MAIN-1',
        name: 'الموقع الرئيسي',
      })
      .expect(201);

    const loc2 = await client
      .post('/api/warehouse-locations')
      .set(header)
      .send({
        branch_id: 'main',
        code: 'LOC-OVERFLOW',
        name: 'موقع الفائض',
      })
      .expect(201);

    // Assign loc1 as primary to loc-p1
    const assign1 = await client
      .post('/api/products/loc-p1/locations')
      .set(header)
      .send({
        location_id: loc1.body.id,
        is_primary: 1,
      })
      .expect(200);

    expect(assign1.body.location_code).toBe('LOC-MAIN-1');
    expect(assign1.body.is_primary).toBe(1);

    // Assign loc2 as secondary
    await client
      .post('/api/products/loc-p1/locations')
      .set(header)
      .send({
        location_id: loc2.body.id,
        is_primary: 0,
      })
      .expect(200);

    // Get product locations
    const getRes = await client.get('/api/products/loc-p1/locations').set(header).expect(200);
    expect(getRes.body).toHaveLength(2);
    expect(getRes.body[0].is_primary).toBe(1);
    expect(getRes.body[0].location_code).toBe('LOC-MAIN-1');
    expect(getRes.body[1].is_primary).toBe(0);
    expect(getRes.body[1].location_code).toBe('LOC-OVERFLOW');
  });

  it('increments counted quantities via fast barcode scanning in a stocktake session', async () => {
    const client = await admin();

    // 1. Create a location and assign to product loc-p1
    const loc = await client
      .post('/api/warehouse-locations')
      .set(header)
      .send({
        branch_id: 'main',
        code: 'AISLE-01-BIN-04',
        name: 'ممر 1 صندوق 4',
      })
      .expect(201);

    await client
      .post('/api/products/loc-p1/locations')
      .set(header)
      .send({ location_id: loc.body.id, is_primary: 1 })
      .expect(200);

    // 2. Start a stocktake session
    const sessionRes = await client
      .post('/api/stocktakes')
      .set(header)
      .send({ branch_id: 'main', notes: 'جرد سريع بالباركود' })
      .expect(201);

    const sessionId = sessionRes.body.id;

    // 3. Scan barcode 'BARCODE-001' (loc-p1) once
    const scan1 = await client
      .post(`/api/stocktakes/${sessionId}/scan`)
      .set(header)
      .send({ barcode: 'BARCODE-001', quantity: 1 })
      .expect(200);

    expect(scan1.body.counted_qty).toBe(1);
    expect(scan1.body.expected_qty).toBe(10);
    expect(scan1.body.variance_qty).toBe(-9);
    expect(scan1.body.location_code).toBe('AISLE-01-BIN-04');

    // 4. Scan again with quantity 4
    const scan2 = await client
      .post(`/api/stocktakes/${sessionId}/scan`)
      .set(header)
      .send({ barcode: 'BARCODE-001', quantity: 4 })
      .expect(200);

    expect(scan2.body.counted_qty).toBe(5);
    expect(scan2.body.variance_qty).toBe(-5);

    // 5. Scan second product 'BARCODE-002' with quantity 12 (surplus)
    const scan3 = await client
      .post(`/api/stocktakes/${sessionId}/scan`)
      .set(header)
      .send({ barcode: 'BARCODE-002', quantity: 12 })
      .expect(200);

    expect(scan3.body.counted_qty).toBe(12);
    expect(scan3.body.expected_qty).toBe(10);
    expect(scan3.body.variance_qty).toBe(2);

    // 6. Scanning an unknown barcode returns 404
    const scanUnknown = await client
      .post(`/api/stocktakes/${sessionId}/scan`)
      .set(header)
      .send({ barcode: 'UNKNOWN-999' })
      .expect(404);

    expect(scanUnknown.body.error).toContain('غير مدرج');

    // 7. Submit and approve the stocktake
    await client.post(`/api/stocktakes/${sessionId}/submit`).set(header).expect(200);

    // Scanning on a submitted (non-draft) session is rejected
    await client
      .post(`/api/stocktakes/${sessionId}/scan`)
      .set(header)
      .send({ barcode: 'BARCODE-001' })
      .expect(400);

    // Approve stocktake
    await client.post(`/api/stocktakes/${sessionId}/approve`).set(header).expect(200);

    // Check final physical stock in branch: loc-p1 = 5 (was 10), loc-p2 = 12 (was 10)
    const stock1 = one<{ quantity: number }>(
      "SELECT quantity FROM branch_stock WHERE product_id='loc-p1' AND branch_id='main'",
    );
    const stock2 = one<{ quantity: number }>(
      "SELECT quantity FROM branch_stock WHERE product_id='loc-p2' AND branch_id='main'",
    );
    expect(stock1?.quantity).toBe(5);
    expect(stock2?.quantity).toBe(12);
  });
});
