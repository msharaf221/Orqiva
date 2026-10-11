import { all, one, run, transaction, id, now } from './db';
import { equitySchema, ownerSchema } from './validation';
import { AppError, audit, requireRow, type Actor } from './service';
import { resolveDefaultAccountId, assertAccountFunds } from './accounts';
import type { EquityEntry, Owner } from '../src/types';

export const SHARE_TOTAL = 10000;

/** Money in the group's liquid cash pool across active accounts */
export function cashBalance(): number {
  return one<{ cash: number }>(
    `SELECT
      (SELECT COALESCE(SUM(initial_balance),0) FROM cash_accounts WHERE active=1)
      + (SELECT COALESCE(SUM(p.amount),0) FROM payments p JOIN documents d ON d.id=p.document_id WHERE d.type IN ('SALE','PURCHASE_RETURN'))
      - (SELECT COALESCE(SUM(p.amount),0) FROM payments p JOIN documents d ON d.id=p.document_id WHERE d.type IN ('PURCHASE','SALE_RETURN'))
      - (SELECT COALESCE(SUM(amount),0) FROM expenses)
      - (SELECT COALESCE(SUM(amount),0) FROM distribution_payments)
      + (SELECT COALESCE(SUM(amount),0) FROM equity_entries WHERE kind='CONTRIBUTION')
      - (SELECT COALESCE(SUM(amount),0) FROM equity_entries WHERE kind='WITHDRAWAL') cash`,
  )!.cash;
}

export function egp(piastres: number): string {
  return (piastres / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function listOwners(): Owner[] {
  return all<Owner>(
    `SELECT o.*,
      COALESCE((SELECT SUM(e.amount) FROM equity_entries e WHERE e.owner_id=o.id AND e.kind='CONTRIBUTION'),0) contributed,
      COALESCE((SELECT SUM(e.amount) FROM equity_entries e WHERE e.owner_id=o.id AND e.kind='WITHDRAWAL'),0) withdrawn,
      COALESCE((SELECT SUM(l.amount) FROM distribution_lines l JOIN distributions d ON d.id=l.distribution_id WHERE l.owner_id=o.id AND d.status IN ('APPROVED','PAID')),0) declared,
      COALESCE((SELECT SUM(l.paid) FROM distribution_lines l JOIN distributions d ON d.id=l.distribution_id WHERE l.owner_id=o.id AND d.status IN ('APPROVED','PAID')),0) paid,
      0 due
    FROM owners o ORDER BY o.active DESC,o.created_at`,
  ).map((o) => ({ ...o, due: o.declared - o.paid }));
}

/** Active ownership must never exceed 100%; a distribution additionally requires exactly 100%. */
function assertShareRoom(excludingOwnerId: string, shareBps: number) {
  const others = one<{ total: number }>(
    'SELECT COALESCE(SUM(share_bps),0) total FROM owners WHERE active=1 AND id<>?',
    excludingOwnerId,
  )!.total;
  if (others + shareBps > SHARE_TOTAL)
    throw new AppError(
      409,
      `مجموع نسب الملكية يتجاوز ١٠٠٪ (المتاح ${(SHARE_TOTAL - others) / 100}٪)`,
    );
}

export function createOwner(raw: unknown, actor: Actor) {
  const input = ownerSchema.parse(raw);
  const ownerId = id();
  transaction(() => {
    assertShareRoom('', input.share_bps);
    run(
      'INSERT INTO owners(id,name,phone,email,share_bps,active,created_at) VALUES(?,?,?,?,?,1,?)',
      ownerId,
      input.name,
      input.phone,
      input.email,
      input.share_bps,
      now(),
    );
    audit(actor, 'إضافة مالك/شريك', 'OWNER', ownerId, `${input.name} · ${input.share_bps / 100}٪`);
  });
  return listOwners().find((o) => o.id === ownerId);
}

export function updateOwner(ownerId: string, raw: unknown, actor: Actor) {
  const input = ownerSchema.parse(raw);
  const owner = requireRow(one<Owner>('SELECT * FROM owners WHERE id=?', ownerId));
  transaction(() => {
    if (owner.active) assertShareRoom(ownerId, input.share_bps);
    run(
      'UPDATE owners SET name=?,phone=?,email=?,share_bps=? WHERE id=?',
      input.name,
      input.phone,
      input.email,
      input.share_bps,
      ownerId,
    );
    audit(actor, 'تعديل مالك/شريك', 'OWNER', ownerId, input.name);
  });
  return listOwners().find((o) => o.id === ownerId);
}

export function setOwnerActive(ownerId: string, active: boolean, actor: Actor) {
  const owner = requireRow(one<Owner>('SELECT * FROM owners WHERE id=?', ownerId));
  transaction(() => {
    if (active && !owner.active) assertShareRoom(ownerId, owner.share_bps);
    if (!active && owner.active && !one('SELECT 1 FROM owners WHERE active=1 AND id<>?', ownerId))
      throw new AppError(409, 'لا يمكن إيقاف آخر مالك نشط');
    run('UPDATE owners SET active=? WHERE id=?', active ? 1 : 0, ownerId);
    audit(actor, active ? 'تفعيل مالك' : 'إيقاف مالك', 'OWNER', ownerId, owner.name);
  });
  return listOwners().find((o) => o.id === ownerId);
}

export function addEquityEntry(ownerId: string, raw: unknown, actor: Actor) {
  const input = equitySchema.parse(raw);
  const owner = requireRow(one<Owner>('SELECT * FROM owners WHERE id=?', ownerId));
  const entryId = id();
  transaction(() => {
    const accountId = input.account_id || resolveDefaultAccountId(input.method);
    if (input.kind === 'WITHDRAWAL') {
      const cash = cashBalance();
      if (input.amount > cash)
        throw new AppError(409, `الرصيد النقدي المتاح (${egp(cash)} ج.م) لا يكفي لهذا المسحوب`);
      assertAccountFunds(accountId, input.amount, actor, input.override_overdraft);
    }
    run(
      'INSERT INTO equity_entries(id,owner_id,kind,amount,method,date,notes,created_by,created_at,account_id) VALUES(?,?,?,?,?,?,?,?,?,?)',
      entryId,
      ownerId,
      input.kind,
      input.amount,
      input.method,
      input.date,
      input.notes,
      actor.id,
      now(),
      accountId,
    );
    audit(
      actor,
      input.kind === 'CONTRIBUTION' ? 'إيداع رأس مال' : 'مسحوب شريك',
      'OWNER',
      ownerId,
      `${owner.name} · ${egp(input.amount)} ج.م`,
    );
  });
  return ownerLedger(ownerId);
}

export function ownerLedger(ownerId: string) {
  const owner = requireRow(listOwners().find((o) => o.id === ownerId));
  const entries = all<EquityEntry>(
    `SELECT e.*, ca.name AS account_name
     FROM equity_entries e
     LEFT JOIN cash_accounts ca ON ca.id = e.account_id
     WHERE e.owner_id=? ORDER BY e.date DESC, e.created_at DESC`,
    ownerId,
  );
  const distributions = all<{
    number: string;
    status: string;
    period_from: string;
    period_to: string;
    amount: number;
    paid: number;
  }>(
    `SELECT d.number,d.status,d.period_from,d.period_to,l.amount,l.paid
     FROM distribution_lines l JOIN distributions d ON d.id=l.distribution_id
     WHERE l.owner_id=? AND d.status<>'CANCELLED' ORDER BY d.period_to DESC`,
    ownerId,
  );
  return { owner, entries, distributions };
}
