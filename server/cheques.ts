/**
 * Cheques & Commercial Papers Portfolio (Phase 4.1).
 *
 * Full double-entry lifecycle for Egyptian banking cheques:
 *  - RECEIVABLE: Dr Notes Receivable (1135), Cr Customer AR (1130).
 *                On Collection: Dr Bank (1120), Cr Notes Receivable (1135).
 *                On Bounce: Dr Customer AR (1130), Cr Notes Receivable (1135).
 *  - PAYABLE:    Dr Supplier AP (2110), Cr Notes Payable (2115).
 *                On Payment: Dr Notes Payable (2115), Cr Bank (1120).
 */

import { all, one, run, transaction, id, now } from './db';
import { AppError } from './errors';
import { postEntry } from './ledger';
import { Cheque, ChequeType, ChequeStatus } from '../src/types';
import type { Actor } from './scope';

function toActor(actorId?: string): Actor {
  return { id: actorId || 'system', name: 'Treasury Engine', role: 'ADMIN' };
}

export function listCheques(filter?: {
  type?: ChequeType;
  status?: ChequeStatus;
  partyId?: string;
}): Cheque[] {
  const clauses: string[] = [];
  const params: (string | number | null)[] = [];

  if (filter?.type) {
    clauses.push('c.type=?');
    params.push(filter.type);
  }
  if (filter?.status) {
    clauses.push('c.status=?');
    params.push(filter.status);
  }
  if (filter?.partyId) {
    clauses.push('c.party_id=?');
    params.push(filter.partyId);
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

  return all<Cheque>(
    `SELECT c.*, 
            p.name AS party_name,
            ca.name AS cash_account_name,
            u.name AS created_by_name
     FROM cheques c
     JOIN parties p ON p.id = c.party_id
     LEFT JOIN cash_accounts ca ON ca.id = c.cash_account_id
     LEFT JOIN users u ON u.id = c.created_by
     ${where}
     ORDER BY c.due_date ASC, c.created_at DESC`,
    ...params,
  );
}

export function getCheque(id: string): Cheque | null {
  return (
    one<Cheque>(
      `SELECT c.*, 
              p.name AS party_name,
              ca.name AS cash_account_name,
              u.name AS created_by_name
       FROM cheques c
       JOIN parties p ON p.id = c.party_id
       LEFT JOIN cash_accounts ca ON ca.id = c.cash_account_id
       LEFT JOIN users u ON u.id = c.created_by
       WHERE c.id=?`,
      id,
    ) || null
  );
}

export function createCheque(
  data: {
    number: string;
    type: ChequeType;
    party_id: string;
    bank_name: string;
    branch_name?: string;
    amount: number;
    issue_date: string;
    due_date: string;
    notes?: string;
  },
  actorId?: string,
): Cheque {
  if (data.amount <= 0) throw new AppError(400, 'قيمة الشيك يجب أن تكون أكبر من صفر');

  const party = one<{ id: string; name: string }>(
    'SELECT id, name FROM parties WHERE id=?',
    data.party_id,
  );
  if (!party) throw new AppError(404, 'الطرف (عميل/مورد) غير موجود');

  const existing = one<{ id: string }>(
    'SELECT id FROM cheques WHERE type=? AND number=? AND bank_name=?',
    data.type,
    data.number,
    data.bank_name,
  );
  if (existing) throw new AppError(400, 'رقم الشيك مسجل بالفعل لنفس البنك');

  const chequeId = id();
  const ts = now();

  transaction(() => {
    // 1. Double-Entry GL posting for initial cheque receipt or issuance
    let entryId: string | null = null;
    if (data.type === 'RECEIVABLE') {
      // Dr Notes Receivable (1135), Cr Customer AR (1130)
      const entry = postEntry(
        {
          date: data.issue_date,
          sourceType: 'MANUAL',
          sourceId: chequeId,
          memo: `استلام شيك قبض رقم ${data.number} - بنك ${data.bank_name} من ${party.name}`,
          lines: [
            { accountId: 'acc_notes_receivable', debit: data.amount, credit: 0 },
            { accountId: 'acc_ar', debit: 0, credit: data.amount },
          ],
        },
        toActor(actorId),
      );
      entryId = entry.id;
    } else {
      // Dr Supplier AP (2110), Cr Notes Payable (2115)
      const entry = postEntry(
        {
          date: data.issue_date,
          sourceType: 'MANUAL',
          sourceId: chequeId,
          memo: `إصدار شيك دفع رقم ${data.number} - بنك ${data.bank_name} إلى ${party.name}`,
          lines: [
            { accountId: 'acc_ap', debit: data.amount, credit: 0 },
            { accountId: 'acc_notes_payable', debit: 0, credit: data.amount },
          ],
        },
        toActor(actorId),
      );
      entryId = entry.id;
    }

    run(
      `INSERT INTO cheques(id, number, type, party_id, bank_name, branch_name, amount,
                           issue_date, due_date, status, journal_entry_id, notes, created_by, created_at, updated_at)
       VALUES(?,?,?,?,?,?,?,?,?, 'PORTFOLIO', ?,?,?,?,?)`,
      chequeId,
      data.number,
      data.type,
      data.party_id,
      data.bank_name,
      data.branch_name || null,
      data.amount,
      data.issue_date,
      data.due_date,
      entryId,
      data.notes || null,
      actorId || null,
      ts,
      ts,
    );
  });

  return getCheque(chequeId)!;
}

export function collectCheque(
  chequeId: string,
  bankAccountId: string,
  collectionDate: string,
  actorId?: string,
): Cheque {
  const cheque = getCheque(chequeId);
  if (!cheque) throw new AppError(404, 'الشيك غير موجود');
  if (cheque.type !== 'RECEIVABLE') throw new AppError(400, 'التحصيل متاح فقط لشيكات القبض');
  if (cheque.status === 'COLLECTED') throw new AppError(400, 'الشيك محصل بالفعل');
  if (cheque.status === 'BOUNCED' || cheque.status === 'CANCELLED') {
    throw new AppError(400, `لا يمكن تحصيل شيك بحالة ${cheque.status}`);
  }

  const bankAcc = one<{ id: string; name: string; gl_account_id: string }>(
    'SELECT id, name, gl_account_id FROM cash_accounts WHERE id=?',
    bankAccountId,
  );
  if (!bankAcc) throw new AppError(404, 'حساب البنك غير موجود');

  transaction(() => {
    // Dr Bank, Cr Notes Receivable
    postEntry(
      {
        date: collectionDate || now().slice(0, 10),
        sourceType: 'MANUAL',
        sourceId: chequeId,
        memo: `تحصيل شيك قبض رقم ${cheque.number} في حساب ${bankAcc.name}`,
        lines: [
          { accountId: bankAcc.gl_account_id || 'acc_bank', debit: cheque.amount, credit: 0 },
          { accountId: 'acc_notes_receivable', debit: 0, credit: cheque.amount },
        ],
      },
      toActor(actorId),
    );

    run(
      "UPDATE cheques SET status='COLLECTED', cash_account_id=?, updated_at=? WHERE id=?",
      bankAccountId,
      now(),
      chequeId,
    );
  });

  return getCheque(chequeId)!;
}

export function bounceCheque(chequeId: string, actorId?: string, reason?: string): Cheque {
  const cheque = getCheque(chequeId);
  if (!cheque) throw new AppError(404, 'الشيك غير موجود');
  if (cheque.status === 'BOUNCED') throw new AppError(400, 'الشيك مسجل كمرتد بالفعل');
  if (cheque.status === 'COLLECTED' || cheque.status === 'PAID') {
    throw new AppError(400, 'لا يمكن إرجاع شيك تم صرفه أو تحصيله بالفعل');
  }

  transaction(() => {
    // Reverse notes receivable back to Customer AR: Dr Customer AR, Cr Notes Receivable
    if (cheque.type === 'RECEIVABLE') {
      postEntry(
        {
          date: now().slice(0, 10),
          sourceType: 'MANUAL',
          sourceId: chequeId,
          memo: `ارتداد شيك قبض رقم ${cheque.number} - ${reason || 'عدم كفاية الرصيد'}`,
          lines: [
            { accountId: 'acc_ar', debit: cheque.amount, credit: 0 },
            { accountId: 'acc_notes_receivable', debit: 0, credit: cheque.amount },
          ],
        },
        toActor(actorId),
      );
    }

    run(
      "UPDATE cheques SET status='BOUNCED', notes = COALESCE(notes || ' | ', '') || ?, updated_at=? WHERE id=?",
      `ارتداد الشيك: ${reason || 'شيك مرتد'}`,
      now(),
      chequeId,
    );
  });

  return getCheque(chequeId)!;
}

export function payCheque(
  chequeId: string,
  bankAccountId: string,
  paymentDate: string,
  actorId?: string,
): Cheque {
  const cheque = getCheque(chequeId);
  if (!cheque) throw new AppError(404, 'الشيك غير موجود');
  if (cheque.type !== 'PAYABLE') throw new AppError(400, 'الصرف متاح فقط لشيكات الدفع الصادرة');
  if (cheque.status === 'PAID') throw new AppError(400, 'الشيك مدفوع بالفعل');

  const bankAcc = one<{ id: string; name: string; gl_account_id: string }>(
    'SELECT id, name, gl_account_id FROM cash_accounts WHERE id=?',
    bankAccountId,
  );
  if (!bankAcc) throw new AppError(404, 'حساب البنك غير موجود');

  transaction(() => {
    // Dr Notes Payable (2115), Cr Bank (1120)
    postEntry(
      {
        date: paymentDate || now().slice(0, 10),
        sourceType: 'MANUAL',
        sourceId: chequeId,
        memo: `صرف شيك دفع رقم ${cheque.number} من حساب ${bankAcc.name}`,
        lines: [
          { accountId: 'acc_notes_payable', debit: cheque.amount, credit: 0 },
          { accountId: bankAcc.gl_account_id || 'acc_bank', debit: 0, credit: cheque.amount },
        ],
      },
      toActor(actorId),
    );

    run(
      "UPDATE cheques SET status='PAID', cash_account_id=?, updated_at=? WHERE id=?",
      bankAccountId,
      now(),
      chequeId,
    );
  });

  return getCheque(chequeId)!;
}
