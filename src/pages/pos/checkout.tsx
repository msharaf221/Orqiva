import { useState, useMemo, type FormEvent } from 'react';
import { Search, CreditCard, Building, Clock, Coins } from 'lucide-react';
import { api, Button, Field, Modal, money, useAction, useToast } from '../../lib';
import type { Party } from '../../types';
import {
  playSound,
  DEFAULT_WALK_IN_CUSTOMER,
  findStockShortages,
  type CheckoutResult,
  type CartItem,
  type PosProduct,
} from './helpers';

export function CustomerPickerModal({
  customers,
  selectedCustomer,
  onSelect,
  onClose,
}: {
  customers: Party[];
  selectedCustomer: Party;
  onSelect: (c: Party) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState('');

  const list = useMemo(() => {
    const q = search.trim().toLowerCase();
    const all = [DEFAULT_WALK_IN_CUSTOMER, ...customers];
    if (!q) return all;
    return all.filter((c) => c.name.toLowerCase().includes(q) || (c.phone && c.phone.includes(q)));
  }, [customers, search]);

  return (
    <Modal
      title="اختيار العميل (F4)"
      description="اختر العميل المخصص للفاتورة أو استمر مع العميل النقدي الطائر."
      onClose={onClose}
    >
      <div className="modal-body pos-customer-picker">
        <div className="pos-search-input-wrap">
          <Search size={16} />
          <input
            type="text"
            autoFocus
            placeholder="ابحث باسم العميل أو رقم الهاتف..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="pos-customer-list">
          {list.map((c) => (
            <button
              key={c.id}
              type="button"
              className={'pos-customer-item ' + (selectedCustomer.id === c.id ? 'active' : '')}
              onClick={() => onSelect(c)}
            >
              <div className="pos-cust-main">
                <strong>{c.name}</strong>
                <span>{c.phone || 'بدون هاتف'}</span>
              </div>
              {c.id !== 'walk-in-customer' && (
                <span className="pos-cust-bal">الرصيد: {money(c.balance || 0)} ج.م</span>
              )}
            </button>
          ))}
        </div>
      </div>
      <div className="modal-footer">
        <Button variant="secondary" onClick={onClose}>
          إغلاق
        </Button>
      </div>
    </Modal>
  );
}

export function DiscountModal({
  subtotalCents,
  currentDiscountCents,
  onApply,
  onClose,
}: {
  subtotalCents: number;
  currentDiscountCents: number;
  onApply: (cents: number) => void;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<'FIXED' | 'PERCENT'>('FIXED');
  const [val, setVal] = useState(
    currentDiscountCents > 0 ? (currentDiscountCents / 100).toString() : '0',
  );

  const calculatedDiscount = useMemo(() => {
    const num = parseFloat(val || '0');
    if (isNaN(num) || num <= 0) return 0;
    if (mode === 'PERCENT') {
      return Math.min(subtotalCents, Math.round((subtotalCents * num) / 100));
    }
    return Math.min(subtotalCents, Math.round(num * 100));
  }, [mode, val, subtotalCents]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    onApply(calculatedDiscount);
  };

  return (
    <Modal title="تطبيق خصم على الفاتورة" onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <div className="modal-body form-grid">
          <div className="pos-segmented-control">
            <button
              type="button"
              className={'pos-segment ' + (mode === 'FIXED' ? 'active' : '')}
              onClick={() => setMode('FIXED')}
            >
              مبلغ ثابت (ج.م)
            </button>
            <button
              type="button"
              className={'pos-segment ' + (mode === 'PERCENT' ? 'active' : '')}
              onClick={() => setMode('PERCENT')}
            >
              نسبة مئوية (%)
            </button>
          </div>

          <Field label={mode === 'FIXED' ? 'قيمة الخصم بالجنيه' : 'نسبة الخصم المئوية'}>
            <input
              type="number"
              step="any"
              min="0"
              max={mode === 'PERCENT' ? 100 : subtotalCents / 100}
              autoFocus
              value={val}
              onChange={(e) => setVal(e.target.value)}
            />
          </Field>

          <div className="pos-discount-preview">
            <span>إجمالي الخصم المحسوب:</span>
            <b>{money(calculatedDiscount)} ج.م</b>
          </div>
        </div>
        <div className="modal-footer">
          <Button type="submit">تطبيق الخصم</Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              onApply(0);
            }}
          >
            إلغاء الخصم
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function CheckoutModal({
  branchId,
  shiftId,
  customer,
  cart,
  discountCents,
  totalCents,
  onSuccess,
  onClose,
}: {
  branchId: string;
  shiftId: string;
  customer: Party;
  cart: CartItem[];
  discountCents: number;
  totalCents: number;
  onSuccess: (res: CheckoutResult) => void;
  onClose: () => void;
}) {
  const { busy, act } = useAction();
  const toast = useToast();
  const [method, setMethod] = useState<'CASH' | 'CARD' | 'BANK' | 'CREDIT'>('CASH');
  const [amountTendered, setAmountTendered] = useState((totalCents / 100).toFixed(2));
  const [cardRef, setCardRef] = useState('');
  const [bankRef, setBankRef] = useState('');

  // Split Payment Mode
  const [splitMode, setSplitMode] = useState(false);
  const [splitCash, setSplitCash] = useState((totalCents / 100).toFixed(2));
  const [splitCard, setSplitCard] = useState('0');
  const [splitCardRef, setSplitCardRef] = useState('');
  const [splitBank, setSplitBank] = useState('0');
  const [splitBankRef, setSplitBankRef] = useState('');
  const [splitCredit, setSplitCredit] = useState('0');

  const tenderedCents = Math.round(parseFloat(amountTendered || '0') * 100);
  const changeDueCents = Math.max(0, tenderedCents - totalCents);

  // Split cents
  const splitCashCents = Math.round(parseFloat(splitCash || '0') * 100);
  const splitCardCents = Math.round(parseFloat(splitCard || '0') * 100);
  const splitBankCents = Math.round(parseFloat(splitBank || '0') * 100);
  const splitCreditCents = Math.round(parseFloat(splitCredit || '0') * 100);
  const splitAllocatedCents = splitCashCents + splitCardCents + splitBankCents + splitCreditCents;
  const splitRemainingCents = totalCents - splitAllocatedCents;

  const quickCashOptions = [
    { label: 'المبلغ بالضبط', val: totalCents },
    { label: '50 ج.م', val: 5000 },
    { label: '100 ج.م', val: 10000 },
    { label: '200 ج.م', val: 20000 },
    { label: '500 ج.م', val: 50000 },
    { label: '1000 ج.م', val: 100000 },
  ];

  /**
   * Refetches live branch availability and aborts when a cart line can no longer be
   * fulfilled (e.g. a parallel till sold the last unit while this cart was open).
   */
  const revalidateStock = async (): Promise<boolean> => {
    try {
      const fresh = await api<PosProduct[]>(`/pos/products?branch_id=${branchId}`);
      const shortages = findStockShortages(
        cart.map((c) => ({
          product_id: c.product.id,
          name: c.product.name,
          quantity: c.quantity,
        })),
        fresh.map((p) => ({ id: p.id, stock: p.stock, name: p.name })),
      );
      if (shortages.length > 0) {
        const first = shortages[0];
        playSound(false);
        toast(
          `تغيّرت الكميات المتاحة: «${first.name}» المتاح الآن (${first.available}) والمطلوب (${first.requested}). راجع السلة.`,
        );
        return false;
      }
      return true;
    } catch {
      // If the availability check itself fails, fall back to the server-side guard.
      return true;
    }
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();

    if (splitMode) {
      if (splitAllocatedCents !== totalCents) {
        toast(`يجب توزيع كامل مبلغ الفاتورة. المتبقي للتوزيع: ${money(splitRemainingCents)} ج.م`);
        return;
      }
      if (splitCreditCents > 0 && customer.id === 'walk-in-customer') {
        toast('لا يمكن تسجيل جزء آجل لـ «عميل نقدي طائر». يرجى اختيار عميل مسجل.');
        return;
      }

      const activeSplits = [
        { method: 'CASH' as const, amount: splitCashCents },
        {
          method: 'CARD' as const,
          amount: splitCardCents,
          reference: splitCardRef.trim() || undefined,
        },
        {
          method: 'BANK' as const,
          amount: splitBankCents,
          reference: splitBankRef.trim() || undefined,
        },
        { method: 'CREDIT' as const, amount: splitCreditCents },
      ].filter((s) => s.amount > 0);

      const nonCreditSum = splitCashCents + splitCardCents + splitBankCents;

      void act(async () => {
        if (!(await revalidateStock())) return;
        const res = await api<CheckoutResult>('/pos/checkout', 'POST', {
          branch_id: branchId,
          shift_id: shiftId,
          party_id: customer.id,
          date: new Date().toISOString().slice(0, 10),
          discount: discountCents,
          lines: cart.map((c) => ({
            product_id: c.product.id,
            quantity: c.quantity,
            unit_price: c.unit_price,
          })),
          payment: {
            method: 'SPLIT',
            amount_paid: nonCreditSum,
            amount_tendered: nonCreditSum,
          },
          split_payments: activeSplits,
        });

        const finalRes: CheckoutResult = {
          ...res,
          lines:
            res.lines && res.lines.length > 0
              ? res.lines
              : cart.map((c) => ({
                  name: c.product.name,
                  sku: c.product.sku,
                  quantity: c.quantity,
                  unit_price: c.unit_price,
                  total: c.quantity * c.unit_price,
                })),
        };
        playSound(true);
        onSuccess(finalRes);
      });
      return;
    }

    if (method === 'CASH' && tenderedCents < totalCents) {
      toast('المبلغ المستلم من العميل أقل من إجمالي الفاتورة');
      return;
    }
    if (method === 'CREDIT' && customer.id === 'walk-in-customer') {
      toast('لا يمكن البيع الآجل للعميل الطائر. يرجى اختيار عميل مسجل.');
      return;
    }

    void act(async () => {
      if (!(await revalidateStock())) return;
      const res = await api<CheckoutResult>('/pos/checkout', 'POST', {
        branch_id: branchId,
        shift_id: shiftId,
        party_id: customer.id,
        date: new Date().toISOString().slice(0, 10),
        discount: discountCents,
        lines: cart.map((c) => ({
          product_id: c.product.id,
          quantity: c.quantity,
          unit_price: c.unit_price,
        })),
        payment: {
          method,
          amount_paid: method === 'CREDIT' ? 0 : totalCents,
          amount_tendered: method === 'CASH' ? tenderedCents : totalCents,
          reference:
            method === 'CARD'
              ? cardRef.trim() || undefined
              : method === 'BANK'
                ? bankRef.trim() || undefined
                : undefined,
        },
      });
      const finalRes: CheckoutResult = {
        ...res,
        lines:
          res.lines && res.lines.length > 0
            ? res.lines
            : cart.map((c) => ({
                name: c.product.name,
                sku: c.product.sku,
                quantity: c.quantity,
                unit_price: c.unit_price,
                total: c.quantity * c.unit_price,
              })),
      };
      playSound(true);
      onSuccess(finalRes);
    });
  };

  return (
    <Modal
      title="إتمام عملية الدفع وإنهاء الطلب (F2)"
      description={`المبلغ المطلوب سداده: ${money(totalCents)} ج.م`}
      onClose={onClose}
    >
      <form onSubmit={handleSubmit}>
        <div className="modal-body form-grid" style={{ maxHeight: '74vh', overflowY: 'auto' }}>
          {/* Total Display Banner */}
          <div className="pos-checkout-amount-banner">
            <div>
              <span>المبلغ المستحق:</span>
              <strong style={{ display: 'block' }}>{money(totalCents)} ج.م</strong>
            </div>

            <button
              type="button"
              onClick={() => setSplitMode(!splitMode)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '8px 14px',
                background: splitMode ? '#4f46e5' : '#ffffff',
                color: splitMode ? '#ffffff' : '#4f46e5',
                border: '1px solid #4f46e5',
                borderRadius: '8px',
                cursor: 'pointer',
                fontWeight: 700,
                fontSize: '13px',
              }}
            >
              {splitMode ? '✓ إلغاء الدفع المجزأ' : '⚡ دفع مجزأ (أكثر من وسيلة)'}
            </button>
          </div>

          {/* SPLIT PAYMENT MODE */}
          {splitMode ? (
            <div className="pos-split-mode-box">
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <strong style={{ fontSize: '13.5px', color: 'var(--slate-800)' }}>
                  توزيع مبلغ الفاتورة على وسائل الدفع:
                </strong>
                <span
                  className={
                    'pos-split-status-bar ' + (splitRemainingCents === 0 ? 'matched' : 'unmatched')
                  }
                  style={{ padding: '4px 10px', fontSize: '12.5px' }}
                >
                  {splitRemainingCents === 0 ? (
                    <span>✓ المبلغ موزع بالكامل</span>
                  ) : splitRemainingCents > 0 ? (
                    <span>متبقي للتوزيع: {money(splitRemainingCents)} ج.م</span>
                  ) : (
                    <span>زيادة في التوزيع: {money(Math.abs(splitRemainingCents))} ج.م</span>
                  )}
                </span>
              </div>

              {/* Cash Split Row */}
              <div className="pos-split-row">
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 600 }}>
                  <Coins size={16} style={{ color: '#d97706' }} />
                  <span>نقداً (كاش):</span>
                </div>
                <input
                  type="number"
                  step="any"
                  min="0"
                  value={splitCash}
                  onChange={(e) => setSplitCash(e.target.value)}
                  placeholder="المبلغ كاش"
                  style={{ padding: '6px 8px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
                />
                <span style={{ fontSize: '12px', color: 'var(--slate-500)' }}>من الدرج</span>
              </div>

              {/* Card Split Row */}
              <div className="pos-split-row">
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 600 }}>
                  <CreditCard size={16} style={{ color: '#2563eb' }} />
                  <span>بطاقة / فيزا:</span>
                </div>
                <input
                  type="number"
                  step="any"
                  min="0"
                  value={splitCard}
                  onChange={(e) => setSplitCard(e.target.value)}
                  placeholder="المبلغ بالفيزا"
                  style={{ padding: '6px 8px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
                />
                <input
                  type="text"
                  placeholder="رقم إيصال الماكينة (اختياري)"
                  value={splitCardRef}
                  onChange={(e) => setSplitCardRef(e.target.value)}
                  style={{ padding: '6px 8px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
                />
              </div>

              {/* InstaPay Split Row */}
              <div className="pos-split-row">
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 600 }}>
                  <Building size={16} style={{ color: '#059669' }} />
                  <span>إنستاباي / محفظة:</span>
                </div>
                <input
                  type="number"
                  step="any"
                  min="0"
                  value={splitBank}
                  onChange={(e) => setSplitBank(e.target.value)}
                  placeholder="المبلغ عبر إنستاباي"
                  style={{ padding: '6px 8px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
                />
                <input
                  type="text"
                  placeholder="رقم العملية المرجعي / IPN"
                  value={splitBankRef}
                  onChange={(e) => setSplitBankRef(e.target.value)}
                  style={{ padding: '6px 8px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
                />
              </div>

              {/* Credit Split Row */}
              <div className="pos-split-row">
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 600 }}>
                  <Clock size={16} style={{ color: '#7c3aed' }} />
                  <span>آجل (على الحساب):</span>
                </div>
                <input
                  type="number"
                  step="any"
                  min="0"
                  disabled={customer.id === 'walk-in-customer'}
                  value={splitCredit}
                  onChange={(e) => setSplitCredit(e.target.value)}
                  placeholder="المبلغ الآجل"
                  style={{ padding: '6px 8px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
                />
                <span style={{ fontSize: '12px', color: 'var(--slate-500)' }}>
                  {customer.id === 'walk-in-customer'
                    ? 'يتطلب اختيار عميل مسجل'
                    : `على حساب: ${customer.name}`}
                </span>
              </div>
            </div>
          ) : (
            <>
              {/* Standard Single Payment Method Selector */}
              <div className="pos-payment-methods">
                <button
                  type="button"
                  className={'pos-pay-method-btn ' + (method === 'CASH' ? 'active' : '')}
                  onClick={() => {
                    setMethod('CASH');
                    setAmountTendered((totalCents / 100).toFixed(2));
                  }}
                >
                  <Coins size={20} />
                  <span>نقداً (كاش)</span>
                </button>

                <button
                  type="button"
                  className={'pos-pay-method-btn ' + (method === 'CARD' ? 'active' : '')}
                  onClick={() => {
                    setMethod('CARD');
                    setAmountTendered((totalCents / 100).toFixed(2));
                  }}
                >
                  <CreditCard size={20} />
                  <span>بطاقة بنكية / فيزا</span>
                </button>

                <button
                  type="button"
                  className={'pos-pay-method-btn ' + (method === 'BANK' ? 'active' : '')}
                  onClick={() => {
                    setMethod('BANK');
                    setAmountTendered((totalCents / 100).toFixed(2));
                  }}
                >
                  <Building size={20} />
                  <span>محفظة / إنستاباي</span>
                </button>

                <button
                  type="button"
                  className={'pos-pay-method-btn ' + (method === 'CREDIT' ? 'active' : '')}
                  onClick={() => {
                    setMethod('CREDIT');
                    setAmountTendered('0');
                  }}
                >
                  <Clock size={20} />
                  <span>آجل (على الحساب)</span>
                </button>
              </div>

              {/* Cash Tender & Quick Buttons */}
              {method === 'CASH' && (
                <div className="pos-cash-tender-section">
                  <Field label="المبلغ المستلم من العميل (ج.م) *">
                    <input
                      type="number"
                      step="any"
                      min={totalCents / 100}
                      required
                      autoFocus
                      value={amountTendered}
                      onChange={(e) => setAmountTendered(e.target.value)}
                    />
                  </Field>

                  <div className="pos-quick-cash-chips">
                    {quickCashOptions.map((opt) => (
                      <button
                        key={opt.label}
                        type="button"
                        className="pos-quick-cash-chip"
                        onClick={() => setAmountTendered((opt.val / 100).toFixed(2))}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>

                  {/* Change Due Card */}
                  <div className="pos-change-card">
                    <span>الباقي للعميل:</span>
                    <strong className={changeDueCents > 0 ? 'has-change' : ''}>
                      {money(changeDueCents)} ج.م
                    </strong>
                  </div>
                </div>
              )}

              {/* Card Reference Input */}
              {method === 'CARD' && (
                <div className="pos-tender-section-box">
                  <Field label="رقم إيصال ماكينة الدفع / الفيزا (Slip # / RRN) - لمطابقة الوردية">
                    <input
                      type="text"
                      autoFocus
                      placeholder="مثال: SLIP-4921 / 003829"
                      value={cardRef}
                      onChange={(e) => setCardRef(e.target.value)}
                    />
                  </Field>
                </div>
              )}

              {/* InstaPay Reference Input */}
              {method === 'BANK' && (
                <div className="pos-tender-section-box">
                  <Field label="رقم العملية المرجعي / إنستاباي (InstaPay Ref #) - إثبات التحويل">
                    <input
                      type="text"
                      autoFocus
                      placeholder="مثال: IPN-89214792 / 123456"
                      value={bankRef}
                      onChange={(e) => setBankRef(e.target.value)}
                    />
                  </Field>
                </div>
              )}

              {method === 'CREDIT' && customer.id === 'walk-in-customer' && (
                <div className="warning-banner">
                  ⚠️ لا يمكن إتمام عملية بيع آجل لـ «عميل نقدي طائر». يرجى اختيار عميل مسجل أولاً.
                </div>
              )}
            </>
          )}
        </div>

        <div className="modal-footer">
          <Button
            type="submit"
            busy={busy}
            disabled={
              splitMode
                ? splitRemainingCents !== 0
                : method === 'CREDIT' && customer.id === 'walk-in-customer'
            }
          >
            تأكيد الدفع وطباعة الإيصال
          </Button>
          <Button type="button" variant="secondary" onClick={onClose}>
            إلغاء
          </Button>
        </div>
      </form>
    </Modal>
  );
}
