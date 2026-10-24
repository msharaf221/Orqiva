import { useState, type FormEvent } from 'react';
import {
  Users,
  Plus,
  CalendarCheck,
  Clock,
  DollarSign,
  CreditCard,
  CheckCircle2,
  XCircle,
} from 'lucide-react';
import {
  api,
  useData,
  useAction,
  Button,
  Field,
  Modal,
  Empty,
  Stat,
  money,
  toCents,
  today,
  formatDate,
  PageHeader,
} from '../lib';
import type {
  Employee,
  LeaveType,
  EmployeeLeave,
  EmployeeAttendance,
  PayrollRun,
  Branch,
} from '../types';
import { useBranch } from '../branch';
import {
  CreateAdvanceModal,
  CreatePayrollRunModal,
  PayrollRunDetailsModal,
} from './finance/payroll';

export function CreateEmployeeModalExtended({
  branches,
  onClose,
  onSaved,
}: {
  branches: Branch[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { busy, act } = useAction();

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const basic = toCents(f.get('basic_salary'));
    const variable = toCents(f.get('variable_salary') || '0');
    const insured = f.get('insured_salary') ? toCents(f.get('insured_salary')) : basic;

    const payload = {
      code: String(f.get('code')).trim(),
      name: String(f.get('name')).trim(),
      national_id: String(f.get('national_id') || '').trim() || undefined,
      phone: String(f.get('phone') || '').trim() || undefined,
      job_title: String(f.get('job_title')).trim(),
      department: String(f.get('department') || '').trim() || undefined,
      branch_id: String(f.get('branch_id')),
      employment_type: String(f.get('employment_type') || 'FULL_TIME'),
      basic_salary: basic,
      variable_salary: variable,
      insured_salary: insured,
      insurance_number: String(f.get('insurance_number') || '').trim() || undefined,
      hire_date: String(f.get('hire_date') || today()),
      contract_end_date: String(f.get('contract_end_date') || '').trim() || undefined,
      probation_end_date: String(f.get('probation_end_date') || '').trim() || undefined,
      emergency_contact: String(f.get('emergency_contact') || '').trim() || undefined,
    };

    void act(async () => {
      await api('/payroll/employees', 'POST', payload);
      onSaved();
    }, 'تم إضافة الموظف وعقد العمل بنجاح');
  };

  return (
    <Modal
      size="xl"
      showMaximize
      title="إضافة موظف جديد وضبط عقد العمل"
      description="تسجيل بيانات الموظف، شروط العقد، الراتب الأساسي والمتغير، وفترة التجربة والتأمينات."
      onClose={onClose}
    >
      <form onSubmit={submit}>
        <div className="modal-body form-grid">
          <div className="grid three" style={{ marginBottom: '12px' }}>
            <Field label="كود الموظف">
              <input name="code" placeholder="مثال: EMP-001" required autoFocus />
            </Field>
            <Field label="اسم الموظف رباعي">
              <input name="name" placeholder="محمد أحمد علي..." required />
            </Field>
            <Field label="الرقم القومي (14 رقم)">
              <input name="national_id" placeholder="295..." maxLength={14} />
            </Field>
          </div>

          <div className="grid three" style={{ marginBottom: '12px' }}>
            <Field label="المسمى الوظيفي">
              <input name="job_title" placeholder="كاشير، محاسب، مدير فرع..." required />
            </Field>
            <Field label="القسم">
              <input name="department" placeholder="المبيعات، الحسابات..." />
            </Field>
            <Field label="فرع العمل">
              <select name="branch_id" required defaultValue={branches[0]?.id || ''}>
                <option value="">اختر الفرع...</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <div className="grid three" style={{ marginBottom: '12px' }}>
            <Field label="نوع العقد">
              <select name="employment_type" defaultValue="FULL_TIME">
                <option value="FULL_TIME">دوام كامل (دائم)</option>
                <option value="PART_TIME">دوام جزئي</option>
                <option value="CONTRACT">محدد المدة (عقد سنوي)</option>
              </select>
            </Field>
            <Field label="تاريخ التعيين">
              <input name="hire_date" type="date" defaultValue={today()} required />
            </Field>
            <Field label="تاريخ انتهاء فترة التجربة">
              <input name="probation_end_date" type="date" />
            </Field>
          </div>

          <div className="grid two" style={{ marginBottom: '12px' }}>
            <Field label="تاريخ انتهاء العقد (إن وجد)">
              <input name="contract_end_date" type="date" />
            </Field>
            <Field label="بيانات الطوارئ (الاسم ورقم الهاتف)">
              <input name="emergency_contact" placeholder="أحمد (أخ) - 01012345678" />
            </Field>
          </div>

          <div className="grid three" style={{ marginBottom: '12px' }}>
            <Field label="الراتب الأساسي (ج.م)">
              <input
                name="basic_salary"
                type="number"
                step="0.01"
                min="0"
                placeholder="0.00"
                required
              />
            </Field>
            <Field label="الراتب المتغير / الحوافز (ج.م)">
              <input
                name="variable_salary"
                type="number"
                step="0.01"
                min="0"
                placeholder="0.00"
                defaultValue="0.00"
              />
            </Field>
            <Field label="الأجر التأميني (للتأمينات الاجتماعية)">
              <input
                name="insured_salary"
                type="number"
                step="0.01"
                min="0"
                placeholder="افتراضياً نفس الأساسي"
              />
            </Field>
          </div>

          <div className="grid two" style={{ marginBottom: '12px' }}>
            <Field label="رقم الهاتف">
              <input name="phone" placeholder="010..." type="tel" />
            </Field>
            <Field label="الرقم التأميني">
              <input name="insurance_number" placeholder="مثال: 12345678" />
            </Field>
          </div>
        </div>

        <div className="modal-footer">
          <Button variant="secondary" type="button" onClick={onClose}>
            إلغاء
          </Button>
          <Button type="submit" busy={busy}>
            حفظ بيانات الموظف
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function RecordAttendanceModal({
  employees,
  branches,
  onClose,
  onSaved,
}: {
  employees: Employee[];
  branches: Branch[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { busy, act } = useAction();
  const { active: currentBranch } = useBranch();

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const late = Number(f.get('late_minutes') || '0');
    const overtime = Number(f.get('overtime_hours') || '0');

    const payload = {
      employee_id: String(f.get('employee_id')),
      branch_id: String(f.get('branch_id') || currentBranch?.id || branches[0]?.id),
      date: String(f.get('date') || today()),
      status: String(f.get('status') || 'PRESENT'),
      check_in: String(f.get('check_in') || '').trim() || undefined,
      check_out: String(f.get('check_out') || '').trim() || undefined,
      late_minutes: late,
      overtime_hours: overtime,
      notes: String(f.get('notes') || '').trim() || undefined,
    };

    void act(async () => {
      await api('/hr/attendance', 'POST', payload);
      onSaved();
    }, 'تم تسجيل الحضور والانصراف بنجاح');
  };

  return (
    <Modal
      size="md"
      showMaximize
      title="تسجيل الحضور والانصراف لموظف"
      description="إثبات الحضور أو الغياب أو التأخير وساعات الإضافي، وسيتم تسويتها آلياً في مسير الرواتب."
      onClose={onClose}
    >
      <form onSubmit={submit}>
        <div className="modal-body form-grid">
          <div className="grid two" style={{ marginBottom: '12px' }}>
            <Field label="الموظف">
              <select name="employee_id" required defaultValue={employees[0]?.id || ''}>
                {employees.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.code} - {emp.name} ({emp.job_title})
                  </option>
                ))}
              </select>
            </Field>
            <Field label="الفرع">
              <select name="branch_id" defaultValue={currentBranch?.id || branches[0]?.id || ''}>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <div className="grid two" style={{ marginBottom: '12px' }}>
            <Field label="التاريخ">
              <input name="date" type="date" defaultValue={today()} required />
            </Field>
            <Field label="حالة الحضور">
              <select name="status" defaultValue="PRESENT">
                <option value="PRESENT">حاضر (Present)</option>
                <option value="LATE">متأخر (Late)</option>
                <option value="ABSENT">غائب بدون إذن (Absent)</option>
                <option value="EXCUSED">غياب مبرر / مأذون (Excused)</option>
                <option value="REST_DAY">يوم راحة أسبوعية (Rest Day)</option>
              </select>
            </Field>
          </div>

          <div className="grid two" style={{ marginBottom: '12px' }}>
            <Field label="وقت الحضور">
              <input name="check_in" type="time" defaultValue="09:00" />
            </Field>
            <Field label="وقت الانصراف">
              <input name="check_out" type="time" defaultValue="17:00" />
            </Field>
          </div>

          <div className="grid two" style={{ marginBottom: '12px' }}>
            <Field label="دقائق التأخير (إن وجدت)">
              <input name="late_minutes" type="number" min="0" defaultValue="0" />
            </Field>
            <Field label="ساعات العمل الإضافي (Overtime)">
              <input name="overtime_hours" type="number" step="0.5" min="0" defaultValue="0" />
            </Field>
          </div>

          <Field label="ملاحظات">
            <input name="notes" placeholder="سبب التأخير، إذن مسبق..." />
          </Field>
        </div>

        <div className="modal-footer">
          <Button variant="secondary" type="button" onClick={onClose}>
            إلغاء
          </Button>
          <Button type="submit" busy={busy}>
            تأكيد تسجيل الحضور
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function CreateLeaveRequestModal({
  employees,
  leaveTypes,
  onClose,
  onSaved,
}: {
  employees: Employee[];
  leaveTypes: LeaveType[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { busy, act } = useAction();

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const payload = {
      employee_id: String(f.get('employee_id')),
      leave_type_id: String(f.get('leave_type_id')),
      start_date: String(f.get('start_date')),
      end_date: String(f.get('end_date')),
      reason: String(f.get('reason') || '').trim() || undefined,
    };

    void act(async () => {
      await api('/hr/leaves', 'POST', payload);
      onSaved();
    }, 'تم تقديم طلب الإجازة بنجاح');
  };

  return (
    <Modal
      size="lg"
      showMaximize
      title="تقديم طلب إجازة موظف"
      description="طلب إجازة اعتيادية أو عارضة أو مرضية، مع التحقق الآلي من عدم التداخل ورصيد الإجازات المتاح."
      onClose={onClose}
    >
      <form onSubmit={submit}>
        <div className="modal-body form-grid">
          <div className="grid two" style={{ marginBottom: '12px' }}>
            <Field label="الموظف">
              <select name="employee_id" required defaultValue={employees[0]?.id || ''}>
                {employees.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.code} - {emp.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="نوع الإجازة">
              <select name="leave_type_id" required defaultValue={leaveTypes[0]?.id || ''}>
                {leaveTypes.map((lt) => (
                  <option key={lt.id} value={lt.id}>
                    {lt.name} ({lt.days_per_year} يوم/سنة - {lt.is_paid ? 'مدفوعة' : 'غير مدفوعة'})
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <div className="grid two" style={{ marginBottom: '12px' }}>
            <Field label="تاريخ البدء">
              <input name="start_date" type="date" defaultValue={today()} required />
            </Field>
            <Field label="تاريخ الانتهاء">
              <input name="end_date" type="date" defaultValue={today()} required />
            </Field>
          </div>

          <Field label="سبب الإجازة">
            <textarea name="reason" rows={2} placeholder="ظرف طارئ، إجازة سنوية..." />
          </Field>
        </div>

        <div className="modal-footer">
          <Button variant="secondary" type="button" onClick={onClose}>
            إلغاء
          </Button>
          <Button type="submit" busy={busy}>
            تقديم الطلب
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function HR() {
  const [tab, setTab] = useState<'employees' | 'attendance' | 'leaves' | 'payroll'>('employees');
  const [selectedDate, setSelectedDate] = useState(today());
  const { branches } = useBranch();
  const { busy, act } = useAction();

  const [addingEmployee, setAddingEmployee] = useState(false);
  const [recordingAttendance, setRecordingAttendance] = useState(false);
  const [addingLeave, setAddingLeave] = useState(false);
  const [addingAdvance, setAddingAdvance] = useState<Employee | null>(null);
  const [addingPayrollRun, setAddingPayrollRun] = useState(false);
  const [viewingRunId, setViewingRunId] = useState<string | null>(null);

  // Data endpoints
  const employeesData = useData<Employee[]>('/payroll/employees');
  const leaveTypesData = useData<LeaveType[]>('/hr/leave-types');
  const leavesData = useData<EmployeeLeave[]>('/hr/leaves');
  const attendanceData = useData<EmployeeAttendance[]>(`/hr/attendance?date=${selectedDate}`);
  const payrollRunsData = useData<PayrollRun[]>('/payroll/payroll-runs');

  const employees = employeesData.data || [];
  const leaveTypes = leaveTypesData.data || [];
  const leaves = leavesData.data || [];
  const attendanceList = attendanceData.data || [];
  const payrollRuns = payrollRunsData.data || [];

  const reloadAll = () => {
    employeesData.reload();
    leaveTypesData.reload();
    leavesData.reload();
    attendanceData.reload();
    payrollRunsData.reload();
  };

  const approveLeave = (leaveId: string) => {
    void act(async () => {
      await api(`/hr/leaves/${leaveId}/approve`, 'POST');
      reloadAll();
    }, 'تمت الموافقة على طلب الإجازة بنجاح');
  };

  const rejectLeave = (leaveId: string) => {
    void act(async () => {
      await api(`/hr/leaves/${leaveId}/reject`, 'POST');
      reloadAll();
    }, 'تم رفض طلب الإجازة');
  };

  // KPI Calculations
  const activeEmployees = employees.filter((e) => e.active === 1);
  const presentCount = attendanceList.filter(
    (a) => a.status === 'PRESENT' || a.status === 'LATE',
  ).length;
  const pendingLeaves = leaves.filter((l) => l.status === 'PENDING').length;
  const latestPayrollRun = payrollRuns[0];

  return (
    <>
      <PageHeader
        eyebrow="إدارة رأس المال البشري"
        title="الموارد البشرية والرواتب (HR & Payroll)"
        description="إدارة ملفات الموظفين وعقود العمل، تتبع الحضور والانصراف، إدارة أرصدة وطلبات الإجازات، ومسيرات الرواتب والسلف بالتكامل المحاسبي."
        actions={
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <Button onClick={() => setAddingEmployee(true)}>
              <Plus size={18} /> موظف وعقد جديد
            </Button>
            <Button variant="secondary" onClick={() => setRecordingAttendance(true)}>
              <Clock size={18} /> تسجيل حضور
            </Button>
            <Button variant="secondary" onClick={() => setAddingLeave(true)}>
              <CalendarCheck size={18} /> طلب إجازة
            </Button>
            <Button variant="secondary" onClick={() => setAddingPayrollRun(true)}>
              <DollarSign size={18} /> مسير رواتب
            </Button>
          </div>
        }
      />

      {/* KPI Stats */}
      <div className="stats-grid four">
        <Stat
          label="الموظفون النشطون"
          value={String(activeEmployees.length)}
          unit="موظف"
          icon={<Users size={20} />}
          tone="blue"
          foot="إجمالي القوة العاملة في كل الفروع"
        />
        <Stat
          label="حضور اليوم"
          value={String(presentCount)}
          unit="حاضر"
          icon={<Clock size={20} />}
          tone="green"
          foot={`بتاريخ ${formatDate(selectedDate, true)}`}
        />
        <Stat
          label="طلبات إجازة معلقة"
          value={String(pendingLeaves)}
          unit="طلب"
          icon={<CalendarCheck size={20} />}
          tone="amber"
          foot="بانتظار مراجعة وقبول الإدارة"
        />
        <Stat
          label="آخر مسير رواتب"
          value={latestPayrollRun ? money(latestPayrollRun.total_net) : '0'}
          unit="ج.م"
          icon={<CreditCard size={20} />}
          tone="purple"
          foot={
            latestPayrollRun
              ? `${latestPayrollRun.month} (${latestPayrollRun.status === 'CONFIRMED' ? 'معتمد' : 'مسودة'})`
              : 'لم يتم إنشاء مسير بعد'
          }
        />
      </div>

      {/* Tabs */}
      <div className="tabs" style={{ marginTop: '16px', marginBottom: '16px' }}>
        <button className={tab === 'employees' ? 'active' : ''} onClick={() => setTab('employees')}>
          <Users size={16} />
          الموظفون والعقود
          <span>{activeEmployees.length}</span>
        </button>
        <button
          className={tab === 'attendance' ? 'active' : ''}
          onClick={() => setTab('attendance')}
        >
          <Clock size={16} />
          سجل الحضور والانصراف
          <span>{attendanceList.length}</span>
        </button>
        <button className={tab === 'leaves' ? 'active' : ''} onClick={() => setTab('leaves')}>
          <CalendarCheck size={16} />
          الإجازات والأرصدة
          <span>{pendingLeaves}</span>
        </button>
        <button className={tab === 'payroll' ? 'active' : ''} onClick={() => setTab('payroll')}>
          <DollarSign size={16} />
          مسيرات الرواتب والسلف
          <span>{payrollRuns.length}</span>
        </button>
      </div>

      {/* Tab 1: Employees & Contracts */}
      {tab === 'employees' && (
        <div className="card table-card">
          <table className="table">
            <thead>
              <tr>
                <th>كود الموظف</th>
                <th>الاسم والوظيفة</th>
                <th>القسم والفرع</th>
                <th>نوع العقد</th>
                <th>فترة التجربة / نهاية العقد</th>
                <th>الراتب الأساسي والمتغير</th>
                <th>بيانات الطوارئ</th>
                <th>الإجراءات</th>
              </tr>
            </thead>
            <tbody>
              {employees.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ textAlign: 'center', padding: '30px' }}>
                    <Empty
                      title="لا يوجد موظفون مسجلون"
                      description="ابدأ بإضافة موظفي الشركة وضبط عقودهم"
                    />
                  </td>
                </tr>
              ) : (
                employees.map((emp) => (
                  <tr key={emp.id}>
                    <td>
                      <span className="branch-code">{emp.code}</span>
                    </td>
                    <td>
                      <strong>{emp.name}</strong>
                      <div style={{ fontSize: '11.5px', color: 'var(--slate-500)' }}>
                        {emp.job_title}
                      </div>
                    </td>
                    <td>
                      <div>{emp.department || 'عام'}</div>
                      <small style={{ color: 'var(--slate-500)' }}>{emp.branch_name}</small>
                    </td>
                    <td>
                      <span
                        className={`contract-badge ${
                          emp.employment_type === 'CONTRACT'
                            ? 'fixed'
                            : emp.probation_end_date && emp.probation_end_date > today()
                              ? 'probation'
                              : 'permanent'
                        }`}
                      >
                        {emp.employment_type === 'CONTRACT'
                          ? 'محدد المدة'
                          : emp.employment_type === 'PART_TIME'
                            ? 'دوام جزئي'
                            : 'دوام كامل (دائم)'}
                      </span>
                    </td>
                    <td>
                      {emp.probation_end_date && emp.probation_end_date > today() ? (
                        <span style={{ color: '#b45309', fontSize: '12px', fontWeight: 600 }}>
                          تجربة حتى {formatDate(emp.probation_end_date, true)}
                        </span>
                      ) : emp.contract_end_date ? (
                        <span style={{ fontSize: '12px' }}>
                          ينتهي {formatDate(emp.contract_end_date, true)}
                        </span>
                      ) : (
                        <span style={{ color: 'var(--slate-400)', fontSize: '12px' }}>مستمر</span>
                      )}
                    </td>
                    <td>
                      <strong>{money(emp.basic_salary)}</strong>
                      {emp.variable_salary > 0 && (
                        <small style={{ color: 'var(--slate-500)' }}>
                          {' '}
                          + {money(emp.variable_salary)}
                        </small>
                      )}
                      <small> ج.م</small>
                    </td>
                    <td>
                      <small style={{ color: 'var(--slate-600)' }}>
                        {emp.emergency_contact || emp.phone || '—'}
                      </small>
                    </td>
                    <td>
                      <Button variant="ghost" onClick={() => setAddingAdvance(emp)}>
                        صرف سلفة
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Tab 2: Attendance Tracking */}
      {tab === 'attendance' && (
        <div>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '16px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span style={{ fontWeight: 600 }}>تاريخ الحضور:</span>
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                style={{
                  padding: '6px 12px',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--slate-300)',
                }}
              />
            </div>
            <Button onClick={() => setRecordingAttendance(true)}>
              <Plus size={16} /> تسجيل حضور لموظف
            </Button>
          </div>

          <div className="card table-card">
            <table className="table">
              <thead>
                <tr>
                  <th>الموظف</th>
                  <th>الفرع</th>
                  <th>الحالة</th>
                  <th>وقت الحضور</th>
                  <th>وقت الانصراف</th>
                  <th>دقائق التأخير</th>
                  <th>ساعات الإضافي</th>
                  <th>ملاحظات</th>
                </tr>
              </thead>
              <tbody>
                {attendanceList.length === 0 ? (
                  <tr>
                    <td colSpan={8} style={{ textAlign: 'center', padding: '30px' }}>
                      <Empty
                        title="لا توجد سجلات حضور مسجلة لهذا التاريخ"
                        description="سجل الحضور والانصراف للموظفين لاحتساب التأخير والإضافي"
                      />
                    </td>
                  </tr>
                ) : (
                  attendanceList.map((att) => (
                    <tr key={att.id}>
                      <td>
                        <strong>{att.employee_name}</strong>
                        <div style={{ fontSize: '11px', color: 'var(--slate-500)' }}>
                          #{att.employee_code}
                        </div>
                      </td>
                      <td>{att.branch_name || 'الفرع الرئيسي'}</td>
                      <td>
                        <span
                          className={`att-status-badge ${
                            att.status === 'PRESENT'
                              ? 'present'
                              : att.status === 'LATE'
                                ? 'late'
                                : att.status === 'ABSENT'
                                  ? 'absent'
                                  : 'leave'
                          }`}
                        >
                          {att.status === 'PRESENT'
                            ? 'حاضر'
                            : att.status === 'LATE'
                              ? 'متأخر'
                              : att.status === 'ABSENT'
                                ? 'غائب'
                                : att.status === 'REST_DAY'
                                  ? 'راحة'
                                  : 'إجازة'}
                        </span>
                      </td>
                      <td>{att.check_in || '—'}</td>
                      <td>{att.check_out || '—'}</td>
                      <td>
                        {att.late_minutes > 0 ? (
                          <span style={{ color: '#b45309', fontWeight: 600 }}>
                            {att.late_minutes} دقيقة
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td>
                        {att.overtime_hours > 0 ? (
                          <span style={{ color: '#15803d', fontWeight: 600 }}>
                            +{att.overtime_hours} ساعة
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td>
                        <small style={{ color: 'var(--slate-600)' }}>{att.notes || '—'}</small>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 3: Leaves & Balances */}
      {tab === 'leaves' && (
        <div>
          {/* Leave Types Overview */}
          <div className="grid three" style={{ marginBottom: '16px' }}>
            {leaveTypes.map((lt) => (
              <div key={lt.id} className="leave-balance-card">
                <div>
                  <strong style={{ fontSize: '15px', display: 'block' }}>{lt.name}</strong>
                  <span style={{ fontSize: '12px', color: 'var(--slate-500)' }}>
                    {lt.is_paid ? 'إجازة مدفوعة الأجر' : 'غير مدفوعة (تخصم من الراتب)'}
                  </span>
                </div>
                <div style={{ textAlign: 'left' }}>
                  <span style={{ fontSize: '18px', fontWeight: 800, color: 'var(--indigo-600)' }}>
                    {lt.days_per_year}
                  </span>
                  <small style={{ display: 'block', fontSize: '11px', color: 'var(--slate-500)' }}>
                    يوم / سنة
                  </small>
                </div>
              </div>
            ))}
          </div>

          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '12px',
            }}
          >
            <h3 style={{ margin: 0, fontSize: '16px' }}>طلبات الإجازات ومسار الاعتماد</h3>
            <Button onClick={() => setAddingLeave(true)}>
              <Plus size={16} /> تقديم طلب إجازة
            </Button>
          </div>

          <div className="card table-card">
            <table className="table">
              <thead>
                <tr>
                  <th>الموظف</th>
                  <th>نوع الإجازة</th>
                  <th>الفترة</th>
                  <th>عدد الأيام</th>
                  <th>السبب</th>
                  <th>الحالة</th>
                  <th>الإجراءات</th>
                </tr>
              </thead>
              <tbody>
                {leaves.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ textAlign: 'center', padding: '30px' }}>
                      <Empty
                        title="لا توجد طلبات إجازة"
                        description="طلبات إجازات الموظفين ستظهر هنا للموافقة أو الرفض"
                      />
                    </td>
                  </tr>
                ) : (
                  leaves.map((l) => (
                    <tr key={l.id}>
                      <td>
                        <strong>{l.employee_name}</strong>
                        <div style={{ fontSize: '11px', color: 'var(--slate-500)' }}>
                          #{l.employee_code}
                        </div>
                      </td>
                      <td>
                        <span style={{ fontWeight: 600 }}>{l.leave_type_name}</span>
                      </td>
                      <td>
                        {formatDate(l.start_date, true)} إلى {formatDate(l.end_date, true)}
                      </td>
                      <td>
                        <strong>{l.total_days}</strong> أيام
                      </td>
                      <td>
                        <small style={{ color: 'var(--slate-600)' }}>{l.reason || '—'}</small>
                      </td>
                      <td>
                        <span
                          style={{
                            fontSize: '11.5px',
                            fontWeight: 700,
                            padding: '3px 8px',
                            borderRadius: '4px',
                            background:
                              l.status === 'APPROVED'
                                ? '#dcfce7'
                                : l.status === 'REJECTED'
                                  ? '#fee2e2'
                                  : '#fef3c7',
                            color:
                              l.status === 'APPROVED'
                                ? '#15803d'
                                : l.status === 'REJECTED'
                                  ? '#b91c1c'
                                  : '#b45309',
                          }}
                        >
                          {l.status === 'APPROVED'
                            ? 'مقبولة'
                            : l.status === 'REJECTED'
                              ? 'مرفوضة'
                              : 'معلقة'}
                        </span>
                      </td>
                      <td>
                        {l.status === 'PENDING' && (
                          <div style={{ display: 'flex', gap: '6px' }}>
                            <Button
                              variant="ghost"
                              onClick={() => approveLeave(l.id)}
                              busy={busy}
                              title="قبول الإجازة"
                            >
                              <CheckCircle2 size={16} color="#15803d" /> قبول
                            </Button>
                            <Button
                              variant="ghost"
                              onClick={() => rejectLeave(l.id)}
                              busy={busy}
                              title="رفض الإجازة"
                            >
                              <XCircle size={16} color="#b91c1c" /> رفض
                            </Button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 4: Payroll & Advances */}
      {tab === 'payroll' && (
        <div>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '16px',
            }}
          >
            <h3 style={{ margin: 0, fontSize: '16px' }}>مسيرات الرواتب الشهرية</h3>
            <Button onClick={() => setAddingPayrollRun(true)}>
              <Plus size={16} /> إنشاء مسير رواتب جديد
            </Button>
          </div>

          <div className="card table-card">
            <table className="table">
              <thead>
                <tr>
                  <th>الشهر</th>
                  <th>الفرع</th>
                  <th>إجمالي الأجور</th>
                  <th>تأمينات الموظف</th>
                  <th>تأمينات الشركة</th>
                  <th>الضرائب وصندوق الشهداء</th>
                  <th>استقطاع السلف</th>
                  <th>صافي الرواتب المستحقة</th>
                  <th>الحالة</th>
                  <th>الإجراء</th>
                </tr>
              </thead>
              <tbody>
                {payrollRuns.length === 0 ? (
                  <tr>
                    <td colSpan={10} style={{ textAlign: 'center', padding: '30px' }}>
                      <Empty
                        title="لا توجد مسيرات رواتب مسجلة"
                        description="أنشئ مسير رواتب شهري لحساب الرواتب والضرائب والتأمينات آلياً"
                      />
                    </td>
                  </tr>
                ) : (
                  payrollRuns.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <strong>{r.month}</strong>
                      </td>
                      <td>{r.branch_name || 'كل الفروع'}</td>
                      <td>{money(r.total_gross)}</td>
                      <td style={{ color: '#dc2626' }}>
                        -{money(r.total_social_insurance_employee)}
                      </td>
                      <td style={{ color: '#7c3aed' }}>
                        {money(r.total_social_insurance_employer)}
                      </td>
                      <td style={{ color: '#dc2626' }}>
                        -{money(r.total_income_tax + r.total_martyrs_fund)}
                      </td>
                      <td style={{ color: '#d97706' }}>-{money(r.total_advances)}</td>
                      <td>
                        <strong style={{ color: '#16a34a' }}>{money(r.total_net)}</strong> ج.م
                      </td>
                      <td>
                        <span
                          style={{
                            fontSize: '11.5px',
                            fontWeight: 700,
                            padding: '3px 8px',
                            borderRadius: '4px',
                            background: r.status === 'CONFIRMED' ? '#dcfce7' : '#fef3c7',
                            color: r.status === 'CONFIRMED' ? '#15803d' : '#b45309',
                          }}
                        >
                          {r.status === 'CONFIRMED' ? 'معتمد ومرحل' : 'مسودة'}
                        </span>
                      </td>
                      <td>
                        <Button variant="ghost" onClick={() => setViewingRunId(r.id)}>
                          عرض القسائم
                        </Button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modals */}
      {addingEmployee && (
        <CreateEmployeeModalExtended
          branches={branches}
          onClose={() => setAddingEmployee(false)}
          onSaved={() => {
            setAddingEmployee(false);
            reloadAll();
          }}
        />
      )}

      {recordingAttendance && (
        <RecordAttendanceModal
          employees={activeEmployees}
          branches={branches}
          onClose={() => setRecordingAttendance(false)}
          onSaved={() => {
            setRecordingAttendance(false);
            reloadAll();
          }}
        />
      )}

      {addingLeave && (
        <CreateLeaveRequestModal
          employees={activeEmployees}
          leaveTypes={leaveTypes}
          onClose={() => setAddingLeave(false)}
          onSaved={() => {
            setAddingLeave(false);
            reloadAll();
          }}
        />
      )}

      {addingAdvance && (
        <CreateAdvanceModal
          employee={addingAdvance}
          onClose={() => setAddingAdvance(null)}
          onSaved={() => {
            setAddingAdvance(null);
            reloadAll();
          }}
        />
      )}

      {addingPayrollRun && (
        <CreatePayrollRunModal
          branches={branches}
          onClose={() => setAddingPayrollRun(false)}
          onSaved={() => {
            setAddingPayrollRun(false);
            reloadAll();
          }}
        />
      )}

      {viewingRunId && (
        <PayrollRunDetailsModal
          runId={viewingRunId}
          onClose={() => setViewingRunId(null)}
          onConfirmed={() => {
            reloadAll();
          }}
        />
      )}
    </>
  );
}
