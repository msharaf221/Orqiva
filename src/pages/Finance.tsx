import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  Plus,
  Download,
  Wallet,
  ArrowUpRight,
  ArrowDownLeft,
  ReceiptText,
  TrendingUp,
  CalendarDays,
  ShieldCheck,
  Building2,
  Users,
  LockKeyhole,
  Save,
  Pencil,
  Activity,
  Banknote,
  CreditCard,
  ArrowLeft,
  Filter,
  ArrowRightLeft,
  AlertTriangle,
  Shield,
  Trash2,
} from 'lucide-react';
import { PermissionsModal } from './PermissionsModal';
import {
  api,
  useData,
  useSession,
  useAction,
  PageHeader,
  Button,
  Field,
  SearchBox,
  Modal,
  Loading,
  ErrorState,
  Empty,
  Stat,
  Pagination,
  Initials,
  money,
  count,
  toCents,
  today,
  dayOffset,
  formatDate,
  downloadCSV,
  methods,
} from '../lib';
import { useBranch, withBranch } from '../branch';
import type {
  Expense,
  Payment,
  Document,
  Dashboard as DashboardData,
  User,
  Audit,
  CashAccount,
  AccountType,
  AccountTransfer,
  AccountStatementEntry,
  RoleDef,
  PermissionDef,
} from '../types';
import { can } from '../auth';
import { PaymentForm } from './Documents';
import { RevenueChart } from './Dashboard';
/** Who bears an expense: one branch, or every open branch by equal share or by the month's sales. */
export function expenseScope(e: Pick<Expense, 'allocation' | 'branch_name'>) {
  if (e.allocation === 'BRANCH') return e.branch_name ?? 'فرع';
  return e.allocation === 'EQUAL' ? 'مشترك · بالتساوي بين الفروع' : 'مشترك · حسب مبيعات الشهر';
}

export function Expenses() {
  const { user } = useSession();
  const { activeId, branches } = useBranch();
  const data = useData<Expense[]>(withBranch('/expenses', activeId));
  const accountsData = useData<CashAccount[]>('/cash-accounts');
  const [query, setQuery] = useState(''),
    [category, setCategory] = useState('all'),
    [page, setPage] = useState(1),
    [adding, setAdding] = useState(false);
  const { busy, act } = useAction();
  useEffect(() => setPage(1), [query, category]);
  const expenses = data.data || [],
    categories = [...new Set(expenses.map((e) => e.category))];
  const filtered = expenses.filter(
    (e) =>
      (category === 'all' || e.category === category) &&
      (e.title + e.notes).toLowerCase().includes(query.toLowerCase()),
  );
  const thisMonth = expenses.filter((e) => e.date.slice(0, 7) === today().slice(0, 7));
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const scope = String(f.get('scope'));
    const scoped = scope.startsWith('BRANCH:')
      ? { allocation: 'BRANCH', branch_id: scope.slice('BRANCH:'.length) }
      : { allocation: scope };
    const accId = f.get('account_id') ? String(f.get('account_id')) : undefined;
    void act(async () => {
      await api('/expenses', 'POST', {
        title: f.get('title'),
        category: f.get('category'),
        amount: toCents(f.get('amount')),
        date: f.get('date'),
        method: f.get('method'),
        notes: f.get('notes'),
        account_id: accId,
        ...scoped,
      });
      setAdding(false);
      data.reload();
      accountsData.reload();
    }, 'تم تسجيل المصروف');
  };
  return (
    <>
      <PageHeader
        eyebrow="تفاصيل صغيرة تصنع الفرق"
        title="المصروفات"
        description="سجّل نفقات أعمالك، واعرف أين تذهب أموالك."
        actions={
          <>
            <Button
              variant="secondary"
              onClick={() =>
                downloadCSV(
                  'المصروفات',
                  ['الوصف', 'الفئة', 'المبلغ', 'التاريخ', 'طريقة الدفع', 'ملاحظات'],
                  filtered.map((e) => [
                    e.title,
                    e.category,
                    e.amount / 100,
                    e.date,
                    methods[e.method],
                    e.notes,
                  ]),
                )
              }
            >
              <Download size={16} /> تصدير
            </Button>
            {user.role === 'ADMIN' && (
              <Button onClick={() => setAdding(true)}>
                <Plus size={18} /> تسجيل مصروف
              </Button>
            )}
          </>
        }
      />
      <div className="stats-grid three">
        <Stat
          label="مصروفات الشهر الحالي"
          value={money(thisMonth.reduce((s, e) => s + e.amount, 0))}
          icon={<Wallet size={20} />}
          foot="حسب تاريخ تسجيل المصروف"
        />
        <Stat
          label="إجمالي المصروفات"
          value={money(expenses.reduce((s, e) => s + e.amount, 0))}
          icon={<Banknote size={20} />}
          tone="blue"
          foot="جميع الفترات"
        />
        <Stat
          label="عدد بنود المصروفات"
          value={count(expenses.length)}
          unit="مصروف"
          icon={<ReceiptText size={20} />}
          tone="amber"
          foot={`${categories.length} فئات من المصروفات`}
        />
      </div>
      <section className="card">
        <div className="table-toolbar">
          <h2>سجل المصروفات</h2>
          <div className="table-filters">
            <SearchBox value={query} onChange={setQuery} placeholder="بحث عن مصروف..." />
            <select
              className="filter-select"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              aria-label="فئة المصروف"
            >
              <option value="all">كل الفئات</option>
              {categories.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </div>
        </div>
        {data.error ? (
          <ErrorState message={data.error} retry={data.reload} />
        ) : data.loading ? (
          <Loading />
        ) : !filtered.length ? (
          <Empty />
        ) : (
          <>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>المصروف</th>
                    <th>الفئة</th>
                    <th>التاريخ</th>
                    <th>طريقة الدفع</th>
                    <th>المبلغ</th>
                    <th>ملاحظات</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.slice((page - 1) * 8, page * 8).map((e) => (
                    <tr key={e.id}>
                      <td>
                        <div className="product-cell">
                          <span className="expense-icon">
                            <Wallet size={19} />
                          </span>
                          <div>
                            <strong>{e.title}</strong>
                            <small className="cell-sub">{expenseScope(e)}</small>
                          </div>
                        </div>
                      </td>
                      <td>
                        <span className="category-tag">{e.category}</span>
                      </td>
                      <td className="muted">{formatDate(e.date, true)}</td>
                      <td>
                        <div>{methods[e.method]}</div>
                        {e.account_name && <small className="cell-sub">{e.account_name}</small>}
                      </td>
                      <td className="num amount">
                        {money(e.amount, 2)} <small>ج.م</small>
                      </td>
                      <td className="muted notes-cell">{e.notes || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={page} setPage={setPage} total={filtered.length} />
          </>
        )}
      </section>
      {adding && (
        <Modal
          title="تسجيل مصروف جديد"
          description="المصروفات المسجلة تُحتسب مباشرة في التقارير والتدفق النقدي."
          onClose={() => setAdding(false)}
        >
          <form onSubmit={submit}>
            <div className="modal-body form-grid">
              <Field label="وصف المصروف *">
                <input
                  name="title"
                  required
                  maxLength={200}
                  placeholder="مثال: إيجار المكتب لشهر أكتوبر"
                />
              </Field>
              <div className="form-row">
                <Field label="الفئة *">
                  <input
                    name="category"
                    required
                    maxLength={80}
                    list="expense-categories"
                    placeholder="اختر أو اكتب فئة"
                  />
                  <datalist id="expense-categories">
                    {[
                      ...new Set([
                        ...categories,
                        'إيجارات',
                        'رواتب',
                        'تسويق',
                        'شحن وتوصيل',
                        'مرافق',
                        'اتصالات',
                        'صيانة',
                        'اشتراكات',
                        'أخرى',
                      ]),
                    ].map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </datalist>
                </Field>
                <Field label="المبلغ (ج.م) *">
                  <input
                    name="amount"
                    type="number"
                    step=".01"
                    min=".01"
                    max="10000000"
                    required
                    placeholder="0.00"
                  />
                </Field>
              </div>
              <Field
                label="نطاق المصروف *"
                hint="المصروف المشترك يُوزَّع على الفروع المفتوحة في تاريخه، ولا يُربط بفرع واحد."
              >
                <select
                  name="scope"
                  defaultValue={activeId !== 'all' ? `BRANCH:${activeId}` : 'EQUAL'}
                >
                  <optgroup label="فرع محدد">
                    {branches.map((b) => (
                      <option key={b.id} value={`BRANCH:${b.id}`}>
                        {b.name}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="مشترك بين كل الفروع">
                    <option value="EQUAL">بالتساوي بين الفروع</option>
                    <option value="REVENUE">حسب مبيعات الشهر في كل فرع</option>
                  </optgroup>
                </select>
              </Field>
              <div className="form-row">
                <Field label="التاريخ *">
                  <input name="date" required type="date" defaultValue={today()} />
                </Field>
                <Field label="طريقة الدفع *">
                  <select name="method">
                    {Object.entries(methods).map(([k, v]) => (
                      <option value={k} key={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <Field
                label="الحساب المالي / الخزينة"
                hint="الخزينة أو الحساب البنكي الذي يُصرف منه المصروف (اختياري، يحدّد تلقائياً حسب الطريقة)"
              >
                <select name="account_id" defaultValue="">
                  <option value="">تلقائي حسب طريقة الدفع</option>
                  {(accountsData.data || [])
                    .filter((a) => a.active)
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name} ({a.type === 'CASH' ? 'خزينة' : a.type === 'BANK' ? 'حساب بنكي' : 'محفظة'}) — الرصيد:{' '}
                        {money(a.balance, 2)} ج.م
                      </option>
                    ))}
                </select>
              </Field>
              <Field label="ملاحظات">
                <textarea
                  name="notes"
                  maxLength={2000}
                  placeholder="تفاصيل إضافية أو رقم إيصال..."
                />
              </Field>
              <div className="info-banner">
                <ShieldCheck size={18} />
                <span>
                  راجع البيانات قبل الحفظ. لا تدعم هذه النسخة حذف المصروفات أو تعديلها بعد التسجيل.
                </span>
              </div>
            </div>
            <div className="modal-footer">
              <Button type="submit" busy={busy}>
                تسجيل المصروف
              </Button>
              <Button type="button" variant="secondary" onClick={() => setAdding(false)}>
                إلغاء
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
export function Payments() {
  const { user } = useSession();
  const { activeId } = useBranch();
  const data = useData<Payment[]>(withBranch('/payments', activeId));
  const [query, setQuery] = useState(''),
    [type, setType] = useState('all'),
    [page, setPage] = useState(1),
    [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Document | null>(null);
  useEffect(() => setPage(1), [query, type]);
  const payments = data.data || [];
  const filtered = payments.filter(
    (p) =>
      (type === 'all' || p.type === type) &&
      (p.number + ' ' + p.party_name + ' ' + p.reference)
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const incoming = payments.filter((p) => p.type === 'SALE').reduce((s, p) => s + p.amount, 0),
    outgoing = payments.filter((p) => p.type === 'PURCHASE').reduce((s, p) => s + p.amount, 0);
  return (
    <>
      <PageHeader
        eyebrow="حركة أموالك، بوضوح"
        title="المدفوعات والمقبوضات"
        description="سجل موحّد لكل دفعة، مرتبط مباشرة بفواتيرك وحساباتك."
        actions={
          <>
            <Button
              variant="secondary"
              onClick={() =>
                downloadCSV(
                  'المدفوعات',
                  ['الفاتورة', 'الحساب', 'النوع', 'التاريخ', 'المبلغ', 'الطريقة', 'المرجع'],
                  filtered.map((p) => [
                    p.number || '',
                    p.party_name || '',
                    p.type === 'SALE' ? 'قبض' : 'دفع',
                    p.date,
                    p.amount / 100,
                    methods[p.method],
                    p.reference,
                  ]),
                )
              }
            >
              <Download size={16} /> تصدير
            </Button>
            <Button onClick={() => setSelecting(true)}>
              <Plus size={18} /> تسجيل دفعة
            </Button>
          </>
        }
      />
      <div className="stats-grid three">
        <Stat
          label="إجمالي المقبوضات"
          value={money(incoming)}
          icon={<ArrowDownLeft size={20} />}
          foot="دفعات العملاء · جميع الفترات"
        />
        <Stat
          label="إجمالي المدفوعات للموردين"
          value={money(outgoing)}
          icon={<ArrowUpRight size={20} />}
          tone="amber"
          foot="لا يشمل المصروفات التشغيلية"
        />
        <Stat
          label="عدد العمليات"
          value={count(payments.length)}
          unit="عملية"
          icon={<CreditCard size={20} />}
          tone="blue"
          foot="كل الدفعات المسجلة"
        />
      </div>
      <section className="card">
        <div className="table-toolbar">
          <div className="tabs">
            <button className={type === 'all' ? 'active' : ''} onClick={() => setType('all')}>
              كل العمليات
            </button>
            <button className={type === 'SALE' ? 'active' : ''} onClick={() => setType('SALE')}>
              المقبوضات
            </button>
            <button
              className={type === 'PURCHASE' ? 'active' : ''}
              onClick={() => setType('PURCHASE')}
            >
              المدفوعات
            </button>
          </div>
          <SearchBox
            value={query}
            onChange={setQuery}
            placeholder="بحث بالحساب أو رقم الفاتورة..."
          />
        </div>
        {data.error ? (
          <ErrorState message={data.error} retry={data.reload} />
        ) : data.loading ? (
          <Loading />
        ) : !filtered.length ? (
          <Empty />
        ) : (
          <>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>الحساب</th>
                    <th>الفاتورة</th>
                    <th>نوع العملية</th>
                    <th>التاريخ</th>
                    <th>المبلغ</th>
                    <th>الطريقة</th>
                    <th>المرجع</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.slice((page - 1) * 8, page * 8).map((p) => (
                    <tr key={p.id}>
                      <td>
                        <strong>{p.party_name}</strong>
                      </td>
                      <td>
                        <Link
                          className="invoice-number num"
                          to={`/${p.type === 'SALE' ? 'sales' : 'purchases'}/${p.document_id}`}
                        >
                          {p.number}
                        </Link>
                      </td>
                      <td>
                        <span className={'badge ' + (p.type === 'SALE' ? 'paid' : 'pending')}>
                          {p.type === 'SALE' ? (
                            <ArrowDownLeft size={12} />
                          ) : (
                            <ArrowUpRight size={12} />
                          )}{' '}
                          {p.type === 'SALE' ? 'قبض من عميل' : 'دفع لمورد'}
                        </span>
                      </td>
                      <td className="muted">{formatDate(p.date, true)}</td>
                      <td className="num amount">
                        {money(p.amount, 2)} <small>ج.م</small>
                      </td>
                      <td>
                        <div>{methods[p.method]}</div>
                        {p.account_name && <small className="cell-sub">{p.account_name}</small>}
                      </td>
                      <td className="num muted">{p.reference || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={page} setPage={setPage} total={filtered.length} />
          </>
        )}
      </section>
      {selecting && (
        <SelectPaymentDoc
          admin={user.role === 'ADMIN'}
          onClose={() => setSelecting(false)}
          onSelect={(d) => {
            setSelecting(false);
            setSelected(d);
          }}
        />
      )}
      {selected && (
        <PaymentForm
          doc={selected}
          onClose={() => setSelected(null)}
          onSaved={() => {
            setSelected(null);
            data.reload();
          }}
        />
      )}
    </>
  );
}
function SelectPaymentDoc({
  admin,
  onClose,
  onSelect,
}: {
  admin: boolean;
  onClose: () => void;
  onSelect: (d: Document) => void;
}) {
  const [type, setType] = useState('SALE');
  const { activeId } = useBranch();
  const data = useData<Document[]>(withBranch('/documents?type=' + type, activeId));
  const [query, setQuery] = useState('');
  const docs = (data.data || []).filter(
    (d) =>
      d.status === 'POSTED' &&
      d.paid < d.total &&
      (d.number + d.party_name).toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <Modal
      title="اختر الفاتورة لتسجيل دفعة"
      description="تظهر الفواتير المعتمدة التي لها رصيد مستحق فقط."
      onClose={onClose}
    >
      <div className="modal-body form-grid">
        {admin && (
          <div className="tabs">
            <button className={type === 'SALE' ? 'active' : ''} onClick={() => setType('SALE')}>
              قبض من عميل
            </button>
            <button
              className={type === 'PURCHASE' ? 'active' : ''}
              onClick={() => setType('PURCHASE')}
            >
              دفع لمورد
            </button>
          </div>
        )}
        <SearchBox value={query} onChange={setQuery} placeholder="رقم الفاتورة أو اسم الحساب..." />
        {data.loading ? (
          <Loading />
        ) : data.error ? (
          <ErrorState message={data.error} retry={data.reload} />
        ) : !docs.length ? (
          <Empty title="لا توجد فواتير مستحقة" />
        ) : (
          <div className="payment-doc-list">
            {docs.map((d) => (
              <button key={d.id} onClick={() => onSelect(d)}>
                <div>
                  <strong className="num">{d.number}</strong>
                  <span>{d.party_name}</span>
                </div>
                <b className="num">
                  {money(d.total - d.paid, 2)} <small>ج.م</small>
                </b>
                <ArrowLeft size={16} />
              </button>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}
export function Reports() {
  const [period, setPeriod] = useState({ from: dayOffset(-29), to: today() });
  const { activeId } = useBranch();
  const data = useData<DashboardData>(
    withBranch(`/dashboard?from=${period.from}&to=${period.to}`, activeId),
  );
  const report = data.data;
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setPeriod({ from: String(f.get('from')), to: String(f.get('to')) });
  };
  const metrics = report
    ? ([
        ['صافي المبيعات', report.sales],
        ['تكلفة البضاعة التقديرية', report.sales - report.grossProfit],
        ['مجمل الربح التقديري', report.grossProfit],
        ['المصروفات التشغيلية', report.expenses],
        ['صافي الربح التقديري', report.netProfit],
        ['المقبوضات', report.collected],
        ['مدفوعات الموردين', report.disbursed],
        ['صافي التدفق النقدي', report.cashFlow],
      ] as [string, number][])
    : [];
  return (
    <>
      <PageHeader
        eyebrow="قرارات مبنية على الأرقام"
        title="التقارير والتحليلات"
        description="من الأرقام اليومية إلى الصورة الأكبر. افهم أداء أعمالك واتخذ الخطوة التالية."
        actions={
          <Button
            variant="secondary"
            disabled={!report || data.loading}
            onClick={() =>
              downloadCSV(
                'تقرير-الأعمال-' + period.from,
                ['المؤشر', 'القيمة بالجنيه'],
                [
                  ['من', period.from],
                  ['إلى', period.to],
                  ...metrics.map(([label, value]) => [label, value / 100]),
                ],
              )
            }
          >
            <Download size={16} /> تصدير التقرير
          </Button>
        }
      />
      <form className="card report-filter" onSubmit={submit}>
        <div>
          <CalendarDays size={20} />
          <h3>الفترة الزمنية</h3>
        </div>
        <Field label="من">
          <input name="from" type="date" required defaultValue={period.from} />
        </Field>
        <Field label="إلى">
          <input name="to" type="date" required defaultValue={period.to} />
        </Field>
        <Button type="submit" busy={data.loading}>
          <Filter size={16} /> عرض التقرير
        </Button>
        <span>حد أقصى ٣٦٦ يوماً</span>
      </form>
      {data.error ? (
        <ErrorState message={data.error} retry={data.reload} />
      ) : data.loading ? (
        <Loading />
      ) : (
        report && (
          <>
            <div className="stats-grid">
              <Stat
                label="صافي المبيعات"
                value={money(report.sales)}
                icon={<ReceiptText size={20} />}
                foot="بعد الخصم، قبل الضريبة"
              />
              <Stat
                label="مجمل الربح التقديري"
                value={money(report.grossProfit)}
                icon={<TrendingUp size={20} />}
                tone="blue"
                foot="المبيعات ناقص التكلفة المرجعية"
              />
              <Stat
                label="المصروفات"
                value={money(report.expenses)}
                icon={<Wallet size={20} />}
                tone="amber"
              />
              <Stat
                label="صافي الربح التقديري"
                value={money(report.netProfit)}
                icon={<Banknote size={20} />}
                tone="purple"
                foot="بعد المصروفات التشغيلية"
              />
            </div>
            <section className="card report-chart">
              <div className="card-heading">
                <div>
                  <h2>اتجاه المبيعات والمشتريات</h2>
                  <p>القيم قبل الضريبة وبعد الخصومات</p>
                </div>
                <div className="chart-legend">
                  <span>
                    <i className="legend-sales" /> المبيعات
                  </span>
                  <span>
                    <i className="legend-purchases" /> المشتريات
                  </span>
                </div>
              </div>
              <RevenueChart data={report.series} />
            </section>
            <div className="report-grid">
              <section className="card">
                <div className="card-heading">
                  <h2>ملخص الأداء المالي</h2>
                  <span className="category-tag">ج.م</span>
                </div>
                <div className="financial-summary">
                  {metrics.map(([label, value], i) => (
                    <div className={i === 4 || i === 7 ? 'summary-emphasis' : ''} key={label}>
                      <span>{label}</span>
                      <strong className={'num ' + (value < 0 ? 'negative' : '')}>
                        {money(value, 2)}
                      </strong>
                    </div>
                  ))}
                </div>
              </section>
              <section className="card">
                <div className="card-heading">
                  <div>
                    <h2>توزيع المصروفات</h2>
                    <p>أين تُنفق أموال أعمالك؟</p>
                  </div>
                  <Wallet size={20} />
                </div>
                <div className="expense-breakdown">
                  {report.expenseCategories.length ? (
                    report.expenseCategories.map((c, i) => (
                      <div key={c.category}>
                        <div>
                          <span>
                            <i
                              style={{
                                background: ['#347969', '#98b88b', '#ddbc81', '#8b97b1', '#b6a2c9'][
                                  i % 5
                                ],
                              }}
                            />
                            {c.category}
                          </span>
                          <strong className="num">
                            {money(c.amount)} <small>ج.م</small>
                          </strong>
                        </div>
                        <div className="progress-track">
                          <span
                            style={{
                              width: `${(c.amount / report.expenses) * 100}%`,
                              background: ['#347969', '#98b88b', '#ddbc81', '#8b97b1', '#b6a2c9'][
                                i % 5
                              ],
                            }}
                          />
                        </div>
                      </div>
                    ))
                  ) : (
                    <Empty title="لا توجد مصروفات في الفترة" />
                  )}
                </div>
              </section>
            </div>
            <section className="card top-products">
              <div className="card-heading">
                <div>
                  <h2>المنتجات الأعلى مبيعاً</h2>
                  <p>حسب قيمة بنود المبيعات، قبل خصم الفاتورة والضريبة</p>
                </div>
                <Link to="/products" className="text-link">
                  كل المنتجات <ArrowLeft size={15} />
                </Link>
              </div>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>الترتيب</th>
                      <th>المنتج</th>
                      <th>الكود</th>
                      <th>الكمية المباعة</th>
                      <th>قيمة المبيعات</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.topProducts.map((p, i) => (
                      <tr key={p.sku}>
                        <td>
                          <span className={'rank ' + (i === 0 ? 'first' : '')}>{i + 1}</span>
                        </td>
                        <td>
                          <strong>{p.name}</strong>
                        </td>
                        <td className="num muted">{p.sku}</td>
                        <td className="num">{p.quantity}</td>
                        <td className="num amount">
                          {money(p.revenue, 2)} <small>ج.م</small>
                        </td>
                      </tr>
                    ))}
                    {!report.topProducts.length && (
                      <tr>
                        <td colSpan={5} className="table-empty">
                          لا توجد مبيعات معتمدة في الفترة.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
            <div className="info-banner report-disclaimer">
              <ShieldCheck size={20} />
              <span>
                هذا ملخص إداري، وليس قوائم مالية محاسبية معتمدة. الربح يعتمد على التكلفة المرجعية
                وقت اعتماد البيع، ولا يشمل تقييم FIFO أو المتوسط المرجح. المستندات الملغاة والمسودات
                لا تدخل في التقارير.
              </span>
            </div>
          </>
        )
      )}
    </>
  );
}
export function SettingsPage() {
  const { user } = useSession();
  const [tab, setTab] = useState('company');
  return (
    <>
      <PageHeader
        eyebrow="مساحة عمل على مقاسك"
        title="الإعدادات"
        description="خصص بيانات شركتك، وأدر فريقك وأمان حسابك."
        actions={
          user.role === 'ADMIN' ? (
            <Link to="/activity" className="btn btn-secondary">
              <Activity size={16} /> سجل النشاط
            </Link>
          ) : undefined
        }
      />
      <div className="settings-layout">
        <nav className="card settings-nav">
          <button onClick={() => setTab('company')} className={tab === 'company' ? 'active' : ''}>
            <Building2 size={19} />
            <div>
              <strong>بيانات الشركة</strong>
              <small>الهوية وبيانات الفواتير</small>
            </div>
          </button>
          {can(user, 'users:manage') && (
            <button onClick={() => setTab('users')} className={tab === 'users' ? 'active' : ''}>
              <Users size={19} />
              <div>
                <strong>فريق العمل</strong>
                <small>المستخدمون والأفرع</small>
              </div>
            </button>
          )}
          {can(user, 'users:manage') && (
            <button onClick={() => setTab('roles')} className={tab === 'roles' ? 'active' : ''}>
              <Shield size={19} />
              <div>
                <strong>الأدوار والصلاحيات</strong>
                <small>تخصيص الصلاحيات والأدوار</small>
              </div>
            </button>
          )}
          <button onClick={() => setTab('security')} className={tab === 'security' ? 'active' : ''}>
            <LockKeyhole size={19} />
            <div>
              <strong>أمان الحساب</strong>
              <small>كلمة المرور والجلسات</small>
            </div>
          </button>
          <div className="settings-nav-note">
            <ShieldCheck size={26} />
            <p>
              صلاحيات واضحة.
              <br />
              وبيانات في أمان.
            </p>
          </div>
        </nav>
        <div>
          {tab === 'company' ? (
            <CompanySettings />
          ) : tab === 'users' ? (
            <UserSettings />
          ) : tab === 'roles' ? (
            <RolesSettings />
          ) : (
            <SecuritySettings />
          )}
        </div>
      </div>
    </>
  );
}
function CompanySettings() {
  const { company, refreshCompany, user } = useSession();
  const { busy, act } = useAction();
  const admin = user.role === 'ADMIN';
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    void act(async () => {
      await api('/company', 'PUT', {
        name: f.get('name'),
        email: f.get('email'),
        phone: f.get('phone'),
        address: f.get('address'),
        tax_number: f.get('tax_number'),
        tax_rate: Math.round(Number(f.get('tax_rate')) * 100),
        invoice_note: f.get('invoice_note'),
      });
      refreshCompany();
    }, 'تم حفظ إعدادات الشركة');
  };
  if (!company) return <Loading />;
  return (
    <form onSubmit={submit} className="card settings-card">
      <div className="card-heading">
        <div>
          <h2>بيانات الشركة</h2>
          <p>تظهر هذه البيانات على الفواتير المطبوعة.</p>
        </div>
        <span className="settings-company-icon">
          <Building2 size={23} />
        </span>
      </div>
      <fieldset disabled={!admin || busy} className="form-card-body form-grid">
        <Field label="اسم الشركة *">
          <input name="name" required maxLength={200} defaultValue={company.name} />
        </Field>
        <div className="form-row">
          <Field label="البريد الإلكتروني">
            <input
              name="email"
              type="email"
              dir="ltr"
              maxLength={200}
              defaultValue={company.email}
            />
          </Field>
          <Field label="رقم الهاتف">
            <input name="phone" type="tel" dir="ltr" maxLength={40} defaultValue={company.phone} />
          </Field>
        </div>
        <Field label="العنوان">
          <input name="address" maxLength={500} defaultValue={company.address} />
        </Field>
        <div className="form-row">
          <Field label="الرقم الضريبي">
            <input name="tax_number" maxLength={50} defaultValue={company.tax_number} />
          </Field>
          <Field label="نسبة الضريبة الافتراضية (%)">
            <input
              name="tax_rate"
              type="number"
              min="0"
              max="100"
              step=".01"
              required
              defaultValue={company.tax_rate / 100}
            />
          </Field>
        </div>
        <Field
          label="العملة الأساسية"
          hint="هذه النسخة تعمل بالجنيه المصري لتجنب خلط العملات في التقارير."
        >
          <input disabled value="الجنيه المصري — EGP" />
        </Field>
        <Field label="ملاحظة أسفل الفاتورة">
          <textarea
            name="invoice_note"
            maxLength={1000}
            rows={3}
            defaultValue={company.invoice_note}
          />
        </Field>
      </fieldset>
      <div className="modal-footer">
        {admin ? (
          <Button type="submit" busy={busy}>
            <Save size={17} /> حفظ التغييرات
          </Button>
        ) : (
          <span className="muted">تعديل إعدادات الشركة متاح للمدير فقط.</span>
        )}
      </div>
    </form>
  );
}
function SecuritySettings() {
  const { user } = useSession();
  const { busy, act } = useAction();
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    void act(async () => {
      if (f.get('password') !== f.get('confirm')) throw new Error('كلمتا المرور غير متطابقتين');
      await api('/auth/password', 'POST', {
        current: f.get('current'),
        password: f.get('password'),
      });
      form.reset();
    }, 'تم تغيير كلمة المرور وإنهاء الجلسات الأخرى');
  };
  return (
    <form onSubmit={submit} className="card settings-card">
      <div className="card-heading">
        <div>
          <h2>أمان الحساب</h2>
          <p>{user.email}</p>
        </div>
        <LockKeyhole size={21} />
      </div>
      <div className="form-card-body form-grid">
        <div className="info-banner">
          <ShieldCheck size={20} />
          <span>تغيير كلمة المرور يُنهي جلساتك على الأجهزة الأخرى، مع إبقاء جلستك الحالية.</span>
        </div>
        <Field label="كلمة المرور الحالية *">
          <input
            name="current"
            type="password"
            required
            maxLength={128}
            autoComplete="current-password"
          />
        </Field>
        <Field
          label="كلمة المرور الجديدة *"
          hint="١٠ أحرف على الأقل. استخدم كلمة مرور قوية وفريدة."
        >
          <input
            name="password"
            type="password"
            minLength={10}
            maxLength={128}
            required
            autoComplete="new-password"
          />
        </Field>
        <Field label="تأكيد كلمة المرور الجديدة *">
          <input
            name="confirm"
            type="password"
            minLength={10}
            maxLength={128}
            required
            autoComplete="new-password"
          />
        </Field>
      </div>
      <div className="modal-footer">
        <Button type="submit" busy={busy}>
          <LockKeyhole size={17} /> تحديث كلمة المرور
        </Button>
      </div>
    </form>
  );
}
function UserSettings() {
  const { user } = useSession();
  const { branches } = useBranch();
  const data = useData<User[]>('/users');
  const rolesData = useData<RoleDef[]>('/roles');
  const [adding, setAdding] = useState(false),
    [editing, setEditing] = useState<User | null>(null),
    [customizing, setCustomizing] = useState<User | null>(null);
  const [selectedRoleId, setSelectedRoleId] = useState<string>('');
  const { busy, act } = useAction();

  const activeRole = rolesData.data?.find((r) => r.id === selectedRoleId);
  const isSelectedAdmin = activeRole?.code === 'ADMIN';

  const openAdd = () => {
    setSelectedRoleId(rolesData.data?.find((r) => r.code === 'SALES')?.id || rolesData.data?.[0]?.id || '');
    setAdding(true);
  };

  const openEdit = (u: User) => {
    setEditing(u);
    const matchedRole = rolesData.data?.find((r) => r.id === u.role_id || r.code === u.role);
    setSelectedRoleId(matchedRole?.id || rolesData.data?.[0]?.id || '');
  };

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const chosenRoleId = String(f.get('role_id') || selectedRoleId);
    const chosenRoleObj = rolesData.data?.find((r) => r.id === chosenRoleId);

    void act(async () => {
      if (editing)
        await api('/users/' + editing.id, 'PATCH', {
          role: chosenRoleObj?.code,
          role_id: chosenRoleId,
          active: f.get('active') === '1',
          branch_ids: chosenRoleObj?.code === 'ADMIN' ? [] : f.getAll('branch_ids').map(String),
        });
      else
        await api('/users', 'POST', {
          name: f.get('name'),
          email: f.get('email'),
          password: f.get('password'),
          role: chosenRoleObj?.code || 'STAFF',
          role_id: chosenRoleId,
          branch_ids: chosenRoleObj?.code === 'ADMIN' ? [] : f.getAll('branch_ids').map(String),
        });
      setAdding(false);
      setEditing(null);
      data.reload();
    }, 'تم حفظ بيانات المستخدم');
  };
  return (
    <>
      <section className="card settings-card">
        <div className="card-heading">
          <div>
            <h2>فريق العمل</h2>
            <p>إدارة أعضاء الفريق وتعيين أدوارهم وفروعهم.</p>
          </div>
          <Button onClick={openAdd}>
            <Plus size={16} /> مستخدم جديد
          </Button>
        </div>
        {data.loading ? (
          <Loading />
        ) : data.error ? (
          <ErrorState message={data.error} retry={data.reload} />
        ) : (
          <div className="user-list">
            {data.data?.map((u, i) => (
              <div className="user-list-item" key={u.id}>
                <Initials name={u.name} tone={i} />
                <div>
                  <strong>
                    {u.name} {u.id === user.id && <small>(أنت)</small>}
                  </strong>
                  <span>{u.email}</span>
                </div>
                <span className={'badge ' + (u.active ? 'paid' : 'cancelled')}>
                  {u.active ? (u.role_name || (u.role === 'ADMIN' ? 'مدير' : 'موظف')) : 'معطل'}
                </span>
                <div className="user-item-actions">
                  <button
                    className="icon-btn"
                    disabled={u.id === user.id}
                    onClick={() => setCustomizing(u)}
                    title={'تخصيص الصلاحيات الفردية لـ ' + u.name}
                    aria-label={'تخصيص صلاحيات ' + u.name}
                  >
                    <Shield size={16} />
                  </button>
                  <button
                    className="icon-btn"
                    disabled={u.id === user.id}
                    onClick={() => openEdit(u)}
                    aria-label={'تعديل صلاحيات ' + u.name}
                  >
                    <Pencil size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="permissions-note">
          <h3>نظام الصلاحيات المخصص (RBAC)</h3>
          <p>
            يدعم النظام أدواراً مخصصة مع صلاحيات دقيقة لكل شاشة وعملية. يمكنك تخصيص الأدوار من تبويب <b>"الأدوار والصلاحيات"</b> أعلاه.
          </p>
        </div>
      </section>
      {(adding || editing) && (
        <Modal
          title={editing ? 'تعديل صلاحيات المستخدم' : 'إضافة مستخدم جديد'}
          onClose={() => {
            setAdding(false);
            setEditing(null);
          }}
        >
          <form onSubmit={submit}>
            <div className="modal-body form-grid">
              {editing ? (
                <div className="info-banner">
                  <Users size={19} />
                  <span>
                    {editing.name} · {editing.email}
                  </span>
                </div>
              ) : (
                <>
                  <Field label="الاسم *">
                    <input name="name" required maxLength={100} />
                  </Field>
                  <Field label="البريد الإلكتروني *">
                    <input name="email" type="email" required maxLength={200} dir="ltr" />
                  </Field>
                  <Field label="كلمة المرور الأولية *">
                    <input
                      name="password"
                      type="password"
                      required
                      minLength={10}
                      maxLength={128}
                      autoComplete="new-password"
                    />
                  </Field>
                </>
              )}

              <Field label="الدور والصلاحية *">
                <select
                  name="role_id"
                  value={selectedRoleId}
                  onChange={(e) => setSelectedRoleId(e.target.value)}
                >
                  {rolesData.data?.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name} ({r.code})
                    </option>
                  ))}
                </select>
              </Field>

              {!isSelectedAdmin && (
                <div className="field branch-field">
                  <span>الفروع المسموح بها لهذا المستخدم</span>
                  <div className="branch-checks">
                    {branches.map((b) => (
                      <label key={b.id} className="check-line">
                        <input
                          type="checkbox"
                          name="branch_ids"
                          value={b.id}
                          defaultChecked={editing ? editing.branch_ids?.includes(b.id) : true}
                        />
                        {b.name}
                      </label>
                    ))}
                  </div>
                  <small>
                    مدير النظام يرى كل الفروع تلقائياً. لباقي الأدوار، حدد الفروع المسموح بالعمل عليها.
                  </small>
                </div>
              )}

              {editing && (
                <Field label="حالة الحساب">
                  <select name="active" defaultValue={editing.active ? '1' : '0'}>
                    <option value="1">نشط</option>
                    <option value="0">معطل</option>
                  </select>
                </Field>
              )}
              <small className="muted">تحديث الصلاحيات يُنهي الجلسات الحالية للمستخدم.</small>
            </div>
            <div className="modal-footer">
              <Button type="submit" busy={busy}>
                حفظ المستخدم
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setAdding(false);
                  setEditing(null);
                }}
              >
                إلغاء
              </Button>
            </div>
          </form>
        </Modal>
      )}
      {customizing && (
        <PermissionsModal
          targetUser={customizing}
          onClose={() => setCustomizing(null)}
          onSaved={() => {
            setCustomizing(null);
            data.reload();
          }}
        />
      )}
    </>
  );
}

function RolesSettings() {
  const rolesData = useData<RoleDef[]>('/roles');
  const permsData = useData<PermissionDef[]>('/permissions');
  const [editingRole, setEditingRole] = useState<RoleDef | null>(null);
  const [addingRole, setAddingRole] = useState(false);
  const { act } = useAction();

  const handleDelete = (role: RoleDef) => {
    if (!window.confirm(`هل أنت متأكد من حذف الدور "${role.name}"؟`)) return;
    void act(async () => {
      await api(`/roles/${role.id}`, 'DELETE');
      rolesData.reload();
    }, 'تم حذف الدور بنجاح');
  };

  return (
    <>
      <section className="card settings-card">
        <div className="card-heading">
          <div>
            <h2>الأدوار والصلاحيات (RBAC)</h2>
            <p>أدوار مخصصة وصلاحيات دقيقة على مستوى كل عملية وشاشة في النظام.</p>
          </div>
          <Button onClick={() => setAddingRole(true)}>
            <Plus size={16} /> دور جديد
          </Button>
        </div>

        {rolesData.loading ? (
          <Loading />
        ) : rolesData.error ? (
          <ErrorState message={rolesData.error} retry={rolesData.reload} />
        ) : (
          <div className="role-cards-grid">
            {rolesData.data?.map((role) => (
              <div className="role-card" key={role.id}>
                <div className="role-card-header">
                  <div className="role-card-title">
                    <h3>{role.name}</h3>
                    <span className="role-code-badge">{role.code}</span>
                  </div>
                  <span className={'badge ' + (role.is_system ? 'neutral' : 'tag')}>
                    {role.is_system ? 'دور قياسي' : 'مخصص'}
                  </span>
                </div>
                <p className="role-card-desc">{role.description || 'لا يوجد وصف محدد لهذا الدور'}</p>
                <div className="role-card-meta">
                  <span className="badge paid">
                    {role.user_count || 0} مستخدم
                  </span>
                  <span className="muted" style={{ fontSize: '11px' }}>
                    {role.code === 'ADMIN' ? 'كافة الصلاحيات (شامل)' : `${role.permissions.length} صلاحيات نشطة`}
                  </span>
                </div>
                <div className="role-perms-summary">
                  {role.permissions.slice(0, 4).map((p) => {
                    const def = permsData.data?.find((item) => item.id === p);
                    return (
                      <span className="perm-pill" key={p}>
                        {def?.name || p}
                      </span>
                    );
                  })}
                  {role.permissions.length > 4 && (
                    <span className="perm-pill more">
                      +{role.permissions.length - 4} أخرى
                    </span>
                  )}
                </div>
                <div className="role-card-actions">
                  <Button
                    variant="secondary"
                    onClick={() => setEditingRole(role)}
                    disabled={role.code === 'ADMIN'}
                  >
                    <Pencil size={14} /> تعديل
                  </Button>
                  {!role.is_system && (
                    <Button
                      variant="danger"
                      onClick={() => handleDelete(role)}
                      disabled={(role.user_count ?? 0) > 0}
                    >
                      <Trash2 size={14} /> حذف
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {(addingRole || editingRole) && (
        <RoleModal
          role={editingRole}
          permissions={permsData.data || []}
          onClose={() => {
            setAddingRole(false);
            setEditingRole(null);
          }}
          onSaved={() => {
            setAddingRole(false);
            setEditingRole(null);
            rolesData.reload();
          }}
        />
      )}
    </>
  );
}

function RoleModal({
  role,
  permissions,
  onClose,
  onSaved,
}: {
  role: RoleDef | null;
  permissions: PermissionDef[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { act, busy } = useAction();
  const [selectedPerms, setSelectedPerms] = useState<string[]>(role?.permissions || []);

  const groups = Array.from(new Set(permissions.map((p) => p.group)));

  const togglePerm = (permId: string) => {
    setSelectedPerms((prev) =>
      prev.includes(permId) ? prev.filter((id) => id !== permId) : [...prev, permId],
    );
  };

  const toggleGroup = (groupName: string) => {
    const groupPermIds = permissions.filter((p) => p.group === groupName).map((p) => p.id);
    const allSelected = groupPermIds.every((id) => selectedPerms.includes(id));
    if (allSelected) {
      setSelectedPerms((prev) => prev.filter((id) => !groupPermIds.includes(id)));
    } else {
      setSelectedPerms((prev) => Array.from(new Set([...prev, ...groupPermIds])));
    }
  };

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!selectedPerms.length) {
      alert('يجب تحديد صلاحية واحدة على الأقل');
      return;
    }
    const f = new FormData(e.currentTarget);
    const name = String(f.get('name') || '').trim();
    const description = String(f.get('description') || '').trim();
    const code = String(f.get('code') || '').trim();

    void act(async () => {
      if (role) {
        await api(`/roles/${role.id}`, 'PUT', {
          name,
          description,
          permissions: selectedPerms,
        });
      } else {
        await api('/roles', 'POST', {
          name,
          code: code || undefined,
          description,
          permissions: selectedPerms,
        });
      }
      onSaved();
    }, 'تم حفظ الدور بنجاح');
  };

  return (
    <Modal title={role ? `تعديل الدور: ${role.name}` : 'إنشاء دور جديد'} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="modal-body form-grid">
          <Field label="اسم الدور *">
            <input name="name" defaultValue={role?.name} required maxLength={100} />
          </Field>
          {!role && (
            <Field label="رمز الدور (اختياري)" hint="حروف إنجليزية كبيرة مثل ACCOUNTANT_LEAD">
              <input name="code" maxLength={50} dir="ltr" />
            </Field>
          )}
          <Field label="الوصف" hint="نبذة عن مهام هذا الدور ومسؤولياته">
            <input name="description" defaultValue={role?.description} maxLength={300} />
          </Field>

          <div style={{ marginTop: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <strong>صلاحيات الدور ({selectedPerms.length} محددة) *</strong>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  type="button"
                  className="perm-group-toggle"
                  onClick={() => setSelectedPerms(permissions.map((p) => p.id))}
                >
                  تحديد الكل
                </button>
                <span className="muted">|</span>
                <button
                  type="button"
                  className="perm-group-toggle"
                  onClick={() => setSelectedPerms([])}
                >
                  إلغاء الكل
                </button>
              </div>
            </div>

            <div className="perms-group-grid">
              {groups.map((group) => {
                const groupPerms = permissions.filter((p) => p.group === group);
                const allSelected = groupPerms.every((p) => selectedPerms.includes(p.id));
                return (
                  <div className="perm-group-box" key={group}>
                    <div className="perm-group-header">
                      <strong>{group}</strong>
                      <button
                        type="button"
                        className="perm-group-toggle"
                        onClick={() => toggleGroup(group)}
                      >
                        {allSelected ? 'إلغاء المجموعة' : 'تحديد المجموعة'}
                      </button>
                    </div>
                    {groupPerms.map((perm) => (
                      <label className="perm-check-item" key={perm.id}>
                        <input
                          type="checkbox"
                          checked={selectedPerms.includes(perm.id)}
                          onChange={() => togglePerm(perm.id)}
                        />
                        <span>{perm.name}</span>
                      </label>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <Button type="submit" busy={busy}>
            حفظ الدور
          </Button>
          <Button type="button" variant="secondary" onClick={onClose}>
            إلغاء
          </Button>
        </div>
      </form>
    </Modal>
  );
}
export function ActivityPage() {
  const data = useData<Audit[]>('/audit');
  const [query, setQuery] = useState(''),
    [page, setPage] = useState(1);
  useEffect(() => setPage(1), [query]);
  const items = (data.data || []).filter((a) =>
    (a.action + a.user_name + a.details).toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <>
      <PageHeader
        eyebrow="شفافية في كل خطوة"
        title="سجل النشاط"
        description="تتبّع من قام بالتغييرات ومتى. آخر ٥٠٠ عملية مسجلة في النظام."
        actions={
          <Button
            variant="secondary"
            onClick={() =>
              downloadCSV(
                'سجل-النشاط',
                ['المستخدم', 'العملية', 'التفاصيل', 'التاريخ'],
                items.map((a) => [a.user_name, a.action, a.details, a.created_at]),
              )
            }
          >
            <Download size={16} /> تصدير السجل
          </Button>
        }
      />
      <section className="card">
        <div className="table-toolbar">
          <h2>آخر العمليات</h2>
          <SearchBox value={query} onChange={setQuery} placeholder="بحث في النشاط..." />
        </div>
        {data.loading ? (
          <Loading />
        ) : data.error ? (
          <ErrorState message={data.error} retry={data.reload} />
        ) : !items.length ? (
          <Empty />
        ) : (
          <>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>المستخدم</th>
                    <th>العملية</th>
                    <th>التفاصيل</th>
                    <th>التاريخ والوقت</th>
                  </tr>
                </thead>
                <tbody>
                  {items.slice((page - 1) * 10, page * 10).map((a) => (
                    <tr key={a.id}>
                      <td>
                        <div className="person-cell">
                          <Initials name={a.user_name} />
                          <span>{a.user_name}</span>
                        </div>
                      </td>
                      <td>
                        <span className="category-tag">{a.action}</span>
                      </td>
                      <td className="muted">{a.details || '—'}</td>
                      <td className="muted">
                        {new Intl.DateTimeFormat('ar-EG', {
                          dateStyle: 'medium',
                          timeStyle: 'short',
                          timeZone: 'Africa/Cairo',
                        }).format(new Date(a.created_at))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={page} setPage={setPage} total={items.length} size={10} />
          </>
        )}
      </section>
    </>
  );
}

// Cash & Bank Accounts (Treasury) -----------------------------------------------------------------

export function CashAccountModal({
  account,
  onClose,
  onSaved,
}: {
  account?: CashAccount | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { busy, act } = useAction();
  const { branches } = useBranch();
  const [type, setType] = useState<AccountType>(account?.type || 'CASH');

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const branchId = f.get('branch_id');
    const payload = {
      name: String(f.get('name')),
      type: String(f.get('type')),
      branch_id: branchId ? String(branchId) : undefined,
      currency: 'EGP',
      allow_negative: f.get('allow_negative') === '1' ? 1 : 0,
      bank_name: String(f.get('bank_name') || ''),
      account_number: String(f.get('account_number') || ''),
      notes: String(f.get('notes') || ''),
      ...(account
        ? { active: f.get('active') === '1' ? 1 : 0 }
        : { initial_balance: toCents(f.get('initial_balance')) }),
    };

    void act(async () => {
      if (account) {
        await api(`/cash-accounts/${account.id}`, 'PUT', payload);
      } else {
        await api('/cash-accounts', 'POST', payload);
      }
      onSaved();
    }, account ? 'تم حفظ تعديلات الحساب' : 'تم إنشاء الحساب المالي بنجاح');
  };

  return (
    <Modal
      title={account ? `تعديل الحساب: ${account.name}` : 'إضافة حساب مالي أو خزينة'}
      description="أدر الخزائن النقدية للفروع وحسابات البنوك مع تحديد سياسات السحب على المكشوف."
      onClose={onClose}
    >
      <form onSubmit={submit}>
        <div className="modal-body form-grid">
          <Field label="اسم الحساب / الخزينة *">
            <input
              name="name"
              required
              maxLength={100}
              defaultValue={account?.name || ''}
              placeholder="مثال: خزينة فرع المعادي الرئيسية"
            />
          </Field>
          <div className="form-row">
            <Field label="نوع الحساب *">
              <select
                name="type"
                value={type}
                onChange={(e) => setType(e.target.value as AccountType)}
              >
                <option value="CASH">خزينة نقدية (Cash Drawer)</option>
                <option value="BANK">حساب بنكي (Bank Account)</option>
                <option value="WALLET">محفظة إلكترونية (E-Wallet)</option>
              </select>
            </Field>
            <Field label="الفرع المرتبط">
              <select name="branch_id" defaultValue={account?.branch_id || ''}>
                <option value="">عام / المركز الرئيسي</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          {type === 'BANK' && (
            <div className="form-row">
              <Field label="اسم البنك *">
                <input
                  name="bank_name"
                  required
                  maxLength={100}
                  defaultValue={account?.bank_name || ''}
                  placeholder="مثال: البنك الأهلي المصري"
                />
              </Field>
              <Field label="رقم الحساب / IBAN">
                <input
                  name="account_number"
                  maxLength={100}
                  dir="ltr"
                  defaultValue={account?.account_number || ''}
                  placeholder="مثال: 1234567890123"
                />
              </Field>
            </div>
          )}

          {!account && (
            <Field label="الرصيد الافتتاحي (ج.م)">
              <input
                name="initial_balance"
                type="number"
                step="0.01"
                min="0"
                defaultValue="0.00"
                placeholder="0.00"
              />
            </Field>
          )}

          <Field
            label="سياسة السحب على المكشوف (Overdraft) *"
            hint="منع السحب على المكشوف يرفض أي حركة صرف تتجاوز رصيد الحساب المتاح."
          >
            <select
              name="allow_negative"
              defaultValue={account ? String(account.allow_negative) : '0'}
            >
              <option value="0">منع السحب على المكشوف (الرصيد لا يقل عن صفر)</option>
              <option value="1">السماح بالسحب على المكشوف (رصيد سالب مسموح)</option>
            </select>
          </Field>

          {account && (
            <Field label="حالة الحساب *">
              <select name="active" defaultValue={String(account.active)}>
                <option value="1">نشط ومتاح للعمليات</option>
                <option value="0">مؤرشف / معطل</option>
              </select>
            </Field>
          )}

          <Field label="ملاحظات">
            <textarea
              name="notes"
              maxLength={1000}
              defaultValue={account?.notes || ''}
              placeholder="وصف إضافي أو موقع الخزينة أو مسؤول العهدة..."
            />
          </Field>
        </div>
        <div className="modal-footer">
          <Button type="submit" busy={busy}>
            {account ? 'حفظ التعديلات' : 'إنشاء الحساب'}
          </Button>
          <Button type="button" variant="secondary" onClick={onClose}>
            إلغاء
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function TransferModal({
  accounts,
  fromAccount,
  onClose,
  onSaved,
}: {
  accounts: CashAccount[];
  fromAccount?: CashAccount | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { busy, act } = useAction();
  const [fromId, setFromId] = useState(fromAccount?.id || accounts[0]?.id || '');
  const [toId, setToId] = useState(
    accounts.find((a) => a.id !== (fromAccount?.id || accounts[0]?.id))?.id || '',
  );

  const selectedFrom = accounts.find((a) => a.id === fromId);

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const amountVal = toCents(f.get('amount'));
    if (fromId === toId) {
      alert('لا يمكن التحويل لنفس الحساب');
      return;
    }
    void act(async () => {
      await api('/cash-accounts/transfers', 'POST', {
        from_account_id: fromId,
        to_account_id: toId,
        amount: amountVal,
        date: f.get('date'),
        notes: f.get('notes'),
      });
      onSaved();
    }, 'تم تنفيذ التحويل المالي وتحديث الأرصدة');
  };

  return (
    <Modal
      title="تحويل مالي بين الحسابات والخزائن"
      description="نقل أموال بين خزينة وفرع، أو تغذية نقدية من البنك، أو إيداع إيرادات."
      onClose={onClose}
    >
      <form onSubmit={submit}>
        <div className="modal-body form-grid">
          <div className="form-row">
            <Field label="من حساب / خزينة *">
              <select value={fromId} onChange={(e) => setFromId(e.target.value)}>
                {accounts
                  .filter((a) => a.active)
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} ({money(a.balance, 2)} ج.م)
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="إلى حساب / خزينة *">
              <select value={toId} onChange={(e) => setToId(e.target.value)}>
                {accounts
                  .filter((a) => a.active && a.id !== fromId)
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} ({money(a.balance, 2)} ج.م)
                    </option>
                  ))}
              </select>
            </Field>
          </div>

          <div className="form-row">
            <Field label="المبلغ المراد تحويله (ج.م) *">
              <input
                name="amount"
                type="number"
                step="0.01"
                min="0.01"
                required
                max={
                  selectedFrom && selectedFrom.allow_negative === 0
                    ? selectedFrom.balance / 100
                    : undefined
                }
                placeholder="0.00"
              />
            </Field>
            <Field label="تاريخ التحويل *">
              <input name="date" type="date" required defaultValue={today()} />
            </Field>
          </div>

          {selectedFrom && selectedFrom.allow_negative === 0 && (
            <div className="account-tag shield-ok" style={{ width: 'fit-content' }}>
              <ShieldCheck size={14} />
              الرصيد المتاح في الحساب المحوّل منه: {money(selectedFrom.balance, 2)} ج.م
            </div>
          )}

          <Field label="ملاحظات التحويل">
            <textarea
              name="notes"
              maxLength={1000}
              placeholder="مثال: تغذية خزينة الفرع نقدياً من الحساب البنكي..."
            />
          </Field>
        </div>
        <div className="modal-footer">
          <Button type="submit" busy={busy}>
            تأكيد التحويل المالي
          </Button>
          <Button type="button" variant="secondary" onClick={onClose}>
            إلغاء
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function StatementModal({
  account,
  onClose,
}: {
  account: CashAccount;
  onClose: () => void;
}) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const queryUrl = `/cash-accounts/${account.id}/statement${
    from || to ? `?from=${from || '1970-01-01'}&to=${to || '2099-12-31'}` : ''
  }`;
  const { data, loading, error, reload } = useData<{
    account: CashAccount;
    entries: AccountStatementEntry[];
  }>(queryUrl);

  const entries = data?.entries || [];
  const totalIn = entries.reduce((s, e) => s + e.in_amount, 0);
  const totalOut = entries.reduce((s, e) => s + e.out_amount, 0);

  const entryTypeLabels: Record<AccountStatementEntry['type'], { label: string; badge: string }> = {
    INITIAL: { label: 'رصيد افتتاحي', badge: 'paid' },
    SALE_PAYMENT: { label: 'تحصيل مبيعات', badge: 'paid' },
    PURCHASE_PAYMENT: { label: 'سداد مشتريات', badge: 'pending' },
    SALE_RETURN_REFUND: { label: 'رد مرتجع مبيعات', badge: 'pending' },
    PURCHASE_RETURN_REFUND: { label: 'استرداد مرتجع مشتريات', badge: 'paid' },
    EXPENSE: { label: 'مصروف تشغيلي', badge: 'pending' },
    DISTRIBUTION: { label: 'توزيع أرباح', badge: 'pending' },
    CONTRIBUTION: { label: 'إيداع رأس مال', badge: 'paid' },
    WITHDRAWAL: { label: 'مسحوبات مالك', badge: 'pending' },
    TRANSFER_IN: { label: 'تحويل وارد', badge: 'paid' },
    TRANSFER_OUT: { label: 'تحويل صادر', badge: 'pending' },
  };

  return (
    <Modal
      title={`كشف حساب: ${account.name}`}
      description={`${
        account.type === 'CASH'
          ? 'خزينة نقدية'
          : account.type === 'BANK'
            ? `حساب بنكي (${account.bank_name || 'عام'})`
            : 'محفظة إلكترونية'
      } · ${account.branch_name || 'عام / المركز الرئيسي'}`}
      onClose={onClose}
    >
      <div className="modal-body">
        <div className="statement-summary">
          <div className="statement-sum-card">
            <div className="statement-sum-label">الرصيد الافتتاحي</div>
            <div className="statement-sum-val">{money(account.initial_balance, 2)} ج.م</div>
          </div>
          <div className="statement-sum-card">
            <div className="statement-sum-label">إجمالي المقبوضات (الوارد)</div>
            <div className="statement-sum-val in-flow">+{money(totalIn, 2)} ج.م</div>
          </div>
          <div className="statement-sum-card">
            <div className="statement-sum-label">إجمالي المدفوعات (المنصرف)</div>
            <div className="statement-sum-val out-flow">-{money(totalOut, 2)} ج.م</div>
          </div>
          <div className="statement-sum-card">
            <div className="statement-sum-label">الرصيد الحالي</div>
            <div className={`statement-sum-val ${account.balance < 0 ? 'out-flow' : 'in-flow'}`}>
              {money(account.balance, 2)} ج.م
            </div>
          </div>
        </div>

        <div className="table-toolbar" style={{ marginTop: '12px' }}>
          <div className="table-filters" style={{ width: '100%', display: 'flex', gap: '8px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <Field label="من تاريخ">
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </Field>
            <Field label="إلى تاريخ">
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </Field>
            {(from || to) && (
              <Button
                variant="secondary"
                onClick={() => {
                  setFrom('');
                  setTo('');
                }}
              >
                إلغاء التصفية
              </Button>
            )}
            <Button
              variant="secondary"
              onClick={() =>
                downloadCSV(
                  `كشف-حساب-${account.name}`,
                  ['التاريخ', 'النوع', 'البيان', 'المرجع', 'الوارد', 'المنصرف', 'الرصيد'],
                  entries.map((e) => [
                    e.date,
                    entryTypeLabels[e.type]?.label || e.type,
                    e.description,
                    e.reference || '',
                    e.in_amount / 100,
                    e.out_amount / 100,
                    e.balance / 100,
                  ]),
                )
              }
            >
              <Download size={14} /> تصدير
            </Button>
          </div>
        </div>

        {error ? (
          <ErrorState message={error} retry={reload} />
        ) : loading ? (
          <Loading />
        ) : !entries.length ? (
          <Empty description="لا توجد حركات مسجلة لهذا الحساب خلال الفترة المحددة" />
        ) : (
          <div className="table-scroll" style={{ maxHeight: '380px' }}>
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>التاريخ</th>
                  <th>نوع الحركة</th>
                  <th>البيان والملاحظات</th>
                  <th className="num">الوارد (+)</th>
                  <th className="num">المنصرف (-)</th>
                  <th className="num">الرصيد</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e, idx) => (
                  <tr key={e.id + '_' + idx}>
                    <td className="num muted">{idx + 1}</td>
                    <td className="muted">{formatDate(e.date, true)}</td>
                    <td>
                      <span className={`badge ${entryTypeLabels[e.type]?.badge || 'draft'}`}>
                        {entryTypeLabels[e.type]?.label || e.type}
                      </span>
                    </td>
                    <td>
                      <div>{e.description}</div>
                      {e.reference && <small className="cell-sub">{e.reference}</small>}
                    </td>
                    <td className="num in-flow">
                      {e.in_amount > 0 ? `+${money(e.in_amount, 2)}` : '—'}
                    </td>
                    <td className="num out-flow">
                      {e.out_amount > 0 ? `-${money(e.out_amount, 2)}` : '—'}
                    </td>
                    <td className="num amount">
                      <strong>{money(e.balance, 2)}</strong> <small>ج.م</small>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <div className="modal-footer">
        <Button variant="secondary" onClick={onClose}>
          إغلاق
        </Button>
      </div>
    </Modal>
  );
}

export function Accounts() {
  const { user } = useSession();
  const { activeId } = useBranch();
  const accountsData = useData<CashAccount[]>(withBranch('/cash-accounts', activeId));
  const transfersData = useData<AccountTransfer[]>('/cash-accounts/transfers');

  const [tab, setTab] = useState<'accounts' | 'transfers'>('accounts');
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [page, setPage] = useState(1);

  const [addingAccount, setAddingAccount] = useState(false);
  const [editingAccount, setEditingAccount] = useState<CashAccount | null>(null);
  const [transferModal, setTransferModal] = useState<{
    open: boolean;
    fromAccount?: CashAccount | null;
  }>({
    open: false,
  });
  const [statementAccount, setStatementAccount] = useState<CashAccount | null>(null);

  const accounts = accountsData.data || [];
  const transfers = transfersData.data || [];

  const filteredAccounts = accounts.filter(
    (a) =>
      (typeFilter === 'all' || a.type === typeFilter) &&
      (a.name + (a.bank_name || '') + (a.account_number || '') + (a.notes || ''))
        .toLowerCase()
        .includes(query.toLowerCase()),
  );

  const filteredTransfers = transfers.filter((t) =>
    (t.number + (t.from_account_name || '') + (t.to_account_name || '') + t.notes)
      .toLowerCase()
      .includes(query.toLowerCase()),
  );

  const totalLiquidity = accounts.reduce((s, a) => s + a.balance, 0);
  const bankLiquidity = accounts
    .filter((a) => a.type === 'BANK')
    .reduce((s, a) => s + a.balance, 0);
  const cashLiquidity = accounts
    .filter((a) => a.type === 'CASH' || a.type === 'WALLET')
    .reduce((s, a) => s + a.balance, 0);

  const reloadAll = () => {
    accountsData.reload();
    transfersData.reload();
  };

  return (
    <>
      <PageHeader
        eyebrow="إدارة السيولة النقدية والبنكية"
        title="الخزائن والحسابات البنكية"
        description="راقب أرصدة خزائن الفروع وحسابات البنوك، ونفّذ التحويلات المالية الداخلية مع كشف حساب تفصيلي لحظي."
        actions={
          <>
            <Button
              variant="secondary"
              onClick={() =>
                downloadCSV(
                  tab === 'accounts' ? 'الحسابات-المالية' : 'التحويلات-المالية',
                  tab === 'accounts'
                    ? ['الاسم', 'النوع', 'الفرع', 'الرصيد', 'السحب على المكشوف', 'الحالة']
                    : ['رقم التحويل', 'من حساب', 'إلى حساب', 'المبلغ', 'التاريخ', 'ملاحظات'],
                  tab === 'accounts'
                    ? filteredAccounts.map((a) => [
                        a.name,
                        a.type === 'CASH' ? 'خزينة' : a.type === 'BANK' ? 'بنك' : 'محفظة',
                        a.branch_name || 'عام',
                        a.balance / 100,
                        a.allow_negative ? 'مسموح' : 'ممنوع',
                        a.active ? 'نشط' : 'مؤرشف',
                      ])
                    : filteredTransfers.map((t) => [
                        t.number,
                        t.from_account_name || '',
                        t.to_account_name || '',
                        t.amount / 100,
                        t.date,
                        t.notes,
                      ]),
                )
              }
            >
              <Download size={16} /> تصدير
            </Button>
            {user.role === 'ADMIN' && (
              <>
                <Button variant="secondary" onClick={() => setTransferModal({ open: true })}>
                  <ArrowRightLeft size={16} /> تحويل بين الحسابات
                </Button>
                <Button onClick={() => setAddingAccount(true)}>
                  <Plus size={18} /> إضافة حساب مالي
                </Button>
              </>
            )}
          </>
        }
      />

      <div className="stats-grid three">
        <Stat
          label="إجمالي السيولة المتاحة"
          value={money(totalLiquidity)}
          icon={<Wallet size={20} />}
          tone={totalLiquidity >= 0 ? 'green' : 'amber'}
          foot="مجموع أرصدة جميع الخزائن والبنوك"
        />
        <Stat
          label="الأرصدة البنكية"
          value={money(bankLiquidity)}
          icon={<Building2 size={20} />}
          tone="blue"
          foot={`${accounts.filter((a) => a.type === 'BANK').length} حسابات بنكية`}
        />
        <Stat
          label="أرصدة الخزائن النقدية والمحافظ"
          value={money(cashLiquidity)}
          icon={<Banknote size={20} />}
          tone="amber"
          foot={`${accounts.filter((a) => a.type !== 'BANK').length} خزائن نقدية ومحافظ`}
        />
      </div>

      <section className="card">
        <div className="table-toolbar">
          <div className="tabs">
            <button
              className={tab === 'accounts' ? 'active' : ''}
              onClick={() => {
                setTab('accounts');
                setPage(1);
              }}
            >
              الحسابات والخزائن المالية ({accounts.length})
            </button>
            <button
              className={tab === 'transfers' ? 'active' : ''}
              onClick={() => {
                setTab('transfers');
                setPage(1);
              }}
            >
              <ArrowRightLeft size={14} /> سجل التحويلات الداخلية ({transfers.length})
            </button>
          </div>
          <div className="table-filters">
            <SearchBox
              value={query}
              onChange={setQuery}
              placeholder={tab === 'accounts' ? 'بحث عن حساب أو بنك...' : 'بحث في التحويلات...'}
            />
            {tab === 'accounts' && (
              <select
                className="filter-select"
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
              >
                <option value="all">كل الأنواع</option>
                <option value="CASH">خزائن نقدية</option>
                <option value="BANK">حسابات بنكية</option>
                <option value="WALLET">محافظ إلكترونية</option>
              </select>
            )}
          </div>
        </div>

        {tab === 'accounts' ? (
          accountsData.error ? (
            <ErrorState message={accountsData.error} retry={accountsData.reload} />
          ) : accountsData.loading ? (
            <Loading />
          ) : !filteredAccounts.length ? (
            <Empty description="لا توجد حسابات مالية مسجلة بعد" />
          ) : (
            <div className="accounts-grid" style={{ padding: '16px' }}>
              {filteredAccounts.map((acc) => (
                <div key={acc.id} className={`account-card ${!acc.active ? 'archived' : ''}`}>
                  <div className="account-header">
                    <div className="account-meta">
                      <div
                        className={`account-avatar ${
                          acc.type === 'CASH' ? 'cash' : acc.type === 'BANK' ? 'bank' : 'wallet'
                        }`}
                      >
                        {acc.type === 'CASH' ? (
                          <Wallet size={22} />
                        ) : acc.type === 'BANK' ? (
                          <Building2 size={22} />
                        ) : (
                          <CreditCard size={22} />
                        )}
                      </div>
                      <div className="account-title-area">
                        <h3>{acc.name}</h3>
                        <div className="account-sub">
                          <span>{acc.branch_name || 'عام · المركز الرئيسي'}</span>
                          {acc.bank_name && <span>· {acc.bank_name}</span>}
                        </div>
                      </div>
                    </div>
                    <span
                      className={`badge ${
                        acc.type === 'CASH' ? 'paid' : acc.type === 'BANK' ? 'draft' : 'pending'
                      }`}
                    >
                      {acc.type === 'CASH' ? 'خزينة' : acc.type === 'BANK' ? 'بنك' : 'محفظة'}
                    </span>
                  </div>

                  <div className={`account-balance-box ${acc.balance < 0 ? 'negative' : ''}`}>
                    <span className="account-balance-label">الرصيد المتاح</span>
                    <span className={`account-balance-val ${acc.balance < 0 ? 'negative' : ''}`}>
                      {money(acc.balance, 2)} <small>ج.م</small>
                    </span>
                  </div>

                  <div className="account-info-tags">
                    {acc.allow_negative === 0 ? (
                      <span className="account-tag shield-ok">
                        <ShieldCheck size={12} /> منع السحب على المكشوف
                      </span>
                    ) : (
                      <span className="account-tag shield-warn">
                        <AlertTriangle size={12} /> سحب مكشوف مسموح
                      </span>
                    )}
                    {acc.account_number && (
                      <span className="account-tag" dir="ltr">
                        #{acc.account_number}
                      </span>
                    )}
                  </div>

                  {acc.notes && (
                    <div
                      className="muted cell-sub"
                      style={{ marginBottom: '14px', fontSize: '11px' }}
                    >
                      {acc.notes}
                    </div>
                  )}

                  <div className="account-actions">
                    <Button
                      variant="secondary"
                      onClick={() => setStatementAccount(acc)}
                    >
                      <ReceiptText size={14} /> كشف الحساب
                    </Button>
                    {user.role === 'ADMIN' && (
                      <>
                        <Button
                          variant="secondary"
                          onClick={() => setTransferModal({ open: true, fromAccount: acc })}
                        >
                          <ArrowRightLeft size={14} /> تحويل
                        </Button>
                        <Button
                          variant="secondary"
                          onClick={() => setEditingAccount(acc)}
                        >
                          <Pencil size={14} />
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )
        ) : transfersData.error ? (
          <ErrorState message={transfersData.error} retry={transfersData.reload} />
        ) : transfersData.loading ? (
          <Loading />
        ) : !filteredTransfers.length ? (
          <Empty description="لم يتم تسجيل أي تحويلات بين الحسابات حتى الآن" />
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>رقم التحويل</th>
                  <th>التاريخ</th>
                  <th>من حساب</th>
                  <th>إلى حساب</th>
                  <th className="num">المبلغ</th>
                  <th>الملاحظات</th>
                </tr>
              </thead>
              <tbody>
                {filteredTransfers
                  .slice((page - 1) * 10, page * 10)
                  .map((t) => (
                    <tr key={t.id}>
                      <td className="num">
                        <strong>{t.number}</strong>
                      </td>
                      <td className="muted">{formatDate(t.date, true)}</td>
                      <td>
                        <span className="account-tag">{t.from_account_name}</span>
                      </td>
                      <td>
                        <span className="account-tag in-flow">{t.to_account_name}</span>
                      </td>
                      <td className="num amount">
                        <strong>{money(t.amount, 2)}</strong> <small>ج.م</small>
                      </td>
                      <td className="muted notes-cell">{t.notes || '—'}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
            <Pagination page={page} setPage={setPage} total={filteredTransfers.length} size={10} />
          </div>
        )}
      </section>

      {addingAccount && (
        <CashAccountModal
          onClose={() => setAddingAccount(false)}
          onSaved={() => {
            setAddingAccount(false);
            reloadAll();
          }}
        />
      )}

      {editingAccount && (
        <CashAccountModal
          account={editingAccount}
          onClose={() => setEditingAccount(null)}
          onSaved={() => {
            setEditingAccount(null);
            reloadAll();
          }}
        />
      )}

      {transferModal.open && (
        <TransferModal
          accounts={accounts}
          fromAccount={transferModal.fromAccount}
          onClose={() => setTransferModal({ open: false })}
          onSaved={() => {
            setTransferModal({ open: false });
            reloadAll();
          }}
        />
      )}

      {statementAccount && (
        <StatementModal
          account={statementAccount}
          onClose={() => setStatementAccount(null)}
        />
      )}
    </>
  );
}

