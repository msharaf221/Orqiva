# ORQIVA — Implemented scope v1.0

This is the implementation specification chosen for this delivery, not a reproduction of the missing original specification. The user authorized proceeding without phased checkpoints.

## Product and tenancy

An Arabic-first, RTL trading-business operations application. One legal company operating several branches under one owner: every branch is a stock location with its own assortment, prices, reorder levels, invoice numbering and staff access. EGP base currency, integer units. Local-first deployment using an actual SQLite database and SQL migrations. Supports an administrator and a sales staff role, rather than configurable permissions per module.

## Entities

- `users`: named individual logins, unique case-insensitive email, bcrypt password hash, ADMIN/STAFF role, active status.
- `sessions`: SHA-256 hashes of random bearer tokens, user foreign key, eight-hour expiry. HttpOnly SameSite=Lax cookie by default. Secure configurable for HTTPS. Development previews on `*.e2b.app`, or explicit `COOKIE_PARTITIONED=true`, use Secure + SameSite=None + Partitioned (CHIPS); both issuance and logout use identical attributes.
- `company`: singleton identity, contact details, tax identifier, default tax rate and invoice note.
- `parties`: customer/supplier type, contact information, tax ID, notes and archive flag. Balances are derived, not editable.
- `products`: unique case-insensitive SKU, category, unit, sale/reference-cost prices, minimum stock and archive flag. Quantities are not stored here; they live per branch in `branch_stock`.
- `branches`: unique code (2-8 alphanumerics), name, kind (HQ/STORE/WAREHOUSE/ONLINE), contact, `opened_on`, `closed_on` and active flag. Archiving closes the branch from today and requires zero stock and no drafts or goods in transit.
- `branch_products`: per branch, whether the product is listed (sellable and purchasable there), an optional sale-price override and an optional reorder-level override.
- `branch_stock`: quantity per (branch, product), never negative. Every change is paired with a `stock_movements` row, so balances always reconcile with the movement log.
- `user_branches`: branches each employee may operate in. Administrators see every branch.
- `transfers` / `transfer_lines`: DRAFT, IN_TRANSIT, RECEIVED or CANCELLED. Shipping removes goods from the sender; receiving records the quantity that arrived; the difference is kept on the transfer as a shortage. The unit cost is snapshotted at shipment.
- `owners`: share in basis points. Active shares must not exceed 10000 and must equal 10000 before any distribution.
- `equity_entries`: owner contributions and withdrawals (cash in and out of the group pool).
- `distributions` / `distribution_lines` / `distribution_payments`: a frozen calculation for a closed period, approved only if recalculation still matches, paid per owner with partial payments capped by the amount owed and by available cash.
- `documents`: SALE/PURCHASE, branch, unique sequential annual number per branch (for example `INV-NSR-2026-0001`, `PO-HQ-2026-0001`), DRAFT/POSTED/CANCELLED state, party, document/due dates, integer monetary totals, notes and author.
- `document_lines`: product identity snapshot, positive integer quantity, price, cost snapshot and total. A product appears once per invoice.
- `payments`: positive amount, CASH/BANK/CARD method, date, optional external reference, invoice and author. Optional unique UUID request key for safe retries.
- `stock_movements`: signed nonzero quantity, branch, optional invoice or transfer, reason and author. Timestamp is actual registration time.
- `expenses`: immutable positive amount, category, date, method, notes and author, plus an allocation: `BRANCH` (one branch), `EQUAL` (split equally among branches open on the expense date) or `REVENUE` (split by each branch's posted net sales in the expense's own month).
- `sequences`: annual invoice counters incremented transactionally.
- `audit_logs`: actor, action, entity ID, summary and timestamp.
- `schema_migrations`: applied migration names and timestamps.

Foreign keys and CHECK constraints are enabled. Every domain mutation which spans several rows uses a synchronous `BEGIN IMMEDIATE` transaction. Failures roll back invoice status, line costs, movements, balances and audit entries together.

## Multi-branch rules (v2)

- A sale draws from the stock of its own branch and only lists products that branch carries. A purchase is received into the branch named on the document.
- Shared expenses are allocated with the largest-remainder method, so allocations always add back exactly to the expense amount. Group totals never change with the allocation; only the split between branches does.
- A branch is only charged for shared expenses dated from its opening date until its closing date.
- A distribution period is the group's net profit (sales before tax, minus cost of goods sold, minus all expenses). Losses in one branch reduce the group total. A reserve (default 5%, configurable from 0% to 50%) is taken only from a positive total. The rest is split across active owners by share, using largest remainder so the parts add back exactly.
- Distribution periods may not overlap a live (non-cancelled) distribution. Approval recalculates the period; if sales, expenses or owner shares changed since the draft, approval is refused and the draft must be replaced.
- Owner payments and withdrawals may not take the group's cash below zero. Cash is one pool: sales collections and owner contributions in; purchase payments, expenses, withdrawals and distribution payments out.
- Staff see and operate only in their assigned branches. Shared (unassigned) expenses, owner data, distributions and the group overview are administrator-only. Customers and suppliers are shared across branches, so their balances are group-wide.
- The migration `003_multi_branch.sql` moves every pre-existing record into the `main` branch (code `HQ`), keeps every document number unchanged, and creates one owner at 100%. It is verified by an automated upgrade test.

## Invoice lifecycle

```text
DRAFT -- edit --> DRAFT
DRAFT -- post --> POSTED
DRAFT -- cancel --> CANCELLED
POSTED -- cancel, only if paid=0 and stock reversal allowed --> CANCELLED
POSTED -- payment, up to remaining balance --> POSTED
```

No hard deletion of financial documents. Posting is guarded against repeat execution. Posting a sale checks every stock balance, snapshots current reference cost and deducts quantities. Posting a purchase receives quantities, but does not change reference cost. Cancellation reverses the original stock quantities transactionally. Paid invoices cannot be cancelled in this version because refund workflows are outside scope.

Document creation validates party type/activity, product existence/activity, unique lines, real ISO dates, due date ordering, integer quantities, nonnegative prices, discount <= subtotal and amount limits. A future-dated invoice posts immediately if explicitly approved; there is no scheduled posting engine.

## Monetary policy

Currency amounts are integer piastres. `tax_rate=1400` means 14%. Tax is rounded once on the invoice's discounted subtotal. Total = subtotal - discount + tax. Max invoice total is 1,000,000,000 piastres. Amounts never use floating point storage.

Dashboard sales/purchases use net amounts excluding VAT. Invoice tables include VAT. Gross profit subtracts snapshotted reference costs; net estimated profit also subtracts period expenses. Cash flow uses payment dates and expense dates, not invoice accrual dates. Receivables/payables are current outstanding totals across all periods. No double-entry general ledger, opening cash balance, or statutory tax accounting is implied.

## API overview

All `/api` endpoints except health and login require a valid session. Mutations also require `X-Orqiva-Request: 1`; no cross-origin CORS is enabled. Production serves API and frontend under the same origin. API responses use `Cache-Control: no-store`.

| Endpoint | Methods / action | Access |
|---|---|---|
| `/api/health` | GET database health | Public |
| `/api/auth/login` | POST email/password | Public, rate limited |
| `/api/auth/me` | GET session identity | Signed in |
| `/api/auth/logout` | POST revoke current session | Signed in |
| `/api/auth/password` | POST current/password; revoke other sessions | Signed in |
| `/api/company` | GET / PUT | Read all; write admin |
| `/api/products` | GET / POST | Read all; write admin |
| `/api/products/:id` | PUT metadata, not stock | Admin |
| `/api/products/:id/adjust` | POST signed quantity and reason | Admin |
| `/api/products/:id/active` | PATCH archive/reactivate | Admin |
| `/api/parties?type=CUSTOMER\|SUPPLIER` | GET derived balances | Signed in |
| `/api/parties` | POST | Customers: all; suppliers: admin |
| `/api/parties/:id` | PUT, same party type only | Customers: all; suppliers: admin |
| `/api/parties/:id/active` | PATCH archive/reactivate | Admin |
| `/api/documents?type=SALE\|PURCHASE` | GET invoice summaries | Signed in |
| `/api/documents` | POST draft | Sales: all; purchases: admin |
| `/api/documents/:id` | GET details / PUT draft | Read all; write by document type |
| `/api/documents/:id/post` | POST approve, update stock | Sales: all; purchases: admin |
| `/api/documents/:id/cancel` | POST guarded reversal | Admin |
| `/api/documents/:id/payments` | POST payment | Sales: all; purchases: admin |
| `/api/payments` | GET consolidated payment ledger | Signed in |
| `/api/movements` | GET latest 1000 movements | Signed in |
| `/api/expenses` | GET / POST immutable expense with allocation | Admin writes; staff read their branches |
| `/api/branches` | GET / POST; `PUT` details; `PATCH .../active` archive or reopen | Admin writes; staff read assigned branches |
| `/api/branches/:id/assortment` | GET listed products, prices and reorder levels; `PUT .../products/:productId` | Read per scope; admin writes |
| `/api/branches/:id/staff` | GET / PUT assigned employees | Admin |
| `/api/stock/matrix` | GET product by branch quantities | Scoped to visible branches |
| `/api/transfers` | GET / POST draft; `PUT` draft; `POST .../ship`, `.../receive`, `.../cancel` | Source or destination branch access |
| `/api/transfers/suggestions` | GET rebalancing suggestions within scope | Scoped |
| `/api/group/overview` | GET per-branch results, group totals and cash position | Admin |
| `/api/owners` | GET / POST / `PUT`; `PATCH .../active`; `.../entries` and `.../ledger` | Admin |
| `/api/distributions` | GET list; `POST /preview` (no write); `POST` draft; `.../approve`, `.../cancel`, `.../payments` | Admin |
| `/api/dashboard?from=YYYY-MM-DD&to=YYYY-MM-DD` | GET period report, max 366 days | Signed in |
| `/api/users` | GET / POST | Admin |
| `/api/users/:id` | PATCH role/active, revoke sessions | Admin; cannot modify self |
| `/api/audit` | GET latest 500 events | Admin |

Payments accept an optional `Idempotency-Key` UUID header. Retrying the same payload with the same key and actor returns the existing invoice without another payment. Reusing a key with different data returns 409. The UI generates one key per payment modal submission flow. Reopening the modal starts a new flow; this is not a bank reconciliation/deduplication mechanism.

Errors: 400 invalid data, 401 no session, 403 forbidden, 404 missing resource, 409 domain conflict. Unexpected errors are logged server-side and returned as generic messages. User-provided values are bound parameters, never interpolated into SQL. Table interpolation is limited to hard-coded internal table names.

## Screens

Dashboard; searchable/paginated products; inventory balances and movements; customer/supplier accounts and statements; sales/purchase lists, draft editor, details, A4 print and payments; expenses; consolidated payments; date-range reporting; company settings; user roles/activation; password changes; audit trail; global search and actionable notifications. CSV exports reflect active filters. Empty, loading, permission and server-error states are included.

## Delivery verification

- Two real SQL migrations applied to the preview database; idempotent migration tracking.
- 48 automated tests: 36 API/integration tests using a fresh on-disk database and 12 cookie/client-session policy tests.
- Six Playwright workflows exercised against the production build, including mobile interaction, real cross-site HTTPS iframe login with third-party cookies restricted, blocked-cookie feedback, and deduplicated session-expiry notifications.
- TypeScript strict and no-unused checks; formatted source and successful Vite build.
- Dependency audit reports zero known vulnerabilities at delivery time; not a guarantee of future safety.
- SQLite Online Backup executed and resulting file integrity checked.
- Docker runtime, persistent volumes, health check, non-root user and CI definition provided. Docker engine is not installed in the execution environment, so local container build/run was not verified.

## Explicit exclusions

Statutory/general-ledger accounting with double-entry journals, Egyptian e-invoicing integration, tax filing, sales/purchase returns and credit notes, payment refunds, editing recorded expenses, payroll, manufacturing, multi-company (separate legal entities with separate books), multicurrency, intercompany transfer pricing, bank accounts per branch, several stock locations inside one branch, fractional stock, batch/serial tracking, weighted-average/FIFO costing, attachments, bulk import, third-party integrations, MFA, password-reset email and horizontal scaling. These are not hidden placeholders or buttons promising unimplemented actions.

Operational deployment requires HTTPS, unique credentials, backup scheduling and recovery testing, network access controls, proxy/rate-limit review and accountant approval of the chosen financial policies. Audit records can be changed by someone with direct server/database access; they are not a cryptographic immutable ledger.

## Implemented in v1.1 — Weighted Average Cost (WAC)

- **Schema Migration `004_weighted_avg_cost.sql`**: Added `branch_cost` table (`branch_id`, `product_id`, `avg_cost`, `total_value`, `updated_at`) and immutable `cost_movements` audit ledger.
- **Weighted Average Calculation (`server/cost.ts`)**:
  - Purchase invoices blend new batches into local branch average: `new_avg = round((old_value + qty * unit_price) / new_qty)`.
  - Sales snapshot the exact WAC at sale time into `document_lines.cost_price` for accurate Cost of Goods Sold (COGS).
  - Outflows reduce `total_value` proportionally while keeping unit average stable.
  - Branch transfers convey sending branch's WAC to receiving branch, where it is blended upon receipt.
  - Sales cancellation reverses stock at snapshotted COGS.
- **Reports and Dashboards (`server/reports.ts`)**:
  - Stock valuation reflects real WAC per branch (`COALESCE(NULLIF(bc.avg_cost, 0), p.cost_price)`).
  - Gross profit and margins reflect realized COGS from posted document lines.
  - Stock matrix provides branch-level WAC visibility.
- **Audit & UI Visibility (`src/pages/Catalog.tsx`, `src/pages/Branches.tsx`)**:
  - Full cost movement history visible via `/api/cost-movements` and dedicated inventory tab for admins.
  - Products catalog shows current effective WAC alongside catalog reference cost.

## Implemented in v1.2 — Sales & Purchase Returns (Credit & Debit Notes)

- **Schema Migration `005_returns_and_notes.sql`**:
  - Upgraded `documents.type` to support `SALE`, `PURCHASE`, `SALE_RETURN` (Credit Note), and `PURCHASE_RETURN` (Debit Note).
  - Added `original_document_id` referencing parent invoices with indexing.
- **Return Engine & Validation (`server/returns.ts`, `server/validation.ts`)**:
  - `getReturnableLines`: Computes cumulative returned quantities across previous returns and calculates remaining returnable limits per product line.
  - `validateReturnLines`: Enforces that return prices match original line prices, returned products exist on original invoice, quantities are strictly positive, and cumulative return amounts do not exceed the original invoice.
  - Blocks original invoice cancellation if non-cancelled returns exist against it.
- **Financial & Inventory Reversals (`server/service.ts`, `server/cost.ts`, `server/reports.ts`)**:
  - **Sales Returns (`SALE_RETURN` / Credit Note `CN-` prefix)**: Restores items into branch inventory at original sold COGS (`recordCostIn`), decreases customer debt, and nets out sales revenue and COGS in financial reports and gross margin calculations.
  - **Purchase Returns (`PURCHASE_RETURN` / Debit Note `DN-` prefix)**: Verifies available physical stock before returning, removes items from branch inventory and cost valuation (`recordCostOut`), decreases supplier payables, and nets out procurement cost.
  - Cancelling an approved return cleanly reverses the inventory and balance adjustments.
- **Frontend & Printable UI (`src/pages/Documents.tsx`, `src/lib.tsx`)**:
  - Dedicated "المرتجعات" tab in Sales and Purchases lists with status filtering and original invoice links.
  - Interactive "إصدار مرتجع" modal on posted invoices displaying returnable lines, one-click full return ("إرجاع كامل المتبقي"), and real-time total recalculation.
  - Direct bi-directional navigation between invoices and credit/debit notes.
  - Document detail and printing styles tailored for Credit Notes and Debit Notes (`#invoice-print`).

## Implemented in v1.3 — Cash & Bank Accounts (الخزائن والحسابات البنكية)

- **Schema Migration `006_cash_accounts.sql`**:
  - Added `cash_accounts` table (`id`, `name`, `type` ['CASH', 'BANK', 'WALLET', 'OTHER'], `account_number`, `bank_name`, `branch_name`, `initial_balance`, `allow_negative`, `is_active`, `notes`, `created_at`).
  - Added `account_transfers` table (`id`, `transfer_number`, `from_account_id`, `to_account_id`, `amount`, `date`, `notes`, `created_by`, `created_at`).
  - Seeded default fallback accounts: `acc_def_cash` ("الخزينة الرئيسية") and `acc_def_bank` ("الحساب البنكي الرئيسي") with `allow_negative = 1` for zero-friction migration and backward compatibility.
  - Linked `payments.account_id`, `expenses.account_id`, `distribution_payments.account_id`, and `equity_entries.account_id` to `cash_accounts` with cascading validation.
- **Account Engine & Liquidity Control (`server/accounts.ts`)**:
  - Real-time balance calculations reflecting initial balance, customer/supplier invoice payments, owner contributions/withdrawals, operational expenses, profit distribution payouts, and inter-account transfers.
  - Overdraft protection: Custom accounts strictly enforce `assertAccountFunds` preventing negative balances when `allow_negative = 0`, with permission checks allowing administrator override when allowed.
  - Inter-account fund transfers (`transferFunds`) with transactional balance verification, audit logging, and automated sequential numbering (`TRF-YYYY-NNNN`).
  - Chronological account statement ledger (`getAccountStatement`) computing running balances across all transaction types with initial balance anchor.
- **Transaction Routing Integration (`server/service.ts`, `server/owners.ts`, `server/distribution.ts`, `server/app.ts`)**:
  - Document invoice payments (sales & purchases) route to designated accounts (defaulting to cash/bank).
  - General and shared operational expenses deduct funds from designated source accounts.
  - Owner capital contributions and withdrawals route through selected accounts while maintaining group-level cash validation.
  - Owner profit distributions route through selected accounts with dual funds validation.
- **Frontend & Ledger UI (`src/pages/Finance.tsx`, `src/pages/Documents.tsx`, `src/pages/Distributions.tsx`, `src/types.ts`)**:
  - Dedicated "الخزائن والبنوك" management page under Financial Management (`/accounts`).
  - Account cards grid displaying real-time balance, account type, bank details, and overdraft flags.
  - Inter-account transfer modal with instant source/destination selection and fund verification.
  - Full account statement ledger modal with chronological entry breakdown, debit/credit indicators, running balance, and counterparty metadata.
  - Account selection integrated directly into payment modals, expense creation, owner equity management, and distribution payouts.

## Implemented in v1.4 — Granular RBAC (الصلاحيات المخصصة وأدوار المستخدمين)

- **Schema Migration `007_granular_rbac.sql`**:
  - Added `roles` table (`id`, `name`, `code`, `description`, `is_system`, `created_at`).
  - Added `role_permissions` join table (`role_id`, `permission`).
  - Added `user_roles` join table (`user_id`, `role_id`) which seamlessly links users to granular roles while preserving the legacy `users` table schema and strict SQLite `CHECK(role IN ('ADMIN','STAFF'))` constraint.
  - Seeded 6 predefined system roles:
    1. `role_admin` (`ADMIN` - مدير النظام): صلاحيات كاملة وغير مقيدة على كافة أقسام وفروع النظام.
    2. `role_branch_mgr` (`BRANCH_MANAGER` - مدير فرع): إدارة العمليات اليومية والمبيعات والمشتريات والمخزون للفروع التابعة.
    3. `role_accountant` (`ACCOUNTANT` - محاسب): إدارة الحسابات النقدية والخزائن والمصروفات ومقبوضات ومدفوعات الفواتير والتقارير المالية.
    4. `role_sales` (`SALES` - مبيعات): إصدار فواتير المبيعات وعرض العملاء وتحصيل الدفعات.
    5. `role_warehouse` (`WAREHOUSE` - مخزني): إدارة المخزون والتحويلات بين الفروع واستلام بضائع المشتريات.
    6. `role_viewer` (`VIEWER` - مشاهد): صلاحية استعراض البيانات والتقارير فقط دون تعديل.
  - Automatic migration backfill associating existing `ADMIN` users with `role_admin` and `STAFF` users with `role_sales`.
- **RBAC Engine & Authorization Middleware (`server/rbac.ts`)**:
  - Defined 21 granular permissions organized across 7 logical modules:
    - **المستندات**: `documents:view`, `documents:create_sale`, `documents:create_purchase`, `documents:post`, `documents:cancel`.
    - **المخزون**: `inventory:view`, `inventory:adjust`, `catalog:manage`, `transfers:manage`.
    - **جهات التعامل**: `parties:view`, `parties:manage`.
    - **المالية**: `finance:view`, `finance:payments`, `finance:expenses`, `finance:accounts`.
    - **التقارير**: `reports:view`, `reports:group_overview`.
    - **الشركاء**: `distribution:manage`.
    - **الإدارة**: `branches:manage`, `users:manage`.
  - Express authorization middleware `requirePermission(permission)` enforcing access control with informative Arabic errors (HTTP 403).
  - Role management operations: `listRoles`, `getRole`, `createRole`, `updateRole`, and `deleteRole`.
  - Safeguards: System roles cannot be deleted; roles currently assigned to users cannot be deleted until users are reassigned.
- **Backend API Protection (`server/app.ts`, `server/validation.ts`)**:
  - `GET /api/permissions`: Returns complete permission catalog grouped by domain.
  - `GET /api/roles`, `GET /api/roles/:id`, `POST /api/roles`, `PUT /api/roles/:id`, `DELETE /api/roles/:id`: Full role management endpoints.
  - Every business operation protected by corresponding granular permissions (documents, inventory, catalog, branches, transfers, expenses, accounts, and reports).
  - User session tokens load active user permissions and role details dynamically on login and authentication.
- **Frontend & Permission Control (`src/auth.ts`, `src/types.ts`, `src/styles.css`, `src/App.tsx`, `src/pages/Finance.tsx`, `src/pages/Documents.tsx`, `src/pages/Catalog.tsx`)**:
  - Dynamic permission helper `can(user, permission)` evaluating user capabilities on the fly.
  - Sidebar and navigation bar dynamically adapt, rendering only accessible modules and views.
  - Document actions conditionally rendered (e.g., cancellation disabled for users lacking `documents:cancel`).
  - Added dedicated "الأدوار والصلاحيات" tab in Settings:
    - Visual roles card grid displaying role details, code, and user assignment counters.
    - Role creation and editing modal with module-grouped permission checkboxes and system role protections.
  - User creation and editing modal upgraded with dynamic role selector and branch access assignments.


