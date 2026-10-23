import { z } from 'zod';
const text = (max = 200) => z.string().trim().min(1, 'هذا الحقل مطلوب').max(max);
const optionalText = (max = 500) => z.string().trim().max(max).default('');
const id = () => z.string().trim().min(1).max(100);
const quantity = z.number().int().min(1).max(1_000_000);
export const money = z.number().int().min(0).max(1_000_000_000);
export const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'تاريخ غير صالح')
  .refine((s) => {
    const d = new Date(s + 'T00:00:00Z');
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, 'تاريخ غير صالح');
const paymentMethod = z.enum(['CASH', 'BANK', 'CARD']);
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
const productFields = {
  sku: text(50),
  name: text(),
  category: text(80),
  unit: text(30),
  sale_price: money,
  cost_price: money,
  min_stock: z.number().int().min(0).max(1_000_000),
  track_batches: z
    .union([z.boolean(), z.number()])
    .optional()
    .transform((v) => (v ? 1 : 0)),
};
/** Stock is never edited directly; it changes through documents, transfers and adjustments. */
export const productUpdateSchema = z.object(productFields).strict();
export const productSchema = z
  .object({
    ...productFields,
    stock: z.number().int().min(0).max(1_000_000).default(0),
    branch_id: id().optional(),
  })
  .strict()
  .refine((p) => !p.stock || !!p.branch_id, {
    message: 'اختر الفرع الذي يُضاف إليه الرصيد الافتتاحي',
    path: ['branch_id'],
  });
export const adjustSchema = z
  .object({
    branch_id: id(),
    quantity: z
      .number()
      .int()
      .min(-1_000_000)
      .max(1_000_000)
      .refine((q) => q !== 0),
    reason: z.string().trim().min(3).max(300),
  })
  .strict();

export const stocktakeSubmitSchema = z
  .object({
    branch_id: id(),
    notes: optionalText(500),
  })
  .strict();

export const stocktakeCountsSchema = z.object({
  notes: optionalText(500),
  counts: z
    .array(
      z.object({
        line_id: id(),
        counted_qty: z.number().int().min(0).max(1_000_000).nullable(),
      }),
    )
    .min(1, 'لا توجد بنود جرد للتحديث'),
});
export const stocktakeScanSchema = z
  .object({
    barcode: z.string().trim().min(1).max(100),
    quantity: z.number().int().min(1).max(10000).default(1),
  })
  .strict();

export const warehouseLocationSchema = z
  .object({
    branch_id: id(),
    code: z.string().trim().min(1).max(50),
    name: text(100),
    aisle: optionalText(50),
    rack: optionalText(50),
    shelf: optionalText(50),
    bin: optionalText(50),
    notes: optionalText(500),
    active: z
      .union([z.literal(0), z.literal(1), z.boolean()])
      .optional()
      .transform((v) => (v === false || v === 0 ? 0 : 1)),
  })
  .strict();

export const productLocationAssignSchema = z
  .object({
    location_id: id(),
    is_primary: z
      .union([z.literal(0), z.literal(1), z.boolean()])
      .optional()
      .transform((v) => (v === false || v === 0 ? 0 : 1)),
  })
  .strict();

// ── General Ledger ───────────────────────────────────────────────────────────────────────

const glAccountType = z.enum(['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE']);
export const chartAccountSchema = z
  .object({
    code: z
      .string()
      .trim()
      .regex(/^\d{3,10}$/, 'كود الحساب أرقام فقط (٣ خانات على الأقل)'),
    name: text(120),
    type: glAccountType,
    normal_side: z.enum(['DEBIT', 'CREDIT']),
    parent_id: id().nullable().optional(),
    active: z.boolean().default(true),
    notes: optionalText(500),
  })
  .strict();

const journalLineSchema = z
  .object({
    account_id: id(),
    debit: money.default(0),
    credit: money.default(0),
    memo: optionalText(200),
  })
  .strict()
  .refine((l) => l.debit > 0 !== l.credit > 0, {
    message: 'كل بند يجب أن يكون مديناً أو دائناً بمبلغ واحد فقط',
  });

export const journalEntrySchema = z
  .object({
    date,
    memo: optionalText(300),
    branch_id: id().nullable().optional(),
    lines: z.array(journalLineSchema).min(2, 'القيد يحتاج بندين على الأقل').max(200),
  })
  .strict()
  .refine(
    (e) => e.lines.reduce((s, l) => s + l.debit, 0) === e.lines.reduce((s, l) => s + l.credit, 0),
    { message: 'القيد غير متوازن: إجمالي المدين يجب أن يساوي إجمالي الدائن' },
  );

export const glSettingsSchema = z
  .object({
    fiscal_year_start_month: z.number().int().min(1).max(12),
    closed_through: date.nullable().optional(),
  })
  .strict();

export const openingBalancesSchema = z
  .object({
    date,
    memo: optionalText(300),
    balancing_account: z.enum(['OPENING_EQUITY', 'CAPITAL']).default('OPENING_EQUITY'),
    cash_accounts: z
      .array(
        z.object({
          cash_account_id: id(),
          amount: money.default(0),
        }),
      )
      .optional(),
    customers: z
      .array(
        z.object({
          party_id: id(),
          amount: money.default(0),
        }),
      )
      .optional(),
    suppliers: z
      .array(
        z.object({
          party_id: id(),
          amount: money.default(0),
        }),
      )
      .optional(),
    inventory_items: z
      .array(
        z.object({
          product_id: id(),
          branch_id: id(),
          quantity: z.number().int().min(1),
          unit_cost: money.default(0),
        }),
      )
      .optional(),
    other_accounts: z
      .array(
        z.object({
          account_id: id(),
          debit: money.default(0),
          credit: money.default(0),
          memo: optionalText(200),
        }),
      )
      .optional(),
  })
  .strict();

export const documentSchema = z
  .object({
    type: z.enum(['SALE', 'PURCHASE', 'SALE_RETURN', 'PURCHASE_RETURN']),
    branch_id: id(),
    party_id: id(),
    original_document_id: id().optional().nullable(),
    date,
    due_date: date,
    discount: money.default(0),
    tax_rate: z.number().int().min(0).max(10000),
    notes: optionalText(2000),
    lines: z
      .array(
        z
          .object({
            product_id: id(),
            quantity: quantity,
            unit_price: money,
            batch_id: id().optional().nullable(),
            batch_number: z.string().trim().max(100).optional().nullable(),
            production_date: z.string().trim().optional().nullable(),
            expiry_date: z.string().trim().optional().nullable(),
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
  })
  .refine(
    (d) =>
      (d.type !== 'SALE_RETURN' && d.type !== 'PURCHASE_RETURN') || Boolean(d.original_document_id),
    {
      message: 'المرتجع يجب أن يكون مرتبطاً بفاتورة أصلية',
      path: ['original_document_id'],
    },
  );
export const paymentSchema = z
  .object({
    amount: money.refine((n) => n > 0, 'المبلغ يجب أن يكون أكبر من صفر'),
    method: paymentMethod,
    date,
    reference: optionalText(200),
    account_id: id().nullable().optional(),
    override_overdraft: z.boolean().optional(),
  })
  .strict();
export const expenseSchema = z
  .object({
    title: text(),
    category: text(80),
    amount: money.refine((n) => n > 0),
    method: paymentMethod,
    date,
    notes: optionalText(2000),
    allocation: z.enum(['BRANCH', 'EQUAL', 'REVENUE']).default('BRANCH'),
    branch_id: id().nullable().optional(),
    account_id: id().nullable().optional(),
    override_overdraft: z.boolean().optional(),
  })
  .strict()
  .superRefine((e, ctx) => {
    if (e.allocation === 'BRANCH' && !e.branch_id)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'اختر الفرع الذي يخصّه هذا المصروف',
        path: ['branch_id'],
      });
    if (e.allocation !== 'BRANCH' && e.branch_id)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'المصروف المشترك لا يُربط بفرع واحد',
        path: ['branch_id'],
      });
  });
export const companySchema = z
  .object({
    name: text(),
    email: z.union([z.string().email().max(200), z.literal('')]),
    phone: optionalText(40),
    address: optionalText(),
    tax_number: optionalText(50),
    tax_registration_number: optionalText(50),
    activity_code: optionalText(50),
    tax_rate: z.number().int().min(0).max(10000),
    invoice_note: optionalText(1000),
    eta_environment: z.enum(['stub', 'preprod', 'production']).default('stub').optional(),
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
    role: z.string().min(1).max(50).default('STAFF'),
    role_id: id().optional(),
    branch_ids: z.array(id()).max(200).default([]),
  })
  .strict();

export const createRoleSchema = z
  .object({
    name: text(100),
    code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9_]{2,50}$/, 'رمز الدور: أحرف إنجليزية وأرقام وشرطة سفلية')
      .optional(),
    description: optionalText(300),
    permissions: z.array(z.string().min(1).max(100)).min(1, 'يجب تحديد صلاحية واحدة على الأقل'),
  })
  .strict();

export const updateRoleSchema = z
  .object({
    name: text(100).optional(),
    description: optionalText(300).optional(),
    permissions: z
      .array(z.string().min(1).max(100))
      .min(1, 'يجب تحديد صلاحية واحدة على الأقل')
      .optional(),
  })
  .strict();

const branchKind = z.enum(['HQ', 'STORE', 'WAREHOUSE', 'ONLINE']);
export const branchSchema = z
  .object({
    code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9]{2,8}$/, 'كود الفرع: حروف إنجليزية أو أرقام من ٢ إلى ٨ خانات'),
    name: text(100),
    kind: branchKind.default('STORE'),
    phone: optionalText(40),
    address: optionalText(300),
    opened_on: date,
  })
  .strict();
export const branchUpdateSchema = z
  .object({
    name: text(100),
    kind: branchKind,
    phone: optionalText(40),
    address: optionalText(300),
  })
  .strict();
export const branchStatusSchema = z.object({ active: z.boolean() }).strict();
export const branchProductSchema = z
  .object({
    active: z.boolean(),
    sale_price: money.nullable(),
    min_stock: z.number().int().min(0).max(1_000_000).nullable(),
  })
  .strict();
export const branchUsersSchema = z.object({ user_ids: z.array(id()).max(200) }).strict();

const noDuplicateProducts = (lines: { product_id: string }[]) =>
  new Set(lines.map((l) => l.product_id)).size === lines.length;
export const transferSchema = z
  .object({
    from_branch_id: id(),
    to_branch_id: id(),
    date,
    notes: optionalText(1000),
    lines: z
      .array(z.object({ product_id: id(), quantity }).strict())
      .min(1)
      .max(100),
  })
  .strict()
  .refine((t) => t.from_branch_id !== t.to_branch_id, {
    message: 'لا يمكن التحويل إلى الفرع نفسه',
    path: ['to_branch_id'],
  })
  .refine((t) => noDuplicateProducts(t.lines), {
    message: 'المنتج مكرر في التحويل؛ عدّل الكمية بدلاً من تكراره',
    path: ['lines'],
  });
export const transferReceiveSchema = z
  .object({
    lines: z
      .array(
        z
          .object({
            product_id: id(),
            quantity_received: z.number().int().min(0).max(1_000_000),
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict()
  .refine((t) => noDuplicateProducts(t.lines), {
    message: 'منتج مكرر في الاستلام',
    path: ['lines'],
  });

export const ownerSchema = z
  .object({
    name: text(100),
    phone: optionalText(40),
    email: z.union([z.string().email().max(200), z.literal('')]).default(''),
    share_bps: z.number().int().min(0).max(10000),
  })
  .strict();
export const equitySchema = z
  .object({
    kind: z.enum(['CONTRIBUTION', 'WITHDRAWAL']),
    amount: money.refine((n) => n > 0, 'المبلغ يجب أن يكون أكبر من صفر'),
    method: paymentMethod,
    date,
    notes: optionalText(500),
    account_id: id().nullable().optional(),
    override_overdraft: z.boolean().optional(),
  })
  .strict();
export const distributionSchema = z
  .object({
    period_from: date,
    period_to: date,
    reserve_bps: z.number().int().min(0).max(5000),
    notes: optionalText(1000),
  })
  .strict()
  .refine((d) => d.period_to >= d.period_from, {
    message: 'نهاية الفترة يجب أن تكون بعد بدايتها',
    path: ['period_to'],
  })
  .refine((d) => Date.parse(d.period_to) - Date.parse(d.period_from) <= 366 * 86400000, {
    message: 'الفترة الواحدة لا تتجاوز سنة',
    path: ['period_to'],
  });
export const distributionPaymentSchema = z
  .object({
    line_id: id(),
    amount: money.refine((n) => n > 0, 'المبلغ يجب أن يكون أكبر من صفر'),
    method: paymentMethod,
    date,
    reference: optionalText(200),
    account_id: id().nullable().optional(),
    override_overdraft: z.boolean().optional(),
  })
  .strict();

export const accountType = z.enum(['CASH', 'BANK', 'WALLET']);

export const cashAccountSchema = z
  .object({
    name: text(100),
    type: accountType,
    branch_id: id().nullable().optional(),
    currency: z.string().trim().max(10).default('EGP'),
    account_number: optionalText(100),
    bank_name: optionalText(100),
    initial_balance: money.default(0),
    allow_negative: z.union([z.literal(0), z.literal(1)]).default(0),
    notes: optionalText(1000),
  })
  .strict();

export const updateCashAccountSchema = z
  .object({
    name: text(100),
    branch_id: id().nullable().optional(),
    account_number: optionalText(100),
    bank_name: optionalText(100),
    allow_negative: z.union([z.literal(0), z.literal(1)]),
    active: z.union([z.literal(0), z.literal(1)]),
    notes: optionalText(1000),
  })
  .strict();

export const accountTransferSchema = z
  .object({
    from_account_id: id(),
    to_account_id: id(),
    amount: money.refine((n) => n > 0, 'المبلغ يجب أن يكون أكبر من صفر'),
    date,
    notes: optionalText(1000),
    override_overdraft: z.boolean().optional(),
  })
  .strict()
  .refine((t) => t.from_account_id !== t.to_account_id, {
    message: 'لا يمكن التحويل من الحساب إلى نفسه',
    path: ['to_account_id'],
  });

export const posShiftOpenSchema = z
  .object({
    branch_id: id(),
    opening_cash: money.refine((n) => n >= 0, 'المبلغ الافتتاحي لا يمكن أن يكون سالباً'),
    notes: optionalText(500),
  })
  .strict();

export const posCashMovementSchema = z
  .object({
    type: z.enum(['IN', 'OUT']),
    amount: money.refine((n) => n > 0, 'المبلغ يجب أن يكون أكبر من صفر'),
    reason: text(200),
  })
  .strict();

export const posShiftSubmitSchema = z
  .object({
    declared_cash: money.refine((n) => n >= 0, 'المبلغ الفعلي للنقدية لا يمكن أن يكون سالباً'),
    declared_card: money
      .refine((n) => n >= 0, 'المبلغ الفعلي للبطاقات لا يمكن أن يكون سالباً')
      .optional(),
    declared_bank: money
      .refine((n) => n >= 0, 'المبلغ الفعلي لإنستاباي لا يمكن أن يكون سالباً')
      .optional(),
    terminal_batch_number: optionalText(100),
    card_slips_count: z.number().int().min(0).optional().default(0),
    bank_transfers_count: z.number().int().min(0).optional().default(0),
    safe_envelope_number: optionalText(100),
    proof_documents: optionalText(1000),
    notes: optionalText(500),
  })
  .strict();

export const posShiftApproveSchema = z
  .object({
    closing_cash: money
      .refine((n) => n >= 0, 'المبلغ المعتمد للنقدية لا يمكن أن يكون سالباً')
      .optional(),
    verified_cash: money
      .refine((n) => n >= 0, 'المبلغ المعتمد للنقدية لا يمكن أن يكون سالباً')
      .optional(),
    closing_card: money
      .refine((n) => n >= 0, 'المبلغ المعتمد للبطاقات لا يمكن أن يكون سالباً')
      .optional(),
    verified_card: money
      .refine((n) => n >= 0, 'المبلغ المعتمد للبطاقات لا يمكن أن يكون سالباً')
      .optional(),
    closing_bank: money
      .refine((n) => n >= 0, 'المبلغ المعتمد لإنستاباي لا يمكن أن يكون سالباً')
      .optional(),
    verified_bank: money
      .refine((n) => n >= 0, 'المبلغ المعتمد لإنستاباي لا يمكن أن يكون سالباً')
      .optional(),
    review_notes: optionalText(500),
    verification_checklist: optionalText(2000),
  })
  .strict()
  .transform((data, ctx) => {
    const closing_cash = data.closing_cash ?? data.verified_cash;
    if (closing_cash === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['closing_cash'],
        message: 'المبلغ المعتمد للنقدية مطلوب',
      });
      return z.NEVER;
    }
    return {
      closing_cash,
      closing_card: data.closing_card ?? data.verified_card,
      closing_bank: data.closing_bank ?? data.verified_bank,
      review_notes: data.review_notes,
      verification_checklist: data.verification_checklist,
    };
  });

export const posShiftCloseSchema = z
  .object({
    closing_cash: money.refine((n) => n >= 0, 'المبلغ النهائي لا يمكن أن يكون سالباً'),
    closing_card: money
      .refine((n) => n >= 0, 'المبلغ النهائي للبطاقات لا يمكن أن يكون سالباً')
      .optional(),
    closing_bank: money
      .refine((n) => n >= 0, 'المبلغ النهائي لإنستاباي لا يمكن أن يكون سالباً')
      .optional(),
    notes: optionalText(500),
    review_notes: optionalText(500),
    verification_checklist: optionalText(2000),
  })
  .strict();

export const posCheckoutSchema = z
  .object({
    branch_id: id(),
    shift_id: id().optional(),
    party_id: id().default('walk-in-customer'),
    date,
    discount: money.default(0),
    notes: optionalText(500),
    lines: z
      .array(
        z.object({
          product_id: id(),
          quantity: z.number().int().min(1).max(10000),
          unit_price: money.refine((n) => n >= 0),
          batch_id: id().optional().nullable(),
        }),
      )
      .min(1, 'يجب إضافة صنف واحد على الأقل في السلة'),
    payment: z
      .object({
        method: z.enum(['CASH', 'BANK', 'CARD', 'CREDIT']),
        amount_tendered: money.refine((n) => n >= 0),
        amount_paid: money.refine((n) => n >= 0),
        reference: optionalText(100),
        account_id: id().nullable().optional(),
      })
      .default({
        method: 'CASH',
        amount_tendered: 0,
        amount_paid: 0,
        reference: '',
      }),
    split_payments: z
      .array(
        z.object({
          method: z.enum(['CASH', 'BANK', 'CARD']),
          amount: money.refine((n) => n > 0),
          reference: optionalText(100),
          account_id: id().nullable().optional(),
        }),
      )
      .optional(),
  })
  .strict();

export const posParkedSaleSchema = z
  .object({
    branch_id: id(),
    shift_id: id().optional(),
    label: optionalText(80),
    customer_id: id().default('walk-in-customer'),
    discount: money.default(0),
    cart: z
      .array(
        z.object({
          product_id: id(),
          name: text(),
          sku: optionalText(60),
          quantity: z.number().int().min(1).max(10000),
          unit_price: money.refine((n) => n >= 0),
        }),
      )
      .min(1, 'لا يمكن تعليق سلة فارغة'),
  })
  .strict();

/** Cashier-initiated refund of a prior POS sale, tied to the same shift. */
export const posReturnSchema = z
  .object({
    document_id: id(),
    // Defaults to cash; the cashier can only refund to the drawer for now.
    method: z.enum(['CASH', 'CARD', 'BANK']).default('CASH'),
    reference: optionalText(100),
    notes: optionalText(500),
    lines: z
      .array(
        z.object({
          product_id: id(),
          quantity: z.number().int().min(1).max(10000),
        }),
      )
      .min(1, 'يجب تحديد صنف واحد على الأقل للإرجاع'),
  })
  .strict();

export const purchaseOrderSchema = z
  .object({
    branch_id: id(),
    party_id: id(),
    date,
    expected_delivery_date: date.optional().nullable(),
    tax_rate: z.number().int().min(0).max(10000).default(0),
    notes: optionalText(2000),
    lines: z
      .array(
        z
          .object({
            product_id: id(),
            quantity: quantity,
            unit_price: money,
            tax_rate: z.number().int().min(0).max(10000).default(0),
          })
          .strict(),
      )
      .min(1, 'يجب إضافة صنف واحد على الأقل في أمر الشراء')
      .max(100),
  })
  .strict();

export const landedCostSchema = z
  .object({
    cost_type: z.enum(['SHIPPING', 'CUSTOMS', 'CLEARANCE', 'HANDLING', 'OTHER']),
    cost_name: z.string().trim().min(2, 'اسم بند التكلفة مطلوب').max(100),
    amount: money.refine((n) => n > 0, 'قيمة التكلفة يجب أن تكون أكبر من صفر'),
    allocation_method: z.enum(['BY_VALUE', 'BY_QUANTITY']).default('BY_VALUE'),
    notes: optionalText(500),
  })
  .strict();

export const priceListSchema = z
  .object({
    name: z.string().trim().min(2, 'اسم قائمة الأسعار مطلوب').max(100),
    code: z.string().trim().min(2, 'كود قائمة الأسعار مطلوب').max(50),
    discount_basis_pts: z.number().int().min(0).max(10000).default(0),
    is_default: z.boolean().optional(),
    is_active: z.boolean().optional(),
    notes: optionalText(500),
  })
  .strict();

export const priceListItemSchema = z
  .object({
    price_list_id: id(),
    product_id: id(),
    min_quantity: z.number().int().min(1, 'الكمية الدنيا يجب أن تكون 1 على الأقل').default(1),
    price: money.refine((n) => n >= 0, 'السعر لا يمكن أن يكون سالباً'),
  })
  .strict();

export const quotationSchema = z
  .object({
    type: z.enum(['QUOTATION', 'PROFORMA']).default('QUOTATION'),
    branch_id: id(),
    party_id: id(),
    date,
    valid_until: date.optional().nullable(),
    tax_rate: z.number().int().min(0).max(10000).default(1400),
    discount: money.default(0),
    notes: optionalText(2000),
    lines: z
      .array(
        z
          .object({
            product_id: id(),
            quantity: quantity,
            unit_price: money,
            notes: optionalText(500),
          })
          .strict(),
      )
      .min(1, 'يجب إضافة بند واحد على الأقل في عرض السعر')
      .max(100),
  })
  .strict();
