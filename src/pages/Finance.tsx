/**
 * Finance screens barrel.
 *
 * The original 3,698-line file is now split into focused modules under ./finance:
 *  - expenses  : Expenses page
 *  - payments  : Payments page + SelectPaymentDoc
 *  - reports   : Reports page
 *  - settings  : SettingsPage + Company/Security/User/Roles panels + RoleModal
 *  - activity  : ActivityPage (audit log)
 *  - accounts  : Treasury screens (Accounts + Cash/Transfer/Statement modals)
 *  - shift-audit : Treasury shift review + Z-Report modals
 *
 * Import paths from App.tsx are preserved through this barrel.
 */
export { expenseScope, Expenses } from './finance/expenses';
export { Payments } from './finance/payments';
export { Reports } from './finance/reports';
export { SettingsPage } from './finance/settings';
export { ActivityPage } from './finance/activity';
export { Accounts, CashAccountModal, TransferModal, StatementModal } from './finance/accounts';
