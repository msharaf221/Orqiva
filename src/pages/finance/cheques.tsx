import { useState, type FormEvent } from 'react';
import {
  Plus,
  CheckCircle2,
  XCircle,
  Building2,
  Calendar,
  AlertCircle,
  ArrowDownLeft,
  ArrowUpRight,
} from 'lucide-react';
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
import type { Cheque, ChequeType, ChequeStatus, CashAccount, Party } from '../../types';

export function CreateChequeModal({
  parties,
  onClose,
  onSaved,
}: {
  parties: Party[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { busy, act } = useAction();
  const [type, setType] = useState<ChequeType>('RECEIVABLE');

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const payload = {
      number: String(f.get('number')).trim(),
      type,
      party_id: String(f.get('party_id')),
      bank_name: String(f.get('bank_name')).trim(),
      branch_name: String(f.get('branch_name') || '').trim() || undefined,
      amount: toCents(f.get('amount')),
      issue_date: String(f.get('issue_date') || today()),
      due_date: String(f.get('due_date')),
      notes: String(f.get('notes') || '').trim() || undefined,
    };

    void act(
      async () => {
        await api('/treasury/cheques', 'POST', payload);
        onSaved();
      },
      type === 'RECEIVABLE'
        ? 'تم تسجيل ورقة القبض وإثباتها دفترياً'
        : 'تم تسجيل ورقة الدفع وإثباتها دفترياً',
    );
  };

  const filteredParties = parties.filter((p) =>
    type === 'RECEIVABLE' ? p.type === 'CUSTOMER' : p.type === 'SUPPLIER',
  );

  return (
    <Modal
      size="lg"
      showMaximize
      title={type === 'RECEIVABLE' ? 'تسجيل شيك وارد (ورقة قبض)' : 'تحرير شيك صادر (ورقة دفع)'}
      description="إثبات الشيك في محفظة الأوراق المالية مع توليد القيد المحاسبي المزدوج آلياً."
      onClose={onClose}
    >
      <form onSubmit={submit}>
        <div className="modal-body form-grid">
          <div className="grid two" style={{ marginBottom: '12px' }}>
            <Field label="نوع الشيك">
              <select value={type} onChange={(e) => setType(e.target.value as ChequeType)} required>
                <option value="RECEIVABLE">ورقة قبض (مستلم من عميل)</option>
                <option value="PAYABLE">ورقة دفع (صادر لمورد)</option>
              </select>
            </Field>
            <Field label="رقم الشيك">
              <input name="number" placeholder="مثال: CHQ-98120" required autoFocus />
            </Field>
          </div>

          <div className="grid two" style={{ marginBottom: '12px' }}>
            <Field label={type === 'RECEIVABLE' ? 'العميل' : 'المورد'}>
              <select name="party_id" required>
                <option value="">اختر جهة التعامل...</option>
                {filteredParties.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} {p.phone ? `(${p.phone})` : ''}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="المبلغ (ج.م)">
              <input
                name="amount"
                type="number"
                step="0.01"
                min="0.01"
                placeholder="0.00"
                required
              />
            </Field>
          </div>

          <div className="grid two" style={{ marginBottom: '12px' }}>
            <Field label="البنك المسحوب عليه">
              <input name="bank_name" placeholder="مثال: البنك الأهلي المصري" required />
            </Field>
            <Field label="فرع البنك">
              <input name="branch_name" placeholder="مثال: فرع مدينة نصر" />
            </Field>
          </div>

          <div className="grid two" style={{ marginBottom: '12px' }}>
            <Field label="تاريخ التحرير">
              <input name="issue_date" type="date" defaultValue={today()} required />
            </Field>
            <Field label="تاريخ الاستحقاق">
              <input name="due_date" type="date" defaultValue={today()} required />
            </Field>
          </div>

          <Field label="ملاحظات">
            <textarea name="notes" rows={2} placeholder="أي بيانات إضافية أو رقم الحساب..." />
          </Field>
        </div>

        <div className="modal-footer">
          <Button variant="secondary" type="button" onClick={onClose}>
            إلغاء
          </Button>
          <Button type="submit" busy={busy}>
            حفظ الشيك والمحفظة
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function CollectChequeModal({
  cheque,
  accounts,
  onClose,
  onSaved,
}: {
  cheque: Cheque;
  accounts: CashAccount[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { busy, act } = useAction();
  const bankAccounts = accounts.filter((a) => a.type === 'BANK');

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const payload = {
      bank_account_id: String(f.get('bank_account_id')),
      collection_date: String(f.get('collection_date') || today()),
    };

    void act(async () => {
      await api(`/treasury/cheques/${cheque.id}/collect`, 'POST', payload);
      onSaved();
    }, 'تم تحصيل الشيك وإيداعه في الحساب البنكي وترحيل القيد');
  };

  return (
    <Modal
      size="md"
      showMaximize
      title={`تحصيل الشيك #${cheque.number}`}
      description={`إيداع مبلغ ${money(cheque.amount)} ج.م في الحساب البنكي وتسوية أوراق القبض.`}
      onClose={onClose}
    >
      <form onSubmit={submit}>
        <div className="modal-body form-grid">
          <Field label="الحساب البنكي المستلم">
            <select name="bank_account_id" required defaultValue={bankAccounts[0]?.id || ''}>
              <option value="">اختر الحساب البنكي...</option>
              {bankAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({money(a.balance)} ج.م)
                </option>
              ))}
            </select>
          </Field>

          <Field label="تاريخ التحصيل الفعلي">
            <input name="collection_date" type="date" defaultValue={today()} required />
          </Field>
        </div>

        <div className="modal-footer">
          <Button variant="secondary" type="button" onClick={onClose}>
            إلغاء
          </Button>
          <Button type="submit" busy={busy}>
            تأكيد التحصيل والإيداع
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function PayChequeModal({
  cheque,
  accounts,
  onClose,
  onSaved,
}: {
  cheque: Cheque;
  accounts: CashAccount[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { busy, act } = useAction();
  const bankAccounts = accounts.filter((a) => a.type === 'BANK');

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const payload = {
      bank_account_id: String(f.get('bank_account_id')),
      payment_date: String(f.get('payment_date') || today()),
    };

    void act(async () => {
      await api(`/treasury/cheques/${cheque.id}/pay`, 'POST', payload);
      onSaved();
    }, 'تم صرف الشيك من الحساب البنكي وتسوية أوراق الدفع');
  };

  return (
    <Modal
      size="md"
      showMaximize
      title={`صرف الشيك #${cheque.number}`}
      description={`خصم مبلغ ${money(cheque.amount)} ج.م من الحساب البنكي وتسوية أوراق الدفع.`}
      onClose={onClose}
    >
      <form onSubmit={submit}>
        <div className="modal-body form-grid">
          <Field label="الحساب البنكي المسحوب منه">
            <select name="bank_account_id" required defaultValue={bankAccounts[0]?.id || ''}>
              <option value="">اختر الحساب البنكي...</option>
              {bankAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({money(a.balance)} ج.م)
                </option>
              ))}
            </select>
          </Field>

          <Field label="تاريخ الصرف الفعلي">
            <input name="payment_date" type="date" defaultValue={today()} required />
          </Field>
        </div>

        <div className="modal-footer">
          <Button variant="secondary" type="button" onClick={onClose}>
            إلغاء
          </Button>
          <Button type="submit" busy={busy}>
            تأكيد الصرف البنكي
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function BounceChequeModal({
  cheque,
  onClose,
  onSaved,
}: {
  cheque: Cheque;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { busy, act } = useAction();

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const payload = {
      reason: String(f.get('reason') || 'شيك بدون رصيد كافٍ'),
    };

    void act(async () => {
      await api(`/treasury/cheques/${cheque.id}/bounce`, 'POST', payload);
      onSaved();
    }, 'تم إثبات ارتداد الشيك وإعادة فتح مديونية العميل دفترياً');
  };

  return (
    <Modal
      size="md"
      showMaximize
      title={`إثبات ارتداد الشيك #${cheque.number}`}
      description={`سيتم إلغاء أثر ورقة القبض وإعادة إثبات مديونية ${money(cheque.amount)} ج.م على حساب العميل.`}
      onClose={onClose}
    >
      <form onSubmit={submit}>
        <div className="modal-body form-grid">
          <Field label="سبب الارتداد من البنك">
            <input
              name="reason"
              defaultValue="شيك بدون رصيد كافٍ / توقيع غير مطابق"
              required
              autoFocus
            />
          </Field>
        </div>

        <div className="modal-footer">
          <Button variant="secondary" type="button" onClick={onClose}>
            إلغاء
          </Button>
          <Button variant="danger" type="submit" busy={busy}>
            تأكيد ارتداد الشيك
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function ChequesView({ accounts, parties }: { accounts: CashAccount[]; parties: Party[] }) {
  const chequesData = useData<Cheque[]>('/treasury/cheques');
  const [typeFilter, setTypeFilter] = useState<'ALL' | ChequeType>('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | ChequeStatus>('ALL');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);

  const [addingCheque, setAddingCheque] = useState(false);
  const [collectingCheque, setCollectingCheque] = useState<Cheque | null>(null);
  const [payingCheque, setPayingCheque] = useState<Cheque | null>(null);
  const [bouncingCheque, setBouncingCheque] = useState<Cheque | null>(null);

  const cheques = chequesData.data || [];

  const filteredCheques = cheques.filter((c) => {
    if (typeFilter !== 'ALL' && c.type !== typeFilter) return false;
    if (statusFilter !== 'ALL' && c.status !== statusFilter) return false;
    if (query) {
      const q = query.toLowerCase();
      const match =
        c.number.toLowerCase().includes(q) ||
        (c.party_name || '').toLowerCase().includes(q) ||
        c.bank_name.toLowerCase().includes(q) ||
        (c.notes || '').toLowerCase().includes(q);
      if (!match) return false;
    }
    return true;
  });

  const receivableInPortfolio = cheques
    .filter((c) => c.type === 'RECEIVABLE' && c.status === 'PORTFOLIO')
    .reduce((s, c) => s + c.amount, 0);

  const payableInPortfolio = cheques
    .filter((c) => c.type === 'PAYABLE' && c.status === 'PORTFOLIO')
    .reduce((s, c) => s + c.amount, 0);

  const bouncedCount = cheques.filter((c) => c.status === 'BOUNCED').length;

  const statusLabel = (s: ChequeStatus) => {
    switch (s) {
      case 'PORTFOLIO':
        return { text: 'في المحفظة', cls: 'badge amber' };
      case 'COLLECTED':
        return { text: 'تم التحصيل بالبنك', cls: 'badge green' };
      case 'PAID':
        return { text: 'تم الصرف', cls: 'badge green' };
      case 'BOUNCED':
        return { text: 'مرتد / مرفوض', cls: 'badge red' };
      case 'CANCELLED':
        return { text: 'ملغي', cls: 'badge gray' };
      default:
        return { text: s, cls: 'badge' };
    }
  };

  return (
    <div>
      <div className="stats-grid three" style={{ marginBottom: '16px' }}>
        <Stat
          label="أوراق قبض بالدرج والمحفظة"
          value={money(receivableInPortfolio)}
          icon={<ArrowDownLeft size={20} />}
          tone="green"
          foot={`${cheques.filter((c) => c.type === 'RECEIVABLE' && c.status === 'PORTFOLIO').length} شيكات مستحقة التحصيل`}
        />
        <Stat
          label="أوراق دفع مستحقة الصرف"
          value={money(payableInPortfolio)}
          icon={<ArrowUpRight size={20} />}
          tone="amber"
          foot={`${cheques.filter((c) => c.type === 'PAYABLE' && c.status === 'PORTFOLIO').length} شيكات صادرة للموردين`}
        />
        <Stat
          label="شيكات مرتدة تحتاج متابعة"
          value={String(bouncedCount)}
          icon={<AlertCircle size={20} />}
          tone={bouncedCount > 0 ? 'red' : 'blue'}
          foot="شيكات بدون رصيد كافٍ أو معادة"
        />
      </div>

      <div className="table-toolbar" style={{ marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
        <div className="tabs" style={{ margin: 0 }}>
          <button
            className={typeFilter === 'ALL' ? 'active' : ''}
            onClick={() => {
              setTypeFilter('ALL');
              setPage(1);
            }}
          >
            الكل ({cheques.length})
          </button>
          <button
            className={typeFilter === 'RECEIVABLE' ? 'active' : ''}
            onClick={() => {
              setTypeFilter('RECEIVABLE');
              setPage(1);
            }}
          >
            أوراق قبض (عملاء)
          </button>
          <button
            className={typeFilter === 'PAYABLE' ? 'active' : ''}
            onClick={() => {
              setTypeFilter('PAYABLE');
              setPage(1);
            }}
          >
            أوراق دفع (موردين)
          </button>
        </div>

        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value as any);
              setPage(1);
            }}
            style={{ padding: '6px 10px', fontSize: '13px' }}
          >
            <option value="ALL">جميع الحالات</option>
            <option value="PORTFOLIO">في المحفظة</option>
            <option value="COLLECTED">تم التحصيل</option>
            <option value="PAID">تم الصرف</option>
            <option value="BOUNCED">مرتد</option>
          </select>

          <SearchBox
            value={query}
            onChange={(q) => {
              setQuery(q);
              setPage(1);
            }}
            placeholder="بحث برقم الشيك أو الطرف أو البنك..."
          />

          <Button onClick={() => setAddingCheque(true)}>
            <Plus size={16} /> تسجيل شيك
          </Button>
        </div>
      </div>

      {chequesData.loading && <Loading />}
      {chequesData.error && (
        <ErrorState message="تعذر تحميل محفظة الشيكات" retry={chequesData.reload} />
      )}
      {!chequesData.loading && !chequesData.error && filteredCheques.length === 0 && (
        <Empty
          title="لا توجد شيكات مطابقة"
          description="لم يتم العثور على أي شيكات في المحفظة وفقاً لمعايير البحث الحالية."
        />
      )}

      {!chequesData.loading && !chequesData.error && filteredCheques.length > 0 && (
        <div className="table-responsive">
          <table className="table">
            <thead>
              <tr>
                <th>رقم الشيك</th>
                <th>النوع</th>
                <th>جهة التعامل</th>
                <th>البنك والفرع</th>
                <th>المبلغ</th>
                <th>تاريخ الاستحقاق</th>
                <th>الحالة</th>
                <th>الإجراءات</th>
              </tr>
            </thead>
            <tbody>
              {filteredCheques.slice((page - 1) * 10, page * 10).map((c) => {
                const badge = statusLabel(c.status);
                return (
                  <tr key={c.id}>
                    <td>
                      <strong style={{ fontFamily: 'monospace' }}>#{c.number}</strong>
                    </td>
                    <td>
                      <span className={c.type === 'RECEIVABLE' ? 'badge blue' : 'badge purple'}>
                        {c.type === 'RECEIVABLE' ? 'قبض (وارد)' : 'دفع (صادر)'}
                      </span>
                    </td>
                    <td>
                      <div>{c.party_name || '—'}</div>
                    </td>
                    <td>
                      <div style={{ fontSize: '13px' }}>
                        <Building2
                          size={13}
                          style={{ verticalAlign: 'middle', marginLeft: '4px' }}
                        />
                        {c.bank_name} {c.branch_name ? `(${c.branch_name})` : ''}
                      </div>
                    </td>
                    <td>
                      <strong style={{ fontSize: '13.5px' }}>{money(c.amount)}</strong>{' '}
                      <small>ج.م</small>
                    </td>
                    <td>
                      <div style={{ fontSize: '12.5px' }}>
                        <Calendar
                          size={13}
                          style={{ verticalAlign: 'middle', marginLeft: '4px' }}
                        />
                        {c.due_date}
                      </div>
                    </td>
                    <td>
                      <span className={badge.cls}>{badge.text}</span>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: '6px' }}>
                        {c.type === 'RECEIVABLE' && c.status === 'PORTFOLIO' && (
                          <>
                            <Button
                              style={{ padding: '3px 8px', fontSize: '11.5px' }}
                              onClick={() => setCollectingCheque(c)}
                            >
                              <CheckCircle2 size={13} /> تحصيل
                            </Button>
                            <Button
                              variant="danger"
                              style={{ padding: '3px 8px', fontSize: '11.5px' }}
                              onClick={() => setBouncingCheque(c)}
                            >
                              <XCircle size={13} /> ارتداد
                            </Button>
                          </>
                        )}
                        {c.type === 'PAYABLE' && c.status === 'PORTFOLIO' && (
                          <Button
                            style={{ padding: '3px 8px', fontSize: '11.5px' }}
                            onClick={() => setPayingCheque(c)}
                          >
                            <CheckCircle2 size={13} /> صرف
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <Pagination page={page} setPage={setPage} total={filteredCheques.length} size={10} />
        </div>
      )}

      {addingCheque && (
        <CreateChequeModal
          parties={parties}
          onClose={() => setAddingCheque(false)}
          onSaved={() => {
            setAddingCheque(false);
            chequesData.reload();
          }}
        />
      )}

      {collectingCheque && (
        <CollectChequeModal
          cheque={collectingCheque}
          accounts={accounts}
          onClose={() => setCollectingCheque(null)}
          onSaved={() => {
            setCollectingCheque(null);
            chequesData.reload();
          }}
        />
      )}

      {payingCheque && (
        <PayChequeModal
          cheque={payingCheque}
          accounts={accounts}
          onClose={() => setPayingCheque(null)}
          onSaved={() => {
            setPayingCheque(null);
            chequesData.reload();
          }}
        />
      )}

      {bouncingCheque && (
        <BounceChequeModal
          cheque={bouncingCheque}
          onClose={() => setBouncingCheque(null)}
          onSaved={() => {
            setBouncingCheque(null);
            chequesData.reload();
          }}
        />
      )}
    </div>
  );
}
