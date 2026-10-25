/**
 * One-time historical recalculation for tax-free mode.
 *
 * Removing VAT means every historical document total must drop to `subtotal - discount`.
 * Documents are not deleted and their payment history is preserved:
 *  - `paid` is capped at the new total, and any excess becomes a `party_credits` row so the
 *    customer/supplier keeps their overpayment as a usable credit.
 *  - Existing document ledger entries are reversed and reposted with the new totals. Payment
 *    entries are untouched because the cash really moved.
 *  - Payroll runs lose their social-insurance, income-tax, and martyrs-fund deductions; the
 *    net salary is recalculated from gross minus advances/attendance deductions. Confirmed
 *    runs that had a ledger entry are reversed and reposted.
 *  - Purchase orders, quotations, and the company profile are reset to zero tax.
 *  - Pending ETA submissions are cancelled because the pipeline depends on tax identity.
 *
 * The function is idempotent: rows already at zero tax are skipped, and the
 * `source_document_id` unique index makes credit creation safe to retry.
 */

import { all, one, run, transaction, id, now } from './db';
import { TAX_FREE, TAX_FREE_MIGRATION } from '../src/config';
import { closedThrough, reverseBySource } from './ledger';
import { postDocumentLedger } from './posting';
import { postPayrollRunLedger } from './payroll';
import type { Actor } from './scope';
import type { Document, DocLine, PayrollRun } from '../src/types';

export interface TaxFreeResetReport {
  documents: number;
  credits: number;
  payrollRuns: number;
  purchaseOrders: number;
  quotations: number;
  etaCancelled: number;
  skipped: boolean;
  errors: string[];
}

function systemActor(): Actor | null {
  const user = one<{ id: string; name: string }>(
    `SELECT id, name FROM users
     WHERE active=1
     ORDER BY CASE WHEN role='ADMIN' THEN 0 ELSE 1 END, created_at
     LIMIT 1`,
  );
  if (!user) return null;
  return { id: user.id, name: user.name, role: 'ADMIN' };
}

function alreadyApplied(): boolean {
  return Boolean(one('SELECT name FROM data_migrations WHERE name=?', TAX_FREE_MIGRATION));
}

/**
 * Applies the reset if it has not run yet. Returns a report for tests and diagnostics.
 * Throws after the fact if individual records failed, so the migration marker stays unset
 * and the next start retries the remaining rows.
 */
export function runTaxFreeReset(): TaxFreeResetReport {
  const report: TaxFreeResetReport = {
    documents: 0,
    credits: 0,
    payrollRuns: 0,
    purchaseOrders: 0,
    quotations: 0,
    etaCancelled: 0,
    skipped: false,
    errors: [],
  };

  if (!TAX_FREE || alreadyApplied()) {
    report.skipped = true;
    return report;
  }

  const actor = systemActor();
  if (!actor) {
    // A fresh database has no users yet. There is nothing historical to recalculate, so mark
    // the migration as applied; future rows are created tax-free by the service layer.
    run('INSERT INTO data_migrations(name, applied_at) VALUES(?,?)', TAX_FREE_MIGRATION, now());
    report.skipped = true;
    return report;
  }

  const closed = closedThrough();
  if (closed) run('UPDATE gl_settings SET closed_through=NULL WHERE id=1');

  try {
    resetDocuments(actor, report);
    resetPayroll(actor, report);
    resetCommercialDocuments(report);
    resetCompany();
    cancelEta(report);
  } finally {
    if (closed) run('UPDATE gl_settings SET closed_through=? WHERE id=1', closed);
  }

  if (report.errors.length) {
    throw new Error(
      `تعذر إكمال إعادة حساب البيانات بدون ضريبة (${report.errors.length} سجل): ${report.errors
        .slice(0, 5)
        .join(' | ')}`,
    );
  }

  run('INSERT INTO data_migrations(name, applied_at) VALUES(?,?)', TAX_FREE_MIGRATION, now());
  return report;
}

function resetDocuments(actor: Actor, report: TaxFreeResetReport) {
  const docs = all<Document & { party_name: string }>(
    `SELECT d.*, p.name AS party_name
     FROM documents d
     JOIN parties p ON p.id=d.party_id
     WHERE d.tax<>0 OR d.tax_rate<>0`,
  );

  for (const doc of docs) {
    try {
      transaction(() => {
        const newTotal = doc.subtotal - doc.discount;
        const overpaid = Math.max(0, doc.paid - newTotal);

        if (overpaid > 0) {
          const direction = doc.type === 'SALE' || doc.type === 'PURCHASE' ? 'CREDIT' : 'DEBIT';
          const result = run(
            `INSERT OR IGNORE INTO party_credits(
               id, party_id, branch_id, source_document_id, amount, remaining, direction,
               status, notes, created_at, updated_at
             ) VALUES(?,?,?,?,?,?,?,'OPEN',?,?,?)`,
            id(),
            doc.party_id,
            doc.branch_id,
            doc.id,
            overpaid,
            overpaid,
            direction,
            `رصيد ناتج عن إلغاء ضريبة الفاتورة ${doc.number}`,
            now(),
            now(),
          );
          if (result.changes > 0) report.credits++;
        }

        run(
          'UPDATE documents SET tax_rate=0, tax=0, total=?, paid=? WHERE id=?',
          newTotal,
          Math.min(doc.paid, newTotal),
          doc.id,
        );

        // Only repost documents that actually had a posted ledger entry. Legacy documents
        // that predate the ledger stay unposted so we do not invent historical entries.
        const reversed = reverseBySource(
          doc.type,
          doc.id,
          actor,
          `إعادة تقييم ${doc.number} بدون ضريبة`,
        );
        if (reversed > 0 && doc.status === 'POSTED') {
          const lines = all<DocLine>('SELECT * FROM document_lines WHERE document_id=?', doc.id);
          postDocumentLedger(
            {
              ...doc,
              tax_rate: 0,
              tax: 0,
              total: newTotal,
              paid: Math.min(doc.paid, newTotal),
              lines,
            },
            actor,
          );
        }

        report.documents++;
      });
    } catch (error) {
      report.errors.push(
        `${doc.number}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

function resetPayroll(actor: Actor, report: TaxFreeResetReport) {
  const runs = all<PayrollRun>('SELECT * FROM payroll_runs');

  for (const pr of runs) {
    try {
      transaction(() => {
        const slips = all<{
          id: string;
          gross_salary: number;
          advances_deduction: number;
          attendance_deduction: number;
          other_deductions: number;
        }>('SELECT * FROM payroll_slips WHERE payroll_run_id=?', pr.id);

        let totalNet = 0;
        for (const slip of slips) {
          const net = Math.max(
            0,
            slip.gross_salary -
              slip.advances_deduction -
              slip.attendance_deduction -
              slip.other_deductions,
          );
          totalNet += net;
          run(
            `UPDATE payroll_slips
             SET social_insurance_employee=0, social_insurance_employer=0,
                 income_tax=0, martyrs_fund=0, net_salary=?
             WHERE id=?`,
            net,
            slip.id,
          );
        }

        run(
          `UPDATE payroll_runs
           SET total_social_insurance_employee=0, total_social_insurance_employer=0,
               total_income_tax=0, total_martyrs_fund=0, total_net=?
           WHERE id=?`,
          totalNet,
          pr.id,
        );

        // Repost only confirmed/paid runs that previously had a ledger entry.
        const reversed = reverseBySource(
          'MANUAL',
          pr.id,
          actor,
          `إعادة تقييم مسير رواتب ${pr.month} بدون تأمينات أو ضرائب`,
        );
        if (reversed > 0 && (pr.status === 'CONFIRMED' || pr.status === 'PAID')) {
          const entry = postPayrollRunLedger(
            { ...pr, total_net: totalNet, total_income_tax: 0, total_martyrs_fund: 0 },
            actor,
          );
          run('UPDATE payroll_runs SET journal_entry_id=? WHERE id=?', entry?.id ?? null, pr.id);
        }

        report.payrollRuns++;
      });
    } catch (error) {
      report.errors.push(
        `payroll ${pr.month}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

function resetCommercialDocuments(report: TaxFreeResetReport) {
  const po = run(
    `UPDATE purchase_orders
     SET tax_rate=0, tax=0, total=subtotal
     WHERE tax_rate<>0 OR tax<>0 OR total<>subtotal`,
  );
  report.purchaseOrders = Number(po.changes);
  run('UPDATE purchase_order_lines SET tax_rate=0 WHERE tax_rate<>0');

  const quotations = run(
    `UPDATE quotations
     SET tax_rate=0, tax=0, total=MAX(0, subtotal-discount)
     WHERE tax_rate<>0 OR tax<>0 OR total<>MAX(0, subtotal-discount)`,
  );
  report.quotations = Number(quotations.changes);
}

function resetCompany() {
  run(
    `UPDATE company
     SET tax_rate=0, tax_number='', tax_registration_number='', activity_code='',
         eta_environment='stub'
     WHERE id=1`,
  );
}

function cancelEta(report: TaxFreeResetReport) {
  const ts = now();
  const cancelled = run(
    `UPDATE e_invoice_submissions
     SET status='CANCELLED', completed_at=?, updated_at=?
     WHERE status IN ('PENDING','SUBMITTED','FAILED')`,
    ts,
    ts,
  );
  report.etaCancelled = Number(cancelled.changes);
  run(
    `UPDATE documents
     SET eta_status='CANCELLED'
     WHERE eta_status IN ('PENDING','SUBMITTED','FAILED')`,
  );
}
