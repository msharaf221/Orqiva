import { useState, type FormEvent } from 'react';
import {
  TrendingUp,
  TrendingDown,
  Building2,
  Plus,
  ArrowDownLeft,
  ArrowUpRight,
  Layers,
} from 'lucide-react';
import {
  api,
  useData,
  useAction,
  Button,
  Field,
  Modal,
  Loading,
  ErrorState,
  Empty,
  Stat,
  money,
  toCents,
  today,
} from '../../lib';
import type { CashAccount } from '../../types';

interface CashFlowForecast {
  currentCashBalance: number;
  forecastDays: number;
  projectedInflows: number;
  projectedOutflows: number;
  projectedNetChange: number;
  projectedEndingBalance: number;
  details: {
    receivableInvoices: Array<{
      id: string;
      number: string;
      party_name: string;
      due_date: string;
      amount_due: number;
    }>;
    receivableCheques: Array<{
      id: string;
      number: string;
      party_name: string;
      due_date: string;
      amount: number;
    }>;
    payableBills: Array<{
      id: string;
      number: string;
      party_name: string;
      due_date: string;
      amount_due: number;
    }>;
    payableCheques: Array<{
      id: string;
      number: string;
      party_name: string;
      due_date: string;
      amount: number;
    }>;
    purchaseOrders: Array<{
      id: string;
      number: string;
      party_name: string;
      expected_delivery_date: string;
      total: number;
    }>;
  };
}

interface BankStatement {
  id: string;
  cash_account_id: string;
  statement_date: string;
  opening_balance: number;
  closing_balance: number;
  status: 'DRAFT' | 'RECONCILED';
  notes?: string | null;
  created_at: string;
  lines_count: number;
  matched_lines_count: number;
}

export function CreateBankStatementModal({
  accounts,
  onClose,
  onSaved,
}: {
  accounts: CashAccount[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { busy, act } = useAction();
  const bankAccounts = accounts.filter((a) => a.type === 'BANK');
  const [lines, setLines] = useState<
    Array<{ date: string; description: string; reference: string; amount: number }>
  >([{ date: today(), description: '', reference: '', amount: 0 }]);

  const addLine = () => {
    setLines([...lines, { date: today(), description: '', reference: '', amount: 0 }]);
  };

  const removeLine = (idx: number) => {
    if (lines.length > 1) {
      setLines(lines.filter((_, i) => i !== idx));
    }
  };

  const updateLine = (idx: number, field: string, val: any) => {
    const updated = [...lines];
    updated[idx] = { ...updated[idx], [field]: val };
    setLines(updated);
  };

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const validLines = lines
      .filter((l) => l.description.trim() && l.amount !== 0)
      .map((l) => ({
        date: l.date,
        description: l.description.trim(),
        reference: l.reference.trim() || undefined,
        amount: Math.round(l.amount * 100),
      }));

    if (validLines.length === 0) {
      alert('يرجى إدخال سطر واحد على الأقل بمبلغ ووصف صحيحين في كشف الحساب');
      return;
    }

    const payload = {
      cash_account_id: String(f.get('cash_account_id')),
      statement_date: String(f.get('statement_date')),
      opening_balance: toCents(f.get('opening_balance')),
      closing_balance: toCents(f.get('closing_balance')),
      notes: String(f.get('notes') || '').trim() || undefined,
      lines: validLines,
    };

    void act(async () => {
      await api('/treasury/bank-statements', 'POST', payload);
      onSaved();
    }, 'تم تسجيل كشف الحساب البنكي بنجاح لبدء المطابقة');
  };

  return (
    <Modal
      wide
      title="تسجيل كشف حساب بنكي للمطابقة والتسوية"
      description="أدخل سطور كشف الحساب البنكي الوارد من البنك لمطابقتها مع المقبوضات والمدفوعات."
      onClose={onClose}
    >
      <form onSubmit={submit}>
        <div className="grid three" style={{ marginBottom: '12px' }}>
          <Field label="الحساب البنكي">
            <select name="cash_account_id" required defaultValue={bankAccounts[0]?.id || ''}>
              <option value="">اختر الحساب...</option>
              {bankAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({money(a.balance)} ج.م)
                </option>
              ))}
            </select>
          </Field>
          <Field label="تاريخ كشف الحساب">
            <input name="statement_date" type="date" defaultValue={today()} required />
          </Field>
          <Field label="ملاحظات">
            <input name="notes" placeholder="كشف حساب شهر أكتوبر..." />
          </Field>
        </div>

        <div className="grid two" style={{ marginBottom: '16px' }}>
          <Field label="الرصيد الافتتاحي (ج.م)">
            <input name="opening_balance" type="number" step="0.01" defaultValue="0" required />
          </Field>
          <Field label="الرصيد الختامي (ج.م)">
            <input name="closing_balance" type="number" step="0.01" defaultValue="0" required />
          </Field>
        </div>

        <div style={{ marginBottom: '16px' }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '8px',
            }}
          >
            <h4 style={{ margin: 0, fontSize: '14px', fontWeight: 700 }}>
              سطور وحركات كشف الحساب البنكي
            </h4>
            <Button
              type="button"
              variant="secondary"
              style={{ padding: '3px 8px', fontSize: '12px' }}
              onClick={addLine}
            >
              <Plus size={14} /> إضافة سطر
            </Button>
          </div>

          <table className="table" style={{ fontSize: '13px' }}>
            <thead>
              <tr>
                <th style={{ width: '130px' }}>التاريخ</th>
                <th>البيان / الوصف</th>
                <th style={{ width: '150px' }}>الرقم المرجعي</th>
                <th style={{ width: '140px' }}>المبلغ (+ إيداع / - سحب)</th>
                <th style={{ width: '50px' }}></th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, idx) => (
                <tr key={idx}>
                  <td>
                    <input
                      type="date"
                      value={l.date}
                      onChange={(e) => updateLine(idx, 'date', e.target.value)}
                      required
                    />
                  </td>
                  <td>
                    <input
                      value={l.description}
                      onChange={(e) => updateLine(idx, 'description', e.target.value)}
                      placeholder="تحويل وارد، سداد شيك..."
                      required
                    />
                  </td>
                  <td>
                    <input
                      value={l.reference}
                      onChange={(e) => updateLine(idx, 'reference', e.target.value)}
                      placeholder="REF-..."
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      step="0.01"
                      value={l.amount || ''}
                      onChange={(e) => updateLine(idx, 'amount', parseFloat(e.target.value) || 0)}
                      placeholder="0.00"
                      required
                    />
                  </td>
                  <td>
                    {lines.length > 1 && (
                      <button
                        type="button"
                        className="icon-btn"
                        style={{ color: '#ef4444' }}
                        onClick={() => removeLine(idx)}
                      >
                        ✕
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="modal-footer">
          <Button variant="secondary" type="button" onClick={onClose}>
            إلغاء
          </Button>
          <Button type="submit" busy={busy}>
            حفظ كشف الحساب
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function ReconciliationView({ accounts }: { accounts: CashAccount[] }) {
  const [forecastDays, setForecastDays] = useState(30);
  const forecastData = useData<CashFlowForecast>(
    `/treasury/cash-flow-forecast?days=${forecastDays}`,
  );
  const statementsData = useData<BankStatement[]>('/treasury/bank-statements');
  const [addingStatement, setAddingStatement] = useState(false);

  const forecast = forecastData.data;
  const statements = statementsData.data || [];

  return (
    <div>
      {/* Forecast Section */}
      <div style={{ marginBottom: '24px' }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '12px',
          }}
        >
          <div>
            <h3 style={{ margin: '0 0 4px', fontSize: '17px', fontWeight: 700 }}>
              التوقع المالي والسيولة النقدية القادمة (Cash Flow Forecast)
            </h3>
            <p style={{ margin: 0, fontSize: '13px', color: 'var(--muted)' }}>
              حساب السيولة المتوقعة بناءً على الفواتير المفتوحة وأوراق القبض والدفع وأوامر الشراء.
            </p>
          </div>
          <div style={{ display: 'flex', gap: '6px' }}>
            {[30, 60, 90].map((d) => (
              <button
                key={d}
                className={`btn btn-${forecastDays === d ? 'primary' : 'secondary'}`}
                style={{ padding: '4px 10px', fontSize: '12px' }}
                onClick={() => setForecastDays(d)}
              >
                {d} يوماً
              </button>
            ))}
          </div>
        </div>

        {forecastData.loading && <Loading />}
        {forecast && (
          <>
            <div className="stats-grid four" style={{ marginBottom: '16px' }}>
              <Stat
                label="الرصيد النقدي الحالي"
                value={money(forecast.currentCashBalance)}
                icon={<Building2 size={20} />}
                tone={forecast.currentCashBalance >= 0 ? 'blue' : 'red'}
                foot="السيولة المتوفرة بالخزائن والبنوك"
              />
              <Stat
                label={`التدفقات الداخلة (+ ${forecastDays} يوم)`}
                value={`+${money(forecast.projectedInflows)}`}
                icon={<TrendingUp size={20} />}
                tone="green"
                foot="فواتير بيع مستحقة + أوراق قبض"
              />
              <Stat
                label={`التدفقات الخارجة (- ${forecastDays} يوم)`}
                value={`-${money(forecast.projectedOutflows)}`}
                icon={<TrendingDown size={20} />}
                tone="amber"
                foot="فواتير شراء + شيكات دفع + أوامر شراء"
              />
              <Stat
                label="الرصيد المتوقع نهاية الفترة"
                value={money(forecast.projectedEndingBalance)}
                icon={<Layers size={20} />}
                tone={forecast.projectedEndingBalance >= 0 ? 'green' : 'red'}
                foot={`صافي التغير: ${forecast.projectedNetChange >= 0 ? '+' : ''}${money(forecast.projectedNetChange)} ج.م`}
              />
            </div>

            <div className="grid two" style={{ gap: '16px', marginBottom: '16px' }}>
              <div className="card" style={{ padding: '14px' }}>
                <h4
                  style={{
                    margin: '0 0 10px',
                    fontSize: '14px',
                    fontWeight: 700,
                    color: '#16a34a',
                  }}
                >
                  <ArrowDownLeft size={16} style={{ verticalAlign: 'middle', marginLeft: '4px' }} />
                  المقبوضات والتحصيلات المتوقعة (
                  {forecast.details.receivableInvoices.length +
                    forecast.details.receivableCheques.length}
                  )
                </h4>
                <div style={{ maxHeight: '200px', overflowY: 'auto', fontSize: '12.5px' }}>
                  {forecast.details.receivableInvoices.length === 0 &&
                  forecast.details.receivableCheques.length === 0 ? (
                    <div style={{ color: 'var(--muted)', textAlign: 'center', padding: '12px' }}>
                      لا توجد فواتير أو شيكات مستحقة خلال الفترة.
                    </div>
                  ) : (
                    <table className="table">
                      <tbody>
                        {forecast.details.receivableInvoices.map((inv) => (
                          <tr key={inv.id}>
                            <td>
                              <span className="badge blue">فاتورة #{inv.number}</span>
                            </td>
                            <td>{inv.party_name}</td>
                            <td>{inv.due_date}</td>
                            <td>
                              <strong>+{money(inv.amount_due)}</strong> ج.م
                            </td>
                          </tr>
                        ))}
                        {forecast.details.receivableCheques.map((chq) => (
                          <tr key={chq.id}>
                            <td>
                              <span className="badge green">شيك #{chq.number}</span>
                            </td>
                            <td>{chq.party_name}</td>
                            <td>{chq.due_date}</td>
                            <td>
                              <strong>+{money(chq.amount)}</strong> ج.م
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>

              <div className="card" style={{ padding: '14px' }}>
                <h4
                  style={{
                    margin: '0 0 10px',
                    fontSize: '14px',
                    fontWeight: 700,
                    color: '#dc2626',
                  }}
                >
                  <ArrowUpRight size={16} style={{ verticalAlign: 'middle', marginLeft: '4px' }} />
                  المدفوعات والالتزامات المتوقعة (
                  {forecast.details.payableBills.length +
                    forecast.details.payableCheques.length +
                    forecast.details.purchaseOrders.length}
                  )
                </h4>
                <div style={{ maxHeight: '200px', overflowY: 'auto', fontSize: '12.5px' }}>
                  {forecast.details.payableBills.length === 0 &&
                  forecast.details.payableCheques.length === 0 &&
                  forecast.details.purchaseOrders.length === 0 ? (
                    <div style={{ color: 'var(--muted)', textAlign: 'center', padding: '12px' }}>
                      لا توجد مدفوعات أو شيكات مستحقة الصرف خلال الفترة.
                    </div>
                  ) : (
                    <table className="table">
                      <tbody>
                        {forecast.details.payableBills.map((bill) => (
                          <tr key={bill.id}>
                            <td>
                              <span className="badge amber">مشتريات #{bill.number}</span>
                            </td>
                            <td>{bill.party_name}</td>
                            <td>{bill.due_date}</td>
                            <td>
                              <strong>-{money(bill.amount_due)}</strong> ج.م
                            </td>
                          </tr>
                        ))}
                        {forecast.details.payableCheques.map((chq) => (
                          <tr key={chq.id}>
                            <td>
                              <span className="badge purple">شيك صادر #{chq.number}</span>
                            </td>
                            <td>{chq.party_name}</td>
                            <td>{chq.due_date}</td>
                            <td>
                              <strong>-{money(chq.amount)}</strong> ج.م
                            </td>
                          </tr>
                        ))}
                        {forecast.details.purchaseOrders.map((po) => (
                          <tr key={po.id}>
                            <td>
                              <span className="badge gray">أمر توريد #{po.number}</span>
                            </td>
                            <td>{po.party_name}</td>
                            <td>{po.expected_delivery_date}</td>
                            <td>
                              <strong>-{money(po.total)}</strong> ج.م
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Bank Reconciliation Section */}
      <div style={{ marginTop: '24px' }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '12px',
          }}
        >
          <div>
            <h3 style={{ margin: '0 0 4px', fontSize: '17px', fontWeight: 700 }}>
              مطابقة كشوف الحسابات البنكية (Bank Reconciliation)
            </h3>
            <p style={{ margin: 0, fontSize: '13px', color: 'var(--muted)' }}>
              تسوية ومطابقة الحركات البنكية مع قيود وسندات الدفاتر المحاسبية.
            </p>
          </div>
          <Button onClick={() => setAddingStatement(true)}>
            <Plus size={16} /> تسجيل كشف حساب بنكي
          </Button>
        </div>

        {statementsData.loading && <Loading />}
        {statementsData.error && (
          <ErrorState message="تعذر تحميل كشوف الحسابات البنكية" retry={statementsData.reload} />
        )}
        {!statementsData.loading && statements.length === 0 && (
          <Empty
            title="لا توجد كشوف حسابات مسجلة"
            description="قم بإضافة كشف الحساب البنكي لمطابقة المعاملات المسجلة بالدفاتر مع كشف البنك الفعلي."
          />
        )}

        {!statementsData.loading && statements.length > 0 && (
          <div className="table-responsive">
            <table className="table">
              <thead>
                <tr>
                  <th>تاريخ الكشف</th>
                  <th>الحساب البنكي</th>
                  <th>الرصيد الافتتاحي</th>
                  <th>الرصيد الختامي</th>
                  <th>نسبة المطابقة</th>
                  <th>الحالة</th>
                  <th>ملاحظات</th>
                </tr>
              </thead>
              <tbody>
                {statements.map((s) => {
                  const matchPct =
                    s.lines_count > 0
                      ? Math.round((s.matched_lines_count / s.lines_count) * 100)
                      : 100;
                  return (
                    <tr key={s.id}>
                      <td>
                        <strong>{s.statement_date}</strong>
                      </td>
                      <td>
                        <Building2
                          size={13}
                          style={{ verticalAlign: 'middle', marginLeft: '4px' }}
                        />
                        {accounts.find((a) => a.id === s.cash_account_id)?.name || 'حساب بنكي'}
                      </td>
                      <td>{money(s.opening_balance)} ج.م</td>
                      <td>
                        <strong>{money(s.closing_balance)}</strong> ج.م
                      </td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <div
                            style={{
                              width: '60px',
                              height: '8px',
                              background: '#e2e8f0',
                              borderRadius: '4px',
                              overflow: 'hidden',
                            }}
                          >
                            <div
                              style={{
                                width: `${matchPct}%`,
                                height: '100%',
                                background: matchPct === 100 ? '#16a34a' : '#2563eb',
                              }}
                            />
                          </div>
                          <span style={{ fontSize: '11.5px', fontWeight: 600 }}>{matchPct}%</span>
                          <span style={{ fontSize: '11px', color: 'var(--muted)' }}>
                            ({s.matched_lines_count}/{s.lines_count})
                          </span>
                        </div>
                      </td>
                      <td>
                        <span className={matchPct === 100 ? 'badge green' : 'badge amber'}>
                          {matchPct === 100 ? 'مطابق بالكامل' : 'قيد المطابقة'}
                        </span>
                      </td>
                      <td>{s.notes || '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {addingStatement && (
        <CreateBankStatementModal
          accounts={accounts}
          onClose={() => setAddingStatement(false)}
          onSaved={() => {
            setAddingStatement(false);
            statementsData.reload();
          }}
        />
      )}
    </div>
  );
}
