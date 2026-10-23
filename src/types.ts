export type Role =
  | 'ADMIN'
  | 'BRANCH_MANAGER'
  | 'GENERAL_ACCOUNTANT'
  | 'TREASURY_ACCOUNTANT'
  | 'CASHIER'
  | 'ACCOUNTANT'
  | 'SALES'
  | 'WAREHOUSE'
  | 'VIEWER'
  | 'STAFF'
  | (string & {});

/**
 * The single, canonical permission vocabulary — mirrors server/rbac.ts PERMISSIONS
 * and the seeds in database/migrations. Legacy role aliases no longer exist.
 */
export type PermissionKey =
  | 'admin:all'
  | 'pos:access'
  | 'pos:shift_open'
  | 'pos:shift_close'
  | 'pos:cash_movement'
  | 'pos:discount'
  | 'documents:view'
  | 'documents:create_sale'
  | 'documents:create_purchase'
  | 'documents:post'
  | 'documents:cancel'
  | 'inventory:view'
  | 'inventory:adjust'
  | 'inventory:stocktake_approve'
  | 'catalog:manage'
  | 'transfers:manage'
  | 'parties:view'
  | 'parties:manage'
  | 'finance:view'
  | 'finance:payments'
  | 'finance:expenses'
  | 'finance:accounts'
  | 'gl:view'
  | 'gl:manage'
  | 'reports:view'
  | 'reports:group_overview'
  | 'eta:view'
  | 'eta:manage'
  | 'distribution:manage'
  | 'branches:manage'
  | 'users:manage'
  | (string & {});

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
  expected_card?: number;
  expected_bank?: number;
  cashier_declared_card?: number | null;
  cashier_declared_bank?: number | null;
  closing_card?: number | null;
  closing_bank?: number | null;
  card_difference?: number;
  bank_difference?: number;
  terminal_batch_number?: string;
  card_slips_count?: number;
  bank_transfers_count?: number;
  safe_envelope_number?: string;
  proof_documents?: string;
  verification_checklist?: string;
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

export interface ParkedCartLine {
  product_id: string;
  name: string;
  sku?: string;
  quantity: number;
  unit_price: number;
}

export interface PosParkedSale {
  id: string;
  branch_id: string;
  shift_id: string | null;
  user_id: string;
  label: string;
  customer_id: string;
  label_discount: number;
  cart: string;
  total: number;
  created_at: string;
  user_name?: string;
  customer_name?: string;
}

/** A POSTED POS sale with its cumulative returned quantity, used for cashier refunds. */
export interface PosLookupSale extends Document {
  returned_qty?: number;
}

export type StocktakeStatus = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'CANCELLED';

export interface StocktakeSession {
  id: string;
  number: string;
  branch_id: string;
  status: StocktakeStatus;
  notes: string;
  counted_by: string;
  approved_by: string | null;
  created_at: string;
  submitted_at: string | null;
  approved_at: string | null;
  branch_name?: string;
  counted_by_name?: string;
  approved_by_name?: string | null;
  lines_count?: number;
  variance_lines?: number;
  variance_value?: number;
}

export interface StocktakeLine {
  id: string;
  session_id: string;
  product_id: string;
  product_name: string;
  sku: string;
  unit: string;
  expected_qty: number;
  counted_qty: number | null;
  unit_cost: number;
  counted_at: string | null;
}

export interface ReorderSuggestion {
  product_id: string;
  sku: string;
  name: string;
  unit: string;
  branch_id: string;
  branch_name: string;
  stock: number;
  min_stock: number;
  suggested_qty: number;
  cost_price: number;
  avg_cost: number;
  estimated_cost: number;
  below_threshold: boolean;
}

// ── General Ledger ───────────────────────────────────────────────────────────────────────

export type GlAccountType = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE';
export type JournalSourceType =
  | 'SALE'
  | 'PURCHASE'
  | 'SALE_RETURN'
  | 'PURCHASE_RETURN'
  | 'PAYMENT'
  | 'EXPENSE'
  | 'ACCOUNT_TRANSFER'
  | 'POS_CASH'
  | 'POS_SHIFT'
  | 'TRANSFER'
  | 'STOCKTAKE'
  | 'DISTRIBUTION'
  | 'EQUITY'
  | 'MANUAL'
  | 'REVERSAL'
  | 'OPENING';

export interface ChartAccount {
  id: string;
  code: string;
  name: string;
  type: GlAccountType;
  normal_side: 'DEBIT' | 'CREDIT';
  parent_id: string | null;
  is_system: number;
  system_key: string | null;
  active: number;
  notes: string;
  created_at: string;
  lines_count?: number;
  children_count?: number;
  balance?: number;
  parent_code?: string | null;
  parent_name?: string | null;
}

export interface JournalEntry {
  id: string;
  number: string;
  date: string;
  memo: string;
  source_type: JournalSourceType;
  source_id: string | null;
  branch_id: string | null;
  status: 'DRAFT' | 'POSTED' | 'REVERSED';
  reversal_of: string | null;
  created_by: string;
  created_at: string;
  branch_name?: string | null;
  created_by_name?: string;
  total?: number;
}

export interface JournalLine {
  id: string;
  entry_id: string;
  account_id: string;
  debit: number;
  credit: number;
  branch_id: string | null;
  memo: string;
  account_code?: string;
  account_name?: string;
  account_type?: GlAccountType;
  entry_number?: string;
  date?: string;
  source_type?: JournalSourceType;
  source_id?: string | null;
  running_balance?: number;
}

export interface TrialBalanceRow {
  account_id: string;
  code: string;
  name: string;
  type: GlAccountType;
  normal_side: 'DEBIT' | 'CREDIT';
  debit: number;
  credit: number;
  balance: number;
  opening: number;
}

export interface LedgerAccountStatement {
  account: ChartAccount;
  opening: number;
  lines: JournalLine[];
}

export interface GlSettings {
  fiscal_year_start_month: number;
  closed_through: string | null;
  updated_at: string | null;
}

export interface FinancialReportRow {
  account_id?: string;
  code?: string;
  name: string;
  amount: number;
  previous_amount?: number;
  change_percent?: number | null;
  is_deduction?: boolean;
}

export interface FinancialReportSection {
  title: string;
  rows: FinancialReportRow[];
  total: number;
  previous_total?: number;
  change_percent?: number | null;
}

export interface ProfitAndLossReport {
  period: { from: string; to: string };
  comparison_period?: { from: string; to: string };
  gross_sales: FinancialReportSection;
  sales_deductions: FinancialReportSection;
  net_revenue: number;
  cogs: FinancialReportSection;
  total_cogs: number;
  gross_profit: number;
  operating_expenses: FinancialReportSection;
  total_operating_expenses: number;
  net_profit: number;
  previous_net_revenue?: number;
  previous_total_cogs?: number;
  previous_gross_profit?: number;
  previous_total_operating_expenses?: number;
  previous_net_profit?: number;
  change_net_revenue?: number | null;
  change_gross_profit?: number | null;
  change_net_profit?: number | null;
}

export interface BalanceSheetReport {
  as_of: string;
  comparison_as_of?: string;
  assets: {
    current_assets: FinancialReportSection;
    non_current_assets: FinancialReportSection;
    total_assets: number;
    previous_total_assets?: number;
  };
  total_assets: number;
  liabilities: {
    current_liabilities: FinancialReportSection;
    non_current_liabilities: FinancialReportSection;
    total_liabilities: number;
    previous_total_liabilities?: number;
  };
  total_liabilities: number;
  equity: {
    items: FinancialReportSection;
    prior_period_earnings: number;
    current_period_earnings: number;
    total_equity: number;
    previous_total_equity?: number;
  };
  total_equity: number;
  total_liabilities_and_equity: number;
  previous_total_liabilities_and_equity?: number;
  is_balanced: boolean;
}

export interface PosShiftPaymentDetail {
  id: string;
  document_id: string;
  document_number: string;
  party_name: string;
  amount: number;
  method: string;
  date: string;
  reference: string;
  created_at?: string;
}

export interface PosShiftSummary {
  shift: PosShift;
  cash_sales: number;
  card_sales: number;
  bank_sales: number;
  credit_sales: number;
  total_sales: number;
  sales_count: number;
  refunds_total: number;
  refunds_count: number;
  cash_in: number;
  cash_out: number;
  opening_cash: number;
  expected_cash: number;
  expected_card: number;
  expected_bank: number;
  closing_cash: number | null;
  closing_card: number | null;
  closing_bank: number | null;
  difference: number;
  card_difference: number;
  bank_difference: number;
  cashier_declared_cash?: number | null;
  cashier_declared_card?: number | null;
  cashier_declared_bank?: number | null;
  terminal_batch_number?: string;
  card_slips_count?: number;
  bank_transfers_count?: number;
  safe_envelope_number?: string;
  proof_documents?: string;
  verification_checklist?: string;
  discrepancy_expense_id?: string | null;
  movements: PosCashMovement[];
  payments: PosShiftPaymentDetail[];
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

export interface PermissionDef {
  id: string;
  name: string;
  group: string;
}

export interface RoleDef {
  id: string;
  name: string;
  code: string;
  description: string;
  is_system: number;
  created_at: string;
  permissions: string[];
  user_count?: number;
}

export type DocType = 'SALE' | 'PURCHASE' | 'SALE_RETURN' | 'PURCHASE_RETURN';
export type PartyType = 'CUSTOMER' | 'SUPPLIER';

export interface ReturnableLine {
  product_id: string;
  name: string;
  sku: string;
  quantity: number;
  unit_price: number;
  cost_price: number;
  already_returned: number;
  returnable: number;
}
export type PaymentMethod = 'CASH' | 'BANK' | 'CARD';
export type BranchKind = 'HQ' | 'STORE' | 'WAREHOUSE' | 'ONLINE';
export type ExpenseAllocation = 'BRANCH' | 'EQUAL' | 'REVENUE';
export type TransferStatus = 'DRAFT' | 'IN_TRANSIT' | 'RECEIVED' | 'CANCELLED';
export type DistributionStatus = 'DRAFT' | 'APPROVED' | 'PAID' | 'CANCELLED';
export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  role_id?: string;
  role_name?: string;
  permissions?: string[];
  overrides?: Record<string, boolean>;
  active: number;
  created_at: string;
  branch_ids?: string[];
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
  /** ETA (Egyptian Tax Authority) taxpayer registration number. */
  tax_registration_number: string;
  /** ETA activity code describing the business activity. */
  activity_code: string;
  /** ETA submission environment: stub (offline), preprod or production. */
  eta_environment: 'stub' | 'preprod' | 'production';
}

export type EtaDocumentStatus =
  'NOT_SUBMITTED' | 'PENDING' | 'VALID' | 'INVALID' | 'FAILED' | 'CANCELLED';

export interface EInvoiceSubmission {
  id: string;
  document_id: string;
  uuid: string;
  document_type: 'INVOICE' | 'CREDIT_NOTE' | 'DEBIT_NOTE';
  status: 'PENDING' | 'SUBMITTED' | 'VALID' | 'INVALID' | 'FAILED' | 'CANCELLED';
  attempt: number;
  max_attempts: number;
  next_attempt_at: string;
  submitted_at: string | null;
  completed_at: string | null;
  eta_long_id: string;
  eta_response: string;
  last_error: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  document_number?: string;
  document_total?: number;
  party_name?: string;
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
  track_batches?: number;
  created_at: string;
  /** Effective Weighted Average Cost (WAC) — defaults to cost_price if not yet computed */
  avg_cost?: number;
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
  batch_id?: string | null;
  batch_number?: string | null;
  expiry_date?: string | null;
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
  account_id?: string | null;
  account_name?: string | null;
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
  original_document_id?: string | null;
  original_document_number?: string | null;
  pos_shift_id?: string | null;
  /** UBL 2.1 document UUID (mandatory for Egyptian e-invoice). */
  internal_code: string;
  /** ETA submission status (stub pipeline until real credentials are set). */
  eta_status: EtaDocumentStatus;
  /** ETA long submission id once accepted. */
  eta_long_id: string;
  /** UUID of the referenced invoice (Credit/Debit notes). */
  reference_uuid?: string | null;
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
  account_id?: string | null;
  account_name?: string | null;
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
export interface CostMovement {
  id: string;
  branch_id: string;
  branch_name: string;
  product_id: string;
  product_name: string;
  sku: string;
  delta_qty: number;
  unit_cost: number;
  avg_before: number;
  avg_after: number;
  reason: string;
  document_id: string | null;
  transfer_id: string | null;
  user_name: string;
  created_at: string;
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
    /** WAC per branch — COALESCE(avg_cost, reference cost_price) */
    wac_by_branch: Record<string, number>;
  }[];
}

export type AccountType = 'CASH' | 'BANK' | 'WALLET';
export interface CashAccount {
  id: string;
  name: string;
  type: AccountType;
  branch_id: string | null;
  branch_name?: string | null;
  currency: string;
  account_number: string;
  bank_name: string;
  initial_balance: number;
  allow_negative: number;
  active: number;
  notes: string;
  created_at: string;
  balance: number;
  total_in?: number;
  total_out?: number;
}

export interface AccountTransfer {
  id: string;
  number: string;
  from_account_id: string;
  from_account_name?: string;
  to_account_id: string;
  to_account_name?: string;
  amount: number;
  date: string;
  notes: string;
  created_by: string;
  created_at: string;
}

export interface AccountStatementEntry {
  id: string;
  date: string;
  type:
    | 'INITIAL'
    | 'SALE_PAYMENT'
    | 'PURCHASE_PAYMENT'
    | 'SALE_RETURN_REFUND'
    | 'PURCHASE_RETURN_REFUND'
    | 'EXPENSE'
    | 'DISTRIBUTION'
    | 'CONTRIBUTION'
    | 'WITHDRAWAL'
    | 'TRANSFER_IN'
    | 'TRANSFER_OUT';
  description: string;
  reference: string;
  in_amount: number;
  out_amount: number;
  balance: number;
  created_at: string;
}

export interface OpeningBalanceCashLine {
  cash_account_id: string;
  amount: number;
}

export interface OpeningBalancePartyLine {
  party_id: string;
  amount: number;
}

export interface OpeningBalanceStockLine {
  product_id: string;
  branch_id: string;
  quantity: number;
  unit_cost: number;
}

export interface OpeningBalanceAccountLine {
  account_id: string;
  debit: number;
  credit: number;
  memo?: string;
}

export interface OpeningBalancesPayload {
  date: string;
  memo?: string;
  balancing_account: 'OPENING_EQUITY' | 'CAPITAL';
  cash_accounts?: OpeningBalanceCashLine[];
  customers?: OpeningBalancePartyLine[];
  suppliers?: OpeningBalancePartyLine[];
  inventory_items?: OpeningBalanceStockLine[];
  other_accounts?: OpeningBalanceAccountLine[];
}

export interface OpeningBalancesStatus {
  has_opening_entry: boolean;
  opening_entry?: JournalEntry;
  opening_lines?: JournalLine[];
  can_post: boolean;
  earliest_transaction_date?: string | null;
  reason?: string;
}

export interface VatReturnSection {
  taxable_base: number;
  tax_amount: number;
  documents_count: number;
}

export interface VatReturnReport {
  from: string;
  to: string;
  branch_id?: string | null;
  branch_name?: string | null;
  sales: {
    standard_rated_14: VatReturnSection;
    returns: VatReturnSection;
    net_taxable_sales: number;
    net_output_tax: number;
  };
  purchases: {
    standard_rated_14: VatReturnSection;
    returns: VatReturnSection;
    net_taxable_purchases: number;
    net_deductible_input_tax: number;
  };
  summary: {
    total_output_tax: number;
    total_input_tax: number;
    net_tax_due: number;
    credit_balance: number;
    gl_output_tax_balance: number;
    gl_input_tax_balance: number;
    gl_reconciled: boolean;
  };
}

export interface TaxRegisterRow {
  id: string;
  number: string;
  date: string;
  type: 'SALE' | 'SALE_RETURN' | 'PURCHASE' | 'PURCHASE_RETURN';
  type_label: string;
  party_id: string;
  party_name: string;
  party_tax_number?: string;
  branch_id: string;
  branch_name: string;
  taxable_base: number;
  tax_rate: number;
  tax_amount: number;
  total_amount: number;
  eta_status?:
    'PENDING' | 'SUBMITTED' | 'VALID' | 'INVALID' | 'FAILED' | 'CANCELLED' | 'UNSUBMITTED' | null;
  eta_uuid?: string | null;
  eta_long_id?: string | null;
}

export interface TaxRegisterResponse {
  from: string;
  to: string;
  branch_id?: string | null;
  register_type: 'SALES' | 'PURCHASES';
  rows: TaxRegisterRow[];
  totals: {
    taxable_base: number;
    tax_amount: number;
    total_amount: number;
    count: number;
  };
}

export interface ProductValuationRow {
  product_id: string;
  sku: string;
  name: string;
  category: string;
  unit: string;
  branch_id?: string | null;
  branch_name?: string | null;
  branch_code?: string | null;
  quantity: number;
  unit_cost: number; // in piasters (WAC or reference cost)
  total_cost: number; // in piasters = quantity * unit_cost
  sale_price: number; // in piasters
  total_retail: number; // in piasters = quantity * sale_price
  potential_profit: number; // total_retail - total_cost
  margin_percent: number; // ((total_retail - total_cost) / total_retail) * 100
  last_cost_update?: string | null;
}

export interface StockValuationSummary {
  total_products: number;
  total_quantity: number;
  total_inventory_cost: number; // in piasters
  total_inventory_retail: number; // in piasters
  total_potential_profit: number; // in piasters
  overall_margin_percent: number;
}

export interface GlInventoryCheck {
  gl_inventory_balance: number; // in piasters
  stock_valuation_total: number; // in piasters
  variance: number; // in piasters
  reconciled: boolean;
  account_code: string;
  account_name: string;
}

export interface StockValuationResponse {
  branch_id: string | null;
  branch_name: string | null;
  as_of: string;
  rows: ProductValuationRow[];
  summary: StockValuationSummary;
  gl_check: GlInventoryCheck;
  categories: string[];
}

export type BatchExpiryStatus = 'EXPIRED' | 'CRITICAL' | 'WARNING' | 'HEALTHY';

export interface StockBatch {
  id: string;
  product_id: string;
  product_name?: string;
  sku?: string;
  category?: string;
  unit?: string;
  branch_id: string;
  branch_name?: string;
  branch_code?: string;
  batch_number: string;
  production_date?: string | null;
  expiry_date: string;
  quantity: number;
  cost_price: number; // in piasters
  sale_price?: number; // in piasters
  created_at: string;
  days_to_expiry?: number;
  status?: BatchExpiryStatus;
}

export interface ExpiryAlertSummary {
  total_batches: number;
  total_quantity: number;
  total_value: number; // in piasters
  expired_count: number;
  expired_quantity: number;
  expired_value: number;
  critical_count: number; // < 30 days
  critical_quantity: number;
  critical_value: number;
  warning_count: number; // 30 - 90 days
  warning_quantity: number;
  warning_value: number;
  healthy_count: number;
}

export interface ExpiryAlertResponse {
  branch_id: string | null;
  branch_name: string | null;
  as_of: string;
  summary: ExpiryAlertSummary;
  batches: StockBatch[];
  categories: string[];
}

export interface WarehouseLocation {
  id: string;
  branch_id: string;
  branch_name?: string;
  code: string;
  name: string;
  aisle: string;
  rack: string;
  shelf: string;
  bin: string;
  notes: string;
  active: number;
  created_at: string;
  products_count?: number;
}

export interface ProductLocation {
  product_id: string;
  product_name?: string;
  sku?: string;
  location_id: string;
  location_code?: string;
  location_name?: string;
  branch_id?: string;
  is_primary: number;
  created_at: string;
}

export interface StocktakeScanResponse {
  session_id: string;
  line_id: string;
  product_id: string;
  product_name: string;
  sku: string;
  expected_qty: number;
  counted_qty: number;
  variance_qty: number;
  incremented_by: number;
  location_code?: string | null;
}

export type PurchaseOrderStatus =
  'DRAFT' | 'CONFIRMED' | 'PARTIALLY_RECEIVED' | 'RECEIVED' | 'CANCELLED';

export interface PurchaseOrderLine {
  id: string;
  order_id: string;
  product_id: string;
  product_name?: string;
  sku?: string;
  unit?: string;
  quantity: number;
  received_quantity: number;
  unit_price: number;
  tax_rate: number;
  line_total: number;
}

export interface PurchaseOrder {
  id: string;
  number: string;
  branch_id: string;
  branch_name?: string;
  branch_code?: string;
  party_id: string;
  party_name?: string;
  party_phone?: string;
  status: PurchaseOrderStatus;
  date: string;
  expected_delivery_date: string | null;
  subtotal: number;
  tax_rate: number;
  tax: number;
  total: number;
  notes: string | null;
  created_by?: string;
  created_by_name?: string;
  created_at: string;
  lines?: PurchaseOrderLine[];
}

export type LandedCostType = 'SHIPPING' | 'CUSTOMS' | 'CLEARANCE' | 'HANDLING' | 'OTHER';
export type LandedCostAllocationMethod = 'BY_VALUE' | 'BY_QUANTITY';

export interface LandedCostAllocation {
  id: string;
  landed_cost_id: string;
  document_line_id: string;
  product_id: string;
  product_name?: string;
  sku?: string;
  allocated_amount: number;
  additional_unit_cost: number;
}

export interface LandedCost {
  id: string;
  document_id: string;
  document_number?: string;
  cost_type: LandedCostType;
  cost_name: string;
  amount: number;
  allocation_method: LandedCostAllocationMethod;
  notes: string | null;
  created_by?: string;
  created_by_name?: string;
  created_at: string;
  allocations?: LandedCostAllocation[];
}
