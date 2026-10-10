export type Role =
  'ADMIN' | 'STAFF' | 'GENERAL_ACCOUNTANT' | 'TREASURY_ACCOUNTANT' | 'BRANCH_MANAGER' | 'CASHIER';

export type PermissionKey =
  | 'sales:view'
  | 'sales:create'
  | 'sales:post'
  | 'sales:cancel'
  | 'pos:access'
  | 'pos:shift_open'
  | 'pos:shift_close'
  | 'pos:cash_movement'
  | 'pos:discount'
  | 'purchases:view'
  | 'purchases:create'
  | 'purchases:post'
  | 'purchases:cancel'
  | 'products:view'
  | 'products:manage'
  | 'inventory:adjust'
  | 'transfers:manage'
  | 'customers:manage'
  | 'suppliers:manage'
  | 'expenses:manage'
  | 'payments:manage'
  | 'reports:view'
  | 'distributions:manage'
  | 'branches:manage'
  | 'users:manage'
  | 'company:manage'
  | 'audit:view';

export type DocType = 'SALE' | 'PURCHASE';
export type PartyType = 'CUSTOMER' | 'SUPPLIER';
export type PaymentMethod = 'CASH' | 'BANK' | 'CARD';
export type BranchKind = 'HQ' | 'STORE' | 'WAREHOUSE' | 'ONLINE';
export type ExpenseAllocation = 'BRANCH' | 'EQUAL' | 'REVENUE';
export type TransferStatus = 'DRAFT' | 'IN_TRANSIT' | 'RECEIVED' | 'CANCELLED';
export type DistributionStatus = 'DRAFT' | 'APPROVED' | 'PAID' | 'CANCELLED';

export type PosShiftStatus = 'OPEN' | 'PENDING_REVIEW' | 'CLOSED';
export type PosCashMovementType = 'IN' | 'OUT';

export interface PosShift {
  id: string;
  number: string;
  branch_id: string;
  user_id: string;
  status: PosShiftStatus;
  opened_at: string;
  closed_at: string | null;
  opening_cash: number;
  expected_cash: number;
  closing_cash: number | null;
  difference: number;
  cashier_declared_cash?: number | null;
  reviewed_by?: string | null;
  reviewer_name?: string | null;
  review_notes?: string;
  discrepancy_expense_id?: string | null;
  notes: string;
  created_at: string;
  user_name?: string;
  branch_name?: string;
}

export interface PosCashMovement {
  id: string;
  shift_id: string;
  type: PosCashMovementType;
  amount: number;
  reason: string;
  created_by: string;
  created_at: string;
  user_name?: string;
}

export interface PosShiftSummary {
  shift: PosShift;
  cash_sales: number;
  card_sales: number;
  bank_sales: number;
  credit_sales: number;
  total_sales: number;
  sales_count: number;
  cash_in: number;
  cash_out: number;
  opening_cash: number;
  expected_cash: number;
  closing_cash: number | null;
  difference: number;
  cashier_declared_cash?: number | null;
  discrepancy_expense_id?: string | null;
  movements: PosCashMovement[];
}

export interface PosCartLine {
  product_id: string;
  name: string;
  sku: string;
  unit: string;
  unit_price: number;
  quantity: number;
  stock: number;
  line_discount: number;
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  active: number;
  created_at: string;
  branch_ids?: string[];
  permissions?: PermissionKey[];
  overrides?: Record<string, boolean>;
}
export interface Company {
  id: number;
  name: string;
  email: string;
  phone: string;
  address: string;
  tax_number: string;
  currency: string;
  tax_rate: number;
  invoice_note: string;
}
export interface Branch {
  id: string;
  code: string;
  name: string;
  kind: BranchKind;
  phone: string;
  address: string;
  active: number;
  opened_on: string;
  closed_on: string | null;
  created_at: string;
  stock_units?: number;
  stock_value?: number;
  users?: { id: string; name: string; role: Role }[];
}
export interface BranchProduct {
  product_id: string;
  sku: string;
  name: string;
  category: string;
  unit: string;
  cost_price: number;
  base_sale_price: number;
  base_min_stock: number;
  product_active: number;
  active: number;
  sale_price: number | null;
  min_stock: number | null;
  stock: number;
}
export interface Product {
  id: string;
  sku: string;
  name: string;
  category: string;
  unit: string;
  sale_price: number;
  cost_price: number;
  stock: number;
  min_stock: number;
  active: number;
  created_at: string;
  /** Branch-scoped reads: 1 when the product is sellable in the selected branch. */
  available?: number;
  branch_id?: string;
  branch_name?: string;
}
export interface Party {
  id: string;
  type: PartyType;
  name: string;
  email: string;
  phone: string;
  address: string;
  tax_number: string;
  notes: string;
  active: number;
  created_at: string;
  balance: number;
  documents_count: number;
}
export interface DocLine {
  id: string;
  document_id: string;
  product_id: string;
  name: string;
  sku: string;
  quantity: number;
  unit_price: number;
  cost_price: number;
  total: number;
}
export interface Payment {
  id: string;
  document_id: string;
  amount: number;
  method: PaymentMethod;
  date: string;
  reference: string;
  created_by: string;
  created_at: string;
  number?: string;
  party_name?: string;
  type?: DocType;
  branch_name?: string;
}
export interface Document {
  id: string;
  number: string;
  type: DocType;
  status: 'DRAFT' | 'POSTED' | 'CANCELLED';
  branch_id: string;
  branch_name: string;
  branch_code?: string;
  party_id: string;
  party_name: string;
  party_phone?: string;
  party_address?: string;
  party_tax_number?: string;
  date: string;
  due_date: string;
  subtotal: number;
  discount: number;
  tax_rate: number;
  tax: number;
  total: number;
  paid: number;
  notes: string;
  created_by: string;
  created_at: string;
  lines?: DocLine[];
  payments?: Payment[];
}
export interface Expense {
  id: string;
  title: string;
  category: string;
  amount: number;
  date: string;
  method: PaymentMethod;
  notes: string;
  created_at: string;
  branch_id: string | null;
  branch_name?: string | null;
  allocation: ExpenseAllocation;
}
export interface Movement {
  id: string;
  product_id: string;
  product_name: string;
  sku: string;
  quantity: number;
  reason: string;
  number: string | null;
  user_name: string;
  created_at: string;
  branch_name?: string;
  transfer_number?: string | null;
}
export interface Audit {
  id: string;
  user_name: string;
  action: string;
  entity: string;
  details: string;
  created_at: string;
}
export interface Dashboard {
  sales: number;
  purchases: number;
  expenses: number;
  grossProfit: number;
  netProfit: number;
  salesGrowth: number;
  receivables: number;
  payables: number;
  collected: number;
  disbursed: number;
  cashFlow: number;
  stockValue: number;
  productCount: number;
  customerCount: number;
  invoiceCount: number;
  overdueCount: number;
  series: { date: string; sales: number; purchases: number }[];
  recentDocuments: Document[];
  lowStock: Product[];
  topProducts: { name: string; sku: string; quantity: number; revenue: number }[];
  expenseCategories: { category: string; amount: number }[];
  activities: Audit[];
}
export interface TransferLine {
  id: string;
  transfer_id: string;
  product_id: string;
  name: string;
  sku: string;
  quantity_sent: number;
  quantity_received: number | null;
  unit_cost: number;
}
export interface Transfer {
  id: string;
  number: string;
  from_branch_id: string;
  to_branch_id: string;
  from_branch_name: string;
  to_branch_name: string;
  status: TransferStatus;
  date: string;
  notes: string;
  created_at: string;
  shipped_at: string | null;
  received_at: string | null;
  cancelled_at: string | null;
  lines?: TransferLine[];
}
export interface TransferSuggestion {
  product_id: string;
  sku: string;
  name: string;
  from_branch_id: string;
  from_branch_name: string;
  to_branch_id: string;
  to_branch_name: string;
  quantity: number;
}
export interface Owner {
  id: string;
  name: string;
  phone: string;
  email: string;
  share_bps: number;
  active: number;
  created_at: string;
  contributed: number;
  withdrawn: number;
  declared: number;
  paid: number;
  due: number;
}
export interface EquityEntry {
  id: string;
  owner_id: string;
  kind: 'CONTRIBUTION' | 'WITHDRAWAL';
  amount: number;
  method: PaymentMethod;
  date: string;
  notes: string;
  created_at: string;
}
export interface BranchResult {
  branch_id: string;
  code: string;
  name: string;
  sales: number;
  cost: number;
  gross: number;
  expenses: number;
  net: number;
}
export interface DistributionPreview {
  period_from: string;
  period_to: string;
  reserve_bps: number;
  /** A live distribution already covers part of this period; creating one would be refused. */
  overlap: { number: string } | null;
  branches: BranchResult[];
  netProfit: number;
  reserve: number;
  distributable: number;
  shareTotal: number;
  cashAvailable: number;
  uncovered: number;
  lines: { owner_id: string; owner_name: string; share_bps: number; amount: number }[];
}
export interface Distribution {
  id: string;
  number: string;
  period_from: string;
  period_to: string;
  status: DistributionStatus;
  reserve_bps: number;
  net_profit: number;
  reserve_amount: number;
  distributable: number;
  snapshot: string;
  notes: string;
  created_at: string;
  approved_at: string | null;
  paid_at: string | null;
  lines?: {
    id: string;
    owner_id: string;
    owner_name: string;
    share_bps: number;
    amount: number;
    paid: number;
  }[];
  payments?: {
    id: string;
    line_id: string;
    owner_name: string;
    amount: number;
    method: PaymentMethod;
    date: string;
    reference: string;
  }[];
  breakdown?: BranchResult[];
}
export interface GroupOverview {
  from: string;
  to: string;
  branches: (BranchResult & {
    id: string;
    active: number;
    receivables: number;
    stockValue: number;
    stockUnits: number;
    lowStock: number;
    inTransitOut: number;
    inTransitIn: number;
    invoices: number;
  })[];
  totals: {
    sales: number;
    gross: number;
    expenses: number;
    net: number;
    receivables: number;
    stockValue: number;
    inTransitValue: number;
    shortageValue: number;
  };
  cashAvailable: number;
  owners: Owner[];
}
export interface StockMatrix {
  branches: { id: string; code: string; name: string; active: number }[];
  rows: {
    product_id: string;
    sku: string;
    name: string;
    unit: string;
    cost_price: number;
    total: number;
    by_branch: Record<string, number>;
  }[];
}
