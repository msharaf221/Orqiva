import { hash } from 'bcryptjs';
import { db, migrate, one, run, transaction, id, now } from './db';
import { saveDocument, postDocument, addPayment, cancelDocument, audit } from './service';
import type { Product } from '../src/types';
migrate();
if (one('SELECT id FROM users LIMIT 1')) {
  console.log('Seed skipped: users already exist. Existing data was not changed.');
  db.close();
} else {
  const password = process.env.SEED_PASSWORD;
  if (!password || password.length < 10)
    throw new Error('Set SEED_PASSWORD to a unique password of at least 10 characters.');
  if (
    process.env.NODE_ENV === 'production' &&
    ['Orqiva@2026', 'ChangeThisPassword2026!'].includes(password)
  ) {
    throw new Error('Choose a unique SEED_PASSWORD before initializing production.');
  }
  const passwordHash = await hash(password, 12);
  const actor = { id: id(), name: 'أحمد محمد' };
  run(
    'INSERT INTO users VALUES(?,?,?,?,?,?,?)',
    actor.id,
    actor.name,
    'admin@orqiva.com',
    passwordHash,
    'ADMIN',
    1,
    now(),
  );
  audit(actor, 'تهيئة النظام', 'SYSTEM', '1');
  if (process.env.SEED_DEMO === 'true') {
    const customers = [
      ['شركة آفاق للتقنية', 'أحمد سامي', 'القاهرة، مدينة نصر'],
      ['مؤسسة النور التجارية', 'محمد عادل', 'الإسكندرية، سموحة'],
      ['استوديو مساحة', 'سارة حسن', 'القاهرة، المعادي'],
      ['شركة مدار للأعمال', 'خالد إبراهيم', 'الجيزة، المهندسين'],
      ['مجموعة الرواد', 'عمر محمود', 'المنصورة، حي الجامعة'],
      ['مكتب نقطة للتصميم', 'نور علي', 'القاهرة، التجمع الخامس'],
      ['شركة كيان للحلول', 'ياسر أشرف', 'مرسى مطروح، وسط المدينة'],
      ['مؤسسة بداية', 'ريم أحمد', 'طنطا، شارع البحر'],
    ];
    const suppliers = [
      ['الشركة المصرية للتوريدات', 'القاهرة، العتبة'],
      ['مؤسسة تك لاين', 'القاهرة، مصر الجديدة'],
      ['شركة الأفق للأثاث', 'دمياط، المدينة الصناعية'],
      ['دلتا للتجهيزات المكتبية', 'الإسكندرية، محطة الرمل'],
    ];
    const customerIds: string[] = [];
    const supplierIds: string[] = [];
    transaction(() => {
      customers.forEach((c, i) => {
        const p = id();
        customerIds.push(p);
        run(
          'INSERT INTO parties VALUES(?,?,?,?,?,?,?,?,?,?)',
          p,
          'CUSTOMER',
          c[0],
          `contact${i + 1}@example.com`,
          `010${String(23456780 + i).padStart(8, '0')}`,
          c[2],
          '',
          `مسؤول التواصل: ${c[1]}`,
          1,
          now(),
        );
      });
      suppliers.forEach((c, i) => {
        const p = id();
        supplierIds.push(p);
        run(
          'INSERT INTO parties VALUES(?,?,?,?,?,?,?,?,?,?)',
          p,
          'SUPPLIER',
          c[0],
          `supply${i + 1}@example.com`,
          `012${String(23456780 + i).padStart(8, '0')}`,
          c[1],
          '',
          '',
          1,
          now(),
        );
      });
    });
    const catalog: [string, string, string, number, number, number][] = [
      ['TEC-001', 'شاشة Dell مقاس 24 بوصة', 'إلكترونيات', 6250, 4800, 10],
      ['TEC-002', 'لوحة مفاتيح لاسلكية Logitech', 'إلكترونيات', 1450, 950, 15],
      ['TEC-003', 'ماوس لاسلكي Logitech M185', 'إلكترونيات', 580, 380, 20],
      ['FUR-001', 'كرسي مكتب إرجونوميك', 'أثاث مكتبي', 4200, 2800, 8],
      ['FUR-002', 'مكتب خشبي 140 سم', 'أثاث مكتبي', 5600, 3900, 5],
      ['OFF-001', 'ورق طباعة A4 — عبوة 500', 'مستلزمات مكتبية', 195, 135, 30],
      ['TEC-004', 'طابعة HP LaserJet', 'إلكترونيات', 8750, 6700, 5],
      ['OFF-002', 'دفتر ملاحظات A5', 'مستلزمات مكتبية', 85, 45, 20],
      ['TEC-005', 'سماعة رأس لاسلكية', 'إلكترونيات', 1850, 1250, 10],
      ['OFF-003', 'طقم أقلام حبر — 12 قلم', 'مستلزمات مكتبية', 120, 65, 25],
      ['FUR-003', 'وحدة أدراج متحركة', 'أثاث مكتبي', 2400, 1600, 5],
      ['TEC-006', 'موزع USB-C متعدد المنافذ', 'إلكترونيات', 1150, 720, 10],
    ];
    const products: Product[] = [];
    transaction(() =>
      catalog.forEach((p) => {
        const productId = id();
        run(
          'INSERT INTO products VALUES(?,?,?,?,?,?,?,?,?,?,?)',
          productId,
          p[0],
          p[1],
          p[2],
          'قطعة',
          p[3] * 100,
          p[4] * 100,
          150,
          p[5],
          1,
          now(),
        );
        run(
          'INSERT INTO stock_movements VALUES(?,?,?,?,?,?,?)',
          id(),
          productId,
          null,
          150,
          'رصيد افتتاحي',
          actor.id,
          now(),
        );
        products.push(one<Product>('SELECT * FROM products WHERE id=?', productId)!);
      }),
    );
    const day = (ago: number) => new Date(Date.now() - ago * 86400000).toISOString().slice(0, 10);
    for (let i = 14; i >= 0; i--) {
      const p = products[i % products.length];
      const doc = saveDocument(
        {
          type: 'PURCHASE',
          party_id: supplierIds[i % 4],
          date: day(i * 4),
          due_date: day(i * 4 - 15),
          tax_rate: 1400,
          discount: 0,
          notes: 'توريد تجهيزات مكتبية',
          lines: [{ product_id: p.id, quantity: 8 + (i % 7), unit_price: p.cost_price }],
        },
        actor,
      );
      postDocument(doc.id, actor);
      if (i % 3 !== 0)
        addPayment(
          doc.id,
          { amount: doc.total, method: 'BANK', date: doc.date, reference: `TRF-${1020 + i}` },
          actor,
        );
    }
    for (let i = 64; i >= 0; i--) {
      const p = products[i % 12],
        p2 = products[(i + 5) % 12];
      const ago = Math.floor(i * 0.9);
      const doc = saveDocument(
        {
          type: 'SALE',
          party_id: customerIds[i % 8],
          date: day(ago),
          due_date: day(ago - 14),
          tax_rate: 1400,
          discount: i % 5 === 0 ? 15000 : 0,
          notes: '',
          lines: [
            { product_id: p.id, quantity: 1 + (i % 3), unit_price: p.sale_price },
            { product_id: p2.id, quantity: 2 + (i % 2), unit_price: p2.sale_price },
          ],
        },
        actor,
      );
      if (i < 3) continue;
      postDocument(doc.id, actor);
      if (i % 4 === 0)
        addPayment(
          doc.id,
          {
            amount: Math.round(doc.total / 2),
            method: 'BANK',
            date: doc.date,
            reference: `TRF-${2040 + i}`,
          },
          actor,
        );
      else if (i % 7 !== 0)
        addPayment(
          doc.id,
          { amount: doc.total, method: i % 2 ? 'CASH' : 'BANK', date: doc.date, reference: '' },
          actor,
        );
    }
    const cancelled = saveDocument(
      {
        type: 'SALE',
        party_id: customerIds[0],
        date: day(5),
        due_date: day(-10),
        tax_rate: 1400,
        discount: 0,
        notes: 'ألغي بطلب العميل',
        lines: [{ product_id: products[0].id, quantity: 1, unit_price: 625000 }],
      },
      actor,
    );
    cancelDocument(cancelled.id, actor);
    const expenseData: [string, string, number, number][] = [
      ['إيجار المكتب — الشهر الحالي', 'إيجارات', 12500, 2],
      ['حملة تسويق رقمي', 'تسويق', 3500, 5],
      ['اشتراك الإنترنت', 'اتصالات', 850, 8],
      ['شحن طلبات العملاء', 'شحن وتوصيل', 1240, 3],
      ['فاتورة الكهرباء', 'مرافق', 1650, 10],
      ['صيانة الطابعة', 'صيانة', 600, 15],
      ['إيجار المكتب — الشهر السابق', 'إيجارات', 12500, 32],
      ['خدمات استضافة الموقع', 'اشتراكات', 450, 12],
      ['رواتب فريق العمل', 'رواتب', 24000, 6],
    ];
    transaction(() => {
      for (const [title, category, amount, ago] of expenseData)
        run(
          'INSERT INTO expenses VALUES(?,?,?,?,?,?,?,?,?)',
          id(),
          title,
          category,
          amount * 100,
          day(ago),
          'BANK',
          '',
          actor.id,
          now(),
        );
      for (const [index, remaining] of [
        [1, 6],
        [5, 12],
        [8, 3],
      ] as const) {
        const p = one<Product>('SELECT * FROM products WHERE id=?', products[index].id)!;
        run('UPDATE products SET stock=? WHERE id=?', remaining, p.id);
        run(
          'INSERT INTO stock_movements VALUES(?,?,?,?,?,?,?)',
          id(),
          p.id,
          null,
          remaining - p.stock,
          'تسوية الجرد الافتتاحي',
          actor.id,
          now(),
        );
      }
      audit(actor, 'استيراد البيانات التجريبية', 'SYSTEM', '1', '٨ عملاء · ٤ موردين · ١٢ منتجاً');
    });
  }
  console.log('Seed completed. Administrator: admin@orqiva.com. Password: value of SEED_PASSWORD.');
  db.close();
}
