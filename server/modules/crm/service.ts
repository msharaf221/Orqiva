import { id, one, run, transaction } from '../../db';
import { audit } from '../../audit';
import { AppError } from '../../errors';
import { businessToday } from '../../clock';
import { nextNumber } from '../../sequence';
import { inScope, writableBranch, type Actor, type Scope } from '../../scope';
import type {
  CrmActivity,
  CrmAssignee,
  CrmDeal,
  CrmOverview,
  CrmStage,
  SalesTarget,
} from '../../../src/types';
import {
  attachPartyToDeal,
  attachQuotationToDeal,
  dealCode,
  findActivity,
  findDeal,
  findDealRow,
  findParty,
  findStage,
  findUser,
  insertActivity,
  insertDeal,
  listActivities,
  listAssignees,
  listDeals,
  listSalesTargets,
  listStages,
  overview,
  setDealStageRow,
  updateActivityRow,
  updateDealRow,
  upsertSalesTarget,
  userCanAccessBranch,
  type ActivityFilters,
  type ActivityPatch,
  type DealFilters,
  type DealPatch,
} from './repository';
import type {
  ActivityCreateInput,
  ActivityUpdateInput,
  DealCreateInput,
  DealUpdateInput,
  TargetCreateInput,
} from './schemas';

// --- Shared guards --------------------------------------------------------------------

function requireDeal(id: string, scope: Scope): CrmDeal {
  const deal = findDealRow(id);
  if (!deal || !inScope(scope, deal.branch_id)) throw new AppError(404, 'الصفقة غير موجودة');
  return deal;
}

function requireWritableDeal(deal: CrmDeal, actor: Actor): void {
  writableBranch(actor, deal.branch_id);
}

function assertAssignee(userId: string | null | undefined, branchId: string): void {
  if (!userId) return;
  if (!findUser(userId)) throw new AppError(404, 'المستخدم المسؤول غير موجود');
  if (!userCanAccessBranch(userId, branchId))
    throw new AppError(400, 'المستخدم المسؤول غير مسند إلى هذا الفرع');
}

function assertCustomer(partyId: string | null | undefined): void {
  if (!partyId) return;
  const party = findParty(partyId);
  if (!party) throw new AppError(404, 'العميل غير موجود');
  if (party.type !== 'CUSTOMER') throw new AppError(400, 'الطرف المحدد ليس عميلاً');
}

function ensureParty(deal: CrmDeal, actor: Actor): string {
  if (deal.party_id) return deal.party_id;
  const partyId = id();
  run(
    `INSERT INTO parties (id, type, name, phone, email, active, created_at)
     VALUES (?, 'CUSTOMER', ?, ?, ?, 1, ?)`,
    partyId,
    deal.contact_name || deal.title,
    deal.contact_phone ?? '',
    deal.contact_email ?? '',
    new Date().toISOString(),
  );
  attachPartyToDeal(deal.id, partyId);
  audit(actor, 'تحويل صفقة إلى عميل', 'CRM_DEAL', deal.id, deal.contact_name || deal.title);
  return partyId;
}

// --- Stages ---------------------------------------------------------------------------

export function stages(): CrmStage[] {
  return listStages();
}

export function assignees(scope: Scope): CrmAssignee[] {
  return listAssignees(scope);
}

// --- Deals ----------------------------------------------------------------------------

export function deals(scope: Scope, filters: DealFilters): CrmDeal[] {
  return listDeals(scope, filters);
}

export function deal(id: string, scope: Scope): CrmDeal {
  return requireDeal(id, scope);
}

export function createDeal(input: DealCreateInput, actor: Actor, scope: Scope): CrmDeal {
  writableBranch(actor, input.branch_id);
  if (scope.ids !== null && !scope.ids.includes(input.branch_id))
    throw new AppError(403, 'ليس لديك صلاحية على هذا الفرع');

  const stage = findStage(input.stage_id ?? 'stage_new');
  if (!stage) throw new AppError(404, 'المرحلة غير موجودة');
  if (stage.is_won || stage.is_lost) throw new AppError(400, 'لا يمكن إنشاء صفقة في مرحلة مغلقة');

  assertAssignee(input.assigned_to_user_id, input.branch_id);
  assertCustomer(input.party_id);

  let dealId = '';
  transaction(() => {
    dealId = insertDeal({
      code: dealCode(),
      title: input.title,
      party_id: input.party_id ?? undefined,
      contact_name: input.contact_name,
      contact_phone: input.contact_phone ?? undefined,
      contact_email: input.contact_email ?? undefined,
      stage_id: stage.id,
      expected_revenue: input.expected_revenue,
      probability: input.probability ?? stage.probability,
      expected_close_date: input.expected_close_date ?? undefined,
      assigned_to_user_id: input.assigned_to_user_id ?? undefined,
      branch_id: input.branch_id,
      notes: input.notes ?? undefined,
    });
    audit(actor, 'إنشاء صفقة', 'CRM_DEAL', dealId, input.title);
  });

  return findDeal(dealId, scope)!;
}

export function updateDeal(
  dealId: string,
  input: DealUpdateInput,
  actor: Actor,
  scope: Scope,
): CrmDeal {
  const current = requireDeal(dealId, scope);
  requireWritableDeal(current, actor);

  if (input.assigned_to_user_id !== undefined)
    assertAssignee(input.assigned_to_user_id, current.branch_id);
  if (input.party_id !== undefined) assertCustomer(input.party_id);

  const patch: DealPatch = {};
  const fields = [
    'title',
    'party_id',
    'contact_name',
    'contact_phone',
    'contact_email',
    'expected_revenue',
    'probability',
    'expected_close_date',
    'assigned_to_user_id',
    'notes',
  ] as const;
  for (const field of fields) {
    if (field in input) patch[field] = input[field] ?? null;
  }

  transaction(() => {
    updateDealRow(dealId, patch);
    audit(actor, 'تعديل صفقة', 'CRM_DEAL', dealId, current.code);
  });

  return findDeal(dealId, scope)!;
}

export function changeDealStage(
  dealId: string,
  stageId: string,
  lostReason: string | null | undefined,
  actor: Actor,
  scope: Scope,
): CrmDeal {
  const current = requireDeal(dealId, scope);
  requireWritableDeal(current, actor);

  const stage = findStage(stageId);
  if (!stage) throw new AppError(404, 'المرحلة غير موجودة');

  if (stage.is_lost && !lostReason?.trim()) throw new AppError(400, 'يرجى تسجيل سبب خسارة الصفقة');

  transaction(() => {
    setDealStageRow(dealId, stage, { lostReason: lostReason ?? undefined });
    audit(
      actor,
      'تغيير مرحلة صفقة',
      'CRM_DEAL',
      dealId,
      `${current.stage_name ?? current.stage_id} ← ${stage.name}`,
    );
  });

  return findDeal(dealId, scope)!;
}

export function convertDealToCustomer(
  dealId: string,
  actor: Actor,
  scope: Scope,
): { party_id: string } {
  const current = requireDeal(dealId, scope);
  requireWritableDeal(current, actor);
  if (current.party_id) return { party_id: current.party_id };

  let partyId = '';
  transaction(() => {
    partyId = ensureParty(current, actor);
  });
  return { party_id: partyId };
}

export function convertDealToQuotation(
  dealId: string,
  actor: Actor,
  scope: Scope,
): { quotation_id: string; party_id: string; number: string } {
  const current = requireDeal(dealId, scope);
  requireWritableDeal(current, actor);

  if (current.quotation_id) {
    return {
      quotation_id: current.quotation_id,
      party_id: current.party_id ?? '',
      number: current.quotation_number ?? '',
    };
  }

  let quotationId = '';
  let number = '';
  let partyId = current.party_id ?? '';

  transaction(() => {
    partyId = ensureParty(current, actor);

    const year = businessToday().slice(0, 4);
    number = nextNumber('QTN', year);
    quotationId = id();
    const today = businessToday();
    const validUntil = new Date(Date.parse(today) + 30 * 86_400_000).toISOString().slice(0, 10);
    const total = current.expected_revenue;
    const taxRate =
      one<{ tax_rate: number }>('SELECT tax_rate FROM company WHERE id=1')?.tax_rate ?? 1400;
    const subtotal = Math.round((total * 10000) / (10000 + taxRate));
    const tax = total - subtotal;
    const ts = new Date().toISOString();

    run(
      `INSERT INTO quotations (
         id, number, type, branch_id, party_id, date, valid_until, status,
         subtotal, discount, tax_rate, tax, total, notes, created_by, created_at, updated_at
       ) VALUES (?, ?, 'QUOTATION', ?, ?, ?, ?, 'DRAFT', ?, 0, ?, ?, ?, ?, ?, ?, ?)`,
      quotationId,
      number,
      current.branch_id,
      partyId,
      today,
      validUntil,
      subtotal,
      taxRate,
      tax,
      total,
      `تم إنشاؤه آلياً من الصفقة ${current.code}: ${current.title}`,
      actor.id,
      ts,
      ts,
    );

    const stage = findStage(current.stage_id);
    const proposal = findStage('stage_proposal');
    const advance =
      !!stage &&
      !!proposal &&
      !stage.is_won &&
      !stage.is_lost &&
      stage.order_index < proposal.order_index;
    attachQuotationToDeal(dealId, quotationId, advance);
    audit(actor, 'تحويل صفقة إلى عرض سعر', 'CRM_DEAL', dealId, number);
  });

  return { quotation_id: quotationId, party_id: partyId, number };
}

// --- Activities -----------------------------------------------------------------------

export function activities(scope: Scope, filters: ActivityFilters): CrmActivity[] {
  return listActivities(scope, filters);
}

export function createActivity(
  input: ActivityCreateInput,
  actor: Actor,
  scope: Scope,
): CrmActivity {
  let branchId = input.branch_id ?? '';
  let partyId = input.party_id ?? undefined;

  if (input.deal_id) {
    const deal = requireDeal(input.deal_id, scope);
    requireWritableDeal(deal, actor);
    branchId = deal.branch_id;
    partyId = partyId ?? deal.party_id ?? undefined;
  } else {
    if (!branchId) throw new AppError(400, 'الفرع مطلوب لنشاط غير مرتبط بصفقة');
    writableBranch(actor, branchId);
    if (scope.ids !== null && !scope.ids.includes(branchId))
      throw new AppError(403, 'ليس لديك صلاحية على هذا الفرع');
    if (partyId) {
      const party = findParty(partyId);
      if (!party) throw new AppError(404, 'العميل غير موجود');
    }
  }

  assertAssignee(input.assigned_to_user_id, branchId);

  let activityId = '';
  transaction(() => {
    activityId = insertActivity({
      deal_id: input.deal_id ?? undefined,
      party_id: partyId,
      branch_id: branchId,
      type: input.type,
      title: input.title,
      due_date: input.due_date,
      due_time: input.due_time ?? undefined,
      assigned_to_user_id: input.assigned_to_user_id ?? undefined,
      priority: input.priority,
      outcome_notes: input.outcome_notes ?? undefined,
    });
    audit(actor, 'جدولة متابعة', 'CRM_ACTIVITY', activityId, input.title);
  });

  return findActivity(activityId)!;
}

function requireActivity(id: string, scope: Scope): CrmActivity {
  const activity = findActivity(id);
  if (!activity || !inScope(scope, activity.branch_id)) throw new AppError(404, 'النشاط غير موجود');
  return activity;
}

export function updateActivity(
  activityId: string,
  input: ActivityUpdateInput,
  actor: Actor,
  scope: Scope,
): CrmActivity {
  const current = requireActivity(activityId, scope);
  writableBranch(actor, current.branch_id);

  if (input.assigned_to_user_id !== undefined)
    assertAssignee(input.assigned_to_user_id, current.branch_id);

  const patch: ActivityPatch = {};
  for (const field of [
    'title',
    'due_date',
    'due_time',
    'assigned_to_user_id',
    'priority',
    'status',
    'outcome_notes',
  ] as const) {
    if (field in input) patch[field] = input[field] ?? null;
  }

  transaction(() => {
    updateActivityRow(activityId, patch);
    audit(
      actor,
      input.status === 'COMPLETED'
        ? 'إنجاز متابعة'
        : input.status === 'CANCELLED'
          ? 'إلغاء متابعة'
          : 'تعديل متابعة',
      'CRM_ACTIVITY',
      activityId,
      current.title,
    );
  });

  return findActivity(activityId)!;
}

export function completeActivity(
  activityId: string,
  outcomeNotes: string | null | undefined,
  actor: Actor,
  scope: Scope,
): CrmActivity {
  return updateActivity(
    activityId,
    { status: 'COMPLETED', ...(outcomeNotes !== undefined ? { outcome_notes: outcomeNotes } : {}) },
    actor,
    scope,
  );
}

// --- Targets & overview ---------------------------------------------------------------

export function targets(scope: Scope, month?: string, userId?: string): SalesTarget[] {
  return listSalesTargets(scope, month, userId);
}

export function setTarget(input: TargetCreateInput, actor: Actor, scope: Scope): SalesTarget {
  if (!findUser(input.user_id)) throw new AppError(404, 'المستخدم غير موجود');
  if (
    scope.ids !== null &&
    !scope.ids.some((branchId) => userCanAccessBranch(input.user_id, branchId))
  )
    throw new AppError(403, 'المستخدم لا يعمل في أي من فروعك');

  transaction(() => {
    upsertSalesTarget({
      user_id: input.user_id,
      month: input.month,
      target_amount: input.target_amount,
      commission_bps: input.commission_bps,
      notes: input.notes ?? undefined,
    });
    audit(
      actor,
      'ضبط مستهدف بيعي',
      'SALES_TARGET',
      `${input.user_id}:${input.month}`,
      `${input.target_amount}`,
    );
  });

  const target = listSalesTargets(scope, input.month, input.user_id)[0];
  if (!target) throw new AppError(404, 'تعذر تحميل المستهدف بعد الحفظ');
  return target;
}

export function crmOverview(scope: Scope): CrmOverview {
  return overview(scope);
}
