# ORQIVA — Implemented scope v1.0

This is the implementation specification chosen for this delivery, not a reproduction of the missing original specification. The user authorized proceeding without phased checkpoints.

## Product and tenancy

An Arabic-first, RTL trading-business operations application. One company, one warehouse, EGP base currency, integer units. Local-first deployment using an actual SQLite database and SQL migrations. Supports an administrator and a sales staff role, rather than configurable permissions per module.

## Entities

- `users`: named individual logins, unique case-insensitive email, bcrypt password hash, ADMIN/STAFF role, active status.
- `sessions`: SHA-256 hashes of random bearer tokens, user foreign key, eight-hour expiry. HttpOnly SameSite=Lax cookie. Secure configurable for HTTPS.
- `company`: singleton identity, contact details, tax identifier, default tax rate and invoice note.
- `parties`: customer/supplier type, contact information, tax ID, notes and archive flag. Balances are derived, not editable.
- `products`: unique case-insensitive SKU, category, unit, sale/reference-cost prices, current stock, minimum stock and archive flag.
- `documents`: SALE/PURCHASE, globally unique sequential annual number, DRAFT/POSTED/CANCELLED state, party, document/due dates, integer monetary totals, notes and author.
- `document_lines`: product identity snapshot, positive integer quantity, price, cost snapshot and total. A product appears once per invoice.
- `payments`: positive amount, CASH/BANK/CARD method, date, optional external reference, invoice and author. Optional unique UUID request key for safe retries.
- `stock_movements`: signed nonzero quantity, optional invoice, reason and author. Timestamp is actual registration time.
- `expenses`: immutable positive amount, category, date, method, notes and author.
- `sequences`: annual invoice counters incremented transactionally.
- `audit_logs`: actor, action, entity ID, summary and timestamp.
- `schema_migrations`: applied migration names and timestamps.

Foreign keys and CHECK constraints are enabled. Every domain mutation which spans several rows uses a synchronous `BEGIN IMMEDIATE` transaction. Failures roll back invoice status, line costs, movements, balances and audit entries together.

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
| `/api/expenses` | GET / POST immutable expense | Read all; write admin |
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
- 34 automated API/integration tests using a fresh on-disk database.
- Three Playwright workflows exercised against the production build, including mobile interaction.
- TypeScript strict and no-unused checks; formatted source and successful Vite build.
- Dependency audit reports zero known vulnerabilities at delivery time; not a guarantee of future safety.
- SQLite Online Backup executed and resulting file integrity checked.
- Docker runtime, persistent volumes, health check, non-root user and CI definition provided. Docker engine is not installed in the execution environment, so local container build/run was not verified.

## Explicit exclusions

Statutory/general-ledger accounting, Egyptian e-invoicing integration, tax filing, sales/purchase returns and credit notes, payment refunds, editing recorded expenses, payroll, manufacturing, multi-company, multi-warehouse, multicurrency, fractional stock, batch/serial tracking, weighted-average/FIFO costing, attachments, bulk import, third-party integrations, MFA, password-reset email and horizontal scaling. These are not hidden placeholders or buttons promising unimplemented actions.

Operational deployment requires HTTPS, unique credentials, backup scheduling and recovery testing, network access controls, proxy/rate-limit review and accountant approval of the chosen financial policies. Audit records can be changed by someone with direct server/database access; they are not a cryptographic immutable ledger.
