import { Router } from 'express';
import { z } from 'zod';
import { requirePermission } from '../rbac';
import {
  listLeaveTypes,
  listEmployeeLeaves,
  createLeaveRequest,
  updateLeaveStatus,
  getEmployeeLeaveBalance,
  listAttendance,
  recordAttendance,
  batchRecordAttendance,
  getMonthlyAttendanceAndLeaveImpact,
} from '../hr';

export const hrRouter = Router();

// --- Leaves ---

hrRouter.get('/leave-types', requirePermission('hr:view', 'finance:view'), (_req, res) => {
  res.json(listLeaveTypes());
});

hrRouter.get('/leaves', requirePermission('hr:view', 'finance:view'), (req, res) => {
  const leaves = listEmployeeLeaves({
    employee_id: req.query.employee_id ? String(req.query.employee_id) : undefined,
    status: req.query.status ? String(req.query.status) : undefined,
    branch_id: req.query.branch_id ? String(req.query.branch_id) : undefined,
  });
  res.json(leaves);
});

hrRouter.post('/leaves', requirePermission('hr:manage', 'users:manage'), (req, res) => {
  const schema = z.object({
    employee_id: z.string().min(1, 'الموظف مطلوب'),
    leave_type_id: z.string().min(1, 'نوع الإجازة مطلوب'),
    start_date: z.string().min(1, 'تاريخ البداية مطلوب'),
    end_date: z.string().min(1, 'تاريخ النهاية مطلوب'),
    reason: z.string().optional(),
  });
  const parsed = schema.parse(req.body);
  const leave = createLeaveRequest(parsed);
  res.status(201).json(leave);
});

hrRouter.post('/leaves/:id/approve', requirePermission('hr:manage', 'users:manage'), (req, res) => {
  const actor = {
    id: (req as any).user?.id || 'system',
    name: (req as any).user?.name || 'مدير النظام',
  };
  const leave = updateLeaveStatus(String(req.params.id), 'APPROVED', actor, req.body.notes);
  res.json(leave);
});

hrRouter.post('/leaves/:id/reject', requirePermission('hr:manage', 'users:manage'), (req, res) => {
  const actor = {
    id: (req as any).user?.id || 'system',
    name: (req as any).user?.name || 'مدير النظام',
  };
  const leave = updateLeaveStatus(String(req.params.id), 'REJECTED', actor, req.body.notes);
  res.json(leave);
});

hrRouter.get(
  '/leaves/balance/:employeeId',
  requirePermission('hr:view', 'finance:view'),
  (req, res) => {
    const year = req.query.year ? String(req.query.year) : undefined;
    const balances = getEmployeeLeaveBalance(String(req.params.employeeId), year);
    res.json(balances);
  },
);

// --- Attendance ---

hrRouter.get('/attendance', requirePermission('hr:view', 'finance:view'), (req, res) => {
  const records = listAttendance({
    branch_id: req.query.branch_id ? String(req.query.branch_id) : undefined,
    date: req.query.date ? String(req.query.date) : undefined,
    month: req.query.month ? String(req.query.month) : undefined,
    employee_id: req.query.employee_id ? String(req.query.employee_id) : undefined,
  });
  res.json(records);
});

hrRouter.post('/attendance', requirePermission('hr:manage', 'users:manage'), (req, res) => {
  const schema = z.object({
    employee_id: z.string().min(1, 'الموظف مطلوب'),
    branch_id: z.string().min(1, 'الفرع مطلوب'),
    date: z.string().min(1, 'التاريخ مطلوب'),
    check_in: z.string().optional(),
    check_out: z.string().optional(),
    status: z.enum(['PRESENT', 'ABSENT', 'LATE', 'EXCUSED', 'REST_DAY']).default('PRESENT'),
    late_minutes: z.number().int().min(0).default(0),
    overtime_hours: z.number().min(0).default(0),
    notes: z.string().optional(),
  });
  const parsed = schema.parse(req.body);
  const att = recordAttendance(parsed);
  res.status(201).json(att);
});

hrRouter.post('/attendance/batch', requirePermission('hr:manage', 'users:manage'), (req, res) => {
  const schema = z.object({
    records: z.array(
      z.object({
        employee_id: z.string().min(1),
        branch_id: z.string().min(1),
        date: z.string().min(1),
        check_in: z.string().optional(),
        check_out: z.string().optional(),
        status: z.enum(['PRESENT', 'ABSENT', 'LATE', 'EXCUSED', 'REST_DAY']).default('PRESENT'),
        late_minutes: z.number().int().min(0).default(0),
        overtime_hours: z.number().min(0).default(0),
        notes: z.string().optional(),
      }),
    ),
  });
  const parsed = schema.parse(req.body);
  const result = batchRecordAttendance(parsed.records);
  res.status(201).json(result);
});

hrRouter.get(
  '/monthly-impact/:employeeId',
  requirePermission('hr:view', 'finance:view'),
  (req, res) => {
    const month = req.query.month
      ? String(req.query.month)
      : new Date().toISOString().substring(0, 7);
    const impact = getMonthlyAttendanceAndLeaveImpact(String(req.params.employeeId), month);
    res.json(impact);
  },
);
