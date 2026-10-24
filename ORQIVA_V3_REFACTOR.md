# Orqiva v3 — Whole-System Refactor: Audit, First Slice, and Roadmap

> **Status:** branch `refactor/erp-crm-v3` (Phases 1–3 committed locally, not pushed).
> **Delivered so far:** a complete CRM vertical slice, app-wide request/render hardening, Phase 2 (branch isolation + least privilege across accounts, HR, payroll, treasury, and ETA), and Phase 3 (tax-free operation with a one-time historical recalculation, plus generic attendance-device integration).
> **Not delivered yet:** audit/idempotency everywhere, module boundaries, frontend decomposition, and scale/operations work. Section 5 lists the remaining gaps and Section 6 turns them into phases with exit criteria.

---

## 1. What “perfect” means for Orqiva

“Perfect” is not a feature count. For an ERP/CRM that handles money, stock, salaries, and tax, it means the following ten gates are true at the same time:

| # | Gate | Measurable definition |
|---|------|-----------------------|
| 1 | **Accounting integrity** | Every posting is balanced (`SUM(debit) = SUM(credit)`), posted entries are immutable, corrections are reversals, and trial balance / P&L / balance sheet always reconcile. |
| 2 | **Money precision** | All amounts are integer piasters end-to-end. No floats in the database, API, or calculations. |
| 3 | **Branch isolation** | Every read and write of branch-owned data is scoped to the actor’s assigned branches. A foreign ID returns 404/403, never data. |
| 4 | **Least privilege** | Every screen and endpoint is gated by a specific permission. A sales user cannot read payroll, treasury, or another branch’s accounts just because they hold a broad `finance:view`. |
| 5 | **Auditability** | Every state transition writes an immutable audit row with actor, action, entity, entity id, timestamp, and useful details. |
| 6 | **Idempotency** | Any unsafe POST that can be retried (payments, checkout, payroll confirmation, receiving, posting) is safe to retry with the same key. |
| 7 | **Data safety** | Forward-only migrations are tested against a legacy database; foreign keys and integrity checks pass; backup and restore are both tested. |
| 8 | **Operability** | Structured logs, request IDs, health/readiness, queue visibility, and error reporting exist. A failure is diagnosable without reproducing it. |
| 9 | **UI quality** | Screens have loading, empty, error, and permission states; modals are keyboard accessible; RTL is native; no screen is a 4,000-line file. |
| 10 | **Regression safety** | Typecheck, format, build, integration tests, and E2E tests are green on every change. Critical flows have browser coverage. |

Today Orqiva is strong on 1, 2, 7, and 10 for the modules that already have tests. It is incomplete on 3, 4, 5, 6, 8, and 9 outside the modules listed below.

---

## 2. Baseline and verification

| Gate | Before this pass | After this pass |
|------|------------------|-----------------|
| TypeScript | green | green (`tsc --noEmit`) |
| Vitest | 31 files / 245 tests | **35 files / 265 tests** |
| Production build | green | green (`tsc --noEmit && vite build`) |
| Prettier | green | green (`format:check`) |
| Playwright E2E | 13 tests | **13 tests, including CRM and attendance-device screen-load assertions** |
| Legacy migration upgrade | green through `022` | green through **`025_tax_free_and_attendance_devices.sql`** |

The E2E suite was run twice during the CRM pass: the full 13-test suite passed, and the workspace spec was re-run after adding `/crm` to the “all main screens load without browser exceptions” check. The full suite was re-run again after Phase 3 and passed with tax-free totals, the settings tax/ETA controls hidden, and `/attendance-devices` added to the screen-load check. The new CRM tests cover branch isolation, activity lifecycle, lost reasons, overview totals, targets, assignees, and audit rows.

Phase 2 adds `tests/branch_isolation_phase2.test.ts`: four tests that prove cash accounts/statements/transfers, employees/payroll runs, cheques/bank statements/forecasts, and ETA logs/queue processing are all scoped to the actor’s branches, and that sales users are denied payroll/treasury reads.

Phase 3 adds `tests/tax_free_reset.test.ts` (six tests) and `tests/attendance_devices.test.ts` (eight tests). The first pins the historical recalculation, overpayment credits, ledger reversal/reposting, payroll recalculation, commercial-document cleanup, ETA cancellation, closed-period restoration, and idempotency. The second pins device registration/key rotation, hashed-key storage, unmapped ingestion, retroactive mapping, duplicate handling, timestamp normalization, CSV/ATTLOG import, the simulator, manual-row protection, branch scope, least privilege, and archive/delete rules.

---

## 3. What was delivered in this pass

### 3.1 CRM vertical slice (backend)

The old `server/crm.ts` (441 lines) and `server/routes/crm.ts` (165 lines) were replaced by a real module:

```
server/modules/crm/
  schemas.ts      strict Zod input/query schemas; clearable fields become null
  repository.ts   scoped SQL, pagination-free list queries, overview, assignees
  service.ts      authorization, transactions, lifecycle rules, conversions, audit
  routes.ts       thin HTTP layer: parse -> authorize -> service -> JSON
```

Key behavior now enforced by the service:

- **Branch isolation** on deals, activities, overview, assignees, and targets. `scopeFor()` and `scopeSql()` are used consistently; a deal from another branch is `404`, not a leaked record.
- **Writes are transactional** and audit-logged in the same transaction as the mutation.
- **Deal lifecycle**: `closed_at` is set when a deal reaches a won/lost stage, cleared when reopened; `lost_reason` is mandatory for lost stages and cleared on reopen.
- **Atomic numbering**: `DEAL-0001` comes from the `sequences` table with an atomic upsert, not `MAX(code)+1`.
- **Quotation conversion** now derives subtotal and tax from the company tax rate instead of storing `tax = 0` and `subtotal = total`.
- **Activity branch ownership**: an activity linked to a deal inherits the deal branch; an unlinked activity must state a branch.
- **Assignees** are a scoped endpoint (`GET /api/crm/assignees`) instead of the nonexistent `/auth/users`.
- **New endpoints**: `/crm/overview`, `/crm/assignees`, `PATCH /crm/activities/:id`.
- **Conversions are idempotent in practice**: converting an already-converted deal returns the existing customer/quotation instead of duplicating it.

### 3.2 CRM vertical slice (frontend)

`src/pages/CRM.tsx` went from a 1,536-line monolith to a 388-line orchestration page plus 14 feature files under `src/features/crm/`:

- `api.ts` (typed client + shared read URLs), `useCrmData.ts`
- `KanbanBoard.tsx` with drag-and-drop and keyboard-openable cards
- `DealsTable.tsx`, `ActivitiesTable.tsx`, `TargetsPanel.tsx`, `CrmStats.tsx`
- `DealFormModal.tsx`, `ActivityFormModal.tsx`, `TargetFormModal.tsx`
- `DealDetailModal.tsx`, `CompleteActivityModal.tsx`, `LostStageModal.tsx`
- `ui.tsx` for shared labels/badges/icons

The detail modal fetches by id and reloads itself after a mutation, so stage changes and conversions no longer leave a stale snapshot on screen. Search, stage/assignee filters, activity-status filters, and branch scope are wired through the same read URLs used by mutations.

### 3.3 App-wide kernel improvements

- **`server/audit.ts`** — one audit writer, re-exported from `server/service.ts` for compatibility.
- **`server/sequence.ts`** — one atomic annual sequence allocator, re-exported from `server/service.ts`.
- **`src/api.ts`** — non-JSON and empty responses no longer crash `.json()`; errors have a safe fallback message; `AbortSignal` is supported.
- **`src/lib.tsx`** — `useData` aborts stale requests when the URL changes or the component unmounts, so slow responses cannot overwrite newer ones.
- **`src/ErrorBoundary.tsx`** — a render error shows an actionable Arabic fallback instead of a blank page; the component stack is logged for diagnostics.
- **`src/types.ts`** — CRM lifecycle/priority/overview/assignee types and `hr:view`/`hr:manage` permission keys.
- **`src/styles/features.css`** — CRM v3 toolbar, drag-over, timeline, detail-summary, and error styles.

### 3.4 Migration `023_crm_hardening.sql`

- Adds `crm_deals.closed_at`.
- Adds `crm_activities.branch_id`, `updated_at`, and `priority`.
- Backfills activity branch from the parent deal (fallback `main`) and seeds `closed_at` for existing won/lost deals.
- Seeds the `DEAL` and `QTN-YYYY` sequences from existing human-readable codes, so the first atomic allocation cannot collide with old data.
- Adds branch/status/due-date indexes for the pipeline and activity inbox.
- Grants `crm:view`/`crm:manage` to sales and branch managers, and `crm:view` to accountants, general accountants, and viewers.

### 3.5 Phase 2 — branch isolation and least privilege

Every branch-owned surface identified in the first audit is now scoped on read **and** write. Foreign IDs return 404 (not data); a requested branch outside the actor’s assignment returns 403.

| Surface | What changed |
|---------|--------------|
| **Cash accounts** (`server/accounts.ts`, `routes/accounts.ts`) | Lists, reads, statements, and transfer listings are scoped. Group-level accounts (`branch_id IS NULL`) remain readable as shared bank facilities, but only admins may create, edit, or transfer them. Branch writes require an assigned, open branch. |
| **HR** (`server/hr.ts`, `routes/hr.ts`) | Leaves, balances, attendance, and monthly payroll impact are scoped by employee branch. Attendance writes are transactional and audited; a foreign employee is indistinguishable from a missing one. Route guards are now `hr:view` / `hr:manage`. |
| **Payroll** (`server/payroll.ts`, `routes/payroll.ts`) | Employees and payroll runs are scoped; employee creation, advances, run creation, and confirmation enforce branch ownership. Runs are audited. Route guards are now `hr:view` / `hr:manage`; group-wide runs remain admin-only. |
| **Treasury** (`server/cheques.ts`, `server/treasury_advanced.ts`, `routes/treasury.ts`) | Cheques, lifecycle actions, bank statements, matching, and the cash-flow forecast are branch-scoped. Cheques now carry a real `branch_id`; creation defaults to `main` or the first accessible branch. Endpoints require `finance:accounts` instead of broad `finance:view`. Cheque creation, collection, bounce, and payment write audit rows. |
| **ETA** (`server/eta.ts`, `routes/eta.ts`) | Submission logs, status counters, document payload/QR/submission reads, retries, and queue processing are scoped to document branches. `eta:manage` remains required for retry/process. |

Migration `024_branch_isolation.sql` adds `cheques.branch_id`, backfills historical rows from the collection account (falling back to HQ), indexes the column, and grants `hr:view`/`hr:manage` to accountants and general accountants plus `hr:view` to branch managers.

Two pre-existing path bugs were found and fixed while wiring the frontend to these permissions:

- Payroll screens called `/payroll/employees` and `/payroll/payroll-runs`; the API is mounted at `/api/employees` and `/api/payroll-runs`.
- The treasury router was mounted at `/api` while its frontend called `/api/treasury/...`; it is now mounted at `/api/treasury`, with the integration tests updated to the same paths.

The treasury/payroll tabs in `src/pages/finance/accounts.tsx` are hidden unless the user holds `finance:accounts` or `hr:view`, matching the new server guards.

### 3.6 Verified defects fixed

| # | Defect (verified in the old code) | Fix |
|---|-----------------------------------|-----|
| 1 | CRM had **zero branch isolation**: `listDeals` only filtered when `branch_id` was supplied, and `getDeal`/activities never scoped. | `scopeFor`/`scopeSql` on every CRM read; service guards on every write. |
| 2 | The CRM UI called `PATCH /crm/activities/:id`, but the route did not exist (only `/complete`). | Added `PATCH /crm/activities/:id` with strict schemas and tests. |
| 3 | The CRM UI loaded `/auth/users`, which is not a route (404), for assignee dropdowns. | Added scoped `GET /crm/assignees`; all CRM forms use it. |
| 4 | Activities without a deal had **no branch at all**, so they could not be authorized or reported per branch. | Migration 023 adds `branch_id`; the service requires a branch for unlinked activities. |
| 5 | Lost stages accepted no reason, and there was no close timestamp. | Lost reason is mandatory; `closed_at` is set/cleared with the stage. |
| 6 | Deal numbering used `MAX(code)+1`, which can duplicate under concurrency. | Atomic `sequences` upsert; migration seeds the sequence from existing codes. |
| 7 | Quotation conversion stored `subtotal = total`, `tax = 0`, so the tax was silently wrong. | Subtotal/tax are derived from the company tax rate; total remains the deal value. |
| 8 | CRM permissions existed in the catalog but were never granted to any role, so the nav item stayed hidden. | Migration 023 grants the intended CRM capabilities. |
| 9 | The deal detail modal used a stale snapshot; parent reloads did not refresh the open modal. | `DealDetailModal` fetches by id and reloads after every mutation. |
| 10 | A render error in any screen produced a blank page. | Global `ErrorBoundary` with an Arabic fallback and reload action. |
| 11 | A non-JSON API error (proxy/HTML/empty body) crashed the client while parsing JSON. | Safe response parsing with a user-facing fallback. |
| 12 | Stale `useData` responses could overwrite newer data after navigation/filter changes. | `AbortController` + abort-aware error handling. |

### 3.7 Phase 3 — tax-free operation and historical recalculation

VAT, payroll income tax, the martyrs fund, and social insurance are removed from the product. The schema is intentionally not dropped: historical rows keep their shape and audit trail, while application policy forces every new amount to zero. The switches live in `src/config.ts`:

```ts
export const TAX_FREE = true;
export const ETA_ENABLED = false;
export const TAX_FREE_MIGRATION = 'tax_free_reset_v1';
```

**New transactions.** `effectiveTaxRate()` and `calculateTax()` are the only tax helpers; the document service, POS checkout/returns, quotations, purchase orders, and company validation all use them. A client that still sends `tax_rate: 1400` gets `tax_rate = 0`, `tax = 0`, and `total = subtotal - discount`; it cannot reintroduce a tax by crafting the payload. Payroll returns zero for `social_insurance_employee`, `social_insurance_employer`, `income_tax`, and `martyrs_fund`, and net pay becomes `gross - advances - attendance - other deductions`. The payroll ledger posts only salary expense, advances withheld, and the net payable.

**Historical recalculation.** `server/tax_free_reset.ts` runs once, guarded by the `data_migrations` marker, from both `server/app.ts` and `server/migrate.ts`:

- every document with a non-zero tax rate is reset to `total = subtotal - discount`; `paid` is capped at the new total;
- an overpayment becomes an open `party_credits` row (`CREDIT` for both sales and purchases, because it reduces what the party owes), and party balances subtract open credits;
- the document’s old ledger entry is reversed and a tax-free entry is reposted only when the document was already posted; legacy documents without a ledger entry are not given invented history;
- confirmed/paid payroll runs zero their deductions, recalculate each slip and the run total, then reverse and repost the payroll entry;
- purchase orders, purchase-order lines, quotations, and the company tax identity are reset;
- pending/submitted/failed ETA submissions are cancelled and their documents marked `CANCELLED`;
- `gl_settings.closed_through` is temporarily cleared so closed-period history can be reversed, then restored in a `finally` block;
- every record is handled in its own transaction, the credit table is uniquely keyed by source document, and the marker is written only after a clean run. A partial failure leaves the marker unset so the next start retries the remaining rows.

**UI.** Tax fields are hidden in the company settings and document forms, VAT columns and the VAT-return tab are hidden in the ledger, the ETA settings tab and invoice panel are hidden, reports drop tax wording, and POS receipts/returns no longer show tax lines. The ledger keeps its VAT accounts for historical reversal entries; no new VAT posting is created.

### 3.8 Phase 3 — generic attendance-device integration

No fingerprint hardware is installed yet, so the integration is vendor-neutral and ready for a real device:

```
device registration (serial + branch + work policy)
  -> one-time API key (only its SHA-256 hash is stored)
  -> public POST /api/attendance-devices/ingest (X-Device-Key)
  -> raw attendance_punches rows (even before mapping)
  -> per-device device_user_mappings (device user id -> employee)
  -> aggregation into employee_attendance with provenance
```

**Backend.** `server/attendance_devices.ts` owns device CRUD, key rotation/archive/delete, mappings, unmapped-user reporting, punch storage, CSV/ATTLOG parsing, aggregation, and the simulator. `server/routes/attendance_devices.ts` exposes:

- public ingestion: `POST /api/attendance-devices/ingest` (JSON punches or CSV) and `/ingest/csv` (text body), authenticated by `X-Device-Key`, `X-Api-Key`, or a bearer token; these two paths are the only mutations exempt from the browser CSRF header;
- management: device list/read/create/update/active/rotate/delete, mappings, unmapped users, punches, reprocess, import, and simulate, all behind `attendance_devices:view` / `attendance_devices:manage` and branch scope.

Punch timestamps are stored as device-local `YYYY-MM-DDTHH:mm:ss`; ISO input is normalized to Africa/Cairo wall-clock time. Duplicate punches are ignored by the `(device, user, timestamp)` unique key. `MANUAL` attendance rows are never overwritten; a manual edit resets `source='MANUAL'` and clears the device/punch links, and later device syncs skip that day. Raw punches are retained after unmapping so history is never lost.

**Frontend.** `src/pages/AttendanceDevices.tsx` provides devices, mappings/unmapped users, raw punches, file import, and simulator tabs, with a one-time API-key modal and key rotation/archive/delete actions. `/attendance-devices` is a lazy route gated by `attendance_devices:view`; HR links to it and shows the attendance source column.

**Migration `025_tax_free_and_attendance_devices.sql`.** Adds `party_credits`, `attendance_devices`, `device_user_mappings`, `attendance_punches`, the `employee_attendance` provenance columns, `data_migrations`, and the device permission seeds for accountants, general accountants, and branch managers.

**Verified defects fixed in this phase.**

| # | Defect | Fix |
|---|--------|-----|
| 13 | Historical invoices kept tax-inclusive totals, so receivables and the ledger no longer matched the tax-free policy. | One-time reset reverses/reposts ledger entries, caps `paid`, and stores the excess as a party credit. |
| 14 | Payroll still deducted insurance/income tax/martyrs fund and posted tax liabilities. | Payroll returns and posts tax-free amounts; confirmed runs are recalculated and reposted. |
| 15 | The ETA worker still enqueued and processed submissions even though tax identity was removed. | `ETA_ENABLED=false` guards enqueue, process, retry, and the settings UI; the reset cancels open submissions. |
| 16 | The device list used `SELECT d.*`, which leaked the stored API-key hash to every reader. | The device projection lists explicit public columns; the hash never leaves the database. |

---

## 4. What is already strong

These are not marketing claims; they are the parts the audit found to be structurally sound:

- **Double-entry ledger** (`server/ledger.ts`): automatic postings for sales, purchases, returns, payments, expenses, transfers, stocktake, payroll, and distributions; trial balance, P&L, balance sheet, period close, and reversal entries.
- **Inventory**: weighted average cost, FEFO batches, warehouse locations, stocktake, landed costs, branch stock matrix, reorder suggestions.
- **Documents**: draft → post → pay → cancel, returns, allocations, idempotent payment recording.
- **POS**: shifts, multi-tender, parked sales, proofs, refunds, edge-case tests.
- **RBAC**: database-driven roles/permissions, admin override, per-user overrides, server-side `requirePermission`.
- **Security baseline**: CSRF custom header on mutations, Helmet CSP, login rate limiting, hashed session tokens, `httpOnly` cookies, no CORS.
- **Data discipline**: integer piasters, foreign keys, WAL, busy timeout, forward-only migrations, legacy upgrade test, backup script.
- **CI**: format check, typecheck, Vitest, build, Playwright, `npm audit --omit=dev`, Docker image build.
- **Arabic RTL**: native Arabic UI, Egyptian payroll/HR rules, explicit tax-free policy switches, Arabic error messages.

---

## 5. Audit: what is still missing

The findings below are ordered by risk, not by effort.

### P0 — Security and data isolation

**1. Branch isolation is not universal.** ✅ *Resolved in Phase 2 for the routers below* (see Section 3.5); the remaining backend-boundary work is tracked in Phase 5.

Only 8 of 17 routers called `scopeFor`/`scopeSql` (branches, catalog, documents, expenses, ledger, POS, reports, transfers) before Phase 2. The following routers read branch-owned data without enforcing scope:

| Router | What is exposed | Evidence |
|--------|-----------------|----------|
| `server/routes/accounts.ts` | Cash/bank accounts, balances, statements, transfers | `branch_id` is read from the query string, never validated; `getCashAccount`/`getAccountStatement` accept any id; `listAccountTransfers` is global. |
| `server/routes/hr.ts` | Leaves and attendance | `branch_id` is passed straight through; no `scopeFor`; writes do not check the employee’s branch. |
| `server/routes/payroll.ts` | Employees (including salary and national ID), payroll runs, advances | Lists accept an optional `branch_id` without validation; run confirmation has no branch guard. |
| `server/routes/treasury.ts` | Cheques, bank statements, cost centers, cash-flow forecast | No branch scope at all; cheques store a free-text `branch_name`, not a `branch_id`. |
| `server/routes/eta.ts` | E-invoice submission log and payloads | `listSubmissions(200)` is global; document payload lookup has no scope. |

`server/routes/accounts.ts` is the clearest example: a sales user with `finance:view` can call `GET /api/cash-accounts` and receive every branch’s accounts, or open `/accounts` in the UI (the nav item is gated by `finance:view`). This is a code-path finding; it is not covered by a regression test yet.

**2. Permissions are too coarse for the data they protect.** ✅ *Resolved in Phase 2* — payroll/HR now require `hr:view`/`hr:manage`, treasury requires `finance:accounts`, and cash-account reads are scoped even when granted through `finance:view`.

Before Phase 2, `role_sales` and `role_viewer` holding `finance:view` (migration 007) unlocked:

- the cash/bank accounts screen and API,
- employee and payroll-run reads (`server/routes/payroll.ts` gates them with `finance:view`, not `hr:view`),
- cheque and bank-statement reads (`server/routes/treasury.ts`),
- HR leaves/attendance reads when combined with `finance:view` fallbacks.

A sales user should not be able to read salaries, national IDs, bank statements, or another branch’s treasury. The permission catalog already has `hr:view`, but payroll routes do not use it. The fix is to split `finance:view` into specific capabilities (`accounts:view`, `treasury:view`, `payroll:view` or `hr:view`) and update the nav/route guards.

**3. Branch-owned records without a branch column.** ✅ *Resolved in Phase 2* — `024_branch_isolation.sql` adds `cheques.branch_id`, backfills it, and indexes it; new cheques always receive a branch.

### P1 — Correctness, compliance, and retry safety

**4. Audit coverage is incomplete.**
`server/quotations.ts`, `server/pricing.ts`, `server/purchase_orders.ts`, `server/payroll.ts`, `server/treasury_advanced.ts`, and `server/eta.ts` contain **zero** `audit()` calls. Some of their postings go through `saveDocument`/`ledger` (which do audit), but their own lifecycle transitions (create quotation, confirm PO, confirm payroll, match bank statement, retry ETA) are not traced. Compliance-grade audit should cover every transition, not only money postings.

**5. Idempotency is limited to two flows.**
Only `addPayment` (`documents/:id/payments`) and distribution payments accept `Idempotency-Key`. POS checkout, payroll confirmation, purchase-order receiving, transfer receiving, stocktake posting, and quotation conversion are not retry-safe. A double-click or network retry can duplicate a business event. A shared idempotency table keyed by `(actor, key)` with a stored response is the clean fix.

**6. Some multi-step writes are not transactional.**
The CRM slice now wraps its writes, but several older domain modules still perform sequential `run()` calls without a transaction (for example parts of `server/quotations.ts`, `server/returns.ts`, and `server/eta.ts`). The audit should be repeated per module, and every write path should be either a single statement or an explicit transaction.

**7. ETA is a framework, not a verified production integration.**
The outbox, retry, payload builder, and QR payload exist and are tested, but the actual transport/credentials/environment behavior needs a production verification plan (sandbox certificate, submission, rejection handling, dead-letter queue). In tax-free mode the pipeline is disabled (`ETA_ENABLED=false`) and the reset cancels open submissions; the code remains for a future tax-enabled deployment.

### P2 — Architecture and scale

**8. Route/domain boundaries are inconsistent.**
Most domains have a domain module, but `server/routes/parties.ts`, `server/routes/owners.ts`, and `server/routes/rbac.ts` still contain raw SQL and business rules. There are 37 raw SQL calls in route files. The CRM module is the intended pattern: routes parse and serialize; repositories own SQL; services own rules and transactions.

**9. Lists are unbounded.**
There are 102 `ORDER BY` queries and very few `LIMIT`s outside POS shifts, the ETA queue, and ledger entries. Documents, parties, products, deals, activities, and targets can all return the full table. That is acceptable for a pilot but not for a year of data. Server-side pagination, filtering, and count queries are needed, plus indexes for the new access paths.

**10. The frontend still has three monoliths.**
`src/pages/finance/ledger.tsx` (4,195 lines), `src/pages/Documents.tsx` (3,152), and `src/pages/Catalog.tsx` (2,284) dwarf the new CRM feature folder. They need the same split: `api.ts`, data hook, table/board, modals, and small presentational components. There are also 616 inline `style={{...}}` blocks; moving them to the existing CSS system will make RTL and accessibility work tractable.

**11. Observability is console-only.**
`server/app.ts` logs errors with `console.error`; `server/index.ts` logs startup and ETA worker failures. There are no request IDs, structured JSON logs, latency metrics, queue-depth metrics, or error aggregation. Add a request-id middleware, structured logger, `/api/ready` (DB + migration + queue check), and a small metrics endpoint or OpenTelemetry export.

**12. Accessibility and E2E coverage are thin.**
The app has 64 `aria-label`/`role` attributes across roughly 41k lines of frontend code. The CRM page is keyboard-openable and has focus-visible styles, but there is no automated accessibility gate. Playwright covers auth, ledger, POS, and workspace flows; CRM now has a screen-load assertion, but no interaction test for drag-and-drop, lost-reason, or conversion flows.

### P3 — Product depth (decide, then build)

- **Multi-currency / FX**: accounts have a `currency` field, but there is no FX rate table or revaluation. If Orqiva sells outside Egypt, this is a product gap; if not, document EGP-only explicitly.
- **Multi-company / tenant isolation**: `company WHERE id=1` assumes one company per database. A SaaS deployment needs `tenant_id` on every table and a tenant-aware scope, which is a large architectural decision.
- **Approval workflows**: credit limits, PO approval thresholds, payroll approval chains, and segregation of duties are not modeled beyond statuses.
- **Attachments and document management**: invoices, cheques, and contracts have no generic attachment store.
- **CRM depth**: no email/WhatsApp sync, lead scoring, sequences, or campaign attribution; activities are manual.
- **Customer/supplier portal**: no external self-service surface.

---

## 6. Phased roadmap

### Phase 0 — Safety net ✅ (already done)

Branch `refactor/v2`, green baseline, migration tests, Docker/CI.

### Phase 1 — CRM vertical slice + kernel ✅ (this pass)

Deliverables: CRM backend module, CRM feature folder, migration 023, audit/sequence kernel, API abort/error handling, ErrorBoundary, 4 new CRM tests, CRM E2E screen load.

**Exit criteria met:** CRM writes are transactional and audited; branch isolation is tested; lost reasons and lifecycle timestamps are enforced; typecheck/build/format/Vitest/Playwright green.

### Phase 2 — Isolation and least privilege ✅ (this pass)

1. Add `scopeFor` to accounts, HR, payroll, treasury, and ETA.
2. Add branch guards to writes: account create/update/transfer, leave/attendance, employee/advance, payroll run/confirm, cheque lifecycle.
3. Split `finance:view` into specific permissions; gate payroll reads with `hr:view` or a new `payroll:view`; update the nav and route guards.
4. Add `branch_id` to cheques (migration 024), backfill, require it for new cheques, and index it.
5. Add a cross-branch regression matrix: for each resource, `admin` sees all, a branch user sees only their branch, and a foreign id returns 404/403.

**Exit criteria met:** no branch-owned read/write in accounts, HR, payroll, treasury, or ETA can be reached without a scope check; a sales user receives 403 for payroll and treasury and 404 for foreign branch accounts; `tests/branch_isolation_phase2.test.ts` covers the matrix; all gates are green.

### Phase 3 — Tax-free operation and attendance devices ✅ (this pass)

1. Add `TAX_FREE`, `ETA_ENABLED`, and `TAX_FREE_MIGRATION` policy switches and force zero tax in every write path (documents, POS, quotations, purchase orders, company settings).
2. Add migration 025: `party_credits`, device/mapping/punch tables, attendance provenance, `data_migrations`, and device permissions.
3. Recalculate historical documents, payroll, purchase orders, quotations, the company profile, and ETA state once; reverse/repost ledger entries; convert overpayments to party credits; preserve closed periods and idempotency.
4. Build the vendor-neutral device API, public key-authenticated ingestion, CSV/ATTLOG import, simulator, management UI, and HR provenance display.
5. Add `tests/tax_free_reset.test.ts` and `tests/attendance_devices.test.ts`; update tax-inclusive tests and E2E totals.

**Exit criteria met:** no write path can persist VAT, income tax, martyrs fund, or social insurance; historical books reconcile without tax; overpayments remain usable as party credits; devices can register, ingest, map, aggregate, import, and simulate without a physical device; manual attendance is never overwritten; typecheck, format, Vitest, build, and Playwright are green.

### Phase 4 — Audit and idempotency everywhere (next)

1. Add audit rows to quotations, pricing, purchase orders, payroll, treasury advanced, and ETA.
2. Introduce a shared `idempotency_keys` table and a middleware/helper for unsafe POSTs.
3. Make payroll confirmation, PO receiving, transfer receiving, stocktake posting, and POS checkout retry-safe.
4. Add `request_id` to audit rows and error responses.

**Exit criteria:** every state transition writes exactly one audit row; repeating a request with the same idempotency key returns the original result and creates no duplicate business event.

### Phase 5 — Backend module boundaries

1. Split `server/service.ts` (documents/payments), `server/ledger.ts`, and `server/pos.ts` into `server/modules/{documents,ledger,pos}/{schemas,repository,service,routes}.ts`.
2. Move raw SQL out of `server/routes/parties.ts`, `owners.ts`, and `rbac.ts`.
3. Move shared types to `shared/types.ts` (server currently imports 42 times from `src/types.ts`).
4. Standardize error codes and validation at the HTTP edge.

**Exit criteria:** no SQL in route files; each module has one repository and one service; every module’s public surface is typed; build and tests stay green.

### Phase 6 — Frontend decomposition and accessibility

1. Split `ledger.tsx`, `Documents.tsx`, and `Catalog.tsx` into feature folders using the CRM pattern.
2. Replace inline styles with the existing token/class system.
3. Add a modal focus trap, keyboard navigation, and axe checks to E2E.
4. Add empty/error/permission states consistently; remove duplicated fetch logic.

**Exit criteria:** no page file > 600 lines; zero serious axe violations on the main screens; all modals keyboard-operable; no full-page crashes.

### Phase 7 — Scale and operations

1. Paginate and filter every list endpoint; add count endpoints; add indexes for the actual filters.
2. Add structured logs, request IDs, `/api/ready`, latency/queue metrics, and error aggregation.
3. Add a backup/restore drill test (not just backup creation).
4. Harden the ETA worker: backoff, dead-letter, alerting, production credential checklist.

**Exit criteria:** lists stay under 200 ms p95 at 100k rows; a restore drill passes; an operator can diagnose a failed request from logs alone.

### Phase 8 — Product depth and launch hardening

1. Decide multi-currency and multi-company explicitly; implement or document the boundary.
2. Add approval workflows and segregation of duties where the business requires them.
3. Add attachments, CRM integrations, and the remaining product depth from Section 5/P3.
4. Threat model, penetration test, load test, DR drill, UAT, runbooks.

**Exit criteria:** UAT sign-off; security findings closed or accepted; go-live checklist signed.

---

## 7. How to verify this pass

```bash
npm run format:check
npm run typecheck
npm test                 # 35 files / 265 tests
npm run build
npx playwright test      # 13 tests
```

The Phase 2 regression file is `tests/branch_isolation_phase2.test.ts`. It proves:

- a branch accountant sees only their branch’s cash accounts, statements, and transfers;
- foreign account/employee/payroll-run/cheque/statement IDs return 404, and requesting a foreign `branch_id` returns 403;
- sales users can read their own branch’s cash accounts for payment forms but cannot read payroll, HR, cheques, bank statements, or forecasts;
- ETA status/submissions/payload/process are scoped, and processing one branch’s queue leaves the other branch pending.

The Phase 3 regression files are `tests/tax_free_reset.test.ts` and `tests/attendance_devices.test.ts`. They prove:

- a taxed sale is revalued, its overpayment becomes an open customer credit, and the ledger is reversed/reposted without VAT, even inside a closed period;
- a taxed purchase becomes a supplier credit with zero input VAT;
- drafts are revalued without invented ledger entries, and already tax-free documents are untouched;
- confirmed payroll runs zero insurance/tax/martyrs deductions, recalculate net pay, and repost the payroll entry;
- purchase orders, quotations, the company profile, and ETA submissions are reset/cancelled, while valid submissions stay valid;
- a second reset is skipped and creates no duplicate credits or entries;
- devices register with a one-time key (only the SHA-256 hash is stored), rotate keys, and reject old keys;
- unmapped punches are stored, then linked and aggregated retroactively after mapping;
- duplicates, invalid timestamps, CSV/ATTLOG imports, and the simulator behave deterministically;
- manual attendance rows are never overwritten, and manual edits clear device provenance;
- device management is branch-scoped and gated by `attendance_devices:view`/`manage`;
- devices with punches cannot be deleted and must be archived.

The CRM regression file is `tests/crm_hardening.test.ts`. It proves:

- a sales user sees only their branch’s deals and activities;
- a foreign deal/activity id returns 404 on read and write;
- creating a deal in a foreign branch returns 403;
- a lost stage without a reason returns 400; with a reason it returns 200 and sets `closed_at`;
- reopening clears `closed_at` and `lost_reason`;
- activity PATCH reschedules, completes, and cancels, with audit rows;
- overview totals and sales targets are branch-scoped;
- assignees are branch-scoped, while administrators remain assignable everywhere.

`tests/migration.test.ts` now upgrades a legacy `001` database through `025_tax_free_and_attendance_devices.sql` and still passes the original invariants (branch backfill, document numbering, stock, foreign keys, integrity check, and a post-upgrade sale).

---

## 8. Honest status

The CRM slice is complete enough to call done: it has a real backend module, a split frontend, branch isolation, lifecycle rules, audit, atomic numbering, migration coverage, and regression tests. The app-wide kernel is stronger: safe API errors, abortable reads, and a render-error boundary.

The whole ERP is **not** done. Phases 1–3 are complete, so the highest-risk isolation/permission gap is closed (accounts, HR, payroll, treasury, and ETA follow the same branch-scope contract as documents and stock) and the tax-free policy is consistent from the database through the UI.

The next-highest risks are **audit coverage** and **retry safety**. Several lifecycle transitions still write no audit row, and most unsafe POSTs are not idempotent, so a network retry or double-click can duplicate a business event. That is Phase 4 and should land before new product surface.

The recommended commit sequence from here is:

1. `security/audit-idempotency` — Phase 4.
2. `refactor/backend-modules` — Phase 5.
3. `refactor/frontend-monoliths` — Phase 6.

Phases 1–3 landed together as the v3 foundation because they share the same request kernel, scope helpers, schema migration chain, and regression suite. Splitting them retroactively would produce intermediate commits that do not build; the tested boundary is this commit.
