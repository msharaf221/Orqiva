import { all, id, one, run } from '../../db';
import { businessToday } from '../../clock';
import { inScope, scopeSql, type Scope } from '../../scope';
import type {
  CrmActivity,
  CrmAssignee,
  CrmDeal,
  CrmOverview,
  CrmStage,
  SalesTarget,
} from '../../../src/types';

const DEAL_SELECT = `
  SELECT d.*, s.name AS stage_name, s.color AS stage_color,
         p.name AS customer_name, u.name AS assigned_to_name,
         b.name AS branch_name, q.number AS quotation_number
  FROM crm_deals d
  JOIN crm_stages s ON s.id = d.stage_id
  JOIN branches b ON b.id = d.branch_id
  LEFT JOIN parties p ON p.id = d.party_id
  LEFT JOIN users u ON u.id = d.assigned_to_user_id
  LEFT JOIN quotations q ON q.id = d.quotation_id
`;

const ACTIVITY_SELECT = `
  SELECT a.*, d.title AS deal_title, p.name AS customer_name, u.name AS assigned_to_name
  FROM crm_activities a
  LEFT JOIN crm_deals d ON d.id = a.deal_id
  LEFT JOIN parties p ON p.id = a.party_id
  LEFT JOIN users u ON u.id = a.assigned_to_user_id
`;

// --- Pipeline stages ------------------------------------------------------------------

export function listStages(): CrmStage[] {
  return all<CrmStage>('SELECT * FROM crm_stages ORDER BY order_index ASC');
}

export function findStage(stageId: string): CrmStage | undefined {
  return one<CrmStage>('SELECT * FROM crm_stages WHERE id=?', stageId);
}

// --- Deals ----------------------------------------------------------------------------

export interface DealFilters {
  stage_id?: string;
  status?: 'OPEN' | 'WON' | 'LOST';
  assigned_to?: string;
  search?: string;
}

export function listDeals(scope: Scope, filters: DealFilters = {}): CrmDeal[] {
  const branch = scopeSql('d.branch_id', scope);
  const clauses = [branch.sql];
  const params: (string | number)[] = [...branch.params];

  if (filters.stage_id) {
    clauses.push('d.stage_id = ?');
    params.push(filters.stage_id);
  }
  if (filters.status) {
    clauses.push('d.status = ?');
    params.push(filters.status);
  }
  if (filters.assigned_to) {
    clauses.push('d.assigned_to_user_id = ?');
    params.push(filters.assigned_to);
  }
  if (filters.search) {
    clauses.push('(d.title LIKE ? OR d.contact_name LIKE ? OR d.code LIKE ? OR p.name LIKE ?)');
    const term = `%${filters.search}%`;
    params.push(term, term, term, term);
  }

  return all<CrmDeal>(
    `${DEAL_SELECT}
     WHERE ${clauses.join(' AND ')}
     ORDER BY s.order_index ASC, d.updated_at DESC`,
    ...params,
  );
}

/** Fetches a deal and its activity timeline; returns null when outside the actor's scope. */
export function findDeal(id: string, scope: Scope): CrmDeal | null {
  const deal = one<CrmDeal>(`${DEAL_SELECT} WHERE d.id = ?`, id);
  if (!deal || !inScope(scope, deal.branch_id)) return null;

  deal.activities = all<CrmActivity>(
    `${ACTIVITY_SELECT}
     WHERE a.deal_id = ?
     ORDER BY CASE WHEN a.status = 'PENDING' THEN 0 ELSE 1 END, a.due_date ASC, a.created_at DESC`,
    id,
  );
  return deal;
}

/** Internal lookup for writes. Callers must authorize the returned branch before mutating. */
export function findDealRow(id: string): CrmDeal | undefined {
  return one<CrmDeal>(`${DEAL_SELECT} WHERE d.id = ?`, id);
}

export function dealCode(): string {
  // A single atomic upsert makes the sequence safe even when two cashiers save at once.
  run(
    "INSERT INTO sequences(id,value) VALUES('DEAL',1) ON CONFLICT(id) DO UPDATE SET value=value+1",
  );
  const row = one<{ value: number }>("SELECT value FROM sequences WHERE id='DEAL'");
  return `DEAL-${String(row?.value ?? 1).padStart(4, '0')}`;
}

export interface DealInsert {
  code: string;
  title: string;
  party_id?: string;
  contact_name: string;
  contact_phone?: string;
  contact_email?: string;
  stage_id: string;
  expected_revenue: number;
  probability: number;
  expected_close_date?: string;
  assigned_to_user_id?: string;
  branch_id: string;
  notes?: string;
}

export function insertDeal(input: DealInsert): string {
  const dealId = id();
  const ts = new Date().toISOString();
  run(
    `INSERT INTO crm_deals (
       id, code, title, party_id, contact_name, contact_phone, contact_email,
       stage_id, expected_revenue, probability, expected_close_date,
       assigned_to_user_id, branch_id, status, notes, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', ?, ?, ?)`,
    dealId,
    input.code,
    input.title,
    input.party_id ?? null,
    input.contact_name,
    input.contact_phone ?? null,
    input.contact_email ?? null,
    input.stage_id,
    input.expected_revenue,
    input.probability,
    input.expected_close_date ?? null,
    input.assigned_to_user_id ?? null,
    input.branch_id,
    input.notes ?? null,
    ts,
    ts,
  );
  return dealId;
}

const DEAL_WRITABLE_COLUMNS = [
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

export type DealPatch = Partial<{
  [K in (typeof DEAL_WRITABLE_COLUMNS)[number]]: string | number | null;
}>;

export function updateDealRow(id: string, patch: DealPatch): void {
  const entries = Object.entries(patch).filter(([key]) =>
    (DEAL_WRITABLE_COLUMNS as readonly string[]).includes(key),
  );
  if (!entries.length) return;
  const assignments = entries.map(([key]) => `${key} = ?`).join(', ');
  run(
    `UPDATE crm_deals SET ${assignments}, updated_at = ? WHERE id = ?`,
    ...entries.map(([, value]) => value ?? null),
    new Date().toISOString(),
    id,
  );
}

export function setDealStageRow(
  id: string,
  stage: CrmStage,
  options: { lostReason?: string },
): void {
  const status = stage.is_won ? 'WON' : stage.is_lost ? 'LOST' : 'OPEN';
  const ts = new Date().toISOString();
  run(
    `UPDATE crm_deals
     SET stage_id = ?, probability = ?, status = ?,
         closed_at = CASE WHEN ? IN ('WON','LOST') THEN ? ELSE NULL END,
         lost_reason = CASE WHEN ? = 'LOST' THEN ? ELSE NULL END,
         updated_at = ?
     WHERE id = ?`,
    stage.id,
    stage.probability,
    status,
    status,
    ts,
    status,
    options.lostReason ?? null,
    ts,
    id,
  );
}

export function attachPartyToDeal(dealId: string, partyId: string): void {
  run(
    'UPDATE crm_deals SET party_id = ?, updated_at = ? WHERE id = ?',
    partyId,
    new Date().toISOString(),
    dealId,
  );
}

export function attachQuotationToDeal(
  dealId: string,
  quotationId: string,
  advanceToProposal: boolean,
): void {
  const ts = new Date().toISOString();
  run(
    `UPDATE crm_deals
     SET quotation_id = ?,
         stage_id = CASE WHEN ? AND stage_id IN ('stage_new','stage_contacted','stage_qualified')
                         THEN 'stage_proposal' ELSE stage_id END,
         updated_at = ?
     WHERE id = ?`,
    quotationId,
    advanceToProposal ? 1 : 0,
    ts,
    dealId,
  );
}

// --- Activities -----------------------------------------------------------------------

export interface ActivityFilters {
  deal_id?: string;
  party_id?: string;
  status?: 'PENDING' | 'COMPLETED' | 'CANCELLED';
  user_id?: string;
  overdue?: boolean;
}

export function listActivities(scope: Scope, filters: ActivityFilters = {}): CrmActivity[] {
  const branch = scopeSql('a.branch_id', scope);
  const clauses = [branch.sql];
  const params: (string | number)[] = [...branch.params];

  if (filters.deal_id) {
    clauses.push('a.deal_id = ?');
    params.push(filters.deal_id);
  }
  if (filters.party_id) {
    clauses.push('a.party_id = ?');
    params.push(filters.party_id);
  }
  if (filters.status) {
    clauses.push('a.status = ?');
    params.push(filters.status);
  }
  if (filters.user_id) {
    clauses.push('a.assigned_to_user_id = ?');
    params.push(filters.user_id);
  }
  if (filters.overdue) {
    clauses.push("a.status = 'PENDING' AND a.due_date < ?");
    params.push(businessToday());
  }

  return all<CrmActivity>(
    `${ACTIVITY_SELECT}
     WHERE ${clauses.join(' AND ')}
     ORDER BY CASE WHEN a.status = 'PENDING' THEN 0 ELSE 1 END,
              a.due_date ASC, COALESCE(a.due_time, '00:00') ASC, a.created_at DESC`,
    ...params,
  );
}

export function findActivity(id: string): CrmActivity | undefined {
  return one<CrmActivity>(`${ACTIVITY_SELECT} WHERE a.id = ?`, id);
}

export interface ActivityInsert {
  deal_id?: string;
  party_id?: string;
  branch_id: string;
  type: 'CALL' | 'MEETING' | 'TASK' | 'EMAIL' | 'NOTE';
  title: string;
  due_date: string;
  due_time?: string;
  assigned_to_user_id?: string;
  priority: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
  outcome_notes?: string;
}

export function insertActivity(input: ActivityInsert): string {
  const activityId = id();
  const ts = new Date().toISOString();
  run(
    `INSERT INTO crm_activities (
       id, deal_id, party_id, branch_id, type, title, due_date, due_time,
       assigned_to_user_id, priority, status, outcome_notes, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?)`,
    activityId,
    input.deal_id ?? null,
    input.party_id ?? null,
    input.branch_id,
    input.type,
    input.title,
    input.due_date,
    input.due_time ?? null,
    input.assigned_to_user_id ?? null,
    input.priority,
    input.outcome_notes ?? null,
    ts,
    ts,
  );
  return activityId;
}

const ACTIVITY_WRITABLE_COLUMNS = [
  'title',
  'due_date',
  'due_time',
  'assigned_to_user_id',
  'priority',
  'status',
  'outcome_notes',
] as const;

export type ActivityPatch = Partial<{
  [K in (typeof ACTIVITY_WRITABLE_COLUMNS)[number]]: string | null;
}>;

export function updateActivityRow(id: string, patch: ActivityPatch): void {
  const entries = Object.entries(patch).filter(([key]) =>
    (ACTIVITY_WRITABLE_COLUMNS as readonly string[]).includes(key),
  );
  if (!entries.length) return;
  const assignments = entries.map(([key]) => `${key} = ?`).join(', ');
  const status = patch.status;
  const completedAt = status === 'COMPLETED' ? new Date().toISOString() : status ? null : undefined;
  run(
    `UPDATE crm_activities
     SET ${assignments}${completedAt !== undefined ? ', completed_at = ?' : ''}, updated_at = ?
     WHERE id = ?`,
    ...entries.map(([, value]) => value ?? null),
    ...(completedAt !== undefined ? [completedAt] : []),
    new Date().toISOString(),
    id,
  );
}

// --- Sales targets --------------------------------------------------------------------

export function listSalesTargets(scope: Scope, month?: string, userId?: string): SalesTarget[] {
  const userScope = scopeSql('ub.branch_id', scope);
  const clauses = ['1=1'];
  const params: string[] = [];
  if (scope.ids !== null) {
    clauses.push(
      `EXISTS (SELECT 1 FROM user_branches ub WHERE ub.user_id = st.user_id AND ${userScope.sql})`,
    );
    params.push(...userScope.params);
  }
  if (month) {
    clauses.push('st.month = ?');
    params.push(month);
  }
  if (userId) {
    clauses.push('st.user_id = ?');
    params.push(userId);
  }

  const targets = all<SalesTarget>(
    `SELECT st.*, u.name AS user_name
     FROM sales_targets st
     JOIN users u ON u.id = st.user_id
     WHERE ${clauses.join(' AND ')}
     ORDER BY st.month DESC, u.name ASC`,
    ...params,
  );

  return targets.map((target) => {
    const documentScope = scopeSql('d.branch_id', scope);
    const paidRow = one<{ achieved: number }>(
      `SELECT COALESCE(SUM(p.amount), 0) AS achieved
       FROM payments p
       JOIN documents d ON d.id = p.document_id
       WHERE d.type = 'SALE' AND d.status = 'POSTED'
         AND d.created_by = ? AND p.date LIKE ?
         AND ${documentScope.sql}`,
      target.user_id,
      `${target.month}%`,
      ...documentScope.params,
    );
    const achieved = paidRow?.achieved ?? 0;
    return {
      ...target,
      achieved_amount: achieved,
      achieved_pct:
        target.target_amount > 0 ? Math.round((achieved / target.target_amount) * 100) : 0,
      earned_commission: Math.round((achieved * target.commission_bps) / 10000),
    };
  });
}

export function upsertSalesTarget(input: {
  user_id: string;
  month: string;
  target_amount: number;
  commission_bps: number;
  notes?: string;
}): void {
  run(
    `INSERT INTO sales_targets (id, user_id, month, target_amount, commission_bps, notes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, month) DO UPDATE SET
       target_amount = excluded.target_amount,
       commission_bps = excluded.commission_bps,
       notes = excluded.notes`,
    id(),
    input.user_id,
    input.month,
    input.target_amount,
    input.commission_bps,
    input.notes ?? null,
    new Date().toISOString(),
  );
}

// --- Overview -------------------------------------------------------------------------

export function overview(scope: Scope): CrmOverview {
  const branch = scopeSql('d.branch_id', scope);
  const row = one<{
    open_deals: number;
    open_value: number;
    weighted_value: number;
    won_value: number;
    won_deals: number;
    lost_deals: number;
    total_value: number;
  }>(
    `SELECT
       COALESCE(SUM(CASE WHEN d.status='OPEN' THEN 1 ELSE 0 END), 0) AS open_deals,
       COALESCE(SUM(CASE WHEN d.status='OPEN' THEN d.expected_revenue ELSE 0 END), 0) AS open_value,
       COALESCE(SUM(CASE WHEN d.status='OPEN'
                         THEN d.expected_revenue * d.probability / 100 ELSE 0 END), 0) AS weighted_value,
       COALESCE(SUM(CASE WHEN d.status='WON' THEN d.expected_revenue ELSE 0 END), 0) AS won_value,
       COALESCE(SUM(CASE WHEN d.status='WON' THEN 1 ELSE 0 END), 0) AS won_deals,
       COALESCE(SUM(CASE WHEN d.status='LOST' THEN 1 ELSE 0 END), 0) AS lost_deals,
       COALESCE(SUM(d.expected_revenue), 0) AS total_value
     FROM crm_deals d
     WHERE ${branch.sql}`,
    ...branch.params,
  );

  const activityScope = scopeSql('a.branch_id', scope);
  const activity = one<{ pending: number; overdue: number }>(
    `SELECT
       COALESCE(SUM(CASE WHEN a.status='PENDING' THEN 1 ELSE 0 END), 0) AS pending,
       COALESCE(SUM(CASE WHEN a.status='PENDING' AND a.due_date < ? THEN 1 ELSE 0 END), 0) AS overdue
     FROM crm_activities a
     WHERE ${activityScope.sql}`,
    businessToday(),
    ...activityScope.params,
  );

  const won = row?.won_deals ?? 0;
  const lost = row?.lost_deals ?? 0;
  const closed = won + lost;
  const totalDeals = won + lost + (row?.open_deals ?? 0);

  return {
    open_deals: row?.open_deals ?? 0,
    open_value: row?.open_value ?? 0,
    weighted_value: Math.round(row?.weighted_value ?? 0),
    won_value: row?.won_value ?? 0,
    won_deals: won,
    lost_deals: lost,
    win_rate: closed ? Math.round((won / closed) * 100) : 0,
    average_deal: totalDeals ? Math.round((row?.total_value ?? 0) / totalDeals) : 0,
    pending_activities: activity?.pending ?? 0,
    overdue_activities: activity?.overdue ?? 0,
  };
}

// --- Small lookups used by the service -------------------------------------------------

export function findUser(id: string): { id: string; name: string } | undefined {
  return one<{ id: string; name: string }>('SELECT id, name FROM users WHERE id=?', id);
}

/**
 * Active users the actor may assign CRM work to, limited to branches they can see.
 * Administrators are valid assignees in every branch, matching `userCanAccessBranch`.
 */
export function listAssignees(scope: Scope): CrmAssignee[] {
  const branch = scopeSql('ub.branch_id', scope);
  const filter =
    scope.ids === null
      ? '1=1'
      : `(u.role = 'ADMIN'
          OR EXISTS (SELECT 1 FROM user_branches ub WHERE ub.user_id = u.id AND ${branch.sql}))`;
  return all<CrmAssignee>(
    `SELECT DISTINCT u.id, u.name, u.email,
            COALESCE(r.name, u.role) AS role_name
     FROM users u
     LEFT JOIN user_roles ur ON ur.user_id = u.id
     LEFT JOIN roles r ON r.id = ur.role_id
     WHERE u.active = 1 AND ${filter}
     ORDER BY u.name ASC`,
    ...branch.params,
  );
}

export function userCanAccessBranch(userId: string, branchId: string): boolean {
  return Boolean(
    one(
      `SELECT 1 FROM users u
       WHERE u.id = ?
         AND (u.role = 'ADMIN'
              OR EXISTS (SELECT 1 FROM user_branches ub
                         WHERE ub.user_id = u.id AND ub.branch_id = ?))`,
      userId,
      branchId,
    ),
  );
}

export function findParty(id: string): { id: string; type: string } | undefined {
  return one<{ id: string; type: string }>('SELECT id, type FROM parties WHERE id=?', id);
}
