-- Migration 021: Enterprise CRM Pipeline, Activities, and Sales Targets

-- 1. CRM Stages
CREATE TABLE IF NOT EXISTS crm_stages (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  order_index INTEGER NOT NULL,
  probability INTEGER NOT NULL DEFAULT 10,
  is_won INTEGER NOT NULL DEFAULT 0 CHECK(is_won IN (0,1)),
  is_lost INTEGER NOT NULL DEFAULT 0 CHECK(is_lost IN (0,1)),
  color TEXT NOT NULL DEFAULT '#3b82f6'
);

-- Seed standard B2B sales pipeline stages
INSERT OR IGNORE INTO crm_stages (id, name, order_index, probability, is_won, is_lost, color) VALUES
  ('stage_new',         'عميل محتمل جديد', 1, 10,  0, 0, '#64748b'),
  ('stage_contacted',   'تواصل أولي',       2, 25,  0, 0, '#3b82f6'),
  ('stage_qualified',   'مؤهل للمبيعات',    3, 50,  0, 0, '#8b5cf6'),
  ('stage_proposal',    'تقديم عرض سعر',    4, 75,  0, 0, '#f59e0b'),
  ('stage_negotiation', 'مفاوضات وإغلاق',   5, 90,  0, 0, '#06b6d4'),
  ('stage_won',         'صفقة فائزة',       6, 100, 1, 0, '#10b981'),
  ('stage_lost',        'صفقة خاسرة',       7, 0,   0, 1, '#ef4444');

-- 2. CRM Deals / Opportunities
CREATE TABLE IF NOT EXISTS crm_deals (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  party_id TEXT REFERENCES parties(id),
  contact_name TEXT NOT NULL,
  contact_phone TEXT,
  contact_email TEXT,
  stage_id TEXT NOT NULL REFERENCES crm_stages(id),
  expected_revenue INTEGER NOT NULL DEFAULT 0 CHECK(expected_revenue >= 0),
  probability INTEGER NOT NULL DEFAULT 50 CHECK(probability >= 0 AND probability <= 100),
  expected_close_date TEXT,
  assigned_to_user_id TEXT REFERENCES users(id),
  branch_id TEXT NOT NULL REFERENCES branches(id),
  quotation_id TEXT REFERENCES quotations(id),
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','WON','LOST')),
  lost_reason TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_crm_deals_stage ON crm_deals(stage_id);
CREATE INDEX IF NOT EXISTS idx_crm_deals_status ON crm_deals(status);
CREATE INDEX IF NOT EXISTS idx_crm_deals_party ON crm_deals(party_id);
CREATE INDEX IF NOT EXISTS idx_crm_deals_assigned ON crm_deals(assigned_to_user_id);

-- 3. CRM Activities & Follow-ups
CREATE TABLE IF NOT EXISTS crm_activities (
  id TEXT PRIMARY KEY,
  deal_id TEXT REFERENCES crm_deals(id) ON DELETE CASCADE,
  party_id TEXT REFERENCES parties(id),
  type TEXT NOT NULL CHECK(type IN ('CALL','MEETING','TASK','EMAIL','NOTE')),
  title TEXT NOT NULL,
  due_date TEXT NOT NULL,
  due_time TEXT,
  assigned_to_user_id TEXT REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','COMPLETED','CANCELLED')),
  outcome_notes TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_crm_activities_deal ON crm_activities(deal_id);
CREATE INDEX IF NOT EXISTS idx_crm_activities_due ON crm_activities(due_date);
CREATE INDEX IF NOT EXISTS idx_crm_activities_status ON crm_activities(status);

-- 4. Sales Targets & Commissions
CREATE TABLE IF NOT EXISTS sales_targets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  month TEXT NOT NULL, -- YYYY-MM
  target_amount INTEGER NOT NULL CHECK(target_amount > 0),
  commission_bps INTEGER NOT NULL DEFAULT 200 CHECK(commission_bps >= 0),
  notes TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(user_id, month)
);
CREATE INDEX IF NOT EXISTS idx_sales_targets_user_month ON sales_targets(user_id, month);
