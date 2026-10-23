import { all, one, run, id, now } from './db';
import { AppError } from './errors';
import type {
  LeaveType,
  EmployeeLeave,
  EmployeeAttendance,
  LeaveStatus,
  AttendanceStatus,
} from '../src/types';

// --- Leave Types ---

export function listLeaveTypes(): LeaveType[] {
  return all<LeaveType>('SELECT * FROM leave_types ORDER BY is_paid DESC, name ASC');
}

export function getLeaveType(id: string): LeaveType | null {
  return one<LeaveType>('SELECT * FROM leave_types WHERE id=?', id) || null;
}

// --- Leaves & Leave Balances ---

export function listEmployeeLeaves(params?: {
  employee_id?: string;
  status?: string;
  branch_id?: string;
}): EmployeeLeave[] {
  let query = `
    SELECT el.*, e.name AS employee_name, e.code AS employee_code,
           lt.name AS leave_type_name, lt.code AS leave_type_code,
           u.name AS approved_by_name
    FROM employee_leaves el
    JOIN employees e ON e.id = el.employee_id
    JOIN leave_types lt ON lt.id = el.leave_type_id
    LEFT JOIN users u ON u.id = el.approved_by
    WHERE 1=1
  `;
  const sqlParams: any[] = [];

  if (params?.employee_id) {
    query += ' AND el.employee_id = ?';
    sqlParams.push(params.employee_id);
  }
  if (params?.status) {
    query += ' AND el.status = ?';
    sqlParams.push(params.status);
  }
  if (params?.branch_id) {
    query += ' AND e.branch_id = ?';
    sqlParams.push(params.branch_id);
  }

  query += ' ORDER BY el.start_date DESC';
  return all<EmployeeLeave>(query, ...sqlParams);
}

export function createLeaveRequest(data: {
  employee_id: string;
  leave_type_id: string;
  start_date: string;
  end_date: string;
  reason?: string;
}): EmployeeLeave {
  const emp = one<{ id: string; name: string }>(
    'SELECT id, name FROM employees WHERE id=?',
    data.employee_id,
  );
  if (!emp) throw new AppError(404, 'الموظف غير موجود');

  const leaveType = getLeaveType(data.leave_type_id);
  if (!leaveType) throw new AppError(404, 'نوع الإجازة غير موجود');

  if (data.start_date > data.end_date) {
    throw new AppError(400, 'تاريخ البداية لا يمكن أن يكون بعد تاريخ النهاية');
  }

  // Calculate days between start and end (inclusive)
  const dStart = new Date(data.start_date);
  const dEnd = new Date(data.end_date);
  const diffTime = Math.abs(dEnd.getTime() - dStart.getTime());
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;

  // Check overlap with existing approved/pending leaves
  const overlap = one<{ id: string }>(
    `SELECT id FROM employee_leaves 
     WHERE employee_id = ? AND status IN ('PENDING', 'APPROVED')
       AND NOT (end_date < ? OR start_date > ?)`,
    data.employee_id,
    data.start_date,
    data.end_date,
  );
  if (overlap) {
    throw new AppError(400, 'يوجد طلب إجازة آخر متداخل مع هذه الفترة');
  }

  const leaveId = id();
  const ts = now();

  run(
    `INSERT INTO employee_leaves(id, employee_id, leave_type_id, start_date, end_date, total_days, reason, status, created_at)
     VALUES(?,?,?,?,?,?,?,'PENDING',?)`,
    leaveId,
    data.employee_id,
    data.leave_type_id,
    data.start_date,
    data.end_date,
    diffDays,
    data.reason || null,
    ts,
  );

  return one<EmployeeLeave>(
    `SELECT el.*, e.name AS employee_name, e.code AS employee_code,
            lt.name AS leave_type_name, lt.code AS leave_type_code
     FROM employee_leaves el
     JOIN employees e ON e.id = el.employee_id
     JOIN leave_types lt ON lt.id = el.leave_type_id
     WHERE el.id = ?`,
    leaveId,
  )!;
}

export function updateLeaveStatus(
  leaveId: string,
  status: LeaveStatus,
  actor: { id: string; name: string },
  notes?: string,
): EmployeeLeave {
  const leave = one<EmployeeLeave>('SELECT * FROM employee_leaves WHERE id=?', leaveId);
  if (!leave) throw new AppError(404, 'طلب الإجازة غير موجود');
  if (leave.status !== 'PENDING' && status !== 'CANCELLED') {
    throw new AppError(400, `لا يمكن تعديل طلب إجازة بحالة ${leave.status}`);
  }

  const ts = now();
  run(
    `UPDATE employee_leaves
     SET status = ?, approved_by = ?, approved_at = ?, notes = COALESCE(?, notes)
     WHERE id = ?`,
    status,
    actor.id,
    status === 'APPROVED' ? ts : null,
    notes || null,
    leaveId,
  );

  return one<EmployeeLeave>(
    `SELECT el.*, e.name AS employee_name, e.code AS employee_code,
            lt.name AS leave_type_name, lt.code AS leave_type_code,
            u.name AS approved_by_name
     FROM employee_leaves el
     JOIN employees e ON e.id = el.employee_id
     JOIN leave_types lt ON lt.id = el.leave_type_id
     LEFT JOIN users u ON u.id = el.approved_by
     WHERE el.id = ?`,
    leaveId,
  )!;
}

export function getEmployeeLeaveBalance(
  employeeId: string,
  year?: string,
): Array<{
  leave_type_id: string;
  leave_type_name: string;
  leave_type_code: string;
  days_allowed: number;
  days_taken: number;
  days_remaining: number;
  is_paid: number;
}> {
  const currentYear = year || new Date().getFullYear().toString();
  const types = listLeaveTypes();

  return types.map((lt) => {
    const takenRow = one<{ taken: number }>(
      `SELECT COALESCE(SUM(total_days), 0) AS taken
       FROM employee_leaves
       WHERE employee_id = ? AND leave_type_id = ? AND status = 'APPROVED'
         AND start_date LIKE ?`,
      employeeId,
      lt.id,
      `${currentYear}%`,
    );

    const taken = takenRow?.taken || 0;
    const remaining = lt.days_per_year > 0 ? Math.max(0, lt.days_per_year - taken) : 0;

    return {
      leave_type_id: lt.id,
      leave_type_name: lt.name,
      leave_type_code: lt.code,
      days_allowed: lt.days_per_year,
      days_taken: taken,
      days_remaining: remaining,
      is_paid: lt.is_paid,
    };
  });
}

// --- Attendance Management ---

export function listAttendance(params?: {
  branch_id?: string;
  date?: string;
  employee_id?: string;
  month?: string;
}): EmployeeAttendance[] {
  let query = `
    SELECT ea.*, e.name AS employee_name, e.code AS employee_code, b.name AS branch_name
    FROM employee_attendance ea
    JOIN employees e ON e.id = ea.employee_id
    JOIN branches b ON b.id = ea.branch_id
    WHERE 1=1
  `;
  const sqlParams: any[] = [];

  if (params?.branch_id) {
    query += ' AND ea.branch_id = ?';
    sqlParams.push(params.branch_id);
  }
  if (params?.date) {
    query += ' AND ea.date = ?';
    sqlParams.push(params.date);
  }
  if (params?.employee_id) {
    query += ' AND ea.employee_id = ?';
    sqlParams.push(params.employee_id);
  }
  if (params?.month) {
    query += ' AND ea.date LIKE ?';
    sqlParams.push(`${params.month}%`);
  }

  query += ' ORDER BY ea.date DESC, e.code ASC';
  return all<EmployeeAttendance>(query, ...sqlParams);
}

export function recordAttendance(data: {
  employee_id: string;
  branch_id: string;
  date: string;
  check_in?: string;
  check_out?: string;
  status?: AttendanceStatus;
  late_minutes?: number;
  overtime_hours?: number;
  notes?: string;
}): EmployeeAttendance {
  const emp = one<{ id: string; branch_id: string }>(
    'SELECT id, branch_id FROM employees WHERE id=?',
    data.employee_id,
  );
  if (!emp) throw new AppError(404, 'الموظف غير موجود');

  const status = data.status || 'PRESENT';
  const lateMinutes = Math.max(0, data.late_minutes || 0);
  const overtimeHours = Math.max(0, data.overtime_hours || 0);
  const ts = now();

  run(
    `INSERT INTO employee_attendance (id, employee_id, branch_id, date, check_in, check_out, status, late_minutes, overtime_hours, notes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(employee_id, date) DO UPDATE SET
       branch_id = excluded.branch_id,
       check_in = excluded.check_in,
       check_out = excluded.check_out,
       status = excluded.status,
       late_minutes = excluded.late_minutes,
       overtime_hours = excluded.overtime_hours,
       notes = excluded.notes`,
    id(),
    data.employee_id,
    data.branch_id || emp.branch_id,
    data.date,
    data.check_in || null,
    data.check_out || null,
    status,
    lateMinutes,
    overtimeHours,
    data.notes || null,
    ts,
  );

  return one<EmployeeAttendance>(
    `SELECT ea.*, e.name AS employee_name, e.code AS employee_code, b.name AS branch_name
     FROM employee_attendance ea
     JOIN employees e ON e.id = ea.employee_id
     JOIN branches b ON b.id = ea.branch_id
     WHERE ea.employee_id = ? AND ea.date = ?`,
    data.employee_id,
    data.date,
  )!;
}

export function batchRecordAttendance(
  records: Array<{
    employee_id: string;
    branch_id: string;
    date: string;
    check_in?: string;
    check_out?: string;
    status?: AttendanceStatus;
    late_minutes?: number;
    overtime_hours?: number;
    notes?: string;
  }>,
): { count: number } {
  let count = 0;
  for (const r of records) {
    recordAttendance(r);
    count++;
  }
  return { count };
}

/**
 * Computes monthly financial impact of attendance and leaves on an employee's salary.
 * Standard calculation base: 30 days/month, 8 hours/workday.
 * Hourly rate = basic_salary / 240 hours.
 * Overtime pay = hourly rate * overtime_hours * 1.5.
 * Absence deduction = (basic_salary / 30) * (absent_days + unpaid_leave_days) + (hourly_rate / 60) * late_minutes.
 */
export function getMonthlyAttendanceAndLeaveImpact(
  employeeId: string,
  month: string, // YYYY-MM
): {
  overtimeAmount: number;
  attendanceDeduction: number;
  overtimeHours: number;
  lateMinutes: number;
  absentDays: number;
  unpaidLeaveDays: number;
} {
  const emp = one<{ basic_salary: number }>(
    'SELECT basic_salary FROM employees WHERE id=?',
    employeeId,
  );
  const basicSalary = emp?.basic_salary || 0;

  // Hourly base in piasters (30 days * 8 hours = 240 hours/month)
  const hourlyRate = basicSalary > 0 ? basicSalary / 240 : 0;
  const dailyRate = basicSalary > 0 ? basicSalary / 30 : 0;

  // Attendance stats for the month
  const attStats = one<{
    total_overtime: number;
    total_late: number;
    absent_count: number;
  }>(
    `SELECT 
       COALESCE(SUM(overtime_hours), 0) AS total_overtime,
       COALESCE(SUM(late_minutes), 0) AS total_late,
       COALESCE(SUM(CASE WHEN status='ABSENT' THEN 1 ELSE 0 END), 0) AS absent_count
     FROM employee_attendance
     WHERE employee_id = ? AND date LIKE ?`,
    employeeId,
    `${month}%`,
  );

  const overtimeHours = attStats?.total_overtime || 0;
  const lateMinutes = attStats?.total_late || 0;
  const absentDays = attStats?.absent_count || 0;

  // Unpaid approved leaves during the month
  const unpaidLeaves = one<{ unpaid_days: number }>(
    `SELECT COALESCE(SUM(el.total_days), 0) AS unpaid_days
     FROM employee_leaves el
     JOIN leave_types lt ON lt.id = el.leave_type_id
     WHERE el.employee_id = ? AND el.status = 'APPROVED' AND lt.deduct_from_salary = 1
       AND el.start_date LIKE ?`,
    employeeId,
    `${month}%`,
  );
  const unpaidLeaveDays = unpaidLeaves?.unpaid_days || 0;

  // 1.5x overtime multiplier
  const overtimeAmount = Math.round(overtimeHours * hourlyRate * 1.5);

  // Absence and tardiness deduction
  const absencePenalty = Math.round((absentDays + unpaidLeaveDays) * dailyRate);
  const latePenalty = Math.round((lateMinutes / 60) * hourlyRate);
  const attendanceDeduction = absencePenalty + latePenalty;

  return {
    overtimeAmount,
    attendanceDeduction,
    overtimeHours,
    lateMinutes,
    absentDays,
    unpaidLeaveDays,
  };
}
