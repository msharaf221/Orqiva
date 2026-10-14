import { describe, expect, it } from 'vitest';
import {
  partySchema,
  productSchema,
  posShiftOpenSchema,
  posCashMovementSchema,
  posShiftSubmitSchema,
  posShiftApproveSchema,
  posCheckoutSchema,
  expenseSchema,
  transferSchema,
  companySchema,
} from '../server/validation';

describe('Zod Validation Schemas', () => {
  describe('partySchema', () => {
    it('validates a valid customer', () => {
      const parsed = partySchema.parse({
        type: 'CUSTOMER',
        name: 'عميل معتمد',
        phone: '01012345678',
        email: 'customer@test.local',
      });
      expect(parsed.name).toBe('عميل معتمد');
      expect(parsed.type).toBe('CUSTOMER');
    });

    it('rejects empty name or invalid type', () => {
      expect(() =>
        partySchema.parse({
          type: 'INVALID' as any,
          name: 'اسم',
        }),
      ).toThrow();

      expect(() =>
        partySchema.parse({
          type: 'CUSTOMER',
          name: '   ',
        }),
      ).toThrow();
    });
  });

  describe('productSchema', () => {
    it('validates a valid product with stock and branch_id', () => {
      const parsed = productSchema.parse({
        sku: 'SKU-VALID',
        name: 'منتج تجريبي',
        category: 'الكترونيات',
        unit: 'قطعة',
        sale_price: 25000,
        cost_price: 18000,
        min_stock: 5,
        stock: 10,
        branch_id: 'main',
      });
      expect(parsed.sku).toBe('SKU-VALID');
    });

    it('rejects initial stock without branch_id', () => {
      expect(() =>
        productSchema.parse({
          sku: 'SKU-NO-BRANCH',
          name: 'منتج بدون فرع',
          category: 'عام',
          unit: 'قطعة',
          sale_price: 1000,
          cost_price: 500,
          min_stock: 0,
          stock: 15,
        }),
      ).toThrow('اختر الفرع');
    });
  });

  describe('posCheckoutSchema', () => {
    it('validates a complete checkout payload', () => {
      const parsed = posCheckoutSchema.parse({
        branch_id: 'main',
        party_id: 'walk-in-customer',
        date: '2026-06-15',
        discount: 500,
        lines: [{ product_id: 'p-1', quantity: 2, unit_price: 5000 }],
        payment: {
          method: 'CASH',
          amount_paid: 9500,
          amount_tendered: 10000,
        },
      });
      expect(parsed.lines.length).toBe(1);
      expect(parsed.payment.method).toBe('CASH');
    });

    it('rejects empty lines array', () => {
      expect(() =>
        posCheckoutSchema.parse({
          branch_id: 'main',
          party_id: 'walk-in-customer',
          date: '2026-06-15',
          discount: 0,
          lines: [],
          payment: { method: 'CASH', amount_paid: 0, amount_tendered: 0 },
        }),
      ).toThrow();
    });
  });

  describe('posShift schemas', () => {
    it('validates opening cash >= 0', () => {
      const parsed = posShiftOpenSchema.parse({
        branch_id: 'main',
        opening_cash: 50000,
        notes: 'افتتاح صباحي',
      });
      expect(parsed.opening_cash).toBe(50000);

      expect(() =>
        posShiftOpenSchema.parse({
          branch_id: 'main',
          opening_cash: -100,
        }),
      ).toThrow();
    });

    it('validates cash movement types and positive amounts', () => {
      const inMove = posCashMovementSchema.parse({
        type: 'IN',
        amount: 20000,
        reason: 'إيداع فكة',
      });
      expect(inMove.type).toBe('IN');

      expect(() =>
        posCashMovementSchema.parse({
          type: 'INVALID' as any,
          amount: 1000,
          reason: 'خطأ',
        }),
      ).toThrow();

      expect(() =>
        posCashMovementSchema.parse({
          type: 'OUT',
          amount: 0,
          reason: 'مبلغ صفر',
        }),
      ).toThrow();
    });

    it('validates shift submission and approval with alias compatibility', () => {
      const submitted = posShiftSubmitSchema.parse({
        declared_cash: 52000,
        notes: 'تسليم الوردية',
      });
      expect(submitted.declared_cash).toBe(52000);

      // Approve with closing_cash
      const approved = posShiftApproveSchema.parse({
        closing_cash: 52000,
        review_notes: 'معتمد',
      });
      expect(approved.closing_cash).toBe(52000);

      // Approve with verified_cash alias
      const approvedWithAlias = posShiftApproveSchema.parse({
        verified_cash: 52000,
      });
      expect(approvedWithAlias.closing_cash).toBe(52000);
    });
  });

  describe('expenseSchema & companySchema', () => {
    it('validates operational expense allocations', () => {
      const exp = expenseSchema.parse({
        title: 'صيانة دورية',
        category: 'صيانة',
        amount: 15000,
        date: '2026-06-15',
        method: 'CASH',
        allocation: 'EQUAL',
      });
      expect(exp.allocation).toBe('EQUAL');
    });

    it('validates inter-branch transfer schema preventing same-branch transfers', () => {
      const trf = transferSchema.parse({
        from_branch_id: 'branch-1',
        to_branch_id: 'branch-2',
        date: '2026-06-15',
        lines: [{ product_id: 'prod-1', quantity: 5 }],
      });
      expect(trf.from_branch_id).toBe('branch-1');

      expect(() =>
        transferSchema.parse({
          from_branch_id: 'branch-1',
          to_branch_id: 'branch-1',
          date: '2026-06-15',
          lines: [{ product_id: 'prod-1', quantity: 5 }],
        }),
      ).toThrow('لا يمكن التحويل إلى الفرع نفسه');
    });

    it('validates company tax rate limits', () => {
      const comp = companySchema.parse({
        name: 'شركة أوركيفا للتجارة',
        email: 'info@orqiva.com',
        phone: '01000000000',
        address: 'القاهرة، مصر',
        tax_number: '123-456-789',
        tax_rate: 1400,
        invoice_note: 'شروط الدفع ١٤ يوماً',
      });
      expect(comp.tax_rate).toBe(1400);

      expect(() =>
        companySchema.parse({
          name: 'شركة',
          email: '',
          phone: '',
          address: '',
          tax_number: '',
          tax_rate: 15000, // exceeds 10000 (100%)
          invoice_note: '',
        }),
      ).toThrow();
    });
  });
});
