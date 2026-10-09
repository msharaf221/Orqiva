import { z } from 'zod';
const text = (max = 200) => z.string().trim().min(1, 'هذا الحقل مطلوب').max(max);
const optionalText = (max = 500) => z.string().trim().max(max).default('');
export const money = z.number().int().min(0).max(1_000_000_000);
export const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'تاريخ غير صالح')
  .refine((s) => {
    const d = new Date(s + 'T00:00:00Z');
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, 'تاريخ غير صالح');
export const partySchema = z
  .object({
    type: z.enum(['CUSTOMER', 'SUPPLIER']),
    name: text(),
    email: z.union([z.string().email().max(200), z.literal('')]).default(''),
    phone: optionalText(40),
    address: optionalText(),
    tax_number: optionalText(50),
    notes: optionalText(2000),
  })
  .strict();
export const productSchema = z
  .object({
    sku: text(50),
    name: text(),
    category: text(80),
    unit: text(30),
    sale_price: money,
    cost_price: money,
    min_stock: z.number().int().min(0).max(1_000_000),
    stock: z.number().int().min(0).max(1_000_000).default(0),
  })
  .strict();
export const documentSchema = z
  .object({
    type: z.enum(['SALE', 'PURCHASE']),
    party_id: text(100),
    date,
    due_date: date,
    discount: money.default(0),
    tax_rate: z.number().int().min(0).max(10000),
    notes: optionalText(2000),
    lines: z
      .array(
        z
          .object({
            product_id: text(100),
            quantity: z.number().int().min(1).max(1_000_000),
            unit_price: money,
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict()
  .refine((d) => d.due_date >= d.date, {
    message: 'تاريخ الاستحقاق يجب أن يكون بعد تاريخ الفاتورة',
    path: ['due_date'],
  });
export const paymentSchema = z
  .object({
    amount: money.refine((n) => n > 0, 'المبلغ يجب أن يكون أكبر من صفر'),
    method: z.enum(['CASH', 'BANK', 'CARD']),
    date,
    reference: optionalText(200),
  })
  .strict();
export const expenseSchema = z
  .object({
    title: text(),
    category: text(80),
    amount: money.refine((n) => n > 0),
    method: z.enum(['CASH', 'BANK', 'CARD']),
    date,
    notes: optionalText(2000),
  })
  .strict();
export const companySchema = z
  .object({
    name: text(),
    email: z.union([z.string().email().max(200), z.literal('')]),
    phone: optionalText(40),
    address: optionalText(),
    tax_number: optionalText(50),
    tax_rate: z.number().int().min(0).max(10000),
    invoice_note: optionalText(1000),
  })
  .strict();
export const userSchema = z
  .object({
    name: text(100),
    email: z
      .string()
      .trim()
      .email()
      .max(200)
      .transform((s) => s.toLowerCase()),
    password: z.string().min(10).max(128),
    role: z.enum(['ADMIN', 'STAFF']),
  })
  .strict();
