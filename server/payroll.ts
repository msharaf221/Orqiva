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
import { Employee, PayrollRun, PayrollSlip, EmploymentType } from '../src/types';
import type { Actor } from './scope';

function toActor(actorId?: string): Actor {
  return { id: actorId || 'system', name: 'Payroll Engine', role: 'ADMIN' };
}

// --- Employee Management ---

export function listEmployees(branchId?: string): Employee[] {
  const where = branchId ? 'WHERE e.branch_id=?' : '';
  const params = branchId ? [branchId] : [];
  return all<Employee>(
    `SELECT e.*, b.name AS branch_name
     FROM employees e
     JOIN branches b ON b.id = e.branch_id
     ${where}
     ORDER BY e.name ASC`,
    ...params,
  );
}

export function getEmployee(id: string): Employee | null {
  return (
    one<Employee>(
      `SELECT e.*, b.name AS branch_name
       FROM employees e
       JOIN branches b ON b.id = e.branch_id
       WHERE e.id=?`,
      id,
    ) || null
  );
}

export function createEmployee(data: {
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
}): Employee {
  const branch = one<{ id: string }>('SELECT id FROM branches WHERE id=?', data.branch_id);
  if (!branch) throw new AppError(404, 'الفرع غير موجود');

  const existing = one<{ id: string }>('SELECT id FROM employees WHERE code=?', data.code);
  if (existing) throw new AppError(400, 'كود الموظف مستخدم بالفعل');

  const empId = id();
  const ts = now();
  const insured = data.insured_salary ?? data.basic_salary;

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
    data.insurance_number || null,
    data.hire_date,
    ts,
  );

  return getEmployee(empId)!;
}

// --- Advances ---

export function createAdvance(data: {
  employee_id: string;
  amount: number;
  date: string;
  notes?: string;
}): { id: string } {
  const emp = getEmployee(data.employee_id);
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

export function listPayrollRuns(branchId?: string): PayrollRun[] {
  const where = branchId ? 'WHERE pr.branch_id=?' : '';
  const params = branchId ? [branchId] : [];
  return all<PayrollRun>(
    `SELECT pr.*, b.name AS branch_name
     FROM payroll_runs pr
     LEFT JOIN branches b ON b.id = pr.branch_id
     ${where}
     ORDER BY pr.month DESC`,
    ...params,
  );
}

export function getPayrollRun(id: string): PayrollRun | null {
  const runData = one<PayrollRun>(
    `SELECT pr.*, b.name AS branch_name
     FROM payroll_runs pr
     LEFT JOIN branches b ON b.id = pr.branch_id
     WHERE pr.id=?`,
    id,
  );
  if (!runData) return null;

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
  actorId?: string,
  notes?: string,
): PayrollRun {
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
    gross: number;
    socialEmp: number;
    socialEmpr: number;
    tax: number;
    martyrs: number;
    advances: number;
    net: number;
  }> = [];

  for (const emp of activeEmployees) {
    const deductions = calculateEgyptianPayrollDeductions(
      emp.basic_salary,
      emp.variable_salary,
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
        adv,
    );

    totalBasic += emp.basic_salary;
    totalVariable += emp.variable_salary;
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
      gross: deductions.gross,
      socialEmp: deductions.employeeSocialIns,
      socialEmpr: deductions.employerSocialIns,
      tax: deductions.incomeTax,
      martyrs: deductions.martyrsFund,
      advances: adv,
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
      actorId || null,
      ts,
    );

    for (const s of slipsToInsert) {
      run(
        `INSERT INTO payroll_slips(id, payroll_run_id, employee_id, basic_salary, variable_salary,
                                   gross_salary, social_insurance_employee, social_insurance_employer,
                                   income_tax, martyrs_fund, advances_deduction, other_deductions,
                                   net_salary)
         VALUES(?,?,?,?,?,?,?,?,?,?,?, 0, ?)`,
        s.id,
        runId,
        s.employee_id,
        s.basic,
        s.variable,
        s.gross,
        s.socialEmp,
        s.socialEmpr,
        s.tax,
        s.martyrs,
        s.advances,
        s.net,
      );
    }
  });

  return getPayrollRun(runId)!;
}

export function confirmPayrollRun(payrollRunId: string, actorId?: string): PayrollRun {
  const pr = getPayrollRun(payrollRunId);
  if (!pr) throw new AppError(404, 'مسير الرواتب غير موجود');
  if (pr.status !== 'DRAFT') {
    throw new AppError(400, 'مسير الرواتب مؤكد بالفعل أو تم إلغاؤه');
  }

  transaction(() => {
    // Generate Double-Entry General Ledger journal entry:
    // Dr Salaries & Wages Expense (6120): totalGross + employerSocialInsurance
    // Cr Social Insurance Authority (2140): employeeSocialInsurance + employerSocialInsurance
    // Cr Tax Authority - Payroll Tax (2150): incomeTax + martyrsFund
    // Cr Employee Advances (1165): totalAdvances (if any)
    // Cr Salaries Payable (2130): totalNet

    const lines: Array<{ accountId: string; debit: number; credit: number }> = [
      {
        accountId: 'acc_salaries_exp',
        debit: pr.total_gross + pr.total_social_insurance_employer,
        credit: 0,
      },
      {
        accountId: 'acc_social_ins',
        debit: 0,
        credit: pr.total_social_insurance_employee + pr.total_social_insurance_employer,
      },
      {
        accountId: 'acc_payroll_tax',
        debit: 0,
        credit: pr.total_income_tax + pr.total_martyrs_fund,
      },
    ];

    if (pr.total_advances > 0) {
      lines.push({
        accountId: 'acc_emp_advances',
        debit: 0,
        credit: pr.total_advances,
      });
    }

    lines.push({
      accountId: 'acc_salaries',
      debit: 0,
      credit: pr.total_net,
    });

    const entry = postEntry(
      {
        date: `${pr.month}-28`,
        sourceType: 'MANUAL',
        sourceId: pr.id,
        branchId: pr.branch_id || undefined,
        memo: `استحقاق مسير رواتب شهر ${pr.month}`,
        lines,
      },
      toActor(actorId),
    );

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
      entry.id,
      pr.id,
    );
  });

  return getPayrollRun(payrollRunId)!;
}
