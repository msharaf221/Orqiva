import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { all, run } from '../server/db';
import { header, ledgerReconciles, resetBusinessData, seedUsers, signIn, stockAt } from './helpers';

type Agent = Awaited<ReturnType<typeof signIn>>;
let admin: Agent, staff: Agent;

beforeAll(async () => {
  await seedUsers();
  admin = await signIn('admin@test.local');
  staff = await signIn('staff@test.local');
});
beforeEach(() => resetBusinessData());

async function openBranch(code: string) {
  const res = await admin
    .post('/api/branches')
    .set(header)
    .send({
      code,
      name: `فرع ${code}`,
      kind: 'STORE',
      phone: '',
      address: '',
      opened_on: '2026-01-01',
    })
    .expect(201);
  return res.body as { id: string };
}
async function createProduct(sku: string, stock: number) {
  const res = await admin
    .post('/api/products')
    .set(header)
    .send({
      sku,
      name: `منتج ${sku}`,
      category: 'عام',
      unit: 'قطعة',
      sale_price: 10000,
      cost_price: 6000,
      min_stock: 3,
      stock,
      branch_id: 'main',
    })
    .expect(201);
  return res.body as { id: string };
}
function transferBody(
  from: string,
  to: string,
  lines: { product_id: string; quantity: number }[],
  date = '2026-10-05',
) {
  return { from_branch_id: from, to_branch_id: to, date, notes: 'اختبار', lines };
}
async function createTransfer(
  from: string,
  to: string,
  lines: { product_id: string; quantity: number }[],
  client: Agent = admin,
) {
  const res = await client
    .post('/api/transfers')
    .set(header)
    .send(transferBody(from, to, lines))
    .expect(201);
  return res.body as {
    id: string;
    number: string;
    status: string;
    lines: {
      product_id: string;
      quantity_sent: number;
      quantity_received: number | null;
      unit_cost: number;
    }[];
  };
}
const ship = (id: string, client: Agent = admin) =>
  client.post(`/api/transfers/${id}/ship`).set(header).send({});

describe('Transfers between branches', () => {
  it('a draft moves nothing until it is shipped and can still be edited', async () => {
    const product = await createProduct('TR-1', 20);
    const nsr = await openBranch('NSR');
    const transfer = await createTransfer('main', nsr.id, [
      { product_id: product.id, quantity: 8 },
    ]);
    expect(transfer.number).toBe('TR-2026-0001');
    expect(transfer.status).toBe('DRAFT');
    expect(stockAt(product.id, 'main')).toBe(20);
    expect(stockAt(product.id, nsr.id)).toBe(0);
    const edited = await admin
      .put(`/api/transfers/${transfer.id}`)
      .set(header)
      .send(transferBody('main', nsr.id, [{ product_id: product.id, quantity: 6 }]))
      .expect(200);
    expect(edited.body.lines[0].quantity_sent).toBe(6);
  });

  it('validates branches, lines and destination assortment', async () => {
    const product = await createProduct('TR-2', 20);
    const nsr = await openBranch('NSR');
    const lines = [{ product_id: product.id, quantity: 2 }];
    await admin
      .post('/api/transfers')
      .set(header)
      .send(transferBody('main', 'main', lines))
      .expect(400);
    await admin
      .post('/api/transfers')
      .set(header)
      .send(transferBody('main', nsr.id, [...lines, lines[0]]))
      .expect(400);
    await admin
      .post('/api/transfers')
      .set(header)
      .send(transferBody('main', nsr.id, [{ product_id: product.id, quantity: 0 }]))
      .expect(400);
    await admin
      .put(`/api/branches/${nsr.id}/products/${product.id}`)
      .set(header)
      .send({ active: false, sale_price: null, min_stock: null })
      .expect(200);
    const unlisted = await admin
      .post('/api/transfers')
      .set(header)
      .send(transferBody('main', nsr.id, lines))
      .expect(409);
    expect(unlisted.body.error).toContain('غير متاح في هذا الفرع');
    await admin
      .put(`/api/branches/${nsr.id}/products/${product.id}`)
      .set(header)
      .send({ active: true, sale_price: null, min_stock: null })
      .expect(200);
    run("UPDATE branches SET active=0, closed_on='2026-10-01' WHERE id=?", nsr.id);
    const closed = await admin
      .post('/api/transfers')
      .set(header)
      .send(transferBody('main', nsr.id, lines))
      .expect(409);
    expect(closed.body.error).toContain('مؤرشف');
  });

  it('shipping takes stock out of the source and records the cost snapshot', async () => {
    const product = await createProduct('TR-3', 20);
    const nsr = await openBranch('NSR');
    const transfer = await createTransfer('main', nsr.id, [
      { product_id: product.id, quantity: 8 },
    ]);
    const shipped = await ship(transfer.id).expect(200);
    expect(shipped.body.status).toBe('IN_TRANSIT');
    expect(shipped.body.lines[0].unit_cost).toBe(6000);
    expect(stockAt(product.id, 'main')).toBe(12);
    expect(stockAt(product.id, nsr.id)).toBe(0);
    const movement = all<{ quantity: number; transfer_id: string }>(
      'SELECT quantity,transfer_id FROM stock_movements WHERE transfer_id=?',
      transfer.id,
    );
    expect(movement).toEqual([{ quantity: -8, transfer_id: transfer.id }]);
    await ship(transfer.id).expect(409);
    await admin
      .put(`/api/transfers/${transfer.id}`)
      .set(header)
      .send(transferBody('main', nsr.id, [{ product_id: product.id, quantity: 1 }]))
      .expect(409);
    const group = (await admin.get('/api/group/overview?from=2026-10-01&to=2026-10-31').expect(200))
      .body;
    expect(group.totals.inTransitValue).toBe(8 * 6000);
    expect(ledgerReconciles()).toBe(true);
  });

  it('receiving records what arrived; the shortage stays on the transfer', async () => {
    const product = await createProduct('TR-4', 20);
    const nsr = await openBranch('NSR');
    const transfer = await createTransfer('main', nsr.id, [
      { product_id: product.id, quantity: 8 },
    ]);
    await ship(transfer.id).expect(200);
    await admin
      .post(`/api/transfers/${transfer.id}/receive`)
      .set(header)
      .send({ lines: [] })
      .expect(400);
    await admin
      .post(`/api/transfers/${transfer.id}/receive`)
      .set(header)
      .send({ lines: [{ product_id: product.id, quantity_received: 9 }] })
      .expect(400);
    const received = await admin
      .post(`/api/transfers/${transfer.id}/receive`)
      .set(header)
      .send({ lines: [{ product_id: product.id, quantity_received: 6 }] })
      .expect(200);
    expect(received.body.status).toBe('RECEIVED');
    expect(received.body.lines[0]).toMatchObject({ quantity_sent: 8, quantity_received: 6 });
    expect(stockAt(product.id, nsr.id)).toBe(6);
    expect(stockAt(product.id, 'main')).toBe(12);
    await admin
      .post(`/api/transfers/${transfer.id}/receive`)
      .set(header)
      .send({ lines: [{ product_id: product.id, quantity_received: 6 }] })
      .expect(409);
    const today = new Date();
    const from = new Date(today.getTime() - 86400000).toISOString().slice(0, 10);
    const to = new Date(today.getTime() + 86400000).toISOString().slice(0, 10);
    const group = (await admin.get(`/api/group/overview?from=${from}&to=${to}`).expect(200)).body;
    expect(group.totals.shortageValue).toBe(2 * 6000);
    expect(ledgerReconciles()).toBe(true);
  });

  it('cancelling in transit returns the goods; drafts touch nothing; received transfers are final', async () => {
    const product = await createProduct('TR-5', 20);
    const nsr = await openBranch('NSR');
    const inTransit = await createTransfer('main', nsr.id, [
      { product_id: product.id, quantity: 5 },
    ]);
    await ship(inTransit.id).expect(200);
    expect(stockAt(product.id, 'main')).toBe(15);
    const cancelled = await admin
      .post(`/api/transfers/${inTransit.id}/cancel`)
      .set(header)
      .send({})
      .expect(200);
    expect(cancelled.body.status).toBe('CANCELLED');
    expect(stockAt(product.id, 'main')).toBe(20);
    const draft = await createTransfer('main', nsr.id, [{ product_id: product.id, quantity: 4 }]);
    await admin.post(`/api/transfers/${draft.id}/cancel`).set(header).send({}).expect(200);
    expect(stockAt(product.id, 'main')).toBe(20);
    const delivered = await createTransfer('main', nsr.id, [
      { product_id: product.id, quantity: 2 },
    ]);
    await ship(delivered.id).expect(200);
    await admin
      .post(`/api/transfers/${delivered.id}/receive`)
      .set(header)
      .send({ lines: [{ product_id: product.id, quantity_received: 2 }] })
      .expect(200);
    await admin.post(`/api/transfers/${delivered.id}/cancel`).set(header).send({}).expect(409);
    expect(ledgerReconciles()).toBe(true);
  });

  it('a shipment that exceeds stock is refused and leaves every line untouched', async () => {
    const product = await createProduct('TR-6', 20);
    const scarce = await createProduct('TR-7', 5);
    const nsr = await openBranch('NSR');
    const tooMany = await createTransfer('main', nsr.id, [
      { product_id: product.id, quantity: 25 },
    ]);
    const refused = await ship(tooMany.id).expect(409);
    expect(refused.body.error).toContain('المخزون غير كافٍ');
    expect(stockAt(product.id, 'main')).toBe(20);
    const mixed = await createTransfer('main', nsr.id, [
      { product_id: product.id, quantity: 2 },
      { product_id: scarce.id, quantity: 10 },
    ]);
    await ship(mixed.id).expect(409);
    expect(stockAt(product.id, 'main')).toBe(20);
    expect(stockAt(scarce.id, 'main')).toBe(5);
    expect(all('SELECT status FROM transfers WHERE id=?', mixed.id)[0]).toEqual({
      status: 'DRAFT',
    });
    expect(ledgerReconciles()).toBe(true);
  });

  it('staff move stock out of their own branch but cannot touch other branches', async () => {
    const product = await createProduct('TR-8', 20);
    const nsr = await openBranch('NSR');
    const alx = await openBranch('ALX');
    const mine = await createTransfer(
      'main',
      nsr.id,
      [{ product_id: product.id, quantity: 3 }],
      staff,
    );
    await ship(mine.id, staff).expect(200);
    const elsewhere = await createTransfer(nsr.id, alx.id, [
      { product_id: product.id, quantity: 1 },
    ]);
    await staff.get(`/api/transfers/${elsewhere.id}`).expect(403);
    await staff
      .post('/api/transfers')
      .set(header)
      .send(transferBody(nsr.id, alx.id, [{ product_id: product.id, quantity: 1 }]))
      .expect(403);
    // Receiving happens in the destination branch, which this employee is not assigned to.
    await staff
      .post(`/api/transfers/${mine.id}/receive`)
      .set(header)
      .send({ lines: [{ product_id: product.id, quantity_received: 3 }] })
      .expect(403);
    await admin
      .post(`/api/transfers/${mine.id}/receive`)
      .set(header)
      .send({ lines: [{ product_id: product.id, quantity_received: 3 }] })
      .expect(200);
    const visible = (await staff.get('/api/transfers').expect(200)).body as { id: string }[];
    expect(visible.map((t) => t.id)).toContain(mine.id);
    expect(visible.map((t) => t.id)).not.toContain(elsewhere.id);
  });

  it('suggestions fill shortfalls below a branch reorder level from surplus stock, within scope', async () => {
    const product = await createProduct('TR-9', 20);
    const nsr = await openBranch('NSR');
    await admin
      .put(`/api/branches/${nsr.id}/products/${product.id}`)
      .set(header)
      .send({ active: true, sale_price: null, min_stock: 5 })
      .expect(200);
    const suggestions = (await admin.get('/api/transfers/suggestions').expect(200)).body as {
      from_branch_id: string;
      to_branch_id: string;
      quantity: number;
    }[];
    expect(suggestions).toEqual([
      expect.objectContaining({ from_branch_id: 'main', to_branch_id: nsr.id, quantity: 5 }),
    ]);
    // Staff only see suggestions between branches they are assigned to.
    expect((await staff.get('/api/transfers/suggestions').expect(200)).body).toEqual([]);
    const transfer = await createTransfer('main', nsr.id, [
      { product_id: product.id, quantity: 5 },
    ]);
    await ship(transfer.id).expect(200);
    await admin
      .post(`/api/transfers/${transfer.id}/receive`)
      .set(header)
      .send({ lines: [{ product_id: product.id, quantity_received: 5 }] })
      .expect(200);
    expect((await admin.get('/api/transfers/suggestions').expect(200)).body).toEqual([]);
  });

  it('lists transfers by status for administrators', async () => {
    const product = await createProduct('TR-10', 20);
    const nsr = await openBranch('NSR');
    await createTransfer('main', nsr.id, [{ product_id: product.id, quantity: 1 }]);
    const drafts = (await admin.get('/api/transfers?status=DRAFT').expect(200)).body;
    expect(drafts).toHaveLength(1);
    expect((await admin.get('/api/transfers?status=RECEIVED').expect(200)).body).toHaveLength(0);
  });
});
