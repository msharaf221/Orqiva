import { useEffect, useState } from 'react';
import { Search, Undo2, Coins, CreditCard, Building } from 'lucide-react';
import { api, Button, Modal, money, useAction, useToast, useDebounced } from '../../lib';
import type { Document, ReturnableLine } from '../../types';
import { playSound } from './helpers';

/**
 * Cashier refund flow invoked straight from the till.
 *
 * The cashier finds the original sale by receipt number, picks the quantities coming back,
 * and the server posts a SALE_RETURN (credit note) linked to the same shift so the drawer
 * reconciliation nets the refund automatically.
 */
export function PosReturnModal({
  branchId,
  onClose,
  onDone,
}: {
  branchId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { busy, act } = useAction();
  const toast = useToast();
  const [query, setQuery] = useState('');
  const q = useDebounced(query, 250);
  const [results, setResults] = useState<Document[]>([]);
  const [searching, setSearching] = useState(false);
  const [sale, setSale] = useState<Document | null>(null);
  const [lines, setLines] = useState<ReturnableLine[]>([]);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [method, setMethod] = useState<'CASH' | 'CARD' | 'BANK'>('CASH');
  const [reference, setReference] = useState('');

  const search = async (term: string) => {
    if (!term.trim()) {
      setResults([]);
      return;
    }
    setSearching(true);
    try {
      setResults(
        await api<Document[]>(
          `/pos/sales/lookup?q=${encodeURIComponent(term.trim())}&branch_id=${branchId}`,
        ),
      );
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  };

  // Debounced lookup as the cashier types the invoice number.
  useEffect(() => {
    void search(q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const openSale = async (doc: Document) => {
    try {
      const returnable = await api<ReturnableLine[]>(`/pos/sales/${doc.id}/returnable`);
      if (!returnable.some((l) => l.returnable > 0)) {
        playSound(false);
        toast('تم إرجاع كامل هذه الفاتورة بالفعل.');
        return;
      }
      setSale(doc);
      setLines(returnable);
      setQuantities({});
    } catch (err: any) {
      toast(err.message || 'تعذر تحميل أصناف الفاتورة');
    }
  };

  const setQty = (productId: string, qty: number, max: number) => {
    setQuantities((prev) => ({ ...prev, [productId]: Math.max(0, Math.min(qty, max)) }));
  };

  const chosen = lines
    .map((l) => ({ product_id: l.product_id, quantity: quantities[l.product_id] || 0 }))
    .filter((l) => l.quantity > 0);

  const refundSubtotal = lines.reduce(
    (sum, l) => sum + (quantities[l.product_id] || 0) * l.unit_price,
    0,
  );
  const taxRate = sale?.tax_rate ?? 0;
  const refundTax = Math.round((refundSubtotal * taxRate) / 10000);
  const refundTotal = refundSubtotal + refundTax;

  const submit = () => {
    if (!sale || chosen.length === 0) return;
    void act(async () => {
      await api('/pos/return', 'POST', {
        document_id: sale.id,
        method,
        reference: reference.trim() || undefined,
        lines: chosen,
      });
      playSound(true);
      toast(`تم تسجيل المرتجع بقيمة ${money(refundTotal)} ج.م وخصمه من الدرج.`);
      onDone();
    }, undefined);
  };

  // Step 1: pick the invoice.
  if (!sale) {
    return (
      <Modal
        title="إرجاع فاتورة بيع (مرتجع كاشير)"
        description="ابحث برقم الفاتورة ثم اختر الأصناف المرتجعة"
        onClose={onClose}
        sheet
      >
        <div className="modal-body">
          <div className="pos-search-input-wrap">
            <Search size={16} />
            <input
              type="text"
              autoFocus
              placeholder="رقم الفاتورة أو الكود الداخلي..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          <div className="pos-return-results">
            {searching ? (
              <p className="muted">جاري البحث...</p>
            ) : results.length === 0 ? (
              <p className="muted">
                {query.trim()
                  ? 'لا توجد فواتير مطابقة.'
                  : 'اكتب رقم الفاتورة (المطبوع على الإيصال) للبحث.'}
              </p>
            ) : (
              results.map((doc) => (
                <button
                  key={doc.id}
                  type="button"
                  className="pos-return-sale"
                  onClick={() => void openSale(doc)}
                >
                  <div className="pos-return-sale-info">
                    <strong className="num">#{doc.number}</strong>
                    <small className="muted">
                      {doc.party_name} · {doc.date}
                    </small>
                  </div>
                  <span className="pos-return-sale-total">{money(doc.total)} ج.م</span>
                </button>
              ))
            )}
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

  // Step 2: choose quantities and refund method.
  return (
    <Modal
      title={`إرجاع عن الفاتورة #${sale.number}`}
      description={`${sale.party_name} · ${sale.date}`}
      onClose={onClose}
      wide
      sheet
    >
      <div className="modal-body">
        <div className="table-scroll">
          <table className="data-table pos-return-table">
            <thead>
              <tr>
                <th>الصنف</th>
                <th>السعر</th>
                <th>المُرتجع سابقاً</th>
                <th>القابل للإرجاع</th>
                <th>الكمية المرتجعة</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.product_id}>
                  <td>
                    <strong>{l.name}</strong>
                    <small className="muted num">{l.sku}</small>
                  </td>
                  <td className="num">{money(l.unit_price)}</td>
                  <td className="num">{l.already_returned}</td>
                  <td className="num">{l.returnable}</td>
                  <td>
                    <input
                      type="number"
                      min="0"
                      max={l.returnable}
                      disabled={l.returnable === 0}
                      value={quantities[l.product_id] || 0}
                      onChange={(e) =>
                        setQty(l.product_id, parseInt(e.target.value) || 0, l.returnable)
                      }
                      className="pos-return-qty"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="pos-payment-methods">
          <button
            type="button"
            className={'pos-pay-method-btn ' + (method === 'CASH' ? 'active' : '')}
            onClick={() => setMethod('CASH')}
          >
            <Coins size={18} /> رد نقدي من الدرج
          </button>
          <button
            type="button"
            className={'pos-pay-method-btn ' + (method === 'CARD' ? 'active' : '')}
            onClick={() => setMethod('CARD')}
          >
            <CreditCard size={18} /> رد على البطاقة
          </button>
          <button
            type="button"
            className={'pos-pay-method-btn ' + (method === 'BANK' ? 'active' : '')}
            onClick={() => setMethod('BANK')}
          >
            <Building size={18} /> رد على المحفظة
          </button>
        </div>

        <div className="form-grid">
          <label className="field">
            <span>مرجع الرد (اختياري)</span>
            <input
              type="text"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="رقم مرجع العملية / إيصال الماكينة"
            />
          </label>
        </div>

        <div className="pos-return-summary">
          <div>
            <span>قيمة الأصناف المرتجعة:</span>
            <b className="num">{money(refundSubtotal)} ج.م</b>
          </div>
          <div>
            <span>ضريبة القيمة المضافة:</span>
            <b className="num">{money(refundTax)} ج.م</b>
          </div>
          <div className="pos-return-summary-total">
            <span>إجمالي المردود للعميل:</span>
            <strong className="num">{money(refundTotal)} ج.م</strong>
          </div>
        </div>
      </div>

      <div className="modal-footer">
        <Button onClick={submit} busy={busy} disabled={chosen.length === 0}>
          <Undo2 size={16} /> تأكيد الإرجاع ({chosen.length} صنف)
        </Button>
        <Button variant="secondary" onClick={() => setSale(null)}>
          رجوع للبحث
        </Button>
      </div>
    </Modal>
  );
}
