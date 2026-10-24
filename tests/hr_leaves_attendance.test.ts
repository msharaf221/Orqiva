import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { header, seedUsers, signIn, resetBusinessData } from './helpers';
import { all } from '../server/db';

beforeAll(seedUsers);
beforeEach(resetBusinessData);

describe('HR Module — Leaves, Attendance, and Payroll Integration', () => {
  it('manages leave types, requests, approvals, and balances correctly', async () => {
    const admin = await signIn('admin@test.local');

    // 1. Check default leave types
    const typesRes = await admin.get('/api/hr/leave-types').set(header);
    expect(typesRes.status).toBe(200);
    expect(Array.isArray(typesRes.body)).toBe(true);
    const annualType = typesRes.body.find((t: any) => t.code === 'ANNUAL');
    const unpaidType = typesRes.body.find((t: any) => t.code === 'UNPAID');
    expect(annualType).toBeDefined();
    expect(annualType.days_per_year).toBe(21);
    expect(unpaidType.deduct_from_salary).toBe(1);

    // 2. Create an employee
    const empRes = await admin.post('/api/employees').set(header).send({
      code: 'EMP-HR-001',
      name: 'أحمد فؤاد الموارد البشرية',
      job_title: 'مهندس برمجيات',
      branch_id: 'main',
      basic_salary: 1200000, // 12,000 EGP
      variable_salary: 0,
      insured_salary: 1000000,
      hire_date: '2026-01-01',
      contract_end_date: '2027-01-01',
      emergency_contact: '01000000000',
    });
    expect(empRes.status).toBe(201);
    const employeeId = empRes.body.id;

    // 3. Submit a leave request (5 days annual leave)
    const leaveRes = await admin.post('/api/hr/leaves').set(header).send({
      employee_id: employeeId,
      leave_type_id: annualType.id,
      start_date: '2026-10-10',
      end_date: '2026-10-14',
      reason: 'إجازة سنوية اعتيادية',
    });
    expect(leaveRes.status).toBe(201);
    expect(leaveRes.body.status).toBe('PENDING');
    expect(leaveRes.body.total_days).toBe(5);
    const leaveId = leaveRes.body.id;

    // 4. Approve the leave request
    const approveRes = await admin.post(`/api/hr/leaves/${leaveId}/approve`).set(header).send({
      notes: 'تمت الموافقة من الإدارة',
    });
    expect(approveRes.status).toBe(200);
    expect(approveRes.body.status).toBe('APPROVED');
    expect(approveRes.body.approved_at).toBeDefined();

    // 5. Verify employee leave balance
    const balanceRes = await admin
      .get(`/api/hr/leaves/balance/${employeeId}?year=2026`)
      .set(header);
    expect(balanceRes.status).toBe(200);
    const annualBal = balanceRes.body.find((b: any) => b.leave_type_code === 'ANNUAL');
    expect(annualBal).toBeDefined();
    expect(annualBal.days_taken).toBe(5);
    expect(annualBal.days_remaining).toBe(16); // 21 - 5 = 16
  });

  it('records daily attendance, overtime, late minutes and integrates with monthly payroll', async () => {
    const admin = await signIn('admin@test.local');

    // 1. Create Employee
    const empRes = await admin.post('/api/employees').set(header).send({
      code: 'EMP-ATT-002',
      name: 'محمود عبد السلام الحضور',
      job_title: 'محاسب',
      branch_id: 'main',
      basic_salary: 2400000, // 24,000 EGP = 240,000 piasters/day = 10,000 piasters/hour (100 EGP/hr)
      variable_salary: 0,
      insured_salary: 1400000,
      hire_date: '2026-01-01',
    });
    expect(empRes.status).toBe(201);
    const employeeId = empRes.body.id;

    // 2. Record attendance for 3 days in October:
    // Day 1: Present, 4 hours overtime (Overtime pay = 4 * 10,000 * 1.5 = 60,000 piasters = 600 EGP)
    // Day 2: Late 60 minutes (Penalty = 1 hr * 10,000 = 10,000 piasters = 100 EGP)
    // Day 3: Absent (Penalty = 1 day * 80,000 = 80,000 piasters = 800 EGP)
    await admin.post('/api/hr/attendance').set(header).send({
      employee_id: employeeId,
      branch_id: 'main',
      date: '2026-10-01',
      check_in: '09:00',
      check_out: '21:00',
      status: 'PRESENT',
      late_minutes: 0,
      overtime_hours: 4,
      notes: 'ساعات إضافي إقفال ميزانية',
    });

    await admin.post('/api/hr/attendance').set(header).send({
      employee_id: employeeId,
      branch_id: 'main',
      date: '2026-10-02',
      check_in: '10:00',
      check_out: '17:00',
      status: 'LATE',
      late_minutes: 60,
      overtime_hours: 0,
      notes: 'تأخير صباحي',
    });

    await admin.post('/api/hr/attendance').set(header).send({
      employee_id: employeeId,
      branch_id: 'main',
      date: '2026-10-03',
      status: 'ABSENT',
      late_minutes: 0,
      overtime_hours: 0,
      notes: 'غياب بدون إذن',
    });

    // 3. Verify monthly impact endpoint
    const impactRes = await admin
      .get(`/api/hr/monthly-impact/${employeeId}?month=2026-10`)
      .set(header);
    expect(impactRes.status).toBe(200);
    expect(impactRes.body.overtimeHours).toBe(4);
    expect(impactRes.body.overtimeAmount).toBe(60000); // 600 EGP
    expect(impactRes.body.lateMinutes).toBe(60);
    expect(impactRes.body.absentDays).toBe(1);
    expect(impactRes.body.attendanceDeduction).toBe(90000); // 80,000 (day) + 10,000 (hour) = 900 EGP

    // 4. Run Monthly Payroll for 2026-10
    const runRes = await admin.post('/api/payroll-runs').set(header).send({
      month: '2026-10',
      branch_id: 'main',
      notes: 'مسير رواتب أكتوبر متضمن الإضافي والغياب',
    });
    expect(runRes.status).toBe(201);
    const run = runRes.body;
    expect(run.slips).toHaveLength(1);
    const slip = run.slips[0];
    expect(slip.basic_salary).toBe(2400000);
    expect(slip.overtime_amount).toBe(60000);
    expect(slip.attendance_deduction).toBe(90000);
    expect(slip.gross_salary).toBe(2460000); // 24,000 + 600 overtime

    // 5. Confirm Payroll Run and check GL entry strict balance
    const confirmRes = await admin.post(`/api/payroll-runs/${run.id}/confirm`).set(header).send({});
    expect(confirmRes.status).toBe(200);
    expect(confirmRes.body.status).toBe('CONFIRMED');
    expect(confirmRes.body.journal_entry_id).toBeDefined();

    const glLines = all<any>(
      'SELECT debit, credit FROM journal_lines WHERE entry_id=?',
      confirmRes.body.journal_entry_id,
    );
    const sumDebit = glLines.reduce((s: number, l: any) => s + l.debit, 0);
    const sumCredit = glLines.reduce((s: number, l: any) => s + l.credit, 0);
    expect(sumDebit).toBeGreaterThan(0);
    expect(sumDebit).toBe(sumCredit);
  });
});
