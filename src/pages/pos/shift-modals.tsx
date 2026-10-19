import { useState, useEffect, type FormEvent } from 'react';
import {
  CreditCard,
  Building,
  Clock,
  ArrowDownLeft,
  ArrowUpRight,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  Coins,
  ShieldCheck,
} from 'lucide-react';
import { api, Button, Field, Loading, Modal, money, useAction } from '../../lib';
import type { PosShift, PosShiftSummary } from '../../types';

export function OpenShiftModal({
  branchId,
  onClose,
  onSuccess,
}: {
  branchId: string;
  onClose: () => void;
  onSuccess: (shift: PosShift) => void;
}) {
  const { busy, act } = useAction();
  const [openingCash, setOpeningCash] = useState('0');
  const [notes, setNotes] = useState('');

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    void act(async () => {
      const shift = await api<PosShift>('/pos/shifts/open', 'POST', {
        branch_id: branchId,
        opening_cash: Math.round(parseFloat(openingCash || '0') * 100),
        notes: notes.trim() || undefined,
      });
      onSuccess(shift);
    });
  };

  return (
    <Modal
      title="افتتاح وردية جديدة لنقطة البيع"
      description="أدخل الرصيد الافتتاحي في درج النقدية لبدء تسجيل المبيعات."
      onClose={onClose}
    >
      <form onSubmit={handleSubmit}>
        <div className="modal-body form-grid">
          <Field label="الرصيد النقدي الافتتاحي في الدرج (ج.م) *">
            <input
              type="number"
              step="any"
              min="0"
              required
              autoFocus
              value={openingCash}
              onChange={(e) => setOpeningCash(e.target.value)}
              placeholder="0.00"
            />
          </Field>
          <Field label="ملاحظات افتتاح الوردية">
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="مثال: وردية صباحية - فكة متوفرة"
            />
          </Field>
        </div>
        <div className="modal-footer">
          <Button type="submit" busy={busy}>
            افتتاح الوردية
          </Button>
          <Button type="button" variant="secondary" onClick={onClose}>
            إلغاء
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function CashMovementModal({
  shiftId,
  onClose,
  onSuccess,
}: {
  shiftId: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { busy, act } = useAction();
  const [type, setType] = useState<'IN' | 'OUT'>('IN');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    void act(async () => {
      await api(`/pos/shifts/${shiftId}/cash-movement`, 'POST', {
        type,
        amount: Math.round(parseFloat(amount || '0') * 100),
        reason: reason.trim(),
      });
      onSuccess();
    });
  };

  return (
    <Modal
      title="تسجيل حركة نقدية في درج الوردية"
      description="إيداع فكة إضافية أو سحب مصروف طارئ أثناء الوردية."
      onClose={onClose}
    >
      <form onSubmit={handleSubmit}>
        <div className="modal-body form-grid">
          <Field label="نوع الحركة النقدية *">
            <div className="pos-segmented-control">
              <button
                type="button"
                className={'pos-segment ' + (type === 'IN' ? 'active in' : '')}
                onClick={() => setType('IN')}
              >
                <ArrowDownLeft size={16} /> توريد نقدية (إيداع فكة)
              </button>
              <button
                type="button"
                className={'pos-segment ' + (type === 'OUT' ? 'active out' : '')}
                onClick={() => setType('OUT')}
              >
                <ArrowUpRight size={16} /> سحب نقدية (مصروف طارئ)
              </button>
            </div>
          </Field>
          <Field label="المبلغ بالجنيه (ج.م) *">
            <input
              type="number"
              step="any"
              min="0.01"
              required
              autoFocus
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
            />
          </Field>
          <Field label="السبب أو البيان *">
            <input
              type="text"
              required
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={
                type === 'IN' ? 'مثال: فكة إضافية من الإدارة' : 'مثال: شراء أدوات نظافة طارئة'
              }
            />
          </Field>
        </div>
        <div className="modal-footer">
          <Button type="submit" busy={busy}>
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

export function CloseShiftModal({
  shiftId,
  isAccountantOrAdmin,
  onClose,
  onSubmitSuccess,
  onDirectCloseSuccess,
}: {
  shiftId: string;
  isAccountantOrAdmin: boolean;
  onClose: () => void;
  onSubmitSuccess: (shift: PosShift, summary: PosShiftSummary) => void;
  onDirectCloseSuccess: () => void;
}) {
  const { busy, act } = useAction();
  const [summary, setSummary] = useState<PosShiftSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [directClose, setDirectClose] = useState(false);

  // Cashier counts and declarations
  const [closingCash, setClosingCash] = useState('');
  const [closingCard, setClosingCard] = useState('');
  const [terminalBatchNumber, setTerminalBatchNumber] = useState('');
  const [cardSlipsCount, setCardSlipsCount] = useState('');
  const [closingBank, setClosingBank] = useState('');
  const [bankTransfersCount, setBankTransfersCount] = useState('');
  const [safeEnvelopeNumber, setSafeEnvelopeNumber] = useState('');
  const [proofDocuments, setProofDocuments] = useState('');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    api<PosShiftSummary>(`/pos/shifts/${shiftId}/summary`)
      .then((data) => {
        setSummary(data);
        setClosingCash((data.expected_cash / 100).toFixed(2));
        setClosingCard((data.expected_card / 100).toFixed(2));
        setClosingBank((data.expected_bank / 100).toFixed(2));
      })
      .finally(() => setLoading(false));
  }, [shiftId]);

  const cashCountedCents = Math.round(parseFloat(closingCash || '0') * 100);
  const cashExpectedCents = summary?.expected_cash ?? 0;
  const cashDiffCents = cashCountedCents - cashExpectedCents;

  const cardCountedCents = Math.round(parseFloat(closingCard || '0') * 100);
  const cardExpectedCents = summary?.expected_card ?? 0;
  const cardDiffCents = cardCountedCents - cardExpectedCents;

  const bankCountedCents = Math.round(parseFloat(closingBank || '0') * 100);
  const bankExpectedCents = summary?.expected_bank ?? 0;
  const bankDiffCents = bankCountedCents - bankExpectedCents;

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    void act(async () => {
      if (directClose && isAccountantOrAdmin) {
        await api(`/pos/shifts/${shiftId}/close`, 'POST', {
          closing_cash: cashCountedCents,
          closing_card: cardCountedCents,
          closing_bank: bankCountedCents,
          notes: notes.trim() || undefined,
        });
        onDirectCloseSuccess();
      } else {
        const submitted = await api<PosShift>(`/pos/shifts/${shiftId}/submit`, 'POST', {
          declared_cash: cashCountedCents,
          declared_card: cardCountedCents,
          declared_bank: bankCountedCents,
          terminal_batch_number: terminalBatchNumber.trim() || undefined,
          card_slips_count: cardSlipsCount ? parseInt(cardSlipsCount, 10) : undefined,
          bank_transfers_count: bankTransfersCount ? parseInt(bankTransfersCount, 10) : undefined,
          safe_envelope_number: safeEnvelopeNumber.trim() || undefined,
          proof_documents: proofDocuments.trim() || undefined,
          notes: notes.trim() || undefined,
        });
        if (summary) {
          onSubmitSuccess(submitted, {
            ...summary,
            cashier_declared_cash: cashCountedCents,
            cashier_declared_card: cardCountedCents,
            cashier_declared_bank: bankCountedCents,
            card_difference: cardDiffCents,
            bank_difference: bankDiffCents,
          });
        }
      }
    });
  };

  return (
    <Modal
      title={
        directClose
          ? 'إغلاق الوردية والاعتماد المباشر (مدير/محاسب)'
          : 'تسليم وتقفيل الوردية للخزنة (تسليم الكاشير)'
      }
      description={
        directClose
          ? 'إغلاق الوردية واعتماد مطابقة جميع وسائل الدفع وترحيل القيود فوراً.'
          : 'جرد نقدية الدرج ومطابقة إيصالات الفيزا وشريط التسوية وتسليم الوردية لمسؤول الخزنة للمراجعة والاعتماد.'
      }
      onClose={onClose}
    >
      <form onSubmit={handleSubmit}>
        <div className="modal-body form-grid" style={{ maxHeight: '74vh', overflowY: 'auto' }}>
          {loading ? (
            <Loading />
          ) : summary ? (
            <>
              {isAccountantOrAdmin && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '10px 12px',
                    background: '#f8faf9',
                    border: '1px solid #dbe6e0',
                    borderRadius: '8px',
                  }}
                >
                  <input
                    type="checkbox"
                    id="directCloseToggle"
                    checked={directClose}
                    onChange={(e) => setDirectClose(e.target.checked)}
                  />
                  <label
                    htmlFor="directCloseToggle"
                    style={{ fontSize: '13px', cursor: 'pointer', fontWeight: 600 }}
                  >
                    إغلاق واعتماد مالي مباشر فوري (صلاحية مدير / محاسب خزنة)
                  </label>
                </div>
              )}

              {/* Multi-Tender Overview Grid */}
              <div className="pos-tender-summary-grid">
                <div className="pos-tender-summary-card">
                  <div className="pos-tender-card-header">
                    <span>نقدية الدرج (كاش)</span>
                    <Coins size={16} style={{ color: '#d97706' }} />
                  </div>
                  <div className="pos-tender-card-expected">{money(summary.expected_cash)} ج.م</div>
                  <span className="pos-tender-card-meta">
                    مبيعات: {money(summary.cash_sales)} + العهدة
                  </span>
                </div>

                <div className="pos-tender-summary-card">
                  <div className="pos-tender-card-header">
                    <span>بطاقات بنكية / فيزا</span>
                    <CreditCard size={16} style={{ color: '#2563eb' }} />
                  </div>
                  <div className="pos-tender-card-expected">{money(summary.expected_card)} ج.م</div>
                  <span className="pos-tender-card-meta">مسجل بالنظام من المبيعات</span>
                </div>

                <div className="pos-tender-summary-card">
                  <div className="pos-tender-card-header">
                    <span>إنستاباي / محفظة</span>
                    <Building size={16} style={{ color: '#059669' }} />
                  </div>
                  <div className="pos-tender-card-expected">{money(summary.expected_bank)} ج.م</div>
                  <span className="pos-tender-card-meta">تحويلات بنكية ومحافظ</span>
                </div>

                <div className="pos-tender-summary-card">
                  <div className="pos-tender-card-header">
                    <span>مبيعات آجلة (ذمم)</span>
                    <Clock size={16} style={{ color: '#7c3aed' }} />
                  </div>
                  <div className="pos-tender-card-expected">{money(summary.credit_sales)} ج.م</div>
                  <span className="pos-tender-card-meta">على حسابات العملاء</span>
                </div>
              </div>

              {/* SECTION 1: Cash Drawer Count */}
              <div className="pos-tender-section-box">
                <div className="pos-tender-section-title">
                  <Coins size={18} style={{ color: '#d97706' }} />
                  <span>1. جرد نقدية الدرج الفعلي (Cash Drawer Count)</span>
                </div>

                <div className="pos-reconciliation-card">
                  <div className="pos-recon-row">
                    <span>الرصيد الافتتاحي (عهدة البداية):</span>
                    <b>{money(summary.opening_cash)} ج.م</b>
                  </div>
                  <div className="pos-recon-row">
                    <span>مبيعات نقدية (كاش):</span>
                    <b>+{money(summary.cash_sales)} ج.م</b>
                  </div>
                  <div className="pos-recon-row">
                    <span>توريدات نقدية إضافية (إيداع درج):</span>
                    <b>+{money(summary.cash_in)} ج.م</b>
                  </div>
                  <div className="pos-recon-row">
                    <span>مسحوبات نقدية (مصروفات درج):</span>
                    <b>-{money(summary.cash_out)} ج.م</b>
                  </div>
                  <div className="pos-recon-divider" />
                  <div className="pos-recon-row total">
                    <span>النقدية المتوقعة بالدرج:</span>
                    <strong>{money(summary.expected_cash)} ج.م</strong>
                  </div>
                </div>

                <Field
                  label={
                    directClose
                      ? 'النقدية الفعلية المعتمدة (ج.م) *'
                      : 'النقدية المحصاة في الدرج المسلّمة للخزنة (ج.م) *'
                  }
                >
                  <input
                    type="number"
                    step="any"
                    min="0"
                    required
                    autoFocus
                    value={closingCash}
                    onChange={(e) => setClosingCash(e.target.value)}
                  />
                </Field>

                {/* Cash Live Difference Badge */}
                <div
                  className={
                    'pos-diff-banner ' +
                    (cashDiffCents === 0 ? 'match' : cashDiffCents < 0 ? 'deficit' : 'surplus')
                  }
                >
                  {cashDiffCents === 0 ? (
                    <>
                      <CheckCircle2 size={18} />
                      <span>النقدية مطابقة تماماً مع المسجل بالنظام (الفارق: 0.00 ج.م)</span>
                    </>
                  ) : cashDiffCents < 0 ? (
                    <>
                      <AlertCircle size={18} />
                      <span>
                        عجز نقدي في الدرج بمقدار: <b>{money(Math.abs(cashDiffCents))} ج.م</b>
                      </span>
                    </>
                  ) : (
                    <>
                      <Sparkles size={18} />
                      <span>
                        توجد زيادة نقدية في الدرج بمقدار: <b>+{money(cashDiffCents)} ج.م</b>
                      </span>
                    </>
                  )}
                </div>
              </div>

              {/* SECTION 2: Card & POS Terminal Settlement */}
              <div className="pos-tender-section-box">
                <div className="pos-tender-section-title">
                  <CreditCard size={18} style={{ color: '#2563eb' }} />
                  <span>2. تسوية ماكينة البطاقات والفيزا (POS Terminal & Slips)</span>
                </div>

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                    gap: '12px',
                  }}
                >
                  <Field label="إجمالي شريط تسوية الماكينة (Batch Total) ج.م *">
                    <input
                      type="number"
                      step="any"
                      min="0"
                      required
                      value={closingCard}
                      onChange={(e) => setClosingCard(e.target.value)}
                    />
                  </Field>

                  <Field label="رقم تسوية الماكينة (Terminal Batch #)">
                    <input
                      type="text"
                      placeholder="مثال: BATCH-0042 / 9821"
                      value={terminalBatchNumber}
                      onChange={(e) => setTerminalBatchNumber(e.target.value)}
                    />
                  </Field>

                  <Field label="عدد إيصالات البطاقات الورقية المرفقة">
                    <input
                      type="number"
                      min="0"
                      step="1"
                      placeholder="عدد الفواتير الورقية الموقعة"
                      value={cardSlipsCount}
                      onChange={(e) => setCardSlipsCount(e.target.value)}
                    />
                  </Field>
                </div>

                <div
                  className={
                    'pos-diff-banner ' +
                    (cardDiffCents === 0 ? 'match' : cardDiffCents < 0 ? 'deficit' : 'surplus')
                  }
                >
                  {cardDiffCents === 0 ? (
                    <>
                      <CheckCircle2 size={18} />
                      <span>
                        مبيعات البطاقات مطابقة تماماً لشريط تسوية الماكينة (الفارق: 0.00 ج.م)
                      </span>
                    </>
                  ) : cardDiffCents < 0 ? (
                    <>
                      <AlertCircle size={18} />
                      <span>
                        فارق نقص في شريط البطاقات بمقدار:{' '}
                        <b>{money(Math.abs(cardDiffCents))} ج.م</b>
                      </span>
                    </>
                  ) : (
                    <>
                      <Sparkles size={18} />
                      <span>
                        زيادة في شريط البطاقات بمقدار: <b>+{money(cardDiffCents)} ج.م</b>
                      </span>
                    </>
                  )}
                </div>
              </div>

              {/* SECTION 3: InstaPay & Bank Transfers */}
              <div className="pos-tender-section-box">
                <div className="pos-tender-section-title">
                  <Building size={18} style={{ color: '#059669' }} />
                  <span>3. إثباتات إنستاباي والمحافظ الإلكترونية (InstaPay & Wallets)</span>
                </div>

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                    gap: '12px',
                  }}
                >
                  <Field label="إجمالي المحصل عبر إنستاباي / البنك (ج.م) *">
                    <input
                      type="number"
                      step="any"
                      min="0"
                      required
                      value={closingBank}
                      onChange={(e) => setClosingBank(e.target.value)}
                    />
                  </Field>

                  <Field label="عدد عمليات التحويل / الإشعارات المرفقة">
                    <input
                      type="number"
                      min="0"
                      step="1"
                      placeholder="عدد إشعارات التحويل"
                      value={bankTransfersCount}
                      onChange={(e) => setBankTransfersCount(e.target.value)}
                    />
                  </Field>
                </div>

                <div
                  className={
                    'pos-diff-banner ' +
                    (bankDiffCents === 0 ? 'match' : bankDiffCents < 0 ? 'deficit' : 'surplus')
                  }
                >
                  {bankDiffCents === 0 ? (
                    <>
                      <CheckCircle2 size={18} />
                      <span>إجمالي إنستاباي مطابق مع المسجل بالنظام (الفارق: 0.00 ج.م)</span>
                    </>
                  ) : bankDiffCents < 0 ? (
                    <>
                      <AlertCircle size={18} />
                      <span>
                        فارق نقص في تحويلات إنستاباي بمقدار:{' '}
                        <b>{money(Math.abs(bankDiffCents))} ج.م</b>
                      </span>
                    </>
                  ) : (
                    <>
                      <Sparkles size={18} />
                      <span>
                        زيادة في تحويلات إنستاباي بمقدار: <b>+{money(bankDiffCents)} ج.م</b>
                      </span>
                    </>
                  )}
                </div>
              </div>

              {/* SECTION 4: Safe Drop Envelope & Proof Documents */}
              <div className="pos-proof-box">
                <div className="pos-tender-section-title">
                  <ShieldCheck size={18} style={{ color: '#4f46e5' }} />
                  <span>4. ظرف إيداع الخزنة والمستندات الثبوتية (Safe Drop & Proofs)</span>
                </div>

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
                    gap: '12px',
                  }}
                >
                  <Field label="رقم ظرف إيداع الخزنة المحكم (Safe Drop Envelope #)">
                    <input
                      type="text"
                      placeholder="مثال: ENV-2026-0482 أو رقم الكيس الأمني"
                      value={safeEnvelopeNumber}
                      onChange={(e) => setSafeEnvelopeNumber(e.target.value)}
                    />
                  </Field>

                  <Field label="بيان المرفقات والإثباتات الورقية">
                    <input
                      type="text"
                      placeholder="شريط تسوية ماكينة + إيصالات فيزا + أذونات صرف..."
                      value={proofDocuments}
                      onChange={(e) => setProofDocuments(e.target.value)}
                    />
                  </Field>
                </div>

                <Field label="ملاحظات التسليم وأسباب الفروقات إن وجدت">
                  <input
                    type="text"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="أي ملاحظات حول التقفيلة أو سبب أي فارق مالي..."
                  />
                </Field>
              </div>
            </>
          ) : null}
        </div>
        <div className="modal-footer">
          <Button type="submit" busy={busy} disabled={loading}>
            {directClose ? 'إغلاق الوردية واعتماد التقرير' : 'تسليم الوردية للخزنة وطباعة السند'}
          </Button>
          <Button type="button" variant="secondary" onClick={onClose}>
            إلغاء
          </Button>
        </div>
      </form>
    </Modal>
  );
}
