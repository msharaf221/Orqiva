import { Printer } from 'lucide-react';
import { Button, Modal, money } from '../../lib';
import {
  BarcodeSvg,
  QrCodeSvg,
  triggerThermalPrint,
  generateInvoiceQrData,
} from '../../receipt-components';
import type { CheckoutResult } from './helpers';

export function ThermalReceiptModal({
  result,
  companyName,
  taxNumber,
  branchName,
  cashierName,
  customerName,
  onClose,
}: {
  result: CheckoutResult;
  companyName: string;
  taxNumber?: string;
  branchName: string;
  cashierName: string;
  customerName: string;
  onClose: () => void;
}) {
  const invoiceDateStr = result.document.date || new Date().toLocaleDateString('ar-EG');
  const invoiceTimeStr = new Date().toLocaleTimeString('ar-EG', {
    hour: '2-digit',
    minute: '2-digit',
  });

  const qrData = generateInvoiceQrData({
    sellerName: companyName,
    taxNumber,
    invoiceNumber: result.document.number,
    invoiceDate: `${invoiceDateStr} ${invoiceTimeStr}`,
    total: result.document.total,
    tax: result.document.tax,
  });

  const paymentMethodLabel =
    result.payment.method === 'CASH'
      ? 'نقداً (كاش)'
      : result.payment.method === 'CARD'
        ? 'بطاقة دفع إلكتروني (شبكة / فيزا)'
        : result.payment.method === 'BANK'
          ? 'محفظة إلكترونية / إنستاباي'
          : result.payment.method === 'SPLIT'
            ? 'دفع مجزأ (متعدد الوسائل)'
            : 'حساب آجل (ذمم مدينة)';

  return (
    <Modal title="إيصال استلام نقطة البيع (POS)" onClose={onClose}>
      <div className="modal-body pos-receipt-wrapper">
        <div className="thermal-receipt" id="printable-pos-receipt">
          {/* Receipt Header */}
          <div className="receipt-header">
            <div className="receipt-brand-badge">ORQIVA POS</div>
            <h3 className="receipt-company-title">{companyName}</h3>
            {taxNumber && (
              <div className="receipt-tax-badge">
                <span>الرقم الضريبي: {taxNumber}</span>
              </div>
            )}
            <p className="receipt-branch-name">فرع: {branchName}</p>
            <div className="receipt-title-box">
              <span>فاتورة ضريبية مبسطة</span>
              <small>SIMPLIFIED TAX INVOICE</small>
            </div>
            <div className="receipt-cut-line" />
            <div className="receipt-meta-grid">
              <div className="meta-item">
                <span className="meta-label">رقم الفاتورة:</span>
                <span className="meta-value bold num">#{result.document.number}</span>
              </div>
              <div className="meta-item">
                <span className="meta-label">التاريخ والوقت:</span>
                <span className="meta-value num">
                  {invoiceDateStr} - {invoiceTimeStr}
                </span>
              </div>
              <div className="meta-item">
                <span className="meta-label">الكاشير:</span>
                <span className="meta-value">{cashierName}</span>
              </div>
              <div className="meta-item">
                <span className="meta-label">العميل:</span>
                <span className="meta-value">{customerName}</span>
              </div>
            </div>
            <div className="receipt-cut-line" />
          </div>

          {/* Itemized Lines Table */}
          {result.lines && result.lines.length > 0 && (
            <div className="receipt-items-container">
              <table className="receipt-items-table">
                <thead>
                  <tr>
                    <th className="col-item">الصنف</th>
                    <th className="col-qty">الكمية</th>
                    <th className="col-price">السعر</th>
                    <th className="col-total">الإجمالي</th>
                  </tr>
                </thead>
                <tbody>
                  {result.lines.map((line, idx) => (
                    <tr key={idx}>
                      <td className="col-item">
                        <div className="item-name">{line.name}</div>
                        {line.sku && <small className="item-sku num">{line.sku}</small>}
                      </td>
                      <td className="col-qty num">{line.quantity}</td>
                      <td className="col-price num">{money(line.unit_price)}</td>
                      <td className="col-total num">{money(line.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="receipt-cut-line" />
            </div>
          )}

          {/* Financial Totals */}
          <div className="receipt-totals">
            <div className="receipt-row">
              <span>المجموع الفرعي (قبل الضريبة):</span>
              <span className="num">{money(result.document.subtotal)} ج.م</span>
            </div>

            {result.document.discount > 0 && (
              <div className="receipt-row discount-row">
                <span>خصم الفاتورة:</span>
                <span className="num text-red">-{money(result.document.discount)} ج.م</span>
              </div>
            )}

            <div className="receipt-row">
              <span>
                ضريبة القيمة المضافة ({((result.document.tax_rate ?? 1400) / 100).toFixed(0)}%):
              </span>
              <span className="num">{money(result.document.tax)} ج.م</span>
            </div>

            <div className="receipt-cut-line double-cut" />

            <div className="receipt-row grand-total-highlight">
              <span className="label">الإجمالي النهائي:</span>
              <span className="num value">{money(result.document.total)} ج.م</span>
            </div>

            <div className="receipt-cut-line double-cut" />

            {/* Payment Details */}
            <div className="receipt-row payment-method-row">
              <span>طريقة الدفع:</span>
              <span className="font-semibold">{paymentMethodLabel}</span>
            </div>

            {result.payment.reference && (
              <div className="receipt-row">
                <span>رقم إيصال / مرجع الدفع:</span>
                <span className="num font-semibold">{result.payment.reference}</span>
              </div>
            )}

            {/* Split payments breakdown on receipt */}
            {result.payment.splits && result.payment.splits.length > 0 && (
              <div style={{ margin: '4px 0', padding: '4px 0', borderTop: '1px dashed #e2e8f0' }}>
                <span style={{ fontSize: '11px', color: '#64748b', fontWeight: 600 }}>
                  تفاصيل الدفع المجزأ:
                </span>
                {result.payment.splits.map((s, idx) => (
                  <div
                    key={idx}
                    className="receipt-row"
                    style={{ fontSize: '11px', color: '#334155' }}
                  >
                    <span>
                      •{' '}
                      {s.method === 'CASH'
                        ? 'كاش'
                        : s.method === 'CARD'
                          ? 'فيزا'
                          : s.method === 'BANK'
                            ? 'إنستاباي'
                            : 'آجل'}
                      {s.reference ? ` (مرجع: ${s.reference})` : ''}:
                    </span>
                    <span className="num">{money(s.amount)} ج.م</span>
                  </div>
                ))}
              </div>
            )}

            {result.payment.method === 'CASH' && (
              <>
                <div className="receipt-row">
                  <span>المبلغ المستلم (المدفوع):</span>
                  <span className="num">
                    {money(result.payment.amount_tendered || result.document.total)} ج.م
                  </span>
                </div>
                <div className="receipt-row change-highlight">
                  <span>المتبقي للعميل (الباقي):</span>
                  <span className="num change-amount">{money(result.payment.change_due)} ج.م</span>
                </div>
              </>
            )}
          </div>

          {/* Electronic QR Code & Barcode */}
          <div className="receipt-verification-section">
            <div className="receipt-cut-line" />
            <div className="receipt-qr-box">
              <QrCodeSvg value={qrData} size={105} />
              <small className="qr-hint">امسح للتحقق من الفاتورة الإلكترونية</small>
            </div>
            <div className="receipt-barcode-box">
              <BarcodeSvg value={result.document.number} height={34} fontSize={10} />
            </div>
          </div>

          {/* Receipt Footer */}
          <div className="receipt-footer">
            <div className="receipt-cut-line" />
            <p className="policy-note">
              البضاعة المباعة ترد وتستبدل خلال 14 يوماً وفقاً لقانون حماية المستهلك مع إحضار
              الفاتورة
            </p>
            <p className="thanks-note">شكراً لزيارتكم! نتشرف بخدمتكم دائماً ❤️</p>
            <small className="system-credit">أوركيفا لإدارة نقاط البيع · Orqiva Cloud POS</small>
          </div>
        </div>
      </div>

      <div className="modal-footer">
        <Button onClick={triggerThermalPrint}>
          <Printer size={16} /> طباعة الإيصال (Ctrl+P)
        </Button>
        <Button variant="secondary" onClick={onClose}>
          فاتورة جديدة
        </Button>
      </div>
    </Modal>
  );
}
