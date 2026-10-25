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
import { useSearchParams } from 'react-router-dom';
import {
  BookOpen,
  ListTree,
  Scale,
  Settings2,
  Plus,
  Download,
  Trash2,
  Printer,
  TrendingUp,
  PieChart,
  CheckCircle2,
  AlertTriangle,
  ArrowUpRight,
  ArrowDownRight,
  ChevronDown,
  ChevronLeft,
  Folder,
  FolderOpen,
  Power,
  Layers,
  CornerDownLeft,
  Table as TableIcon,
  RotateCcw,
  Calendar,
  Sparkles,
  FileSpreadsheet,
  ReceiptText,
  FileCheck,
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
import { TAX_FREE } from '../../config';
import type {
  ChartAccount,
  JournalEntry,
  JournalLine,
  TrialBalanceRow,
  LedgerAccountStatement,
  GlSettings,
  GlAccountType,
  ProfitAndLossReport,
  BalanceSheetReport,
  FinancialReportSection,
  OpeningBalancesPayload,
  OpeningBalancesStatus,
  VatReturnReport,
  TaxRegisterResponse,
  CashAccount,
  Party,
  Product,
  Branch,
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
  const [searchParams, setSearchParams] = useSearchParams();
  const queryTab = searchParams.get('tab') as any;
  const validTabs = [
    'journal',
    'chart',
    'trial',
    'pnl',
    'balance-sheet',
    ...(TAX_FREE ? [] : ['vat-return']),
    'opening-balances',
    'settings',
  ];
  const [tab, setTab] = useState<
    | 'journal'
    | 'chart'
    | 'trial'
    | 'pnl'
    | 'balance-sheet'
    | 'vat-return'
    | 'opening-balances'
    | 'settings'
  >(validTabs.includes(queryTab) ? queryTab : 'journal');

  const switchTab = (nextTab: typeof tab) => {
    setTab(nextTab);
    setSearchParams(nextTab === 'journal' ? {} : { tab: nextTab });
  };

  const canManage = can(user, 'gl:manage');
  return (
    <>
      <PageHeader
        eyebrow="قيود متوازنة، ودفتر واحد للحقيقة"
        title="دفتر الأستاذ"
        description={
          TAX_FREE
            ? 'كل حركة في أوركيفا تُرحَّل تلقائياً كقيد مزدوج متوازن — راجع القيود، ودليل الحسابات، وميزان المراجعة، والقوائم المالية.'
            : 'كل حركة في أوركيفا تُرحَّل تلقائياً كقيد مزدوج متوازن — راجع القيود، ودليل الحسابات، وميزان المراجعة، والقوائم المالية، وإقرارات الضرائب.'
        }
      />
      <div className="table-toolbar">
        <div className="tabs">
          <button
            className={tab === 'journal' ? 'active' : ''}
            onClick={() => switchTab('journal')}
          >
            <span>القيود اليومية</span>
          </button>
          <button className={tab === 'chart' ? 'active' : ''} onClick={() => switchTab('chart')}>
            <span>دليل الحسابات</span>
          </button>
          <button className={tab === 'trial' ? 'active' : ''} onClick={() => switchTab('trial')}>
            <span>ميزان المراجعة</span>
          </button>
          <button className={tab === 'pnl' ? 'active' : ''} onClick={() => switchTab('pnl')}>
            <span>قائمة الدخل</span>
          </button>
          <button
            className={tab === 'balance-sheet' ? 'active' : ''}
            onClick={() => switchTab('balance-sheet')}
          >
            <span>الميزانية العمومية</span>
          </button>
          {!TAX_FREE && (
            <button
              className={tab === 'vat-return' ? 'active' : ''}
              onClick={() => switchTab('vat-return')}
            >
              <span>نموذج 10 (ض.ق.م)</span>
            </button>
          )}
          <button
            className={tab === 'opening-balances' ? 'active' : ''}
            onClick={() => switchTab('opening-balances')}
          >
            <span>الأرصدة الافتتاحية</span>
          </button>
          <button
            className={tab === 'settings' ? 'active' : ''}
            onClick={() => switchTab('settings')}
          >
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
      ) : tab === 'pnl' ? (
        <ProfitAndLossTab />
      ) : tab === 'balance-sheet' ? (
        <BalanceSheetTab />
      ) : !TAX_FREE && tab === 'vat-return' ? (
        <VatReturnTab />
      ) : tab === 'opening-balances' ? (
        <OpeningBalancesTab canManage={canManage} />
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
    <Modal
      size="xl"
      showMaximize
      title={`تفاصيل القيد ${data?.entry.number ?? ''}`}
      onClose={onClose}
    >
      {loading ? (
        <div className="modal-body">
          <Loading />
        </div>
      ) : error ? (
        <div className="modal-body">
          <ErrorState message={error} retry={reload} />
        </div>
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
          <div className="modal-footer" style={{ justifyContent: 'flex-end' }}>
            <Button variant="secondary" onClick={onClose}>
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
      size="xl"
      showMaximize
      title="قيد يومية يدوي"
      description="يجب أن يتساوى إجمالي المدين مع إجمالي الدائن قبل الترحيل."
      onClose={onClose}
    >
      {accountsData.loading ? (
        <div className="modal-body">
          <Loading />
        </div>
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

interface AccountNode {
  account: ChartAccount;
  children: AccountNode[];
  level: number;
  totalBalance: number;
}

function buildAccountTree(accounts: ChartAccount[]): AccountNode[] {
  const map = new Map<string, AccountNode>();
  for (const a of accounts) {
    map.set(a.id, {
      account: a,
      children: [],
      level: 1,
      totalBalance: a.balance || 0,
    });
  }

  const roots: AccountNode[] = [];
  for (const a of accounts) {
    const node = map.get(a.id)!;
    if (a.parent_id && map.has(a.parent_id)) {
      map.get(a.parent_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  function computeHierarchy(node: AccountNode, level: number): number {
    node.level = level;
    let sum = node.account.balance || 0;
    node.children.sort((a, b) => a.account.code.localeCompare(b.account.code));
    for (const child of node.children) {
      sum += computeHierarchy(child, level + 1);
    }
    node.totalBalance = sum;
    return sum;
  }

  roots.sort((a, b) => a.account.code.localeCompare(b.account.code));
  for (const root of roots) {
    computeHierarchy(root, 1);
  }

  return roots;
}

function ChartTab({ canManage }: { canManage: boolean }) {
  const data = useData<ChartAccount[]>('/gl/accounts');
  const [query, setQuery] = useState('');
  const [selectedType, setSelectedType] = useState<string>('ALL');
  const [showInactive, setShowInactive] = useState<boolean>(true);
  const [viewMode, setViewMode] = useState<'tree' | 'table'>('tree');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  const [editing, setEditing] = useState<ChartAccount | null>(null);
  const [creating, setCreating] = useState(false);
  const [parentForNew, setParentForNew] = useState<ChartAccount | null>(null);
  const [statement, setStatement] = useState<ChartAccount | null>(null);
  const { busy, act } = useAction();

  const allAccounts = data.data || [];

  // Filter by active status and type
  const filteredAccounts = allAccounts.filter((a) => {
    if (!showInactive && a.active !== 1) return false;
    if (selectedType !== 'ALL' && a.type !== selectedType) return false;
    return true;
  });

  // Calculate matching accounts and their ancestors for search
  const isSearching = query.trim().length > 0;
  const qLower = query.trim().toLowerCase();
  const matchingIds = new Set<string>();
  const ancestorIds = new Set<string>();

  if (isSearching) {
    const parentMap = new Map<string, string | null>();
    for (const a of allAccounts) {
      parentMap.set(a.id, a.parent_id);
      if (
        a.code.toLowerCase().includes(qLower) ||
        a.name.toLowerCase().includes(qLower) ||
        (a.notes && a.notes.toLowerCase().includes(qLower))
      ) {
        matchingIds.add(a.id);
      }
    }
    for (const mId of matchingIds) {
      let curr = parentMap.get(mId);
      while (curr) {
        ancestorIds.add(curr);
        curr = parentMap.get(curr);
      }
    }
  }

  // Tree nodes
  const treeRoots = buildAccountTree(
    isSearching
      ? allAccounts.filter((a) => matchingIds.has(a.id) || ancestorIds.has(a.id))
      : filteredAccounts,
  );

  // Auto-expand all roots initially if empty
  useEffect(() => {
    if (allAccounts.length > 0 && expandedIds.size === 0) {
      const initial = new Set<string>();
      for (const a of allAccounts) {
        if (!a.parent_id) initial.add(a.id);
      }
      setExpandedIds(initial);
    }
  }, [allAccounts]);

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const expandAll = () => {
    const allIds = new Set<string>(allAccounts.map((a) => a.id));
    setExpandedIds(allIds);
  };

  const collapseAll = () => {
    setExpandedIds(new Set());
  };

  const toggleActive = (a: ChartAccount) =>
    void act(
      async () => {
        await api(`/gl/accounts/${a.id}`, 'PUT', { active: a.active !== 1 });
        data.reload();
      },
      a.active === 1 ? 'تم تعطيل الحساب' : 'تم تفعيل الحساب',
    );

  const remove = (a: ChartAccount) =>
    void act(async () => {
      await api(`/gl/accounts/${a.id}`, 'DELETE');
      data.reload();
    }, 'تم حذف الحساب');

  // Flatten tree according to expanded state
  function renderTreeRows(nodes: AccountNode[]): AccountNode[] {
    const rows: AccountNode[] = [];
    function traverse(node: AccountNode) {
      rows.push(node);
      const isExpanded =
        expandedIds.has(node.account.id) || (isSearching && ancestorIds.has(node.account.id));
      if (isExpanded && node.children.length > 0) {
        for (const child of node.children) {
          traverse(child);
        }
      }
    }
    for (const root of nodes) {
      traverse(root);
    }
    return rows;
  }

  const flattenedTree = renderTreeRows(treeRoots);

  return (
    <>
      <div className="coa-controls">
        <div className="table-toolbar">
          <div className="table-filters" style={{ flexWrap: 'wrap', gap: '10px' }}>
            <SearchBox
              value={query}
              onChange={setQuery}
              placeholder="بحث سريع بالكود أو اسم الحساب..."
            />
            <div className="view-switch-group">
              <button
                type="button"
                className={`view-switch-btn ${viewMode === 'tree' ? 'active' : ''}`}
                onClick={() => setViewMode('tree')}
                title="عرض شجرة هرمية"
              >
                <ListTree size={16} /> شجرة الحسابات
              </button>
              <button
                type="button"
                className={`view-switch-btn ${viewMode === 'table' ? 'active' : ''}`}
                onClick={() => setViewMode('table')}
                title="عرض جدول مسطح"
              >
                <TableIcon size={16} /> جدول مسطح
              </button>
            </div>
            {viewMode === 'tree' && (
              <div style={{ display: 'flex', gap: '6px' }}>
                <Button variant="ghost" onClick={expandAll} title="فرد جميع المستويات">
                  <FolderOpen size={15} /> فرد الكل
                </Button>
                <Button variant="ghost" onClick={collapseAll} title="طي جميع المستويات">
                  <Folder size={15} /> طي الكل
                </Button>
              </div>
            )}
            <label className="check-line" style={{ margin: 0, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={showInactive}
                onChange={(e) => setShowInactive(e.target.checked)}
              />
              <span>عرض المؤرشفة</span>
            </label>
          </div>
          {canManage && (
            <Button
              onClick={() => {
                setParentForNew(null);
                setCreating(true);
              }}
            >
              <Plus size={16} /> حساب رئيسي جديد
            </Button>
          )}
        </div>

        {/* Filter Pills */}
        <div className="coa-filter-pills">
          <button
            type="button"
            className={`coa-pill ${selectedType === 'ALL' ? 'active' : ''}`}
            onClick={() => setSelectedType('ALL')}
          >
            جميع الأنواع ({allAccounts.length})
          </button>
          {(['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'] as GlAccountType[]).map((t) => {
            const cnt = allAccounts.filter((a) => a.type === t).length;
            return (
              <button
                key={t}
                type="button"
                className={`coa-pill ${selectedType === t ? 'active' : ''}`}
                onClick={() => setSelectedType(t)}
              >
                {TYPE_LABELS[t]} ({cnt})
              </button>
            );
          })}
        </div>
      </div>

      {data.loading ? (
        <Loading />
      ) : data.error ? (
        <ErrorState message={data.error} retry={data.reload} />
      ) : flattenedTree.length === 0 ? (
        <Empty
          title="لا توجد حسابات مطابقة"
          description="جرّب تعديل البحث أو إظهار الحسابات المؤرشفة."
        />
      ) : viewMode === 'tree' ? (
        <div className="coa-tree-wrapper">
          <div className="coa-tree-header">
            <div>الحساب والكود</div>
            <div>الطبيعة</div>
            <div style={{ textAlign: 'left' }}>الرصيد الحالي</div>
            <div style={{ textAlign: 'center' }}>الحركات</div>
            <div style={{ textAlign: 'left' }}>الإجراءات</div>
          </div>
          <div>
            {flattenedTree.map((node) => {
              const a = node.account;
              const hasChildren = node.children.length > 0;
              const isExpanded = expandedIds.has(a.id) || (isSearching && ancestorIds.has(a.id));
              const canDelete =
                canManage &&
                !a.system_key &&
                a.is_system !== 1 &&
                (a.lines_count || 0) === 0 &&
                (a.children_count || 0) === 0;

              const deleteTooltip =
                a.system_key || a.is_system === 1
                  ? 'حساب نظامي لا يمكن حذفه'
                  : (a.lines_count || 0) > 0
                    ? 'لا يمكن حذف حساب له حركات في دفتر الأستاذ (يمكن أرشفته)'
                    : (a.children_count || 0) > 0
                      ? 'لا يمكن حذف حساب يحتوي على حسابات فرعية'
                      : 'حذف الحساب';

              return (
                <div key={a.id} className={`coa-tree-row ${a.active !== 1 ? 'archived' : ''}`}>
                  {/* Name, Code & Indentation */}
                  <div
                    className="coa-cell-name"
                    style={{ paddingRight: `${(node.level - 1) * 26 + 6}px` }}
                  >
                    {hasChildren ? (
                      <button
                        type="button"
                        className="coa-expander"
                        onClick={() => toggleExpand(a.id)}
                        title={isExpanded ? 'طي' : 'فرد'}
                      >
                        {isExpanded ? <ChevronDown size={17} /> : <ChevronLeft size={17} />}
                      </button>
                    ) : (
                      <span className="coa-expander-placeholder" />
                    )}

                    {hasChildren ? (
                      <Folder size={16} style={{ color: 'var(--amber-500)', flexShrink: 0 }} />
                    ) : (
                      <Layers size={15} style={{ color: 'var(--indigo-400)', flexShrink: 0 }} />
                    )}

                    <span className="coa-code-badge">{a.code}</span>
                    <span className="coa-name-text" title={a.name}>
                      {a.name}
                    </span>

                    <span className="coa-level-chip">م{node.level}</span>

                    {a.is_system === 1 && <span className="account-tag">نظامي</span>}
                    {a.active !== 1 && <span className="account-tag out-flow">مؤرشف</span>}
                    {hasChildren && (
                      <span
                        className="count-chip"
                        title={`${node.children.length} حساب فرعي تحت هذا الحساب`}
                      >
                        {node.children.length} فرعي
                      </span>
                    )}
                  </div>

                  {/* Nature / Type */}
                  <div className="muted" style={{ fontSize: '13px' }}>
                    <span style={{ fontWeight: 600 }}>
                      {a.normal_side === 'DEBIT' ? 'مدين' : 'دائن'}
                    </span>
                    <div style={{ fontSize: '11px', color: 'var(--slate-500)' }}>
                      {TYPE_LABELS[a.type]}
                    </div>
                  </div>

                  {/* Balance */}
                  <div className="coa-balance-cell">
                    <span className="coa-balance-val">{money(node.totalBalance)}</span>
                    {hasChildren && node.totalBalance !== (a.balance || 0) && (
                      <span className="coa-balance-sub" title="رصيد الحساب المباشر فقط دون الفروع">
                        مباشر: {money(a.balance || 0)}
                      </span>
                    )}
                  </div>

                  {/* Lines Count */}
                  <div style={{ textAlign: 'center' }} className="num muted">
                    {count(a.lines_count || 0)}
                  </div>

                  {/* Actions */}
                  <div className="coa-actions-cell">
                    {canManage && (
                      <button
                        className="icon-btn"
                        onClick={() => {
                          setParentForNew(a);
                          setCreating(true);
                        }}
                        title="إضافة حساب فرعي"
                      >
                        <CornerDownLeft size={16} />
                      </button>
                    )}

                    <button className="icon-btn" onClick={() => setStatement(a)} title="كشف الحساب">
                      <ListTree size={16} />
                    </button>

                    {canManage && !a.system_key && (
                      <>
                        <button className="icon-btn" onClick={() => setEditing(a)} title="تعديل">
                          <Settings2 size={16} />
                        </button>
                        <button
                          className="icon-btn"
                          onClick={() => toggleActive(a)}
                          title={a.active === 1 ? 'تعطيل الحساب' : 'تفعيل الحساب'}
                          style={{
                            color: a.active === 1 ? 'var(--slate-500)' : 'var(--emerald-600)',
                          }}
                        >
                          <Power size={15} />
                        </button>
                        <button
                          className="icon-btn"
                          onClick={() => remove(a)}
                          disabled={busy || !canDelete}
                          title={deleteTooltip}
                          style={!canDelete ? { opacity: 0.35, cursor: 'not-allowed' } : {}}
                        >
                          <Trash2 size={16} />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        /* Flat Table View */
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>الكود</th>
                <th>الحساب</th>
                <th>الحساب الأب</th>
                <th>النوع</th>
                <th>الطبيعة</th>
                <th className="num">الرصيد</th>
                <th className="num">الحركات</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filteredAccounts.map((a) => {
                const canDelete =
                  canManage &&
                  !a.system_key &&
                  a.is_system !== 1 &&
                  (a.lines_count || 0) === 0 &&
                  (a.children_count || 0) === 0;

                const deleteTooltip =
                  a.system_key || a.is_system === 1
                    ? 'حساب نظامي لا يمكن حذفه'
                    : (a.lines_count || 0) > 0
                      ? 'لا يمكن حذف حساب له حركات في دفتر الأستاذ'
                      : (a.children_count || 0) > 0
                        ? 'لا يمكن حذف حساب يحتوي على حسابات فرعية'
                        : 'حذف الحساب';

                return (
                  <tr key={a.id} className={a.active !== 1 ? 'muted' : ''}>
                    <td className="num">
                      <strong>{a.code}</strong>
                    </td>
                    <td>
                      {a.name}
                      {a.is_system === 1 && <span className="account-tag">نظامي</span>}
                      {a.active !== 1 && <span className="account-tag out-flow">مؤرشف</span>}
                    </td>
                    <td>
                      {a.parent_code ? (
                        <span className="coa-level-chip">
                          {a.parent_code} - {a.parent_name}
                        </span>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td>{TYPE_LABELS[a.type]}</td>
                    <td className="muted">{a.normal_side === 'DEBIT' ? 'مدين' : 'دائن'}</td>
                    <td className="num" style={{ direction: 'ltr', textAlign: 'right' }}>
                      <strong>{money(a.balance || 0)}</strong>
                    </td>
                    <td className="num muted">{count(a.lines_count || 0)}</td>
                    <td className="row-actions">
                      {canManage && (
                        <button
                          className="icon-btn"
                          onClick={() => {
                            setParentForNew(a);
                            setCreating(true);
                          }}
                          title="إضافة حساب فرعي"
                        >
                          <CornerDownLeft size={16} />
                        </button>
                      )}
                      <button
                        className="icon-btn"
                        onClick={() => setStatement(a)}
                        title="كشف الحساب"
                      >
                        <ListTree size={16} />
                      </button>
                      {canManage && !a.system_key && (
                        <>
                          <button className="icon-btn" onClick={() => setEditing(a)} title="تعديل">
                            <Settings2 size={16} />
                          </button>
                          <button
                            className="icon-btn"
                            onClick={() => toggleActive(a)}
                            title={a.active === 1 ? 'تعطيل الحساب' : 'تفعيل الحساب'}
                          >
                            <Power size={15} />
                          </button>
                          <button
                            className="icon-btn"
                            onClick={() => remove(a)}
                            disabled={busy || !canDelete}
                            title={deleteTooltip}
                            style={!canDelete ? { opacity: 0.35, cursor: 'not-allowed' } : {}}
                          >
                            <Trash2 size={16} />
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {(creating || editing) && (
        <AccountModal
          account={editing}
          parentAccount={parentForNew}
          allAccounts={allAccounts}
          onClose={() => {
            setCreating(false);
            setEditing(null);
            setParentForNew(null);
          }}
          onSaved={() => {
            setCreating(false);
            setEditing(null);
            setParentForNew(null);
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
  parentAccount,
  allAccounts,
  onClose,
  onSaved,
}: {
  account: ChartAccount | null;
  parentAccount?: ChartAccount | null;
  allAccounts: ChartAccount[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { busy, act } = useAction();
  const [parentId, setParentId] = useState<string>(account?.parent_id ?? parentAccount?.id ?? '');
  const [code, setCode] = useState<string>(account?.code ?? '');
  const [loadingNext, setLoadingNext] = useState(false);

  const initialParent = allAccounts.find((a) => a.id === parentId);
  const [accountType, setAccountType] = useState<GlAccountType>(
    account?.type ?? initialParent?.type ?? 'EXPENSE',
  );
  const [normalSide, setNormalSide] = useState<'DEBIT' | 'CREDIT'>(
    account?.normal_side ?? initialParent?.normal_side ?? 'DEBIT',
  );

  const hasMovements = (account?.lines_count || 0) > 0;

  // When parent changes in create mode, suggest the next code and inherit type & normal_side
  const handleParentChange = async (newParentId: string) => {
    setParentId(newParentId);
    if (!account && newParentId) {
      const p = allAccounts.find((a) => a.id === newParentId);
      if (p) {
        setAccountType(p.type);
        setNormalSide(p.normal_side);
      }
      setLoadingNext(true);
      try {
        const res = await api<{ code: string }>(`/gl/accounts/next-code?parent_id=${newParentId}`);
        if (res?.code) setCode(res.code);
      } catch {
        // Fallback gracefully
      } finally {
        setLoadingNext(false);
      }
    }
  };

  // If opening via "إضافة فرعي" with pre-selected parent
  useEffect(() => {
    if (!account && parentAccount && !code) {
      void handleParentChange(parentAccount.id);
    }
  }, [parentAccount]);

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const payload = {
      code: code || f.get('code'),
      name: f.get('name'),
      type: accountType,
      normal_side: normalSide,
      parent_id: parentId || null,
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

  const selectedParentObj = allAccounts.find((a) => a.id === parentId);
  const modalTitle = account
    ? `تعديل الحساب: ${account.code} - ${account.name}`
    : selectedParentObj
      ? `إضافة حساب فرعي تحت: ${selectedParentObj.name}`
      : 'حساب محاسبي جديد';

  return (
    <Modal title={modalTitle} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="modal-body form-grid">
          {hasMovements && (
            <div
              className="balance-check-banner balanced"
              style={{ padding: '10px 14px', fontSize: '13px' }}
            >
              <span className="indicator">
                <AlertTriangle size={16} /> ملاحظة أمان: تم قفل النوع وطبيعة الرصيد لوجود قيود مسجلة
                على هذا الحساب.
              </span>
            </div>
          )}

          {/* Parent Account Selector */}
          <Field label="الحساب الأب" hint="اختر الحساب الرئيسي الذي يتبع له هذا الحساب">
            <select
              value={parentId}
              onChange={(e) => void handleParentChange(e.target.value)}
              disabled={!!account && hasMovements}
            >
              <option value="">(بدون حساب أب — حساب رئيسي من المستوى الأول)</option>
              {allAccounts
                .filter((a) => !account || a.id !== account.id)
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code} — {a.name} ({TYPE_LABELS[a.type]})
                  </option>
                ))}
            </select>
          </Field>

          <div className="form-row">
            <Field
              label="الكود *"
              hint={loadingNext ? 'جارٍ اقتراح الكود التالي...' : 'أرقام فقط، ٣ خانات على الأقل'}
            >
              <input
                name="code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
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
              <select
                name="type"
                value={accountType}
                onChange={(e) => setAccountType(e.target.value as GlAccountType)}
                disabled={hasMovements || (!!parentId && !account)}
              >
                {(Object.keys(TYPE_LABELS) as GlAccountType[]).map((t) => (
                  <option key={t} value={t}>
                    {TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="طبيعة الرصيد *">
              <select
                name="normal_side"
                value={normalSide}
                onChange={(e) => setNormalSide(e.target.value as 'DEBIT' | 'CREDIT')}
                disabled={hasMovements || (!!parentId && !account)}
              >
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
              disabled={account?.is_system === 1 || !!account?.system_key}
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
    <Modal
      size="xl"
      showMaximize
      title={`كشف حساب ${account.code} — ${account.name}`}
      onClose={onClose}
    >
      <div className="modal-body">
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
      </div>
      <div className="modal-footer" style={{ justifyContent: 'flex-end' }}>
        <Button variant="secondary" onClick={onClose}>
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

// ── أدوات ومكونات القوائم المالية ──────────────────────────────────────────────────────────

function PercentBadge({ value, invert = false }: { value?: number | null; invert?: boolean }) {
  if (value === undefined || value === null) return null;
  const isPositive = value >= 0;
  const isFavorable = invert ? !isPositive : isPositive;
  return (
    <span className={`pct-pill ${isFavorable ? 'up' : 'down'}`}>
      {isPositive ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
      {Math.abs(value)}%
    </span>
  );
}

// ── قائمة الدخل (Profit & Loss) ──────────────────────────────────────────────────────────

function ProfitAndLossTab() {
  const { activeId } = useBranch();
  const [from, setFrom] = useState(today().slice(0, 8) + '01');
  const [to, setTo] = useState(today());
  const [enableCompare, setEnableCompare] = useState(false);
  const [compareFrom, setCompareFrom] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    return new Intl.DateTimeFormat('en-CA').format(d).slice(0, 8) + '01';
  });
  const [compareTo, setCompareTo] = useState(() => {
    const d = new Date();
    d.setDate(0);
    return new Intl.DateTimeFormat('en-CA').format(d);
  });

  const compareQs =
    enableCompare && compareFrom && compareTo
      ? `&compare_from=${compareFrom}&compare_to=${compareTo}`
      : '';
  const data = useData<ProfitAndLossReport>(
    withBranch(`/gl/profit-and-loss?from=${from}&to=${to}${compareQs}`, activeId),
  );
  const r = data.data;

  const grossMargin =
    r && r.net_revenue > 0 ? Math.round((r.gross_profit / r.net_revenue) * 100) : 0;
  const netMargin = r && r.net_revenue > 0 ? Math.round((r.net_profit / r.net_revenue) * 100) : 0;

  const handleExportCSV = () => {
    if (!r) return;
    const headers = ['القسم', 'الكود', 'الحساب', 'الفترة الحالية (ج.م)'];
    if (enableCompare) {
      headers.push('الفترة المقارنة (ج.م)', 'نسبة التغير %');
    }
    const rows: (string | number)[][] = [];

    const addSectionToCsv = (sectionTitle: string, section: FinancialReportSection) => {
      rows.push([sectionTitle, '', '', '']);
      for (const row of section.rows) {
        const item: (string | number)[] = [
          '',
          row.code || '',
          row.name,
          row.is_deduction ? `-${(row.amount / 100).toFixed(2)}` : (row.amount / 100).toFixed(2),
        ];
        if (enableCompare) {
          item.push(
            row.previous_amount !== undefined ? (row.previous_amount / 100).toFixed(2) : '',
            row.change_percent !== undefined && row.change_percent !== null
              ? `${row.change_percent}%`
              : '',
          );
        }
        rows.push(item);
      }
      const totalItem: (string | number)[] = [
        `إجمالي ${sectionTitle}`,
        '',
        '',
        (section.total / 100).toFixed(2),
      ];
      if (enableCompare) {
        totalItem.push(
          section.previous_total !== undefined ? (section.previous_total / 100).toFixed(2) : '',
          section.change_percent !== undefined && section.change_percent !== null
            ? `${section.change_percent}%`
            : '',
        );
      }
      rows.push(totalItem);
    };

    addSectionToCsv('إيرادات المبيعات', r.gross_sales);
    addSectionToCsv('مردودات ومسموحات المبيعات والخصومات', r.sales_deductions);
    rows.push(['صافي إيرادات المبيعات', '', '', (r.net_revenue / 100).toFixed(2)]);
    addSectionToCsv('تكلفة المبيعات', r.cogs);
    rows.push(['مجمل الربح', '', '', (r.gross_profit / 100).toFixed(2)]);
    addSectionToCsv('المصروفات التشغيلية', r.operating_expenses);
    rows.push(['صافي الربح / (الخسارة)', '', '', (r.net_profit / 100).toFixed(2)]);

    downloadCSV(`قائمة-الدخل-${from}-${to}`, headers, rows);
  };

  return (
    <>
      <div
        className="stats-grid"
        style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}
      >
        <Stat
          label="صافي الإيرادات"
          value={money(r?.net_revenue || 0)}
          icon={<TrendingUp size={18} />}
          tone="green"
          trend={enableCompare ? (r?.change_net_revenue ?? undefined) : undefined}
          foot={enableCompare ? 'مقارنة بالفترة السابقة' : 'خلال الفترة المحددة'}
        />
        <Stat
          label="تكلفة المبيعات"
          value={money(r?.total_cogs || 0)}
          icon={<Scale size={18} />}
          foot={
            r && r.net_revenue > 0
              ? `${Math.round((r.total_cogs / r.net_revenue) * 100)}% من المبيعات`
              : undefined
          }
        />
        <Stat
          label="مجمل الربح"
          value={money(r?.gross_profit || 0)}
          icon={<PieChart size={18} />}
          tone={(r?.gross_profit || 0) >= 0 ? 'green' : 'rose'}
          foot={`هامش مجمل الربح: ${grossMargin}%`}
        />
        <Stat
          label="المصروفات التشغيلية"
          value={money(r?.total_operating_expenses || 0)}
          icon={<BookOpen size={18} />}
          tone="rose"
        />
        <Stat
          label="صافي أرباح النشاط"
          value={money(r?.net_profit || 0)}
          icon={<BookOpen size={18} />}
          tone={(r?.net_profit || 0) >= 0 ? 'green' : 'rose'}
          foot={`صافي الهامش: ${netMargin}%`}
        />
      </div>

      <div className="table-toolbar">
        <div className="table-filters" style={{ flexWrap: 'wrap', gap: '12px' }}>
          <label className="date-filter">
            <span>من</span>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="date-filter">
            <span>إلى</span>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
          <label
            className="check-line"
            style={{
              margin: 0,
              padding: '6px 12px',
              background: 'var(--slate-50)',
              borderRadius: '6px',
            }}
          >
            <input
              type="checkbox"
              checked={enableCompare}
              onChange={(e) => setEnableCompare(e.target.checked)}
            />
            <span>مقارنة مع فترة سابقة</span>
          </label>
          {enableCompare && (
            <>
              <label className="date-filter">
                <span>مقارنة من</span>
                <input
                  type="date"
                  value={compareFrom}
                  onChange={(e) => setCompareFrom(e.target.value)}
                />
              </label>
              <label className="date-filter">
                <span>إلى</span>
                <input
                  type="date"
                  value={compareTo}
                  onChange={(e) => setCompareTo(e.target.value)}
                />
              </label>
            </>
          )}
        </div>
        <div className="table-actions">
          <Button variant="secondary" onClick={handleExportCSV} disabled={!r || data.loading}>
            <Download size={16} /> تصدير CSV
          </Button>
          <Button variant="secondary" onClick={() => window.print()} className="no-print">
            <Printer size={16} /> طباعة
          </Button>
        </div>
      </div>

      {data.loading ? (
        <Loading />
      ) : data.error ? (
        <ErrorState message={data.error} retry={data.reload} />
      ) : !r ? (
        <Empty title="لا توجد بيانات" description="تعذر استخراج قائمة الدخل." />
      ) : (
        <div className="financial-statement-card">
          <div className="financial-statement-header">
            <h3>
              قائمة الدخل عن الفترة من {formatDate(from)} إلى {formatDate(to)}
            </h3>
            {enableCompare && (
              <span className="account-tag in-flow">
                مقارنة مع: {formatDate(compareFrom)} — {formatDate(compareTo)}
              </span>
            )}
          </div>
          <div className="table-scroll">
            <table className="statement-table">
              <thead>
                <tr>
                  <th>البند / الحساب</th>
                  <th style={{ width: '100px' }}>الكود</th>
                  <th className="num" style={{ width: '150px' }}>
                    الفترة الحالية
                  </th>
                  {enableCompare && (
                    <th className="num" style={{ width: '150px' }}>
                      فترة المقارنة
                    </th>
                  )}
                  {enableCompare && (
                    <th className="num" style={{ width: '110px' }}>
                      نسبة التغير
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {/* 1. Gross Sales */}
                <tr className="statement-section-hdr">
                  <td colSpan={enableCompare ? 5 : 3}>إيرادات المبيعات والنشاط</td>
                </tr>
                {r.gross_sales.rows.map((row) => (
                  <tr
                    key={row.account_id || row.code}
                    className="statement-row statement-sub-account"
                  >
                    <td className="account-name-cell">{row.name}</td>
                    <td className="num muted">{row.code}</td>
                    <td className="num amount">{money(row.amount)}</td>
                    {enableCompare && (
                      <td className="num amount muted">{money(row.previous_amount || 0)}</td>
                    )}
                    {enableCompare && (
                      <td className="num">
                        <PercentBadge value={row.change_percent} />
                      </td>
                    )}
                  </tr>
                ))}

                {/* 2. Deductions */}
                {r.sales_deductions.rows.length > 0 && (
                  <>
                    <tr className="statement-section-hdr" style={{ background: '#fdf2f8' }}>
                      <td colSpan={enableCompare ? 5 : 3} style={{ color: '#9d174d' }}>
                        يخصم: مردودات ومسموحات المبيعات والخصومات
                      </td>
                    </tr>
                    {r.sales_deductions.rows.map((row) => (
                      <tr
                        key={row.account_id || row.code}
                        className="statement-row statement-sub-account"
                      >
                        <td className="account-name-cell">{row.name}</td>
                        <td className="num muted">{row.code}</td>
                        <td className="num amount out-flow">({money(row.amount)})</td>
                        {enableCompare && (
                          <td className="num amount muted">({money(row.previous_amount || 0)})</td>
                        )}
                        {enableCompare && (
                          <td className="num">
                            <PercentBadge value={row.change_percent} invert />
                          </td>
                        )}
                      </tr>
                    ))}
                  </>
                )}

                {/* Net Revenue */}
                <tr className="statement-summary-row">
                  <td colSpan={2}>
                    <strong>صافي إيرادات النشاط</strong>
                  </td>
                  <td className="num amount">
                    <strong>{money(r.net_revenue)}</strong>
                  </td>
                  {enableCompare && (
                    <td className="num amount muted">
                      <strong>{money(r.previous_net_revenue || 0)}</strong>
                    </td>
                  )}
                  {enableCompare && (
                    <td className="num">
                      <PercentBadge value={r.change_net_revenue} />
                    </td>
                  )}
                </tr>

                {/* 3. Cost of Goods Sold */}
                <tr className="statement-section-hdr">
                  <td colSpan={enableCompare ? 5 : 3}>تكلفة البضاعة المباعة</td>
                </tr>
                {r.cogs.rows.map((row) => (
                  <tr
                    key={row.account_id || row.code}
                    className="statement-row statement-sub-account"
                  >
                    <td className="account-name-cell">{row.name}</td>
                    <td className="num muted">{row.code}</td>
                    <td className="num amount">
                      {row.is_deduction ? `(${money(row.amount)})` : money(row.amount)}
                    </td>
                    {enableCompare && (
                      <td className="num amount muted">
                        {row.is_deduction
                          ? `(${money(row.previous_amount || 0)})`
                          : money(row.previous_amount || 0)}
                      </td>
                    )}
                    {enableCompare && (
                      <td className="num">
                        <PercentBadge value={row.change_percent} invert={!row.is_deduction} />
                      </td>
                    )}
                  </tr>
                ))}
                <tr className="statement-summary-row">
                  <td colSpan={2}>
                    <strong>إجمالي تكلفة المبيعات</strong>
                  </td>
                  <td className="num amount">
                    <strong>{money(r.total_cogs)}</strong>
                  </td>
                  {enableCompare && (
                    <td className="num amount muted">
                      <strong>{money(r.previous_total_cogs || 0)}</strong>
                    </td>
                  )}
                  {enableCompare && (
                    <td className="num">
                      <PercentBadge value={r.cogs.change_percent} invert />
                    </td>
                  )}
                </tr>

                {/* 4. Gross Profit */}
                <tr className={`statement-grand-row ${r.gross_profit >= 0 ? 'profit' : 'loss'}`}>
                  <td colSpan={2}>
                    <strong>مجمل الربح / (الخسارة)</strong>
                  </td>
                  <td className="num amount">
                    <strong>{money(r.gross_profit)}</strong>
                  </td>
                  {enableCompare && (
                    <td className="num amount muted">
                      <strong>{money(r.previous_gross_profit || 0)}</strong>
                    </td>
                  )}
                  {enableCompare && (
                    <td className="num">
                      <PercentBadge value={r.change_gross_profit} />
                    </td>
                  )}
                </tr>

                {/* 5. Operating Expenses */}
                <tr className="statement-section-hdr">
                  <td colSpan={enableCompare ? 5 : 3}>المصروفات التشغيلية والإدارية والعمومية</td>
                </tr>
                {r.operating_expenses.rows.map((row) => (
                  <tr
                    key={row.account_id || row.code}
                    className="statement-row statement-sub-account"
                  >
                    <td className="account-name-cell">{row.name}</td>
                    <td className="num muted">{row.code}</td>
                    <td className="num amount">{money(row.amount)}</td>
                    {enableCompare && (
                      <td className="num amount muted">{money(row.previous_amount || 0)}</td>
                    )}
                    {enableCompare && (
                      <td className="num">
                        <PercentBadge value={row.change_percent} invert />
                      </td>
                    )}
                  </tr>
                ))}
                <tr className="statement-summary-row">
                  <td colSpan={2}>
                    <strong>إجمالي المصروفات التشغيلية</strong>
                  </td>
                  <td className="num amount">
                    <strong>{money(r.total_operating_expenses)}</strong>
                  </td>
                  {enableCompare && (
                    <td className="num amount muted">
                      <strong>{money(r.previous_total_operating_expenses || 0)}</strong>
                    </td>
                  )}
                  {enableCompare && (
                    <td className="num">
                      <PercentBadge value={r.operating_expenses.change_percent} invert />
                    </td>
                  )}
                </tr>

                {/* 6. Net Profit */}
                <tr
                  className={`statement-grand-row ${r.net_profit >= 0 ? 'profit' : 'loss'}`}
                  style={{ fontSize: '16px' }}
                >
                  <td colSpan={2}>
                    <strong>صافي ربح / (خسارة) النشاط</strong>
                  </td>
                  <td className="num amount">
                    <strong>{money(r.net_profit)}</strong>
                  </td>
                  {enableCompare && (
                    <td className="num amount muted">
                      <strong>{money(r.previous_net_profit || 0)}</strong>
                    </td>
                  )}
                  {enableCompare && (
                    <td className="num">
                      <PercentBadge value={r.change_net_profit} />
                    </td>
                  )}
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

// ── الميزانية العمومية (Balance Sheet) ──────────────────────────────────────────────────

function BalanceSheetTab() {
  const { activeId } = useBranch();
  const [asOf, setAsOf] = useState(today());
  const [enableCompare, setEnableCompare] = useState(false);
  const [compareAsOf, setCompareAsOf] = useState(() => {
    const d = new Date();
    d.setFullYear(d.getFullYear() - 1);
    d.setMonth(11);
    d.setDate(31);
    return new Intl.DateTimeFormat('en-CA').format(d);
  });

  const compareQs = enableCompare && compareAsOf ? `&compare_as_of=${compareAsOf}` : '';
  const data = useData<BalanceSheetReport>(
    withBranch(`/gl/balance-sheet?as_of=${asOf}${compareQs}`, activeId),
  );
  const bs = data.data;

  const handleExportCSV = () => {
    if (!bs) return;
    const headers = ['الجانب', 'القسم', 'الكود', 'الحساب', 'الرصيد (ج.م)'];
    if (enableCompare) {
      headers.push('رصيد المقارنة (ج.م)', 'نسبة التغير %');
    }
    const rows: (string | number)[][] = [];

    const addSection = (side: string, secTitle: string, sec: FinancialReportSection) => {
      rows.push([side, secTitle, '', '', '']);
      for (const row of sec.rows) {
        const item: (string | number)[] = [
          side,
          '',
          row.code || '',
          row.name,
          (row.amount / 100).toFixed(2),
        ];
        if (enableCompare) {
          item.push(
            row.previous_amount !== undefined ? (row.previous_amount / 100).toFixed(2) : '',
            row.change_percent !== undefined && row.change_percent !== null
              ? `${row.change_percent}%`
              : '',
          );
        }
        rows.push(item);
      }
      rows.push([side, `إجمالي ${secTitle}`, '', '', (sec.total / 100).toFixed(2)]);
    };

    addSection('الأصول', 'الأصول المتداولة', bs.assets.current_assets);
    addSection('الأصول', 'الأصول غير المتداولة', bs.assets.non_current_assets);
    rows.push(['الأصول', 'إجمالي الأصول', '', '', (bs.total_assets / 100).toFixed(2)]);

    addSection('الالتزامات', 'الالتزامات المتداولة', bs.liabilities.current_liabilities);
    addSection('الالتزامات', 'الالتزامات غير المتداولة', bs.liabilities.non_current_liabilities);
    rows.push(['الالتزامات', 'إجمالي الالتزامات', '', '', (bs.total_liabilities / 100).toFixed(2)]);

    addSection('حقوق الملكية', 'بنود حقوق الملكية', bs.equity.items);
    rows.push([
      'حقوق الملكية',
      'أرباح / (خسائر) الفترة الجارية',
      '',
      '',
      (bs.equity.current_period_earnings / 100).toFixed(2),
    ]);
    rows.push(['حقوق الملكية', 'إجمالي حقوق الملكية', '', '', (bs.total_equity / 100).toFixed(2)]);
    rows.push([
      'الالتزامات وحقوق الملكية',
      'إجمالي الالتزامات وحقوق الملكية',
      '',
      '',
      (bs.total_liabilities_and_equity / 100).toFixed(2),
    ]);

    downloadCSV(`الميزانية-العمومية-${asOf}`, headers, rows);
  };

  return (
    <>
      {bs && (
        <div className={`balance-check-banner ${bs.is_balanced ? 'balanced' : 'unbalanced'}`}>
          <div className="indicator">
            {bs.is_balanced ? <CheckCircle2 size={22} /> : <AlertTriangle size={22} />}
            <span>
              {bs.is_balanced
                ? 'الميزانية متوازنة تماماً: إجمالي الأصول = إجمالي الالتزامات وحقوق الملكية'
                : 'تنبيه: يوجد فرق محاسبي بين الأصول والالتزامات وحقوق الملكية'}
            </span>
          </div>
          <div className="num">
            <strong>الأصول: {money(bs.total_assets)}</strong>
            {' = '}
            <strong>الالتزامات والملكية: {money(bs.total_liabilities_and_equity)}</strong>
          </div>
        </div>
      )}

      <div className="stats-grid four">
        <Stat
          label="إجمالي الأصول"
          value={money(bs?.total_assets || 0)}
          icon={<Scale size={18} />}
          tone="green"
        />
        <Stat
          label="إجمالي الالتزامات"
          value={money(bs?.total_liabilities || 0)}
          icon={<Scale size={18} />}
          tone="rose"
        />
        <Stat
          label="إجمالي حقوق الملكية"
          value={money(bs?.total_equity || 0)}
          icon={<PieChart size={18} />}
        />
        <Stat
          label="أرباح الفترة الجارية"
          value={money(bs?.equity.current_period_earnings || 0)}
          icon={<TrendingUp size={18} />}
          tone={(bs?.equity.current_period_earnings || 0) >= 0 ? 'green' : 'rose'}
          foot="من واقع قائمة الدخل التراكمية"
        />
      </div>

      <div className="table-toolbar">
        <div className="table-filters" style={{ flexWrap: 'wrap', gap: '12px' }}>
          <label className="date-filter">
            <span>في تاريخ</span>
            <input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
          </label>
          <label
            className="check-line"
            style={{
              margin: 0,
              padding: '6px 12px',
              background: 'var(--slate-50)',
              borderRadius: '6px',
            }}
          >
            <input
              type="checkbox"
              checked={enableCompare}
              onChange={(e) => setEnableCompare(e.target.checked)}
            />
            <span>مقارنة مع تاريخ سابق</span>
          </label>
          {enableCompare && (
            <label className="date-filter">
              <span>تاريخ المقارنة</span>
              <input
                type="date"
                value={compareAsOf}
                onChange={(e) => setCompareAsOf(e.target.value)}
              />
            </label>
          )}
        </div>
        <div className="table-actions">
          <Button variant="secondary" onClick={handleExportCSV} disabled={!bs || data.loading}>
            <Download size={16} /> تصدير CSV
          </Button>
          <Button variant="secondary" onClick={() => window.print()} className="no-print">
            <Printer size={16} /> طباعة
          </Button>
        </div>
      </div>

      {data.loading ? (
        <Loading />
      ) : data.error ? (
        <ErrorState message={data.error} retry={data.reload} />
      ) : !bs ? (
        <Empty title="لا توجد بيانات" description="تعذر استخراج الميزانية العمومية." />
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(440px, 1fr))',
            gap: '20px',
          }}
        >
          {/* جانب الأصول */}
          <div className="financial-statement-card">
            <div className="financial-statement-header">
              <h3>الأصول (Assets)</h3>
              <span className="account-tag in-flow">إجمالي الأصول: {money(bs.total_assets)}</span>
            </div>
            <div className="table-scroll">
              <table className="statement-table">
                <thead>
                  <tr>
                    <th>الحساب</th>
                    <th style={{ width: '80px' }}>الكود</th>
                    <th className="num" style={{ width: '130px' }}>
                      الرصيد
                    </th>
                    {enableCompare && (
                      <th className="num" style={{ width: '130px' }}>
                        المقارنة
                      </th>
                    )}
                    {enableCompare && (
                      <th className="num" style={{ width: '90px' }}>
                        التغير
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {/* Current Assets */}
                  <tr className="statement-section-hdr">
                    <td colSpan={enableCompare ? 5 : 3}>الأصول المتداولة</td>
                  </tr>
                  {bs.assets.current_assets.rows.map((row) => (
                    <tr
                      key={row.account_id || row.code}
                      className="statement-row statement-sub-account"
                    >
                      <td className="account-name-cell">{row.name}</td>
                      <td className="num muted">{row.code}</td>
                      <td className="num amount">{money(row.amount)}</td>
                      {enableCompare && (
                        <td className="num amount muted">{money(row.previous_amount || 0)}</td>
                      )}
                      {enableCompare && (
                        <td className="num">
                          <PercentBadge value={row.change_percent} />
                        </td>
                      )}
                    </tr>
                  ))}
                  <tr className="statement-summary-row">
                    <td colSpan={2}>إجمالي الأصول المتداولة</td>
                    <td className="num amount">{money(bs.assets.current_assets.total)}</td>
                    {enableCompare && (
                      <td className="num amount muted">
                        {money(bs.assets.current_assets.previous_total || 0)}
                      </td>
                    )}
                    {enableCompare && (
                      <td className="num">
                        <PercentBadge value={bs.assets.current_assets.change_percent} />
                      </td>
                    )}
                  </tr>

                  {/* Non-Current Assets */}
                  {bs.assets.non_current_assets.rows.length > 0 && (
                    <>
                      <tr className="statement-section-hdr">
                        <td colSpan={enableCompare ? 5 : 3}>الأصول غير المتداولة (الثابتة)</td>
                      </tr>
                      {bs.assets.non_current_assets.rows.map((row) => (
                        <tr
                          key={row.account_id || row.code}
                          className="statement-row statement-sub-account"
                        >
                          <td className="account-name-cell">{row.name}</td>
                          <td className="num muted">{row.code}</td>
                          <td className="num amount">{money(row.amount)}</td>
                          {enableCompare && (
                            <td className="num amount muted">{money(row.previous_amount || 0)}</td>
                          )}
                          {enableCompare && (
                            <td className="num">
                              <PercentBadge value={row.change_percent} />
                            </td>
                          )}
                        </tr>
                      ))}
                      <tr className="statement-summary-row">
                        <td colSpan={2}>إجمالي الأصول غير المتداولة</td>
                        <td className="num amount">{money(bs.assets.non_current_assets.total)}</td>
                        {enableCompare && (
                          <td className="num amount muted">
                            {money(bs.assets.non_current_assets.previous_total || 0)}
                          </td>
                        )}
                        {enableCompare && (
                          <td className="num">
                            <PercentBadge value={bs.assets.non_current_assets.change_percent} />
                          </td>
                        )}
                      </tr>
                    </>
                  )}

                  {/* Grand Assets Total */}
                  <tr className="statement-grand-row">
                    <td colSpan={2}>
                      <strong>إجمالي الأصول</strong>
                    </td>
                    <td className="num amount">
                      <strong>{money(bs.total_assets)}</strong>
                    </td>
                    {enableCompare && (
                      <td className="num amount muted">
                        <strong>{money(bs.assets.previous_total_assets || 0)}</strong>
                      </td>
                    )}
                    {enableCompare && (
                      <td className="num">
                        <PercentBadge
                          value={
                            bs.assets.previous_total_assets
                              ? Math.round(
                                  ((bs.total_assets - bs.assets.previous_total_assets) /
                                    Math.abs(bs.assets.previous_total_assets)) *
                                    1000,
                                ) / 10
                              : null
                          }
                        />
                      </td>
                    )}
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* جانب الالتزامات وحقوق الملكية */}
          <div className="financial-statement-card">
            <div className="financial-statement-header">
              <h3>الالتزامات وحقوق الملكية (Liabilities & Equity)</h3>
              <span className="account-tag out-flow">
                الإجمالي: {money(bs.total_liabilities_and_equity)}
              </span>
            </div>
            <div className="table-scroll">
              <table className="statement-table">
                <thead>
                  <tr>
                    <th>الحساب</th>
                    <th style={{ width: '80px' }}>الكود</th>
                    <th className="num" style={{ width: '130px' }}>
                      الرصيد
                    </th>
                    {enableCompare && (
                      <th className="num" style={{ width: '130px' }}>
                        المقارنة
                      </th>
                    )}
                    {enableCompare && (
                      <th className="num" style={{ width: '90px' }}>
                        التغير
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {/* Current Liabilities */}
                  <tr className="statement-section-hdr">
                    <td colSpan={enableCompare ? 5 : 3}>الالتزامات المتداولة</td>
                  </tr>
                  {bs.liabilities.current_liabilities.rows.map((row) => (
                    <tr
                      key={row.account_id || row.code}
                      className="statement-row statement-sub-account"
                    >
                      <td className="account-name-cell">{row.name}</td>
                      <td className="num muted">{row.code}</td>
                      <td className="num amount">{money(row.amount)}</td>
                      {enableCompare && (
                        <td className="num amount muted">{money(row.previous_amount || 0)}</td>
                      )}
                      {enableCompare && (
                        <td className="num">
                          <PercentBadge value={row.change_percent} invert />
                        </td>
                      )}
                    </tr>
                  ))}
                  <tr className="statement-summary-row">
                    <td colSpan={2}>إجمالي الالتزامات المتداولة</td>
                    <td className="num amount">
                      {money(bs.liabilities.current_liabilities.total)}
                    </td>
                    {enableCompare && (
                      <td className="num amount muted">
                        {money(bs.liabilities.current_liabilities.previous_total || 0)}
                      </td>
                    )}
                    {enableCompare && (
                      <td className="num">
                        <PercentBadge
                          value={bs.liabilities.current_liabilities.change_percent}
                          invert
                        />
                      </td>
                    )}
                  </tr>

                  {/* Non-Current Liabilities */}
                  {bs.liabilities.non_current_liabilities.rows.length > 0 && (
                    <>
                      <tr className="statement-section-hdr">
                        <td colSpan={enableCompare ? 5 : 3}>الالتزامات غير المتداولة</td>
                      </tr>
                      {bs.liabilities.non_current_liabilities.rows.map((row) => (
                        <tr
                          key={row.account_id || row.code}
                          className="statement-row statement-sub-account"
                        >
                          <td className="account-name-cell">{row.name}</td>
                          <td className="num muted">{row.code}</td>
                          <td className="num amount">{money(row.amount)}</td>
                          {enableCompare && (
                            <td className="num amount muted">{money(row.previous_amount || 0)}</td>
                          )}
                          {enableCompare && (
                            <td className="num">
                              <PercentBadge value={row.change_percent} invert />
                            </td>
                          )}
                        </tr>
                      ))}
                      <tr className="statement-summary-row">
                        <td colSpan={2}>إجمالي الالتزامات غير المتداولة</td>
                        <td className="num amount">
                          {money(bs.liabilities.non_current_liabilities.total)}
                        </td>
                        {enableCompare && (
                          <td className="num amount muted">
                            {money(bs.liabilities.non_current_liabilities.previous_total || 0)}
                          </td>
                        )}
                        {enableCompare && (
                          <td className="num">
                            <PercentBadge
                              value={bs.liabilities.non_current_liabilities.change_percent}
                              invert
                            />
                          </td>
                        )}
                      </tr>
                    </>
                  )}

                  <tr className="statement-summary-row" style={{ background: '#f1f5f9' }}>
                    <td colSpan={2}>
                      <strong>إجمالي الالتزامات</strong>
                    </td>
                    <td className="num amount">
                      <strong>{money(bs.total_liabilities)}</strong>
                    </td>
                    {enableCompare && (
                      <td className="num amount muted">
                        <strong>{money(bs.liabilities.previous_total_liabilities || 0)}</strong>
                      </td>
                    )}
                    {enableCompare && <td />}
                  </tr>

                  {/* Equity */}
                  <tr className="statement-section-hdr">
                    <td colSpan={enableCompare ? 5 : 3}>حقوق الملكية</td>
                  </tr>
                  {bs.equity.items.rows.map((row) => (
                    <tr
                      key={row.account_id || row.code}
                      className="statement-row statement-sub-account"
                    >
                      <td className="account-name-cell">{row.name}</td>
                      <td className="num muted">{row.code}</td>
                      <td className="num amount">{money(row.amount)}</td>
                      {enableCompare && (
                        <td className="num amount muted">{money(row.previous_amount || 0)}</td>
                      )}
                      {enableCompare && (
                        <td className="num">
                          <PercentBadge value={row.change_percent} />
                        </td>
                      )}
                    </tr>
                  ))}
                  {/* Current Period Earnings */}
                  <tr
                    className="statement-row statement-sub-account"
                    style={{ background: '#f0fdf4' }}
                  >
                    <td className="account-name-cell">
                      <strong>أرباح / (خسائر) الفترة الجارية</strong>
                      <span className="account-tag in-flow" style={{ marginInlineStart: '8px' }}>
                        من قائمة الدخل
                      </span>
                    </td>
                    <td className="num muted">—</td>
                    <td className="num amount">
                      <strong>{money(bs.equity.current_period_earnings)}</strong>
                    </td>
                    {enableCompare && <td className="num muted">—</td>}
                    {enableCompare && <td />}
                  </tr>

                  {bs.equity.prior_period_earnings !== 0 && (
                    <tr className="statement-row statement-sub-account">
                      <td className="account-name-cell">أرباح مرحلة غير مقفلة من سنوات سابقة</td>
                      <td className="num muted">—</td>
                      <td className="num amount">{money(bs.equity.prior_period_earnings)}</td>
                      {enableCompare && <td className="num muted">—</td>}
                      {enableCompare && <td />}
                    </tr>
                  )}

                  <tr className="statement-summary-row">
                    <td colSpan={2}>
                      <strong>إجمالي حقوق الملكية</strong>
                    </td>
                    <td className="num amount">
                      <strong>{money(bs.total_equity)}</strong>
                    </td>
                    {enableCompare && (
                      <td className="num amount muted">
                        <strong>{money(bs.equity.previous_total_equity || 0)}</strong>
                      </td>
                    )}
                    {enableCompare && <td />}
                  </tr>

                  {/* Grand Liabilities & Equity Total */}
                  <tr className="statement-grand-row">
                    <td colSpan={2}>
                      <strong>إجمالي الالتزامات وحقوق الملكية</strong>
                    </td>
                    <td className="num amount">
                      <strong>{money(bs.total_liabilities_and_equity)}</strong>
                    </td>
                    {enableCompare && (
                      <td className="num amount muted">
                        <strong>{money(bs.previous_total_liabilities_and_equity || 0)}</strong>
                      </td>
                    )}
                    {enableCompare && <td />}
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ── معالج الأرصدة الافتتاحية ─────────────────────────────────────────────────────────────

function OpeningBalancesTab({ canManage }: { canManage: boolean }) {
  const statusData = useData<OpeningBalancesStatus>('/gl/opening-balances');
  const cashData = useData<CashAccount[]>('/accounts');
  const partiesData = useData<Party[]>('/parties');
  const productsData = useData<Product[]>('/products');
  const branchesData = useData<Branch[]>('/branches');
  const accountsData = useData<ChartAccount[]>('/gl/accounts');

  const { busy, act } = useAction();

  // Wizard state
  const [date, setDate] = useState(() => today());
  const [memo, setMemo] = useState('قيد الأرصدة الافتتاحية لبدء النشاط');
  const [balancingAccount, setBalancingAccount] = useState<'OPENING_EQUITY' | 'CAPITAL'>(
    'OPENING_EQUITY',
  );
  const [section, setSection] = useState<'cash' | 'parties' | 'inventory' | 'other'>('cash');

  // Input states
  const [cashBalances, setCashBalances] = useState<Record<string, string>>({});
  const [customerBalances, setCustomerBalances] = useState<Record<string, string>>({});
  const [supplierBalances, setSupplierBalances] = useState<Record<string, string>>({});
  const [inventoryItems, setInventoryItems] = useState<
    Array<{ product_id: string; branch_id: string; quantity: string; unit_cost: string }>
  >([]);
  const [otherRows, setOtherRows] = useState<
    Array<{ account_id: string; debit: string; credit: string; memo: string }>
  >([]);

  const status = statusData.data;
  const customers = (partiesData.data || []).filter((p) => p.type === 'CUSTOMER');
  const suppliers = (partiesData.data || []).filter((p) => p.type === 'SUPPLIER');
  const branches = branchesData.data || [];
  const products = productsData.data || [];
  const allAccounts = accountsData.data || [];

  // Live Calculations
  let cashTotal = 0;
  for (const val of Object.values(cashBalances)) {
    cashTotal += toCents(val || '0');
  }

  let custTotal = 0;
  for (const val of Object.values(customerBalances)) {
    custTotal += toCents(val || '0');
  }

  let suppTotal = 0;
  for (const val of Object.values(supplierBalances)) {
    suppTotal += toCents(val || '0');
  }

  let invTotal = 0;
  for (const item of inventoryItems) {
    const qty = parseInt(item.quantity, 10) || 0;
    const cost = toCents(item.unit_cost || '0');
    invTotal += qty * cost;
  }

  let otherDebit = 0;
  let otherCredit = 0;
  for (const r of otherRows) {
    otherDebit += toCents(r.debit || '0');
    otherCredit += toCents(r.credit || '0');
  }

  const liveDebit = cashTotal + custTotal + invTotal + otherDebit;
  const liveCredit = suppTotal + otherCredit;
  const diff = Math.abs(liveDebit - liveCredit);
  const isBalanced = liveDebit === liveCredit;

  const hasLaterTransactions =
    status?.earliest_transaction_date && date > status.earliest_transaction_date;

  const handleReverse = () => {
    if (!window.confirm('هل تريد بالتأكيد إلغاء وعكس قيد الأرصدة الافتتاحية؟')) return;
    void act(async () => {
      await api('/gl/opening-balances/reverse', 'POST');
      statusData.reload();
    }, 'تم عكس وإلغاء القيد الافتتاحي بنجاح');
  };

  const handlePost = (e: FormEvent) => {
    e.preventDefault();
    if (liveDebit === 0 && liveCredit === 0) return;

    const payload: OpeningBalancesPayload = {
      date,
      memo,
      balancing_account: balancingAccount,
      cash_accounts: Object.entries(cashBalances)
        .filter(([_, val]) => toCents(val || '0') > 0)
        .map(([id, val]) => ({ cash_account_id: id, amount: toCents(val) })),
      customers: Object.entries(customerBalances)
        .filter(([_, val]) => toCents(val || '0') > 0)
        .map(([id, val]) => ({ party_id: id, amount: toCents(val) })),
      suppliers: Object.entries(supplierBalances)
        .filter(([_, val]) => toCents(val || '0') > 0)
        .map(([id, val]) => ({ party_id: id, amount: toCents(val) })),
      inventory_items: inventoryItems
        .filter((item) => (parseInt(item.quantity, 10) || 0) > 0)
        .map((item) => ({
          product_id: item.product_id,
          branch_id: item.branch_id,
          quantity: parseInt(item.quantity, 10),
          unit_cost: toCents(item.unit_cost || '0'),
        })),
      other_accounts: otherRows
        .filter((r) => toCents(r.debit || '0') > 0 || toCents(r.credit || '0') > 0)
        .map((r) => ({
          account_id: r.account_id,
          debit: toCents(r.debit || '0'),
          credit: toCents(r.credit || '0'),
          memo: r.memo,
        })),
    };

    void act(async () => {
      await api('/gl/opening-balances', 'POST', payload);
      statusData.reload();
    }, 'تم ترحيل الأرصدة الافتتاحية بنجاح');
  };

  const addInventoryItem = () => {
    if (!products.length || !branches.length) return;
    setInventoryItems((prev) => [
      ...prev,
      {
        product_id: products[0].id,
        branch_id: branches[0].id,
        quantity: '1',
        unit_cost: (products[0].cost_price / 100).toString(),
      },
    ]);
  };

  const addOtherRow = () => {
    if (!allAccounts.length) return;
    setOtherRows((prev) => [
      ...prev,
      { account_id: allAccounts[0].id, debit: '', credit: '', memo: '' },
    ]);
  };

  if (statusData.loading) return <Loading />;
  if (statusData.error) return <ErrorState message={statusData.error} retry={statusData.reload} />;

  // Case 1: An Opening Entry has already been posted!
  if (status?.has_opening_entry && status.opening_entry) {
    const entry = status.opening_entry;
    const lines = status.opening_lines || [];
    return (
      <div className="wizard-card" style={{ padding: '24px' }}>
        <div className="balance-check-banner balanced" style={{ marginBottom: '24px' }}>
          <div className="indicator">
            <CheckCircle2 size={20} /> تم ترحيل قيد الأرصدة الافتتاحية بنجاح
          </div>
          <span style={{ fontSize: '13px', fontWeight: 600 }}>
            رقم القيد: {entry.number} · تاريخ الافتتاح: {entry.date}
          </span>
        </div>

        <div className="stats-grid" style={{ marginBottom: '24px' }}>
          <Stat
            label="إجمالي الأرصدة الافتتاحية"
            value={money(entry.total || 0)}
            icon={<Scale size={18} />}
          />
          <Stat
            label="تاريخ تسجيل القيد"
            value={formatDate(entry.created_at)}
            icon={<Calendar size={18} />}
          />
          <Stat label="عدد بنود القيد" value={`${lines.length} بند`} icon={<Layers size={18} />} />
        </div>

        <div className="table-toolbar">
          <h3>بنود القيد الافتتاحي في دفتر الأستاذ</h3>
          {canManage && (
            <Button variant="danger" onClick={handleReverse} busy={busy}>
              <RotateCcw size={16} /> إلغاء وعكس القيد الافتتاحي
            </Button>
          )}
        </div>

        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>كود الحساب</th>
                <th>اسم الحساب</th>
                <th>نوع الحساب</th>
                <th className="num">مدين</th>
                <th className="num">دائن</th>
                <th>البيان / الملاحظات</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.id}>
                  <td className="num">
                    <strong>{l.account_code}</strong>
                  </td>
                  <td>{l.account_name}</td>
                  <td className="muted">{l.account_type ? TYPE_LABELS[l.account_type] : '—'}</td>
                  <td className="num">{l.debit > 0 ? money(l.debit) : '—'}</td>
                  <td className="num">{l.credit > 0 ? money(l.credit) : '—'}</td>
                  <td className="muted">{l.memo || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  // Case 2: Wizard to enter opening balances
  return (
    <form onSubmit={handlePost}>
      {hasLaterTransactions && (
        <div className="balance-check-banner unbalanced" style={{ marginBottom: '20px' }}>
          <span className="indicator">
            <AlertTriangle size={18} /> تحذير أمان: تاريخ الافتتاح ({date}) يأتي بعد أول معاملة
            مسجلة في النظام ({status?.earliest_transaction_date}). يجب أن يكون تاريخ القيد الافتتاحي
            قبل أي قيد تجاري لاحق.
          </span>
        </div>
      )}

      {/* Top Header & Settings */}
      <div className="wizard-card" style={{ marginBottom: '20px', padding: '20px' }}>
        <h3 style={{ margin: '0 0 14px', fontSize: '17px', fontWeight: 800 }}>
          معالج إدخال الأرصدة الافتتاحية لبدء النشاط
        </h3>
        <p className="muted" style={{ margin: '0 0 18px', fontSize: '13.5px' }}>
          أدخل أرصدة الخزائن والبنوك والعملاء والموردين وبضاعة أول المدة، وسيقوم النظام بتوليد قيد
          افتتاحي متوازن تلقائياً بالقرش وتوجيه أي فارق إلى الحساب المختار.
        </p>

        <div className="form-grid">
          <div className="form-row">
            <Field label="تاريخ الأرصدة الافتتاحية *">
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
            </Field>
            <Field label="حساب موازنة الفارق *">
              <select
                value={balancingAccount}
                onChange={(e) =>
                  setBalancingAccount(e.target.value as 'OPENING_EQUITY' | 'CAPITAL')
                }
              >
                <option value="OPENING_EQUITY">
                  أرصدة افتتاحية (3190 - OPENING_EQUITY) [موصى به]
                </option>
                <option value="CAPITAL">رأس المال المدفوع (3110 - CAPITAL)</option>
              </select>
            </Field>
          </div>
          <Field label="البيان العام للقيد">
            <input value={memo} onChange={(e) => setMemo(e.target.value)} maxLength={200} />
          </Field>
        </div>
      </div>

      {/* Section Navigation Pills */}
      <div className="coa-filter-pills" style={{ marginBottom: '16px' }}>
        <button
          type="button"
          className={`coa-pill ${section === 'cash' ? 'active' : ''}`}
          onClick={() => setSection('cash')}
        >
          الخزائن والبنوك ({money(cashTotal)})
        </button>
        <button
          type="button"
          className={`coa-pill ${section === 'parties' ? 'active' : ''}`}
          onClick={() => setSection('parties')}
        >
          العملاء والموردون ({money(custTotal)} مدين / {money(suppTotal)} دائن)
        </button>
        <button
          type="button"
          className={`coa-pill ${section === 'inventory' ? 'active' : ''}`}
          onClick={() => setSection('inventory')}
        >
          المخزون الأولي ({money(invTotal)})
        </button>
        <button
          type="button"
          className={`coa-pill ${section === 'other' ? 'active' : ''}`}
          onClick={() => setSection('other')}
        >
          حسابات أخرى ({money(otherDebit)} مدين / {money(otherCredit)} دائن)
        </button>
      </div>

      {/* Section Content */}
      <div className="wizard-card" style={{ marginBottom: '24px', padding: '20px' }}>
        {section === 'cash' && (
          <div>
            <h4 style={{ margin: '0 0 12px' }}>أرصدة الخزائن والحسابات البنكية</h4>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>الحساب</th>
                    <th>النوع</th>
                    <th>الفرع</th>
                    <th style={{ width: '220px' }}>الرصيد الافتتاحي (ج.م)</th>
                  </tr>
                </thead>
                <tbody>
                  {(cashData.data || []).map((ca) => (
                    <tr key={ca.id}>
                      <td>
                        <strong>{ca.name}</strong>
                      </td>
                      <td className="muted">{ca.type === 'CASH' ? 'خزينة نقدية' : 'حساب بنكي'}</td>
                      <td className="muted">{ca.branch_name || 'عام'}</td>
                      <td>
                        <input
                          className="num"
                          type="number"
                          step="0.01"
                          min="0"
                          value={cashBalances[ca.id] || ''}
                          onChange={(e) =>
                            setCashBalances((prev) => ({ ...prev, [ca.id]: e.target.value }))
                          }
                          placeholder="0.00"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {section === 'parties' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
            <div>
              <h4 style={{ margin: '0 0 12px' }}>أرصدة العملاء (مدين — ذمم مدينة)</h4>
              <div className="table-scroll" style={{ maxHeight: '350px' }}>
                <table>
                  <thead>
                    <tr>
                      <th>العميل</th>
                      <th style={{ width: '160px' }}>الرصيد المدين (ج.م)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {customers.map((c) => (
                      <tr key={c.id}>
                        <td>{c.name}</td>
                        <td>
                          <input
                            className="num"
                            type="number"
                            step="0.01"
                            min="0"
                            value={customerBalances[c.id] || ''}
                            onChange={(e) =>
                              setCustomerBalances((prev) => ({
                                ...prev,
                                [c.id]: e.target.value,
                              }))
                            }
                            placeholder="0.00"
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div>
              <h4 style={{ margin: '0 0 12px' }}>أرصدة الموردين (دائن — ذمم دائنة)</h4>
              <div className="table-scroll" style={{ maxHeight: '350px' }}>
                <table>
                  <thead>
                    <tr>
                      <th>المورد</th>
                      <th style={{ width: '160px' }}>الرصيد الدائن (ج.م)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {suppliers.map((s) => (
                      <tr key={s.id}>
                        <td>{s.name}</td>
                        <td>
                          <input
                            className="num"
                            type="number"
                            step="0.01"
                            min="0"
                            value={supplierBalances[s.id] || ''}
                            onChange={(e) =>
                              setSupplierBalances((prev) => ({
                                ...prev,
                                [s.id]: e.target.value,
                              }))
                            }
                            placeholder="0.00"
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {section === 'inventory' && (
          <div>
            <div className="table-toolbar">
              <h4 style={{ margin: 0 }}>بضاعة أول المدة (المخزون الافتتاحي وتكلفة WAC)</h4>
              <Button type="button" variant="secondary" onClick={addInventoryItem}>
                <Plus size={15} /> إضافة صنف للمخزون الافتتاحي
              </Button>
            </div>
            {inventoryItems.length === 0 ? (
              <Empty
                title="لا توجد أصناف مخزون مضافة"
                description="انقر على «إضافة صنف» لإدخال الكميات الأولية وتكلفتها."
              />
            ) : (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>المنتج</th>
                      <th>الفرع</th>
                      <th style={{ width: '140px' }}>الكمية</th>
                      <th style={{ width: '160px' }}>سعر التكلفة (ج.م)</th>
                      <th style={{ width: '160px' }}>القيمة الإجمالية</th>
                      <th style={{ width: '50px' }} />
                    </tr>
                  </thead>
                  <tbody>
                    {inventoryItems.map((item, idx) => {
                      const totalVal =
                        (parseInt(item.quantity, 10) || 0) * toCents(item.unit_cost || '0');
                      return (
                        <tr key={idx}>
                          <td>
                            <select
                              value={item.product_id}
                              onChange={(e) => {
                                const p = products.find((pr) => pr.id === e.target.value);
                                setInventoryItems((items) =>
                                  items.map((it, i) =>
                                    i === idx
                                      ? {
                                          ...it,
                                          product_id: e.target.value,
                                          unit_cost: p
                                            ? (p.cost_price / 100).toString()
                                            : it.unit_cost,
                                        }
                                      : it,
                                  ),
                                );
                              }}
                            >
                              {products.map((p) => (
                                <option key={p.id} value={p.id}>
                                  {p.name} ({p.sku})
                                </option>
                              ))}
                            </select>
                          </td>
                          <td>
                            <select
                              value={item.branch_id}
                              onChange={(e) =>
                                setInventoryItems((items) =>
                                  items.map((it, i) =>
                                    i === idx ? { ...it, branch_id: e.target.value } : it,
                                  ),
                                )
                              }
                            >
                              {branches.map((b) => (
                                <option key={b.id} value={b.id}>
                                  {b.name}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td>
                            <input
                              className="num"
                              type="number"
                              min="1"
                              value={item.quantity}
                              onChange={(e) =>
                                setInventoryItems((items) =>
                                  items.map((it, i) =>
                                    i === idx ? { ...it, quantity: e.target.value } : it,
                                  ),
                                )
                              }
                            />
                          </td>
                          <td>
                            <input
                              className="num"
                              type="number"
                              step="0.01"
                              min="0"
                              value={item.unit_cost}
                              onChange={(e) =>
                                setInventoryItems((items) =>
                                  items.map((it, i) =>
                                    i === idx ? { ...it, unit_cost: e.target.value } : it,
                                  ),
                                )
                              }
                            />
                          </td>
                          <td className="num amount">
                            <strong>{money(totalVal)}</strong>
                          </td>
                          <td>
                            <button
                              type="button"
                              className="icon-btn"
                              onClick={() =>
                                setInventoryItems((items) => items.filter((_, i) => i !== idx))
                              }
                            >
                              <Trash2 size={15} />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {section === 'other' && (
          <div>
            <div className="table-toolbar">
              <h4 style={{ margin: 0 }}>
                حسابات أخرى من دليل الحسابات (أصول، التزامات، رأس مال...)
              </h4>
              <Button type="button" variant="secondary" onClick={addOtherRow}>
                <Plus size={15} /> إضافة حساب آخر
              </Button>
            </div>
            {otherRows.length === 0 ? (
              <Empty
                title="لا توجد حسابات أخرى مضافة"
                description="يمكنك إضافة حسابات مثل أصول ثابتة، التزامات طويلة الأجل، الخ."
              />
            ) : (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>الحساب</th>
                      <th style={{ width: '160px' }}>مدين (ج.م)</th>
                      <th style={{ width: '160px' }}>دائن (ج.م)</th>
                      <th>ملاحظات البند</th>
                      <th style={{ width: '50px' }} />
                    </tr>
                  </thead>
                  <tbody>
                    {otherRows.map((r, idx) => (
                      <tr key={idx}>
                        <td>
                          <select
                            value={r.account_id}
                            onChange={(e) =>
                              setOtherRows((rows) =>
                                rows.map((row, i) =>
                                  i === idx ? { ...row, account_id: e.target.value } : row,
                                ),
                              )
                            }
                          >
                            {allAccounts.map((a) => (
                              <option key={a.id} value={a.id}>
                                {a.code} — {a.name} ({TYPE_LABELS[a.type]})
                              </option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <input
                            className="num"
                            type="number"
                            step="0.01"
                            min="0"
                            value={r.debit}
                            onChange={(e) =>
                              setOtherRows((rows) =>
                                rows.map((row, i) =>
                                  i === idx ? { ...row, debit: e.target.value, credit: '' } : row,
                                ),
                              )
                            }
                            placeholder="0.00"
                          />
                        </td>
                        <td>
                          <input
                            className="num"
                            type="number"
                            step="0.01"
                            min="0"
                            value={r.credit}
                            onChange={(e) =>
                              setOtherRows((rows) =>
                                rows.map((row, i) =>
                                  i === idx ? { ...row, credit: e.target.value, debit: '' } : row,
                                ),
                              )
                            }
                            placeholder="0.00"
                          />
                        </td>
                        <td>
                          <input
                            value={r.memo}
                            onChange={(e) =>
                              setOtherRows((rows) =>
                                rows.map((row, i) =>
                                  i === idx ? { ...row, memo: e.target.value } : row,
                                ),
                              )
                            }
                            placeholder="بيان اختياري"
                          />
                        </td>
                        <td>
                          <button
                            type="button"
                            className="icon-btn"
                            onClick={() => setOtherRows((rows) => rows.filter((_, i) => i !== idx))}
                          >
                            <Trash2 size={15} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Live Balance Bar */}
      <div
        className="balance-check-banner balanced"
        style={{ padding: '16px 24px', alignItems: 'center' }}
      >
        <div style={{ display: 'flex', gap: '24px', alignItems: 'center', flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: '12px', color: 'var(--slate-500)' }}>إجمالي المدين</div>
            <strong style={{ fontSize: '16px' }}>{money(liveDebit)}</strong>
          </div>
          <div>
            <div style={{ fontSize: '12px', color: 'var(--slate-500)' }}>إجمالي الدائن</div>
            <strong style={{ fontSize: '16px' }}>{money(liveCredit)}</strong>
          </div>
          <div style={{ borderRight: '1px solid var(--slate-300)', paddingRight: '18px' }}>
            <div style={{ fontSize: '12px', color: 'var(--slate-500)' }}>فارق التوازن التلقائي</div>
            <strong
              style={{
                fontSize: '16px',
                color: isBalanced ? 'var(--emerald-700)' : 'var(--indigo-700)',
              }}
            >
              {diff > 0
                ? `${money(diff)} (${liveDebit > liveCredit ? 'دائن' : 'مدين'})`
                : 'متوازن تماماً ✓'}
            </strong>
          </div>
          <div style={{ fontSize: '12.5px', color: 'var(--slate-600)' }}>
            سيتم توجيه الفارق إلى:{' '}
            <strong>
              {balancingAccount === 'OPENING_EQUITY' ? 'أرصدة افتتاحية (3190)' : 'رأس المال (3110)'}
            </strong>
          </div>
        </div>

        <div>
          <Button
            type="submit"
            busy={busy}
            disabled={
              !canManage || (liveDebit === 0 && liveCredit === 0) || Boolean(hasLaterTransactions)
            }
          >
            <Sparkles size={16} /> ترحيل الأرصدة الافتتاحية
          </Button>
        </div>
      </div>
    </form>
  );
}

// ── Egyptian VAT Return Model 10 & Tax Registers UI ──────────────────────────────────────

const ETA_STATUS_MAP: Record<string, { label: string; tone: string }> = {
  VALID: { label: 'مقبولة (ETA)', tone: 'valid' },
  SUBMITTED: { label: 'تم الإرسال', tone: 'submitted' },
  PENDING: { label: 'قيد الانتظار', tone: 'pending' },
  INVALID: { label: 'مرفوضة', tone: 'invalid' },
  FAILED: { label: 'فشلت', tone: 'failed' },
  CANCELLED: { label: 'ملغاة', tone: 'invalid' },
  UNSUBMITTED: { label: 'غير مرسلة', tone: 'unsubmitted' },
};

function defaultVatPeriod() {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const from = `${y}-${String(m + 1).padStart(2, '0')}-01`;
  const to = now.toISOString().slice(0, 10);
  return { from, to };
}

function VatReturnTab() {
  const { company } = useSession();
  const { branches, activeId } = useBranch();
  const [period, setPeriod] = useState(defaultVatPeriod);
  const [selectedBranch, setSelectedBranch] = useState<string>(activeId || 'all');
  const [subTab, setSubTab] = useState<'model10' | 'sales-register' | 'purchases-register'>(
    'model10',
  );
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (activeId) setSelectedBranch(activeId);
  }, [activeId]);

  const queryParams = new URLSearchParams({
    from: period.from,
    to: period.to,
    ...(selectedBranch && selectedBranch !== 'all' ? { branch_id: selectedBranch } : {}),
  });

  const vatQuery = `/gl/vat-return?${queryParams.toString()}`;
  const salesQuery = `/gl/tax-register?register_type=SALES&${queryParams.toString()}`;
  const purchasesQuery = `/gl/tax-register?register_type=PURCHASES&${queryParams.toString()}`;

  const vatData = useData<VatReturnReport>(vatQuery);
  const salesData = useData<TaxRegisterResponse>(salesQuery);
  const purchasesData = useData<TaxRegisterResponse>(purchasesQuery);

  const report = vatData.data;
  const salesReg = salesData.data;
  const purchasesReg = purchasesData.data;

  const setPreset = (type: 'this-month' | 'last-month' | 'this-quarter' | 'this-year') => {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth();
    if (type === 'this-month') {
      setPeriod({
        from: `${y}-${String(m + 1).padStart(2, '0')}-01`,
        to: now.toISOString().slice(0, 10),
      });
    } else if (type === 'last-month') {
      const prevM = m === 0 ? 11 : m - 1;
      const prevY = m === 0 ? y - 1 : y;
      const lastDay = new Date(prevY, prevM + 1, 0).getDate();
      setPeriod({
        from: `${prevY}-${String(prevM + 1).padStart(2, '0')}-01`,
        to: `${prevY}-${String(prevM + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`,
      });
    } else if (type === 'this-quarter') {
      const qStartMonth = Math.floor(m / 3) * 3;
      setPeriod({
        from: `${y}-${String(qStartMonth + 1).padStart(2, '0')}-01`,
        to: now.toISOString().slice(0, 10),
      });
    } else if (type === 'this-year') {
      setPeriod({
        from: `${y}-01-01`,
        to: now.toISOString().slice(0, 10),
      });
    }
  };

  const exportModel10CSV = () => {
    if (!report) return;
    const rep = report;
    const headers = [
      'البند',
      'البيان',
      'الوعاء الضريبي (جنيه)',
      'سعر الضريبة',
      'قيمة الضريبة (جنيه)',
      'عدد المستندات',
    ];
    const rows = [
      [
        'ترويسة الإقرار',
        'مصلحة الضرائب المصرية - إقرار ضريبة القيمة المضافة (نموذج 10)',
        '',
        '',
        '',
        '',
      ],
      [
        'اسم المسجل',
        company?.name || '',
        'رقم التسجيل الضريبي',
        company?.tax_registration_number || company?.tax_number || '',
        '',
        '',
      ],
      [
        'الفترة الضريبية',
        `من ${rep.from} إلى ${rep.to}`,
        'الفرع',
        rep.branch_name || 'جميع الفروع',
        '',
        '',
      ],
      ['---', '---', '---', '---', '---', '---'],
      ['أولاً', 'المبيعات والضريبة على المخرجات', '', '', '', ''],
      [
        '1',
        'المبيعات المحلية الخاضعة للسعر العام (14%)',
        rep.sales.standard_rated_14.taxable_base / 100,
        '14%',
        rep.sales.standard_rated_14.tax_amount / 100,
        rep.sales.standard_rated_14.documents_count,
      ],
      [
        '2',
        'مردودات المبيعات وإشعارات الخصم (مستبعدة)',
        rep.sales.returns.taxable_base / 100,
        '14%',
        rep.sales.returns.tax_amount / 100,
        rep.sales.returns.documents_count,
      ],
      [
        '-',
        'إجمالي صافي وعاء المبيعات وضريبة المخرجات',
        rep.sales.net_taxable_sales / 100,
        '14%',
        rep.sales.net_output_tax / 100,
        '-',
      ],
      ['---', '---', '---', '---', '---', '---'],
      ['ثانياً', 'المشتريات والضريبة على المدخلات القابلة للخصم', '', '', '', ''],
      [
        '3',
        'المشتريات المحلية الخاضعة للسعر العام (14%)',
        rep.purchases.standard_rated_14.taxable_base / 100,
        '14%',
        rep.purchases.standard_rated_14.tax_amount / 100,
        rep.purchases.standard_rated_14.documents_count,
      ],
      [
        '4',
        'مردودات المشتريات وإشعارات الإضافة (مستبعدة)',
        rep.purchases.returns.taxable_base / 100,
        '14%',
        rep.purchases.returns.tax_amount / 100,
        rep.purchases.returns.documents_count,
      ],
      [
        '-',
        'إجمالي صافي وعاء المشتريات وضريبة المدخلات',
        rep.purchases.net_taxable_purchases / 100,
        '14%',
        rep.purchases.net_deductible_input_tax / 100,
        '-',
      ],
      ['---', '---', '---', '---', '---', '---'],
      ['ثالثاً', 'تصفية وحساب الضريبة المستحقة', '', '', '', ''],
      ['أ', 'إجمالي الضريبة على المخرجات', '', '', rep.summary.total_output_tax / 100, ''],
      [
        'ب',
        'يخصم: إجمالي الضريبة على المدخلات القابلة للخصم',
        '',
        '',
        rep.summary.total_input_tax / 100,
        '',
      ],
      [
        'ج',
        rep.summary.net_tax_due > 0
          ? 'صافي الضريبة الواجبة السداد للمصلحة'
          : 'الرصيد الدائن للمسجل (يُرحل للفترة التالية)',
        '',
        '',
        (rep.summary.net_tax_due > 0 ? rep.summary.net_tax_due : rep.summary.credit_balance) / 100,
        '',
      ],
    ];
    downloadCSV(`اقرار-ضريبة-القيمة-المضافة-نموذج-10-${rep.from}-${rep.to}`, headers, rows);
  };

  const exportRegisterCSV = (reg: TaxRegisterResponse, isSale: boolean) => {
    const headers = [
      'رقم الفاتورة',
      'التاريخ',
      'نوع المستند',
      'اسم الشريك',
      'رقم التسجيل الضريبي',
      'الفرع',
      'الوعاء الخاضع (جنيه)',
      'نسبة الضريبة',
      'قيمة الضريبة (جنيه)',
      'الإجمالي شامل الضريبة (جنيه)',
      'حالة الفاتورة الإلكترونية (ETA)',
      'المعرف الإلكتروني (UUID)',
    ];
    const rows = reg.rows.map((r) => [
      r.number,
      r.date,
      r.type_label,
      r.party_name,
      r.party_tax_number || 'مستهلك نهائي',
      r.branch_name,
      r.taxable_base / 100,
      `${r.tax_rate / 100}%`,
      r.tax_amount / 100,
      r.total_amount / 100,
      ETA_STATUS_MAP[r.eta_status || 'UNSUBMITTED']?.label || 'غير مرسلة',
      r.eta_uuid || r.eta_long_id || '-',
    ]);
    downloadCSV(
      isSale
        ? `سجل-فواتير-المبيعات-الضريبية-${reg.from}-${reg.to}`
        : `سجل-فواتير-المشتريات-الضريبية-${reg.from}-${reg.to}`,
      headers,
      rows,
    );
  };

  const filteredSalesRows = (salesReg?.rows || []).filter((r) => {
    if (!search.trim()) return true;
    const q = search.trim().toLowerCase();
    return (
      r.number.toLowerCase().includes(q) ||
      r.party_name.toLowerCase().includes(q) ||
      (r.party_tax_number && r.party_tax_number.includes(q))
    );
  });

  const filteredPurchasesRows = (purchasesReg?.rows || []).filter((r) => {
    if (!search.trim()) return true;
    const q = search.trim().toLowerCase();
    return (
      r.number.toLowerCase().includes(q) ||
      r.party_name.toLowerCase().includes(q) ||
      (r.party_tax_number && r.party_tax_number.includes(q))
    );
  });

  return (
    <div>
      {/* Filters Toolbar */}
      <div className="card report-filter" style={{ marginBottom: '20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Calendar size={18} style={{ color: 'var(--indigo-600)' }} />
          <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 700 }}>الفترة الضريبية والفرع</h3>
        </div>

        <Field label="من تاريخ">
          <input
            type="date"
            value={period.from}
            onChange={(e) => setPeriod({ ...period, from: e.target.value })}
          />
        </Field>

        <Field label="إلى تاريخ">
          <input
            type="date"
            value={period.to}
            onChange={(e) => setPeriod({ ...period, to: e.target.value })}
          />
        </Field>

        {branches && branches.length > 1 && (
          <Field label="الفرع">
            <select
              value={selectedBranch}
              onChange={(e) => setSelectedBranch(e.target.value)}
              style={{ minWidth: '160px' }}
            >
              <option value="all">جميع الفروع</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} ({b.code})
                </option>
              ))}
            </select>
          </Field>
        )}

        <div style={{ display: 'flex', gap: '6px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <Button variant="secondary" onClick={() => setPreset('this-month')}>
            الشهر الحالي
          </Button>
          <Button variant="secondary" onClick={() => setPreset('last-month')}>
            الشهر السابق
          </Button>
          <Button variant="secondary" onClick={() => setPreset('this-quarter')}>
            الربع الحالي
          </Button>
          <Button variant="secondary" onClick={() => setPreset('this-year')}>
            السنة الحالية
          </Button>
        </div>
      </div>

      {/* Sub-tabs for Model 10 vs Registers */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '20px' }}>
        <button
          className={`view-switch-btn ${subTab === 'model10' ? 'active' : ''}`}
          onClick={() => setSubTab('model10')}
          style={{ borderRadius: '8px', border: '1px solid var(--slate-200)', padding: '8px 16px' }}
        >
          <FileCheck size={16} />
          <span>إقرار نموذج 10 (ض.ق.م)</span>
        </button>
        <button
          className={`view-switch-btn ${subTab === 'sales-register' ? 'active' : ''}`}
          onClick={() => setSubTab('sales-register')}
          style={{ borderRadius: '8px', border: '1px solid var(--slate-200)', padding: '8px 16px' }}
        >
          <ReceiptText size={16} />
          <span>سجل فواتير المبيعات الضريبية ({salesReg?.rows.length ?? 0})</span>
        </button>
        <button
          className={`view-switch-btn ${subTab === 'purchases-register' ? 'active' : ''}`}
          onClick={() => setSubTab('purchases-register')}
          style={{ borderRadius: '8px', border: '1px solid var(--slate-200)', padding: '8px 16px' }}
        >
          <FileSpreadsheet size={16} />
          <span>سجل فواتير المشتريات الضريبية ({purchasesReg?.rows.length ?? 0})</span>
        </button>
      </div>

      {/* View 1: Model 10 VAT Return */}
      {subTab === 'model10' && (
        <>
          {vatData.loading ? (
            <Loading />
          ) : vatData.error ? (
            <ErrorState message={vatData.error} retry={vatData.reload} />
          ) : !report ? (
            <Empty title="لا توجد بيانات ضريبية" description="يرجى اختيار فترة زمنية أخرى." />
          ) : (
            <div className="vat-model-card">
              <div className="vat-model-header">
                <div>
                  <h2>جمهورية مصر العربية — مصلحة الضرائب المصرية</h2>
                  <div className="vat-subheading">
                    إقرار ضريبة القيمة المضافة وضريبة الجدول (نموذج 10 ض.ق.م)
                  </div>
                  <div style={{ marginTop: '8px', fontSize: '13px', color: 'var(--slate-700)' }}>
                    <span>
                      المسجل: <strong>{company?.name || 'الشركة'}</strong>
                    </span>{' '}
                    ·{' '}
                    <span>
                      رقم التسجيل الضريبي:{' '}
                      <strong>
                        {company?.tax_registration_number || company?.tax_number || 'غير مسجل'}
                      </strong>
                    </span>{' '}
                    ·{' '}
                    <span>
                      الفترة: من <strong>{report.from}</strong> إلى <strong>{report.to}</strong>
                    </span>
                    {report.branch_name && (
                      <span>
                        {' '}
                        · الفرع: <strong>{report.branch_name}</strong>
                      </span>
                    )}
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '8px' }}>
                  <Button variant="secondary" onClick={exportModel10CSV}>
                    <Download size={16} /> تصدير نموذج 10 (Excel)
                  </Button>
                  <Button variant="secondary" onClick={() => window.print()}>
                    <Printer size={16} /> طباعة
                  </Button>
                </div>
              </div>

              {/* GL Reconciliation badge */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '12px 16px',
                  background: report.summary.gl_reconciled ? '#ecfdf5' : '#fffbeb',
                  border: `1px solid ${report.summary.gl_reconciled ? '#a7f3d0' : '#fde68a'}`,
                  borderRadius: '8px',
                  marginBottom: '24px',
                }}
              >
                {report.summary.gl_reconciled ? (
                  <CheckCircle2 size={18} style={{ color: '#047857' }} />
                ) : (
                  <AlertTriangle size={18} style={{ color: '#b45309' }} />
                )}
                <div
                  style={{
                    fontSize: '13px',
                    color: report.summary.gl_reconciled ? '#065f46' : '#92400e',
                  }}
                >
                  <strong>
                    {report.summary.gl_reconciled
                      ? 'أرقام الإقرار مطابقة مع قيود الأستاذ العام بالقرش'
                      : 'تنبيه: يوجد فارق قيود يدوية على حسابات الضريبة في الأستاذ العام'}
                  </strong>{' '}
                  — رصيد ضريبة المخرجات (2120): {money(report.summary.gl_output_tax_balance)} · رصيد
                  ضريبة المدخلات (1150): {money(report.summary.gl_input_tax_balance)}
                </div>
              </div>

              {/* Table 1: Sales & Output VAT */}
              <div className="vat-table-section">
                <h3>جدول رقم (1): المبيعات والضريبة على المخرجات</h3>
                <div className="table-scroll">
                  <table className="table">
                    <thead>
                      <tr>
                        <th style={{ width: '60px' }}>البند</th>
                        <th>البيان</th>
                        <th style={{ textAlign: 'left' }}>القيمة الصافية (الوعاء)</th>
                        <th style={{ width: '100px', textAlign: 'center' }}>فئة الضريبة</th>
                        <th style={{ textAlign: 'left' }}>قيمة الضريبة المستحقة</th>
                        <th style={{ width: '100px', textAlign: 'center' }}>عدد الفواتير</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td>1</td>
                        <td>المبيعات المحلية للسلع والخدمات بالسعر العام (14%)</td>
                        <td style={{ textAlign: 'left' }}>
                          {money(report.sales.standard_rated_14.taxable_base)}
                        </td>
                        <td style={{ textAlign: 'center' }}>14%</td>
                        <td style={{ textAlign: 'left', fontWeight: 600 }}>
                          {money(report.sales.standard_rated_14.tax_amount)}
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          {count(report.sales.standard_rated_14.documents_count)}
                        </td>
                      </tr>
                      <tr>
                        <td>2</td>
                        <td>يخصم: مردودات المبيعات وإشعارات الخصم (مستبعدة)</td>
                        <td style={{ textAlign: 'left', color: 'var(--danger)' }}>
                          ({money(report.sales.returns.taxable_base)})
                        </td>
                        <td style={{ textAlign: 'center' }}>14%</td>
                        <td style={{ textAlign: 'left', color: 'var(--danger)', fontWeight: 600 }}>
                          ({money(report.sales.returns.tax_amount)})
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          {count(report.sales.returns.documents_count)}
                        </td>
                      </tr>
                    </tbody>
                    <tfoot>
                      <tr className="vat-total-row">
                        <td colSpan={2}>إجمالي صافي وعاء المبيعات والضريبة على المخرجات (أ)</td>
                        <td style={{ textAlign: 'left' }}>
                          {money(report.sales.net_taxable_sales)}
                        </td>
                        <td style={{ textAlign: 'center' }}>14%</td>
                        <td
                          style={{
                            textAlign: 'left',
                            color: 'var(--indigo-700)',
                            fontSize: '15px',
                          }}
                        >
                          {money(report.sales.net_output_tax)}
                        </td>
                        <td></td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>

              {/* Table 2: Purchases & Input VAT */}
              <div className="vat-table-section">
                <h3>جدول رقم (2): المشتريات والضريبة على المدخلات القابلة للخصم</h3>
                <div className="table-scroll">
                  <table className="table">
                    <thead>
                      <tr>
                        <th style={{ width: '60px' }}>البند</th>
                        <th>البيان</th>
                        <th style={{ textAlign: 'left' }}>القيمة الصافية (الوعاء)</th>
                        <th style={{ width: '100px', textAlign: 'center' }}>فئة الضريبة</th>
                        <th style={{ textAlign: 'left' }}>قيمة الضريبة القابلة للخصم</th>
                        <th style={{ width: '100px', textAlign: 'center' }}>عدد الفواتير</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td>3</td>
                        <td>المشتريات المحلية للسلع والخدمات بالسعر العام (14%)</td>
                        <td style={{ textAlign: 'left' }}>
                          {money(report.purchases.standard_rated_14.taxable_base)}
                        </td>
                        <td style={{ textAlign: 'center' }}>14%</td>
                        <td style={{ textAlign: 'left', fontWeight: 600 }}>
                          {money(report.purchases.standard_rated_14.tax_amount)}
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          {count(report.purchases.standard_rated_14.documents_count)}
                        </td>
                      </tr>
                      <tr>
                        <td>4</td>
                        <td>يخصم: مردودات المشتريات وإشعارات الإضافة (مستبعدة)</td>
                        <td style={{ textAlign: 'left', color: 'var(--danger)' }}>
                          ({money(report.purchases.returns.taxable_base)})
                        </td>
                        <td style={{ textAlign: 'center' }}>14%</td>
                        <td style={{ textAlign: 'left', color: 'var(--danger)', fontWeight: 600 }}>
                          ({money(report.purchases.returns.tax_amount)})
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          {count(report.purchases.returns.documents_count)}
                        </td>
                      </tr>
                    </tbody>
                    <tfoot>
                      <tr className="vat-total-row">
                        <td colSpan={2}>إجمالي صافي وعاء المشتريات والضريبة على المدخلات (ب)</td>
                        <td style={{ textAlign: 'left' }}>
                          {money(report.purchases.net_taxable_purchases)}
                        </td>
                        <td style={{ textAlign: 'center' }}>14%</td>
                        <td
                          style={{
                            textAlign: 'left',
                            color: 'var(--emerald-700)',
                            fontSize: '15px',
                          }}
                        >
                          {money(report.purchases.net_deductible_input_tax)}
                        </td>
                        <td></td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>

              {/* Table 3: Tax Settlement Summary */}
              <div
                className={`vat-settlement-card ${
                  report.summary.net_tax_due > 0 ? 'vat-settlement-due' : 'vat-settlement-credit'
                }`}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: '16px',
                  }}
                >
                  <div>
                    <h3 style={{ margin: '0 0 6px 0', fontSize: '16px', fontWeight: 800 }}>
                      جدول رقم (3): ملخص احتساب وتصفية الضريبة
                    </h3>
                    <div style={{ fontSize: '13px' }}>
                      إجمالي الضريبة على المخرجات ({money(report.summary.total_output_tax)}) — يخصم
                      إجمالي الضريبة على المدخلات ({money(report.summary.total_input_tax)})
                    </div>
                  </div>

                  <div style={{ textAlign: 'left' }}>
                    <div style={{ fontSize: '13px', fontWeight: 600, marginBottom: '4px' }}>
                      {report.summary.net_tax_due > 0
                        ? 'صافي الضريبة الواجبة السداد للمصلحة'
                        : 'رصيد ضريبي دائن للمنشأة (يُرحل للفترة التالية)'}
                    </div>
                    <div style={{ fontSize: '24px', fontWeight: 800 }}>
                      {money(
                        report.summary.net_tax_due > 0
                          ? report.summary.net_tax_due
                          : report.summary.credit_balance,
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* View 2: Sales Tax Register */}
      {subTab === 'sales-register' && (
        <div>
          <div className="table-toolbar">
            <SearchBox
              placeholder="بحث برقم الفاتورة أو اسم العميل أو الرقم الضريبي..."
              value={search}
              onChange={setSearch}
            />
            {salesReg && (
              <Button variant="secondary" onClick={() => exportRegisterCSV(salesReg, true)}>
                <Download size={16} /> تصدير سجل المبيعات (Excel)
              </Button>
            )}
          </div>

          {salesData.loading ? (
            <Loading />
          ) : salesData.error ? (
            <ErrorState message={salesData.error} retry={salesData.reload} />
          ) : !salesReg || !filteredSalesRows.length ? (
            <Empty title="لا توجد فواتير مبيعات في الفترة المحددة" />
          ) : (
            <div className="table-scroll">
              <table className="table">
                <thead>
                  <tr>
                    <th>رقم الفاتورة</th>
                    <th>التاريخ</th>
                    <th>نوع المستند</th>
                    <th>اسم العميل</th>
                    <th>رقم التسجيل الضريبي</th>
                    <th>الفرع</th>
                    <th style={{ textAlign: 'left' }}>الوعاء الخاضع</th>
                    <th style={{ width: '80px', textAlign: 'center' }}>النسبة</th>
                    <th style={{ textAlign: 'left' }}>مبلغ الضريبة</th>
                    <th style={{ textAlign: 'left' }}>الإجمالي شامل الضريبة</th>
                    <th>حالة الفاتورة الإلكترونية</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredSalesRows.map((r) => {
                    const statusMeta =
                      ETA_STATUS_MAP[r.eta_status || 'UNSUBMITTED'] || ETA_STATUS_MAP.UNSUBMITTED;
                    const isReturn = r.type === 'SALE_RETURN';
                    return (
                      <tr key={r.id}>
                        <td>
                          <strong>{r.number}</strong>
                        </td>
                        <td>{r.date}</td>
                        <td>
                          <span className={`category-tag ${isReturn ? 'out-flow' : 'in-flow'}`}>
                            {r.type_label}
                          </span>
                        </td>
                        <td>{r.party_name}</td>
                        <td>
                          {r.party_tax_number ? (
                            <span style={{ fontFamily: 'monospace' }}>{r.party_tax_number}</span>
                          ) : (
                            <span style={{ color: 'var(--slate-400)', fontSize: '12px' }}>
                              مستهلك نهائي
                            </span>
                          )}
                        </td>
                        <td>{r.branch_name}</td>
                        <td
                          style={{
                            textAlign: 'left',
                            color: isReturn ? 'var(--danger)' : undefined,
                          }}
                        >
                          {money(r.taxable_base)}
                        </td>
                        <td style={{ textAlign: 'center' }}>{r.tax_rate / 100}%</td>
                        <td
                          style={{
                            textAlign: 'left',
                            fontWeight: 600,
                            color: isReturn ? 'var(--danger)' : 'var(--indigo-700)',
                          }}
                        >
                          {money(r.tax_amount)}
                        </td>
                        <td style={{ textAlign: 'left', fontWeight: 600 }}>
                          {money(r.total_amount)}
                        </td>
                        <td>
                          <span className={`eta-pill ${statusMeta.tone}`}>{statusMeta.label}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="vat-total-row">
                    <td colSpan={6}>الإجمالي الصافي ({filteredSalesRows.length} مستند)</td>
                    <td style={{ textAlign: 'left' }}>
                      {money(filteredSalesRows.reduce((s, r) => s + r.taxable_base, 0))}
                    </td>
                    <td></td>
                    <td style={{ textAlign: 'left', color: 'var(--indigo-700)' }}>
                      {money(filteredSalesRows.reduce((s, r) => s + r.tax_amount, 0))}
                    </td>
                    <td style={{ textAlign: 'left' }}>
                      {money(filteredSalesRows.reduce((s, r) => s + r.total_amount, 0))}
                    </td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      )}

      {/* View 3: Purchases Tax Register */}
      {subTab === 'purchases-register' && (
        <div>
          <div className="table-toolbar">
            <SearchBox
              placeholder="بحث برقم الفاتورة أو اسم المورد أو الرقم الضريبي..."
              value={search}
              onChange={setSearch}
            />
            {purchasesReg && (
              <Button variant="secondary" onClick={() => exportRegisterCSV(purchasesReg, false)}>
                <Download size={16} /> تصدير سجل المشتريات (Excel)
              </Button>
            )}
          </div>

          {purchasesData.loading ? (
            <Loading />
          ) : purchasesData.error ? (
            <ErrorState message={purchasesData.error} retry={purchasesData.reload} />
          ) : !purchasesReg || !filteredPurchasesRows.length ? (
            <Empty title="لا توجد فواتير مشتريات في الفترة المحددة" />
          ) : (
            <div className="table-scroll">
              <table className="table">
                <thead>
                  <tr>
                    <th>رقم المستند</th>
                    <th>التاريخ</th>
                    <th>نوع المستند</th>
                    <th>اسم المورد</th>
                    <th>رقم التسجيل الضريبي</th>
                    <th>الفرع</th>
                    <th style={{ textAlign: 'left' }}>وعاء المشتريات</th>
                    <th style={{ width: '80px', textAlign: 'center' }}>النسبة</th>
                    <th style={{ textAlign: 'left' }}>ضريبة المدخلات</th>
                    <th style={{ textAlign: 'left' }}>الإجمالي شامل الضريبة</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredPurchasesRows.map((r) => {
                    const isReturn = r.type === 'PURCHASE_RETURN';
                    return (
                      <tr key={r.id}>
                        <td>
                          <strong>{r.number}</strong>
                        </td>
                        <td>{r.date}</td>
                        <td>
                          <span className={`category-tag ${isReturn ? 'in-flow' : 'out-flow'}`}>
                            {r.type_label}
                          </span>
                        </td>
                        <td>{r.party_name}</td>
                        <td>
                          {r.party_tax_number ? (
                            <span style={{ fontFamily: 'monospace' }}>{r.party_tax_number}</span>
                          ) : (
                            <span style={{ color: 'var(--slate-400)', fontSize: '12px' }}>
                              غير مسجل
                            </span>
                          )}
                        </td>
                        <td>{r.branch_name}</td>
                        <td
                          style={{
                            textAlign: 'left',
                            color: isReturn ? 'var(--danger)' : undefined,
                          }}
                        >
                          {money(r.taxable_base)}
                        </td>
                        <td style={{ textAlign: 'center' }}>{r.tax_rate / 100}%</td>
                        <td
                          style={{
                            textAlign: 'left',
                            fontWeight: 600,
                            color: isReturn ? 'var(--danger)' : 'var(--emerald-700)',
                          }}
                        >
                          {money(r.tax_amount)}
                        </td>
                        <td style={{ textAlign: 'left', fontWeight: 600 }}>
                          {money(r.total_amount)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="vat-total-row">
                    <td colSpan={6}>الإجمالي الصافي ({filteredPurchasesRows.length} مستند)</td>
                    <td style={{ textAlign: 'left' }}>
                      {money(filteredPurchasesRows.reduce((s, r) => s + r.taxable_base, 0))}
                    </td>
                    <td></td>
                    <td style={{ textAlign: 'left', color: 'var(--emerald-700)' }}>
                      {money(filteredPurchasesRows.reduce((s, r) => s + r.tax_amount, 0))}
                    </td>
                    <td style={{ textAlign: 'left' }}>
                      {money(filteredPurchasesRows.reduce((s, r) => s + r.total_amount, 0))}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
