import { Router } from 'express';
import { z } from 'zod';
import { requirePermission } from '../rbac';
import { scopeFor } from '../scope';
import {
  listEmployees,
  getEmployee,
  createEmployee,
  createAdvance,
  listPayrollRuns,
  getPayrollRun,
  createPayrollRun,
  confirmPayrollRun,
} from '../payroll';
import { AppError } from '../errors';

export const payrollRouter = Router();

// --- Employees ---

payrollRouter.get('/employees', requirePermission('hr:view'), (req, res) => {
  res.json(listEmployees(scopeFor(req.user, req.query.branch_id)));
});

payrollRouter.post('/employees', requirePermission('hr:manage'), (req, res) => {
  const schema = z.object({
    code: z.string().trim().min(1, 'كود الموظف مطلوب'),
    name: z.string().trim().min(2, 'اسم الموظف مطلوب'),
    national_id: z.string().trim().optional(),
    phone: z.string().trim().optional(),
    job_title: z.string().trim().min(1, 'المسمى الوظيفي مطلوب'),
    department: z.string().trim().optional(),
    branch_id: z.string().min(1, 'الفرع مطلوب'),
    employment_type: z.enum(['FULL_TIME', 'PART_TIME', 'CONTRACT']).default('FULL_TIME'),
    basic_salary: z.number().int().min(0, 'الراتب الأساسي لا يمكن أن يكون سالباً'),
    variable_salary: z.number().int().min(0).default(0),
    insured_salary: z.number().int().min(0).optional(),
    insurance_number: z.string().trim().optional(),
    hire_date: z.string(),
  });
  const parsed = schema.parse(req.body);
  res.status(201).json(createEmployee(parsed, req.user));
});

payrollRouter.get('/employees/:id', requirePermission('hr:view'), (req, res) => {
  const emp = getEmployee(String(req.params.id), scopeFor(req.user));
  if (!emp) throw new AppError(404, 'الموظف غير موجود');
  res.json(emp);
});

payrollRouter.post('/employees/:id/advances', requirePermission('hr:manage'), (req, res) => {
  const schema = z.object({
    amount: z.number().int().positive('قيمة السلفة يجب أن تكون أكبر من صفر'),
    date: z.string(),
    notes: z.string().optional(),
  });
  const parsed = schema.parse(req.body);
  res
    .status(201)
    .json(
      createAdvance(
        { ...parsed, employee_id: String(req.params.id) },
        req.user,
        scopeFor(req.user),
      ),
    );
});

// --- Monthly Payroll Runs ---

payrollRouter.get('/payroll-runs', requirePermission('hr:view'), (req, res) => {
  res.json(listPayrollRuns(scopeFor(req.user, req.query.branch_id)));
});

payrollRouter.post('/payroll-runs', requirePermission('hr:manage'), (req, res) => {
  const schema = z.object({
    month: z.string().regex(/^\d{4}-\d{2}$/, 'صيغة الشهر يجب أن تكون YYYY-MM'),
    branch_id: z.string().optional(),
    notes: z.string().optional(),
  });
  const parsed = schema.parse(req.body);
  res
    .status(201)
    .json(
      createPayrollRun(
        parsed.month,
        parsed.branch_id,
        req.user,
        parsed.notes,
        scopeFor(req.user, parsed.branch_id),
      ),
    );
});

payrollRouter.get('/payroll-runs/:id', requirePermission('hr:view'), (req, res) => {
  const pr = getPayrollRun(String(req.params.id), scopeFor(req.user));
  if (!pr) throw new AppError(404, 'مسير الرواتب غير موجود');
  res.json(pr);
});

payrollRouter.post('/payroll-runs/:id/confirm', requirePermission('hr:manage'), (req, res) => {
  res.json(confirmPayrollRun(String(req.params.id), req.user, scopeFor(req.user)));
});
