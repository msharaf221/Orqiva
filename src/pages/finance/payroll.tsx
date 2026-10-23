import { useState, type FormEvent } from 'react';
import { Users, Plus, DollarSign, FileText, CreditCard, Eye, ShieldCheck } from 'lucide-react';
import {
  api,
  useData,
  useAction,
  Button,
  Field,
  SearchBox,
  Modal,
  Loading,
  ErrorState,
  Empty,
  Stat,
  Pagination,
  money,
  toCents,
  today,
} from '../../lib';
import type { Employee, PayrollRun, Branch } from '../../types';
import { useBranch } from '../../branch';

export function CreateEmployeeModal({
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
    };

    void act(async () => {
      await api('/payroll/employees', 'POST', payload);
      onSaved();
    }, 'تم إضافة الموظف وضبط بيانات التأمينات والراتب بنجاح');
  };

  return (
    <Modal
      wide
      title="إضافة موظف جديد وضبط الراتب"
      description="تسجيل بيانات الموظف، الراتب الأساسي والمتغير، والأجر التأميني لحساب التأمينات الاجتماعية."
      onClose={onClose}
    >
      <form onSubmit={submit}>
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
          <Field label="نوع التعيين">
            <select name="employment_type" defaultValue="FULL_TIME">
              <option value="FULL_TIME">دوام كامل (تأمين شامل)</option>
              <option value="PART_TIME">دوام جزئي</option>
              <option value="CONTRACT">عقد محدد المدة</option>
            </select>
          </Field>
          <Field label="رقم التأمين الاجتماعي">
            <input name="insurance_number" placeholder="رقم المنشأة / التأمين..." />
          </Field>
          <Field label="تاريخ التعيين">
            <input name="hire_date" type="date" defaultValue={today()} required />
          </Field>
        </div>

        <div className="grid three" style={{ marginBottom: '16px' }}>
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
          <Field label="الراتب المتغير / البدلات (ج.م)">
            <input name="variable_salary" type="number" step="0.01" min="0" defaultValue="0" />
          </Field>
          <Field label="الأجر التأميني (للتأمينات 11% / 18.75%)">
            <input
              name="insured_salary"
              type="number"
              step="0.01"
              min="0"
              placeholder="افتراضي: الأساسي"
            />
          </Field>
        </div>

        <div className="modal-footer">
          <Button variant="secondary" type="button" onClick={onClose}>
            إلغاء
          </Button>
          <Button type="submit" busy={busy}>
            حفظ الموظف
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function CreateAdvanceModal({
  employee,
  onClose,
  onSaved,
}: {
  employee: Employee;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { busy, act } = useAction();

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const payload = {
      amount: toCents(f.get('amount')),
      date: String(f.get('date') || today()),
      notes: String(f.get('notes') || '').trim() || undefined,
    };

    void act(async () => {
      await api(`/payroll/employees/${employee.id}/advances`, 'POST', payload);
      onSaved();
    }, `تم تسجيل سلفة للموظف ${employee.name} وسيتم استقطاعها من مسير الراتب`);
  };

  return (
    <Modal
      title={`تسجيل سلفة للموظف: ${employee.name}`}
      description="سيتم إثبات السلفة وتوجيهها للاستقطاع الآلي في أقرب مسير رواتب قادم."
      onClose={onClose}
    >
      <form onSubmit={submit}>
        <div className="grid two" style={{ marginBottom: '12px' }}>
          <Field label="مبلغ السلفة (ج.م)">
            <input
              name="amount"
              type="number"
              step="0.01"
              min="1"
              placeholder="0.00"
              required
              autoFocus
            />
          </Field>
          <Field label="تاريخ صرف السلفة">
            <input name="date" type="date" defaultValue={today()} required />
          </Field>
        </div>

        <Field label="ملاحظات / سبب السلفة">
          <textarea name="notes" rows={2} placeholder="سلفة شخصية، علاج..." />
        </Field>

        <div className="modal-footer">
          <Button variant="secondary" type="button" onClick={onClose}>
            إلغاء
          </Button>
          <Button type="submit" busy={busy}>
            تأكيد تسجيل السلفة
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function CreatePayrollRunModal({
  branches,
  onClose,
  onSaved,
}: {
  branches: Branch[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { busy, act } = useAction();
  const currentMonth = today().slice(0, 7); // YYYY-MM

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const branchId = f.get('branch_id');
    const payload = {
      month: String(f.get('month')),
      branch_id: branchId ? String(branchId) : undefined,
      notes: String(f.get('notes') || '').trim() || undefined,
    };

    void act(async () => {
      await api('/payroll/payroll-runs', 'POST', payload);
      onSaved();
    }, 'تم احتساب مسير الرواتب والضرائب والتأمينات وفق القوانين المصرية بنجاح');
  };

  return (
    <Modal
      title="إنشاء مسير رواتب شهري"
      description="يقوم النظام باحتساب التأمينات الاجتماعية (11% موظف، 18.75% صاحب عمل)، صندوق الشهداء (0.05%)، والشرائح الضريبية التصاعدية واستقطاع السلف."
      onClose={onClose}
    >
      <form onSubmit={submit}>
        <div className="grid two" style={{ marginBottom: '12px' }}>
          <Field label="شهر المسير (YYYY-MM)">
            <input name="month" type="month" defaultValue={currentMonth} required autoFocus />
          </Field>
          <Field label="الفرع (اختياري)">
            <select name="branch_id">
              <option value="">جميع الفروع (مسير شامل)</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <Field label="ملاحظات المسير">
          <textarea name="notes" rows={2} placeholder="مسير رواتب شهر..." />
        </Field>

        <div className="modal-footer">
          <Button variant="secondary" type="button" onClick={onClose}>
            إلغاء
          </Button>
          <Button type="submit" busy={busy}>
            احتساب وإنشاء المسير
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function PayrollRunDetailsModal({
  runId,
  onClose,
  onConfirmed,
}: {
  runId: string;
  onClose: () => void;
  onConfirmed: () => void;
}) {
  const runData = useData<PayrollRun>(`/payroll/payroll-runs/${runId}`);
  const { busy, act } = useAction();

  const pr = runData.data;

  const confirmRun = () => {
    if (!confirm('هل أنت متأكد من اعتماد مسير الرواتب وترحيل القيود المحاسبية لدفتر الأستاذ؟'))
      return;
    void act(async () => {
      await api(`/payroll/payroll-runs/${runId}/confirm`, 'POST', {});
      onConfirmed();
    }, 'تم ترحيل مسير الرواتب لدفتر الأستاذ العام بنجاح');
  };

  return (
    <Modal
      xwide
      title={`مسير الرواتب لشهر: ${pr?.month || '—'}`}
      description="مفردات المرتبات الشاملة، حصص التأمينات الاجتماعية والشرائح الضريبية لكل موظف."
      onClose={onClose}
    >
      {runData.loading && <Loading />}
      {runData.error && (
        <ErrorState message="تعذر تحميل تفاصيل مسير الرواتب" retry={runData.reload} />
      )}
      {pr && (
        <div>
          <div className="stats-grid four" style={{ marginBottom: '16px' }}>
            <Stat
              label="إجمالي الأجور المستحقة (Gross)"
              value={money(pr.total_gross)}
              icon={<DollarSign size={20} />}
              tone="blue"
              foot={`أساسي: ${money(pr.total_basic)} | متغير: ${money(pr.total_variable)}`}
            />
            <Stat
              label="التأمينات (موظف + صاحب عمل)"
              value={money(pr.total_social_insurance_employee + pr.total_social_insurance_employer)}
              icon={<Users size={20} />}
              tone="purple"
              foot={`موظف 11%: ${money(pr.total_social_insurance_employee)} | شركة 18.75%: ${money(pr.total_social_insurance_employer)}`}
            />
            <Stat
              label="الضرائب وصندوق الشهداء"
              value={money(pr.total_income_tax + pr.total_martyrs_fund)}
              icon={<FileText size={20} />}
              tone="amber"
              foot={`ضريبة كسب عمل: ${money(pr.total_income_tax)} | شهداء: ${money(pr.total_martyrs_fund)}`}
            />
            <Stat
              label="صافي الرواتب المستحقة للصرف"
              value={money(pr.total_net)}
              icon={<CreditCard size={20} />}
              tone="green"
              foot={`استقطاع سلف: ${money(pr.total_advances)} ج.م`}
            />
          </div>

          <div
            className="table-responsive"
            style={{ maxHeight: '380px', overflowY: 'auto', marginBottom: '16px' }}
          >
            <table className="table" style={{ fontSize: '12.5px' }}>
              <thead>
                <tr>
                  <th>الموظف</th>
                  <th>الوظيفة</th>
                  <th>الأجر الأساسي</th>
                  <th>المتغير</th>
                  <th>الإجمالي</th>
                  <th>تأمينات (11%)</th>
                  <th>تأمينات شركة (18.75%)</th>
                  <th>ضريبة الدخل</th>
                  <th>صندوق الشهداء</th>
                  <th>سلف مستقطعة</th>
                  <th>صافي الراتب</th>
                </tr>
              </thead>
              <tbody>
                {(pr.slips || []).map((s) => (
                  <tr key={s.id}>
                    <td>
                      <strong>{s.employee_name}</strong>
                      <div style={{ fontSize: '11px', color: 'var(--muted)' }}>
                        #{s.employee_code}
                      </div>
                    </td>
                    <td>{s.job_title || '—'}</td>
                    <td>{money(s.basic_salary)}</td>
                    <td>{money(s.variable_salary)}</td>
                    <td>
                      <strong>{money(s.gross_salary)}</strong>
                    </td>
                    <td style={{ color: '#dc2626' }}>-{money(s.social_insurance_employee)}</td>
                    <td style={{ color: '#7c3aed' }}>{money(s.social_insurance_employer)}</td>
                    <td style={{ color: '#dc2626' }}>-{money(s.income_tax)}</td>
                    <td style={{ color: '#dc2626' }}>-{money(s.martyrs_fund)}</td>
                    <td style={{ color: '#d97706' }}>
                      {s.advances_deduction > 0 ? `-${money(s.advances_deduction)}` : '—'}
                    </td>
                    <td>
                      <strong style={{ color: '#16a34a', fontSize: '13.5px' }}>
                        {money(s.net_salary)}
                      </strong>{' '}
                      <small>ج.م</small>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div
            className="modal-footer"
            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
          >
            <div>
              <span className={pr.status === 'CONFIRMED' ? 'badge green' : 'badge amber'}>
                {pr.status === 'CONFIRMED' ? 'معتمد ومرحل دفترياً' : 'مسودة بانتظار الاعتماد'}
              </span>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <Button variant="secondary" onClick={onClose}>
                إغلاق
              </Button>
              {pr.status === 'DRAFT' && (
                <Button onClick={confirmRun} busy={busy}>
                  <ShieldCheck size={16} /> اعتماد المسير وترحيل القيد المزدوج
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

export function PayrollView() {
  const { branches } = useBranch();
  const [activeTab, setActiveTab] = useState<'RUNS' | 'EMPLOYEES'>('RUNS');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);

  const runsData = useData<PayrollRun[]>('/payroll/payroll-runs');
  const employeesData = useData<Employee[]>('/payroll/employees');

  const [addingEmployee, setAddingEmployee] = useState(false);
  const [advanceEmployee, setAdvanceEmployee] = useState<Employee | null>(null);
  const [addingRun, setAddingRun] = useState(false);
  const [viewingRunId, setViewingRunId] = useState<string | null>(null);

  const runs = runsData.data || [];
  const employees = employeesData.data || [];

  const filteredEmployees = employees.filter((e) => {
    if (!query) return true;
    const q = query.toLowerCase();
    return (
      e.name.toLowerCase().includes(q) ||
      e.code.toLowerCase().includes(q) ||
      e.job_title.toLowerCase().includes(q) ||
      (e.department || '').toLowerCase().includes(q)
    );
  });

  const totalMonthlySalaries = employees
    .filter((e) => e.active === 1)
    .reduce((s, e) => s + e.basic_salary + e.variable_salary, 0);

  return (
    <div>
      <div className="stats-grid three" style={{ marginBottom: '16px' }}>
        <Stat
          label="إجمالي الموظفين النشطين"
          value={String(employees.filter((e) => e.active === 1).length)}
          icon={<Users size={20} />}
          tone="blue"
          foot="القوة العاملة المسجلة بالنظام"
        />
        <Stat
          label="كتلة الرواتب الشهرية التقديرية"
          value={money(totalMonthlySalaries)}
          icon={<DollarSign size={20} />}
          tone="green"
          foot="إجمالي الأجور الأساسية والمتغيرة الشهرية"
        />
        <Stat
          label="مسيرات الرواتب المنفذة"
          value={String(runs.length)}
          icon={<FileText size={20} />}
          tone="purple"
          foot={`${runs.filter((r) => r.status === 'CONFIRMED').length} مسيرات معتمدة ومرحلة`}
        />
      </div>

      <div className="table-toolbar" style={{ marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
        <div className="tabs" style={{ margin: 0 }}>
          <button
            className={activeTab === 'RUNS' ? 'active' : ''}
            onClick={() => {
              setActiveTab('RUNS');
              setPage(1);
            }}
          >
            مسيرات الرواتب الشهرية ({runs.length})
          </button>
          <button
            className={activeTab === 'EMPLOYEES' ? 'active' : ''}
            onClick={() => {
              setActiveTab('EMPLOYEES');
              setPage(1);
            }}
          >
            الموظفون والرواتب ({employees.length})
          </button>
        </div>

        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {activeTab === 'EMPLOYEES' && (
            <SearchBox
              value={query}
              onChange={(q) => {
                setQuery(q);
                setPage(1);
              }}
              placeholder="بحث بالاسم أو الكود أو الوظيفة..."
            />
          )}

          {activeTab === 'RUNS' ? (
            <Button onClick={() => setAddingRun(true)}>
              <Plus size={16} /> إنشاء مسير رواتب
            </Button>
          ) : (
            <Button onClick={() => setAddingEmployee(true)}>
              <Plus size={16} /> إضافة موظف
            </Button>
          )}
        </div>
      </div>

      {activeTab === 'RUNS' && (
        <div>
          {runsData.loading && <Loading />}
          {runsData.error && (
            <ErrorState message="تعذر تحميل مسيرات الرواتب" retry={runsData.reload} />
          )}
          {!runsData.loading && runs.length === 0 && (
            <Empty
              title="لا توجد مسيرات رواتب منشأة"
              description="قم بإنشاء مسير رواتب شهري لاحتساب المستحقات والاستقطاعات والضرائب آلياً."
            />
          )}
          {!runsData.loading && runs.length > 0 && (
            <div className="table-responsive">
              <table className="table">
                <thead>
                  <tr>
                    <th>الشهر</th>
                    <th>الفرع</th>
                    <th>إجمالي الرواتب</th>
                    <th>تأمينات الموظفين (11%)</th>
                    <th>تأمينات الشركة (18.75%)</th>
                    <th>كسب العمل والشهداء</th>
                    <th>صافي المستحق</th>
                    <th>الحالة</th>
                    <th>الإجراءات</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <strong>{r.month}</strong>
                      </td>
                      <td>{r.branch_name || 'كافة الفروع'}</td>
                      <td>{money(r.total_gross)} ج.م</td>
                      <td>{money(r.total_social_insurance_employee)} ج.م</td>
                      <td>{money(r.total_social_insurance_employer)} ج.م</td>
                      <td>{money(r.total_income_tax + r.total_martyrs_fund)} ج.م</td>
                      <td>
                        <strong style={{ color: '#16a34a' }}>{money(r.total_net)}</strong> ج.م
                      </td>
                      <td>
                        <span className={r.status === 'CONFIRMED' ? 'badge green' : 'badge amber'}>
                          {r.status === 'CONFIRMED' ? 'معتمد ومرحل' : 'مسودة'}
                        </span>
                      </td>
                      <td>
                        <Button
                          variant="secondary"
                          style={{ padding: '3px 8px', fontSize: '12px' }}
                          onClick={() => setViewingRunId(r.id)}
                        >
                          <Eye size={13} /> عرض المفردات
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {activeTab === 'EMPLOYEES' && (
        <div>
          {employeesData.loading && <Loading />}
          {employeesData.error && (
            <ErrorState message="تعذر تحميل قائمة الموظفين" retry={employeesData.reload} />
          )}
          {!employeesData.loading && filteredEmployees.length === 0 && (
            <Empty
              title="لا يوجد موظفون"
              description="أضف الموظفين وبيانات رواتبهم لحساب المسيرات."
            />
          )}
          {!employeesData.loading && filteredEmployees.length > 0 && (
            <div className="table-responsive">
              <table className="table">
                <thead>
                  <tr>
                    <th>كود الموظف</th>
                    <th>الاسم</th>
                    <th>المسمى الوظيفي والفرع</th>
                    <th>الراتب الأساسي</th>
                    <th>المتغير</th>
                    <th>الأجر التأميني</th>
                    <th>تاريخ التعيين</th>
                    <th>الحالة</th>
                    <th>الإجراءات</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredEmployees.slice((page - 1) * 10, page * 10).map((e) => (
                    <tr key={e.id}>
                      <td>
                        <strong style={{ fontFamily: 'monospace' }}>#{e.code}</strong>
                      </td>
                      <td>
                        <strong>{e.name}</strong>
                        {e.national_id && (
                          <div style={{ fontSize: '11px', color: 'var(--muted)' }}>
                            القومي: {e.national_id}
                          </div>
                        )}
                      </td>
                      <td>
                        <div>{e.job_title}</div>
                        <div style={{ fontSize: '11px', color: 'var(--muted)' }}>
                          {e.branch_name || 'عام'} {e.department ? `• ${e.department}` : ''}
                        </div>
                      </td>
                      <td>{money(e.basic_salary)} ج.م</td>
                      <td>{money(e.variable_salary)} ج.م</td>
                      <td>{money(e.insured_salary)} ج.م</td>
                      <td>{e.hire_date}</td>
                      <td>
                        <span className={e.active ? 'badge green' : 'badge gray'}>
                          {e.active ? 'نشط' : 'معطل'}
                        </span>
                      </td>
                      <td>
                        <Button
                          variant="secondary"
                          style={{ padding: '3px 8px', fontSize: '11.5px' }}
                          onClick={() => setAdvanceEmployee(e)}
                        >
                          <CreditCard size={13} /> صرف سلفة
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <Pagination
                page={page}
                setPage={setPage}
                total={filteredEmployees.length}
                size={10}
              />
            </div>
          )}
        </div>
      )}

      {addingEmployee && (
        <CreateEmployeeModal
          branches={branches}
          onClose={() => setAddingEmployee(false)}
          onSaved={() => {
            setAddingEmployee(false);
            employeesData.reload();
          }}
        />
      )}

      {advanceEmployee && (
        <CreateAdvanceModal
          employee={advanceEmployee}
          onClose={() => setAdvanceEmployee(null)}
          onSaved={() => {
            setAdvanceEmployee(null);
            employeesData.reload();
          }}
        />
      )}

      {addingRun && (
        <CreatePayrollRunModal
          branches={branches}
          onClose={() => setAddingRun(false)}
          onSaved={() => {
            setAddingRun(false);
            runsData.reload();
          }}
        />
      )}

      {viewingRunId && (
        <PayrollRunDetailsModal
          runId={viewingRunId}
          onClose={() => setViewingRunId(null)}
          onConfirmed={() => {
            setViewingRunId(null);
            runsData.reload();
          }}
        />
      )}
    </div>
  );
}
