import { z } from 'zod';

const emptyToUndefined = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);

/** Query strings arrive as string | string[] | undefined; normalise to a single trimmed value. */
const queryText = z.preprocess(
  (v) => (Array.isArray(v) ? v[0] : emptyToUndefined(v)),
  z.string().trim().optional(),
);

const clearable = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v);

/** Empty strings from HTML forms clear the stored value (null) instead of being rejected. */
export const optionalText = z.preprocess(
  clearable,
  z.string().trim().max(2000).nullable().optional(),
);

const optionalEmail = z.preprocess(
  clearable,
  z.string().trim().email('البريد الإلكتروني غير صالح').max(200).nullable().optional(),
);

const optionalDate = z.preprocess(
  clearable,
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'التاريخ يجب أن يكون بالصيغة YYYY-MM-DD')
    .nullable()
    .optional(),
);

const optionalTime = z.preprocess(
  clearable,
  z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'الوقت يجب أن يكون بالصيغة HH:MM')
    .nullable()
    .optional(),
);

export const dealStatusSchema = z.enum(['OPEN', 'WON', 'LOST']);
export const activityTypeSchema = z.enum(['CALL', 'MEETING', 'TASK', 'EMAIL', 'NOTE']);
export const activityStatusSchema = z.enum(['PENDING', 'COMPLETED', 'CANCELLED']);
export const activityPrioritySchema = z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']);

export const dealListQuerySchema = z.object({
  branch_id: queryText,
  stage_id: queryText,
  status: z.preprocess(emptyToUndefined, dealStatusSchema.optional()),
  assigned_to: queryText,
  search: z.preprocess(emptyToUndefined, z.string().trim().max(120).optional()),
});

const dealFields = {
  title: z.string().trim().min(2, 'عنوان الصفقة مطلوب').max(200),
  contact_name: z.string().trim().min(2, 'اسم جهة الاتصال مطلوب').max(160),
  contact_phone: optionalText,
  contact_email: optionalEmail,
  party_id: optionalText,
  stage_id: z.string().trim().min(1).optional(),
  expected_revenue: z.number().int().min(0, 'القيمة المتوقعة لا يمكن أن تكون سالبة').default(0),
  probability: z.number().int().min(0).max(100).optional(),
  expected_close_date: optionalDate,
  assigned_to_user_id: optionalText,
  notes: optionalText,
};

export const dealCreateSchema = z.object({
  ...dealFields,
  branch_id: z.string().trim().min(1, 'الفرع مطلوب'),
});

export const dealUpdateSchema = z
  .object({
    title: dealFields.title.optional(),
    contact_name: dealFields.contact_name.optional(),
    contact_phone: optionalText,
    contact_email: optionalEmail,
    party_id: optionalText,
    expected_revenue: z.number().int().min(0, 'القيمة المتوقعة لا يمكن أن تكون سالبة').optional(),
    probability: z.number().int().min(0).max(100).optional(),
    expected_close_date: optionalDate,
    assigned_to_user_id: optionalText,
    notes: optionalText,
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'لا توجد بيانات لتعديلها',
  });

export const stageChangeSchema = z.object({
  stage_id: z.string().trim().min(1, 'المرحلة مطلوبة'),
  lost_reason: optionalText,
});

export const activityListQuerySchema = z.object({
  branch_id: queryText,
  deal_id: queryText,
  party_id: queryText,
  status: z.preprocess(emptyToUndefined, activityStatusSchema.optional()),
  user_id: queryText,
  overdue: z.preprocess(
    (v) => (v === '1' || v === 'true' ? true : undefined),
    z.boolean().optional(),
  ),
});

export const activityCreateSchema = z.object({
  deal_id: optionalText,
  party_id: optionalText,
  branch_id: optionalText,
  type: activityTypeSchema,
  title: z.string().trim().min(2, 'عنوان النشاط مطلوب').max(240),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'تاريخ الاستحقاق مطلوب'),
  due_time: optionalTime,
  assigned_to_user_id: optionalText,
  priority: activityPrioritySchema.default('NORMAL'),
  outcome_notes: optionalText,
});

export const activityUpdateSchema = z
  .object({
    title: z.string().trim().min(2).max(240).optional(),
    due_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'التاريخ يجب أن يكون بالصيغة YYYY-MM-DD')
      .optional(),
    due_time: optionalTime,
    assigned_to_user_id: optionalText,
    priority: activityPrioritySchema.optional(),
    status: activityStatusSchema.optional(),
    outcome_notes: optionalText,
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'لا توجد بيانات لتعديلها',
  });

export const activityCompleteSchema = z.object({
  outcome_notes: optionalText,
});

export const targetListQuerySchema = z.object({
  branch_id: queryText,
  month: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'الشهر يجب أن يكون بالصيغة YYYY-MM')
      .optional(),
  ),
  user_id: queryText,
});

export const targetCreateSchema = z.object({
  user_id: z.string().trim().min(1, 'المستخدم مطلوب'),
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'الشهر يجب أن يكون بالصيغة YYYY-MM'),
  target_amount: z.number().int().positive('المستهدف يجب أن يكون أكبر من صفر'),
  commission_bps: z.number().int().min(0).max(10000).default(200),
  notes: optionalText,
});

export type DealListQuery = z.infer<typeof dealListQuerySchema>;
export type DealCreateInput = z.infer<typeof dealCreateSchema>;
export type DealUpdateInput = z.infer<typeof dealUpdateSchema>;
export type ActivityListQuery = z.infer<typeof activityListQuerySchema>;
export type ActivityCreateInput = z.infer<typeof activityCreateSchema>;
export type ActivityUpdateInput = z.infer<typeof activityUpdateSchema>;
export type TargetListQuery = z.infer<typeof targetListQuerySchema>;
export type TargetCreateInput = z.infer<typeof targetCreateSchema>;
