import { useEffect, useState, type FormEvent } from 'react';
import { AlertTriangle, HandCoins, Plus, Scale, Users, Wallet } from 'lucide-react';
import {
  api,
  Button,
  Empty,
  ErrorState,
  Field,
  formatDate,
  Loading,
  methods,
  Modal,
  money,
  PageHeader,
  Stat,
  toCents,
  today,
  useAction,
  useData,
} from '../lib';
import { useBranch } from '../branch';
import type {
  Distribution,
  DistributionPreview,
  DistributionStatus,
  Owner,
  PaymentMethod,
  CashAccount,
} from '../types';

const statusLabels: Record<DistributionStatus, { label: string; cls: string }> = {
  DRAFT: { label: 'مسودة', cls: 'draft' },
  APPROVED: { label: 'معتمد · بانتظار الصرف', cls: 'pending' },
  PAID: { label: 'مصروف بالكامل', cls: 'paid' },
  CANCELLED: { label: 'ملغى', cls: 'cancelled' },
};
const piastresToEgp = (value: number) => money(value, 2);
/** Distributions belong to closed periods, so the default is the previous calendar month. */
function previousMonth(): { from: string; to: string } {
  const [year, month] = today().split('-').map(Number);
  const start = new Date(Date.UTC(year, month - 2, 1));
  const end = new Date(Date.UTC(year, month - 1, 0));
  return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
}

export function Distributions() {
  const [tab, setTab] = useState<'distributions' | 'owners'>('distributions');
  return (
    <>
      <PageHeader
        eyebrow="المالك والشركاء"
        title="التوزيعات والشركاء"
        description="احسب أرباح المجموعة، واحجز الاحتياطي، ووزّع على الملاك بنسبهم. لا يُصرف أكثر من السيولة المتاحة."
      />
      <div className="tabs">
        <button
          className={tab === 'distributions' ? 'active' : ''}
          onClick={() => setTab('distributions')}
        >
          التوزيعات
        </button>
        <button className={tab === 'owners' ? 'active' : ''} onClick={() => setTab('owners')}>
          الملاك والشركاء
        </button>
      </div>
      {tab === 'distributions' ? <DistributionsPanel /> : <OwnersPanel />}
    </>
  );
}

/* ----------------------------------------------------------------------------- owners */

function OwnersPanel() {
  const owners = useData<Owner[]>('/owners');
  const [editing, setEditing] = useState<Owner | 'new' | null>(null),
    [entryFor, setEntryFor] = useState<Owner | null>(null),
    [ledgerFor, setLedgerFor] = useState<Owner | null>(null);
  const { act, busy } = useAction();
  if (owners.error) return <ErrorState message={owners.error} retry={owners.reload} />;
  if (!owners.data) return <Loading />;
  const list = owners.data;
  const share = list.filter((o) => o.active).reduce((s, o) => s + o.share_bps, 0);
  return (
    <>
      <div className="stats-grid three">
        <Stat
          label="مجموع نسب الملكية"
          value={(share / 100).toFixed(share % 100 ? 2 : 0)}
          unit="٪"
          icon={<Scale size={20} />}
          tone={share === 10000 ? 'green' : 'amber'}
          foot={share === 10000 ? 'مكتمل. التوزيع متاح' : 'يجب أن يكتمل إلى ١٠٠٪ قبل التوزيع'}
        />
        <Stat
          label="رأس المال المودع"
          value={money(list.reduce((s, o) => s + o.contributed, 0))}
          icon={<Wallet size={20} />}
          tone="blue"
          foot="مجموع الإيداعات من الملاك"
        />
        <Stat
          label="مستحق للشركاء"
          value={money(list.reduce((s, o) => s + o.due, 0))}
          icon={<HandCoins size={20} />}
          tone="amber"
          foot="أرباح معتمدة لم تُصرف بعد"
        />
      </div>
      <section className="card">
        <div className="table-toolbar">
          <h2>
            <Users size={18} /> الملاك والشركاء
          </h2>
          <Button onClick={() => setEditing('new')}>
            <Plus size={18} /> شريك جديد
          </Button>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>الاسم</th>
                <th>النسبة</th>
                <th>المودَع</th>
                <th>المسحوب</th>
                <th>المعلن (أرباح)</th>
                <th>المدفوع</th>
                <th>المستحق</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.map((o) => (
                <tr key={o.id} className={o.active ? '' : 'muted'}>
                  <td>
                    <strong>{o.name}</strong>
                    <small className="cell-sub">
                      {o.active ? '' : 'موقوف · '}
                      {o.email || o.phone || ''}
                    </small>
                  </td>
                  <td className="num">{(o.share_bps / 100).toFixed(o.share_bps % 100 ? 2 : 0)}٪</td>
                  <td className="num">{money(o.contributed, 2)}</td>
                  <td className="num">{money(o.withdrawn, 2)}</td>
                  <td className="num">{money(o.declared, 2)}</td>
                  <td className="num">{money(o.paid, 2)}</td>
                  <td className="num amount">
                    {money(o.due, 2)} <small>ج.م</small>
                  </td>
                  <td className="row-actions">
                    <Button variant="ghost" onClick={() => setLedgerFor(o)}>
                      كشف الحساب
                    </Button>
                    <Button variant="ghost" onClick={() => setEntryFor(o)}>
                      حركة
                    </Button>
                    <Button variant="ghost" onClick={() => setEditing(o)}>
                      تعديل
                    </Button>
                    <Button
                      variant="ghost"
                      busy={busy}
                      onClick={() =>
                        void act(
                          async () => {
                            await api(`/owners/${o.id}/active`, 'PATCH', { active: !o.active });
                            owners.reload();
                          },
                          o.active ? 'تم إيقاف الشريك من التوزيعات' : 'تم تفعيل الشريك',
                        )
                      }
                    >
                      {o.active ? 'إيقاف' : 'تفعيل'}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {editing && (
        <OwnerForm
          owner={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            owners.reload();
          }}
        />
      )}
      {entryFor && (
        <EntryForm
          owner={entryFor}
          onClose={() => setEntryFor(null)}
          onSaved={() => {
            setEntryFor(null);
            owners.reload();
          }}
        />
      )}
      {ledgerFor && <LedgerModal owner={ledgerFor} onClose={() => setLedgerFor(null)} />}
    </>
  );
}

function OwnerForm({
  owner,
  onClose,
  onSaved,
}: {
  owner?: Owner;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { busy, act } = useAction();
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    void act(
      async () => {
        const body = {
          name: f.get('name'),
          phone: f.get('phone'),
          email: f.get('email'),
          share_bps: Math.round(Number(f.get('share')) * 100),
        };
        await api(owner ? `/owners/${owner.id}` : '/owners', owner ? 'PUT' : 'POST', body);
        onSaved();
      },
      owner ? 'تم تحديث بيانات الشريك' : 'تمت إضافة الشريك',
    );
  };
  return (
    <Modal
      title={owner ? 'تعديل الشريك' : 'شريك جديد'}
      description="النسب تُجمع لتكون ١٠٠٪ بالضبط قبل إجراء أي توزيع."
      onClose={onClose}
    >
      <form onSubmit={submit}>
        <div className="modal-body form-grid">
          <Field label="الاسم *">
            <input name="name" required maxLength={100} defaultValue={owner?.name ?? ''} />
          </Field>
          <Field label="نسبة الملكية (٪) *" hint="من ٠ إلى ١٠٠، حتى منزلتين عشريتين.">
            <input
              name="share"
              required
              type="number"
              min={0}
              max={100}
              step="0.01"
              dir="ltr"
              defaultValue={owner ? owner.share_bps / 100 : 100}
            />
          </Field>
          <Field label="الهاتف">
            <input name="phone" dir="ltr" maxLength={40} defaultValue={owner?.phone ?? ''} />
          </Field>
          <Field label="البريد الإلكتروني">
            <input
              name="email"
              type="email"
              dir="ltr"
              maxLength={200}
              defaultValue={owner?.email ?? ''}
            />
          </Field>
        </div>
        <div className="modal-footer">
          <Button busy={busy} type="submit">
            حفظ
          </Button>
          <Button type="button" variant="secondary" onClick={onClose}>
            إلغاء
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function EntryForm({
  owner,
  onClose,
  onSaved,
}: {
  owner: Owner;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { busy, act } = useAction();
  const accountsData = useData<CashAccount[]>('/cash-accounts');
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const accId = f.get('account_id') ? String(f.get('account_id')) : undefined;
    void act(async () => {
      await api(`/owners/${owner.id}/entries`, 'POST', {
        kind: f.get('kind'),
        amount: toCents(f.get('amount')),
        method: f.get('method'),
        date: f.get('date'),
        notes: f.get('notes'),
        account_id: accId,
      });
      onSaved();
    }, 'تم تسجيل الحركة');
  };
  return (
    <Modal
      title={`حركة ${owner.name}`}
      description="الإيداع يزيد السيولة، والمسحوب يُسحب منها ولا يتجاوز رصيدها."
      onClose={onClose}
    >
      <form onSubmit={submit}>
        <div className="modal-body form-grid">
          <Field label="نوع الحركة *">
            <select name="kind" defaultValue="CONTRIBUTION">
              <option value="CONTRIBUTION">إيداع رأس مال</option>
              <option value="WITHDRAWAL">مسحوب شخصي</option>
            </select>
          </Field>
          <Field label="المبلغ (ج.م) *">
            <input name="amount" required type="number" min="0.01" step="0.01" dir="ltr" />
          </Field>
          <div className="form-row">
            <Field label="طريقة الحركة *">
              <select name="method" defaultValue="BANK">
                {Object.entries(methods).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="التاريخ *">
              <input type="date" name="date" required defaultValue={today()} />
            </Field>
          </div>
          <Field
            label="الحساب المالي / الخزينة"
            hint="الخزينة أو الحساب البنكي للإيداع أو السحب (اختياري، يحدّد تلقائياً حسب الطريقة)"
          >
            <select name="account_id" defaultValue="">
              <option value="">تلقائي حسب طريقة الحركة</option>
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
            <input name="notes" maxLength={500} />
          </Field>
        </div>
        <div className="modal-footer">
          <Button busy={busy} type="submit">
            تسجيل الحركة
          </Button>
          <Button type="button" variant="secondary" onClick={onClose}>
            إلغاء
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function LedgerModal({ owner, onClose }: { owner: Owner; onClose: () => void }) {
  const ledger = useData<{
    owner: Owner;
    entries: {
      id: string;
      kind: string;
      amount: number;
      method: PaymentMethod;
      date: string;
      notes: string;
    }[];
    distributions: {
      number: string;
      status: string;
      period_from: string;
      period_to: string;
      amount: number;
      paid: number;
    }[];
  }>(`/owners/${owner.id}/ledger`);
  return (
    <Modal title={`كشف حساب ${owner.name}`} wide onClose={onClose}>
      <div className="modal-body">
        {ledger.error ? (
          <ErrorState message={ledger.error} retry={ledger.reload} />
        ) : !ledger.data ? (
          <Loading />
        ) : (
          <>
            <div className="ledger-summary">
              <span>
                المودَع <b className="num">{money(ledger.data.owner.contributed, 2)}</b>
              </span>
              <span>
                المسحوب <b className="num">{money(ledger.data.owner.withdrawn, 2)}</b>
              </span>
              <span>
                المعلن <b className="num">{money(ledger.data.owner.declared, 2)}</b>
              </span>
              <span>
                المدفوع <b className="num">{money(ledger.data.owner.paid, 2)}</b>
              </span>
              <span className="amount">
                المستحق <b className="num">{money(ledger.data.owner.due, 2)}</b>
              </span>
            </div>
            <h3 className="ledger-title">الحركات الشخصية</h3>
            {ledger.data.entries.length ? (
              <table>
                <tbody>
                  {ledger.data.entries.map((e) => (
                    <tr key={e.id}>
                      <td>{e.kind === 'CONTRIBUTION' ? 'إيداع رأس مال' : 'مسحوب شخصي'}</td>
                      <td className="muted">{formatDate(e.date, true)}</td>
                      <td>{methods[e.method]}</td>
                      <td
                        className={'num ' + (e.kind === 'CONTRIBUTION' ? 'positive' : 'negative')}
                      >
                        {e.kind === 'CONTRIBUTION' ? '+' : '−'}
                        {money(e.amount, 2)} <small>ج.م</small>
                      </td>
                      <td className="muted">{e.notes || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="muted">لا توجد حركات شخصية بعد.</p>
            )}
            <h3 className="ledger-title">أرباح معلنة</h3>
            {ledger.data.distributions.length ? (
              <table>
                <tbody>
                  {ledger.data.distributions.map((d) => (
                    <tr key={d.number}>
                      <td className="num">{d.number}</td>
                      <td className="muted">
                        {formatDate(d.period_from, true)} — {formatDate(d.period_to, true)}
                      </td>
                      <td>
                        <span
                          className={'badge ' + statusLabels[d.status as DistributionStatus].cls}
                        >
                          <i /> {statusLabels[d.status as DistributionStatus].label}
                        </span>
                      </td>
                      <td className="num amount">
                        {money(d.amount, 2)} <small>ج.م</small>
                      </td>
                      <td className="num muted">مدفوع {money(d.paid, 2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="muted">لم تُعلن أرباح لهذا الشريك بعد.</p>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}

/* ----------------------------------------------------------------------- distributions */

function DistributionsPanel() {
  const { isGroup } = useBranch();
  const [from, setFrom] = useState(() => previousMonth().from),
    [to, setTo] = useState(() => previousMonth().to),
    [reserve, setReserve] = useState(5);
  const [preview, setPreview] = useState<DistributionPreview | null>(null),
    [previewError, setPreviewError] = useState(''),
    [previewing, setPreviewing] = useState(false),
    [viewing, setViewing] = useState<string | null>(null);
  const list = useData<(Distribution & { paid_total: number })[]>('/distributions');
  const { busy, act } = useAction();
  // What-if: the preview recalculates as the period or the reserve changes, without writing anything.
  useEffect(() => {
    if (!from || !to || to < from) {
      setPreview(null);
      setPreviewError(to < from ? 'نهاية الفترة يجب أن تكون بعد بدايتها' : '');
      return;
    }
    let alive = true;
    const timer = setTimeout(() => {
      setPreviewing(true);
      api<DistributionPreview>('/distributions/preview', 'POST', {
        period_from: from,
        period_to: to,
        reserve_bps: Math.round(reserve * 100),
      })
        .then((p) => {
          if (!alive) return;
          setPreview(p);
          setPreviewError('');
        })
        .catch((e: unknown) => {
          if (!alive) return;
          setPreview(null);
          setPreviewError(e instanceof Error ? e.message : 'تعذر حساب المعاينة');
        })
        .finally(() => {
          if (alive) setPreviewing(false);
        });
    }, 350);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [from, to, reserve]);
  const createDraft = () =>
    void act(async () => {
      const draft = await api<Distribution>('/distributions', 'POST', {
        period_from: from,
        period_to: to,
        reserve_bps: Math.round(reserve * 100),
        notes: '',
      });
      list.reload();
      setViewing(draft.id);
    }, 'تم إنشاء مسودة التوزيع. راجعها ثم اعتمدها.');
  const canCreate =
    !!preview &&
    !preview.overlap &&
    preview.shareTotal === 10000 &&
    preview.distributable > 0 &&
    !previewing;
  return (
    <>
      <section className="card distribution-calc">
        <div className="card-heading">
          <div>
            <h2>
              <Scale size={18} /> حاسبة التوزيع
            </h2>
            <p>
              صافي الربح = المبيعات قبل الضريبة − تكلفة البضاعة المباعة − كل المصروفات (المباشرة
              والمشتركة). الخسارة في فرع تُخصم من أرباح الفروع الأخرى. اختر فترة مغلقة، مثل شهر
              كامل: المسودة تُجمَّد عند إنشائها، وأي تغيير لاحق في الفترة يلغي صلاحيتها قبل
              الاعتماد.
            </p>
          </div>
        </div>
        <div className="calc-controls">
          <Field label="من">
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="إلى">
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
          <Field
            label={`الاحتياطي: ${reserve}٪ من صافي الربح`}
            hint="يُحجز قبل أي توزيع على الملاك."
          >
            <input
              type="range"
              min={0}
              max={50}
              step={0.5}
              value={reserve}
              onChange={(e) => setReserve(Number(e.target.value))}
              aria-label="نسبة الاحتياطي"
            />
          </Field>
        </div>
        {previewError && (
          <div className="warning-banner">
            <AlertTriangle size={16} /> {previewError}
          </div>
        )}
        {!previewError && !preview && <Loading />}
        {preview && (
          <div className={'calc-result ' + (previewing ? 'refreshing' : '')}>
            <div className="calc-summary">
              <div>
                <span>صافي ربح المجموعة</span>
                <strong className={'num ' + (preview.netProfit < 0 ? 'negative' : '')}>
                  {money(preview.netProfit, 2)} <small>ج.م</small>
                </strong>
              </div>
              <div>
                <span>الاحتياطي</span>
                <strong className="num">
                  {money(preview.reserve, 2)} <small>ج.م</small>
                </strong>
              </div>
              <div className="calc-distributable">
                <span>القابل للتوزيع</span>
                <strong className="num">
                  {money(preview.distributable, 2)} <small>ج.م</small>
                </strong>
              </div>
              <div>
                <span>السيولة المتاحة الآن</span>
                <strong className="num">
                  {money(preview.cashAvailable, 2)} <small>ج.م</small>
                </strong>
              </div>
            </div>
            {preview.overlap && (
              <div className="warning-banner">
                <AlertTriangle size={16} /> هذه الفترة تتداخل مع التوزيع{' '}
                <b className="num">{preview.overlap.number}</b>. اختر فترة لا تتداخل معه، أو ألغِه
                أولاً.
              </div>
            )}
            {preview.distributable <= 0 && (
              <div className="info-banner">
                <Scale size={18} />
                <span>
                  {preview.netProfit < 0
                    ? `المجموعة متكبدة خسارة صافية قدرها ${money(-preview.netProfit, 2)} ج.م في هذه الفترة، والخسائر تُخصم قبل أي توزيع، فلا توجد أرباح تُوزَّع الآن.`
                    : 'لا توجد أرباح قابلة للتوزيع في هذه الفترة بعد احتجاز الاحتياطي.'}
                </span>
              </div>
            )}
            {preview.uncovered > 0 && (
              <div className="warning-banner">
                <AlertTriangle size={16} /> القابل للتوزيع يتجاوز السيولة الحالية بمقدار{' '}
                <b className="num">{money(preview.uncovered, 2)}</b> ج.م. الأرباح موجودة في المبيعات
                غير المحصّلة أو المخزون؛ ستُصرف عند تحصيلها، ولا يُصرف أكثر من السيولة.
              </div>
            )}
            {preview.shareTotal !== 10000 && (
              <div className="warning-banner">
                <AlertTriangle size={16} /> نسب الملاك النشطين لا تساوي ١٠٠٪ (
                {(preview.shareTotal / 100).toFixed(2)}٪). عدّلها من تبويب الملاك والشركاء.
              </div>
            )}
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>الفرع</th>
                    <th>المبيعات</th>
                    <th>تكلفة البضاعة</th>
                    <th>المصروفات (مباشرة ومشتركة)</th>
                    <th>صافي الفرع</th>
                    <th>نصيبه من الربح</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.branches.map((b) => (
                    <tr key={b.branch_id}>
                      <td>
                        <strong>{b.name}</strong>
                        <small className="cell-sub num">{b.code}</small>
                      </td>
                      <td className="num">{money(b.sales, 2)}</td>
                      <td className="num">{money(b.cost, 2)}</td>
                      <td className="num">{money(b.expenses, 2)}</td>
                      <td className={'num ' + (b.net < 0 ? 'negative' : 'positive')}>
                        {money(b.net, 2)}
                      </td>
                      <td className="num muted">
                        {preview.netProfit
                          ? ((b.net / preview.netProfit) * 100).toFixed(1) + '٪'
                          : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="owner-split">
              {preview.lines.map((l) => (
                <div key={l.owner_id}>
                  <span>
                    {l.owner_name}{' '}
                    <small className="muted">({(l.share_bps / 100).toFixed(2)}٪)</small>
                  </span>
                  <strong className="num">{money(l.amount, 2)} ج.م</strong>
                </div>
              ))}
            </div>
            <div className="modal-footer">
              <Button onClick={createDraft} busy={busy} disabled={!canCreate || !isGroup}>
                <Plus size={16} /> إنشاء مسودة توزيع
              </Button>
              {!isGroup && (
                <span className="muted">
                  اختر «كل الفروع» من الشريط الجانبي لإنشاء توزيع للمجموعة.
                </span>
              )}
            </div>
          </div>
        )}
      </section>
      <section className="card">
        <div className="table-toolbar">
          <h2>
            <HandCoins size={18} /> التوزيعات السابقة
          </h2>
          <span className="count-chip num">{list.data?.length ?? 0} توزيع</span>
        </div>
        {list.error ? (
          <ErrorState message={list.error} retry={list.reload} />
        ) : !list.data ? (
          <Loading />
        ) : !list.data.length ? (
          <Empty
            title="لا توجد توزيعات بعد"
            description="احسب الأرباح لفترة مغلقة، ثم أنشئ مسودة وراجعها قبل الاعتماد."
          />
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>الرقم</th>
                  <th>الفترة</th>
                  <th>الحالة</th>
                  <th>القابل للتوزيع</th>
                  <th>المصروف</th>
                </tr>
              </thead>
              <tbody>
                {list.data.map((d) => (
                  <tr key={d.id} className="clickable-row" onClick={() => setViewing(d.id)}>
                    <td className="num">
                      <strong>{d.number}</strong>
                    </td>
                    <td className="muted">
                      {formatDate(d.period_from, true)} — {formatDate(d.period_to, true)}
                    </td>
                    <td>
                      <span className={'badge ' + statusLabels[d.status].cls}>
                        <i /> {statusLabels[d.status].label}
                      </span>
                    </td>
                    <td className="num amount">
                      {money(d.distributable, 2)} <small>ج.م</small>
                    </td>
                    <td className="num">
                      {money(d.paid_total, 2)} <small>ج.م</small>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {viewing && (
        <DistributionDetail
          id={viewing}
          onClose={() => setViewing(null)}
          onChanged={() => list.reload()}
        />
      )}
    </>
  );
}

function DistributionDetail({
  id,
  onClose,
  onChanged,
}: {
  id: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const data = useData<Distribution>('/distributions/' + id);
  const [paying, setPaying] = useState<{ line: NonNullable<Distribution['lines']>[number] } | null>(
    null,
  );
  const { busy, act } = useAction();
  if (data.error)
    return (
      <Modal title="التوزيع" onClose={onClose}>
        <ErrorState message={data.error} retry={data.reload} />
      </Modal>
    );
  if (!data.data)
    return (
      <Modal title="التوزيع" onClose={onClose}>
        <Loading />
      </Modal>
    );
  const d = data.data;
  const lines = d.lines ?? [];
  const paidTotal = lines.reduce((s, l) => s + l.paid, 0);
  const refresh = () => {
    data.reload();
    onChanged();
  };
  return (
    <Modal
      wide
      title={`${d.number} · ${statusLabels[d.status].label}`}
      description={`${formatDate(d.period_from)} — ${formatDate(d.period_to)} · احتياطي ${(d.reserve_bps / 100).toFixed(2)}٪`}
      onClose={onClose}
    >
      <div className="modal-body">
        <div className="calc-summary compact">
          <div>
            <span>صافي الربح</span>
            <strong className="num">{money(d.net_profit, 2)} ج.م</strong>
          </div>
          <div>
            <span>الاحتياطي</span>
            <strong className="num">{money(d.reserve_amount, 2)} ج.م</strong>
          </div>
          <div className="calc-distributable">
            <span>القابل للتوزيع</span>
            <strong className="num">{money(d.distributable, 2)} ج.م</strong>
          </div>
          <div>
            <span>المصروف حتى الآن</span>
            <strong className="num">{money(paidTotal, 2)} ج.م</strong>
          </div>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>الشريك</th>
                <th>النسبة</th>
                <th>المستحق</th>
                <th>المدفوع</th>
                <th>المتبقي</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.id}>
                  <td>
                    <strong>{l.owner_name}</strong>
                  </td>
                  <td className="num">{(l.share_bps / 100).toFixed(2)}٪</td>
                  <td className="num">{money(l.amount, 2)}</td>
                  <td className="num">{money(l.paid, 2)}</td>
                  <td className="num amount">{money(l.amount - l.paid, 2)}</td>
                  <td>
                    {d.status === 'APPROVED' && l.amount - l.paid > 0 && (
                      <Button variant="secondary" onClick={() => setPaying({ line: l })}>
                        صرف
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!!d.payments?.length && (
          <>
            <h3 className="ledger-title">الصرفيات المسجلة</h3>
            <table>
              <thead>
                <tr>
                  <th>الشريك</th>
                  <th>التاريخ</th>
                  <th>الطريقة</th>
                  <th>المبلغ</th>
                  <th>المرجع</th>
                </tr>
              </thead>
              <tbody>
                {d.payments.map((p) => (
                  <tr key={p.id}>
                    <td>{p.owner_name}</td>
                    <td className="muted">{formatDate(p.date, true)}</td>
                    <td>{methods[p.method]}</td>
                    <td className="num negative">−{money(p.amount, 2)} ج.م</td>
                    <td className="muted">{p.reference || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
        {!!d.breakdown?.length && (
          <>
            <h3 className="ledger-title">مكوّنات الربح حسب الفرع (لقطة وقت الإنشاء)</h3>
            <table>
              <thead>
                <tr>
                  <th>الفرع</th>
                  <th>المبيعات</th>
                  <th>المصروفات</th>
                  <th>صافي الفرع</th>
                </tr>
              </thead>
              <tbody>
                {d.breakdown.map((b) => (
                  <tr key={b.branch_id}>
                    <td>{b.name}</td>
                    <td className="num">{money(b.sales, 2)}</td>
                    <td className="num">{money(b.expenses, 2)}</td>
                    <td className={'num ' + (b.net < 0 ? 'negative' : '')}>{money(b.net, 2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
      <div className="modal-footer">
        {d.status === 'DRAFT' && (
          <>
            <Button
              busy={busy}
              onClick={() =>
                void act(async () => {
                  await api(`/distributions/${d.id}/approve`, 'POST', {});
                  refresh();
                }, 'تم اعتماد التوزيع. صار جاهزاً للصرف')
              }
            >
              اعتماد التوزيع
            </Button>
            <Button
              variant="danger"
              busy={busy}
              onClick={() =>
                void act(async () => {
                  await api(`/distributions/${d.id}/cancel`, 'POST', {});
                  refresh();
                }, 'تم إلغاء المسودة')
              }
            >
              إلغاء المسودة
            </Button>
          </>
        )}
        {d.status === 'APPROVED' && paidTotal === 0 && (
          <Button
            variant="danger"
            busy={busy}
            onClick={() =>
              void act(async () => {
                await api(`/distributions/${d.id}/cancel`, 'POST', {});
                refresh();
              }, 'تم إلغاء التوزيع المعتمد')
            }
          >
            إلغاء التوزيع
          </Button>
        )}
        <Button variant="ghost" onClick={onClose}>
          إغلاق
        </Button>
      </div>
      {paying && (
        <PayForm
          distributionId={d.id}
          line={paying.line}
          onClose={() => setPaying(null)}
          onPaid={() => {
            setPaying(null);
            refresh();
          }}
        />
      )}
    </Modal>
  );
}

function PayForm({
  distributionId,
  line,
  onClose,
  onPaid,
}: {
  distributionId: string;
  line: { id: string; owner_name: string; amount: number; paid: number };
  onClose: () => void;
  onPaid: () => void;
}) {
  const { busy, act } = useAction();
  const accountsData = useData<CashAccount[]>('/cash-accounts');
  // One key per form instance: a retried submit cannot pay the partner twice.
  const [requestKey] = useState(() => crypto.randomUUID());
  const remaining = line.amount - line.paid;
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const accId = f.get('account_id') ? String(f.get('account_id')) : undefined;
    void act(async () => {
      await api(
        `/distributions/${distributionId}/payments`,
        'POST',
        {
          line_id: line.id,
          amount: toCents(f.get('amount')),
          method: f.get('method'),
          date: f.get('date'),
          reference: f.get('reference'),
          account_id: accId,
        },
        requestKey,
      );
      onPaid();
    }, 'تم تسجيل الصرف');
  };
  return (
    <Modal
      title={`صرف لـ ${line.owner_name}`}
      description={`المتبقي ${piastresToEgp(remaining)} ج.م. لا يُصرف أكثر من السيولة المتاحة.`}
      onClose={onClose}
    >
      <form onSubmit={submit}>
        <div className="modal-body form-grid">
          <Field label="المبلغ (ج.م) *">
            <input
              name="amount"
              required
              type="number"
              min="0.01"
              max={remaining / 100}
              step="0.01"
              dir="ltr"
              defaultValue={remaining / 100}
            />
          </Field>
          <div className="form-row">
            <Field label="طريقة الصرف *">
              <select name="method" defaultValue="BANK">
                {Object.entries(methods).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="التاريخ *">
              <input type="date" name="date" required defaultValue={today()} />
            </Field>
          </div>
          <Field
            label="الحساب المالي / الخزينة"
            hint="الخزينة أو الحساب البنكي الذي يُصرف منه المبلغ (اختياري، يحدّد تلقائياً حسب الطريقة)"
          >
            <select name="account_id" defaultValue="">
              <option value="">تلقائي حسب طريقة الصرف</option>
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
          <Field label="المرجع">
            <input name="reference" maxLength={200} placeholder="رقم التحويل أو الإيصال" />
          </Field>
        </div>
        <div className="modal-footer">
          <Button busy={busy} type="submit">
            <Wallet size={16} /> تأكيد الصرف
          </Button>
          <Button type="button" variant="secondary" onClick={onClose}>
            إلغاء
          </Button>
        </div>
      </form>
    </Modal>
  );
}
