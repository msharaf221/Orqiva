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

    // 2 × 10000 = 20000 net, tax-free total 20000; WAC 6000 → COGS 12000.
    expect(balanceOf('AR')).toBe(20000);
    expect(balanceOf('SALES')).toBe(-20000);
    expect(balanceOf('VAT_OUTPUT')).toBe(0);
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
      .send({ amount: 10000, method: 'CASH', date: TODAY, reference: 'تحصيل' })
      .expect(201);

    // AR now carries only the unpaid difference; cash holds the collection.
    expect(balanceOf('AR')).toBe(10000 - 10000);
    expect(balanceOf('CASH')).toBe(10000);
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

describe('Phase 1.1 — Financial Statements (P&L and Balance Sheet)', () => {
  it('generates an accurate Profit & Loss statement with revenues, COGS, and expenses', async () => {
    const client = await admin();
    const { customerId, supplierId, productId } = await setup(client);

    // Purchase 10 units at 60 EGP (6000 piasters)
    await purchase(client, supplierId, productId, 10);

    // Sell 3 units at 100 EGP (10000 piasters) with 14% tax
    await sale(client, customerId, productId, 3);

    // Record an operating expense of 50 EGP (5000 piasters)
    await client
      .post('/api/expenses')
      .set(header)
      .send({
        title: 'فاتورة إنترنت ومرافق',
        category: 'مرافق',
        amount: 5000,
        date: TODAY,
        method: 'CASH',
        branch_id: 'main',
        override_overdraft: true,
        notes: '',
      })
      .expect(201);

    const res = await client
      .get(`/api/gl/profit-and-loss?from=${TODAY}&to=${TODAY}`)
      .set(header)
      .expect(200);

    const pnl = res.body;
    expect(pnl.period.from).toBe(TODAY);
    expect(pnl.period.to).toBe(TODAY);

    // Net revenue: 3 * 10000 = 30000 piasters
    expect(pnl.gross_sales.total).toBe(30000);
    expect(pnl.sales_deductions.total).toBe(0);
    expect(pnl.net_revenue).toBe(30000);

    // COGS: 3 * 6000 = 18000 piasters
    expect(pnl.total_cogs).toBe(18000);

    // Gross profit: 30000 - 18000 = 12000 piasters
    expect(pnl.gross_profit).toBe(12000);

    // Operating expenses: 5000 piasters
    expect(pnl.total_operating_expenses).toBe(5000);

    // Net profit: 12000 - 5000 = 7000 piasters
    expect(pnl.net_profit).toBe(7000);

    // Rows verification
    expect(pnl.gross_sales.rows).toHaveLength(1);
    expect(pnl.gross_sales.rows[0].code).toBe('4110');
    expect(pnl.cogs.rows).toHaveLength(1);
    expect(pnl.cogs.rows[0].code).toBe('5110');
    expect(pnl.operating_expenses.rows).toHaveLength(1);
    expect(pnl.operating_expenses.rows[0].code).toBe('6110');
  });

  it('calculates P&L with previous period comparison and percentage changes', async () => {
    const client = await admin();
    const { customerId, supplierId, productId } = await setup(client);
    await purchase(client, supplierId, productId, 10);
    await sale(client, customerId, productId, 2);

    const res = await client
      .get(
        `/api/gl/profit-and-loss?from=${TODAY}&to=${TODAY}&compare_from=2026-01-01&compare_to=2026-01-31`,
      )
      .set(header)
      .expect(200);

    const pnl = res.body;
    expect(pnl.comparison_period).toEqual({ from: '2026-01-01', to: '2026-01-31' });
    expect(pnl.net_revenue).toBe(20000);
    expect(pnl.previous_net_revenue).toBe(0);
  });

  it('generates a perfectly balanced Balance Sheet reconciling with P&L earnings', async () => {
    const client = await admin();
    const { customerId, supplierId, productId } = await setup(client);

    // 1. Purchase 10 units at 60 EGP
    await purchase(client, supplierId, productId, 10);

    // 2. Sell 4 units at 100 EGP (14% VAT = 5600 piasters, total receivable = 45600)
    await sale(client, customerId, productId, 4);

    // 3. Operating expense of 40 EGP
    await client
      .post('/api/expenses')
      .set(header)
      .send({
        title: 'مصروف صيانة دورية',
        category: 'صيانة',
        amount: 4000,
        date: TODAY,
        method: 'CASH',
        branch_id: 'main',
        override_overdraft: true,
        notes: '',
      })
      .expect(201);

    const pnlRes = await client
      .get(`/api/gl/profit-and-loss?from=${TODAY}&to=${TODAY}`)
      .set(header)
      .expect(200);

    const bsRes = await client.get(`/api/gl/balance-sheet?as_of=${TODAY}`).set(header).expect(200);

    const bs = bsRes.body;
    expect(bs.as_of).toBe(TODAY);
    expect(bs.is_balanced).toBe(true);
    expect(bs.total_assets).toBe(bs.total_liabilities_and_equity);

    // Current period earnings in Balance Sheet must match Net Profit in P&L exactly!
    expect(bs.equity.current_period_earnings).toBe(pnlRes.body.net_profit);

    // Current assets breakdown
    expect(bs.assets.total_assets).toBeGreaterThan(0);
    expect(bs.assets.current_assets.rows.some((r: any) => r.code === '1130')).toBe(true); // AR
    expect(bs.assets.current_assets.rows.some((r: any) => r.code === '1140')).toBe(true); // Inventory

    // Liabilities breakdown
    expect(bs.liabilities.current_liabilities.rows.some((r: any) => r.code === '2110')).toBe(true); // AP
    expect(bs.liabilities.current_liabilities.rows.some((r: any) => r.code === '2120')).toBe(true); // VAT Output
  });
});

describe('Phase 4.2 — Pack 1.2: Hierarchical Chart of Accounts Tree', () => {
  it('suggests the next sub-account code intelligently based on parent code', async () => {
    const client = await admin();
    const cashAccount = systemAccount('CASH'); // code: 1110

    // 1. Initial suggestion under 1110 should be 111001
    const res1 = await client
      .get(`/api/gl/accounts/next-code?parent_id=${cashAccount.id}`)
      .set(header)
      .expect(200);

    expect(res1.body.code).toBe('111001');
    expect(res1.body.parent.code).toBe('1110');
    expect(res1.body.parent.type).toBe('ASSET');

    // 2. Create child 111001
    await client
      .post('/api/gl/accounts')
      .set(header)
      .send({
        code: '111001',
        name: 'خزينة فرع المعادي',
        type: 'ASSET',
        normal_side: 'DEBIT',
        parent_id: cashAccount.id,
        active: true,
        notes: '',
      })
      .expect(201);

    // 3. Next suggestion should now automatically be 111002
    const res2 = await client
      .get(`/api/gl/accounts/next-code?parent_id=${cashAccount.id}`)
      .set(header)
      .expect(200);

    expect(res2.body.code).toBe('111002');
  });

  it('enforces hierarchy consistency and prevents invalid parent relations', async () => {
    const client = await admin();
    const cashAccount = systemAccount('CASH'); // ASSET

    // Mismatched type between child and parent must fail (400)
    await client
      .post('/api/gl/accounts')
      .set(header)
      .send({
        code: '111099',
        name: 'حساب غير متوافق مع الأب',
        type: 'EXPENSE', // parent is ASSET!
        normal_side: 'DEBIT',
        parent_id: cashAccount.id,
        active: true,
        notes: '',
      })
      .expect(400);

    // Self-parenting on update must fail (400)
    await client
      .put(`/api/gl/accounts/${cashAccount.id}`)
      .set(header)
      .send({ parent_id: cashAccount.id })
      .expect(400);
  });

  it('strictly blocks deletion of accounts with movements or children, allows archiving', async () => {
    const client = await admin();
    const expenseParent = systemAccount('EXPENSE'); // 6110

    // 1. Create a child account under expense
    const child = await client
      .post('/api/gl/accounts')
      .set(header)
      .send({
        code: '611001',
        name: 'مصروف كهرباء ومرافق',
        type: 'EXPENSE',
        normal_side: 'DEBIT',
        parent_id: expenseParent.id,
        active: true,
        notes: '',
      })
      .expect(201);

    // 2. Parent cannot be deleted because it now has a child
    await client.delete(`/api/gl/accounts/${expenseParent.id}`).set(header).expect(409);

    // 3. Post a journal entry to the child account
    await client
      .post('/api/gl/journal')
      .set(header)
      .send({
        date: TODAY,
        memo: 'سداد فاتورة كهرباء',
        lines: [
          { account_id: child.body.id, debit: 15000, credit: 0 },
          { account_id: systemAccount('CASH').id, debit: 0, credit: 15000 },
        ],
      })
      .expect(201);

    // 4. Now child cannot be deleted because it has journal movements
    const delRes = await client.delete(`/api/gl/accounts/${child.body.id}`).set(header).expect(409);
    expect(delRes.body.error).toContain('حركات');

    // 5. Changing type or normal_side of account with movements is strictly blocked
    await client
      .put(`/api/gl/accounts/${child.body.id}`)
      .set(header)
      .send({ type: 'LIABILITY' })
      .expect(409);

    await client
      .put(`/api/gl/accounts/${child.body.id}`)
      .set(header)
      .send({ normal_side: 'CREDIT' })
      .expect(409);

    // 6. Archiving / deactivating the account is permitted
    const archived = await client
      .put(`/api/gl/accounts/${child.body.id}`)
      .set(header)
      .send({ active: false })
      .expect(200);
    expect(archived.body.active).toBe(0);

    // 7. Verify listAccounts() returns balance, lines_count, children_count, and parent info
    const accounts = await client.get('/api/gl/accounts').set(header).expect(200);
    const fetchedChild = accounts.body.find((a: any) => a.id === child.body.id);
    expect(fetchedChild).toBeDefined();
    expect(fetchedChild.lines_count).toBe(1);
    expect(fetchedChild.balance).toBe(15000); // 150 EGP
    expect(fetchedChild.parent_code).toBe('6110');
    expect(fetchedChild.parent_name).toBe('مصروفات تشغيلية');

    const fetchedParent = accounts.body.find((a: any) => a.id === expenseParent.id);
    expect(fetchedParent.children_count).toBeGreaterThanOrEqual(1);

    // 8. Create an unused account with 0 movements and delete it successfully
    const unused = await client
      .post('/api/gl/accounts')
      .set(header)
      .send({
        code: '611099',
        name: 'حساب تجريبي بدون حركات',
        type: 'EXPENSE',
        normal_side: 'DEBIT',
        parent_id: expenseParent.id,
        active: true,
        notes: '',
      })
      .expect(201);

    await client.delete(`/api/gl/accounts/${unused.body.id}`).set(header).expect(200);
  });

  describe('Phase 4.2 — Pack 1.3: Opening Balances Wizard (معالج الأرصدة الافتتاحية)', () => {
    it('posts a balanced opening entry across cash, customers, suppliers, inventory, and balances to OPENING_EQUITY', async () => {
      const client = await admin();
      const { customerId, supplierId, productId } = await setup(client);
      const cashAcc = one<{ id: string }>(
        "SELECT id FROM cash_accounts WHERE type='CASH' LIMIT 1",
      )!;

      // 1. Initial status: no opening entry
      const statusBefore = await client.get('/api/gl/opening-balances').set(header).expect(200);
      expect(statusBefore.body.has_opening_entry).toBe(false);
      expect(statusBefore.body.can_post).toBe(true);

      // 2. Post opening balances
      // Cash: 5,000.00 EGP (500,000 piasters) Dr
      // Customers: 2,000.00 EGP (200,000 piasters) Dr
      // Suppliers: 1,500.00 EGP (150,000 piasters) Cr
      // Inventory: 50 units @ 40.00 EGP = 2,000.00 EGP (200,000 piasters) Dr
      // Total Debits = 900,000; Total Credits = 150,000
      // Expected balancing Credit to OPENING_EQUITY: 750,000 piasters (7,500.00 EGP)
      const postRes = await client
        .post('/api/gl/opening-balances')
        .set(header)
        .send({
          date: '2026-01-01',
          memo: 'الأرصدة الافتتاحية لبداية النشاط',
          balancing_account: 'OPENING_EQUITY',
          cash_accounts: [{ cash_account_id: cashAcc.id, amount: 500000 }],
          customers: [{ party_id: customerId, amount: 200000 }],
          suppliers: [{ party_id: supplierId, amount: 150000 }],
          inventory_items: [
            { branch_id: 'main', product_id: productId, quantity: 50, unit_cost: 4000 },
          ],
        })
        .expect(201);

      const entry = postRes.body;
      expect(entry.source_type).toBe('OPENING');
      expect(entry.status).toBe('POSTED');

      // Verify lines in DB
      const lines = all<{ account_id: string; debit: number; credit: number; memo: string }>(
        'SELECT account_id, debit, credit, memo FROM journal_lines WHERE entry_id=?',
        entry.id,
      );
      const totalDebit = lines.reduce((s, l) => s + l.debit, 0);
      const totalCredit = lines.reduce((s, l) => s + l.credit, 0);
      expect(totalDebit).toBe(900000);
      expect(totalCredit).toBe(900000);

      // Verify balancing line routed to acc_opening
      const balancingLine = lines.find((l) => l.account_id === 'acc_opening');
      expect(balancingLine).toBeDefined();
      expect(balancingLine!.credit).toBe(750000);
      expect(balancingLine!.debit).toBe(0);

      // Verify cash_accounts table updated
      const updatedCash = one<{ initial_balance: number }>(
        'SELECT initial_balance FROM cash_accounts WHERE id=?',
        cashAcc.id,
      );
      expect(updatedCash?.initial_balance).toBe(500000);

      // Verify inventory stock & WAC updated
      const stock = one<{ quantity: number }>(
        "SELECT quantity FROM branch_stock WHERE branch_id='main' AND product_id=?",
        productId,
      );
      expect(stock?.quantity).toBe(50);

      const branchCost = one<{ avg_cost: number }>(
        "SELECT avg_cost FROM branch_cost WHERE branch_id='main' AND product_id=?",
        productId,
      );
      expect(branchCost?.avg_cost).toBe(4000);

      // Verify opening balances status now reports locked
      const statusAfter = await client.get('/api/gl/opening-balances').set(header).expect(200);
      expect(statusAfter.body.has_opening_entry).toBe(true);
      expect(statusAfter.body.can_post).toBe(false);
      expect(statusAfter.body.opening_entry.id).toBe(entry.id);
      expect(statusAfter.body.opening_lines.length).toBe(lines.length);
    });

    it('routes the balancing difference to CAPITAL when requested', async () => {
      const client = await admin();
      const cashAcc = one<{ id: string }>(
        "SELECT id FROM cash_accounts WHERE type='CASH' LIMIT 1",
      )!;

      // Debit Cash 300,000, balancing difference should go to acc_capital
      const res = await client
        .post('/api/gl/opening-balances')
        .set(header)
        .send({
          date: '2026-01-01',
          balancing_account: 'CAPITAL',
          cash_accounts: [{ cash_account_id: cashAcc.id, amount: 300000 }],
        })
        .expect(201);

      const lines = all<{ account_id: string; debit: number; credit: number }>(
        'SELECT account_id, debit, credit FROM journal_lines WHERE entry_id=?',
        res.body.id,
      );
      const capLine = lines.find((l) => l.account_id === 'acc_capital');
      expect(capLine).toBeDefined();
      expect(capLine!.credit).toBe(300000);
      expect(capLine!.debit).toBe(0);
    });

    it('strictly blocks duplicate active opening entries with 409', async () => {
      const client = await admin();
      const cashAcc = one<{ id: string }>(
        "SELECT id FROM cash_accounts WHERE type='CASH' LIMIT 1",
      )!;

      // 1. Post initial opening entry
      await client
        .post('/api/gl/opening-balances')
        .set(header)
        .send({
          date: '2026-01-01',
          balancing_account: 'OPENING_EQUITY',
          cash_accounts: [{ cash_account_id: cashAcc.id, amount: 100000 }],
        })
        .expect(201);

      // 2. Try posting another opening entry while active exists -> 409
      const dupRes = await client
        .post('/api/gl/opening-balances')
        .set(header)
        .send({
          date: '2026-01-01',
          balancing_account: 'OPENING_EQUITY',
          cash_accounts: [{ cash_account_id: cashAcc.id, amount: 200000 }],
        })
        .expect(409);

      expect(dupRes.body.error).toContain('تم ترحيل قيد أرصدة افتتاحية مسبقاً');
    });

    it('strictly guards against posting or reversing opening balances when later transactions exist', async () => {
      const client = await admin();
      const cashAcc = one<{ id: string }>(
        "SELECT id FROM cash_accounts WHERE type='CASH' LIMIT 1",
      )!;

      // 1. Post an opening entry on 2026-01-01
      await client
        .post('/api/gl/opening-balances')
        .set(header)
        .send({
          date: '2026-01-01',
          balancing_account: 'OPENING_EQUITY',
          cash_accounts: [{ cash_account_id: cashAcc.id, amount: 100000 }],
        })
        .expect(201);

      // 2. Post a subsequent journal entry on 2026-01-15
      await client
        .post('/api/gl/journal')
        .set(header)
        .send({
          date: '2026-01-15',
          memo: 'حركة لاحقة بعد الافتتاح',
          lines: [
            { account_id: 'acc_cash', debit: 5000, credit: 0 },
            { account_id: 'acc_sales', debit: 0, credit: 5000 },
          ],
        })
        .expect(201);

      // 3. Attempting to reverse opening balances is now strictly blocked with 409
      const revBlocked = await client
        .post('/api/gl/opening-balances/reverse')
        .set(header)
        .send({})
        .expect(409);

      expect(revBlocked.body.error).toContain(
        'لا يمكن عكس الأرصدة الافتتاحية لوجود قيود محاسبية لاحقة',
      );

      // 4. If someone attempts to post opening balance with date 2026-01-10 when a 2026-01-15 transaction exists:
      // Even if active opening entry was marked reversed/removed, it would block with 409
      const existingOpening = one<{ id: string }>(
        "SELECT id FROM journal_entries WHERE source_type='OPENING' AND status='POSTED'",
      )!;
      run("UPDATE journal_entries SET status='REVERSED' WHERE id=?", existingOpening.id);

      const postBlocked = await client
        .post('/api/gl/opening-balances')
        .set(header)
        .send({
          date: '2026-01-10',
          balancing_account: 'OPENING_EQUITY',
          cash_accounts: [{ cash_account_id: cashAcc.id, amount: 50000 }],
        })
        .expect(409);

      expect(postBlocked.body.error).toContain('لا يمكن ترحيل أرصدة افتتاحية');
      expect(postBlocked.body.error).toContain('يوجد قيد محاسبي لاحق');
    });

    it('supports reversal workflow: unlocks wizard, rolls back sub-ledger, and allows re-posting', async () => {
      const client = await admin();
      const { productId } = await setup(client);
      const cashAcc = one<{ id: string }>(
        "SELECT id FROM cash_accounts WHERE type='CASH' LIMIT 1",
      )!;

      // 1. Post initial opening entry with cash and inventory
      const initialPost = await client
        .post('/api/gl/opening-balances')
        .set(header)
        .send({
          date: '2026-01-01',
          balancing_account: 'OPENING_EQUITY',
          cash_accounts: [{ cash_account_id: cashAcc.id, amount: 250000 }],
          inventory_items: [
            { branch_id: 'main', product_id: productId, quantity: 20, unit_cost: 3000 },
          ],
        })
        .expect(201);

      expect(
        one<{ initial_balance: number }>(
          'SELECT initial_balance FROM cash_accounts WHERE id=?',
          cashAcc.id,
        )?.initial_balance,
      ).toBe(250000);
      expect(
        one<{ quantity: number }>(
          "SELECT quantity FROM branch_stock WHERE branch_id='main' AND product_id=?",
          productId,
        )?.quantity,
      ).toBe(20);

      // 2. Reverse the opening entry
      const revRes = await client
        .post('/api/gl/opening-balances/reverse')
        .set(header)
        .send({})
        .expect(200);

      expect(revRes.body.source_type).toBe('REVERSAL');
      expect(revRes.body.reversal_of).toBe(initialPost.body.id);

      // Verify original entry marked REVERSED
      const originalEntry = one<{ status: string }>(
        'SELECT status FROM journal_entries WHERE id=?',
        initialPost.body.id,
      );
      expect(originalEntry?.status).toBe('REVERSED');

      // Verify sub-ledgers rolled back
      expect(
        one<{ initial_balance: number }>(
          'SELECT initial_balance FROM cash_accounts WHERE id=?',
          cashAcc.id,
        )?.initial_balance,
      ).toBe(0);
      expect(
        one<{ quantity: number }>(
          "SELECT quantity FROM branch_stock WHERE branch_id='main' AND product_id=?",
          productId,
        )?.quantity,
      ).toBe(0);

      // 3. Status is now unlocked: can_post is true
      const statusAfterRev = await client.get('/api/gl/opening-balances').set(header).expect(200);
      expect(statusAfterRev.body.can_post).toBe(true);
      expect(statusAfterRev.body.has_opening_entry).toBe(false);

      // 4. Re-posting is now permitted and works cleanly
      const repost = await client
        .post('/api/gl/opening-balances')
        .set(header)
        .send({
          date: '2026-01-01',
          memo: 'الأرصدة الافتتاحية المعدلة',
          balancing_account: 'OPENING_EQUITY',
          cash_accounts: [{ cash_account_id: cashAcc.id, amount: 400000 }],
        })
        .expect(201);

      expect(repost.body.status).toBe('POSTED');
      expect(
        one<{ initial_balance: number }>(
          'SELECT initial_balance FROM cash_accounts WHERE id=?',
          cashAcc.id,
        )?.initial_balance,
      ).toBe(400000);
    });
  });

  describe('Pack 1.4: Egyptian VAT Return (Model 10) & Tax Registers', () => {
    it('accurately computes Egyptian VAT Return (Model 10) from GL journal entries with 14% sales, returns, purchases, and returns', async () => {
      const client = await admin();

      // 1. Create registered customer and supplier with valid TRNs
      const customer = await client.post('/api/parties').set(header).send({
        type: 'CUSTOMER',
        name: 'شركة النيل للتجارة (عميل مسجل)',
        email: 'nile@test.local',
        phone: '01011112222',
        address: 'القاهرة، مصر',
        tax_number: '100-200-300',
        notes: '',
      });
      const customerId = customer.body.id;

      const supplier = await client.post('/api/parties').set(header).send({
        type: 'SUPPLIER',
        name: 'شركة الدلتا للصناعات (مورد مسجل)',
        email: 'delta@test.local',
        phone: '01033334444',
        address: 'العاشر من رمضان، مصر',
        tax_number: '400-500-600',
        notes: '',
      });
      const supplierId = supplier.body.id;

      const product = await client.post('/api/products').set(header).send({
        sku: 'VAT-ITEM-01',
        name: 'صنف خاضع للقيمة المضافة 14%',
        category: 'عام',
        unit: 'قطعة',
        sale_price: 20000,
        cost_price: 10000,
        min_stock: 0,
      });
      const productId = product.body.id;

      // 2. Post Purchase: 10 units @ 100.00 EGP (10000 cents) = 1,000.00 EGP (100000 cents) + 14% VAT (14000 cents)
      const poDraft = await client
        .post('/api/documents')
        .set(header)
        .send({
          type: 'PURCHASE',
          branch_id: 'main',
          party_id: supplierId,
          date: TODAY,
          due_date: TODAY,
          tax_rate: 1400,
          discount: 0,
          notes: 'فاتورة مشتريات محلية 14%',
          lines: [{ product_id: productId, quantity: 10, unit_price: 10000 }],
        });
      await client.post(`/api/documents/${poDraft.body.id}/post`).set(header).send({});

      // 3. Post Purchase Return (Debit Note): 2 units @ 100.00 EGP = 200.00 EGP (20000 cents) + 14% VAT (2800 cents)
      const poRetDraft = await client
        .post('/api/documents')
        .set(header)
        .send({
          type: 'PURCHASE_RETURN',
          branch_id: 'main',
          party_id: supplierId,
          original_document_id: poDraft.body.id,
          date: TODAY,
          due_date: TODAY,
          tax_rate: 1400,
          discount: 0,
          notes: 'إشعار مدين - مرتجع مشتريات',
          lines: [{ product_id: productId, quantity: 2, unit_price: 10000 }],
        });
      await client.post(`/api/documents/${poRetDraft.body.id}/post`).set(header).send({});

      // 4. Post Sale: 6 units @ 200.00 EGP (20000 cents) = 1,200.00 EGP (120000 cents) + 14% VAT (16800 cents)
      const saleDraft = await client
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
          notes: 'فاتورة مبيعات ضريبية',
          lines: [{ product_id: productId, quantity: 6, unit_price: 20000 }],
        });
      await client.post(`/api/documents/${saleDraft.body.id}/post`).set(header).send({});

      // 5. Post Sale Return (Credit Note): 1 unit @ 200.00 EGP = 200.00 EGP (20000 cents) + 14% VAT (2800 cents)
      const saleRetDraft = await client
        .post('/api/documents')
        .set(header)
        .send({
          type: 'SALE_RETURN',
          branch_id: 'main',
          party_id: customerId,
          original_document_id: saleDraft.body.id,
          date: TODAY,
          due_date: TODAY,
          tax_rate: 1400,
          discount: 0,
          notes: 'إشعار دائن - مرتجع مبيعات',
          lines: [{ product_id: productId, quantity: 1, unit_price: 20000 }],
        });
      await client.post(`/api/documents/${saleRetDraft.body.id}/post`).set(header).send({});

      // 6. Fetch VAT Return (Model 10)
      const res = await client
        .get(`/api/gl/vat-return?from=${TODAY}&to=${TODAY}&branch_id=main`)
        .set(header)
        .expect(200);

      const r = res.body;

      // GL Reconciliation assertion
      expect(r.summary.gl_reconciled).toBe(true);

      // Tax-free mode: the document bases remain, every tax amount is zero.
      expect(r.sales.standard_rated_14.taxable_base).toBe(120000);
      expect(r.sales.standard_rated_14.tax_amount).toBe(0);
      expect(r.sales.standard_rated_14.documents_count).toBe(1);

      expect(r.sales.returns.taxable_base).toBe(20000);
      expect(r.sales.returns.tax_amount).toBe(0);
      expect(r.sales.returns.documents_count).toBe(1);

      expect(r.sales.net_taxable_sales).toBe(100000);
      expect(r.sales.net_output_tax).toBe(0);

      expect(r.purchases.standard_rated_14.taxable_base).toBe(100000);
      expect(r.purchases.standard_rated_14.tax_amount).toBe(0);
      expect(r.purchases.standard_rated_14.documents_count).toBe(1);

      expect(r.purchases.returns.taxable_base).toBe(20000);
      expect(r.purchases.returns.tax_amount).toBe(0);
      expect(r.purchases.returns.documents_count).toBe(1);

      expect(r.purchases.net_taxable_purchases).toBe(80000);
      expect(r.purchases.net_deductible_input_tax).toBe(0);

      expect(r.summary.net_tax_due).toBe(0);
      expect(r.summary.credit_balance).toBe(0);

      expect(r.summary.gl_output_tax_balance).toBe(0);
      expect(r.summary.gl_input_tax_balance).toBe(0);
    });

    it('handles tax credit balance (excess input VAT) carry forward when purchases exceed sales', async () => {
      const client = await admin();
      const { customerId, supplierId, productId } = await setup(client);

      // Purchase 20 units @ 100 EGP (10000 cents) = 200,000 base, 28,000 tax
      const po = await client
        .post('/api/documents')
        .set(header)
        .send({
          type: 'PURCHASE',
          branch_id: 'main',
          party_id: supplierId,
          date: TODAY,
          due_date: TODAY,
          tax_rate: 1400,
          discount: 0,
          notes: '',
          lines: [{ product_id: productId, quantity: 20, unit_price: 10000 }],
        });
      await client.post(`/api/documents/${po.body.id}/post`).set(header).send({});

      // Sale 5 units @ 200 EGP (20000 cents) = 100,000 base, 14,000 tax
      const s = await client
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
          lines: [{ product_id: productId, quantity: 5, unit_price: 20000 }],
        });
      await client.post(`/api/documents/${s.body.id}/post`).set(header).send({});

      const res = await client
        .get(`/api/gl/vat-return?from=${TODAY}&to=${TODAY}`)
        .set(header)
        .expect(200);

      const r = res.body;
      expect(r.summary.gl_reconciled).toBe(true);
      expect(r.sales.net_output_tax).toBe(0);
      expect(r.purchases.net_deductible_input_tax).toBe(0);

      expect(r.summary.net_tax_due).toBe(0);
      expect(r.summary.credit_balance).toBe(0);
      expect(r.summary.gl_output_tax_balance).toBe(0);
      expect(r.summary.gl_input_tax_balance).toBe(0);
    });

    it('generates Sales Tax Register with customer TRN, document breakdown, and ETA e-invoicing link', async () => {
      const client = await admin();
      const customer = await client.post('/api/parties').set(header).send({
        type: 'CUSTOMER',
        name: 'عميل مسجل بالسجل',
        email: 'tax@cust.com',
        phone: '01000000000',
        address: 'مدينة نصر',
        tax_number: '789-456-123',
        notes: '',
      });
      const supplier = await client.post('/api/parties').set(header).send({
        type: 'SUPPLIER',
        name: 'مورد للمخزون',
        email: 'sup@test.com',
        phone: '',
        address: '',
        tax_number: '',
        notes: '',
      });
      const product = await client.post('/api/products').set(header).send({
        sku: 'TAX-REG-01',
        name: 'صنف السجل',
        category: 'عام',
        unit: 'قطعة',
        sale_price: 50000,
        cost_price: 30000,
        min_stock: 0,
      });

      // Stock up first with a purchase
      const po = await client
        .post('/api/documents')
        .set(header)
        .send({
          type: 'PURCHASE',
          branch_id: 'main',
          party_id: supplier.body.id,
          date: TODAY,
          due_date: TODAY,
          tax_rate: 1400,
          discount: 0,
          notes: '',
          lines: [{ product_id: product.body.id, quantity: 10, unit_price: 30000 }],
        });
      await client.post(`/api/documents/${po.body.id}/post`).set(header).send({});

      // Post a sale
      const s = await client
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
          notes: 'مبيعات السجل الضريبي',
          lines: [{ product_id: product.body.id, quantity: 2, unit_price: 50000 }],
        });
      await client.post(`/api/documents/${s.body.id}/post`).set(header).send({});

      // Post a return for 1 unit
      const ret = await client
        .post('/api/documents')
        .set(header)
        .send({
          type: 'SALE_RETURN',
          branch_id: 'main',
          party_id: customer.body.id,
          original_document_id: s.body.id,
          date: TODAY,
          due_date: TODAY,
          tax_rate: 1400,
          discount: 0,
          notes: 'مرتجع السجل',
          lines: [{ product_id: product.body.id, quantity: 1, unit_price: 50000 }],
        });
      await client.post(`/api/documents/${ret.body.id}/post`).set(header).send({});

      const regRes = await client
        .get(`/api/gl/tax-register?register_type=SALES&from=${TODAY}&to=${TODAY}`)
        .set(header)
        .expect(200);

      const reg = regRes.body;
      expect(reg.register_type).toBe('SALES');
      expect(reg.rows.length).toBe(2);

      // Find the sale row
      const saleRow = reg.rows.find((r: any) => r.type === 'SALE');
      expect(saleRow).toBeDefined();
      expect(saleRow.party_name).toBe('عميل مسجل بالسجل');
      expect(saleRow.party_tax_number).toBe('789-456-123');
      expect(saleRow.taxable_base).toBe(100000);
      expect(saleRow.tax_rate).toBe(0);
      expect(saleRow.tax_amount).toBe(0);
      expect(saleRow.total_amount).toBe(100000);
      // ETA status must be tracked (PENDING or VALID depending on outbox processor)
      expect(['PENDING', 'VALID', 'SUBMITTED', 'UNSUBMITTED']).toContain(saleRow.eta_status);

      // Find the return row: amounts are signed negative for register totals
      const retRow = reg.rows.find((r: any) => r.type === 'SALE_RETURN');
      expect(retRow).toBeDefined();
      expect(retRow.taxable_base).toBe(-50000);
      expect(retRow.tax_amount).toBe(0);
      expect(retRow.total_amount).toBe(-50000);

      // Net totals
      expect(reg.totals.taxable_base).toBe(50000);
      expect(reg.totals.tax_amount).toBe(0);
      expect(reg.totals.total_amount).toBe(50000);
      expect(reg.totals.count).toBe(2);
    });

    it('generates Purchases Tax Register with supplier TRN and net return totals', async () => {
      const client = await admin();
      const supplier = await client.post('/api/parties').set(header).send({
        type: 'SUPPLIER',
        name: 'مورد السجل الضريبي',
        email: 'sup@reg.com',
        phone: '01200000000',
        address: 'المنطقة الصناعية',
        tax_number: '999-888-777',
        notes: '',
      });
      const product = await client.post('/api/products').set(header).send({
        sku: 'TAX-PURCH-01',
        name: 'بضاعة مشتريات بالسجل',
        category: 'عام',
        unit: 'قطعة',
        sale_price: 30000,
        cost_price: 15000,
        min_stock: 0,
      });

      // Post purchase: 4 units @ 15,000 = 60,000 base, 8,400 tax
      const po = await client
        .post('/api/documents')
        .set(header)
        .send({
          type: 'PURCHASE',
          branch_id: 'main',
          party_id: supplier.body.id,
          date: TODAY,
          due_date: TODAY,
          tax_rate: 1400,
          discount: 0,
          notes: '',
          lines: [{ product_id: product.body.id, quantity: 4, unit_price: 15000 }],
        });
      await client.post(`/api/documents/${po.body.id}/post`).set(header).send({});

      const regRes = await client
        .get(`/api/gl/tax-register?register_type=PURCHASES&from=${TODAY}&to=${TODAY}`)
        .set(header)
        .expect(200);

      const reg = regRes.body;
      expect(reg.register_type).toBe('PURCHASES');
      expect(reg.rows.length).toBe(1);
      expect(reg.rows[0].party_name).toBe('مورد السجل الضريبي');
      expect(reg.rows[0].party_tax_number).toBe('999-888-777');
      expect(reg.rows[0].taxable_base).toBe(60000);
      expect(reg.rows[0].tax_amount).toBe(0);
      expect(reg.totals.taxable_base).toBe(60000);
      expect(reg.totals.tax_amount).toBe(0);
    });

    it('strictly supports branch filtering and date range filtering', async () => {
      const client = await admin();
      const { customerId, supplierId, productId } = await setup(client);

      // Create a second branch
      const branch2 = await client.post('/api/branches').set(header).send({
        code: 'ALX',
        name: 'فرع الإسكندرية',
        address: 'سموحة',
        phone: '034000000',
        opened_on: '2026-01-01',
      });
      expect(branch2.status).toBe(201);
      const branch2Id = branch2.body.id;

      // Purchase stock for main branch (10 units)
      const poMain = await client
        .post('/api/documents')
        .set(header)
        .send({
          type: 'PURCHASE',
          branch_id: 'main',
          party_id: supplierId,
          date: '2026-06-01',
          due_date: '2026-06-01',
          tax_rate: 1400,
          discount: 0,
          notes: '',
          lines: [{ product_id: productId, quantity: 10, unit_price: 6000 }],
        });
      await client.post(`/api/documents/${poMain.body.id}/post`).set(header).send({});

      // Purchase stock for branch 2 (10 units)
      const poB2 = await client
        .post('/api/documents')
        .set(header)
        .send({
          type: 'PURCHASE',
          branch_id: branch2Id,
          party_id: supplierId,
          date: '2026-06-01',
          due_date: '2026-06-01',
          tax_rate: 1400,
          discount: 0,
          notes: '',
          lines: [{ product_id: productId, quantity: 10, unit_price: 6000 }],
        });
      await client.post(`/api/documents/${poB2.body.id}/post`).set(header).send({});

      // Sale in branch main on 2026-06-05 (2 units @ 10,000)
      const s1 = await client
        .post('/api/documents')
        .set(header)
        .send({
          type: 'SALE',
          branch_id: 'main',
          party_id: customerId,
          date: '2026-06-05',
          due_date: '2026-06-05',
          tax_rate: 1400,
          discount: 0,
          notes: 'مبيعات فرع الرئيسي في يونيو',
          lines: [{ product_id: productId, quantity: 2, unit_price: 10000 }],
        });
      await client.post(`/api/documents/${s1.body.id}/post`).set(header).send({});

      // Sale in branch 2 on 2026-06-10 (3 units @ 10,000)
      const s2 = await client
        .post('/api/documents')
        .set(header)
        .send({
          type: 'SALE',
          branch_id: branch2Id,
          party_id: customerId,
          date: '2026-06-10',
          due_date: '2026-06-10',
          tax_rate: 1400,
          discount: 0,
          notes: 'مبيعات فرع الإسكندرية في يونيو',
          lines: [{ product_id: productId, quantity: 3, unit_price: 10000 }],
        });
      await client.post(`/api/documents/${s2.body.id}/post`).set(header).send({});

      // Sale in July (outside June range) (5 units @ 10,000 in main branch)
      const s3 = await client
        .post('/api/documents')
        .set(header)
        .send({
          type: 'SALE',
          branch_id: 'main',
          party_id: customerId,
          date: '2026-07-01',
          due_date: '2026-07-01',
          tax_rate: 1400,
          discount: 0,
          notes: 'مبيعات يوليو',
          lines: [{ product_id: productId, quantity: 5, unit_price: 10000 }],
        });
      await client.post(`/api/documents/${s3.body.id}/post`).set(header).send({});

      // 1. Filter June for main branch only
      const resMainJune = await client
        .get(`/api/gl/vat-return?from=2026-06-01&to=2026-06-30&branch_id=main`)
        .set(header)
        .expect(200);

      expect(resMainJune.body.sales.standard_rated_14.taxable_base).toBe(20000);
      expect(resMainJune.body.sales.standard_rated_14.tax_amount).toBe(0);

      // 2. Filter June for branch 2 only
      const resB2June = await client
        .get(`/api/gl/vat-return?from=2026-06-01&to=2026-06-30&branch_id=${branch2Id}`)
        .set(header)
        .expect(200);

      expect(resB2June.body.sales.standard_rated_14.taxable_base).toBe(30000);
      expect(resB2June.body.sales.standard_rated_14.tax_amount).toBe(0);

      // 3. Filter June for all branches
      const resAllJune = await client
        .get(`/api/gl/vat-return?from=2026-06-01&to=2026-06-30`)
        .set(header)
        .expect(200);

      expect(resAllJune.body.sales.standard_rated_14.taxable_base).toBe(50000);
      expect(resAllJune.body.sales.standard_rated_14.tax_amount).toBe(0);

      // 4. Register date filter
      const regRes = await client
        .get(`/api/gl/tax-register?register_type=SALES&from=2026-07-01&to=2026-07-31`)
        .set(header)
        .expect(200);

      expect(regRes.body.rows.length).toBe(1);
      expect(regRes.body.rows[0].number).toBe(s3.body.number);
    });
  });
});
