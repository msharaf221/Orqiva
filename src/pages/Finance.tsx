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
  Shield,
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
  Role,
} from '../types';
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
    void act(async () => {
      await api('/expenses', 'POST', {
        title: f.get('title'),
        category: f.get('category'),
        amount: toCents(f.get('amount')),
        date: f.get('date'),
        method: f.get('method'),
        notes: f.get('notes'),
        ...scoped,
      });
      setAdding(false);
      data.reload();
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
                      <td>{methods[e.method]}</td>
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
                      <td>{methods[p.method]}</td>
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
          {user.role === 'ADMIN' && (
            <button onClick={() => setTab('users')} className={tab === 'users' ? 'active' : ''}>
              <Users size={19} />
              <div>
                <strong>فريق العمل</strong>
                <small>المستخدمون والصلاحيات</small>
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
const ROLE_LABELS: Record<Role, string> = {
  ADMIN: 'مدير النظام',
  BRANCH_MANAGER: 'مدير فرع',
  GENERAL_ACCOUNTANT: 'محاسب عام',
  TREASURY_ACCOUNTANT: 'محاسب خزنة',
  CASHIER: 'كاشير',
  STAFF: 'موظف مبيعات',
};

function UserSettings() {
  const { user } = useSession();
  const { branches } = useBranch();
  const data = useData<User[]>('/users');
  const [adding, setAdding] = useState(false),
    [editing, setEditing] = useState<User | null>(null),
    [customizing, setCustomizing] = useState<User | null>(null);
  const { busy, act } = useAction();
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    void act(async () => {
      if (editing)
        await api('/users/' + editing.id, 'PATCH', {
          role: f.get('role'),
          active: f.get('active') === '1',
        });
      else
        await api('/users', 'POST', {
          name: f.get('name'),
          email: f.get('email'),
          password: f.get('password'),
          role: f.get('role'),
          branch_ids: f.getAll('branch_ids').map(String),
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
            <h2>فريق العمل والصلاحيات</h2>
            <p>حدد أدوار الموظفين وخصص الصلاحيات الفردية والاستثناءات لكل مستخدم.</p>
          </div>
          <Button onClick={() => setAdding(true)}>
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
                  {u.active ? ROLE_LABELS[u.role] || u.role : 'معطل'}
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
                    onClick={() => setEditing(u)}
                    title={'تعديل بيانات ' + u.name}
                    aria-label={'تعديل بيانات ' + u.name}
                  >
                    <Pencil size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="permissions-note">
          <h3>هيكل الأدوار والصلاحيات المخصصة</h3>
          <p>
            <b>مدير النظام (ADMIN):</b> وصول كامل لكافة العمليات وإعدادات الشركة وإدارة المستخدمين
            والفروع.
          </p>
          <p>
            <b>مدير الفرع (BRANCH_MANAGER):</b> مبيعات ومشتريات ومخزون الفرع والتحويلات وصلاحيات
            نقطة البيع POS والتقارير.
          </p>
          <p>
            <b>محاسب عام (GENERAL_ACCOUNTANT):</b> القيود المالية، المبيعات والمشتريات، المصروفات،
            والتقارير المالية الموسعة.
          </p>
          <p>
            <b>محاسب خزنة (TREASURY_ACCOUNTANT):</b> المصروفات وحركات الخزينة وتقفيل ورديات الكاشير
            والتقارير المالية.
          </p>
          <p>
            <b>كاشير (CASHIER):</b> واجهة نقطة البيع السريعة POS، فتح الوردية وحركات الدرج النقدي
            وإغلاق الوردية والبيع للعملاء.
          </p>
          <p>
            <b>موظف مبيعات (STAFF):</b> الاطلاع على المبيعات والعملاء وإنشاء فواتير المبيعات.
          </p>
          <p className="perms-tip">
            💡 <b>الاستثناءات والتخصيص الفردي:</b> يمكنك النقر على أيقونة الدرع 🛡️ بجانب أي مستخدم
            لمنح (+) أو حجب (-) أي صلاحية محددة استثنائياً دون تغيير دوره العام.
          </p>
        </div>
      </section>
      {(adding || editing) && (
        <Modal
          title={editing ? 'تعديل بيانات ودور المستخدم' : 'إضافة مستخدم جديد'}
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
              {!editing && (
                <div className="field branch-field">
                  <span>الفروع المسموح بها (للموظف)</span>
                  <div className="branch-checks">
                    {branches.map((b) => (
                      <label key={b.id} className="check-line">
                        <input type="checkbox" name="branch_ids" value={b.id} />
                        {b.name}
                      </label>
                    ))}
                  </div>
                  <small>
                    المدير يرى كل الفروع تلقائياً. عدّل صلاحيات الفروع لاحقاً من صفحة كل فرع.
                  </small>
                </div>
              )}
              <Field label="الدور الوظيفي">
                <select name="role" defaultValue={editing?.role || 'STAFF'}>
                  <option value="ADMIN">مدير النظام (كامل الصلاحيات)</option>
                  <option value="BRANCH_MANAGER">مدير فرع</option>
                  <option value="GENERAL_ACCOUNTANT">محاسب عام</option>
                  <option value="TREASURY_ACCOUNTANT">محاسب خزنة</option>
                  <option value="CASHIER">كاشير نقطة بيع</option>
                  <option value="STAFF">موظف مبيعات</option>
                </select>
              </Field>
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
