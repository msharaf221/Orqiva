import { useState, useEffect, type FormEvent } from 'react';
import {
  CreditCard,
  Building,
  Clock,
  Printer,
  CheckCircle2,
  AlertCircle,
  Coins,
  ShieldCheck,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { api, Button, Field, Loading, Modal, money, useAction, useToast } from '../../lib';
import type { PosShift, PosShiftSummary } from '../../types';
import { BarcodeSvg, triggerThermalPrint } from '../../receipt-components';

export function TreasuryReviewModal({
  branchId,
  onClose,
  onApproved,
}: {
  branchId: string;
  onClose: () => void;
  onApproved: () => void;
}) {
  const { busy, act } = useAction();
  const toast = useToast();
  const [pendingList, setPendingList] = useState<PosShift[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedShiftId, setSelectedShiftId] = useState<string | null>(null);
  const [summary, setSummary] = useState<PosShiftSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);

  // Treasury Verified Amounts
  const [verifiedCash, setVerifiedCash] = useState('');
  const [verifiedCard, setVerifiedCard] = useState('');
  const [verifiedBank, setVerifiedBank] = useState('');
  const [reviewNotes, setReviewNotes] = useState('');
  const [showPaymentsTable, setShowPaymentsTable] = useState(false);

  // Physical Proof Documents Checklist
  const [checklist, setChecklist] = useState({
    terminal_batch_verified: false,
    card_slips_counted: false,
    instapay_verified: false,
    drawer_vouchers_signed: false,
    safe_envelope_received: false,
  });

  const loadPending = async () => {
    setLoading(true);
    try {
      const list = await api<PosShift[]>(`/pos/shifts/pending-review?branch_id=${branchId}`);
      setPendingList(list);
      if (list.length > 0) {
        void selectShift(list[0].id);
      } else {
        setSelectedShiftId(null);
        setSummary(null);
      }
    } catch (err: any) {
      toast(err.message || 'تعذر تحميل الورديات المعلقة');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadPending();
  }, [branchId]);

  const selectShift = async (id: string) => {
    setSelectedShiftId(id);
    setSummaryLoading(true);
    try {
      const sum = await api<PosShiftSummary>(`/pos/shifts/${id}/summary`);
      setSummary(sum);

      const initialCash =
        sum.cashier_declared_cash !== null && sum.cashier_declared_cash !== undefined
          ? sum.cashier_declared_cash
          : sum.expected_cash;
      setVerifiedCash((initialCash / 100).toFixed(2));

      const initialCard =
        sum.cashier_declared_card !== null && sum.cashier_declared_card !== undefined
          ? sum.cashier_declared_card
          : sum.expected_card;
      setVerifiedCard((initialCard / 100).toFixed(2));

      const initialBank =
        sum.cashier_declared_bank !== null && sum.cashier_declared_bank !== undefined
          ? sum.cashier_declared_bank
          : sum.expected_bank;
      setVerifiedBank((initialBank / 100).toFixed(2));

      setReviewNotes('');
      setChecklist({
        terminal_batch_verified: Boolean(sum.shift.terminal_batch_number),
        card_slips_counted: Boolean(sum.shift.card_slips_count),
        instapay_verified: Boolean(sum.shift.bank_transfers_count),
        drawer_vouchers_signed: true,
        safe_envelope_received: Boolean(sum.shift.safe_envelope_number),
      });
    } catch (err: any) {
      toast(err.message || 'تعذر تحميل ملخص الوردية');
    } finally {
      setSummaryLoading(false);
    }
  };

  const verifiedCashCents = Math.round(parseFloat(verifiedCash || '0') * 100);
  const expectedCashCents = summary?.expected_cash ?? 0;
  const cashDiffCents = verifiedCashCents - expectedCashCents;

  const verifiedCardCents = Math.round(parseFloat(verifiedCard || '0') * 100);
  const expectedCardCents = summary?.expected_card ?? 0;
  const cardDiffCents = verifiedCardCents - expectedCardCents;

  const verifiedBankCents = Math.round(parseFloat(verifiedBank || '0') * 100);
  const expectedBankCents = summary?.expected_bank ?? 0;
  const bankDiffCents = verifiedBankCents - expectedBankCents;

  const handleApprove = (e: FormEvent) => {
    e.preventDefault();
    if (!selectedShiftId) return;

    void act(async () => {
      await api(`/pos/shifts/${selectedShiftId}/approve`, 'POST', {
        verified_cash: verifiedCashCents,
        closing_card: verifiedCardCents,
        closing_bank: verifiedBankCents,
        review_notes: reviewNotes.trim() || undefined,
        verification_checklist: checklist,
      });
      toast('تم اعتماد إغلاق الوردية والمطابقة متعددة القنوات وترحيل القيود بنجاح');
      onApproved();
      await loadPending();
    });
  };

  return (
    <Modal
      title="اعتماد ورديات الخزنة والمطابقة المالية الشاملة"
      description="مراجعة ورديات الكاشير، فحص أشرطة تسوية الماكينات وإيصالات الفيزا وإنستاباي، والتحقق من المستندات الثبوتية وترحيل قيود الفروقات."
      onClose={onClose}
    >
      <div className="modal-body form-grid treasury-scroll">
        {loading ? (
          <Loading />
        ) : pendingList.length === 0 ? (
          <div className="panel-note">
            <CheckCircle2 size={46} />
            <h4>لا توجد ورديات معلقة بانتظار الاعتماد</h4>
            <p>جميع ورديات الكاشير في هذا الفرع معتمدة ومطابقة بالكامل.</p>
          </div>
        ) : (
          <div className="treasury-layout">
            {/* Shifts Sidebar */}
            <div className="treasury-sidebar">
              <span className="section-label">
                الورديات المعلقة للاعتماد ({pendingList.length})
              </span>
              {pendingList.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => selectShift(s.id)}
                  className={'treasury-shift-btn ' + (selectedShiftId === s.id ? 'active' : '')}
                >
                  <div className="row-between">
                    <strong className="treasury-shift-number">{s.number}</strong>
                    {s.safe_envelope_number && (
                      <span className="treasury-envelope-chip">ظرف #{s.safe_envelope_number}</span>
                    )}
                  </div>
                  <span className="treasury-shift-meta">
                    الكاشير: <b>{s.user_name || '—'}</b>
                  </span>
                  <div className="treasury-declared">
                    <span style={{ color: '#b45309', fontWeight: 600 }}>
                      كاش مسلّم: {money(s.cashier_declared_cash || 0)} ج.م
                    </span>
                    {(s.cashier_declared_card || 0) > 0 && (
                      <span style={{ color: '#2563eb' }}>
                        فيزا: {money(s.cashier_declared_card || 0)} ج.م
                      </span>
                    )}
                    {(s.cashier_declared_bank || 0) > 0 && (
                      <span style={{ color: '#059669' }}>
                        إنستاباي: {money(s.cashier_declared_bank || 0)} ج.م
                      </span>
                    )}
                  </div>
                </button>
              ))}
            </div>

            {/* Shift Detail & Approval Form */}
            <div>
              {summaryLoading ? (
                <Loading />
              ) : summary ? (
                <form onSubmit={handleApprove}>
                  <div className="stack">
                    {/* Shift Metadata Bar */}
                    <div className="info-tile row-between-wrap">
                      <div>
                        <strong style={{ fontSize: '14px', color: 'var(--slate-900)' }}>
                          وردية #{summary.shift.number}
                        </strong>
                        <div className="text-muted-sm">
                          الكاشير: <b>{summary.shift.user_name}</b> | الفرع:{' '}
                          {summary.shift.branch_id}
                        </div>
                      </div>
                      <div style={{ textAlign: 'left', fontSize: '12px' }}>
                        <div>
                          إجمالي المبيعات:{' '}
                          <b style={{ color: 'var(--indigo-600)' }}>
                            {money(summary.total_sales)} ج.م
                          </b>{' '}
                          ({summary.sales_count} عملية)
                        </div>
                        {summary.shift.safe_envelope_number && (
                          <div style={{ color: '#5b21b6', fontWeight: 700 }}>
                            مظروف الإيداع: #{summary.shift.safe_envelope_number}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Multi-Tender Reconciliation Table */}
                    <div className="table-scroll">
                      <table className="pos-reconciliation-table">
                        <thead>
                          <tr>
                            <th>وسيلة الدفع</th>
                            <th>المسجل بالنظام</th>
                            <th>المصرح به من الكاشير</th>
                            <th>المعتمد بالخزينة (ج.م)</th>
                            <th>الفارق المالي</th>
                          </tr>
                        </thead>
                        <tbody>
                          {/* Cash Row */}
                          <tr>
                            <td>
                              <div className="row-gap-6">
                                <Coins size={15} style={{ color: '#d97706' }} />
                                <strong>النقدية بالدرج</strong>
                              </div>
                              <small className="treasury-shift-meta">
                                رصيد البداية {money(summary.opening_cash)} + مبيعات{' '}
                                {money(summary.cash_sales)}
                              </small>
                            </td>
                            <td>
                              <b>{money(summary.expected_cash)} ج.م</b>
                            </td>
                            <td>
                              <span style={{ color: '#b45309', fontWeight: 600 }}>
                                {money(summary.cashier_declared_cash ?? summary.expected_cash)} ج.م
                              </span>
                            </td>
                            <td style={{ width: '140px' }}>
                              <input
                                type="number"
                                step="any"
                                min="0"
                                required
                                value={verifiedCash}
                                onChange={(e) => setVerifiedCash(e.target.value)}
                                className="treasury-verify-input"
                              />
                            </td>
                            <td>
                              <span
                                style={{
                                  fontWeight: 700,
                                  color:
                                    cashDiffCents === 0
                                      ? '#16a34a'
                                      : cashDiffCents < 0
                                        ? '#dc2626'
                                        : '#2563eb',
                                }}
                              >
                                {cashDiffCents === 0
                                  ? 'مطابق'
                                  : cashDiffCents < 0
                                    ? `عجز: -${money(Math.abs(cashDiffCents))} ج.م`
                                    : `زيادة: +${money(cashDiffCents)} ج.م`}
                              </span>
                            </td>
                          </tr>

                          {/* Card Row */}
                          <tr>
                            <td>
                              <div className="row-gap-6">
                                <CreditCard size={15} style={{ color: '#2563eb' }} />
                                <strong>بطاقات / فيزا</strong>
                              </div>
                              <small className="treasury-shift-meta">
                                باتش: {summary.shift.terminal_batch_number || 'غير مسجل'} |{' '}
                                {summary.shift.card_slips_count || 0} إيصال
                              </small>
                            </td>
                            <td>
                              <b>{money(summary.expected_card)} ج.م</b>
                            </td>
                            <td>
                              <span style={{ color: '#2563eb', fontWeight: 600 }}>
                                {money(summary.cashier_declared_card ?? summary.expected_card)} ج.م
                              </span>
                            </td>
                            <td style={{ width: '140px' }}>
                              <input
                                type="number"
                                step="any"
                                min="0"
                                required
                                value={verifiedCard}
                                onChange={(e) => setVerifiedCard(e.target.value)}
                                className="treasury-verify-input"
                              />
                            </td>
                            <td>
                              <span
                                style={{
                                  fontWeight: 700,
                                  color:
                                    cardDiffCents === 0
                                      ? '#16a34a'
                                      : cardDiffCents < 0
                                        ? '#dc2626'
                                        : '#2563eb',
                                }}
                              >
                                {cardDiffCents === 0
                                  ? 'مطابق'
                                  : cardDiffCents < 0
                                    ? `عجز: -${money(Math.abs(cardDiffCents))} ج.م`
                                    : `زيادة: +${money(cardDiffCents)} ج.م`}
                              </span>
                            </td>
                          </tr>

                          {/* Bank / InstaPay Row */}
                          <tr>
                            <td>
                              <div className="row-gap-6">
                                <Building size={15} style={{ color: '#059669' }} />
                                <strong>إنستاباي / محفظة</strong>
                              </div>
                              <small className="treasury-shift-meta">
                                {summary.shift.bank_transfers_count || 0} عملية تحويل
                              </small>
                            </td>
                            <td>
                              <b>{money(summary.expected_bank)} ج.م</b>
                            </td>
                            <td>
                              <span style={{ color: '#059669', fontWeight: 600 }}>
                                {money(summary.cashier_declared_bank ?? summary.expected_bank)} ج.م
                              </span>
                            </td>
                            <td style={{ width: '140px' }}>
                              <input
                                type="number"
                                step="any"
                                min="0"
                                required
                                value={verifiedBank}
                                onChange={(e) => setVerifiedBank(e.target.value)}
                                className="treasury-verify-input"
                              />
                            </td>
                            <td>
                              <span
                                style={{
                                  fontWeight: 700,
                                  color:
                                    bankDiffCents === 0
                                      ? '#16a34a'
                                      : bankDiffCents < 0
                                        ? '#dc2626'
                                        : '#2563eb',
                                }}
                              >
                                {bankDiffCents === 0
                                  ? 'مطابق'
                                  : bankDiffCents < 0
                                    ? `عجز: -${money(Math.abs(bankDiffCents))} ج.م`
                                    : `زيادة: +${money(bankDiffCents)} ج.م`}
                              </span>
                            </td>
                          </tr>

                          {/* Credit Sales Row */}
                          <tr>
                            <td>
                              <div className="row-gap-6">
                                <Clock size={15} style={{ color: '#7c3aed' }} />
                                <strong>مبيعات آجلة</strong>
                              </div>
                              <small className="treasury-shift-meta">
                                ترحل تلقائياً لذمم العملاء
                              </small>
                            </td>
                            <td>
                              <b>{money(summary.credit_sales)} ج.م</b>
                            </td>
                            <td>
                              <span className="muted">—</span>
                            </td>
                            <td>
                              <span className="muted" style={{ fontSize: '12px' }}>
                                {money(summary.credit_sales)} ج.م
                              </span>
                            </td>
                            <td>
                              <span style={{ color: '#16a34a', fontWeight: 700 }}>مطابق</span>
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>

                    {/* PHYSICAL PROOFS VERIFICATION CHECKLIST */}
                    <div className="pos-tender-section-box">
                      <div className="pos-tender-section-title">
                        <ShieldCheck size={18} style={{ color: '#15803d' }} />
                        <span>قائمة التحقق من المستندات والإثباتات الورقية (Audit Checklist)</span>
                      </div>

                      <div className="pos-audit-checklist">
                        <label
                          className={
                            'pos-checklist-row ' +
                            (checklist.terminal_batch_verified ? 'checked' : '')
                          }
                        >
                          <input
                            type="checkbox"
                            checked={checklist.terminal_batch_verified}
                            onChange={(e) =>
                              setChecklist((c) => ({
                                ...c,
                                terminal_batch_verified: e.target.checked,
                              }))
                            }
                          />
                          <span>
                            تم استلام ومطابقة شريط تسوية ماكينة الدفع (Batch Settlement Slip)
                          </span>
                          <span className="pos-checklist-badge">
                            باتش: #{summary.shift.terminal_batch_number || 'غير مسجل'}
                          </span>
                        </label>

                        <label
                          className={
                            'pos-checklist-row ' + (checklist.card_slips_counted ? 'checked' : '')
                          }
                        >
                          <input
                            type="checkbox"
                            checked={checklist.card_slips_counted}
                            onChange={(e) =>
                              setChecklist((c) => ({
                                ...c,
                                card_slips_counted: e.target.checked,
                              }))
                            }
                          />
                          <span>
                            تم عد ومطابقة إيصالات الدفع الورقية للبطاقات الموقعة من العملاء
                          </span>
                          <span className="pos-checklist-badge">
                            العدد: {summary.shift.card_slips_count || 0} إيصال
                          </span>
                        </label>

                        <label
                          className={
                            'pos-checklist-row ' + (checklist.instapay_verified ? 'checked' : '')
                          }
                        >
                          <input
                            type="checkbox"
                            checked={checklist.instapay_verified}
                            onChange={(e) =>
                              setChecklist((c) => ({
                                ...c,
                                instapay_verified: e.target.checked,
                              }))
                            }
                          />
                          <span>
                            تم التحقق من إشعارات تطبيق إنستاباي / كشف حساب المحافظ الإلكترونية
                          </span>
                          <span className="pos-checklist-badge">
                            العمليات: {summary.shift.bank_transfers_count || 0} عملية
                          </span>
                        </label>

                        <label
                          className={
                            'pos-checklist-row ' +
                            (checklist.drawer_vouchers_signed ? 'checked' : '')
                          }
                        >
                          <input
                            type="checkbox"
                            checked={checklist.drawer_vouchers_signed}
                            onChange={(e) =>
                              setChecklist((c) => ({
                                ...c,
                                drawer_vouchers_signed: e.target.checked,
                              }))
                            }
                          />
                          <span>
                            مراجعة وتوقيع أذونات التوريد والصرف اليدوية للدرج (Cash In/Out)
                          </span>
                          <span className="pos-checklist-badge">
                            صافي الحركات: {money(summary.cash_in - summary.cash_out)} ج.م
                          </span>
                        </label>

                        <label
                          className={
                            'pos-checklist-row ' +
                            (checklist.safe_envelope_received ? 'checked' : '')
                          }
                        >
                          <input
                            type="checkbox"
                            checked={checklist.safe_envelope_received}
                            onChange={(e) =>
                              setChecklist((c) => ({
                                ...c,
                                safe_envelope_received: e.target.checked,
                              }))
                            }
                          />
                          <span>
                            تم استلام ظرف إيداع النقدية والمستندات المحكم بالخزينة الرئيسية
                          </span>
                          <span className="pos-checklist-badge">
                            ظرف #{summary.shift.safe_envelope_number || 'غير مسجل'}
                          </span>
                        </label>
                      </div>
                    </div>

                    {/* EXPANDABLE ITEMIZED TRANSACTIONS AUDIT */}
                    <div>
                      <button
                        type="button"
                        onClick={() => setShowPaymentsTable(!showPaymentsTable)}
                        className="treasury-audit-toggle"
                      >
                        {showPaymentsTable ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                        <span>
                          {showPaymentsTable ? 'إخفاء' : 'عرض'} كشف تفصيلي بعمليات الوردية (
                          {summary.payments?.length || 0} عملية)
                        </span>
                      </button>

                      {showPaymentsTable && (
                        <div className="pos-payments-audit-wrapper">
                          <table className="pos-reconciliation-table">
                            <thead>
                              <tr>
                                <th>الوقت</th>
                                <th>رقم الفاتورة</th>
                                <th>العميل</th>
                                <th>وسيلة الدفع</th>
                                <th>المبلغ</th>
                                <th>المرجع / إيصال الفيزا</th>
                              </tr>
                            </thead>
                            <tbody>
                              {!summary.payments || summary.payments.length === 0 ? (
                                <tr>
                                  <td colSpan={6} className="text-center muted">
                                    لا توجد مدفوعات مسجلة في هذه الوردية
                                  </td>
                                </tr>
                              ) : (
                                summary.payments.map((p, idx) => (
                                  <tr key={idx}>
                                    <td className="treasury-chip-meta">
                                      {p.created_at
                                        ? new Date(p.created_at).toLocaleTimeString('ar-EG', {
                                            hour: '2-digit',
                                            minute: '2-digit',
                                          })
                                        : '—'}
                                    </td>
                                    <td>
                                      <strong>#{p.document_number}</strong>
                                    </td>
                                    <td>{p.party_name || 'عميل نقدي'}</td>
                                    <td>
                                      <span
                                        className={
                                          'treasury-method-chip method-' + p.method.toLowerCase()
                                        }
                                      >
                                        {p.method === 'CASH'
                                          ? 'كاش'
                                          : p.method === 'CARD'
                                            ? 'فيزا'
                                            : p.method === 'BANK'
                                              ? 'إنستاباي'
                                              : 'آجل'}
                                      </span>
                                    </td>
                                    <td>
                                      <b>{money(p.amount)} ج.م</b>
                                    </td>
                                    <td className="treasury-chip-meta">{p.reference || '—'}</td>
                                  </tr>
                                ))
                              )}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>

                    {/* Automatic Shortage Alert */}
                    {cashDiffCents < 0 && (
                      <div className="pos-shortage-alert">
                        <AlertCircle size={18} />
                        <div>
                          <strong>تسجيل قيد عجز تلقائي:</strong>
                          <p className="shortage-note">
                            سيتم تلقائياً إنشاء قيد مصروف تشغيلي بقيمة (
                            {money(Math.abs(cashDiffCents))} ج.م) في تصنيف «عجز نقدية نقطة بيع» لضبط
                            الخزنة وحساب الأرباح والخسائر.
                          </p>
                        </div>
                      </div>
                    )}

                    <Field label="ملاحظات مراجعة واعتماد الخزنة">
                      <input
                        type="text"
                        value={reviewNotes}
                        onChange={(e) => setReviewNotes(e.target.value)}
                        placeholder="ملاحظات المحاسب المسؤول بشأن مطابقة الوردية والمستندات..."
                      />
                    </Field>

                    <div className="row" style={{ marginTop: '6px' }}>
                      <Button type="submit" busy={busy}>
                        <CheckCircle2 size={16} /> اعتماد إغلاق الوردية وترحيل القيود
                      </Button>
                    </div>
                  </div>
                </form>
              ) : null}
            </div>
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

export function ShiftHandoverSlipModal({
  shift,
  summary,
  companyName,
  branchName,
  cashierName,
  onClose,
}: {
  shift: PosShift;
  summary: PosShiftSummary;
  companyName: string;
  branchName: string;
  cashierName: string;
  onClose: () => void;
}) {
  const declaredCash =
    shift.cashier_declared_cash ?? summary.cashier_declared_cash ?? summary.expected_cash;
  const cashDiff = declaredCash - summary.expected_cash;

  const declaredCard =
    shift.cashier_declared_card ?? summary.cashier_declared_card ?? summary.expected_card;
  const cardDiff = declaredCard - summary.expected_card;

  const declaredBank =
    shift.cashier_declared_bank ?? summary.cashier_declared_bank ?? summary.expected_bank;
  const bankDiff = declaredBank - summary.expected_bank;

  const openedDateStr = shift.opened_at
    ? new Date(shift.opened_at).toLocaleTimeString('ar-EG', {
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—';
  const closedDateStr = new Date().toLocaleTimeString('ar-EG', {
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <Modal title="سند تسليم وردية كاشير للخزنة (Z-Report)" onClose={onClose}>
      <div className="modal-body pos-receipt-wrapper">
        <div className="thermal-receipt" id="printable-pos-receipt">
          {/* Receipt Top Brand Header */}
          <div className="receipt-header">
            <div className="receipt-brand-badge">ORQIVA POS</div>
            <h3 className="receipt-company-title">{companyName}</h3>
            <p className="receipt-branch-name">فرع: {branchName}</p>
            <div className="receipt-title-box">
              <span>محضر تسليم وتقفيل وردية كاشير (Z-Report)</span>
            </div>
            <div className="receipt-cut-line" />
            <div className="receipt-meta-grid">
              <div className="meta-item">
                <span className="meta-label">رقم الوردية:</span>
                <span className="meta-value bold num">#{shift.number}</span>
              </div>
              <div className="meta-item">
                <span className="meta-label">تاريخ التسليم:</span>
                <span className="meta-value">{new Date().toLocaleDateString('ar-EG')}</span>
              </div>
              <div className="meta-item">
                <span className="meta-label">الكاشير المسلّم:</span>
                <span className="meta-value bold">{cashierName}</span>
              </div>
              <div className="meta-item">
                <span className="meta-label">فترة الوردية:</span>
                <span className="meta-value num">
                  من {openedDateStr} إلى {closedDateStr}
                </span>
              </div>
            </div>
            <div className="receipt-cut-line" />
          </div>

          {/* Multi-Tender Breakdown */}
          <div className="receipt-totals">
            <div className="receipt-section-title">1. مطابقة نقدية الدرج (كاش)</div>
            <div className="receipt-row">
              <span>الرصيد الافتتاحي (العهدة):</span>
              <span className="num">{money(summary.opening_cash)} ج.م</span>
            </div>
            <div className="receipt-row">
              <span>المبيعات النقدية:</span>
              <span className="num font-semibold">{money(summary.cash_sales)} ج.م</span>
            </div>
            <div className="receipt-row">
              <span>توريدات نقدية (إيداع درج):</span>
              <span className="num text-green">+{money(summary.cash_in)} ج.م</span>
            </div>
            <div className="receipt-row">
              <span>مسحوبات ومصروفات (درج):</span>
              <span className="num text-red">-{money(summary.cash_out)} ج.م</span>
            </div>
            <div className="receipt-row grand-total-row">
              <span>النقدية المتوقعة بالدرج:</span>
              <span className="num total-amount">{money(summary.expected_cash)} ج.م</span>
            </div>
            <div className="receipt-row grand-total-row" style={{ color: '#1e40af' }}>
              <span>النقدية المسلّمة فعلياً:</span>
              <span className="num total-amount">{money(declaredCash)} ج.م</span>
            </div>
            <div className="receipt-row">
              <span>فارق النقدية:</span>
              <span
                className="num font-semibold"
                style={{
                  color: cashDiff === 0 ? '#15803d' : cashDiff < 0 ? '#b91c1c' : '#1d4ed8',
                }}
              >
                {cashDiff === 0
                  ? 'مطابق (0.00)'
                  : cashDiff < 0
                    ? `عجز: -${money(Math.abs(cashDiff))} ج.م`
                    : `زيادة: +${money(cashDiff)} ج.م`}
              </span>
            </div>

            <div className="receipt-cut-line" />

            <div className="receipt-section-title">2. مبيعات البطاقات وماكينة الفيزا</div>
            <div className="receipt-row">
              <span>المبيعات المسجلة بالنظام:</span>
              <span className="num">{money(summary.expected_card)} ج.م</span>
            </div>
            <div className="receipt-row">
              <span>إجمالي شريط التسوية (Batch):</span>
              <span className="num font-semibold">{money(declaredCard)} ج.م</span>
            </div>
            {shift.terminal_batch_number && (
              <div className="receipt-row">
                <span>رقم تسوية الماكينة:</span>
                <span className="num bold">{shift.terminal_batch_number}</span>
              </div>
            )}
            <div className="receipt-row">
              <span>عدد إيصالات البطاقات المرفقة:</span>
              <span className="num">{shift.card_slips_count || 0} إيصال</span>
            </div>
            <div className="receipt-row">
              <span>فارق تسوية البطاقات:</span>
              <span
                className="num font-semibold"
                style={{
                  color: cardDiff === 0 ? '#15803d' : cardDiff < 0 ? '#b91c1c' : '#1d4ed8',
                }}
              >
                {cardDiff === 0
                  ? 'مطابق'
                  : cardDiff < 0
                    ? `عجز: -${money(Math.abs(cardDiff))} ج.م`
                    : `زيادة: +${money(cardDiff)} ج.م`}
              </span>
            </div>

            <div className="receipt-cut-line" />

            <div className="receipt-section-title">3. إنستاباي والتحويلات البنكية</div>
            <div className="receipt-row">
              <span>المسجل بالنظام:</span>
              <span className="num">{money(summary.expected_bank)} ج.م</span>
            </div>
            <div className="receipt-row">
              <span>المحصل الفعلي المسلّم:</span>
              <span className="num font-semibold">{money(declaredBank)} ج.م</span>
            </div>
            <div className="receipt-row">
              <span>عدد عمليات التحويل:</span>
              <span className="num">{shift.bank_transfers_count || 0} عملية</span>
            </div>
            <div className="receipt-row">
              <span>فارق إنستاباي:</span>
              <span
                className="num font-semibold"
                style={{
                  color: bankDiff === 0 ? '#15803d' : bankDiff < 0 ? '#b91c1c' : '#1d4ed8',
                }}
              >
                {bankDiff === 0
                  ? 'مطابق'
                  : bankDiff < 0
                    ? `عجز: -${money(Math.abs(bankDiff))} ج.م`
                    : `زيادة: +${money(bankDiff)} ج.م`}
              </span>
            </div>

            <div className="receipt-cut-line" />

            <div className="receipt-row grand-total-highlight">
              <span className="label">إجمالي إيراد مبيعات الوردية:</span>
              <span className="num value">{money(summary.total_sales)} ج.م</span>
            </div>

            {/* Proof Documents & Envelope */}
            <div className="receipt-diff-box" style={{ marginTop: '10px' }}>
              <div className="receipt-row">
                <span>رقم مظروف الخزنة الأمني:</span>
                <span className="font-semibold num">
                  {shift.safe_envelope_number || 'غير مسجل'}
                </span>
              </div>
              <div className="receipt-row">
                <span>حالة الاعتماد بالخزينة:</span>
                <span
                  style={{
                    color: shift.status === 'CLOSED' ? '#15803d' : '#b45309',
                    fontWeight: 700,
                  }}
                >
                  {shift.status === 'CLOSED' ? 'معتمد ومقفل بالخزنة' : 'مسلّم - بانتظار الاعتماد'}
                </span>
              </div>
            </div>

            {shift.notes && (
              <div className="receipt-notes-box">
                <b>ملاحظات الكاشير:</b> {shift.notes}
              </div>
            )}
            {shift.review_notes && (
              <div className="receipt-notes-box" style={{ background: '#f0fdf4' }}>
                <b>ملاحظات اعتماد الخزنة:</b> {shift.review_notes}
              </div>
            )}
          </div>

          <div className="receipt-cut-line" />

          {/* Dual Signatures */}
          <div className="receipt-signatures-container">
            <div className="signature-box">
              <span className="sign-title">توقيع الكاشير المسلّم</span>
              <div className="sign-line" />
              <span className="sign-sub">{cashierName}</span>
            </div>
            <div className="signature-box">
              <span className="sign-title">توقيع مستلم الخزينة</span>
              <div className="sign-line" />
              <span className="sign-sub">المحاسب المسؤول</span>
            </div>
          </div>

          {/* Barcode of shift */}
          <div className="receipt-barcode-wrapper">
            <BarcodeSvg value={`SHIFT-${shift.number}`} height={30} fontSize={10} />
          </div>

          <div className="receipt-footer">
            <div className="receipt-cut-line" />
            <p>سند تقفيل وردية Z-Report معتمد بالنظام</p>
            <small>نظام أوركيفا السحابي لإدارة نقاط البيع والمطابقة المالية</small>
          </div>
        </div>
      </div>

      <div className="modal-footer">
        <Button onClick={triggerThermalPrint}>
          <Printer size={16} /> طباعة سند التسليم والـ Z-Report (Ctrl+P)
        </Button>
        <Button variant="secondary" onClick={onClose}>
          إغلاق
        </Button>
      </div>
    </Modal>
  );
}
