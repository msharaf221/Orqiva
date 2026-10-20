import request from 'supertest';
import { hash } from 'bcryptjs';
import { app } from '../server/app';
import { all, db, run } from '../server/db';

export const header = { 'X-Orqiva-Request': '1' };
export const PASSWORD = 'TestingPassword2026!';

/** Creates an administrator and a sales employee who is assigned to the HQ branch only. */
export async function seedUsers() {
  const password = await hash(PASSWORD, 4);
  run(
    'INSERT INTO users(id,name,email,password_hash,role,active,created_at) VALUES(?,?,?,?,?,?,?)',
    'admin',
    'مدير اختبار',
    'admin@test.local',
    password,
    'ADMIN',
    1,
    new Date().toISOString(),
  );
  run(
    'INSERT INTO users(id,name,email,password_hash,role,active,created_at) VALUES(?,?,?,?,?,?,?)',
    'staff',
    'موظف اختبار',
    'staff@test.local',
    password,
    'STAFF',
    1,
    new Date().toISOString(),
  );
  run("INSERT OR REPLACE INTO user_roles(user_id,role_id) VALUES('admin','role_admin')");
  run("INSERT OR REPLACE INTO user_roles(user_id,role_id) VALUES('staff','role_sales')");
  run("INSERT INTO user_branches(user_id,branch_id) VALUES('staff','main')");
}

export async function signIn(email: string) {
  const agent = request.agent(app);
  await agent.post('/api/auth/login').set(header).send({ email, password: PASSWORD }).expect(200);
  return agent;
}

/** Clears business data between tests. The HQ branch, the default owner and the users remain. */
export function resetBusinessData() {
  db.exec(`
    DELETE FROM user_permission_overrides;
    DELETE FROM audit_logs; DELETE FROM distribution_payments; DELETE FROM distribution_lines;
    DELETE FROM distributions; DELETE FROM equity_entries; DELETE FROM cost_movements;
    DELETE FROM branch_cost; DELETE FROM stock_movements;
    DELETE FROM transfer_lines; DELETE FROM transfers; DELETE FROM payments;
    DELETE FROM e_invoice_submissions;
    DELETE FROM document_lines; DELETE FROM documents; DELETE FROM sequences;
    DELETE FROM pos_cash_movements; DELETE FROM pos_parked_sales; DELETE FROM pos_shifts;
    DELETE FROM stocktake_lines; DELETE FROM stocktake_sessions;
    DELETE FROM branch_stock; DELETE FROM branch_products; DELETE FROM products;
    DELETE FROM expenses;
    DELETE FROM parties WHERE id<>'walk-in-customer';
    DELETE FROM account_transfers;
    DELETE FROM cash_accounts WHERE id NOT IN ('acc_def_cash', 'acc_def_bank');
    UPDATE cash_accounts SET initial_balance=0, allow_negative=1, active=1;
    DELETE FROM user_roles WHERE user_id NOT IN ('admin', 'staff');
    DELETE FROM roles WHERE is_system=0;
    DELETE FROM user_branches WHERE branch_id<>'main';
    DELETE FROM branches WHERE id<>'main';
    UPDATE branches SET active=1, closed_on=NULL, opened_on='2000-01-01' WHERE id='main';
    DELETE FROM owners WHERE id<>'owner-main';
    UPDATE owners SET share_bps=10000, active=1 WHERE id='owner-main';
  `);
  run("DELETE FROM user_branches WHERE user_id='staff'");
  run(
    "INSERT OR IGNORE INTO user_branches(user_id,branch_id) SELECT 'staff','main' WHERE EXISTS (SELECT 1 FROM users WHERE id='staff')",
  );
}

/** True when every balance equals the sum of its stock movements (the ledger reconciles). */
export function ledgerReconciles(): boolean {
  return (
    all(
      `SELECT bs.branch_id FROM branch_stock bs
       LEFT JOIN (SELECT branch_id,product_id,SUM(quantity) q FROM stock_movements GROUP BY branch_id,product_id) m
         ON m.branch_id=bs.branch_id AND m.product_id=bs.product_id
       WHERE bs.quantity<>COALESCE(m.q,0)`,
    ).length === 0
  );
}

export function stockAt(productId: string, branchId: string): number {
  return (
    all<{ quantity: number }>(
      'SELECT quantity FROM branch_stock WHERE product_id=? AND branch_id=?',
      productId,
      branchId,
    )[0]?.quantity ?? 0
  );
}
