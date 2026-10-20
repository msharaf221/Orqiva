/**
 * Phase 4.2 — General Ledger (دفتر الأستاذ).
 *
 * Verifies the double-entry books:
 *  - the standard chart of accounts is seeded with system keys;
 *  - posting a sale writes a balanced entry (Dr AR = Cr Sales + Cr VAT, Dr COGS = Cr Inventory);
 *  - posting a purchase writes Dr Inventory + Dr VAT input = Cr AP;
 *  - payments, expenses, cash movements and transfers post to their accounts;
 *  - cancelling a posted document reverses its entry rather than editing it;
 *  - unbalanced or single-sided manual entries are rejected, and the trigger is a backstop;
 *  - once posted, entry lines cannot be modified;
 *  - the trial balance always balances, and a period lock blocks posting into a closed date.
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { seedUsers, signIn, resetBusinessData, header } from './helpers';
import { all, one, run } from '../server/db';
import { systemAccount, postEntry } from '../server/ledger';

beforeAll(seedUsers);
beforeEach(resetBusinessData);

const TODAY = new Date().toISOString().slice(0, 10);
type Client = Awaited<ReturnType<typeof signIn>>;

async function admin() {
  return signIn('admin@test.local');
}

interface Setup {
  customerId: string;
  supplierId: string;
  productId: string;
}

async function setup(client: Client): Promise<Setup> {
  const customer = await client.post('/api/parties').set(header).send({
    type: 'CUSTOMER',
    name: 'عميل محاسبي',
    email: '',
    phone: '',
    address: '',
    tax_number: '',
    notes: '',
  });
  const supplier = await client.post('/api/parties').set(header).send({
    type: 'SUPPLIER',
    name: 'مورد محاسبي',
    email: '',
    phone: '',
    address: '',
    tax_number: '',
    notes: '',
  });
  const product = await client.post('/api/products').set(header).send({
    sku: 'GL-PROD-01',
    name: 'منتج محاسبي',
    category: 'عام',
    unit: 'قطعة',
    sale_price: 10000,
    cost_price: 6000,
    min_stock: 0,
  });
  return { customerId: customer.body.id, supplierId: supplier.body.id, productId: product.body.id };
}

async function purchase(client: Client, supplierId: string, productId: string, quantity = 10) {
  const po = await client
    .post('/api/documents')
    .set(header)
    .send({
      type: 'PURCHASE',
      branch_id: 'main',
      party_id: supplierId,
      date: TODAY,
      due_date: TODAY,
      tax_rate: 0,
      discount: 0,
      notes: '',
      lines: [{ product_id: productId, quantity, unit_price: 6000 }],
    });
  await client.post(`/api/documents/${po.body.id}/post`).set(header).send({});
  return po.body.id as string;
}

async function sale(client: Client, customerId: string, productId: string, quantity = 2) {
  const doc = await client
    .post('/api/documents')
    .set(header)
    .send({
      type: 'SALE',
      branch_id: 'main',
      party_id: customerId,
      date: TODAY,
      due_date: TODAY,
      tax_rate: 1400,
      discount: 0,
      notes: '',
      lines: [{ product_id: productId, quantity, unit_price: 10000 }],
    });
  await client.post(`/api/documents/${doc.body.id}/post`).set(header).send({});
  return doc.body.id as string;
}

/** Signed balance of a system account across the whole group. */
function balanceOf(systemKey: string): number {
  const account = systemAccount(systemKey);
  const row = one<{ d: number; c: number }>(
    `SELECT COALESCE(SUM(l.debit),0) d, COALESCE(SUM(l.credit),0) c
     FROM journal_lines l WHERE l.account_id=?`,
    account.id,
  );
  return (row?.d ?? 0) - (row?.c ?? 0);
}

describe('Phase 4.2 — chart of accounts', () => {
  it('seeds a standard chart with system keys', async () => {
    const client = await admin();
    const res = await client.get('/api/gl/accounts').set(header).expect(200);
    expect(res.body.length).toBeGreaterThanOrEqual(19);
    for (const key of ['CASH', 'BANK', 'AR', 'AP', 'INVENTORY', 'VAT_OUTPUT', 'SALES', 'COGS']) {
      expect(systemAccount(key).id).toBeTruthy();
    }
    expect(systemAccount('SALES').normal_side).toBe('CREDIT');
    expect(systemAccount('COGS').type).toBe('EXPENSE');
  });

  it('lets an accountant add a custom account but blocks system deletion', async () => {
    const client = await admin();
    const created = await client
      .post('/api/gl/accounts')
      .set(header)
      .send({
        code: '6140',
        name: 'مصروف إيجارات',
        type: 'EXPENSE',
        normal_side: 'DEBIT',
        active: true,
        notes: '',
      })
      .expect(201);
    expect(created.body.code).toBe('6140');

    await client
      .delete(`/api/gl/accounts/${systemAccount('CASH').id}`)
      .set(header)
      .expect(409);

    // A duplicate code is rejected.
    await client
      .post('/api/gl/accounts')
      .set(header)
      .send({
        code: '6140',
        name: 'مكرر',
        type: 'EXPENSE',
        normal_side: 'DEBIT',
        active: true,
        notes: '',
      })
      .expect(409);
  });
});

describe('Phase 4.2 — automatic posting', () => {
  it('posts a balanced sale entry with VAT and COGS', async () => {
    const client = await admin();
    const { customerId, supplierId, productId } = await setup(client);
    await purchase(client, supplierId, productId, 10);
    await sale(client, customerId, productId, 2);

    // 2 × 10000 = 20000 net, 14% VAT = 2800, total 22800; WAC 6000 → COGS 12000.
    expect(balanceOf('AR')).toBe(22800);
    expect(balanceOf('SALES')).toBe(-20000);
    expect(balanceOf('VAT_OUTPUT')).toBe(-2800);
    expect(balanceOf('COGS')).toBe(12000);
    expect(balanceOf('INVENTORY')).toBe(60000 - 12000);

    const saleEntry = one<{ id: string }>(
      "SELECT id FROM journal_entries WHERE source_type='SALE'",
    );
    expect(saleEntry).toBeTruthy();
    const totals = one<{ d: number; c: number }>(
      'SELECT COALESCE(SUM(debit),0) d, COALESCE(SUM(credit),0) c FROM journal_lines WHERE entry_id=?',
      saleEntry!.id,
    );
    expect(totals!.d).toBe(totals!.c);
  });

  it('posts a purchase entry into inventory and payable', async () => {
    const client = await admin();
    const { supplierId, productId } = await setup(client);
    await purchase(client, supplierId, productId, 10);

    expect(balanceOf('INVENTORY')).toBe(60000);
    expect(balanceOf('AP')).toBe(-60000);
  });

  it('posts payments against the customer and supplier balances', async () => {
    const client = await admin();
    const { customerId, supplierId, productId } = await setup(client);
    await purchase(client, supplierId, productId, 10);
    const saleId = await sale(client, customerId, productId, 1);

    await client
      .post(`/api/documents/${saleId}/payments`)
      .set(header)
      .send({ amount: 11400, method: 'CASH', date: TODAY, reference: 'تحصيل' })
      .expect(201);

    // AR now carries only the unpaid difference; cash holds the collection.
    expect(balanceOf('AR')).toBe(11400 - 11400);
    expect(balanceOf('CASH')).toBe(11400);
  });

  it('reverses, never edits, when a posted document is cancelled', async () => {
    const client = await admin();
    const { customerId, supplierId, productId } = await setup(client);
    await purchase(client, supplierId, productId, 10);
    const saleId = await sale(client, customerId, productId, 2);

    await client.post(`/api/documents/${saleId}/cancel`).set(header).send({}).expect(200);

    // The original entry is REVERSED and a mirror entry restores the balances.
    const original = one<{ status: string }>(
      "SELECT status FROM journal_entries WHERE source_type='SALE' LIMIT 1",
    );
    expect(original?.status).toBe('REVERSED');
    expect(balanceOf('AR')).toBe(0);
    expect(balanceOf('SALES')).toBe(0);
    expect(balanceOf('COGS')).toBe(0);
    expect(balanceOf('INVENTORY')).toBe(60000);
  });

  it('posts expenses and account transfers', async () => {
    const client = await admin();
    await client
      .post('/api/expenses')
      .set(header)
      .send({
        title: 'فاتورة كهرباء',
        category: 'مرافق',
        amount: 5000,
        date: TODAY,
        method: 'CASH',
        branch_id: 'main',
        allocation: 'BRANCH',
        notes: '',
      })
      .expect(201);
    expect(balanceOf('EXPENSE')).toBe(5000);
    expect(balanceOf('CASH')).toBe(-5000);

    const cash = one<{ id: string }>("SELECT id FROM cash_accounts WHERE type='CASH' LIMIT 1")!;
    const bank = one<{ id: string }>("SELECT id FROM cash_accounts WHERE type='BANK' LIMIT 1")!;
    await client
      .post('/api/cash-accounts/transfers')
      .set(header)
      .send({
        from_account_id: bank.id,
        to_account_id: cash.id,
        amount: 20000,
        date: TODAY,
        notes: 'تغذية الصندوق',
        override_overdraft: true,
      })
      .expect(201);
    expect(balanceOf('BANK')).toBe(-20000);
    expect(balanceOf('CASH')).toBe(-5000 + 20000);
  });

  it('posts stocktake shortages to shrinkage', async () => {
    const client = await admin();
    const { supplierId, productId } = await setup(client);
    await purchase(client, supplierId, productId, 10);

    const session = (await client.post('/api/stocktakes').set(header).send({ branch_id: 'main' }))
      .body;
    const lines = (await client.get(`/api/stocktakes/${session.id}`).set(header)).body.lines;
    await client
      .put(`/api/stocktakes/${session.id}/counts`)
      .set(header)
      .send({
        counts: lines.map((l: { id: string; expected_qty: number }) => ({
          line_id: l.id,
          counted_qty: l.expected_qty - 1,
        })),
      })
      .expect(200);
    await client.post(`/api/stocktakes/${session.id}/submit`).set(header).send({}).expect(200);
    await client.post(`/api/stocktakes/${session.id}/approve`).set(header).send({}).expect(200);

    // One unit short at WAC 6000.
    expect(balanceOf('SHRINKAGE')).toBe(6000);
    expect(balanceOf('INVENTORY')).toBe(54000);
  });
});

describe('Phase 4.2 — invariants', () => {
  it('rejects unbalanced and single-sided manual entries', async () => {
    const client = await admin();
    const sales = systemAccount('SALES').id;
    const ar = systemAccount('AR').id;

    await client
      .post('/api/gl/journal')
      .set(header)
      .send({
        date: TODAY,
        memo: 'قيد غير متوازن',
        lines: [
          { account_id: ar, debit: 100, credit: 0, memo: '' },
          { account_id: sales, debit: 0, credit: 90, memo: '' },
        ],
      })
      .expect(400);

    await client
      .post('/api/gl/journal')
      .set(header)
      .send({
        date: TODAY,
        memo: 'بند مزدوج الجانب',
        lines: [
          { account_id: ar, debit: 100, credit: 100, memo: '' },
          { account_id: sales, debit: 0, credit: 0, memo: '' },
        ],
      })
      .expect(400);
  });

  it('accepts a balanced manual entry and refuses to edit it afterwards', async () => {
    const client = await admin();
    const ar = systemAccount('AR').id;
    const sales = systemAccount('SALES').id;
    const created = await client
      .post('/api/gl/journal')
      .set(header)
      .send({
        date: TODAY,
        memo: 'تسوية افتتاحية',
        lines: [
          { account_id: ar, debit: 5000, credit: 0, memo: '' },
          { account_id: sales, debit: 0, credit: 5000, memo: '' },
        ],
      })
      .expect(201);
    expect(created.body.number).toContain('JV');

    // The trigger refuses new lines on a posted entry.
    expect(() =>
      run(
        'INSERT INTO journal_lines(id,entry_id,account_id,debit,credit,branch_id,memo) VALUES(?,?,?,?,?,?,?)',
        'sneaky-line',
        created.body.id,
        systemAccount('CASH').id,
        1,
        0,
        null,
        '',
      ),
    ).toThrow(/posted/i);
  });

  it('the balance trigger aborts an unbalanced post', async () => {
    const client = await admin();
    await client.get('/api/gl/accounts').set(header).expect(200);
    const ar = systemAccount('AR').id;
    // Bypass the engine: write two lines directly then flip to POSTED. The trigger must abort.
    run(
      "INSERT INTO journal_entries(id,number,date,memo,source_type,status,created_by,created_at) VALUES('bad-entry','JV-BAD',?,'','MANUAL','DRAFT','admin',?)",
      TODAY,
      new Date().toISOString(),
    );
    run(
      'INSERT INTO journal_lines(id,entry_id,account_id,debit,credit,memo) VALUES(?,?,?,?,?,?)',
      'bad-l1',
      'bad-entry',
      ar,
      100,
      0,
      '',
    );
    run(
      'INSERT INTO journal_lines(id,entry_id,account_id,debit,credit,memo) VALUES(?,?,?,?,?,?)',
      'bad-l2',
      'bad-entry',
      systemAccount('SALES').id,
      0,
      90,
      '',
    );
    expect(() => run("UPDATE journal_entries SET status='POSTED' WHERE id='bad-entry'")).toThrow(
      /balanced/i,
    );
  });

  it('balances the trial balance and blocks posting into a closed period', async () => {
    const client = await admin();
    const { customerId, supplierId, productId } = await setup(client);
    await purchase(client, supplierId, productId, 10);
    await sale(client, customerId, productId, 2);

    const trial = await client.get('/api/gl/trial-balance').set(header).expect(200);
    const debit = trial.body.reduce((s: number, r: { debit: number }) => s + r.debit, 0);
    const credit = trial.body.reduce((s: number, r: { credit: number }) => s + r.credit, 0);
    expect(debit).toBe(credit);

    // Close the period through today, then attempt a new posting.
    await client
      .put('/api/gl/settings')
      .set(header)
      .send({ fiscal_year_start_month: 1, closed_through: TODAY })
      .expect(200);

    const customer = await client.post('/api/parties').set(header).send({
      type: 'CUSTOMER',
      name: 'عميل مغلق',
      email: '',
      phone: '',
      address: '',
      tax_number: '',
      notes: '',
    });
    const doc = await client
      .post('/api/documents')
      .set(header)
      .send({
        type: 'SALE',
        branch_id: 'main',
        party_id: customer.body.id,
        date: TODAY,
        due_date: TODAY,
        tax_rate: 1400,
        discount: 0,
        notes: '',
        lines: [{ product_id: productId, quantity: 1, unit_price: 10000 }],
      });
    // The document post rolls back entirely because its ledger entry cannot be written.
    await client.post(`/api/documents/${doc.body.id}/post`).set(header).send({}).expect(409);
    const status = one<{ status: string }>('SELECT status FROM documents WHERE id=?', doc.body.id);
    expect(status?.status).toBe('DRAFT');
  });

  it('exposes a per-account statement with a running balance', async () => {
    const client = await admin();
    const { supplierId, productId } = await setup(client);
    await purchase(client, supplierId, productId, 10);

    const res = await client
      .get(`/api/gl/accounts/${systemAccount('AP').id}/statement`)
      .set(header)
      .expect(200);
    expect(res.body.opening).toBe(0);
    expect(res.body.lines).toHaveLength(1);
    expect(res.body.lines[0].running_balance).toBe(60000);
  });
});

// Guard against an accidental signature change breaking the exported engine API.
describe('Phase 4.2 — engine exports', () => {
  it('postEntry refuses an empty set of lines at the type boundary', async () => {
    const client = await admin();
    await client.get('/api/gl/accounts').set(header).expect(200);
    expect(() =>
      postEntry(
        { date: TODAY, sourceType: 'MANUAL', lines: [] },
        { id: 'admin', name: 'مدير اختبار', role: 'ADMIN' },
      ),
    ).toThrow();
  });

  it('keeps every journal line one-sided', async () => {
    const client = await admin();
    const { customerId, supplierId, productId } = await setup(client);
    await purchase(client, supplierId, productId, 10);
    await sale(client, customerId, productId, 1);
    const bad = all('SELECT id FROM journal_lines WHERE debit>0 AND credit>0');
    expect(bad).toHaveLength(0);
  });
});
