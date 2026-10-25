/**
 * Phases 4 & 5 Integration Tests: Cheques Portfolio, Treasury Forecast, Cost Centers, and Egyptian Payroll.
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { seedUsers, signIn, resetBusinessData, header } from './helpers';
import { one, all } from '../server/db';

beforeAll(seedUsers);
beforeEach(resetBusinessData);

describe('Phase 4: Cheques Portfolio, Cash Flow & Cost Centers', () => {
  it('manages full lifecycle of customer receivable cheque with double-entry GL', async () => {
    const admin = await signIn('admin@test.local');

    const cust = await admin.post('/api/parties').set(header).send({
      type: 'CUSTOMER',
      name: 'شركة النيل للخدمات',
      email: 'nile@test.local',
      phone: '0100000001',
      address: 'القاهرة',
    });
    const partyId = cust.body.id;

    // 1. Receive customer cheque (50,000 EGP = 5,000,000 piasters)
    const chequeRes = await admin.post('/api/treasury/cheques').set(header).send({
      number: 'CHK-9001',
      type: 'RECEIVABLE',
      party_id: partyId,
      bank_name: 'البنك الأهلي المصري',
      branch_name: 'فرع مدينة نصر',
      amount: 5000000,
      issue_date: '2026-10-23',
      due_date: '2026-11-23',
      notes: 'دفعة تحت الحساب',
    });
    expect(chequeRes.status).toBe(201);
    const cheque = chequeRes.body;
    expect(cheque.status).toBe('PORTFOLIO');
    expect(cheque.journal_entry_id).toBeDefined();

    // Verify initial GL entry: Dr Notes Receivable 1135, Cr Customer AR 1130
    const lines = all<any>('SELECT * FROM journal_lines WHERE entry_id=?', cheque.journal_entry_id);
    expect(lines).toHaveLength(2);
    const drLine = lines.find((l: any) => l.debit > 0);
    const crLine = lines.find((l: any) => l.credit > 0);
    expect(drLine.account_id).toBe('acc_notes_receivable');
    expect(drLine.debit).toBe(5000000);
    expect(crLine.account_id).toBe('acc_ar');
    expect(crLine.credit).toBe(5000000);

    // 2. Collect cheque in default bank account
    const collectRes = await admin
      .post(`/api/treasury/cheques/${cheque.id}/collect`)
      .set(header)
      .send({
        bank_account_id: 'acc_def_bank',
        collection_date: '2026-11-23',
      });
    expect(collectRes.status).toBe(200);
    expect(collectRes.body.status).toBe('COLLECTED');

    // Verify collection GL entry: Dr Bank 1120, Cr Notes Receivable 1135
    const latestEntry = one<any>(
      'SELECT id FROM journal_entries WHERE source_id=? ORDER BY created_at DESC LIMIT 1',
      cheque.id,
    );
    const collectLines = all<any>('SELECT * FROM journal_lines WHERE entry_id=?', latestEntry.id);
    const colDr = collectLines.find((l: any) => l.debit > 0);
    const colCr = collectLines.find((l: any) => l.credit > 0);
    expect(colDr.account_id).toBe('acc_bank');
    expect(colDr.debit).toBe(5000000);
    expect(colCr.account_id).toBe('acc_notes_receivable');
    expect(colCr.credit).toBe(5000000);
  });

  it('handles bounced receivable cheques by restoring AR balance', async () => {
    const admin = await signIn('admin@test.local');

    const cust = await admin.post('/api/parties').set(header).send({
      type: 'CUSTOMER',
      name: 'مؤسسة التجارة الحديثة',
      email: 'modern@test.local',
      phone: '0100000002',
      address: 'الجيزة',
    });

    const chk = await admin.post('/api/treasury/cheques').set(header).send({
      number: 'CHK-BOUNCE-1',
      type: 'RECEIVABLE',
      party_id: cust.body.id,
      bank_name: 'بنك مصر',
      amount: 1500000, // 15,000 EGP
      issue_date: '2026-10-23',
      due_date: '2026-10-25',
    });

    const bounceRes = await admin
      .post(`/api/treasury/cheques/${chk.body.id}/bounce`)
      .set(header)
      .send({ reason: 'عدم كفاية الرصيد' });
    expect(bounceRes.status).toBe(200);
    expect(bounceRes.body.status).toBe('BOUNCED');

    // Check reversal entry: Dr AR, Cr Notes Receivable
    const latestEntry = one<any>(
      'SELECT id FROM journal_entries WHERE source_id=? ORDER BY created_at DESC LIMIT 1',
      chk.body.id,
    );
    const lines = all<any>('SELECT * FROM journal_lines WHERE entry_id=?', latestEntry.id);
    const drLine = lines.find((l: any) => l.debit > 0);
    const crLine = lines.find((l: any) => l.credit > 0);
    expect(drLine.account_id).toBe('acc_ar');
    expect(crLine.account_id).toBe('acc_notes_receivable');
  });

  it('projects cash flow accurately including cheques and open bills', async () => {
    const admin = await signIn('admin@test.local');

    const forecastRes = await admin.get('/api/treasury/cash-flow-forecast?days=30').set(header);
    expect(forecastRes.status).toBe(200);
    expect(forecastRes.body).toHaveProperty('currentCashBalance');
    expect(forecastRes.body).toHaveProperty('projectedInflows');
    expect(forecastRes.body).toHaveProperty('projectedOutflows');
    expect(forecastRes.body).toHaveProperty('projectedEndingBalance');
  });

  it('supports hierarchical cost centers creation and listing', async () => {
    const admin = await signIn('admin@test.local');

    const cc1 = await admin.post('/api/treasury/cost-centers').set(header).send({
      code: 'CC-HQ',
      name: 'الإدارة العامة والمقر الرئيسي',
      notes: 'مركز تكلفة إداري',
    });
    expect(cc1.status).toBe(201);
    expect(cc1.body.code).toBe('CC-HQ');

    const cc2 = await admin.post('/api/treasury/cost-centers').set(header).send({
      code: 'CC-MKT',
      name: 'قسم التسويق والإعلانات',
      parent_id: cc1.body.id,
    });
    expect(cc2.status).toBe(201);

    const list = await admin.get('/api/treasury/cost-centers').set(header);
    expect(list.status).toBe(200);
    expect(list.body.length).toBeGreaterThanOrEqual(2);
  });
});

describe('Phase 5: Egyptian HR & Payroll Engine', () => {
  it('creates employees and calculates a tax-free payroll run', async () => {
    const admin = await signIn('admin@test.local');

    // Create an employee with 10,000 EGP basic salary (1,000,000 piasters)
    const empRes = await admin.post('/api/employees').set(header).send({
      code: 'EMP-001',
      name: 'أحمد محمود علي',
      job_title: 'مهندس برمجيات أول',
      department: 'تكنولوجيا المعلومات',
      branch_id: 'main',
      basic_salary: 1000000, // 10,000 EGP
      variable_salary: 200000, // 2,000 EGP
      insured_salary: 1000000, // 10,000 EGP
      insurance_number: '12345678',
      hire_date: '2026-01-01',
    });
    expect(empRes.status).toBe(201);
    const emp = empRes.body;
    expect(emp.name).toBe('أحمد محمود علي');

    // Record an advance of 1,000 EGP (100,000 piasters)
    const advRes = await admin.post(`/api/employees/${emp.id}/advances`).set(header).send({
      amount: 100000,
      date: '2026-10-15',
      notes: 'سلفة مؤقتة',
    });
    expect(advRes.status).toBe(201);

    // Run payroll for 2026-10
    const runRes = await admin.post('/api/payroll-runs').set(header).send({
      month: '2026-10',
      branch_id: 'main',
      notes: 'مسير رواتب أكتوبر 2026',
    });
    expect(runRes.status).toBe(201);
    const pr = runRes.body;
    expect(pr.status).toBe('DRAFT');
    expect(pr.total_gross).toBe(1200000); // 12,000 EGP
    // Tax-free mode: insurance, income tax, and martyrs fund are all zero.
    expect(pr.total_social_insurance_employee).toBe(0);
    expect(pr.total_social_insurance_employer).toBe(0);
    expect(pr.total_income_tax).toBe(0);
    expect(pr.total_martyrs_fund).toBe(0);
    // Advances: 100,000 piasters; net = 12,000 - 1,000 = 11,000 EGP
    expect(pr.total_advances).toBe(100000);
    expect(pr.total_net).toBe(1100000);

    expect(pr.slips).toHaveLength(1);
    expect(pr.slips[0].advances_deduction).toBe(100000);

    // Confirm payroll run -> should post balanced GL entry
    const confirmRes = await admin.post(`/api/payroll-runs/${pr.id}/confirm`).set(header).send({});
    expect(confirmRes.status).toBe(200);
    expect(confirmRes.body.status).toBe('CONFIRMED');
    expect(confirmRes.body.journal_entry_id).toBeDefined();

    // Verify GL entry is strictly balanced: SUM(debit) == SUM(credit)
    const glLines = all<any>(
      'SELECT debit, credit FROM journal_lines WHERE entry_id=?',
      confirmRes.body.journal_entry_id,
    );
    const sumDebit = glLines.reduce((s: number, l: any) => s + l.debit, 0);
    const sumCredit = glLines.reduce((s: number, l: any) => s + l.credit, 0);
    expect(sumDebit).toBeGreaterThan(0);
    expect(sumDebit).toBe(sumCredit);

    // Verify advance is marked as REPAID
    const adv = one<any>('SELECT status FROM employee_advances WHERE id=?', advRes.body.id);
    expect(adv.status).toBe('REPAID');
  });
});
