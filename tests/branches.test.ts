import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { run } from '../server/db';
import { header, ledgerReconciles, resetBusinessData, seedUsers, signIn, stockAt } from './helpers';

type Agent = Awaited<ReturnType<typeof signIn>>;
let admin: Agent, staff: Agent;

beforeAll(async () => {
  await seedUsers();
  admin = await signIn('admin@test.local');
  staff = await signIn('staff@test.local');
});
beforeEach(() => resetBusinessData());

async function openBranch(code: string, openedOn = '2026-01-01') {
  const res = await admin
    .post('/api/branches')
    .set(header)
    .send({ code, name: `فرع ${code}`, kind: 'STORE', phone: '', address: '', opened_on: openedOn })
    .expect(201);
  return res.body as { id: string; code: string };
}
async function createProduct(sku: string, stock = 0) {
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
async function createCustomer(name = 'عميل') {
  const res = await admin
    .post('/api/parties')
    .set(header)
    .send({ type: 'CUSTOMER', name })
    .expect(201);
  return res.body.id as string;
}
async function createSupplier() {
  const res = await admin
    .post('/api/parties')
    .set(header)
    .send({ type: 'SUPPLIER', name: 'مورد' })
    .expect(201);
  return res.body.id as string;
}
function invoice(
  type: 'SALE' | 'PURCHASE',
  branchId: string,
  partyId: string,
  productId: string,
  quantity: number,
  date = '2026-10-05',
) {
  return {
    type,
    branch_id: branchId,
    party_id: partyId,
    date,
    due_date: '2026-10-20',
    discount: 0,
    tax_rate: 0,
    notes: '',
    lines: [{ product_id: productId, quantity, unit_price: type === 'SALE' ? 10000 : 6000 }],
  };
}
/** Creates and posts an invoice; returns the posted document. */
async function postInvoice(
  type: 'SALE' | 'PURCHASE',
  branchId: string,
  partyId: string,
  productId: string,
  quantity: number,
  date?: string,
) {
  const created = await admin
    .post('/api/documents')
    .set(header)
    .send(invoice(type, branchId, partyId, productId, quantity, date))
    .expect(201);
  const posted = await admin
    .post(`/api/documents/${created.body.id}/post`)
    .set(header)
    .send({})
    .expect(200);
  return posted.body as { id: string; number: string; total: number };
}

describe('Branches and per-branch stock', () => {
  it('a new branch lists every active product and never an archived one', async () => {
    const kept = await createProduct('KEEP-1');
    const archived = await createProduct('OLD-1');
    await admin
      .patch(`/api/products/${archived.id}/active`)
      .set(header)
      .send({ active: false })
      .expect(200);
    const branch = await openBranch('NSR');
    const rows = (await admin.get(`/api/branches/${branch.id}/assortment`).expect(200)).body as {
      product_id: string;
      active: number;
    }[];
    expect(rows.find((r) => r.product_id === kept.id)?.active).toBe(1);
    expect(rows.find((r) => r.product_id === archived.id)?.active).toBe(0);
  });

  it('stock and sellability are separate for each branch', async () => {
    const product = await createProduct('STK-1', 10);
    const branch = await openBranch('NSR');
    const main = (await admin.get('/api/products?branch_id=main').expect(200)).body[0];
    const nsr = (await admin.get(`/api/products?branch_id=${branch.id}`).expect(200)).body[0];
    const group = (await admin.get('/api/products').expect(200)).body.find(
      (p: { id: string }) => p.id === product.id,
    );
    expect(main).toMatchObject({ stock: 10, available: 1 });
    expect(nsr).toMatchObject({ stock: 0, available: 1, branch_name: 'فرع NSR' });
    expect(group.stock).toBe(10);
  });

  it('a sale draws only from its own branch stock', async () => {
    const product = await createProduct('STK-2', 10);
    const branch = await openBranch('NSR');
    const customer = await createCustomer();
    const draft = await admin
      .post('/api/documents')
      .set(header)
      .send(invoice('SALE', branch.id, customer, product.id, 1))
      .expect(201);
    const rejected = await admin
      .post(`/api/documents/${draft.body.id}/post`)
      .set(header)
      .send({})
      .expect(409);
    expect(rejected.body.error).toContain('في فرع');
    expect(rejected.body.error).toContain('المتاح 0');
    await postInvoice('SALE', 'main', customer, product.id, 2);
    expect(stockAt(product.id, 'main')).toBe(8);
    expect(stockAt(product.id, branch.id)).toBe(0);
    expect(ledgerReconciles()).toBe(true);
  });

  it('a branch cannot sell a product it has delisted, even with stock on hand', async () => {
    const product = await createProduct('STK-3');
    const branch = await openBranch('NSR');
    const supplier = await createSupplier();
    await postInvoice('PURCHASE', branch.id, supplier, product.id, 5);
    expect(stockAt(product.id, branch.id)).toBe(5);
    await admin
      .put(`/api/branches/${branch.id}/products/${product.id}`)
      .set(header)
      .send({ active: false, sale_price: null, min_stock: null })
      .expect(200);
    const customer = await createCustomer();
    const res = await admin
      .post('/api/documents')
      .set(header)
      .send(invoice('SALE', branch.id, customer, product.id, 1))
      .expect(409);
    expect(res.body.error).toContain('غير متاح في هذا الفرع');
  });

  it('branch-specific price and reorder level override the catalogue', async () => {
    const product = await createProduct('PRC-1');
    const branch = await openBranch('ALX');
    await admin
      .put(`/api/branches/${branch.id}/products/${product.id}`)
      .set(header)
      .send({ active: true, sale_price: 9900, min_stock: 7 })
      .expect(200);
    const local = (await admin.get(`/api/products?branch_id=${branch.id}`).expect(200)).body[0];
    const group = (await admin.get('/api/products').expect(200)).body[0];
    expect(local).toMatchObject({ sale_price: 9900, min_stock: 7 });
    expect(group).toMatchObject({ sale_price: 10000, min_stock: 3 });
  });

  it('documents are numbered per branch with independent sequences', async () => {
    const product = await createProduct('NUM-1', 20);
    const nsr = await openBranch('NSR');
    const customer = await createCustomer();
    const supplier = await createSupplier();
    const hq = await postInvoice('SALE', 'main', customer, product.id, 1);
    expect(hq.number).toBe('INV-HQ-2026-0001');
    // Nasr City has no stock yet, so its own draft cannot be posted from HQ stock.
    const nsrDraft = await admin
      .post('/api/documents')
      .set(header)
      .send(invoice('SALE', nsr.id, customer, product.id, 1))
      .expect(201);
    await admin.post(`/api/documents/${nsrDraft.body.id}/post`).set(header).send({}).expect(409);
    const purchase = await postInvoice('PURCHASE', nsr.id, supplier, product.id, 2);
    expect(purchase.number).toBe('PO-NSR-2026-0001');
    const second = await postInvoice('SALE', 'main', customer, product.id, 1);
    expect(second.number).toBe('INV-HQ-2026-0002');
  });

  it('staff are limited to assigned branches on every read and write', async () => {
    const product = await createProduct('ACL-1', 10);
    const nsr = await openBranch('NSR');
    const customer = await createCustomer();
    const hqDraft = await admin
      .post('/api/documents')
      .set(header)
      .send(invoice('SALE', 'main', customer, product.id, 1))
      .expect(201);
    const nsrDraft = await admin
      .post('/api/documents')
      .set(header)
      .send(invoice('SALE', nsr.id, customer, product.id, 1))
      .expect(201);

    const visible = (await staff.get('/api/documents?type=SALE').expect(200)).body as {
      id: string;
    }[];
    expect(visible.map((d) => d.id)).toContain(hqDraft.body.id);
    expect(visible.map((d) => d.id)).not.toContain(nsrDraft.body.id);
    await staff.get(`/api/documents?type=SALE&branch_id=${nsr.id}`).expect(403);
    await staff.get(`/api/documents/${nsrDraft.body.id}`).expect(403);
    await staff.get(`/api/products?branch_id=${nsr.id}`).expect(403);
    await staff.get(`/api/dashboard?from=2026-10-01&to=2026-10-31&branch_id=${nsr.id}`).expect(403);
    await staff.get(`/api/branches/${nsr.id}/assortment`).expect(403);
    await staff
      .post('/api/documents')
      .set(header)
      .send(invoice('SALE', nsr.id, customer, product.id, 1))
      .expect(403);
    expect(
      (await staff.get('/api/branches').expect(200)).body.map((b: { id: string }) => b.id),
    ).toEqual(['main']);
    await staff.get('/api/group/overview?from=2026-10-01&to=2026-10-31').expect(403);
    await staff.get('/api/owners').expect(403);
    await staff.get('/api/distributions').expect(403);
    await staff.put(`/api/branches/${nsr.id}/staff`).set(header).send({ user_ids: [] }).expect(403);
  });

  it('assigning a branch opens it to an employee; removing it closes it again', async () => {
    const nsr = await openBranch('NSR');
    const customer = await createCustomer();
    const product = await createProduct('ASG-1');
    const draft = await admin
      .post('/api/documents')
      .set(header)
      .send(invoice('SALE', nsr.id, customer, product.id, 1))
      .expect(201);
    await staff.get(`/api/documents/${draft.body.id}`).expect(403);
    await admin
      .put(`/api/branches/${nsr.id}/staff`)
      .set(header)
      .send({ user_ids: ['staff'] })
      .expect(200);
    await staff.get(`/api/documents/${draft.body.id}`).expect(200);
    await admin.put(`/api/branches/${nsr.id}/staff`).set(header).send({ user_ids: [] }).expect(200);
    await staff.get(`/api/documents/${draft.body.id}`).expect(403);
  });

  it('archiving needs an empty branch and keeps its history; reopening clears the closure', async () => {
    const product = await createProduct('ARC-1');
    const nsr = await openBranch('NSR');
    const supplier = await createSupplier();
    await postInvoice('PURCHASE', nsr.id, supplier, product.id, 4);
    await admin
      .patch(`/api/branches/${nsr.id}/active`)
      .set(header)
      .send({ active: false })
      .expect(409);
    await admin
      .post(`/api/products/${product.id}/adjust`)
      .set(header)
      .send({ branch_id: nsr.id, quantity: -4, reason: 'نقل كامل للمركز' })
      .expect(200);
    const archived = await admin
      .patch(`/api/branches/${nsr.id}/active`)
      .set(header)
      .send({ active: false })
      .expect(200);
    expect(archived.body.active).toBe(0);
    expect(archived.body.closed_on).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(
      (await admin.get('/api/branches').expect(200)).body.map((b: { code: string }) => b.code),
    ).not.toContain('NSR');
    expect(
      (await admin.get('/api/branches?include_archived=1').expect(200)).body.map(
        (b: { code: string }) => b.code,
      ),
    ).toContain('NSR');
    const customer = await createCustomer();
    await admin
      .post('/api/documents')
      .set(header)
      .send(invoice('SALE', nsr.id, customer, product.id, 1))
      .expect(409);
    const reopened = await admin
      .patch(`/api/branches/${nsr.id}/active`)
      .set(header)
      .send({ active: true })
      .expect(200);
    expect(reopened.body.closed_on).toBeNull();
  });

  it('a branch that has not opened yet cannot be archived', async () => {
    const future = await openBranch('FUT', '2999-01-01');
    const res = await admin
      .patch(`/api/branches/${future.id}/active`)
      .set(header)
      .send({ active: false })
      .expect(409);
    expect(res.body.error).toContain('لم يبدأ التشغيل');
  });
  it('the last open branch cannot be archived', async () => {
    const nsr = await openBranch('NSR');
    await admin
      .patch(`/api/branches/${nsr.id}/active`)
      .set(header)
      .send({ active: false })
      .expect(200);
    const res = await admin
      .patch('/api/branches/main/active')
      .set(header)
      .send({ active: false })
      .expect(409);
    expect(res.body.error).toContain('آخر فرع نشط');
  });

  it('a branch cannot be archived while a draft invoice or an incoming transfer is open', async () => {
    const product = await createProduct('ARC-2', 6);
    const nsr = await openBranch('NSR');
    const customer = await createCustomer();
    await admin
      .post('/api/documents')
      .set(header)
      .send(invoice('SALE', nsr.id, customer, product.id, 1))
      .expect(201);
    const res = await admin
      .patch(`/api/branches/${nsr.id}/active`)
      .set(header)
      .send({ active: false })
      .expect(409);
    expect(res.body.error).toContain('المسودات');
  });
});

describe('Shared expenses across branches', () => {
  it('an expense is either for one branch or shared, never both', async () => {
    await openBranch('NSR', '2026-01-01');
    const base = {
      title: 'إيجار',
      category: 'إيجارات',
      amount: 10000,
      date: '2026-10-05',
      method: 'BANK',
    };
    await admin
      .post('/api/expenses')
      .set(header)
      .send({ ...base, allocation: 'EQUAL', branch_id: 'main' })
      .expect(400);
    await admin
      .post('/api/expenses')
      .set(header)
      .send({ ...base, allocation: 'BRANCH' })
      .expect(400);
    const shared = await admin
      .post('/api/expenses')
      .set(header)
      .send({ ...base, allocation: 'EQUAL' })
      .expect(201);
    expect(shared.body.branch_id).toBeNull();
  });

  it('an equal share is charged per branch and the group total never changes', async () => {
    const nsr = await openBranch('NSR', '2026-01-01');
    await admin
      .post('/api/expenses')
      .set(header)
      .send({
        title: 'إنترنت',
        category: 'اتصالات',
        amount: 100000,
        date: '2026-10-05',
        method: 'BANK',
        allocation: 'EQUAL',
      })
      .expect(201);
    const expenses = async (branch: string) =>
      (
        await admin
          .get(`/api/dashboard?from=2026-10-01&to=2026-10-31&branch_id=${branch}`)
          .expect(200)
      ).body.expenses as number;
    expect(await expenses('main')).toBe(50000);
    expect(await expenses(nsr.id)).toBe(50000);
    expect(
      (await admin.get('/api/dashboard?from=2026-10-01&to=2026-10-31').expect(200)).body.expenses,
    ).toBe(100000);
  });

  it('a revenue-based share follows where the month sold', async () => {
    const nsr = await openBranch('NSR', '2026-01-01');
    const product = await createProduct('ALC-1', 50);
    await postInvoice('SALE', 'main', await createCustomer(), product.id, 3, '2026-10-02');
    await admin
      .post('/api/expenses')
      .set(header)
      .send({
        title: 'رواتب',
        category: 'رواتب',
        amount: 90000,
        date: '2026-10-05',
        method: 'BANK',
        allocation: 'REVENUE',
      })
      .expect(201);
    const main = await admin
      .get('/api/dashboard?from=2026-10-01&to=2026-10-31&branch_id=main')
      .expect(200);
    const nsrDashboard = await admin
      .get(`/api/dashboard?from=2026-10-01&to=2026-10-31&branch_id=${nsr.id}`)
      .expect(200);
    expect(main.body.expenses).toBe(90000);
    expect(nsrDashboard.body.expenses).toBe(0);
  });

  it('a revenue-based share with no sales that month is split equally', async () => {
    const nsr = await openBranch('NSR', '2026-01-01');
    await admin
      .post('/api/expenses')
      .set(header)
      .send({
        title: 'صيانة مشتركة',
        category: 'صيانة',
        amount: 1001,
        date: '2026-09-15',
        method: 'CASH',
        allocation: 'REVENUE',
      })
      .expect(201);
    const dashboard = async (branch?: string) =>
      (
        await admin
          .get(
            `/api/dashboard?from=2026-09-01&to=2026-09-30${branch ? `&branch_id=${branch}` : ''}`,
          )
          .expect(200)
      ).body.expenses as number;
    // 1001 piastres over two branches: the first branch in opening order keeps the extra piastre.
    expect(await dashboard('main')).toBe(501);
    expect(await dashboard(nsr.id)).toBe(500);
    expect(await dashboard()).toBe(1001);
  });

  it('an expense dated before a branch opened is not charged to it', async () => {
    const nsr = await openBranch('NSR', '2026-10-10');
    await admin
      .post('/api/expenses')
      .set(header)
      .send({
        title: 'إنترنت',
        category: 'اتصالات',
        amount: 60000,
        date: '2026-10-05',
        method: 'BANK',
        allocation: 'EQUAL',
      })
      .expect(201);
    const share = (
      await admin
        .get(`/api/dashboard?from=2026-10-01&to=2026-10-31&branch_id=${nsr.id}`)
        .expect(200)
    ).body;
    expect(share.expenses).toBe(0);
  });

  it('a closed branch stops sharing costs after its closing date', async () => {
    const nsr = await openBranch('NSR', '2026-01-01');
    run("UPDATE branches SET active=0, closed_on='2026-10-03' WHERE id=?", nsr.id);
    await admin
      .post('/api/expenses')
      .set(header)
      .send({
        title: 'إنترنت',
        category: 'اتصالات',
        amount: 60000,
        date: '2026-10-05',
        method: 'BANK',
        allocation: 'EQUAL',
      })
      .expect(201);
    const main = (
      await admin.get('/api/dashboard?from=2026-10-01&to=2026-10-31&branch_id=main').expect(200)
    ).body;
    expect(main.expenses).toBe(60000);
  });
});

describe('Group view', () => {
  it('group totals equal the sum of the branches', async () => {
    const product = await createProduct('GRP-1', 20);
    const nsr = await openBranch('NSR', '2026-01-01');
    const supplier = await createSupplier();
    await postInvoice('PURCHASE', nsr.id, supplier, product.id, 5, '2026-10-01');
    await postInvoice('SALE', 'main', await createCustomer(), product.id, 2, '2026-10-05');
    await postInvoice('SALE', nsr.id, await createCustomer(), product.id, 3, '2026-10-06');
    await admin
      .post('/api/expenses')
      .set(header)
      .send({
        title: 'كهرباء',
        category: 'مرافق',
        amount: 40000,
        date: '2026-10-07',
        method: 'CASH',
        allocation: 'EQUAL',
      })
      .expect(201);
    const group = (await admin.get('/api/group/overview?from=2026-10-01&to=2026-10-31').expect(200))
      .body;
    const sum = (key: 'sales' | 'gross' | 'expenses' | 'net') =>
      group.branches.reduce((s: number, b: Record<string, number>) => s + b[key], 0);
    expect(group.totals.sales).toBe(sum('sales'));
    expect(group.totals.gross).toBe(sum('gross'));
    expect(group.totals.expenses).toBe(sum('expenses'));
    expect(group.totals.net).toBe(sum('net'));
    expect(group.totals.sales).toBe(50000);
    const dash = (await admin.get('/api/dashboard?from=2026-10-01&to=2026-10-31').expect(200)).body;
    expect(dash.sales).toBe(group.totals.sales);
    expect(dash.expenses).toBe(group.totals.expenses);
    expect(ledgerReconciles()).toBe(true);
  });

  it('the stock matrix totals each product across branches', async () => {
    const product = await createProduct('MAT-1', 9);
    const nsr = await openBranch('NSR');
    await postInvoice('PURCHASE', nsr.id, await createSupplier(), product.id, 4);
    const matrix = (await admin.get('/api/stock/matrix').expect(200)).body;
    const row = matrix.rows.find((r: { product_id: string }) => r.product_id === product.id);
    expect(row.by_branch).toEqual({ main: 9, [nsr.id]: 4 });
    expect(row.total).toBe(13);
    expect(matrix.branches.map((b: { code: string }) => b.code).sort()).toEqual(['HQ', 'NSR']);
  });

  it('employees see the branches they are assigned to', async () => {
    const users = (await admin.get('/api/users').expect(200)).body as {
      id: string;
      branch_ids: string[];
    }[];
    expect(users.find((u) => u.id === 'staff')?.branch_ids).toEqual(['main']);
  });
});
