import { Router } from 'express';
import { all, id, now, one, run, transaction } from '../db';
import { AppError, audit, requireRow } from '../service';
import { expenseSchema } from '../validation';
import { requirePermission } from '../rbac';
import { scopeFor, scopeSql } from '../scope';
import { resolveDefaultAccountId, assertAccountFunds, glAccountForCashAccount } from '../accounts';
import { postExpenseLedger } from '../posting';
import type { Branch, Expense } from '../../src/types';

export const expensesRouter = Router();

expensesRouter.get('/', (req, res) => {
  const f = scopeSql('e.branch_id', scopeFor(req.user, req.query.branch_id));
  res.json(
    all<Expense>(
      `SELECT e.*, b.name AS branch_name, ca.name AS account_name
       FROM expenses e
       LEFT JOIN branches b ON b.id=e.branch_id
       LEFT JOIN cash_accounts ca ON ca.id=e.account_id
       WHERE ${f.sql} ORDER BY e.date DESC, e.created_at DESC`,
      ...f.params,
    ),
  );
});

expensesRouter.post('/', requirePermission('finance:expenses'), (req, res) => {
  const p = expenseSchema.parse(req.body);
  const expenseId = id();
  transaction(() => {
    if (p.branch_id) {
      const branch = requireRow(one<Branch>('SELECT * FROM branches WHERE id=?', p.branch_id));
      if (!branch.active) throw new AppError(409, 'الفرع مؤرشف ولا يقبل مصروفات جديدة');
    }
    const accountId = p.account_id || resolveDefaultAccountId(p.method, p.branch_id);
    assertAccountFunds(accountId, p.amount, req.user, p.override_overdraft);
    run(
      'INSERT INTO expenses(id,title,category,amount,date,method,notes,created_by,created_at,branch_id,allocation,account_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
      expenseId,
      p.title,
      p.category,
      p.amount,
      p.date,
      p.method,
      p.notes,
      req.user.id,
      now(),
      p.branch_id ?? null,
      p.allocation,
      accountId,
    );
    postExpenseLedger(
      {
        id: expenseId,
        title: p.title,
        category: p.category,
        amount: p.amount,
        date: p.date,
        branchId: p.branch_id ?? null,
        glAccountId: glAccountForCashAccount(accountId),
      },
      req.user,
    );
    audit(req.user, 'تسجيل مصروف', 'EXPENSE', expenseId, p.title);
  });
  res.status(201).json(one('SELECT * FROM expenses WHERE id=?', expenseId));
});
