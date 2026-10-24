/**
 * Egyptian HR & Payroll Engine (Phase 5).
 *
 * Implements Egyptian labor and income tax regulations:
 *  - Social Insurance: 11% employee contribution, 18.75% employer contribution.
 *  - Martyrs Fund: 0.05% (5/10000) of gross salary.
 *  - Egyptian Income Tax (كسب العمل) progressive tax brackets with personal exemption.
 *  - Advances & deductions management.
 *  - Automated double-entry GL journal entry balanced to the piaster.
 */

import { all, one, run, transaction, id, now } from './db';
import { AppError } from './errors';
import { postEntry } from './ledger';
import { getMonthlyAttendanceAndLeaveImpact } from './hr';
import { TAX_FREE } from '../src/config';
import { Employee, PayrollRun, PayrollSlip, EmploymentType, JournalEntry } from '../src/types';
import { audit } from './audit';
import { inScope, scopeSql, writableBranch, type Actor, type Scope } from './scope';

function toActor(actorId?: string): Actor {
  return { id: actorId || 'system', name: 'Payroll Engine', role: 'ADMIN' };
}

// --- Employee Management ---

export function listEmployees(scope: Scope): Employee[] {
  const visible = scopeSql('e.branch_id', scope);
  return all<Employee>(
    `SELECT e.*, b.name AS branch_name
     FROM employees e
     JOIN branches b ON b.id = e.branch_id
     WHERE ${visible.sql}
     ORDER BY e.name ASC`,
    ...visible.params,
  );
}

export function getEmployee(id: string, scope?: Scope): Employee | null {
  const employee =
    one<Employee>(
      `SELECT e.*, b.name AS branch_name
       FROM employees e
       JOIN branches b ON b.id = e.branch_id
       WHERE e.id=?`,
      id,
    ) || null;
  if (employee && scope && !inScope(scope, employee.branch_id)) return null;
  return employee;
}

export function createEmployee(
  data: {
    code: string;
    name: string;
    national_id?: string;
    phone?: string;
    job_title: string;
    department?: string;
    branch_id: string;
    employment_type?: EmploymentType;
    basic_salary: number; // in piasters
    variable_salary?: number;
    insured_salary?: number;
    insurance_number?: string;
    hire_date: string;
  },
  actor?: Actor,
): Employee {
  if (actor) writableBranch(actor, data.branch_id);
  else if (!one('SELECT id FROM branches WHERE id=?', data.branch_id)) {
    throw new AppError(404, 'الفرع غير موجود');
  }

  const existing = one<{ id: string }>('SELECT id FROM employees WHERE code=?', data.code);
  if (existing) throw new AppError(400, 'كود الموظف مستخدم بالفعل');

  const empId = id();
  const ts = now();
  // Tax-free mode removes social insurance from the payroll model, so the insured wage and
  // insurance number are kept empty even if an older client still sends them.
  const insured = TAX_FREE ? 0 : (data.insured_salary ?? data.basic_salary);

  run(
    `INSERT INTO employees(id, code, name, national_id, phone, job_title, department, branch_id,
                           employment_type, basic_salary, variable_salary, insured_salary, insurance_number,
                           active, hire_date, created_at)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?, 1, ?,?)`,
    empId,
    data.code,
    data.name,
    data.national_id || null,
    data.phone || null,
    data.job_title,
    data.department || null,
    data.branch_id,
    data.employment_type || 'FULL_TIME',
    data.basic_salary,
    data.variable_salary || 0,
    insured,
    TAX_FREE ? null : data.insurance_number || null,
    data.hire_date,
    ts,
  );

  if (actor) {
    audit(actor, 'إضافة موظف', 'EMPLOYEE', empId, `${data.code}: ${data.name}`);
  }

  return getEmployee(empId)!;
}

// --- Advances ---

export function createAdvance(
  data: {
    employee_id: string;
    amount: number;
    date: string;
    notes?: string;
  },
  actor?: Actor,
  scope?: Scope,
): { id: string } {
  const emp = getEmployee(data.employee_id, scope);
  if (!emp) throw new AppError(404, 'الموظف غير موجود');
  if (data.amount <= 0) throw new AppError(400, 'قيمة السلفة يجب أن تكون أكبر من صفر');

  const advId = id();
  run(
    `INSERT INTO employee_advances(id, employee_id, amount, date, status, notes, created_at)
     VALUES(?,?,?,?,'PENDING',?,?)`,
    advId,
    data.employee_id,
    data.amount,
    data.date,
    data.notes || null,
    now(),
  );
  if (actor) {
    audit(actor, 'منح سلفة', 'EMPLOYEE_ADVANCE', advId, `${emp.name}: ${data.amount}`);
  }
  return { id: advId };
}

// --- Egyptian Tax & Payroll Calculation Core ---

/**
 * Calculates Egyptian monthly payroll deductions:
 * 1. Social Insurance (employee: 11%, employer: 18.75% of insured salary).
 * 2. Martyrs Fund: 0.05% of gross salary.
 * 3. Egyptian Progressive Income Tax on wages with monthly personal exemption.
 */
export function calculateEgyptianPayrollDeductions(
  basicSalary: number,
  variableSalary: number,
  insuredSalary: number,
): {
  gross: number;
  employeeSocialIns: number;
  employerSocialIns: number;
  incomeTax: number;
  martyrsFund: number;
} {
  const gross = basicSalary + variableSalary;

  // Tax-free mode: no social insurance, martyrs fund, or income tax. Gross pay is the
  // employee's full entitlement before advances and attendance adjustments.
  if (TAX_FREE) {
    return {
      gross,
      employeeSocialIns: 0,
      employerSocialIns: 0,
      incomeTax: 0,
      martyrsFund: 0,
    };
  }

  // 1. Social Insurance (11% employee, 18.75% employer)
  const employeeSocialIns = Math.round(insuredSalary * 0.11);
  const employerSocialIns = Math.round(insuredSalary * 0.1875);

  // 2. Martyrs Fund (صندوق تكريم الشهداء: 5 في العشرة آلاف = 0.0005)
  const martyrsFund = Math.round(gross * 0.0005);

  // 3. Progressive Egyptian Income Tax (كسب العمل)
  // Personal exemption: 20,000 EGP/year = 1,666.67 EGP/month = 166,667 piasters
  const monthlyPersonalExemption = 166667;
  const taxableSalary = Math.max(0, gross - employeeSocialIns - monthlyPersonalExemption);

  // Annualized taxable in piasters
  const annualized = taxableSalary * 12;

  // Brackets (annual piasters):
  // 0 - 40,000 EGP (4,000,000 piasters): 0%
  // 40,000 - 55,000 EGP (5,500,000 piasters): 10%
  // 55,000 - 70,000 EGP (7,000,000 piasters): 15%
  // 70,000 - 200,000 EGP (20,000,000 piasters): 20%
  // 200,000 - 400,000 EGP (40,000,000 piasters): 22.5%
  // Above 400,000 EGP: 25%

  let annualTax = 0;
  if (annualized > 4000000) {
    const b1 = Math.min(annualized, 5500000) - 4000000;
    annualTax += b1 * 0.1;
  }
  if (annualized > 5500000) {
    const b2 = Math.min(annualized, 7000000) - 5500000;
    annualTax += b2 * 0.15;
  }
  if (annualized > 7000000) {
    const b3 = Math.min(annualized, 20000000) - 7000000;
    annualTax += b3 * 0.2;
  }
  if (annualized > 20000000) {
    const b4 = Math.min(annualized, 40000000) - 20000000;
    annualTax += b4 * 0.225;
  }
  if (annualized > 40000000) {
    const b5 = annualized - 40000000;
    annualTax += b5 * 0.25;
  }

  const incomeTax = Math.round(annualTax / 12);

  return {
    gross,
    employeeSocialIns,
    employerSocialIns,
    incomeTax,
    martyrsFund,
  };
}

// --- Monthly Payroll Run ---

export function listPayrollRuns(scope: Scope): PayrollRun[] {
  const visible = scopeSql('pr.branch_id', scope);
  return all<PayrollRun>(
    `SELECT pr.*, b.name AS branch_name
     FROM payroll_runs pr
     LEFT JOIN branches b ON b.id = pr.branch_id
     WHERE ${visible.sql}
     ORDER BY pr.month DESC`,
    ...visible.params,
  );
}

export function getPayrollRun(id: string, scope?: Scope): PayrollRun | null {
  const runData = one<PayrollRun>(
    `SELECT pr.*, b.name AS branch_name
     FROM payroll_runs pr
     LEFT JOIN branches b ON b.id = pr.branch_id
     WHERE pr.id=?`,
    id,
  );
  if (!runData) return null;
  if (scope && !inScope(scope, runData.branch_id)) return null;

  const slips = all<PayrollSlip>(
    `SELECT ps.*, e.name AS employee_name, e.code AS employee_code, e.job_title
     FROM payroll_slips ps
     JOIN employees e ON e.id = ps.employee_id
     WHERE ps.payroll_run_id=?
     ORDER BY e.code ASC`,
    id,
  );

  return { ...runData, slips };
}

export function createPayrollRun(
  month: string, // YYYY-MM
  branchId?: string,
  actor?: Actor,
  notes?: string,
  scope?: Scope,
): PayrollRun {
  if (branchId) {
    if (actor) writableBranch(actor, branchId);
    else if (!one('SELECT id FROM branches WHERE id=?', branchId)) {
      throw new AppError(404, 'الفرع غير موجود');
    }
    if (scope && !inScope(scope, branchId))
      throw new AppError(403, 'ليس لديك صلاحية على هذا الفرع');
  } else if (actor && actor.role !== 'ADMIN') {
    throw new AppError(403, 'مسير رواتب المجموعة متاح لمدير النظام فقط');
  }
  const existing = one<{ id: string }>(
    `SELECT id FROM payroll_runs WHERE month=? AND branch_id ${branchId ? '=?' : 'IS NULL'}`,
    ...(branchId ? [month, branchId] : [month]),
  );
  if (existing) throw new AppError(400, 'مسير الرواتب لهذا الشهر مسجل بالفعل');

  const employeesWhere = branchId ? 'WHERE active=1 AND branch_id=?' : 'WHERE active=1';
  const employeesParams = branchId ? [branchId] : [];
  const activeEmployees = all<Employee>(
    `SELECT * FROM employees ${employeesWhere} ORDER BY code ASC`,
    ...employeesParams,
  );

  if (!activeEmployees.length) {
    throw new AppError(400, 'لا يوجد موظفون نشطون لإعداد مسير الرواتب');
  }

  const runId = id();
  const ts = now();

  let totalBasic = 0;
  let totalVariable = 0;
  let totalGross = 0;
  let totalSocialInsEmp = 0;
  let totalSocialInsEmpr = 0;
  let totalIncomeTax = 0;
  let totalMartyrs = 0;
  let totalAdvances = 0;
  let totalNet = 0;

  const slipsToInsert: Array<{
    id: string;
    employee_id: string;
    basic: number;
    variable: number;
    overtime: number;
    commission: number;
    gross: number;
    socialEmp: number;
    socialEmpr: number;
    tax: number;
    martyrs: number;
    advances: number;
    attendanceDeduction: number;
    net: number;
  }> = [];

  for (const emp of activeEmployees) {
    // 1. Attendance & Leaves impact (overtime & attendance deductions)
    const attImpact = getMonthlyAttendanceAndLeaveImpact(emp.id, month);

    // 2. Sales commission (if any earned from sales targets)
    const commissionRow = one<{ earned: number }>(
      `SELECT COALESCE(SUM(achieved * commission_bps / 10000), 0) AS earned
       FROM (
         SELECT st.commission_bps, COALESCE(SUM(p.amount), 0) AS achieved
         FROM sales_targets st
         JOIN users u ON u.id = st.user_id
         JOIN documents d ON d.created_by = u.id AND d.type = 'SALE'
         JOIN payments p ON p.document_id = d.id AND p.date LIKE ?
         WHERE LOWER(u.name) = LOWER(?) AND st.month = ?
         GROUP BY st.id
       )`,
      `${month}%`,
      emp.name,
      month,
    );
    const salesCommission = commissionRow?.earned || 0;

    const totalEmpVariable = emp.variable_salary + attImpact.overtimeAmount + salesCommission;

    const deductions = calculateEgyptianPayrollDeductions(
      emp.basic_salary,
      totalEmpVariable,
      emp.insured_salary,
    );

    // Sum pending advances for this employee
    const adv =
      one<{ total: number }>(
        "SELECT COALESCE(SUM(amount), 0) AS total FROM employee_advances WHERE employee_id=? AND status='PENDING'",
        emp.id,
      )?.total || 0;

    const netSalary = Math.max(
      0,
      deductions.gross -
        deductions.employeeSocialIns -
        deductions.incomeTax -
        deductions.martyrsFund -
        adv -
        attImpact.attendanceDeduction,
    );

    totalBasic += emp.basic_salary;
    totalVariable += totalEmpVariable;
    totalGross += deductions.gross;
    totalSocialInsEmp += deductions.employeeSocialIns;
    totalSocialInsEmpr += deductions.employerSocialIns;
    totalIncomeTax += deductions.incomeTax;
    totalMartyrs += deductions.martyrsFund;
    totalAdvances += adv;
    totalNet += netSalary;

    slipsToInsert.push({
      id: id(),
      employee_id: emp.id,
      basic: emp.basic_salary,
      variable: emp.variable_salary,
      overtime: attImpact.overtimeAmount,
      commission: salesCommission,
      gross: deductions.gross,
      socialEmp: deductions.employeeSocialIns,
      socialEmpr: deductions.employerSocialIns,
      tax: deductions.incomeTax,
      martyrs: deductions.martyrsFund,
      advances: adv,
      attendanceDeduction: attImpact.attendanceDeduction,
      net: netSalary,
    });
  }

  transaction(() => {
    run(
      `INSERT INTO payroll_runs(id, month, branch_id, status, total_basic, total_variable,
                                total_gross, total_social_insurance_employee, total_social_insurance_employer,
                                total_income_tax, total_martyrs_fund, total_advances, total_net,
                                notes, created_by, created_at)
       VALUES(?,?,?, 'DRAFT', ?,?,?,?,?,?,?,?,?, ?,?,?)`,
      runId,
      month,
      branchId || null,
      totalBasic,
      totalVariable,
      totalGross,
      totalSocialInsEmp,
      totalSocialInsEmpr,
      totalIncomeTax,
      totalMartyrs,
      totalAdvances,
      totalNet,
      notes || null,
      actor?.id || null,
      ts,
    );

    for (const s of slipsToInsert) {
      run(
        `INSERT INTO payroll_slips(id, payroll_run_id, employee_id, basic_salary, variable_salary,
                                   overtime_amount, sales_commission, gross_salary, social_insurance_employee,
                                   social_insurance_employer, income_tax, martyrs_fund, advances_deduction,
                                   attendance_deduction, other_deductions, net_salary)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?, 0, ?)`,
        s.id,
        runId,
        s.employee_id,
        s.basic,
        s.variable,
        s.overtime,
        s.commission,
        s.gross,
        s.socialEmp,
        s.socialEmpr,
        s.tax,
        s.martyrs,
        s.advances,
        s.attendanceDeduction,
        s.net,
      );
    }
  });

  if (actor) {
    audit(actor, 'إنشاء مسير رواتب', 'PAYROLL_RUN', runId, `${month}`);
  }

  return getPayrollRun(runId)!;
}

/**
 * Posts the accrual entry for a payroll run. Exported so the tax-free reset can repost
 * historical runs with exactly the same account mapping as a fresh confirmation.
 *
 * The expense is the net payable plus advances withheld; tax-free mode has no employer
 * social-insurance or payroll-tax liability lines.
 */
export function postPayrollRunLedger(pr: PayrollRun, actor?: Actor): JournalEntry | null {
  const totalAdvances = pr.total_advances || 0;
  const expense = pr.total_net + totalAdvances;
  const lines: Array<{ accountId: string; debit: number; credit: number }> = [];

  if (expense > 0) lines.push({ accountId: 'acc_salaries_exp', debit: expense, credit: 0 });
  if (totalAdvances > 0)
    lines.push({ accountId: 'acc_emp_advances', debit: 0, credit: totalAdvances });
  if (pr.total_net > 0) lines.push({ accountId: 'acc_salaries', debit: 0, credit: pr.total_net });

  if (lines.length < 2) return null;

  return postEntry(
    {
      date: `${pr.month}-28`,
      sourceType: 'MANUAL',
      sourceId: pr.id,
      branchId: pr.branch_id || undefined,
      memo: `استحقاق مسير رواتب شهر ${pr.month}`,
      lines,
    },
    toActor(actor?.id),
  );
}

export function confirmPayrollRun(payrollRunId: string, actor?: Actor, scope?: Scope): PayrollRun {
  const pr = getPayrollRun(payrollRunId, scope);
  if (!pr) throw new AppError(404, 'مسير الرواتب غير موجود');
  if (pr.status !== 'DRAFT') {
    throw new AppError(400, 'مسير الرواتب مؤكد بالفعل أو تم إلغاؤه');
  }

  transaction(() => {
    const entry = postPayrollRunLedger(pr, actor);

    // Mark deducted advances as REPAID
    for (const slip of pr.slips || []) {
      if (slip.advances_deduction > 0) {
        run(
          "UPDATE employee_advances SET status='REPAID' WHERE employee_id=? AND status='PENDING'",
          slip.employee_id,
        );
      }
    }

    run(
      "UPDATE payroll_runs SET status='CONFIRMED', journal_entry_id=? WHERE id=?",
      entry?.id ?? null,
      pr.id,
    );
  });

  if (actor) {
    audit(actor, 'اعتماد مسير رواتب', 'PAYROLL_RUN', payrollRunId, `شهر ${pr.month}`);
  }

  return getPayrollRun(payrollRunId)!;
}
