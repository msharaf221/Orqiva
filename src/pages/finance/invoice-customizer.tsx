import { useState, type FormEvent } from 'react';
import {
  Palette,
  Printer,
  Check,
  Save,
  QrCode,
  Barcode,
  Landmark,
  ShieldCheck,
  Layers,
  RotateCcw,
  Eye,
} from 'lucide-react';
import { api, useSession, useAction, Button, Field, money, today, formatDate } from '../../lib';
import type { InvoiceCustomization, InvoiceLogoPosition } from '../../types';
import {
  DEFAULT_INVOICE_CUSTOMIZATION,
  INVOICE_TEMPLATES,
  COLOR_PRESETS,
  parseInvoiceCustomization,
} from '../../lib/invoice-customization';

export function InvoiceCustomizer() {
  const { company, refreshCompany } = useSession();
  const { busy, act } = useAction();

  const savedSettings = parseInvoiceCustomization(company?.invoice_settings);
  const [settings, setSettings] = useState<InvoiceCustomization>(savedSettings);
  const [previewTab, setPreviewTab] = useState<'a4' | 'thermal'>('a4');

  const updateSetting = <K extends keyof InvoiceCustomization>(
    key: K,
    val: InvoiceCustomization[K],
  ) => {
    setSettings((prev) => ({ ...prev, [key]: val }));
  };

  const handleSave = (e: FormEvent) => {
    e.preventDefault();
    void act(async () => {
      await api('/company', 'PUT', {
        name: company?.name,
        email: company?.email,
        phone: company?.phone,
        address: company?.address,
        tax_number: company?.tax_number,
        tax_registration_number: company?.tax_registration_number,
        activity_code: company?.activity_code,
        tax_rate: company?.tax_rate,
        invoice_note: company?.invoice_note,
        eta_environment: company?.eta_environment,
        invoice_settings: JSON.stringify(settings),
      });
      refreshCompany();
    }, 'تم حفظ تصميم وقالب الفواتير بنجاح');
  };

  const handleReset = () => {
    setSettings(DEFAULT_INVOICE_CUSTOMIZATION);
  };

  // Sample items for preview
  const sampleLines = [
    {
      id: '1',
      sku: 'PRD-001',
      name: 'شاشة سامسونج 27 بوصة IPS',
      quantity: 2,
      unit_price: 650000,
      total: 1300000,
    },
    {
      id: '2',
      sku: 'PRD-002',
      name: 'لوحة مفاتيح ميكانيكية لاسلكية',
      quantity: 3,
      unit_price: 180000,
      total: 540000,
    },
    {
      id: '3',
      sku: 'PRD-003',
      name: 'ماوس ليزر احترافي مريح لليد',
      quantity: 4,
      unit_price: 95000,
      total: 380000,
    },
  ];
  const sampleSubtotal = 2220000;
  const sampleTax = Math.round(sampleSubtotal * 0.14);
  const sampleTotal = sampleSubtotal + sampleTax;

  return (
    <div className="invoice-customizer-layout">
      {/* Settings Form */}
      <div className="card settings-card customizer-controls">
        <div className="card-heading">
          <div>
            <h2>تخصيص وتصميم الفواتير والمطبوعات</h2>
            <p>اختر قالب الفاتورة، لون الهوية، وبيانات الحساب البنكي والعناصر التي تظهر للعملاء.</p>
          </div>
          <span className="settings-company-icon">
            <Palette size={23} />
          </span>
        </div>

        <form
          onSubmit={handleSave}
          className="form-card-body"
          style={{ display: 'flex', flexDirection: 'column', gap: '22px' }}
        >
          {/* 1. Template Selection */}
          <div>
            <label
              className="section-label"
              style={{
                fontWeight: 700,
                fontSize: '14px',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                marginBottom: '10px',
              }}
            >
              <Layers size={17} color="var(--indigo-600)" /> قالب الفاتورة المعتمد (Template)
            </label>
            <div className="template-picker-grid">
              {INVOICE_TEMPLATES.map((tmpl) => (
                <div
                  key={tmpl.id}
                  className={`template-card-option ${settings.template === tmpl.id ? 'active' : ''}`}
                  onClick={() => updateSetting('template', tmpl.id)}
                >
                  <div className="template-option-header">
                    <strong>{tmpl.name}</strong>
                    <span className="template-badge">{tmpl.tag}</span>
                  </div>
                  <p>{tmpl.description}</p>
                </div>
              ))}
            </div>
          </div>

          {/* 2. Color Palette */}
          <div>
            <label
              className="section-label"
              style={{
                fontWeight: 700,
                fontSize: '14px',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                marginBottom: '10px',
              }}
            >
              <Palette size={17} color="var(--indigo-600)" /> لون الهوية الأساسي للفاتورة
            </label>
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
              {COLOR_PRESETS.map((color) => (
                <button
                  key={color.hex}
                  type="button"
                  className={`color-preset-circle ${settings.primaryColor === color.hex ? 'active' : ''}`}
                  style={{ background: color.hex }}
                  onClick={() => updateSetting('primaryColor', color.hex)}
                  title={color.label}
                >
                  {settings.primaryColor === color.hex && <Check size={14} color="#ffffff" />}
                </button>
              ))}
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  marginRight: '8px',
                }}
              >
                <span style={{ fontSize: '12px', color: 'var(--slate-500)' }}>لون مخصص:</span>
                <input
                  type="color"
                  value={settings.primaryColor}
                  onChange={(e) => updateSetting('primaryColor', e.target.value)}
                  style={{
                    width: '34px',
                    height: '34px',
                    padding: 0,
                    border: 'none',
                    borderRadius: '6px',
                    cursor: 'pointer',
                  }}
                />
              </div>
            </div>
          </div>

          {/* 3. Logo and Branding */}
          <div className="grid two">
            <Field label="رابط شعار الشركة (Logo URL)">
              <input
                type="url"
                placeholder="https://example.com/logo.png"
                value={settings.logoUrl || ''}
                onChange={(e) => updateSetting('logoUrl', e.target.value)}
              />
            </Field>
            <Field label="موضع الشعار في الترويسة">
              <select
                value={settings.logoPosition}
                onChange={(e) =>
                  updateSetting('logoPosition', e.target.value as InvoiceLogoPosition)
                }
              >
                <option value="right">اليمين (أعلى بيانات الشركة)</option>
                <option value="center">الوسط (فوق ختم وتفاصيل الفاتورة)</option>
                <option value="left">اليسار (فوق الباركود وتاريخ الفاتورة)</option>
              </select>
            </Field>
          </div>

          {/* 4. Toggleable Elements */}
          <div>
            <label
              className="section-label"
              style={{
                fontWeight: 700,
                fontSize: '14px',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                marginBottom: '10px',
              }}
            >
              <ShieldCheck size={17} color="var(--indigo-600)" /> خيارات ظهور العناصر على الفاتورة
            </label>
            <div className="customizer-checkbox-grid">
              <label className="customizer-check-label">
                <input
                  type="checkbox"
                  checked={settings.showQrCode}
                  onChange={(e) => updateSetting('showQrCode', e.target.checked)}
                />
                <span>رمز التحقق الضريبي (QR Code)</span>
              </label>

              <label className="customizer-check-label">
                <input
                  type="checkbox"
                  checked={settings.showBarcode}
                  onChange={(e) => updateSetting('showBarcode', e.target.checked)}
                />
                <span>باركود الفاتورة الرقمي (Barcode)</span>
              </label>

              <label className="customizer-check-label">
                <input
                  type="checkbox"
                  checked={settings.showSignatures}
                  onChange={(e) => updateSetting('showSignatures', e.target.checked)}
                />
                <span>منطقة التوقيعات والأختام الرسمية</span>
              </label>

              <label className="customizer-check-label">
                <input
                  type="checkbox"
                  checked={settings.showReturnPolicy}
                  onChange={(e) => updateSetting('showReturnPolicy', e.target.checked)}
                />
                <span>شروط الاسترجاع وحماية المستهلك</span>
              </label>

              <label className="customizer-check-label">
                <input
                  type="checkbox"
                  checked={settings.showSku}
                  onChange={(e) => updateSetting('showSku', e.target.checked)}
                />
                <span>كود الصنف (SKU) في جدول البنود</span>
              </label>

              <label className="customizer-check-label">
                <input
                  type="checkbox"
                  checked={settings.showBankDetails}
                  onChange={(e) => updateSetting('showBankDetails', e.target.checked)}
                />
                <span>بيانات الحساب البنكي والآيبان (IBAN)</span>
              </label>
            </div>
          </div>

          {/* 5. Bank Account Details */}
          {settings.showBankDetails && (
            <div
              style={{
                background: 'var(--slate-50)',
                padding: '14px',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--slate-200)',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  marginBottom: '10px',
                  fontSize: '13.5px',
                  fontWeight: 700,
                }}
              >
                <Landmark size={16} color="var(--indigo-600)" /> بيانات التحويل البنكي (تظهر أسفل
                الفاتورة للعميل)
              </div>
              <div className="grid two" style={{ marginBottom: '8px' }}>
                <Field label="اسم البنك">
                  <input
                    value={settings.bankName || ''}
                    placeholder="مثال: البنك الأهلي المصري (NBE)"
                    onChange={(e) => updateSetting('bankName', e.target.value)}
                  />
                </Field>
                <Field label="اسم صاحب الحساب">
                  <input
                    value={settings.bankAccountName || ''}
                    placeholder="شركة أوركيفا للتجارة والتوزيع"
                    onChange={(e) => updateSetting('bankAccountName', e.target.value)}
                  />
                </Field>
              </div>
              <Field label="رقم الآيبان الدولي (IBAN)">
                <input
                  value={settings.bankIban || ''}
                  placeholder="EG380003000000000123456789012"
                  dir="ltr"
                  onChange={(e) => updateSetting('bankIban', e.target.value)}
                />
              </Field>
            </div>
          )}

          {/* 6. Custom Footer Note */}
          <Field label="تذييل الفاتورة الرسمي وملاحظات التواصل">
            <textarea
              rows={2}
              value={settings.footerNote || ''}
              placeholder="شكراً لتعاملكم معنا · للاستفسارات والدعم الفني تواصلوا معنا..."
              onChange={(e) => updateSetting('footerNote', e.target.value)}
            />
          </Field>

          {/* 7. Thermal POS Receipt Options */}
          <div
            style={{
              background: '#f8fafc',
              padding: '14px',
              borderRadius: 'var(--radius-md)',
              border: '1px dashed #cbd5e1',
            }}
          >
            <span
              style={{
                fontWeight: 700,
                fontSize: '13.5px',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                marginBottom: '8px',
              }}
            >
              <Printer size={16} color="var(--slate-700)" /> إعدادات الإيصال الحراري لنقاط البيع
              (80mm)
            </span>
            <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
              <label className="customizer-check-label">
                <input
                  type="checkbox"
                  checked={settings.thermalEcoMode}
                  onChange={(e) => updateSetting('thermalEcoMode', e.target.checked)}
                />
                <span>نمط توفير الورق الموفر (Eco Compact)</span>
              </label>

              <label className="customizer-check-label">
                <input
                  type="checkbox"
                  checked={settings.thermalShowCashier}
                  onChange={(e) => updateSetting('thermalShowCashier', e.target.checked)}
                />
                <span>إظهار اسم الكاشير المصدر</span>
              </label>
            </div>
          </div>

          <div className="modal-footer" style={{ marginTop: '10px', display: 'flex', gap: '8px' }}>
            <Button variant="secondary" type="button" onClick={handleReset}>
              <RotateCcw size={16} /> استعادة الافتراضي
            </Button>
            <Button type="submit" busy={busy}>
              <Save size={17} /> حفظ إعدادات وتصميم الفاتورة
            </Button>
          </div>
        </form>
      </div>

      {/* Live Interactive Preview */}
      <div className="customizer-preview-container">
        <div className="preview-top-bar">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Eye size={18} color="var(--indigo-600)" />
            <strong>معاينة حية وتفاعلية للفاتورة (Live Preview)</strong>
          </div>
          <div className="tabs" style={{ minHeight: 'auto' }}>
            <button
              type="button"
              className={previewTab === 'a4' ? 'active' : ''}
              onClick={() => setPreviewTab('a4')}
              style={{ minHeight: '34px', padding: '6px 14px', fontSize: '13px' }}
            >
              فاتورة A4
            </button>
            <button
              type="button"
              className={previewTab === 'thermal' ? 'active' : ''}
              onClick={() => setPreviewTab('thermal')}
              style={{ minHeight: '34px', padding: '6px 14px', fontSize: '13px' }}
            >
              إيصال حراري 80mm
            </button>
          </div>
        </div>

        {/* Live A4 Preview */}
        {previewTab === 'a4' && (
          <div
            className={`invoice-paper template-${settings.template}`}
            style={{
              ['--invoice-primary' as string]: settings.primaryColor,
              borderTop: `6px solid ${settings.primaryColor}`,
              boxShadow: '0 8px 30px rgba(0,0,0,0.08)',
              marginTop: '12px',
              fontSize: settings.template === 'compact' ? '12px' : '13px',
              padding: settings.template === 'compact' ? '24px' : '36px',
            }}
          >
            {/* Header */}
            <div className="invoice-header">
              <div className="invoice-header-company">
                {settings.logoUrl && (
                  <div style={{ marginBottom: '10px', textAlign: settings.logoPosition }}>
                    <img
                      src={settings.logoUrl}
                      alt="Logo"
                      style={{ maxHeight: '50px', maxWidth: '160px', objectFit: 'contain' }}
                      onError={(e) => {
                        (e.target as HTMLElement).style.display = 'none';
                      }}
                    />
                  </div>
                )}
                <div className="invoice-brand" dir="ltr" style={{ color: settings.primaryColor }}>
                  {company?.name || 'orqiva'}
                  <span>.</span>
                </div>
                <h2>{company?.name || 'شركة أوركيفا للتجارة العامة'}</h2>
                <p>{company?.address || 'القاهرة، مصر'}</p>
                <p dir="ltr">
                  {company?.phone || '01000000000'} · {company?.email || 'info@orqiva.com'}
                </p>
                {company?.tax_number && (
                  <p className="tax-id-line">الرقم الضريبي: {company.tax_number}</p>
                )}
              </div>

              <div className="invoice-title">
                {settings.showQrCode && (
                  <div
                    className="invoice-qr-corner"
                    style={{
                      border: `1px solid ${settings.primaryColor}33`,
                      padding: '4px',
                      borderRadius: '6px',
                    }}
                  >
                    <QrCode size={55} color={settings.primaryColor} />
                  </div>
                )}
                <span>فاتورة مبيعات ضريبية</span>
                <h2 className="num" style={{ color: settings.primaryColor }}>
                  INV-2026-0842
                </h2>
                <span className="badge green">معتمدة ومرحلة</span>
              </div>
            </div>

            {/* Parties & Dates */}
            <div className="invoice-parties" style={{ marginTop: '16px' }}>
              <div
                className="party-box"
                style={{ borderRight: `3px solid ${settings.primaryColor}` }}
              >
                <span className="eyebrow" style={{ color: settings.primaryColor }}>
                  فاتورة إلى (العميل)
                </span>
                <h3>شركة التقنية الحديثة للتجارة</h3>
                <p>مبنى النخيل، التجمع الخامس، القاهرة</p>
                <p dir="ltr">01234567890</p>
                <p>الرقم الضريبي: 498-123-765</p>
                <p className="branch-tag">الفرع المُصدر: الفرع الرئيسي</p>
              </div>
              <div className="invoice-dates">
                <div>
                  <span>تاريخ الفاتورة</span>
                  <strong>{formatDate(today())}</strong>
                </div>
                <div>
                  <span>تاريخ الاستحقاق</span>
                  <strong>{formatDate(today())}</strong>
                </div>
                <div>
                  <span>العملة المعتمدة</span>
                  <strong>جنيه مصري (EGP)</strong>
                </div>
                <div>
                  <span>حالة التحصيل</span>
                  <strong className="text-green">مدفوعة بالكامل</strong>
                </div>
              </div>
            </div>

            {/* Items Table */}
            <div className="table-scroll" style={{ marginTop: '16px' }}>
              <table className="invoice-table">
                <thead
                  style={{
                    background:
                      settings.template === 'minimal'
                        ? 'transparent'
                        : `${settings.primaryColor}12`,
                    borderBottom: `2px solid ${settings.primaryColor}`,
                  }}
                >
                  <tr>
                    <th>#</th>
                    <th>الوصف والمنتج</th>
                    {settings.showSku && <th>كود الصنف</th>}
                    <th>الكمية</th>
                    <th>سعر الوحدة</th>
                    <th>الإجمالي</th>
                  </tr>
                </thead>
                <tbody>
                  {sampleLines.map((l, i) => (
                    <tr key={l.id}>
                      <td className="num muted">{i + 1}</td>
                      <td>
                        <strong>{l.name}</strong>
                      </td>
                      {settings.showSku && <td className="num">{l.sku}</td>}
                      <td className="num">{l.quantity}</td>
                      <td className="num">{money(l.unit_price, 2)}</td>
                      <td className="num amount" style={{ fontWeight: 700 }}>
                        {money(l.total, 2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Totals & Notes */}
            <div className="invoice-bottom" style={{ marginTop: '18px' }}>
              <div className="invoice-notes">
                <h4>الشروط والملاحظات</h4>
                <p>
                  {company?.invoice_note ||
                    'تسري على هذه الفاتورة الشروط والأحكام القياسية المعتمدة لدى المنشأة.'}
                </p>
                {settings.showReturnPolicy && (
                  <div
                    className="invoice-guarantee-note"
                    style={{ borderRightColor: settings.primaryColor }}
                  >
                    البضاعة المباعة ترد وتستبدل خلال 14 يوماً وفقاً لقانون حماية المستهلك مع إحضار
                    أصل الفاتورة بحالتها الأصلية.
                  </div>
                )}
                {settings.showBankDetails && settings.bankIban && (
                  <div
                    style={{
                      marginTop: '12px',
                      padding: '10px 12px',
                      background: `${settings.primaryColor}08`,
                      borderRadius: '6px',
                      border: `1px solid ${settings.primaryColor}25`,
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        fontSize: '12px',
                        fontWeight: 700,
                        color: settings.primaryColor,
                      }}
                    >
                      <Landmark size={14} /> بيانات التحويل البنكي
                    </div>
                    <div style={{ fontSize: '11.5px', marginTop: '4px' }}>
                      <span>
                        البنك: <strong>{settings.bankName}</strong>
                      </span>{' '}
                      |{' '}
                      <span>
                        الحساب: <strong>{settings.bankAccountName}</strong>
                      </span>
                      <div
                        dir="ltr"
                        style={{
                          fontWeight: 700,
                          fontFamily: 'monospace',
                          marginTop: '2px',
                          color: 'var(--slate-800)',
                        }}
                      >
                        IBAN: {settings.bankIban}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="invoice-totals">
                <div>
                  <span>الإجمالي قبل الضريبة</span>
                  <strong className="num">{money(sampleSubtotal, 2)}</strong>
                </div>
                <div>
                  <span>ضريبة القيمة المضافة (14%)</span>
                  <span className="num">{money(sampleTax, 2)}</span>
                </div>
                <div
                  className="grand-total"
                  style={{
                    borderTop: `2px solid ${settings.primaryColor}`,
                    color: settings.primaryColor,
                  }}
                >
                  <span>الإجمالي النهائي</span>
                  <strong className="num">
                    {money(sampleTotal, 2)} <small>ج.م</small>
                  </strong>
                </div>
              </div>
            </div>

            {/* Official Signatures Row */}
            {settings.showSignatures && (
              <div className="invoice-signatures-row" style={{ marginTop: '24px' }}>
                <div className="sig-block">
                  <span>المحاسب المسئول</span>
                  <div className="sig-space" />
                  <small>التوقيع والاعتماد</small>
                </div>
                <div className="sig-block">
                  <span>توقيع المستلم</span>
                  <div className="sig-space" />
                  <small>الاسم والتوقيع</small>
                </div>
                <div className="sig-block stamp-space-block">
                  <span>ختم المنشأة الرسمي</span>
                  <div
                    className="sig-space stamp-box"
                    style={{ borderColor: `${settings.primaryColor}60` }}
                  />
                </div>
              </div>
            )}

            {/* Barcode & Footer Signoff */}
            <div className="invoice-signoff" style={{ marginTop: '16px' }}>
              {settings.showBarcode && (
                <div
                  className="invoice-barcode-wrapper"
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '2px',
                  }}
                >
                  <Barcode size={38} color="var(--slate-700)" />
                  <small style={{ fontFamily: 'monospace', fontSize: '10px' }}>INV-2026-0842</small>
                </div>
              )}
              <span>{settings.footerNote || 'فاتورة صادرة ومعتمدة من نظام أوركيفا السحابي'}</span>
            </div>
          </div>
        )}

        {/* Live Thermal Receipt Preview */}
        {previewTab === 'thermal' && (
          <div
            style={{
              width: '320px',
              margin: '16px auto',
              background: '#ffffff',
              padding: settings.thermalEcoMode ? '14px' : '20px',
              border: '1px dashed #94a3b8',
              borderRadius: '8px',
              boxShadow: '0 4px 14px rgba(0,0,0,0.06)',
              fontFamily: 'monospace',
              fontSize: '11.5px',
            }}
          >
            <div
              style={{
                textAlign: 'center',
                borderBottom: '1px dashed #64748b',
                paddingBottom: '10px',
              }}
            >
              <div style={{ fontWeight: 800, fontSize: '14px' }}>
                {company?.name || 'أوركيفا ستور'}
              </div>
              <div>س.ت: 104829 | ب.ض: {company?.tax_number || '342-891-002'}</div>
              <div>الفرع الرئيسي • القاهرة</div>
              {settings.thermalShowCashier && <div>الكاشير: أحمد إبراهيم</div>}
            </div>

            <div style={{ padding: '8px 0', borderBottom: '1px dashed #64748b' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>
                  رقم الإيصال: <strong>#REC-842</strong>
                </span>
                <span>{formatDate(today(), true)}</span>
              </div>
            </div>

            <div style={{ padding: '8px 0', borderBottom: '1px dashed #64748b' }}>
              {sampleLines.map((l) => (
                <div
                  key={l.id}
                  style={{ display: 'flex', justifyContent: 'space-between', margin: '4px 0' }}
                >
                  <span>
                    {l.quantity}x {l.name.slice(0, 16)}
                  </span>
                  <strong>{money(l.total)}</strong>
                </div>
              ))}
            </div>

            <div style={{ padding: '8px 0', borderBottom: '2px solid #0f172a' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>المجموع:</span>
                <span>{money(sampleSubtotal)} ج.م</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>ضريبة القيمة المضافة 14%:</span>
                <span>{money(sampleTax)} ج.م</span>
              </div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: '14px',
                  fontWeight: 800,
                  marginTop: '4px',
                }}
              >
                <span>الإجمالي الصافي:</span>
                <span>{money(sampleTotal)} ج.م</span>
              </div>
            </div>

            <div style={{ textAlign: 'center', paddingTop: '10px' }}>
              {settings.showQrCode && (
                <div style={{ display: 'inline-block', margin: '6px 0' }}>
                  <QrCode size={52} />
                </div>
              )}
              <div style={{ fontSize: '10.5px', color: '#475569' }}>
                {settings.footerNote || 'شكراً لزيارتكم وسعدنا بخدمتكم'}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
