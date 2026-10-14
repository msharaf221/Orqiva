import { describe, expect, it } from 'vitest';
import { can } from '../src/auth';
import { count, dayOffset, money, toCents } from '../src/lib';
import type { User } from '../src/types';

describe('Client-Side Utility & RBAC Functions', () => {
  describe('money() formatter', () => {
    it('formats integer piastres into decimal EGP strings', () => {
      expect(money(0)).toBe('0');
      expect(money(10000)).toBe('100'); // 100 EGP
      expect(money(12550)).toBe('126'); // rounded to 0 decimals
      expect(money(12550, 2)).toBe('125.50');
      expect(money(100000000, 2)).toBe('1,000,000.00');
    });
  });

  describe('count() formatter', () => {
    it('formats numbers with thousands separators', () => {
      expect(count(0)).toBe('0');
      expect(count(5000)).toBe('5,000');
      expect(count(1234567)).toBe('1,234,567');
    });
  });

  describe('toCents() converter', () => {
    it('converts decimal EGP form entries into integer piastres', () => {
      expect(toCents('10')).toBe(1000);
      expect(toCents('15.50')).toBe(1550);
      expect(toCents('0.75')).toBe(75);
      expect(toCents(null)).toBe(0);
    });
  });

  describe('dayOffset()', () => {
    it('calculates ISO dates with positive and negative offsets', () => {
      const base = '2026-06-15';
      expect(dayOffset(1, base)).toBe('2026-06-16');
      expect(dayOffset(7, base)).toBe('2026-06-22');
      expect(dayOffset(-15, base)).toBe('2026-05-31');
    });
  });

  describe('can() RBAC evaluator', () => {
    const adminUser: User = {
      id: 'u-admin',
      name: 'مدير',
      email: 'admin@orqiva.com',
      role: 'ADMIN',
      active: 1,
      created_at: '2026-01-01',
      permissions: ['admin:all'],
    };

    const cashierUser: User = {
      id: 'u-cashier',
      name: 'كاشير',
      email: 'cashier@orqiva.com',
      role: 'STAFF',
      active: 1,
      created_at: '2026-01-01',
      permissions: ['pos:access', 'pos:shift_open', 'documents:create_sale'],
    };

    it('grants full permissions to ADMIN', () => {
      expect(can(adminUser, 'admin:all')).toBe(true);
      expect(can(adminUser, 'documents:cancel')).toBe(true);
      expect(can(adminUser, 'users:manage')).toBe(true);
      expect(can(adminUser, 'finance:expenses')).toBe(true);
    });

    it('grants only assigned permissions to STAFF', () => {
      expect(can(cashierUser, 'pos:access')).toBe(true);
      expect(can(cashierUser, 'pos:shift_open')).toBe(true);
      expect(can(cashierUser, 'documents:create_sale')).toBe(true);

      // Denies unassigned permissions
      expect(can(cashierUser, 'documents:cancel')).toBe(false);
      expect(can(cashierUser, 'users:manage')).toBe(false);
      expect(can(cashierUser, 'admin:all')).toBe(false);
    });

    it('returns false for null or undefined user', () => {
      expect(can(null, 'pos:access')).toBe(false);
      expect(can(undefined, 'admin:all')).toBe(false);
    });
  });
});
