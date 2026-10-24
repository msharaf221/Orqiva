import { describe, expect, it, beforeEach } from 'vitest';
import { header, seedUsers, signIn, resetBusinessData } from './helpers';
import { one, run } from '../server/db';
import { hash } from 'bcryptjs';

describe('Odoo-like Fast POS Interface & Shifts', () => {
  let cashier: Awaited<ReturnType<typeof signIn>>;

  beforeEach(async () => {
    resetBusinessData();
    run('DELETE FROM user_branches');
    run('DELETE FROM users');
    await seedUsers();

    // Create a Cashier user
    const password = await hash('TestingPassword2026!', 4);
    run(
      'INSERT INTO users(id,name,email,password_hash,role,active,created_at) VALUES(?,?,?,?,?,?,?)',
      'cashier-1',
      'كاشير وردية',
      'cashier1@test.local',
      password,
      'CASHIER',
      1,
      new Date().toISOString(),
    );
    run("INSERT INTO user_branches(user_id,branch_id) VALUES('cashier-1','main')");

    // Create a test product with stock in HQ branch
    run(
      `INSERT INTO products(id,sku,name,category,unit,sale_price,cost_price,min_stock,active,created_at)
       VALUES('pos-p1','BAR-1001','شاي فاخر','مشروبات','علبة',2500,1800,2,1,?)`,
      new Date().toISOString(),
    );
    run(`INSERT INTO branch_stock(branch_id,product_id,quantity) VALUES('main','pos-p1',10)`);
    run(`INSERT INTO branch_products(branch_id,product_id,active) VALUES('main','pos-p1',1)`);

    cashier = await signIn('cashier1@test.local');
  });

  it('manages POS shift lifecycle: open shift, cash in/out, summary, and close shift', async () => {
    // 1. Initial check: no open shift
    const currentBefore = await cashier
      .get('/api/pos/shifts/current?branch_id=main')
      .set(header)
      .expect(200);
    expect(currentBefore.body).toBeNull();

    // 2. Open a shift with 200 EGP (20,000 piasters) opening cash
    const openRes = await cashier
      .post('/api/pos/shifts/open')
      .set(header)
      .send({
        branch_id: 'main',
        opening_cash: 20000,
        notes: 'افتتاح وردية الصباح',
      })
      .expect(201);

    expect(openRes.body.number).toMatch(/^SH-HQ-/);
    expect(openRes.body.status).toBe('OPEN');
    expect(openRes.body.opening_cash).toBe(20000);
    const shiftId = openRes.body.id;

    // 3. Current shift now returns the active shift
    const currentAfter = await cashier
      .get('/api/pos/shifts/current?branch_id=main')
      .set(header)
      .expect(200);
    expect(currentAfter.body.id).toBe(shiftId);

    // 4. Record cash in (e.g. +50 EGP petty cash addition)
    const inRes = await cashier
      .post(`/api/pos/shifts/${shiftId}/cash-movement`)
      .set(header)
      .send({
        type: 'IN',
        amount: 5000,
        reason: 'فكة إضافية في الدرج',
      })
      .expect(201);
    expect(inRes.body.amount).toBe(5000);

    // 5. Record cash out (e.g. -20 EGP emergency expense from drawer)
    const outRes = await cashier
      .post(`/api/pos/shifts/${shiftId}/cash-movement`)
      .set(header)
      .send({
        type: 'OUT',
        amount: 2000,
        reason: 'ضيافة عميل',
      })
      .expect(201);
    expect(outRes.body.amount).toBe(2000);

    // 6. Check shift summary
    const summaryRes = await cashier
      .get(`/api/pos/shifts/${shiftId}/summary`)
      .set(header)
      .expect(200);

    expect(summaryRes.body.opening_cash).toBe(20000);
    expect(summaryRes.body.cash_in).toBe(5000);
    expect(summaryRes.body.cash_out).toBe(2000);
    // Expected cash: 20000 + 5000 - 2000 = 23000
    expect(summaryRes.body.expected_cash).toBe(23000);

    // 7. Close shift with counted cash = 23000 (0 difference)
    const closeRes = await cashier
      .post(`/api/pos/shifts/${shiftId}/close`)
      .set(header)
      .send({
        closing_cash: 23000,
        notes: 'إغلاق الوردية ومطابقة تامة',
      })
      .expect(200);

    expect(closeRes.body.status).toBe('CLOSED');
    expect(closeRes.body.closing_cash).toBe(23000);
    expect(closeRes.body.difference).toBe(0);
  });

  it('executes fast atomic POS checkout with cash payment and change calculation', async () => {
    // Open a shift first
    const shift = await cashier
      .post('/api/pos/shifts/open')
      .set(header)
      .send({
        branch_id: 'main',
        opening_cash: 10000,
      })
      .expect(201);

    // Fetch POS products for branch
    const prods = await cashier.get('/api/pos/products?branch_id=main').set(header).expect(200);
    expect(prods.body.length).toBeGreaterThan(0);
    const item = prods.body.find((p: any) => p.sku === 'BAR-1001');
    expect(item.stock).toBe(10);
    expect(item.sale_price).toBe(2500);

    // Perform POS sale checkout: 2 items @ 25.00 EGP = 50.00 EGP (tax-free)
    // Customer hands 100.00 EGP bill (10000 piasters)
    const checkoutRes = await cashier
      .post('/api/pos/checkout')
      .set(header)
      .send({
        branch_id: 'main',
        shift_id: shift.body.id,
        party_id: 'walk-in-customer',
        date: '2026-03-01',
        discount: 0,
        lines: [{ product_id: 'pos-p1', quantity: 2, unit_price: 2500 }],
        payment: {
          method: 'CASH',
          amount_tendered: 10000,
          amount_paid: 5000,
        },
      })
      .expect(201);

    expect(checkoutRes.body.document.number).toMatch(/^INV-HQ-/);
    expect(checkoutRes.body.document.pos_shift_id).toBe(shift.body.id);
    expect(checkoutRes.body.document.total).toBe(5000);
    expect(checkoutRes.body.document.paid).toBe(5000);
    expect(checkoutRes.body.payment.change_due).toBe(5000); // 100.00 - 50.00 = 50.00 EGP

    // Verify stock decreased from 10 to 8
    const stockAfter = one<{ quantity: number }>(
      "SELECT quantity FROM branch_stock WHERE branch_id='main' AND product_id='pos-p1'",
    );
    expect(stockAfter?.quantity).toBe(8);

    // Shift summary reflects cash sales
    const summary = await cashier
      .get(`/api/pos/shifts/${shift.body.id}/summary`)
      .set(header)
      .expect(200);
    expect(summary.body.cash_sales).toBe(5000);
    expect(summary.body.expected_cash).toBe(10000 + 5000); // opening + sales
  });

  it('strictly prevents negative stock in POS checkout', async () => {
    // Available stock is 10. Attempting to sell 15 must fail with 409
    await cashier
      .post('/api/pos/shifts/open')
      .set(header)
      .send({
        branch_id: 'main',
        opening_cash: 5000,
      })
      .expect(201);

    const failRes = await cashier
      .post('/api/pos/checkout')
      .set(header)
      .send({
        branch_id: 'main',
        date: '2026-03-01',
        lines: [{ product_id: 'pos-p1', quantity: 15, unit_price: 2500 }],
        payment: {
          method: 'CASH',
          amount_tendered: 40000,
          amount_paid: 40000,
        },
      })
      .expect(409);

    expect(failRes.body.error).toContain('المخزون غير كافٍ');

    // Stock remains untouched at 10
    const stock = one<{ quantity: number }>(
      "SELECT quantity FROM branch_stock WHERE branch_id='main' AND product_id='pos-p1'",
    );
    expect(stock?.quantity).toBe(10);
  });

  it('implements Odoo-like Cashier Handover to Treasury Accountant with auto journal entry for shortage', async () => {
    // 1. Create a Treasury Accountant user
    const password = await hash('TestingPassword2026!', 4);
    run(
      'INSERT INTO users(id,name,email,password_hash,role,active,created_at) VALUES(?,?,?,?,?,?,?)',
      'treasury-1',
      'محاسب الخزنة',
      'treasury1@test.local',
      password,
      'TREASURY_ACCOUNTANT',
      1,
      new Date().toISOString(),
    );
    run("INSERT INTO user_branches(user_id,branch_id) VALUES('treasury-1','main')");

    const treasury = await signIn('treasury1@test.local');

    // 2. Cashier opens a shift with 100.00 EGP (10,000 piasters)
    const openRes = await cashier
      .post('/api/pos/shifts/open')
      .set(header)
      .send({
        branch_id: 'main',
        opening_cash: 10000,
        notes: 'وردية الكاشير الصباحية',
      })
      .expect(201);
    const shiftId = openRes.body.id;

    // 3. Cashier sells 2 items @ 25.00 EGP = 50.00 EGP tax-free (5000 piasters cash)
    await cashier
      .post('/api/pos/checkout')
      .set(header)
      .send({
        branch_id: 'main',
        shift_id: shiftId,
        date: '2026-03-01',
        lines: [{ product_id: 'pos-p1', quantity: 2, unit_price: 2500 }],
        payment: {
          method: 'CASH',
          amount_tendered: 5000,
          amount_paid: 5000,
        },
      })
      .expect(201);

    // Expected Cash = 10,000 + 5,000 = 15,000 piasters

    // 4. Cashier submits shift handover to Treasury with declared cash = 14,000 piasters (counted in drawer)
    const submitRes = await cashier
      .post(`/api/pos/shifts/${shiftId}/submit`)
      .set(header)
      .send({
        declared_cash: 14000,
        notes: 'تسليم الدرج لمسؤول الخزنة',
      })
      .expect(200);

    expect(submitRes.body.status).toBe('PENDING_REVIEW');
    expect(submitRes.body.cashier_declared_cash).toBe(14000);

    // Cashier cannot make new sales on this shift anymore
    const blockedSale = await cashier
      .post('/api/pos/checkout')
      .set(header)
      .send({
        branch_id: 'main',
        shift_id: shiftId,
        date: '2026-03-01',
        lines: [{ product_id: 'pos-p1', quantity: 1, unit_price: 2500 }],
        payment: { method: 'CASH', amount_tendered: 2500, amount_paid: 2500 },
      })
      .expect(409);
    expect(blockedSale.body.error).toContain('الوردية المحددة غير صالحة');

    // 5. Treasury Accountant lists pending shifts
    const pendingList = await treasury
      .get('/api/pos/shifts/pending-review?branch_id=main')
      .set(header)
      .expect(200);

    expect(pendingList.body.length).toBe(1);
    expect(pendingList.body[0].id).toBe(shiftId);

    // 6. Treasury Accountant reviews and approves shift with closing cash = 14,000 piasters (Shortage of 1,000 piasters = 10.00 EGP)
    const approveRes = await treasury
      .post(`/api/pos/shifts/${shiftId}/approve`)
      .set(header)
      .send({
        closing_cash: 14000,
        review_notes: 'تم استلام النقدية بالخزنة مع تسجيل قيد عجز بقيمة 10 جنيه',
      })
      .expect(200);

    expect(approveRes.body.status).toBe('CLOSED');
    expect(approveRes.body.difference).toBe(-1000);
    expect(approveRes.body.reviewed_by).toBe('treasury-1');
    expect(approveRes.body.discrepancy_expense_id).toBeTruthy();

    // 7. Verify the automatic journal entry created in `expenses`
    const expenseEntry = one<{ id: string; category: string; amount: number; title: string }>(
      'SELECT id, category, amount, title FROM expenses WHERE id=?',
      approveRes.body.discrepancy_expense_id,
    );
    expect(expenseEntry).toBeDefined();
    expect(expenseEntry?.category).toBe('عجز نقدية نقطة بيع');
    expect(expenseEntry?.amount).toBe(1000);
    expect(expenseEntry?.title).toContain('عجز نقدية وردية');
  });

  it('approves submitted shift using verified_cash payload alias', async () => {
    // 1. Open shift
    const openRes = await cashier
      .post('/api/pos/shifts/open')
      .set(header)
      .send({ branch_id: 'main', opening_cash: 5000 })
      .expect(201);

    const shiftId = openRes.body.id;

    // 2. Submit shift
    await cashier
      .post(`/api/pos/shifts/${shiftId}/submit`)
      .set(header)
      .send({ declared_cash: 5000 })
      .expect(200);

    // 3. Admin approves using verified_cash
    const admin = await signIn('admin@test.local');
    const approveRes = await admin
      .post(`/api/pos/shifts/${shiftId}/approve`)
      .set(header)
      .send({
        verified_cash: 5000,
        review_notes: 'مطابقة تامة باستخدام verified_cash',
      })
      .expect(200);

    expect(approveRes.body.status).toBe('CLOSED');
    expect(approveRes.body.closing_cash).toBe(5000);
    expect(approveRes.body.difference).toBe(0);
  });

  it('handles multi-tender reconciliation (Cash, Visa, InstaPay) with paper proofs and terminal settlement', async () => {
    // 1. Cashier opens shift with 50.00 EGP cash
    const openRes = await cashier
      .post('/api/pos/shifts/open')
      .set(header)
      .send({ branch_id: 'main', opening_cash: 5000 })
      .expect(201);
    const shiftId = openRes.body.id;

    // 2. Sale 1: Paid via VISA / CARD with POS Terminal Slip #
    // 1 item @ 2500 piasters (25.00 EGP), tax-free
    await cashier
      .post('/api/pos/checkout')
      .set(header)
      .send({
        branch_id: 'main',
        shift_id: shiftId,
        date: '2026-03-01',
        lines: [{ product_id: 'pos-p1', quantity: 1, unit_price: 2500 }],
        payment: {
          method: 'CARD',
          amount_tendered: 2500,
          amount_paid: 2500,
          reference: 'إيصال ماكينة بنك مصر #84920',
        },
      })
      .expect(201);

    // 3. Sale 2: Paid via INSTAPAY / BANK with reference
    // 1 item @ 2500 piasters (25.00 EGP), tax-free
    await cashier
      .post('/api/pos/checkout')
      .set(header)
      .send({
        branch_id: 'main',
        shift_id: shiftId,
        date: '2026-03-01',
        lines: [{ product_id: 'pos-p1', quantity: 1, unit_price: 2500 }],
        payment: {
          method: 'BANK',
          amount_tendered: 2500,
          amount_paid: 2500,
          reference: 'تحويل إنستاباي مرجع #IP-99281',
        },
      })
      .expect(201);

    // 4. Sale 3: Split payment (1000 Cash + 1500 Card)
    await cashier
      .post('/api/pos/checkout')
      .set(header)
      .send({
        branch_id: 'main',
        shift_id: shiftId,
        date: '2026-03-01',
        lines: [{ product_id: 'pos-p1', quantity: 1, unit_price: 2500 }],
        split_payments: [
          { method: 'CASH', amount: 1000, reference: 'نقداً مجزأ' },
          { method: 'CARD', amount: 1500, reference: 'فيزا مجزأ إيصال #84921' },
        ],
      })
      .expect(201);

    // 5. Verify shift summary aggregates all tenders accurately
    const summaryRes = await cashier
      .get(`/api/pos/shifts/${shiftId}/summary`)
      .set(header)
      .expect(200);

    const s = summaryRes.body;
    expect(s.opening_cash).toBe(5000);
    expect(s.cash_sales).toBe(1000); // 10.00 EGP
    expect(s.expected_cash).toBe(6000); // 5000 + 1000 = 6000
    expect(s.card_sales).toBe(2500 + 1500); // 4000 piasters (40.00 EGP)
    expect(s.expected_card).toBe(4000);
    expect(s.bank_sales).toBe(2500); // 25.00 EGP (InstaPay)
    expect(s.expected_bank).toBe(2500);
    expect(s.sales_count).toBe(3);
    expect(s.payments.length).toBe(4); // 1 card + 1 bank + 1 cash split + 1 card split

    // 6. Cashier submits shift handover declaring counted cash, terminal settlement, and InstaPay proof
    const submitRes = await cashier
      .post(`/api/pos/shifts/${shiftId}/submit`)
      .set(header)
      .send({
        declared_cash: 6000,
        declared_card: 4000,
        declared_bank: 2500,
        terminal_batch_number: 'BATCH-0042',
        card_slips_count: 2,
        bank_transfers_count: 1,
        safe_envelope_number: 'ENV-2026-88',
        proof_documents: 'إيصال تسوية ماكينة فيزا BATCH-0042 + إشعار تحويل إنستاباي 99281',
        notes: 'تسليم الوردية بكافة الإثباتات والورقيات',
      })
      .expect(200);

    expect(submitRes.body.status).toBe('PENDING_REVIEW');
    expect(submitRes.body.cashier_declared_cash).toBe(6000);
    expect(submitRes.body.cashier_declared_card).toBe(4000);
    expect(submitRes.body.cashier_declared_bank).toBe(2500);
    expect(submitRes.body.terminal_batch_number).toBe('BATCH-0042');
    expect(submitRes.body.card_slips_count).toBe(2);
    expect(submitRes.body.bank_transfers_count).toBe(1);
    expect(submitRes.body.safe_envelope_number).toBe('ENV-2026-88');

    // 7. Treasury Accountant reviews, verifies all proofs, and approves shift
    const admin = await signIn('admin@test.local');
    const approveRes = await admin
      .post(`/api/pos/shifts/${shiftId}/approve`)
      .set(header)
      .send({
        closing_cash: 6000,
        closing_card: 4000,
        closing_bank: 2500,
        review_notes: 'تم فحص إيصال تسوية الماكينة وإشعارات إنستاباي ومطابقة النقدية بالمظروف',
        verification_checklist: JSON.stringify({
          terminal_batch_verified: true,
          card_slips_counted: true,
          instapay_statement_verified: true,
          safe_envelope_received: true,
        }),
      })
      .expect(200);

    expect(approveRes.body.status).toBe('CLOSED');
    expect(approveRes.body.closing_cash).toBe(6000);
    expect(approveRes.body.closing_card).toBe(4000);
    expect(approveRes.body.closing_bank).toBe(2500);
    expect(approveRes.body.difference).toBe(0);
    expect(approveRes.body.card_difference).toBe(0);
    expect(approveRes.body.bank_difference).toBe(0);
  });
});
