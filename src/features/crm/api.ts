import { api } from '../../api';
import type {
  CrmActivity,
  CrmAssignee,
  CrmDeal,
  CrmOverview,
  CrmStage,
  SalesTarget,
  ActivityStatus,
  ActivityType,
  ActivityPriority,
  DealStatus,
} from '../../types';

export interface DealFilters {
  search?: string;
  stageId?: string;
  assignedTo?: string;
  status?: DealStatus;
}

export interface ActivityFilters {
  status?: ActivityStatus;
  dealId?: string;
}

export interface DealInput {
  title: string;
  contact_name: string;
  contact_phone?: string;
  contact_email?: string;
  party_id?: string;
  stage_id?: string;
  expected_revenue: number;
  probability?: number;
  expected_close_date?: string;
  assigned_to_user_id?: string;
  branch_id?: string;
  notes?: string;
}

export interface ActivityInput {
  deal_id?: string;
  party_id?: string;
  branch_id?: string;
  type: ActivityType;
  title: string;
  due_date: string;
  due_time?: string;
  assigned_to_user_id?: string;
  priority?: ActivityPriority;
  outcome_notes?: string;
}

export interface TargetInput {
  user_id: string;
  month: string;
  target_amount: number;
  commission_bps: number;
  notes?: string;
}

function withQuery(path: string, params: Record<string, string | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) query.set(key, value);
  }
  const suffix = query.toString();
  return suffix ? `${path}?${suffix}` : path;
}

/** Read URLs are shared with `useData`, so screens and mutations cannot drift apart. */
export const crmUrls = {
  assignees: (branchId?: string) => withQuery('/crm/assignees', { branch_id: branchId }),
  overview: (branchId?: string) => withQuery('/crm/overview', { branch_id: branchId }),
  deals: (branchId?: string, filters: DealFilters = {}) =>
    withQuery('/crm/deals', {
      branch_id: branchId,
      search: filters.search,
      stage_id: filters.stageId,
      assigned_to: filters.assignedTo,
      status: filters.status,
    }),
  deal: (id: string, branchId?: string) =>
    withQuery(`/crm/deals/${encodeURIComponent(id)}`, { branch_id: branchId }),
  activities: (branchId?: string, filters: ActivityFilters = {}) =>
    withQuery('/crm/activities', {
      branch_id: branchId,
      status: filters.status,
      deal_id: filters.dealId,
    }),
  targets: (month: string, branchId?: string) =>
    withQuery('/crm/targets', { month, branch_id: branchId }),
};

export const crmApi = {
  stages: () => api<CrmStage[]>('/crm/stages'),

  assignees: (branchId?: string) => api<CrmAssignee[]>(crmUrls.assignees(branchId)),

  overview: (branchId?: string) => api<CrmOverview>(crmUrls.overview(branchId)),

  deals: (branchId?: string, filters: DealFilters = {}) =>
    api<CrmDeal[]>(crmUrls.deals(branchId, filters)),

  deal: (id: string, branchId?: string) => api<CrmDeal>(crmUrls.deal(id, branchId)),

  createDeal: (input: DealInput, branchId?: string) =>
    api<CrmDeal>(withQuery('/crm/deals', { branch_id: branchId }), 'POST', input),

  updateDeal: (id: string, input: Partial<DealInput>, branchId?: string) =>
    api<CrmDeal>(
      withQuery(`/crm/deals/${encodeURIComponent(id)}`, { branch_id: branchId }),
      'PATCH',
      input,
    ),

  changeStage: (id: string, stageId: string, branchId?: string, lostReason?: string) =>
    api<CrmDeal>(
      withQuery(`/crm/deals/${encodeURIComponent(id)}/stage`, { branch_id: branchId }),
      'PATCH',
      { stage_id: stageId, ...(lostReason ? { lost_reason: lostReason } : {}) },
    ),

  convertToCustomer: (id: string, branchId?: string) =>
    api<{ party_id: string }>(
      withQuery(`/crm/deals/${encodeURIComponent(id)}/convert-customer`, {
        branch_id: branchId,
      }),
      'POST',
      {},
    ),

  convertToQuotation: (id: string, branchId?: string) =>
    api<{ quotation_id: string; party_id: string; number: string }>(
      withQuery(`/crm/deals/${encodeURIComponent(id)}/convert-quotation`, {
        branch_id: branchId,
      }),
      'POST',
      {},
    ),

  activities: (branchId?: string, filters: ActivityFilters = {}) =>
    api<CrmActivity[]>(crmUrls.activities(branchId, filters)),

  createActivity: (input: ActivityInput, branchId?: string) =>
    api<CrmActivity>(withQuery('/crm/activities', { branch_id: branchId }), 'POST', input),

  updateActivity: (
    id: string,
    input: Partial<{
      title: string;
      due_date: string;
      due_time: string | null;
      assigned_to_user_id: string | null;
      priority: ActivityPriority;
      status: ActivityStatus;
      outcome_notes: string | null;
    }>,
    branchId?: string,
  ) =>
    api<CrmActivity>(
      withQuery(`/crm/activities/${encodeURIComponent(id)}`, { branch_id: branchId }),
      'PATCH',
      input,
    ),

  completeActivity: (id: string, outcomeNotes?: string, branchId?: string) =>
    api<CrmActivity>(
      withQuery(`/crm/activities/${encodeURIComponent(id)}/complete`, {
        branch_id: branchId,
      }),
      'POST',
      { outcome_notes: outcomeNotes },
    ),

  targets: (month: string, branchId?: string) =>
    api<SalesTarget[]>(crmUrls.targets(month, branchId)),

  setTarget: (input: TargetInput, branchId?: string) =>
    api<SalesTarget>(withQuery('/crm/targets', { branch_id: branchId }), 'POST', input),
};
