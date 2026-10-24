import { useEffect, useRef, useState } from 'react';
import JsBarcode from 'jsbarcode';
import QRCode from 'qrcode';
import { TAX_FREE } from './config';

export interface InvoiceQrPayload {
  sellerName: string;
  taxNumber?: string;
  invoiceNumber: string;
  invoiceDate: string;
  total: number; // in cents
  tax: number; // in cents
  /** UBL 2.1 document UUID (ETA). Falls back to invoice number when absent. */
  uuid?: string;
  /** ISO-8601 issuance timestamp used by the ETA TLV QR; defaults to invoice date. */
  timestamp?: string;
}

function base64FromBytes(bytes: number[]): string {
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

/**
 * Builds the Egyptian Tax Authority TLV QR payload (base64).
 * Tags: 1=Seller, 2=VAT number, 3=Timestamp, 4=Total, 5=VAT total.
 * Mirrors `buildEtaQrData` on the server so printed receipts verify in the ETA app.
 */
export function buildEtaTlvQr(payload: {
  sellerName: string;
  taxNumber: string;
  timestamp: string;
  total: number;
  tax: number;
}): string {
  const records: Array<[number, string]> = [
    [1, payload.sellerName],
    [2, payload.taxNumber],
    [3, payload.timestamp],
    [4, (payload.total / 100).toFixed(2)],
    [5, (payload.tax / 100).toFixed(2)],
  ];
  const bytes: number[] = [];
  for (const [tag, value] of records) {
    const utf8 = Array.from(new TextEncoder().encode(value));
    bytes.push(tag, utf8.length, ...utf8);
  }
  return base64FromBytes(bytes);
}

/**
 * Formats data for electronic invoice verification QR code.
 * Returns the ETA TLV base64 payload when tax identity is available; otherwise a
 * human-readable summary so offline/test receipts still carry a scannable code.
 */
export function generateInvoiceQrData(data: InvoiceQrPayload): string {
  const totalFormatted = (data.total / 100).toFixed(2);
  const taxFormatted = (data.tax / 100).toFixed(2);

  if (data.taxNumber) {
    return buildEtaTlvQr({
      sellerName: data.sellerName,
      taxNumber: data.taxNumber,
      timestamp: data.timestamp || normalizeTimestamp(data.invoiceDate),
      total: data.total,
      tax: data.tax,
    });
  }

  // Human-friendly readable invoice data for smartphone cameras (no tax identity yet)
  return [
    `مؤسسة: ${data.sellerName}`,
    `فاتورة: ${data.invoiceNumber}`,
    `التاريخ: ${data.invoiceDate}`,
    `الإجمالي: ${totalFormatted} ج.م`,
    ...(TAX_FREE ? [] : [`الضريبة: ${taxFormatted} ج.م`]),
    'نظام أوركيفا Orqiva ERP',
  ].join('\n');
}

/** Best-effort ISO-8601 conversion; returns the input when it cannot be parsed. */
function normalizeTimestamp(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
}

/**
 * High-definition vector SVG Barcode (Code 128)
 */
export function BarcodeSvg({
  value,
  width = 1.3,
  height = 36,
  fontSize = 11,
  displayValue = true,
  className = '',
}: {
  value: string;
  width?: number;
  height?: number;
  fontSize?: number;
  displayValue?: boolean;
  className?: string;
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    if (!svgRef.current || !value) return;
    try {
      JsBarcode(svgRef.current, value, {
        format: 'CODE128',
        width,
        height,
        displayValue,
        fontSize,
        font: 'Cairo, IBM Plex Sans Arabic, monospace',
        margin: 4,
        background: 'transparent',
        lineColor: '#000000',
      });
    } catch {
      // Fallback: don't crash if text has invalid barcode characters
    }
  }, [value, width, height, fontSize, displayValue]);

  return <svg ref={svgRef} className={`barcode-svg ${className}`} style={{ maxWidth: '100%' }} />;
}

/**
 * High-definition vector SVG QR Code
 */
export function QrCodeSvg({
  value,
  size = 110,
  className = '',
}: {
  value: string;
  size?: number;
  className?: string;
}) {
  const [svgHtml, setSvgHtml] = useState<string>('');

  useEffect(() => {
    if (!value) return;
    QRCode.toString(value, {
      type: 'svg',
      width: size,
      margin: 1,
      color: {
        dark: '#000000',
        light: '#ffffff',
      },
    })
      .then((svg: string) => {
        setSvgHtml(svg);
      })
      .catch(() => {
        // Fallback
      });
  }, [value, size]);

  if (!svgHtml) {
    return <div style={{ width: size, height: size }} className={className} />;
  }

  return (
    <div
      className={`qr-code-svg-container ${className}`}
      style={{ display: 'inline-block', lineHeight: 0 }}
      dangerouslySetInnerHTML={{ __html: svgHtml }}
    />
  );
}

/**
 * Official invoice rubber stamp (Paid / Posted / Draft / Overdue)
 */
export function StatusStamp({
  status,
  isReturn = false,
  date,
}: {
  status: 'draft' | 'cancelled' | 'paid' | 'overdue' | 'partial' | 'pending';
  isReturn?: boolean;
  date?: string;
}) {
  const labels: Record<string, { ar: string; en: string; color: string }> = {
    paid: {
      ar: isReturn ? 'معتمد ومسوّى' : 'مدفوعة بالكامل',
      en: isReturn ? 'APPROVED' : 'PAID IN FULL',
      color: '#059669',
    },
    draft: {
      ar: 'مسودة تجريبية',
      en: 'DRAFT INVOICE',
      color: '#d97706',
    },
    cancelled: {
      ar: 'فاتورة ملغاة',
      en: 'CANCELLED',
      color: '#dc2626',
    },
    overdue: {
      ar: 'مستحقة السداد',
      en: 'OVERDUE',
      color: '#dc2626',
    },
    partial: {
      ar: 'مدفوعة جزئياً',
      en: 'PARTIALLY PAID',
      color: '#2563eb',
    },
    pending: {
      ar: 'بانتظار التحصيل',
      en: 'PAYMENT PENDING',
      color: '#7c3aed',
    },
  };

  const current = labels[status] || labels.paid;

  return (
    <div
      className="invoice-official-stamp"
      style={{ borderColor: current.color, color: current.color }}
    >
      <div className="stamp-inner" style={{ borderColor: current.color }}>
        <span className="stamp-title-ar">{current.ar}</span>
        <span className="stamp-title-en">{current.en}</span>
        {date && <span className="stamp-date">{date}</span>}
      </div>
    </div>
  );
}

/**
 * Triggers thermal receipt print with dynamic 80mm roll page styles.
 */
export function triggerThermalPrint() {
  // Inject dedicated 80mm continuous roll page style for POS thermal printers
  let styleEl = document.getElementById('thermal-print-page-style') as HTMLStyleElement | null;
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = 'thermal-print-page-style';
    styleEl.textContent = `
      @media print {
        @page {
          size: 80mm auto !important;
          margin: 0 !important;
        }
      }
    `;
    document.head.appendChild(styleEl);
  }

  document.body.classList.add('printing-pos-receipt');

  const cleanup = () => {
    document.body.classList.remove('printing-pos-receipt');
    window.removeEventListener('afterprint', cleanup);
    if (styleEl && styleEl.parentNode) {
      styleEl.parentNode.removeChild(styleEl);
    }
  };

  window.addEventListener('afterprint', cleanup);
  window.print();

  setTimeout(cleanup, 2000);
}

export interface ReceiptItemLine {
  id?: string;
  name: string;
  sku?: string;
  quantity: number;
  unit_price: number;
  total: number;
}

export interface ReceiptData {
  document: {
    id: string;
    number: string;
    date: string;
    total: number;
    subtotal: number;
    discount: number;
    tax: number;
    tax_rate?: number;
    notes?: string;
  };
  lines?: ReceiptItemLine[];
  payment?: {
    method: string;
    amount_paid?: number;
    amount_tendered?: number;
    change_due?: number;
    reference?: string;
    splits?: Array<{ method: string; amount: number; reference?: string }>;
  };
}

/**
 * The pure thermal receipt layout (80mm standard continuous receipt)
 */
export function ThermalReceiptPaper({
  result,
  companyName,
  taxNumber,
  branchName,
  cashierName,
  customerName,
  ecoMode = false,
  showCashier = true,
}: {
  result: ReceiptData;
  companyName: string;
  taxNumber?: string;
  branchName: string;
  cashierName?: string;
  customerName?: string;
  ecoMode?: boolean;
  showCashier?: boolean;
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

  const method = result.payment?.method || 'CASH';
  const paymentMethodLabel =
    method === 'SPLIT'
      ? 'دفع مجزأ (متعدد الوسائل)'
      : method === 'CASH'
        ? 'نقداً (كاش)'
        : method === 'CARD'
          ? 'بطاقة دفع إلكتروني (فيزا / ماستر)'
          : method === 'BANK'
            ? 'محفظة إلكترونية / إنستاباي'
            : 'حساب آجل (ذمم مدينة)';

  const formatMoney = (cents: number) =>
    (cents / 100).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

  return (
    <div className={`thermal-receipt ${ecoMode ? 'eco-mode' : ''}`} id="printable-pos-receipt">
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
          <span>{TAX_FREE ? 'فاتورة بيع مبسطة' : 'فاتورة ضريبية مبسطة'}</span>
          <small>{TAX_FREE ? 'SIMPLIFIED INVOICE' : 'SIMPLIFIED TAX INVOICE'}</small>
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
          {showCashier && cashierName && (
            <div className="meta-item">
              <span className="meta-label">الكاشير:</span>
              <span className="meta-value">{cashierName}</span>
            </div>
          )}
          {customerName && (
            <div className="meta-item">
              <span className="meta-label">العميل:</span>
              <span className="meta-value">{customerName}</span>
            </div>
          )}
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
                  <td className="col-price num">{formatMoney(line.unit_price)}</td>
                  <td className="col-total num">{formatMoney(line.total)}</td>
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
          <span>{TAX_FREE ? 'المجموع الفرعي:' : 'المجموع الفرعي (قبل الضريبة):'}</span>
          <span className="num">{formatMoney(result.document.subtotal)} ج.م</span>
        </div>

        {result.document.discount > 0 && (
          <div className="receipt-row discount-row">
            <span>خصم الفاتورة:</span>
            <span className="num text-red">-{formatMoney(result.document.discount)} ج.م</span>
          </div>
        )}

        {!TAX_FREE && (
          <div className="receipt-row">
            <span>
              ضريبة القيمة المضافة ({((result.document.tax_rate ?? 1400) / 100).toFixed(0)}%):
            </span>
            <span className="num">{formatMoney(result.document.tax)} ج.م</span>
          </div>
        )}

        <div className="receipt-cut-line double-cut" />

        <div className="receipt-row grand-total-highlight">
          <span className="label">الإجمالي النهائي:</span>
          <span className="num value">{formatMoney(result.document.total)} ج.م</span>
        </div>

        <div className="receipt-cut-line double-cut" />

        {/* Payment Details */}
        <div className="receipt-row payment-method-row">
          <span>طريقة الدفع:</span>
          <span className="font-semibold">{paymentMethodLabel}</span>
        </div>

        {result.payment?.reference && (
          <div className="receipt-row" style={{ fontSize: '11px', color: '#334155' }}>
            <span>مرجع / إيصال الدفع:</span>
            <span className="font-semibold num">{result.payment.reference}</span>
          </div>
        )}

        {result.payment?.splits && result.payment.splits.length > 0 && (
          <div style={{ margin: '4px 0 6px', padding: '4px 0', borderTop: '1px dashed #cbd5e1' }}>
            {result.payment.splits.map((s, idx) => (
              <div key={idx} className="receipt-row" style={{ fontSize: '11px', color: '#475569' }}>
                <span>
                  {s.method === 'CASH'
                    ? 'كاش'
                    : s.method === 'CARD'
                      ? 'فيزا / بطاقة'
                      : 'إنستاباي / محفظة'}
                  {s.reference ? ` (${s.reference})` : ''}:
                </span>
                <span className="num font-semibold">{formatMoney(s.amount)} ج.م</span>
              </div>
            ))}
          </div>
        )}

        {method === 'CASH' && (
          <>
            <div className="receipt-row">
              <span>المبلغ المستلم (المدفوع):</span>
              <span className="num">
                {formatMoney(result.payment?.amount_tendered || result.document.total)} ج.م
              </span>
            </div>
            {(result.payment?.change_due ?? 0) > 0 && (
              <div className="receipt-row change-highlight">
                <span>المتبقي للعميل (الباقي):</span>
                <span className="num change-amount">
                  {formatMoney(result.payment?.change_due || 0)} ج.م
                </span>
              </div>
            )}
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
          البضاعة المباعة ترد وتستبدل خلال 14 يوماً وفقاً لقانون حماية المستهلك مع إحضار الفاتورة
        </p>
        <p className="thanks-note">شكراً لزيارتكم! نتشرف بخدمتكم دائماً ❤️</p>
        <small className="system-credit">أوركيفا لإدارة نقاط البيع · Orqiva Cloud POS</small>
      </div>
    </div>
  );
}
