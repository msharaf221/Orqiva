/**
 * General Ledger (دفتر الأستاذ) — books of record screen.
 *
 * Four views over the same books:
 *  - القيود (journal): every journal entry with a detail drawer showing both sides.
 *  - دليل الحسابات (chart): the account list with codes, types and activity counts.
 *  - ميزان المراجعة (trial balance): debit/credit totals per account plus opening balances.
 *  - الإعدادات (settings): fiscal year start and the period lock.
 *
 * Every figure is derived server-side from journal_lines; this page never computes balances.
 */

import { useEffect, useState, type FormEvent } from 'react';
import {
  BookOpen,
  ListTree,
  Scale,
  Settings2,
  Plus,
  Download,
  Trash2,
  Printer,
} from 'lucide-react';
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
  money,
  count,
  toCents,
  today,
  formatDate,
  downloadCSV,
} from '../../lib';
import { useBranch, withBranch } from '../../branch';
import { can } from '../../auth';
import type {
  ChartAccount,
  JournalEntry,
  JournalLine,
  TrialBalanceRow,
  LedgerAccountStatement,
  GlSettings,
  GlAccountType,
} from '../../types';

const TYPE_LABELS: Record<GlAccountType, string> = {
  ASSET: 'أصول',
  LIABILITY: 'التزامات',
  EQUITY: 'حقوق ملكية',
  REVENUE: 'إيرادات',
  EXPENSE: 'مصروفات',
};

const SOURCE_LABELS: Record<string, string> = {
  SALE: 'فاتورة بيع',
  PURCHASE: 'فاتورة شراء',
  SALE_RETURN: 'مرتجع بيع',
  PURCHASE_RETURN: 'مرتجع شراء',
  PAYMENT: 'دفعة',
  EXPENSE: 'مصروف',
  ACCOUNT_TRANSFER: 'تحويل مالي',
  POS_CASH: 'حركة درج',
  POS_SHIFT: 'وردية كاشير',
  TRANSFER: 'تحويل بضاعة',
  STOCKTAKE: 'جرد دوري',
  DISTRIBUTION: 'توزيعات',
  EQUITY: 'حقوق ملكية',
  MANUAL: 'قيد يدوي',
  REVERSAL: 'قيد عكسي',
  OPENING: 'رصيد افتتاحي',
};

const TYPE_TONE: Record<GlAccountType, string> = {
  ASSET: 'in-flow',
  LIABILITY: 'out-flow',
  EQUITY: '',
  REVENUE: 'in-flow',
  EXPENSE: 'out-flow',
};

export function Ledger() {
  const { user } = useSession();
  const [tab, setTab] = useState<'journal' | 'chart' | 'trial' | 'settings'>('journal');
  const canManage = can(user, 'gl:manage');
  return (
    <>
      <PageHeader
        eyebrow="قيود متوازنة، ودفتر واحد للحقيقة"
        title="دفتر الأستاذ"
        description="كل حركة في أوركيفا تُرحَّل تلقائياً كقيد مزدوج متوازن — راجع القيود، ودليل الحسابات، وميزان المراجعة."
      />
      <div className="table-toolbar">
        <div className="tabs">
          <button className={tab === 'journal' ? 'active' : ''} onClick={() => setTab('journal')}>
            <span>القيود اليومية</span>
          </button>
          <button className={tab === 'chart' ? 'active' : ''} onClick={() => setTab('chart')}>
            <span>دليل الحسابات</span>
          </button>
          <button className={tab === 'trial' ? 'active' : ''} onClick={() => setTab('trial')}>
            <span>ميزان المراجعة</span>
          </button>
          <button className={tab === 'settings' ? 'active' : ''} onClick={() => setTab('settings')}>
            <span>الإعدادات</span>
          </button>
        </div>
      </div>
      {tab === 'journal' ? (
        <JournalTab canManage={canManage} />
      ) : tab === 'chart' ? (
        <ChartTab canManage={canManage} />
      ) : tab === 'trial' ? (
        <TrialTab />
      ) : (
        <SettingsTab canManage={canManage} />
      )}
    </>
  );
}

// ── القيود اليومية ────────────────────────────────────────────────────────────────────────

function JournalTab({ canManage }: { canManage: boolean }) {
  const { activeId } = useBranch();
  const [from, setFrom] = useState(today().slice(0, 8) + '01');
  const [to, setTo] = useState(today());
  const [query, setQuery] = useState('');
  const [detail, setDetail] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const data = useData<JournalEntry[]>(withBranch(`/gl/journal?from=${from}&to=${to}`, activeId));

  const entries = (data.data || []).filter(
    (e) =>
      e.number.toLowerCase().includes(query.toLowerCase()) ||
      e.memo.toLowerCase().includes(query.toLowerCase()),
  );
  const totalDebit = entries.reduce((s, e) => s + (e.total || 0), 0);

  return (
    <>
      <div className="stats-grid three">
        <Stat
          label="عدد القيود"
          value={count(entries.length)}
          unit="قيد"
          icon={<BookOpen size={18} />}
          foot={`من ${formatDate(from, true)} إلى ${formatDate(to, true)}`}
        />
        <Stat
          label="إجمالي الحركة"
          value={money(totalDebit)}
          icon={<Scale size={18} />}
          foot="مجموع الجانب المدين لكل قيد ظاهر"
        />
      </div>
      <div className="table-toolbar">
        <div className="table-filters">
          <label className="date-filter">
            <span>من</span>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="date-filter">
            <span>إلى</span>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
          <SearchBox value={query} onChange={setQuery} placeholder="بحث برقم القيد أو البيان..." />
        </div>
        <div className="heading-actions">
          <Button
            variant="secondary"
            onClick={() =>
              downloadCSV(
                'القيود اليومية',
                ['رقم القيد', 'التاريخ', 'البيان', 'المصدر', 'الحالة', 'المبلغ'],
                entries.map((e) => [
                  e.number,
                  e.date,
                  e.memo,
                  SOURCE_LABELS[e.source_type] || e.source_type,
                  e.status,
                  e.total || 0,
                ]),
              )
            }
          >
            <Download size={16} /> تصدير
          </Button>
          {canManage && (
            <Button onClick={() => setAdding(true)}>
              <Plus size={16} /> قيد يدوي
            </Button>
          )}
        </div>
      </div>
      {data.loading ? (
        <Loading />
      ) : data.error ? (
        <ErrorState message={data.error} retry={data.reload} />
      ) : !entries.length ? (
        <Empty
          title="لا توجد قيود في هذه الفترة"
          description="رحّل فاتورة أو سجّل مصروفاً وسيظهر القيد هنا تلقائياً."
        />
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>القيد</th>
                <th>التاريخ</th>
                <th>البيان</th>
                <th>المصدر</th>
                <th>الفرع</th>
                <th>المبلغ</th>
                <th>الحالة</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id} onClick={() => setDetail(e.id)}>
                  <td className="num">
                    <strong>{e.number}</strong>
                  </td>
                  <td className="num muted">{formatDate(e.date, true)}</td>
                  <td>{e.memo}</td>
                  <td>
                    <span className="account-tag">
                      {SOURCE_LABELS[e.source_type] || e.source_type}
                    </span>
                  </td>
                  <td className="muted">{e.branch_name ?? 'المجموعة'}</td>
                  <td className="num amount">{money(e.total || 0)}</td>
                  <td>
                    <span
                      className={'account-tag ' + (e.status === 'POSTED' ? 'in-flow' : 'out-flow')}
                    >
                      {e.status === 'POSTED'
                        ? 'مُرحَّل'
                        : e.status === 'REVERSED'
                          ? 'معكوس'
                          : 'مسودة'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {detail && <JournalDetailModal id={detail} onClose={() => setDetail(null)} />}
      {adding && (
        <ManualEntryModal
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            data.reload();
          }}
        />
      )}
    </>
  );
}

function JournalDetailModal({ id, onClose }: { id: string; onClose: () => void }) {
  const { data, loading, error, reload } = useData<{
    entry: JournalEntry;
    lines: JournalLine[];
  }>(`/gl/journal/${id}`);
  const debit = (data?.lines || []).reduce((s, l) => s + l.debit, 0);
  const credit = (data?.lines || []).reduce((s, l) => s + l.credit, 0);
  return (
    <Modal title={`تفاصيل القيد ${data?.entry.number ?? ''}`} onClose={onClose} wide>
      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorState message={error} retry={reload} />
      ) : data ? (
        <>
          <div className="modal-body">
            <div className="form-grid">
              <div>
                <span className="muted">التاريخ</span>
                <strong className="num">{formatDate(data.entry.date)}</strong>
              </div>
              <div>
                <span className="muted">المصدر</span>
                <strong>{SOURCE_LABELS[data.entry.source_type] || data.entry.source_type}</strong>
              </div>
              <div>
                <span className="muted">الفرع</span>
                <strong>{data.entry.branch_name ?? 'المجموعة'}</strong>
              </div>
              <div>
                <span className="muted">أنشأه</span>
                <strong>{data.entry.created_by_name}</strong>
              </div>
            </div>
            {data.entry.memo && <p className="muted">{data.entry.memo}</p>}
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>الحساب</th>
                    <th>مدين</th>
                    <th>دائن</th>
                  </tr>
                </thead>
                <tbody>
                  {data.lines.map((l) => (
                    <tr key={l.id}>
                      <td>
                        <strong>{l.account_name}</strong>
                        <small className="cell-sub num">{l.account_code}</small>
                      </td>
                      <td className="num amount">{l.debit ? money(l.debit) : '—'}</td>
                      <td className="num amount">{l.credit ? money(l.credit) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <th>الإجمالي</th>
                    <th className="num amount">{money(debit)}</th>
                    <th className="num amount">{money(credit)}</th>
                  </tr>
                </tfoot>
              </table>
            </div>
            {debit !== credit && (
              <p className="muted">تحذير: القيد غير متوازن — راجع البيانات قبل الاعتماد.</p>
            )}
          </div>
          <div className="modal-footer">
            <Button variant="ghost" onClick={onClose}>
              إغلاق
            </Button>
          </div>
        </>
      ) : null}
    </Modal>
  );
}

function ManualEntryModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const accountsData = useData<ChartAccount[]>('/gl/accounts');
  const accounts = (accountsData.data || []).filter((a) => a.active);
  const { busy, act } = useAction();
  const [rows, setRows] = useState([{ account_id: '', debit: '', credit: '' }]);
  const debit = rows.reduce((s, r) => s + toCents(r.debit || '0'), 0);
  const credit = rows.reduce((s, r) => s + toCents(r.credit || '0'), 0);
  const balanced = debit === credit && debit > 0;

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    void act(async () => {
      await api('/gl/journal', 'POST', {
        date: f.get('date'),
        memo: f.get('memo'),
        branch_id: f.get('branch_id') ? String(f.get('branch_id')) : null,
        lines: rows.map((r) => ({
          account_id: r.account_id,
          debit: toCents(r.debit || '0'),
          credit: toCents(r.credit || '0'),
          memo: '',
        })),
      });
      onSaved();
    }, 'تم ترحيل القيد');
  };

  const update = (index: number, key: 'account_id' | 'debit' | 'credit', value: string) =>
    setRows((rs) => rs.map((r, i) => (i === index ? { ...r, [key]: value } : r)));

  return (
    <Modal
      title="قيد يومية يدوي"
      description="يجب أن يتساوى إجمالي المدين مع إجمالي الدائن قبل الترحيل."
      onClose={onClose}
      wide
    >
      {accountsData.loading ? (
        <Loading />
      ) : (
        <form onSubmit={submit}>
          <div className="modal-body form-grid">
            <div className="form-row">
              <Field label="التاريخ *">
                <input name="date" type="date" defaultValue={today()} required />
              </Field>
              <Field label="الفرع (اختياري)">
                <BranchSelect name="branch_id" />
              </Field>
            </div>
            <Field label="البيان *">
              <input name="memo" placeholder="مثال: تسوية افتتاحية" required maxLength={300} />
            </Field>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>الحساب</th>
                    <th>مدين</th>
                    <th>دائن</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i}>
                      <td>
                        <select
                          className="filter-select"
                          value={r.account_id}
                          onChange={(e) => update(i, 'account_id', e.target.value)}
                          required
                        >
                          <option value="">اختر حساباً...</option>
                          {accounts.map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.code} — {a.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <input
                          className="num"
                          inputMode="decimal"
                          value={r.debit}
                          onChange={(e) => update(i, 'debit', e.target.value)}
                          placeholder="0"
                        />
                      </td>
                      <td>
                        <input
                          className="num"
                          inputMode="decimal"
                          value={r.credit}
                          onChange={(e) => update(i, 'credit', e.target.value)}
                          placeholder="0"
                        />
                      </td>
                      <td>
                        <button
                          type="button"
                          className="icon-btn"
                          onClick={() => setRows((rs) => rs.filter((_, x) => x !== i))}
                          disabled={rows.length <= 2}
                          aria-label="حذف البند"
                        >
                          <Trash2 size={15} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="table-toolbar">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setRows((rs) => [...rs, { account_id: '', debit: '', credit: '' }])}
              >
                <Plus size={15} /> إضافة بند
              </Button>
              <div className="account-info-tags">
                <span className="account-tag">مدين: {money(debit)}</span>
                <span className="account-tag">دائن: {money(credit)}</span>
                <span className={'account-tag ' + (balanced ? 'in-flow' : 'out-flow')}>
                  {balanced ? 'متوازن ✓' : 'غير متوازن'}
                </span>
              </div>
            </div>
          </div>
          <div className="modal-footer">
            <Button type="button" variant="ghost" onClick={onClose}>
              إلغاء
            </Button>
            <Button type="submit" busy={busy} disabled={!balanced}>
              ترحيل القيد
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

// ── دليل الحسابات ─────────────────────────────────────────────────────────────────────────

function ChartTab({ canManage }: { canManage: boolean }) {
  const data = useData<ChartAccount[]>('/gl/accounts');
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<ChartAccount | null>(null);
  const [creating, setCreating] = useState(false);
  const [statement, setStatement] = useState<ChartAccount | null>(null);
  const { busy, act } = useAction();

  const accounts = (data.data || []).filter(
    (a) => a.code.includes(query) || a.name.includes(query),
  );
  const grouped = (['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'] as GlAccountType[]).map(
    (type) => ({ type, rows: accounts.filter((a) => a.type === type) }),
  );

  const remove = (a: ChartAccount) =>
    void act(async () => {
      await api(`/gl/accounts/${a.id}`, 'DELETE');
      data.reload();
    }, 'تم حذف الحساب');

  return (
    <>
      <div className="table-toolbar">
        <div className="table-filters">
          <SearchBox value={query} onChange={setQuery} placeholder="بحث بالكود أو الاسم..." />
        </div>
        {canManage && (
          <Button onClick={() => setCreating(true)}>
            <Plus size={16} /> حساب جديد
          </Button>
        )}
      </div>
      {data.loading ? (
        <Loading />
      ) : data.error ? (
        <ErrorState message={data.error} retry={data.reload} />
      ) : !accounts.length ? (
        <Empty title="لا توجد حسابات مطابقة" description="جرّب كوداً أو اسماً آخر." />
      ) : (
        grouped.map(
          (group) =>
            group.rows.length > 0 && (
              <div key={group.type} className="ledger-group">
                <h3>
                  {TYPE_LABELS[group.type]}
                  <span className="count-chip">{count(group.rows.length)}</span>
                </h3>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>الكود</th>
                        <th>الحساب</th>
                        <th>الطبيعة</th>
                        <th>الحركات</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {group.rows.map((a) => (
                        <tr key={a.id}>
                          <td className="num">
                            <strong>{a.code}</strong>
                          </td>
                          <td>
                            {a.name}
                            {a.is_system === 1 && <span className="account-tag">نظامي</span>}
                            {a.active !== 1 && <span className="account-tag out-flow">مؤرشف</span>}
                          </td>
                          <td className="muted">{a.normal_side === 'DEBIT' ? 'مدين' : 'دائن'}</td>
                          <td className="num muted">{count(a.lines_count || 0)}</td>
                          <td className="row-actions">
                            <button
                              className="icon-btn"
                              onClick={() => setStatement(a)}
                              title="كشف الحساب"
                            >
                              <ListTree size={16} />
                            </button>
                            {canManage && !a.system_key && (
                              <>
                                <button
                                  className="icon-btn"
                                  onClick={() => setEditing(a)}
                                  title="تعديل"
                                >
                                  <Settings2 size={16} />
                                </button>
                                <button
                                  className="icon-btn"
                                  onClick={() => remove(a)}
                                  disabled={busy}
                                  title="حذف"
                                >
                                  <Trash2 size={16} />
                                </button>
                              </>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ),
        )
      )}
      {(creating || editing) && (
        <AccountModal
          account={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={() => {
            setCreating(false);
            setEditing(null);
            data.reload();
          }}
        />
      )}
      {statement && <StatementModal account={statement} onClose={() => setStatement(null)} />}
    </>
  );
}

function AccountModal({
  account,
  onClose,
  onSaved,
}: {
  account: ChartAccount | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { busy, act } = useAction();
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const payload = {
      code: f.get('code'),
      name: f.get('name'),
      type: f.get('type'),
      normal_side: f.get('normal_side'),
      active: f.get('active') === 'on',
      notes: f.get('notes') || '',
    };
    void act(
      async () => {
        if (account) await api(`/gl/accounts/${account.id}`, 'PUT', payload);
        else await api('/gl/accounts', 'POST', payload);
        onSaved();
      },
      account ? 'تم تحديث الحساب' : 'تم إنشاء الحساب',
    );
  };
  return (
    <Modal title={account ? 'تعديل حساب' : 'حساب محاسبي جديد'} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="modal-body form-grid">
          <div className="form-row">
            <Field label="الكود *" hint="أرقام فقط، ٣ خانات على الأقل">
              <input
                name="code"
                defaultValue={account?.code}
                required
                pattern="\d{3,10}"
                maxLength={10}
              />
            </Field>
            <Field label="الاسم *">
              <input name="name" defaultValue={account?.name} required maxLength={120} />
            </Field>
          </div>
          <div className="form-row">
            <Field label="النوع *">
              <select name="type" defaultValue={account?.type ?? 'EXPENSE'}>
                {(Object.keys(TYPE_LABELS) as GlAccountType[]).map((t) => (
                  <option key={t} value={t}>
                    {TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="طبيعة الرصيد *">
              <select name="normal_side" defaultValue={account?.normal_side ?? 'DEBIT'}>
                <option value="DEBIT">مدين</option>
                <option value="CREDIT">دائن</option>
              </select>
            </Field>
          </div>
          <Field label="ملاحظات">
            <input name="notes" defaultValue={account?.notes} maxLength={500} />
          </Field>
          <label className="check-line">
            <input
              type="checkbox"
              name="active"
              defaultChecked={account ? account.active === 1 : true}
            />
            <span>حساب مُفعّل</span>
          </label>
        </div>
        <div className="modal-footer">
          <Button type="button" variant="ghost" onClick={onClose}>
            إلغاء
          </Button>
          <Button type="submit" busy={busy}>
            حفظ
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function StatementModal({ account, onClose }: { account: ChartAccount; onClose: () => void }) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const qs = `${from ? `?from=${from}` : ''}${to ? `${from ? '&' : '?'}to=${to}` : ''}`;
  const { data, loading, error, reload } = useData<LedgerAccountStatement>(
    `/gl/accounts/${account.id}/statement${qs}`,
  );
  const debit = (data?.lines || []).reduce((s, l) => s + l.debit, 0);
  const credit = (data?.lines || []).reduce((s, l) => s + l.credit, 0);
  return (
    <Modal title={`كشف حساب ${account.code} — ${account.name}`} onClose={onClose} wide>
      <div className="table-toolbar">
        <div className="table-filters">
          <label className="date-filter">
            <span>من</span>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="date-filter">
            <span>إلى</span>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
        </div>
        <Button variant="secondary" onClick={() => window.print()} className="no-print">
          <Printer size={15} /> طباعة
        </Button>
      </div>
      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorState message={error} retry={reload} />
      ) : !data?.lines.length ? (
        <Empty title="لا توجد حركات" description="لم تُسجَّل حركات على هذا الحساب في الفترة." />
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>التاريخ</th>
                <th>القيد</th>
                <th>البيان</th>
                <th>مدين</th>
                <th>دائن</th>
                <th>الرصيد</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td colSpan={5}>رصيد افتتاحي</td>
                <td className="num amount">{money(data.opening)}</td>
              </tr>
              {data.lines.map((l) => (
                <tr key={l.id}>
                  <td className="num muted">{formatDate(l.date || '', true)}</td>
                  <td className="num">{l.entry_number}</td>
                  <td>{l.memo}</td>
                  <td className="num amount">{l.debit ? money(l.debit) : '—'}</td>
                  <td className="num amount">{l.credit ? money(l.credit) : '—'}</td>
                  <td className="num amount">{money(l.running_balance ?? 0)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th colSpan={3}>الإجمالي</th>
                <th className="num amount">{money(debit)}</th>
                <th className="num amount">{money(credit)}</th>
                <th />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      <div className="modal-footer">
        <Button variant="ghost" onClick={onClose}>
          إغلاق
        </Button>
      </div>
    </Modal>
  );
}

// ── ميزان المراجعة ────────────────────────────────────────────────────────────────────────

function TrialTab() {
  const { activeId } = useBranch();
  const [from, setFrom] = useState(today().slice(0, 8) + '01');
  const [to, setTo] = useState(today());
  const data = useData<TrialBalanceRow[]>(
    withBranch(`/gl/trial-balance?from=${from}&to=${to}`, activeId),
  );
  const rows = (data.data || []).filter((r) => r.debit || r.credit);
  const debit = rows.reduce((s, r) => s + r.debit, 0);
  const credit = rows.reduce((s, r) => s + r.credit, 0);
  const revenue = rows
    .filter((r) => r.type === 'REVENUE')
    .reduce((s, r) => s + (r.normal_side === 'CREDIT' ? r.balance : -r.balance), 0);
  const expenses = rows
    .filter((r) => r.type === 'EXPENSE')
    .reduce((s, r) => s + (r.normal_side === 'DEBIT' ? r.balance : -r.balance), 0);
  const net = revenue - expenses;

  return (
    <>
      <div className="stats-grid three">
        <Stat label="إجمالي المدين" value={money(debit)} icon={<Scale size={18} />} />
        <Stat label="إجمالي الدائن" value={money(credit)} icon={<Scale size={18} />} />
        <Stat
          label="صافي الربح"
          value={money(net)}
          icon={<BookOpen size={18} />}
          tone={net >= 0 ? 'green' : 'rose'}
          foot="الإيرادات ناقص المصروفات خلال الفترة"
        />
      </div>
      <div className="table-toolbar">
        <div className="table-filters">
          <label className="date-filter">
            <span>من</span>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="date-filter">
            <span>إلى</span>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
        </div>
        <Button
          variant="secondary"
          onClick={() =>
            downloadCSV(
              'ميزان المراجعة',
              ['الكود', 'الحساب', 'النوع', 'مدين', 'دائن', 'الرصيد'],
              rows.map((r) => [r.code, r.name, TYPE_LABELS[r.type], r.debit, r.credit, r.balance]),
            )
          }
        >
          <Download size={16} /> تصدير
        </Button>
      </div>
      {data.loading ? (
        <Loading />
      ) : data.error ? (
        <ErrorState message={data.error} retry={data.reload} />
      ) : !rows.length ? (
        <Empty title="لا توجد حركات" description="لا توجد قيود في هذه الفترة بعد." />
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>الكود</th>
                <th>الحساب</th>
                <th>النوع</th>
                <th>رصيد افتتاحي</th>
                <th>مدين</th>
                <th>دائن</th>
                <th>الرصيد</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.account_id}>
                  <td className="num">{r.code}</td>
                  <td>{r.name}</td>
                  <td>
                    <span className={'account-tag ' + TYPE_TONE[r.type]}>
                      {TYPE_LABELS[r.type]}
                    </span>
                  </td>
                  <td className="num muted">{money(r.opening)}</td>
                  <td className="num amount">{money(r.debit)}</td>
                  <td className="num amount">{money(r.credit)}</td>
                  <td className="num amount">
                    <strong>{money(r.balance)}</strong>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th colSpan={4}>الإجمالي</th>
                <th className="num amount">{money(debit)}</th>
                <th className="num amount">{money(credit)}</th>
                <th />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      <p className="table-bottom-note">
        {debit === credit
          ? 'ميزان المراجعة متوازن: إجمالي المدين يساوي إجمالي الدائن.'
          : 'تحذير: الميزان غير متوازن — راجع القيود غير المتوازنة.'}
      </p>
    </>
  );
}

// ── الإعدادات ─────────────────────────────────────────────────────────────────────────────

function SettingsTab({ canManage }: { canManage: boolean }) {
  const { data, loading, error, reload } = useData<GlSettings>('/gl/settings');
  const { busy, act } = useAction();
  const [closed, setClosed] = useState('');
  const [month, setMonth] = useState(1);
  useEffect(() => {
    if (data) {
      setClosed(data.closed_through || '');
      setMonth(data.fiscal_year_start_month);
    }
  }, [data]);

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    void act(async () => {
      await api('/gl/settings', 'PUT', {
        fiscal_year_start_month: month,
        closed_through: closed || null,
      });
      reload();
    }, 'تم حفظ إعدادات دفتر الأستاذ');
  };

  if (loading) return <Loading />;
  if (error) return <ErrorState message={error} retry={reload} />;
  return (
    <div className="card ledger-settings-card">
      <h3>الفترة المحاسبية</h3>
      <p className="muted">
        عند إقفال فترة، تُرفَض أي قيود جديدة بتاريخ يساوي أو يسبق تاريخ الإقفال. هذا يحمي الأرصدة
        المعتمدة من التعديل بأثر رجعي.
      </p>
      <form onSubmit={submit}>
        <div className="modal-body form-grid">
          <div className="form-row">
            <Field label="بداية السنة المالية (الشهر) *">
              <select value={month} onChange={(e) => setMonth(Number(e.target.value))}>
                {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="مُقفل حتى تاريخ" hint="اتركه فارغاً لفتح كل الفترات">
              <input type="date" value={closed} onChange={(e) => setClosed(e.target.value)} />
            </Field>
          </div>
          {data?.closed_through && (
            <div className="account-info-tags">
              <span className="account-tag out-flow">
                الفترة مُقفلة حتى {formatDate(data.closed_through)}
              </span>
            </div>
          )}
        </div>
        <div className="modal-footer">
          {canManage ? (
            <Button type="submit" busy={busy}>
              حفظ الإعدادات
            </Button>
          ) : (
            <p className="muted">تحتاج صلاحية «إدارة دفتر الأستاذ» لتعديل هذه الإعدادات.</p>
          )}
        </div>
      </form>
    </div>
  );
}

/** Branch picker used by the manual-entry form; empty means the group view. */
function BranchSelect({ name }: { name: string }) {
  const { branches } = useBranch();
  return (
    <select name={name} defaultValue="">
      <option value="">المجموعة (بلا فرع محدد)</option>
      {branches.map((b) => (
        <option key={b.id} value={b.id}>
          {b.name}
        </option>
      ))}
    </select>
  );
}
