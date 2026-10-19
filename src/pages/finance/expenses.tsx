import { useState, useEffect, type FormEvent } from 'react';
import { Plus, Download, Wallet, ReceiptText, ShieldCheck, Banknote } from 'lucide-react';
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
  money,
  count,
  toCents,
  today,
  formatDate,
  downloadCSV,
  methods,
} from '../../lib';
import type { Expense, CashAccount } from '../../types';
import { useBranch, withBranch } from '../../branch';

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
                        {a.name} (
                        {a.type === 'CASH' ? 'خزينة' : a.type === 'BANK' ? 'حساب بنكي' : 'محفظة'}) —
                        الرصيد: {money(a.balance, 2)} ج.م
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
