/**
 * Phase 3 — one-time historical recalculation for tax-free mode.
 *
 * The reset is deliberately written against legacy rows inserted directly in SQL, because the
 * service layer refuses to persist tax from now on. The tests cover the risky parts:
 *  - document totals drop to `subtotal - discount`, and overpayments become party credits;
 *  - old ledger entries are reversed and reposted without VAT, even inside a closed period;
 *  - confirmed payroll runs lose insurance/tax deductions and their ledger is reposted;
 *  - purchase orders, quotations, the company profile, and ETA state are cleaned up;
 *  - a second run is a no-op (idempotent).
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { seedUsers, signIn, resetBusinessData, header } from './helpers';
import { all, one, run } from '../server/db';
import { runTaxFreeReset } from '../server/tax_free_reset';
import { postDocumentLedger } from '../server/posting';
import { postPayrollRunLedger } from '../server/payroll';
import { TAX_FREE_MIGRATION } from '../src/config';
import type { Actor } from '../server/scope';
import type { Document, DocLine, PayrollRun } from '../src/types';

beforeAll(seedUsers);
beforeEach(() => {
  resetBusinessData();
  run('DELETE FROM data_migrations WHERE name=?', TAX_FREE_MIGRATION);
});

const NOW = '2026-10-25T09:00:00.000Z';

function actor(): Actor {
  const user = one<{ id: string; name: string }>("SELECT id, name FROM users WHERE id='admin'")!;
  return { id: user.id, name: user.name, role: 'ADMIN' };
}

function balanceOf(systemKey: string): number {
  return (
    one<{ balance: number }>(
      `SELECT COALESCE(SUM(l.debit-l.credit),0) AS balance
       FROM journal_lines l
       JOIN journal_entries e ON e.id=l.entry_id
       JOIN chart_of_accounts a ON a.id=l.account_id
       WHERE a.system_key=? AND e.status IN ('POSTED','REVERSED')`,
      systemKey,
    )?.balance ?? 0
  );
}

function entriesFor(sourceId: string) {
  return all<{ id: string; status: string; source_type: string }>(
    `SELECT id, status, source_type FROM journal_entries
     WHERE source_id=? ORDER BY created_at ASC`,
    sourceId,
  );
}

function seedParty(id: string, type: 'CUSTOMER' | 'SUPPLIER', name: string) {
  run(
    `INSERT INTO parties(id,type,name,email,phone,address,tax_number,notes,active,created_at)
     VALUES(?,?,?,'','','','','',1,?)`,
    id,
    type,
    name,
    NOW,
  );
}

function seedProduct(id: string, sku: string, name: string, cost = 60000, sale = 100000) {
  run(
    `INSERT INTO products(id,sku,name,category,unit,sale_price,cost_price,min_stock,active,created_at)
     VALUES(?,?,?,'عام','قطعة',?,?,0,1,?)`,
    id,
    sku,
    name,
    sale,
    cost,
    NOW,
  );
  run("INSERT INTO branch_stock(branch_id,product_id,quantity) VALUES('main',?,0)", id);
  run("INSERT INTO branch_products(branch_id,product_id,active) VALUES('main',?,1)", id);
}

interface LegacyLine {
  productId: string;
  quantity: number;
  unitPrice: number;
  costPrice: number;
  name?: string;
  sku?: string;
}

interface LegacyDocInput {
  id: string;
  number: string;
  type: Document['type'];
  partyId: string;
  subtotal: number;
  discount?: number;
  taxRate?: number;
  tax: number;
  paid?: number;
  status?: Document['status'];
  date?: string;
  etaStatus?: string;
  lines: LegacyLine[];
}

/** Inserts a legacy taxed document exactly as the pre-tax-free schema allowed. */
function insertLegacyDocument(input: LegacyDocInput): Document {
  const discount = input.discount ?? 0;
  const tax = input.tax;
  const total = input.subtotal - discount + tax;
  const paid = input.paid ?? 0;
  run(
    `INSERT INTO documents(
       id, number, type, status, branch_id, party_id, date, due_date, subtotal, discount,
       tax_rate, tax, total, paid, notes, created_by, created_at, eta_status
     ) VALUES(?,?,?,?,'main',?,?,?,?,?,?,?,?,?,'','admin',?,?)`,
    input.id,
    input.number,
    input.type,
    input.status ?? 'POSTED',
    input.partyId,
    input.date ?? '2026-06-01',
    input.date ?? '2026-06-01',
    input.subtotal,
    discount,
    input.taxRate ?? 1400,
    tax,
    total,
    paid,
    NOW,
    input.etaStatus ?? 'NOT_SUBMITTED',
  );
  for (const [index, line] of input.lines.entries()) {
    run(
      `INSERT INTO document_lines(
         id, document_id, product_id, name, sku, quantity, unit_price, cost_price, total
       ) VALUES(?,?,?,?,?,?,?,?,?)`,
      `${input.id}-line-${index}`,
      input.id,
      line.productId,
      line.name ?? 'منتج',
      line.sku ?? 'SKU',
      line.quantity,
      line.unitPrice,
      line.costPrice,
      line.quantity * line.unitPrice,
    );
  }
  return one<Document>('SELECT * FROM documents WHERE id=?', input.id)!;
}

function postLegacyLedger(doc: Document, partyName: string) {
  const lines = all<DocLine>('SELECT * FROM document_lines WHERE document_id=?', doc.id);
  postDocumentLedger({ ...doc, party_name: partyName, lines }, actor());
}

function insertEmployee(id = 'emp-1', code = 'EMP-001', branchId = 'main') {
  run(
    `INSERT INTO employees(id,code,name,job_title,branch_id,basic_salary,hire_date,created_at)
     VALUES(?,?,?,'محاسب',?,1000000,'2024-01-01',?)`,
    id,
    code,
    `موظف ${code}`,
    branchId,
    NOW,
  );
}

describe('tax-free historical reset', () => {
  it('revalues a taxed sale, turns the overpayment into a customer credit, and reposts the ledger', async () => {
    seedParty('cust-1', 'CUSTOMER', 'عميل قديم');
    seedProduct('prod-1', 'P-1', 'منتج قديم');
    const doc = insertLegacyDocument({
      id: 'doc-sale-1',
      number: 'INV-2026-0001',
      type: 'SALE',
      partyId: 'cust-1',
      subtotal: 100000,
      tax: 14000,
      paid: 114000,
      lines: [{ productId: 'prod-1', quantity: 1, unitPrice: 100000, costPrice: 60000 }],
    });
    postLegacyLedger(doc, 'عميل قديم');
    expect(balanceOf('AR')).toBe(114000);
    expect(balanceOf('VAT_OUTPUT')).toBe(-14000);

    // A closed period must not block the recalculation; the lock is restored afterwards.
    run("UPDATE gl_settings SET closed_through='2026-12-31' WHERE id=1");

    const report = runTaxFreeReset();
    expect(report.skipped).toBe(false);
    expect(report.documents).toBe(1);
    expect(report.credits).toBe(1);
    expect(report.errors).toEqual([]);

    const updated = one<Document>('SELECT * FROM documents WHERE id=?', 'doc-sale-1')!;
    expect(updated.tax_rate).toBe(0);
    expect(updated.tax).toBe(0);
    expect(updated.total).toBe(100000);
    expect(updated.paid).toBe(100000);

    const credit = one<{
      amount: number;
      remaining: number;
      direction: string;
      status: string;
    }>(
      'SELECT amount, remaining, direction, status FROM party_credits WHERE source_document_id=?',
      'doc-sale-1',
    )!;
    expect(credit).toMatchObject({
      amount: 14000,
      remaining: 14000,
      direction: 'CREDIT',
      status: 'OPEN',
    });

    // Old sale entry reversed, reversal + new tax-free entry posted.
    const entries = entriesFor('doc-sale-1');
    expect(entries.filter((e) => e.source_type === 'SALE' && e.status === 'REVERSED')).toHaveLength(
      1,
    );
    expect(entries.filter((e) => e.source_type === 'SALE' && e.status === 'POSTED')).toHaveLength(
      1,
    );
    expect(entries.filter((e) => e.source_type === 'REVERSAL')).toHaveLength(1);

    expect(balanceOf('AR')).toBe(100000);
    expect(balanceOf('SALES')).toBe(-100000);
    expect(balanceOf('VAT_OUTPUT')).toBe(0);
    expect(balanceOf('COGS')).toBe(60000);
    expect(balanceOf('INVENTORY')).toBe(-60000);

    expect(
      one<{ closed_through: string | null }>('SELECT closed_through FROM gl_settings WHERE id=1')
        ?.closed_through,
    ).toBe('2026-12-31');

    // The customer's balance becomes a 140.00 EGP credit rather than a phantom receivable.
    const client = await signIn('admin@test.local');
    const parties = await client.get('/api/parties?type=CUSTOMER').set(header).expect(200);
    const customer = parties.body.find((p: { id: string }) => p.id === 'cust-1');
    expect(customer.balance).toBe(-14000);
  });

  it('turns a supplier overpayment into a debit credit and removes input VAT', () => {
    seedParty('sup-1', 'SUPPLIER', 'مورد قديم');
    seedProduct('prod-2', 'P-2', 'منتج مورد', 50000, 70000);
    const doc = insertLegacyDocument({
      id: 'doc-po-1',
      number: 'PUR-2026-0001',
      type: 'PURCHASE',
      partyId: 'sup-1',
      subtotal: 50000,
      tax: 7000,
      paid: 57000,
      lines: [{ productId: 'prod-2', quantity: 1, unitPrice: 50000, costPrice: 50000 }],
    });
    postLegacyLedger(doc, 'مورد قديم');
    expect(balanceOf('VAT_INPUT')).toBe(7000);
    expect(balanceOf('AP')).toBe(-57000);

    const report = runTaxFreeReset();
    expect(report.documents).toBe(1);
    expect(report.credits).toBe(1);

    const credit = one<{ amount: number; direction: string }>(
      'SELECT amount, direction FROM party_credits WHERE source_document_id=?',
      'doc-po-1',
    )!;
    // A purchase overpayment reduces the supplier payable, so the credit is CREDIT.
    expect(credit).toEqual({ amount: 7000, direction: 'CREDIT' });

    expect(one<Document>('SELECT * FROM documents WHERE id=?', 'doc-po-1')).toMatchObject({
      tax: 0,
      total: 50000,
      paid: 50000,
    });
    expect(balanceOf('AP')).toBe(-50000);
    expect(balanceOf('INVENTORY')).toBe(50000);
    expect(balanceOf('VAT_INPUT')).toBe(0);
  });

  it('revalues drafts without inventing ledger entries and ignores already tax-free documents', () => {
    seedParty('cust-1', 'CUSTOMER', 'عميل قديم');
    seedProduct('prod-1', 'P-1', 'منتج قديم');
    insertLegacyDocument({
      id: 'doc-draft',
      number: 'INV-2026-0002',
      type: 'SALE',
      partyId: 'cust-1',
      subtotal: 200000,
      tax: 28000,
      status: 'DRAFT',
      lines: [{ productId: 'prod-1', quantity: 2, unitPrice: 100000, costPrice: 60000 }],
    });
    // A document that was already created tax-free must not be counted or touched.
    insertLegacyDocument({
      id: 'doc-clean',
      number: 'INV-2026-0003',
      type: 'SALE',
      partyId: 'cust-1',
      subtotal: 50000,
      taxRate: 0,
      tax: 0,
      paid: 50000,
      lines: [{ productId: 'prod-1', quantity: 1, unitPrice: 50000, costPrice: 30000 }],
    });

    const report = runTaxFreeReset();
    expect(report.documents).toBe(1);
    expect(report.credits).toBe(0);
    expect(entriesFor('doc-draft')).toHaveLength(0);
    expect(one<Document>('SELECT * FROM documents WHERE id=?', 'doc-draft')).toMatchObject({
      tax: 0,
      total: 200000,
      status: 'DRAFT',
    });
    expect(one<Document>('SELECT * FROM documents WHERE id=?', 'doc-clean')).toMatchObject({
      tax_rate: 0,
      tax: 0,
      total: 50000,
    });
  });

  it('zeroes payroll deductions, recalculates net pay, and reposts confirmed runs', () => {
    insertEmployee();
    run(
      `INSERT INTO payroll_runs(
         id, month, branch_id, status, total_basic, total_variable, total_gross,
         total_social_insurance_employee, total_social_insurance_employer,
         total_income_tax, total_martyrs_fund, total_advances, total_net, created_by, created_at
       ) VALUES('pr-1','2026-09','main','CONFIRMED',1000000,0,1000000,110000,187500,50000,600,100000,739400,'admin',?)`,
      NOW,
    );
    run(
      `INSERT INTO payroll_slips(
         id, payroll_run_id, employee_id, basic_salary, variable_salary, gross_salary,
         social_insurance_employee, social_insurance_employer, income_tax, martyrs_fund,
         advances_deduction, other_deductions, net_salary
       ) VALUES('slip-1','pr-1','emp-1',1000000,0,1000000,110000,187500,50000,600,100000,0,739400)`,
    );

    const legacyRun = one<PayrollRun>('SELECT * FROM payroll_runs WHERE id=?', 'pr-1')!;
    const legacyEntry = postPayrollRunLedger(legacyRun, actor())!;
    run('UPDATE payroll_runs SET journal_entry_id=? WHERE id=?', legacyEntry.id, 'pr-1');
    expect(balanceOf('SALARIES_EXPENSE')).toBe(839400);

    const report = runTaxFreeReset();
    expect(report.payrollRuns).toBe(1);
    expect(report.errors).toEqual([]);

    expect(one<PayrollRun>('SELECT * FROM payroll_runs WHERE id=?', 'pr-1')).toMatchObject({
      status: 'CONFIRMED',
      total_social_insurance_employee: 0,
      total_social_insurance_employer: 0,
      total_income_tax: 0,
      total_martyrs_fund: 0,
      total_net: 900000,
    });
    expect(
      one<{
        social_insurance_employee: number;
        social_insurance_employer: number;
        income_tax: number;
        martyrs_fund: number;
        net_salary: number;
      }>('SELECT * FROM payroll_slips WHERE id=?', 'slip-1'),
    ).toMatchObject({
      social_insurance_employee: 0,
      social_insurance_employer: 0,
      income_tax: 0,
      martyrs_fund: 0,
      net_salary: 900000,
    });

    const oldEntry = one<{ status: string }>(
      'SELECT status FROM journal_entries WHERE id=?',
      legacyEntry.id,
    )!;
    expect(oldEntry.status).toBe('REVERSED');
    const runEntry = one<{ id: string; status: string }>(
      "SELECT id, status FROM journal_entries WHERE source_type='MANUAL' AND source_id='pr-1' AND status='POSTED'",
    )!;
    expect(runEntry).toBeTruthy();
    expect(
      one<{ journal_entry_id: string }>(
        'SELECT journal_entry_id FROM payroll_runs WHERE id=?',
        'pr-1',
      )?.journal_entry_id,
    ).toBe(runEntry.id);

    expect(balanceOf('SALARIES_EXPENSE')).toBe(1000000);
    expect(balanceOf('EMP_ADVANCES')).toBe(-100000);
    expect(balanceOf('SALARIES_PAYABLE')).toBe(-900000);
  });

  it('resets purchase orders, quotations, the company profile, and cancels ETA state', () => {
    seedParty('sup-1', 'SUPPLIER', 'مورد قديم');
    seedProduct('prod-1', 'P-1', 'منتج قديم');
    run(
      `INSERT INTO purchase_orders(
         id, number, branch_id, party_id, status, date, subtotal, tax_rate, tax, total, created_by, created_at
       ) VALUES('po-1','PO-2026-0001','main','sup-1','DRAFT','2026-06-01',100000,1400,14000,114000,'admin',?)`,
      NOW,
    );
    run(
      `INSERT INTO purchase_order_lines(
         id, order_id, product_id, quantity, unit_price, tax_rate, line_total
       ) VALUES('pol-1','po-1','prod-1',1,100000,1400,100000)`,
    );
    run(
      `INSERT INTO quotations(
         id, number, type, branch_id, party_id, date, status, subtotal, discount, tax_rate,
         tax, total, created_by, created_at, updated_at
       ) VALUES('quo-1','QUO-2026-0001','QUOTATION','main','sup-1','2026-06-01','DRAFT',
                100000,5000,1400,13300,108300,'admin',?,?)`,
      NOW,
      NOW,
    );
    run(
      `INSERT INTO quotation_lines(id, quotation_id, product_id, quantity, unit_price, total)
       VALUES('ql-1','quo-1','prod-1',1,100000,100000)`,
    );
    run(
      `UPDATE company SET tax_rate=1400, tax_number='123', tax_registration_number='456',
         activity_code='789', eta_environment='production' WHERE id=1`,
    );

    const etaDoc = insertLegacyDocument({
      id: 'doc-eta',
      number: 'INV-2026-0004',
      type: 'SALE',
      partyId: 'sup-1',
      subtotal: 10000,
      tax: 1400,
      etaStatus: 'PENDING',
      lines: [{ productId: 'prod-1', quantity: 1, unitPrice: 10000, costPrice: 5000 }],
    });
    expect(etaDoc.eta_status).toBe('PENDING');
    insertLegacyDocument({
      id: 'doc-valid',
      number: 'INV-2026-0005',
      type: 'SALE',
      partyId: 'sup-1',
      subtotal: 10000,
      taxRate: 0,
      tax: 0,
      etaStatus: 'VALID',
      lines: [{ productId: 'prod-1', quantity: 1, unitPrice: 10000, costPrice: 5000 }],
    });
    for (const [id, status] of [
      ['eta-pending', 'PENDING'],
      ['eta-submitted', 'SUBMITTED'],
      ['eta-failed', 'FAILED'],
      ['eta-valid', 'VALID'],
    ] as const) {
      run(
        `INSERT INTO e_invoice_submissions(
           id, document_id, uuid, document_type, status, attempt, max_attempts,
           next_attempt_at, created_by, created_at, updated_at
         ) VALUES(?, 'doc-eta', ?, 'INVOICE', ?, 0, 5, ?, 'admin', ?, ?)`,
        id,
        `uuid-${id}`,
        status,
        NOW,
        NOW,
        NOW,
      );
    }

    const report = runTaxFreeReset();
    expect(report.purchaseOrders).toBe(1);
    expect(report.quotations).toBe(1);
    expect(report.etaCancelled).toBe(3);

    expect(one('SELECT * FROM purchase_orders WHERE id=?', 'po-1')).toMatchObject({
      tax_rate: 0,
      tax: 0,
      total: 100000,
    });
    expect(one('SELECT * FROM purchase_order_lines WHERE id=?', 'pol-1')).toMatchObject({
      tax_rate: 0,
    });
    expect(one('SELECT * FROM quotations WHERE id=?', 'quo-1')).toMatchObject({
      tax_rate: 0,
      tax: 0,
      total: 95000,
    });
    expect(one('SELECT * FROM company WHERE id=1')).toMatchObject({
      tax_rate: 0,
      tax_number: '',
      tax_registration_number: '',
      activity_code: '',
      eta_environment: 'stub',
    });

    const submissions = all<{ id: string; status: string }>(
      'SELECT id, status FROM e_invoice_submissions ORDER BY id',
    );
    expect(submissions).toEqual([
      { id: 'eta-failed', status: 'CANCELLED' },
      { id: 'eta-pending', status: 'CANCELLED' },
      { id: 'eta-submitted', status: 'CANCELLED' },
      { id: 'eta-valid', status: 'VALID' },
    ]);
    expect(
      one<{ eta_status: string }>('SELECT eta_status FROM documents WHERE id=?', 'doc-eta')
        ?.eta_status,
    ).toBe('CANCELLED');
    expect(
      one<{ eta_status: string }>('SELECT eta_status FROM documents WHERE id=?', 'doc-valid')
        ?.eta_status,
    ).toBe('VALID');
  });

  it('is idempotent: the second run is skipped and creates no duplicate credits or entries', () => {
    seedParty('cust-1', 'CUSTOMER', 'عميل قديم');
    seedProduct('prod-1', 'P-1', 'منتج قديم');
    const doc = insertLegacyDocument({
      id: 'doc-sale-1',
      number: 'INV-2026-0001',
      type: 'SALE',
      partyId: 'cust-1',
      subtotal: 100000,
      tax: 14000,
      paid: 114000,
      lines: [{ productId: 'prod-1', quantity: 1, unitPrice: 100000, costPrice: 60000 }],
    });
    postLegacyLedger(doc, 'عميل قديم');

    const first = runTaxFreeReset();
    expect(first.skipped).toBe(false);
    const counts = {
      credits: one<{ n: number }>('SELECT COUNT(*) n FROM party_credits')!.n,
      entries: one<{ n: number }>('SELECT COUNT(*) n FROM journal_entries')!.n,
    };
    expect(counts.credits).toBe(1);

    const second = runTaxFreeReset();
    expect(second.skipped).toBe(true);
    expect(second.documents).toBe(0);
    expect(second.credits).toBe(0);
    expect(one<{ n: number }>('SELECT COUNT(*) n FROM party_credits')!.n).toBe(counts.credits);
    expect(one<{ n: number }>('SELECT COUNT(*) n FROM journal_entries')!.n).toBe(counts.entries);
  });
});
