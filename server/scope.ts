import { all, one } from './db';
import { AppError } from './errors';
import type { Branch, Role } from '../src/types';

/** `ids: null` is the whole group: every branch, including archived ones. */
export interface Scope {
  ids: string[] | null;
}
export interface Actor {
  id: string;
  name: string;
  role: Role;
}

export function accessibleBranchIds(user: Pick<Actor, 'id' | 'role'>): string[] {
  if (user.role === 'ADMIN')
    return all<{ id: string }>('SELECT id FROM branches ORDER BY code').map((r) => r.id);
  return all<{ id: string }>(
    'SELECT b.id FROM user_branches ub JOIN branches b ON b.id=ub.branch_id WHERE ub.user_id=? ORDER BY b.code',
    user.id,
  ).map((r) => r.id);
}

/** Resolves the `branch_id` query parameter: a single branch, or the group when omitted. */
export function scopeFor(user: Pick<Actor, 'id' | 'role'>, requested?: unknown): Scope {
  if (typeof requested !== 'string' || requested === '' || requested === 'all') {
    return { ids: user.role === 'ADMIN' ? null : accessibleBranchIds(user) };
  }
  if (!one('SELECT id FROM branches WHERE id=?', requested))
    throw new AppError(404, 'الفرع غير موجود');
  if (!canSee(user, requested)) throw new AppError(403, 'ليس لديك صلاحية على هذا الفرع');
  return { ids: [requested] };
}

export function canSee(user: Pick<Actor, 'id' | 'role'>, branchId: string): boolean {
  return user.role === 'ADMIN' || accessibleBranchIds(user).includes(branchId);
}

/** Branch that a write operation may touch: the user must be assigned and the branch open. */
export function writableBranch(user: Pick<Actor, 'id' | 'role'>, branchId: string): Branch {
  const branch = one<Branch>('SELECT * FROM branches WHERE id=?', branchId);
  if (!branch) throw new AppError(400, 'الفرع المحدد غير موجود');
  if (!canSee(user, branchId)) throw new AppError(403, 'ليس لديك صلاحية على هذا الفرع');
  if (!branch.active) throw new AppError(409, 'الفرع مؤرشف ولا يقبل عمليات جديدة');
  return branch;
}

export function inScope(scope: Scope, branchId: string | null | undefined): boolean {
  return scope.ids === null || (!!branchId && scope.ids.includes(branchId));
}

/** SQL fragment restricting `column` to the scope; parameters must be appended in order. */
export function scopeSql(column: string, scope: Scope): { sql: string; params: string[] } {
  if (scope.ids === null) return { sql: '1=1', params: [] };
  if (!scope.ids.length) return { sql: '0=1', params: [] };
  return {
    sql: `${column} IN (${scope.ids.map(() => '?').join(',')})`,
    params: scope.ids,
  };
}
