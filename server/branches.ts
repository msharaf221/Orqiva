import { all, one, run, transaction, id, now } from './db';
import {
  branchProductSchema,
  branchSchema,
  branchStatusSchema,
  branchUpdateSchema,
  branchUsersSchema,
} from './validation';
import { AppError, audit, requireRow, type Actor } from './service';
import { accessibleBranchIds, scopeSql } from './scope';
import { businessToday } from './clock';
import type { Branch, BranchProduct } from '../src/types';

export function listBranches(user: Actor, includeArchived = false): Branch[] {
  const visible = scopeSql('b.id', { ids: accessibleBranchIds(user) });
  const archived = includeArchived && user.role === 'ADMIN' ? '' : ' AND b.active=1';
  return all<Branch>(
    `SELECT b.*,
      COALESCE((SELECT SUM(bs.quantity) FROM branch_stock bs WHERE bs.branch_id=b.id),0) stock_units,
      COALESCE((SELECT SUM(bs.quantity*p.cost_price) FROM branch_stock bs JOIN products p ON p.id=bs.product_id WHERE bs.branch_id=b.id),0) stock_value
    FROM branches b WHERE ${visible.sql}${archived} ORDER BY b.active DESC,b.code`,
    ...visible.params,
  );
}

export function branchDetail(branchId: string): Branch {
  const branch = requireRow(one<Branch>('SELECT * FROM branches WHERE id=?', branchId));
  const staff = all<{ id: string; name: string; role: 'ADMIN' | 'STAFF' }>(
    `SELECT u.id,u.name,u.role FROM user_branches ub JOIN users u ON u.id=ub.user_id
     WHERE ub.branch_id=? ORDER BY u.name`,
    branchId,
  );
  return { ...branch, users: staff };
}

export function createBranch(raw: unknown, actor: Actor) {
  const input = branchSchema.parse(raw);
  const branchId = id();
  transaction(() => {
    run(
      'INSERT INTO branches(id,code,name,kind,phone,address,active,opened_on,closed_on,created_at) VALUES(?,?,?,?,?,?,1,?,NULL,?)',
      branchId,
      input.code,
      input.name,
      input.kind,
      input.phone,
      input.address,
      input.opened_on,
      now(),
    );
    // A new branch lists every active product; the owner removes what it will not carry.
    run(
      'INSERT INTO branch_products(branch_id,product_id,active) SELECT ?,id,1 FROM products WHERE active=1',
      branchId,
    );
    audit(actor, 'إضافة فرع', 'BRANCH', branchId, `${input.code} — ${input.name}`);
  });
  return branchDetail(branchId);
}

export function updateBranch(branchId: string, raw: unknown, actor: Actor) {
  const input = branchUpdateSchema.parse(raw);
  requireRow(one('SELECT id FROM branches WHERE id=?', branchId));
  transaction(() => {
    run(
      'UPDATE branches SET name=?,kind=?,phone=?,address=? WHERE id=?',
      input.name,
      input.kind,
      input.phone,
      input.address,
      branchId,
    );
    audit(actor, 'تعديل فرع', 'BRANCH', branchId, input.name);
  });
  return branchDetail(branchId);
}

/**
 * Archiving closes a branch from today: its history stays intact and expenses dated later are
 * no longer shared with it. Refused while the branch still holds stock, drafts or goods in transit.
 */
export function setBranchActive(branchId: string, raw: unknown, actor: Actor) {
  const { active } = branchStatusSchema.parse(raw);
  const branch = requireRow(one<Branch>('SELECT * FROM branches WHERE id=?', branchId));
  if (active === !!branch.active) return branchDetail(branchId);
  transaction(() => {
    if (active) {
      run('UPDATE branches SET active=1,closed_on=NULL WHERE id=?', branchId);
      audit(actor, 'إعادة فتح فرع', 'BRANCH', branchId, branch.name);
      return;
    }
    if (branch.opened_on > businessToday())
      throw new AppError(409, 'الفرع لم يبدأ التشغيل بعد؛ لا يمكن أرشفته قبل تاريخ بدء التشغيل');
    const otherOpen = one<{ count: number }>(
      'SELECT COUNT(*) count FROM branches WHERE active=1 AND id<>?',
      branchId,
    )!.count;
    if (otherOpen === 0) throw new AppError(409, 'لا يمكن أرشفة آخر فرع نشط');
    const stock = one<{ units: number }>(
      'SELECT COALESCE(SUM(quantity),0) units FROM branch_stock WHERE branch_id=?',
      branchId,
    )!;
    if (stock.units > 0) throw new AppError(409, 'انقل المخزون من الفرع قبل أرشفته');
    if (
      one(
        "SELECT 1 FROM transfers WHERE status='IN_TRANSIT' AND (from_branch_id=? OR to_branch_id=?)",
        branchId,
        branchId,
      )
    )
      throw new AppError(409, 'توجد تحويلات في الطريق من هذا الفرع أو إليه');
    if (one("SELECT 1 FROM documents WHERE branch_id=? AND status='DRAFT'", branchId))
      throw new AppError(409, 'أكمل المسودات أو ألغها قبل أرشفة الفرع');
    run('UPDATE branches SET active=0,closed_on=? WHERE id=?', businessToday(), branchId);
    audit(actor, 'أرشفة فرع', 'BRANCH', branchId, branch.name);
  });
  return branchDetail(branchId);
}

/** The branch's product list: which products it sells, its own price and reorder level. */
export function assortment(branchId: string): BranchProduct[] {
  requireRow(one('SELECT id FROM branches WHERE id=?', branchId));
  return all<BranchProduct>(
    `SELECT p.id product_id,p.sku,p.name,p.category,p.unit,p.cost_price,p.sale_price base_sale_price,
      p.min_stock base_min_stock,p.active product_active,COALESCE(bp.active,0) active,
      bp.sale_price,bp.min_stock,COALESCE(bs.quantity,0) stock
    FROM products p
    LEFT JOIN branch_products bp ON bp.product_id=p.id AND bp.branch_id=?
    LEFT JOIN branch_stock bs ON bs.product_id=p.id AND bs.branch_id=?
    ORDER BY p.active DESC,p.name`,
    branchId,
    branchId,
  );
}

export function setAssortmentItem(branchId: string, productId: string, raw: unknown, actor: Actor) {
  const input = branchProductSchema.parse(raw);
  const branch = requireRow(one<Branch>('SELECT * FROM branches WHERE id=?', branchId));
  const product = requireRow(
    one<{ name: string }>('SELECT name FROM products WHERE id=?', productId),
  );
  if (!branch.active) throw new AppError(409, 'الفرع مؤرشف؛ أعد فتحه لتعديل قائمة منتجاته');
  transaction(() => {
    run(
      `INSERT INTO branch_products(branch_id,product_id,active,sale_price,min_stock) VALUES(?,?,?,?,?)
       ON CONFLICT(branch_id,product_id) DO UPDATE SET active=excluded.active,sale_price=excluded.sale_price,min_stock=excluded.min_stock`,
      branchId,
      productId,
      input.active ? 1 : 0,
      input.sale_price,
      input.min_stock,
    );
    audit(
      actor,
      input.active ? 'إتاحة منتج في فرع' : 'إيقاف منتج في فرع',
      'BRANCH',
      branchId,
      `${product.name} · ${branch.name}`,
    );
  });
  return assortment(branchId).find((r) => r.product_id === productId);
}

export function branchStaff(branchId: string) {
  requireRow(one('SELECT id FROM branches WHERE id=?', branchId));
  return all<{
    id: string;
    name: string;
    email: string;
    role: string;
    active: number;
    assigned: number;
  }>(
    `SELECT u.id,u.name,u.email,u.role,u.active,
      EXISTS(SELECT 1 FROM user_branches ub WHERE ub.user_id=u.id AND ub.branch_id=?) assigned
     FROM users u ORDER BY u.role,u.name`,
    branchId,
  );
}

export function setBranchStaff(branchId: string, raw: unknown, actor: Actor) {
  const { user_ids } = branchUsersSchema.parse(raw);
  requireRow(one('SELECT id FROM branches WHERE id=?', branchId));
  transaction(() => {
    for (const userId of user_ids)
      requireRow(one('SELECT id FROM users WHERE id=? AND role=?', userId, 'STAFF'));
    const current = all<{ user_id: string }>(
      'SELECT user_id FROM user_branches WHERE branch_id=?',
      branchId,
    ).map((r) => r.user_id);
    for (const userId of current)
      if (!user_ids.includes(userId))
        run('DELETE FROM user_branches WHERE user_id=? AND branch_id=?', userId, branchId);
    for (const userId of user_ids)
      run('INSERT OR IGNORE INTO user_branches(user_id,branch_id) VALUES(?,?)', userId, branchId);
    audit(actor, 'تعديل صلاحيات الفرع', 'BRANCH', branchId, `${user_ids.length} موظف`);
  });
  return branchStaff(branchId);
}
