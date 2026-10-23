import type { InvoiceCustomization, InvoiceTemplateId } from '../types';

export const DEFAULT_INVOICE_CUSTOMIZATION: InvoiceCustomization = {
  template: 'modern',
  primaryColor: '#4f46e5', // Brand Indigo
  logoUrl: '',
  logoPosition: 'right',
  showBarcode: true,
  showQrCode: true,
  showSignatures: true,
  showReturnPolicy: true,
  showBankDetails: true,
  bankName: 'البنك الأهلي المصري (NBE)',
  bankIban: 'EG380003000000000123456789012',
  bankAccountName: 'شركة أوركيفا للتجارة والتوزيع',
  showSku: true,
  footerNote: 'شكراً لتعاملكم معنا · للاستفسارات والدعم الفني تواصلوا معنا',
  thermalEcoMode: false,
  thermalShowCashier: true,
};

export const INVOICE_TEMPLATES: {
  id: InvoiceTemplateId;
  name: string;
  description: string;
  tag: string;
}[] = [
  {
    id: 'modern',
    name: 'القالب العصري (Modern)',
    description: 'تصميم أنيق وناصع مع ترويسة مميزة بالهوية وأقسام معزولة بظلال خفيفة.',
    tag: 'موصى به',
  },
  {
    id: 'classic',
    name: 'الكلاسيكي الرسمي (Classic Corporate)',
    description:
      'إطار رسمي كامل مع خطوط دقيقة وجداول ممتدة مناسبة للشركات الكبرى والمعاملات الحكومية.',
    tag: 'رسمي',
  },
  {
    id: 'minimal',
    name: 'المظهر المبسط (Minimal Clean)',
    description: 'خطوط واضحة وتصميم بدون زخرفة يركز على الأرقام ويوفر أحبار الطباعة بشكل ممتاز.',
    tag: 'موفر للحبر',
  },
  {
    id: 'compact',
    name: 'المضغوط (Compact Single-Page)',
    description: 'مسافات مدروسة لاستيعاب أكبر عدد من البنود في صفحة واحدة دون تجزئة الفاتورة.',
    tag: 'مضغوط',
  },
];

export const COLOR_PRESETS = [
  { label: 'أزرق نيلي (Indigo)', hex: '#4f46e5' },
  { label: 'كحلي ملكي (Navy)', hex: '#1e3a8a' },
  { label: 'أخضر زمردي (Emerald)', hex: '#059669' },
  { label: 'رمادي فاخر (Slate)', hex: '#0f172a' },
  { label: 'عنابي راقي (Ruby)', hex: '#991b1b' },
  { label: 'بنفسجي داكن (Purple)', hex: '#7c3aed' },
];

export function parseInvoiceCustomization(jsonString?: string | null): InvoiceCustomization {
  if (!jsonString) return DEFAULT_INVOICE_CUSTOMIZATION;
  try {
    const parsed = JSON.parse(jsonString);
    return {
      ...DEFAULT_INVOICE_CUSTOMIZATION,
      ...parsed,
    };
  } catch {
    return DEFAULT_INVOICE_CUSTOMIZATION;
  }
}
