import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PASSWORD, header, resetBusinessData, seedUsers, signIn } from './helpers';
import { run } from '../server/db';

type Agent = Awaited<ReturnType<typeof signIn>>;

let admin: Agent;

beforeAll(async () => {
  await seedUsers();
  admin = await signIn('admin@test.local');
});

beforeEach(() => {
  resetBusinessData();
  run("DELETE FROM users WHERE id NOT IN ('admin','staff')");
});

async function openBranch(code: string): Promise<string> {
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
  return res.body.id as string;
}

async function createUser(email: string, role: string, branchIds: string[]): Promise<Agent> {
  await admin
    .post('/api/users')
    .set(header)
    .send({ name: email.split('@')[0], email, password: PASSWORD, role, branch_ids: branchIds })
    .expect(201);
  return signIn(email);
}

async function createAccount(
  branchId: string,
  name: string,
  type: 'CASH' | 'BANK' = 'CASH',
  initialBalance = 0,
): Promise<string> {
  const res = await admin
    .post('/api/cash-accounts')
    .set(header)
    .send({
      name,
      type,
      branch_id: branchId,
      currency: 'EGP',
      initial_balance: initialBalance,
      allow_negative: 1,
    })
    .expect(201);
  return res.body.id as string;
}

async function createEmployee(branchId: string, code: string): Promise<string> {
  const res = await admin
    .post('/api/employees')
    .set(header)
    .send({
      code,
      name: `موظف ${code}`,
      job_title: 'محاسب',
      branch_id: branchId,
      basic_salary: 1_000_000,
      hire_date: '2026-01-01',
    })
    .expect(201);
  return res.body.id as string;
}

async function createCheque(branchId: string, number: string): Promise<string> {
  const party = await admin
    .post('/api/parties')
    .set(header)
    .send({
      type: 'CUSTOMER',
      name: `عميل ${number}`,
      email: '',
      phone: '',
      address: '',
      tax_number: '',
      notes: '',
    })
    .expect(201);
  const res = await admin
    .post('/api/treasury/cheques')
    .set(header)
    .send({
      number,
      type: 'RECEIVABLE',
      party_id: party.body.id,
      bank_name: 'البنك الأهلي',
      branch_id: branchId,
      amount: 50_000,
      issue_date: '2026-10-01',
      due_date: '2026-11-01',
    })
    .expect(201);
  return res.body.id as string;
}

describe('Phase 2 — branch isolation and least privilege', () => {
  it('scopes cash accounts, statements and transfers to the actor branches', async () => {
    const br2 = await openBranch('BR2');
    const mainCash = await createAccount('main', 'خزنة رئيسية', 'CASH', 1_000_000);
    const mainBank = await createAccount('main', 'بنك رئيسي', 'BANK', 0);
    const br2Cash = await createAccount(br2, 'خزنة الفرع الثاني', 'CASH', 2_000_000);
    const br2Bank = await createAccount(br2, 'بنك الفرع الثاني', 'BANK', 0);

    await admin
      .post('/api/cash-accounts/transfers')
      .set(header)
      .send({
        from_account_id: mainCash,
        to_account_id: mainBank,
        amount: 100_000,
        date: '2026-10-20',
        notes: 'تحويل رئيسي',
      })
      .expect(201);
    await admin
      .post('/api/cash-accounts/transfers')
      .set(header)
      .send({
        from_account_id: br2Cash,
        to_account_id: br2Bank,
        amount: 200_000,
        date: '2026-10-20',
        notes: 'تحويل الفرع الثاني',
      })
      .expect(201);

    const accountant = await createUser('main-accountant@test.local', 'ACCOUNTANT', ['main']);

    const accounts = await accountant.get('/api/cash-accounts').set(header).expect(200);
    const accountIds = accounts.body.map((a: { id: string }) => a.id);
    expect(accountIds).toContain(mainCash);
    expect(accountIds).toContain(mainBank);
    expect(accountIds).not.toContain(br2Cash);
    expect(accountIds).not.toContain(br2Bank);

    await accountant.get(`/api/cash-accounts/${br2Cash}`).set(header).expect(404);
    await accountant.get(`/api/cash-accounts/${br2Cash}/statement`).set(header).expect(404);
    await accountant.get(`/api/cash-accounts?branch_id=${br2}`).set(header).expect(403);
    await accountant
      .post('/api/cash-accounts')
      .set(header)
      .send({ name: 'خزنة غير مصرح', type: 'CASH', branch_id: br2, allow_negative: 1 })
      .expect(403);
    await accountant
      .put(`/api/cash-accounts/${br2Cash}`)
      .set(header)
      .send({ name: 'محاولة تعديل', allow_negative: 1, active: 1 })
      .expect(404);
    await accountant
      .post('/api/cash-accounts/transfers')
      .set(header)
      .send({
        from_account_id: br2Cash,
        to_account_id: br2Bank,
        amount: 10_000,
        date: '2026-10-21',
      })
      .expect(404);

    const transfers = await accountant.get('/api/cash-accounts/transfers').set(header).expect(200);
    expect(transfers.body).toHaveLength(1);
    expect(transfers.body[0].notes).toBe('تحويل رئيسي');

    // Sales can read their branch's cash accounts for payment forms, but not another branch.
    const staff = await signIn('staff@test.local');
    const staffAccounts = await staff.get('/api/cash-accounts').set(header).expect(200);
    const staffIds = staffAccounts.body.map((a: { id: string }) => a.id);
    expect(staffIds).toContain(mainCash);
    expect(staffIds).not.toContain(br2Cash);
    await staff.get(`/api/cash-accounts/${br2Cash}`).set(header).expect(404);
  });

  it('scopes HR records and payroll runs, and stops sales from reading salaries', async () => {
    const br2 = await openBranch('BR2');
    const mainEmployee = await createEmployee('main', 'EMP-MAIN');
    const br2Employee = await createEmployee(br2, 'EMP-BR2');

    const accountant = await createUser('hr-accountant@test.local', 'ACCOUNTANT', ['main']);

    const employees = await accountant.get('/api/employees').set(header).expect(200);
    expect(employees.body.map((e: { id: string }) => e.id)).toEqual([mainEmployee]);
    await accountant.get(`/api/employees/${br2Employee}`).set(header).expect(404);
    await accountant
      .post('/api/employees')
      .set(header)
      .send({
        code: 'EMP-NO',
        name: 'موظف مرفوض',
        job_title: 'فني',
        branch_id: br2,
        basic_salary: 500_000,
        hire_date: '2026-01-01',
      })
      .expect(403);

    await accountant
      .post('/api/hr/attendance')
      .set(header)
      .send({ employee_id: br2Employee, branch_id: br2, date: '2026-10-20' })
      .expect(404);
    await accountant
      .post('/api/hr/leaves')
      .set(header)
      .send({
        employee_id: br2Employee,
        leave_type_id: 'lt_annual',
        start_date: '2026-11-01',
        end_date: '2026-11-03',
      })
      .expect(404);
    await accountant.get(`/api/hr/leaves?branch_id=${br2}`).set(header).expect(403);
    await accountant.get(`/api/hr/leaves/balance/${br2Employee}`).set(header).expect(404);
    await accountant
      .get(`/api/hr/monthly-impact/${br2Employee}?month=2026-10`)
      .set(header)
      .expect(404);

    const mainRun = await admin
      .post('/api/payroll-runs')
      .set(header)
      .send({ month: '2026-10', branch_id: 'main' })
      .expect(201);
    const br2Run = await admin
      .post('/api/payroll-runs')
      .set(header)
      .send({ month: '2026-10', branch_id: br2 })
      .expect(201);

    const runs = await accountant.get('/api/payroll-runs').set(header).expect(200);
    expect(runs.body.map((r: { id: string }) => r.id)).toEqual([mainRun.body.id]);
    await accountant.get(`/api/payroll-runs/${br2Run.body.id}`).set(header).expect(404);
    await accountant
      .post(`/api/payroll-runs/${br2Run.body.id}/confirm`)
      .set(header)
      .send({})
      .expect(404);
    await accountant
      .post('/api/payroll-runs')
      .set(header)
      .send({ month: '2026-11', branch_id: br2 })
      .expect(403);

    const staff = await signIn('staff@test.local');
    await staff.get('/api/employees').set(header).expect(403);
    await staff.get('/api/payroll-runs').set(header).expect(403);
    await staff.get('/api/hr/leaves').set(header).expect(403);
    await staff.get(`/api/hr/attendance?branch_id=${br2}`).set(header).expect(403);
  });

  it('scopes cheques, bank reconciliation and cash-flow forecasts', async () => {
    const br2 = await openBranch('BR2');
    await createAccount('main', 'بنك رئيسي', 'BANK', 100_000);
    const br2Bank = await createAccount(br2, 'بنك الفرع الثاني', 'BANK', 900_000);

    const mainCheque = await createCheque('main', 'CHK-MAIN');
    const br2Cheque = await createCheque(br2, 'CHK-BR2');

    const accountant = await createUser('treasury-accountant@test.local', 'ACCOUNTANT', ['main']);

    const cheques = await accountant.get('/api/treasury/cheques').set(header).expect(200);
    expect(cheques.body.map((c: { id: string }) => c.id)).toEqual([mainCheque]);
    await accountant.get(`/api/treasury/cheques/${br2Cheque}`).set(header).expect(404);
    await accountant
      .post(`/api/treasury/cheques/${br2Cheque}/collect`)
      .set(header)
      .send({ bank_account_id: br2Bank, collection_date: '2026-10-25' })
      .expect(404);
    await accountant
      .post(`/api/treasury/cheques/${br2Cheque}/bounce`)
      .set(header)
      .send({ reason: 'محاولة غير مصرحة' })
      .expect(404);

    const staff = await signIn('staff@test.local');
    await staff.get('/api/treasury/cheques').set(header).expect(403);
    await staff.get('/api/treasury/bank-statements').set(header).expect(403);
    await staff.get('/api/treasury/cash-flow-forecast').set(header).expect(403);

    const statementAccount = await createAccount('main', 'بنك بيان', 'BANK', 0);
    const mainStatement = await admin
      .post('/api/treasury/bank-statements')
      .set(header)
      .send({
        cash_account_id: statementAccount,
        statement_date: '2026-10-31',
        opening_balance: 0,
        closing_balance: 0,
        lines: [],
      })
      .expect(201);
    const br2Statement = await admin
      .post('/api/treasury/bank-statements')
      .set(header)
      .send({
        cash_account_id: br2Bank,
        statement_date: '2026-10-31',
        opening_balance: 0,
        closing_balance: 0,
        lines: [],
      })
      .expect(201);

    const statements = await accountant
      .get('/api/treasury/bank-statements')
      .set(header)
      .expect(200);
    expect(statements.body.map((s: { id: string }) => s.id)).toContain(mainStatement.body.id);
    expect(statements.body.map((s: { id: string }) => s.id)).not.toContain(br2Statement.body.id);
    await accountant
      .get(`/api/treasury/bank-statements/${br2Statement.body.id}`)
      .set(header)
      .expect(404);

    const forecast = await accountant
      .get('/api/treasury/cash-flow-forecast?days=30')
      .set(header)
      .expect(200);
    expect(forecast.body.currentCashBalance).toBe(100_000);
    await accountant
      .get(`/api/treasury/cash-flow-forecast?branch_id=${br2}`)
      .set(header)
      .expect(403);
  });

  it('scopes ETA submission logs and queue processing', async () => {
    const br2 = await openBranch('BR2');
    const party = await admin
      .post('/api/parties')
      .set(header)
      .send({
        type: 'CUSTOMER',
        name: 'عميل الفاتورة الإلكترونية',
        email: '',
        phone: '',
        address: '',
        tax_number: '',
        notes: '',
      })
      .expect(201);

    const insertDocument = (id: string, number: string, branchId: string) => {
      run(
        `INSERT INTO documents(
           id, number, type, status, party_id, date, due_date, subtotal, discount, tax_rate,
           tax, total, paid, notes, created_by, created_at, branch_id, internal_code
         ) VALUES(?,?, 'SALE', 'POSTED', ?, '2026-10-20', '2026-11-20', 10000, 0, 0,
                  0, 10000, 0, '', 'admin', '2026-10-20T10:00:00.000Z', ?, ?)`,
        id,
        number,
        party.body.id,
        branchId,
        id,
      );
      run(
        `INSERT INTO e_invoice_submissions(
           id, document_id, uuid, document_type, status, attempt, max_attempts,
           next_attempt_at, created_by, created_at, updated_at
         ) VALUES(?,?,?, 'INVOICE', 'PENDING', 0, 5, '2026-10-20T10:00:00.000Z', 'admin',
                  '2026-10-20T10:00:00.000Z', '2026-10-20T10:00:00.000Z')`,
        `sub-${id}`,
        id,
        id,
      );
    };
    const mainDoc = 'doc-eta-main';
    const br2Doc = 'doc-eta-br2';
    insertDocument(mainDoc, 'ETA-MAIN-1', 'main');
    insertDocument(br2Doc, 'ETA-BR2-1', br2);

    const staff = await signIn('staff@test.local');
    const submissions = await staff.get('/api/eta/submissions').set(header).expect(200);
    expect(submissions.body.map((s: { document_id: string }) => s.document_id)).toEqual([mainDoc]);
    await staff.get(`/api/eta/documents/${br2Doc}/submission`).set(header).expect(404);
    await staff.get(`/api/eta/documents/${br2Doc}/payload`).set(header).expect(404);
    await staff.post('/api/eta/process').set(header).send({}).expect(403);

    const generalAccountant = await createUser('eta-accountant@test.local', 'GENERAL_ACCOUNTANT', [
      'main',
    ]);
    const status = await generalAccountant.get('/api/eta/status').set(header).expect(200);
    expect(status.body.summary.PENDING).toBe(1);
    const processed = await generalAccountant
      .post('/api/eta/process')
      .set(header)
      .send({})
      .expect(200);
    // ETA is disabled in tax-free mode: the queue is intentionally left untouched.
    expect(processed.body.processed).toBe(0);
    expect(processed.body.succeeded).toBe(0);

    // Both submissions remain pending because the pipeline is dormant.
    const adminStatus = await admin.get('/api/eta/status').set(header).expect(200);
    expect(adminStatus.body.summary.PENDING).toBe(2);
  });
});
