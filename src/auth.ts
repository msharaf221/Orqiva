import type { User } from './types';

/**
 * Checks if a user has a specific permission.
 * System administrators (role === 'ADMIN' or with 'admin:all') have all permissions unconditionally.
 */
export function can(user: User | null | undefined, permission: string): boolean {
  if (!user) return false;
  if (user.role === 'ADMIN') return true;
  if (user.permissions?.includes('admin:all')) return true;
  return user.permissions?.includes(permission) ?? false;
}
