import { all, one, run, id, now } from './db';
import { AppError } from './errors';
import type { CrmStage, CrmDeal, CrmActivity, SalesTarget } from '../src/types';

// --- Stages ---

export function listStages(): CrmStage[] {
  return all<CrmStage>('SELECT * FROM crm_stages ORDER BY order_index ASC');
}

export function getStage(id: string): CrmStage | null {
  return one<CrmStage>('SELECT * FROM crm_stages WHERE id=?', id) || null;
}

// --- Deals / Pipeline ---

export function listDeals(params?: {
  branch_id?: string;
  stage_id?: string;
  status?: string;
  assigned_to?: string;
  search?: string;
}): CrmDeal[] {
  let query = `
    SELECT d.*, s.name AS stage_name, s.color AS stage_color,
           p.name AS customer_name, u.name AS assigned_to_name,
           b.name AS branch_name, q.number AS quotation_number
    FROM crm_deals d
    JOIN crm_stages s ON s.id = d.stage_id
    JOIN branches b ON b.id = d.branch_id
    LEFT JOIN parties p ON p.id = d.party_id
    LEFT JOIN users u ON u.id = d.assigned_to_user_id
    LEFT JOIN quotations q ON q.id = d.quotation_id
    WHERE 1=1
  `;
  const sqlParams: any[] = [];

  if (params?.branch_id) {
    query += ' AND d.branch_id = ?';
    sqlParams.push(params.branch_id);
  }
  if (params?.stage_id) {
    query += ' AND d.stage_id = ?';
    sqlParams.push(params.stage_id);
  }
  if (params?.status) {
    query += ' AND d.status = ?';
    sqlParams.push(params.status);
  }
  if (params?.assigned_to) {
    query += ' AND d.assigned_to_user_id = ?';
    sqlParams.push(params.assigned_to);
  }
  if (params?.search) {
    query += ' AND (d.title LIKE ? OR d.contact_name LIKE ? OR d.code LIKE ?)';
    const term = `%${params.search}%`;
    sqlParams.push(term, term, term);
  }

  query += ' ORDER BY d.created_at DESC';
  return all<CrmDeal>(query, ...sqlParams);
}

export function getDeal(id: string): CrmDeal | null {
  const deal = one<CrmDeal>(
    `SELECT d.*, s.name AS stage_name, s.color AS stage_color,
            p.name AS customer_name, u.name AS assigned_to_name,
            b.name AS branch_name, q.number AS quotation_number
     FROM crm_deals d
     JOIN crm_stages s ON s.id = d.stage_id
     JOIN branches b ON b.id = d.branch_id
     LEFT JOIN parties p ON p.id = d.party_id
     LEFT JOIN users u ON u.id = d.assigned_to_user_id
     LEFT JOIN quotations q ON q.id = d.quotation_id
     WHERE d.id = ?`,
    id,
  );
  if (!deal) return null;

  const activities = all<CrmActivity>(
    `SELECT a.*, u.name AS assigned_to_name
     FROM crm_activities a
     LEFT JOIN users u ON u.id = a.assigned_to_user_id
     WHERE a.deal_id = ?
     ORDER BY a.due_date ASC, a.created_at DESC`,
    id,
  );

  return { ...deal, activities };
}

export function createDeal(data: {
  title: string;
  contact_name: string;
  contact_phone?: string;
  contact_email?: string;
  party_id?: string;
  stage_id?: string;
  expected_revenue?: number;
  probability?: number;
  expected_close_date?: string;
  assigned_to_user_id?: string;
  branch_id: string;
  notes?: string;
}): CrmDeal {
  // Generate sequence code
  const lastCode = one<{ max_code: string }>(
    "SELECT MAX(code) AS max_code FROM crm_deals WHERE code LIKE 'DEAL-%'",
  )?.max_code;
  let nextSeq = 1;
  if (lastCode) {
    const num = parseInt(lastCode.replace('DEAL-', ''), 10);
    if (!isNaN(num)) nextSeq = num + 1;
  }
  const code = `DEAL-${String(nextSeq).padStart(4, '0')}`;

  const dealId = id();
  const ts = now();
  const stageId = data.stage_id || 'stage_new';
  const stage = getStage(stageId);
  const prob = data.probability !== undefined ? data.probability : (stage?.probability ?? 10);

  run(
    `INSERT INTO crm_deals (
       id, code, title, party_id, contact_name, contact_phone, contact_email,
       stage_id, expected_revenue, probability, expected_close_date,
       assigned_to_user_id, branch_id, status, notes, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', ?, ?, ?)`,
    dealId,
    code,
    data.title,
    data.party_id || null,
    data.contact_name,
    data.contact_phone || null,
    data.contact_email || null,
    stageId,
    Math.max(0, data.expected_revenue || 0),
    Math.min(100, Math.max(0, prob)),
    data.expected_close_date || null,
    data.assigned_to_user_id || null,
    data.branch_id,
    data.notes || null,
    ts,
    ts,
  );

  return getDeal(dealId)!;
}

export function updateDealStage(dealId: string, newStageId: string): CrmDeal {
  const deal = one<CrmDeal>('SELECT * FROM crm_deals WHERE id=?', dealId);
  if (!deal) throw new AppError(404, 'الصفقة غير موجودة');

  const stage = getStage(newStageId);
  if (!stage) throw new AppError(404, 'المرحلة غير موجودة');

  let status: 'OPEN' | 'WON' | 'LOST' = 'OPEN';
  if (stage.is_won) status = 'WON';
  else if (stage.is_lost) status = 'LOST';

  const ts = now();
  run(
    `UPDATE crm_deals
     SET stage_id = ?, probability = ?, status = ?, updated_at = ?
     WHERE id = ?`,
    newStageId,
    stage.probability,
    status,
    ts,
    dealId,
  );

  return getDeal(dealId)!;
}

export function convertDealToCustomer(dealId: string): { party_id: string } {
  const deal = one<CrmDeal>('SELECT * FROM crm_deals WHERE id=?', dealId);
  if (!deal) throw new AppError(404, 'الصفقة غير موجودة');
  if (deal.party_id) return { party_id: deal.party_id };

  const partyId = id();
  const ts = now();

  run(
    `INSERT INTO parties (id, type, name, phone, email, active, created_at)
     VALUES (?, 'CUSTOMER', ?, ?, ?, 1, ?)`,
    partyId,
    deal.contact_name || deal.title,
    deal.contact_phone || '',
    deal.contact_email || '',
    ts,
  );

  run('UPDATE crm_deals SET party_id = ?, updated_at = ? WHERE id = ?', partyId, ts, dealId);
  return { party_id: partyId };
}

export function convertDealToQuotation(
  dealId: string,
  actor: { id: string; name: string },
): { quotation_id: string; party_id: string } {
  const deal = one<CrmDeal>('SELECT * FROM crm_deals WHERE id=?', dealId);
  if (!deal) throw new AppError(404, 'الصفقة غير موجودة');

  let partyId = deal.party_id;
  if (!partyId) {
    const res = convertDealToCustomer(dealId);
    partyId = res.party_id;
  }

  // Generate Quotation number: QTN-YYYY-XXXX
  const year = new Date().getFullYear().toString();
  const prefix = `QTN-${year}-`;
  const lastQ = one<{ number: string }>(
    'SELECT number FROM quotations WHERE number LIKE ? ORDER BY number DESC LIMIT 1',
    `${prefix}%`,
  )?.number;
  let nextNum = 1;
  if (lastQ) {
    const numPart = parseInt(lastQ.replace(prefix, ''), 10);
    if (!isNaN(numPart)) nextNum = numPart + 1;
  }
  const qtnNumber = `${prefix}${String(nextNum).padStart(4, '0')}`;

  const quotationId = id();
  const ts = now();
  const validUntil = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  run(
    `INSERT INTO quotations (
       id, number, type, branch_id, party_id, date, valid_until, status,
       subtotal, discount, tax_rate, tax, total,
       notes, created_by, created_at, updated_at
     ) VALUES (?, ?, 'QUOTATION', ?, ?, ?, ?, 'DRAFT', ?, 0, 1400, 0, ?, ?, ?, ?, ?)`,
    quotationId,
    qtnNumber,
    deal.branch_id,
    partyId,
    ts.split('T')[0],
    validUntil,
    deal.expected_revenue,
    deal.expected_revenue,
    `تم إنشاؤه آلياً من الصفقة ${deal.code}: ${deal.title}`,
    actor.id,
    ts,
    ts,
  );

  // Advance deal to proposal stage if earlier
  run(
    `UPDATE crm_deals
     SET quotation_id = ?, stage_id = CASE WHEN stage_id IN ('stage_new','stage_contacted','stage_qualified') THEN 'stage_proposal' ELSE stage_id END, updated_at = ?
     WHERE id = ?`,
    quotationId,
    ts,
    dealId,
  );

  return { quotation_id: quotationId, party_id: partyId };
}

// --- Activities & Follow-ups ---

export function listActivities(params?: {
  deal_id?: string;
  party_id?: string;
  status?: string;
  user_id?: string;
}): CrmActivity[] {
  let query = `
    SELECT a.*, d.title AS deal_title, p.name AS customer_name, u.name AS assigned_to_name
    FROM crm_activities a
    LEFT JOIN crm_deals d ON d.id = a.deal_id
    LEFT JOIN parties p ON p.id = a.party_id
    LEFT JOIN users u ON u.id = a.assigned_to_user_id
    WHERE 1=1
  `;
  const sqlParams: any[] = [];

  if (params?.deal_id) {
    query += ' AND a.deal_id = ?';
    sqlParams.push(params.deal_id);
  }
  if (params?.party_id) {
    query += ' AND a.party_id = ?';
    sqlParams.push(params.party_id);
  }
  if (params?.status) {
    query += ' AND a.status = ?';
    sqlParams.push(params.status);
  }
  if (params?.user_id) {
    query += ' AND a.assigned_to_user_id = ?';
    sqlParams.push(params.user_id);
  }

  query += ' ORDER BY a.due_date ASC, a.created_at DESC';
  return all<CrmActivity>(query, ...sqlParams);
}

export function createActivity(data: {
  deal_id?: string;
  party_id?: string;
  type: 'CALL' | 'MEETING' | 'TASK' | 'EMAIL' | 'NOTE';
  title: string;
  due_date: string;
  due_time?: string;
  assigned_to_user_id?: string;
}): CrmActivity {
  const actId = id();
  const ts = now();

  run(
    `INSERT INTO crm_activities (
       id, deal_id, party_id, type, title, due_date, due_time, assigned_to_user_id, status, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?)`,
    actId,
    data.deal_id || null,
    data.party_id || null,
    data.type,
    data.title,
    data.due_date,
    data.due_time || null,
    data.assigned_to_user_id || null,
    ts,
  );

  return one<CrmActivity>(
    `SELECT a.*, d.title AS deal_title, p.name AS customer_name, u.name AS assigned_to_name
     FROM crm_activities a
     LEFT JOIN crm_deals d ON d.id = a.deal_id
     LEFT JOIN parties p ON p.id = a.party_id
     LEFT JOIN users u ON u.id = a.assigned_to_user_id
     WHERE a.id = ?`,
    actId,
  )!;
}

export function completeActivity(activityId: string, outcomeNotes?: string): CrmActivity {
  const act = one<CrmActivity>('SELECT * FROM crm_activities WHERE id=?', activityId);
  if (!act) throw new AppError(404, 'النشاط غير موجود');

  const ts = now();
  run(
    `UPDATE crm_activities
     SET status = 'COMPLETED', outcome_notes = ?, completed_at = ?
     WHERE id = ?`,
    outcomeNotes || null,
    ts,
    activityId,
  );

  return one<CrmActivity>(
    `SELECT a.*, d.title AS deal_title, p.name AS customer_name, u.name AS assigned_to_name
     FROM crm_activities a
     LEFT JOIN crm_deals d ON d.id = a.deal_id
     LEFT JOIN parties p ON p.id = a.party_id
     LEFT JOIN users u ON u.id = a.assigned_to_user_id
     WHERE a.id = ?`,
    activityId,
  )!;
}

// --- Sales Targets & Commissions ---

export function listSalesTargets(month?: string, userId?: string): SalesTarget[] {
  let query = `
    SELECT st.*, u.name AS user_name
    FROM sales_targets st
    JOIN users u ON u.id = st.user_id
    WHERE 1=1
  `;
  const sqlParams: any[] = [];

  if (month) {
    query += ' AND st.month = ?';
    sqlParams.push(month);
  }
  if (userId) {
    query += ' AND st.user_id = ?';
    sqlParams.push(userId);
  }

  query += ' ORDER BY st.month DESC, u.name ASC';
  const targets = all<SalesTarget>(query, ...sqlParams);

  // Calculate actual achievement per target
  return targets.map((t) => {
    // Sum paid sales payments for invoices posted by this user in this month
    const paidRow = one<{ achieved: number }>(
      `SELECT COALESCE(SUM(p.amount), 0) AS achieved
       FROM payments p
       JOIN documents d ON d.id = p.document_id
       WHERE d.type = 'SALE' AND d.created_by = ? AND p.date LIKE ?`,
      t.user_id,
      `${t.month}%`,
    );
    const achieved = paidRow?.achieved || 0;
    const achievedPct = t.target_amount > 0 ? Math.round((achieved / t.target_amount) * 100) : 0;
    const earnedCommission = Math.round((achieved * t.commission_bps) / 10000);

    return {
      ...t,
      achieved_amount: achieved,
      achieved_pct: achievedPct,
      earned_commission: earnedCommission,
    };
  });
}

export function setSalesTarget(data: {
  user_id: string;
  month: string;
  target_amount: number;
  commission_bps?: number;
  notes?: string;
}): SalesTarget {
  const user = one<{ id: string }>('SELECT id FROM users WHERE id=?', data.user_id);
  if (!user) throw new AppError(404, 'المستخدم غير موجود');

  const bps = data.commission_bps !== undefined ? Math.max(0, data.commission_bps) : 200;
  const ts = now();

  run(
    `INSERT INTO sales_targets (id, user_id, month, target_amount, commission_bps, notes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, month) DO UPDATE SET
       target_amount = excluded.target_amount,
       commission_bps = excluded.commission_bps,
       notes = excluded.notes`,
    id(),
    data.user_id,
    data.month,
    data.target_amount,
    bps,
    data.notes || null,
    ts,
  );

  return listSalesTargets(data.month, data.user_id)[0];
}
