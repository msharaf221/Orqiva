import { useState, type FormEvent } from 'react';
import {
  Plus,
  Download,
  Wallet,
  ReceiptText,
  ShieldCheck,
  Building2,
  Pencil,
  Banknote,
  CreditCard,
  ArrowRightLeft,
  AlertTriangle,
  Printer,
  Coins,
  FileText,
  TrendingUp,
  Users,
} from 'lucide-react';
import {
  api,
  useData,
  useSession,
  useAction,
  useToast,
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
} from '../../lib';
import type {
  CashAccount,
  AccountType,
  AccountTransfer,
  AccountStatementEntry,
  PosShift,
  PosShiftSummary,
  Party,
} from '../../types';
import { useBranch, withBranch } from '../../branch';
import { can } from '../../auth';
import { ShiftTreasuryAuditModal, ShiftZReportModal } from './shift-audit';
import { ChequesView } from './cheques';
import { ReconciliationView } from './reconciliation';
import { PayrollView } from './payroll';

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

    void act(
      async () => {
        if (account) {
          await api(`/cash-accounts/${account.id}`, 'PUT', payload);
        } else {
          await api('/cash-accounts', 'POST', payload);
        }
        onSaved();
      },
      account ? 'تم حفظ تعديلات الحساب' : 'تم إنشاء الحساب المالي بنجاح',
    );
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
      size="xl"
      showMaximize
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
          <div
            className="table-filters"
            style={{
              width: '100%',
              display: 'flex',
              gap: '8px',
              alignItems: 'flex-end',
              flexWrap: 'wrap',
            }}
          >
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
  const toast = useToast();
  const accountsData = useData<CashAccount[]>(withBranch('/cash-accounts', activeId));
  const transfersData = useData<AccountTransfer[]>('/cash-accounts/transfers');
  const shiftsData = useData<PosShift[]>(withBranch('/pos/shifts', activeId));

  const [tab, setTab] = useState<
    'accounts' | 'transfers' | 'shifts' | 'cheques' | 'reconciliation' | 'payroll'
  >('accounts');
  const partiesData = useData<Party[]>('/parties');
  const parties = partiesData.data || [];
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [shiftStatusFilter, setShiftStatusFilter] = useState<
    'all' | 'PENDING_REVIEW' | 'CLOSED' | 'OPEN'
  >('all');
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
  const [auditingShiftId, setAuditingShiftId] = useState<string | null>(null);
  const [viewingHandoverShift, setViewingHandoverShift] = useState<{
    shift: PosShift;
    summary: PosShiftSummary;
  } | null>(null);

  const accounts = accountsData.data || [];
  const transfers = transfersData.data || [];
  const shifts = shiftsData.data || [];

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

  const filteredShifts = shifts.filter((s) => {
    const matchesStatus = shiftStatusFilter === 'all' || s.status === shiftStatusFilter;
    const matchesQuery =
      !query ||
      (
        s.number +
        (s.user_name || '') +
        (s.terminal_batch_number || '') +
        (s.safe_envelope_number || '')
      )
        .toLowerCase()
        .includes(query.toLowerCase());
    return matchesStatus && matchesQuery;
  });

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
    shiftsData.reload();
  };

  return (
    <>
      <PageHeader
        eyebrow="إدارة السيولة النقدية والبنكية"
        title="الخزائن والحسابات البنكية"
        description="راقب أرصدة خزائن الفروع وحسابات البنوك، ونفّذ التحويلات المالية الداخلية، واعتمد تسويات ورديات نقاط البيع مع المستندات الثبوتية."
        actions={
          <>
            <Button
              variant="secondary"
              onClick={() =>
                downloadCSV(
                  tab === 'accounts'
                    ? 'الحسابات-المالية'
                    : tab === 'transfers'
                      ? 'التحويلات-المالية'
                      : 'تسويات-ورديات-نقاط-البيع',
                  tab === 'accounts'
                    ? ['الاسم', 'النوع', 'الفرع', 'الرصيد', 'السحب على المكشوف', 'الحالة']
                    : tab === 'transfers'
                      ? ['رقم التحويل', 'من حساب', 'إلى حساب', 'المبلغ', 'التاريخ', 'ملاحظات']
                      : [
                          'رقم الوردية',
                          'الفرع',
                          'الكاشير',
                          'الحالة',
                          'الكاش المسلّم',
                          'الفيزا',
                          'إنستاباي',
                          'رقم الباتش',
                          'ظرف الخزنة',
                        ],
                  tab === 'accounts'
                    ? filteredAccounts.map((a) => [
                        a.name,
                        a.type === 'CASH' ? 'خزينة' : a.type === 'BANK' ? 'بنك' : 'محفظة',
                        a.branch_name || 'عام',
                        a.balance / 100,
                        a.allow_negative ? 'مسموح' : 'ممنوع',
                        a.active ? 'نشط' : 'مؤرشف',
                      ])
                    : tab === 'transfers'
                      ? filteredTransfers.map((t) => [
                          t.number,
                          t.from_account_name || '',
                          t.to_account_name || '',
                          t.amount / 100,
                          t.date,
                          t.notes,
                        ])
                      : filteredShifts.map((s) => [
                          s.number,
                          s.branch_id || 'عام',
                          s.user_name || '',
                          s.status === 'CLOSED'
                            ? 'معتمدة ومقفلة'
                            : s.status === 'PENDING_REVIEW'
                              ? 'بانتظار الاعتماد'
                              : 'جارية',
                          (s.cashier_declared_cash ?? s.closing_cash ?? 0) / 100,
                          (s.cashier_declared_card ?? s.expected_card ?? 0) / 100,
                          (s.cashier_declared_bank ?? s.expected_bank ?? 0) / 100,
                          s.terminal_batch_number || '',
                          s.safe_envelope_number || '',
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

      {tab === 'shifts' ? (
        <div className="stats-grid three">
          <Stat
            label="الورديات بانتظار الاعتماد"
            value={count(shifts.filter((s) => s.status === 'PENDING_REVIEW').length)}
            icon={<ShieldCheck size={20} />}
            tone={
              shifts.filter((s) => s.status === 'PENDING_REVIEW').length > 0 ? 'amber' : 'green'
            }
            foot="تتطلب مطابقة المستندات واعتماد الخزينة"
          />
          <Stat
            label="إجمالي مقبوضات الكاش بالورديات"
            value={money(
              shifts.reduce(
                (sum, s) =>
                  sum + (s.cashier_declared_cash ?? s.closing_cash ?? s.expected_cash ?? 0),
                0,
              ),
            )}
            icon={<Coins size={20} />}
            tone="amber"
            foot="النقدية المسلمة من الكاشيرات للدرج"
          />
          <Stat
            label="مقبوضات البطاقات وإنستاباي"
            value={money(
              shifts.reduce(
                (sum, s) =>
                  sum +
                  (s.cashier_declared_card ?? s.expected_card ?? 0) +
                  (s.cashier_declared_bank ?? s.expected_bank ?? 0),
                0,
              ),
            )}
            icon={<CreditCard size={20} />}
            tone="blue"
            foot="مدفوعات إلكترونية ومحافظ مثبتة بأرقام تسوية"
          />
        </div>
      ) : tab === 'accounts' || tab === 'transfers' ? (
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
      ) : null}

      <section className="card">
        <div className="table-toolbar" style={{ flexWrap: 'wrap', gap: '8px' }}>
          <div className="tabs" style={{ margin: 0, flexWrap: 'wrap' }}>
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
            <button
              className={tab === 'shifts' ? 'active' : ''}
              onClick={() => {
                setTab('shifts');
                setPage(1);
              }}
            >
              <ShieldCheck size={14} /> تسويات ورديات نقاط البيع ({shifts.length})
            </button>
            {can(user, 'finance:accounts') && (
              <button
                className={tab === 'cheques' ? 'active' : ''}
                onClick={() => {
                  setTab('cheques');
                  setPage(1);
                }}
              >
                <FileText size={14} /> أوراق القبض والدفع (الشيكات)
              </button>
            )}
            {can(user, 'finance:accounts') && (
              <button
                className={tab === 'reconciliation' ? 'active' : ''}
                onClick={() => {
                  setTab('reconciliation');
                  setPage(1);
                }}
              >
                <TrendingUp size={14} /> التسوية والتوقع المالي
              </button>
            )}
            {can(user, 'hr:view') && (
              <button
                className={tab === 'payroll' ? 'active' : ''}
                onClick={() => {
                  setTab('payroll');
                  setPage(1);
                }}
              >
                <Users size={14} /> الرواتب والأجور (HR)
              </button>
            )}
          </div>
          {['accounts', 'transfers', 'shifts'].includes(tab) && (
            <div className="table-filters">
              <SearchBox
                value={query}
                onChange={setQuery}
                placeholder={
                  tab === 'accounts'
                    ? 'بحث عن حساب أو بنك...'
                    : tab === 'transfers'
                      ? 'بحث في التحويلات...'
                      : 'بحث برقم الوردية أو الكاشير أو الباتش...'
                }
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
              {tab === 'shifts' && (
                <select
                  className="filter-select"
                  value={shiftStatusFilter}
                  onChange={(e) => setShiftStatusFilter(e.target.value as any)}
                >
                  <option value="all">كل حالات الورديات</option>
                  <option value="PENDING_REVIEW">بانتظار اعتماد الخزنة (معلقة)</option>
                  <option value="CLOSED">معتمدة ومقفلة</option>
                  <option value="OPEN">ورديات جارية مفتوحة</option>
                </select>
              )}
            </div>
          )}
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
                    <Button variant="secondary" onClick={() => setStatementAccount(acc)}>
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
                        <Button variant="secondary" onClick={() => setEditingAccount(acc)}>
                          <Pencil size={14} />
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )
        ) : tab === 'transfers' ? (
          transfersData.error ? (
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
                  {filteredTransfers.slice((page - 1) * 10, page * 10).map((t) => (
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
              <Pagination
                page={page}
                setPage={setPage}
                total={filteredTransfers.length}
                size={10}
              />
            </div>
          )
        ) : tab === 'shifts' ? (
          shiftsData.error ? (
            <ErrorState message={shiftsData.error} retry={shiftsData.reload} />
          ) : shiftsData.loading ? (
            <Loading />
          ) : !filteredShifts.length ? (
            <Empty description="لا توجد ورديات نقاط بيع مسجلة مطابقة للبحث" />
          ) : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>رقم الوردية</th>
                    <th>الفرع</th>
                    <th>الكاشير</th>
                    <th>توقيت الفتح / الإغلاق</th>
                    <th>نقدية الدرج (كاش)</th>
                    <th>البطاقات والفيزا</th>
                    <th>إنستاباي والمحافظ</th>
                    <th>ظرف الخزنة</th>
                    <th>الحالة</th>
                    <th>الإجراءات</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredShifts.slice((page - 1) * 10, page * 10).map((s) => (
                    <tr key={s.id}>
                      <td>
                        <strong style={{ fontFamily: 'Manrope Variable, sans-serif' }}>
                          #{s.number}
                        </strong>
                      </td>
                      <td>{s.branch_id || 'عام'}</td>
                      <td>
                        <span className="font-semibold">{s.user_name || '—'}</span>
                      </td>
                      <td style={{ fontSize: '11.5px', color: 'var(--slate-500)' }}>
                        <div>ف: {formatDate(s.opened_at || '', true)}</div>
                        {s.closed_at && <div>غ: {formatDate(s.closed_at, true)}</div>}
                      </td>
                      <td>
                        <div style={{ fontSize: '12.5px' }}>
                          <span>
                            مسلّم:{' '}
                            <b>{money(s.cashier_declared_cash ?? s.closing_cash ?? 0)} ج.م</b>
                          </span>
                          {s.difference !== 0 && s.difference !== null && (
                            <div
                              style={{
                                fontSize: '11px',
                                fontWeight: 700,
                                color: s.difference < 0 ? '#dc2626' : '#2563eb',
                              }}
                            >
                              {s.difference < 0
                                ? `عجز: -${money(Math.abs(s.difference))} ج.م`
                                : `زيادة: +${money(s.difference)} ج.م`}
                            </div>
                          )}
                        </div>
                      </td>
                      <td>
                        <div style={{ fontSize: '12.5px' }}>
                          <span>{money(s.cashier_declared_card ?? s.expected_card ?? 0)} ج.م</span>
                          {s.terminal_batch_number && (
                            <div style={{ fontSize: '10.5px', color: '#2563eb', fontWeight: 600 }}>
                              باتش: #{s.terminal_batch_number} ({s.card_slips_count || 0} إيصال)
                            </div>
                          )}
                        </div>
                      </td>
                      <td>
                        <div style={{ fontSize: '12.5px' }}>
                          <span>{money(s.cashier_declared_bank ?? s.expected_bank ?? 0)} ج.م</span>
                          {(s.bank_transfers_count || 0) > 0 && (
                            <div style={{ fontSize: '10.5px', color: '#059669', fontWeight: 600 }}>
                              {s.bank_transfers_count} عملية تحويل
                            </div>
                          )}
                        </div>
                      </td>
                      <td>
                        {s.safe_envelope_number ? (
                          <span
                            style={{
                              padding: '2px 8px',
                              borderRadius: '4px',
                              background: '#ede9fe',
                              color: '#5b21b6',
                              fontSize: '11px',
                              fontWeight: 700,
                            }}
                          >
                            #{s.safe_envelope_number}
                          </span>
                        ) : (
                          <span style={{ color: 'var(--muted)', fontSize: '11px' }}>—</span>
                        )}
                      </td>
                      <td>
                        <span
                          className={
                            s.status === 'CLOSED'
                              ? 'badge green'
                              : s.status === 'PENDING_REVIEW'
                                ? 'badge amber'
                                : 'badge blue'
                          }
                        >
                          {s.status === 'CLOSED'
                            ? 'معتمدة ومقفلة'
                            : s.status === 'PENDING_REVIEW'
                              ? 'بانتظار الاعتماد'
                              : 'وردية جارية'}
                        </span>
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: '6px' }}>
                          {s.status === 'PENDING_REVIEW' && (
                            <Button
                              style={{ padding: '4px 10px', fontSize: '12px' }}
                              onClick={() => setAuditingShiftId(s.id)}
                            >
                              <ShieldCheck size={14} /> اعتماد ومطابقة
                            </Button>
                          )}
                          <Button
                            variant="secondary"
                            style={{ padding: '4px 10px', fontSize: '12px' }}
                            onClick={async () => {
                              try {
                                const sum = await api<PosShiftSummary>(
                                  `/pos/shifts/${s.id}/summary`,
                                );
                                setViewingHandoverShift({ shift: s, summary: sum });
                              } catch (err: any) {
                                toast(err.message || 'تعذر تحميل ملخص الوردية');
                              }
                            }}
                          >
                            <Printer size={14} /> Z-Report
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <Pagination page={page} setPage={setPage} total={filteredShifts.length} size={10} />
            </div>
          )
        ) : tab === 'cheques' ? (
          <div style={{ padding: '16px' }}>
            <ChequesView accounts={accounts} parties={parties} />
          </div>
        ) : tab === 'reconciliation' ? (
          <div style={{ padding: '16px' }}>
            <ReconciliationView accounts={accounts} />
          </div>
        ) : (
          <div style={{ padding: '16px' }}>
            <PayrollView />
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
        <StatementModal account={statementAccount} onClose={() => setStatementAccount(null)} />
      )}

      {auditingShiftId && (
        <ShiftTreasuryAuditModal
          shiftId={auditingShiftId}
          onClose={() => setAuditingShiftId(null)}
          onApproved={() => {
            setAuditingShiftId(null);
            reloadAll();
          }}
        />
      )}

      {viewingHandoverShift && (
        <ShiftZReportModal
          shift={viewingHandoverShift.shift}
          summary={viewingHandoverShift.summary}
          onClose={() => setViewingHandoverShift(null)}
        />
      )}
    </>
  );
}
