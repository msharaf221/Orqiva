import { hash } from 'bcryptjs';
import { db, migrate, one, run, transaction, id, now } from './db';
import { saveDocument, postDocument, addPayment, cancelDocument, audit } from './service';
import { createProduct } from './catalog';
import { createBranch, setAssortmentItem } from './branches';
import { createTransfer, shipTransfer, receiveTransfer } from './transfers';
import { addEquityEntry } from './owners';
import type { Actor } from './scope';
import type { Branch, Product } from '../src/types';

export async function seed(closeDb = true) {
  migrate();
  if (one('SELECT id FROM users LIMIT 1')) {
    console.log('Seed skipped: users already exist. Existing data was not changed.');
    if (closeDb) db.close();
    return;
  }
  const isProd = process.env.NODE_ENV === 'production';
  const password = process.env.SEED_PASSWORD || (!isProd ? 'Orqiva@2026' : undefined);
  if (!password || password.length < 10)
    throw new Error('Set SEED_PASSWORD to a unique password of at least 10 characters.');
  if (isProd && ['Orqiva@2026', 'ChangeThisPassword2026!'].includes(password)) {
    throw new Error('Choose a unique SEED_PASSWORD before initializing production.');
  }
  const passwordHash = await hash(password, 12);
  const actor: Actor = { id: id(), name: 'أحمد محمد', role: 'ADMIN' };
  run(
    'INSERT INTO users(id,name,email,password_hash,role,active,created_at) VALUES(?,?,?,?,?,?,?)',
    actor.id,
    actor.name,
    'admin@orqiva.com',
    passwordHash,
    'ADMIN',
    1,
    now(),
  );
  audit(actor, 'تهيئة النظام', 'SYSTEM', '1');
  const shouldSeedDemo =
    process.env.SEED_DEMO !== undefined ? process.env.SEED_DEMO === 'true' : !isProd;
  if (shouldSeedDemo) seedDemo(actor, passwordHash);
  console.log(
    `Seed completed. Administrator: admin@orqiva.com. Password: ${process.env.SEED_PASSWORD ? 'value of SEED_PASSWORD' : 'Orqiva@2026'}.`,
  );
  if (closeDb) db.close();
}

const isDirectRun =
  process.argv[1] && (process.argv[1].endsWith('seed.ts') || process.argv[1].endsWith('seed.js'));

if (isDirectRun) {
  await seed(true);
}

function seedDemo(actor: Actor, passwordHash: string) {
  const day = (ago: number) => new Date(Date.now() - ago * 86400000).toISOString().slice(0, 10);
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
        'INSERT INTO parties(id,type,name,email,phone,address,tax_number,notes,active,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
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
        'INSERT INTO parties(id,type,name,email,phone,address,tax_number,notes,active,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
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

  // Branches: the HQ already exists from the initial migration. New branches open on different dates,
  // so expenses dated before a branch opened are not shared with it.
  const branches: Record<string, Branch> = {
    HQ: one<Branch>("SELECT * FROM branches WHERE code='HQ'")!,
  };
  const newBranches: [string, string, string, string, string][] = [
    ['NSR', 'فرع مدينة نصر', 'STORE', 'القاهرة، مدينة نصر', day(150)],
    ['ALX', 'فرع الإسكندرية', 'STORE', 'الإسكندرية، سموحة', day(120)],
    ['MTR', 'فرع مرسى مطروح', 'STORE', 'مرسى مطروح، وسط المدينة', day(40)],
  ];
  for (const [code, name, kind, address, openedOn] of newBranches) {
    const created = createBranch(
      { code, name, kind, address, phone: '', opened_on: openedOn },
      actor,
    );
    branches[code] = created as unknown as Branch;
  }

  // Catalogue: opening stock sits in the HQ warehouse; every branch lists every product at first.
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
  const products: Product[] = catalog.map(([sku, name, category, sale, cost, min]) =>
    createProduct(
      {
        sku,
        name,
        category,
        unit: 'قطعة',
        sale_price: sale * 100,
        cost_price: cost * 100,
        min_stock: min,
        stock: 150,
        branch_id: branches.HQ.id,
      },
      actor,
    ),
  );
  // Which products each branch carries. Furniture stays out of Alexandria and Matrouh;
  // Matrouh is a small outlet with a short list, and Nasr City does not stock the drawer unit.
  const carries = (code: string, sku: string) =>
    code === 'HQ' ||
    (code === 'NSR' && sku !== 'FUR-003') ||
    (code === 'ALX' && !sku.startsWith('FUR')) ||
    (code === 'MTR' && ['TEC-002', 'TEC-003', 'OFF-001', 'OFF-002', 'OFF-003'].includes(sku));
  for (const code of ['NSR', 'ALX', 'MTR'])
    for (const product of products)
      if (!carries(code, product.sku))
        setAssortmentItem(
          branches[code].id,
          product.id,
          { active: false, sale_price: null, min_stock: null },
          actor,
        );
  // Branch-level pricing and reorder levels: the outlet pays a small premium on paper.
  const byCode = (sku: string) => products.find((p) => p.sku === sku)!;
  setAssortmentItem(
    branches.MTR.id,
    byCode('OFF-001').id,
    { active: true, sale_price: 21000, min_stock: 10 },
    actor,
  );
  for (const sku of ['TEC-002', 'TEC-003', 'OFF-002', 'OFF-003'])
    setAssortmentItem(
      branches.MTR.id,
      byCode(sku).id,
      { active: true, sale_price: null, min_stock: 4 },
      actor,
    );

  // Owner: the single owner funds the opening capital; withdrawals and distributions come later.
  addEquityEntry(
    'owner-main',
    {
      kind: 'CONTRIBUTION',
      amount: 5_000_000,
      method: 'BANK',
      date: day(100),
      notes: 'رأس المال الافتتاحي',
    },
    actor,
  );

  const listed = (code: string) => products.filter((p) => carries(code, p.sku));

  // Purchases are received at the HQ warehouse (only administrators post purchases).
  for (let i = 14; i >= 0; i--) {
    const p = products[i % products.length];
    const doc = saveDocument(
      {
        type: 'PURCHASE',
        branch_id: branches.HQ.id,
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

  // Stock moves from the warehouse to the branches by transfer, so every branch sells from its own stock.
  const transferTo = (code: string, lines: [Product, number][], date: string) => {
    const created = createTransfer(
      {
        from_branch_id: branches.HQ.id,
        to_branch_id: branches[code].id,
        date,
        notes: `تحويل مخزني إلى ${branches[code].name}`,
        lines: lines.map(([p, quantity]) => ({ product_id: p.id, quantity })),
      },
      actor,
    );
    return created;
  };
  const nsr = transferTo(
    'NSR',
    listed('NSR').map((p) => [p, 25] as [Product, number]),
    day(60),
  );
  shipTransfer(nsr.id, actor);
  receiveTransfer(
    nsr.id,
    {
      lines: nsr.lines!.map((l) => ({
        product_id: l.product_id,
        quantity_received: l.quantity_sent,
      })),
    },
    actor,
  );
  const alx = transferTo(
    'ALX',
    listed('ALX').map((p) => [p, 25] as [Product, number]),
    day(55),
  );
  shipTransfer(alx.id, actor);
  receiveTransfer(
    alx.id,
    {
      lines: alx.lines!.map((l) => ({
        product_id: l.product_id,
        quantity_received: l.quantity_sent,
      })),
    },
    actor,
  );
  // Matrouh receives one unit fewer than sent on one line: the shortage is kept on the record.
  const mtr = transferTo(
    'MTR',
    listed('MTR').map((p) => [p, 12] as [Product, number]),
    day(36),
  );
  shipTransfer(mtr.id, actor);
  receiveTransfer(
    mtr.id,
    {
      lines: mtr.lines!.map((l, index) => ({
        product_id: l.product_id,
        quantity_received: index === 0 ? l.quantity_sent - 1 : l.quantity_sent,
      })),
    },
    actor,
  );
  // A second Alexandria transfer is still on the road, and a Nasr City draft has not been shipped yet.
  const onTheRoad = transferTo(
    'ALX',
    [
      [byCode('TEC-003'), 5],
      [byCode('OFF-002'), 6],
    ],
    day(1),
  );
  shipTransfer(onTheRoad.id, actor);
  transferTo('NSR', [[byCode('TEC-002'), 3]], day(0));

  // Sales: spread across branches; each branch sells only what it lists and has in stock.
  const salesBranch = (i: number) => {
    const slot = i % 10;
    if (slot < 5) return 'HQ';
    if (slot < 8) return 'NSR';
    if (slot === 8) return 'ALX';
    return 'MTR';
  };
  for (let i = 64; i >= 0; i--) {
    const code = salesBranch(i);
    const ago = Math.floor(i * 0.9);
    if (code === 'MTR' && ago > 38) continue;
    const pool = listed(code);
    const first = pool[i % pool.length];
    const second = pool[(i + 5) % pool.length];
    const lines = [
      { product_id: first.id, quantity: 1 + (i % 3), unit_price: priceFor(code, first) },
    ];
    if (second.id !== first.id)
      lines.push({
        product_id: second.id,
        quantity: 1 + (i % 2),
        unit_price: priceFor(code, second),
      });
    const doc = saveDocument(
      {
        type: 'SALE',
        branch_id: branches[code].id,
        party_id: customerIds[i % 8],
        date: day(ago),
        due_date: day(ago - 14),
        tax_rate: 1400,
        discount: i % 5 === 0 ? 15000 : 0,
        notes: '',
        lines,
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
      branch_id: branches.HQ.id,
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

  // Expenses: branch-specific costs, plus shared costs split equally or by each month's sales.
  const expenseData: [string, string, number, number, string, string | null, string][] = [
    ['إيجار المكتب — الشهر الحالي', 'إيجارات', 12500, 2, 'BRANCH', 'HQ', 'BANK'],
    ['حملة تسويق رقمي', 'تسويق', 3500, 5, 'REVENUE', null, 'BANK'],
    ['اشتراك الإنترنت', 'اتصالات', 850, 8, 'EQUAL', null, 'BANK'],
    ['شحن طلبات العملاء', 'شحن وتوصيل', 1240, 3, 'BRANCH', 'HQ', 'CASH'],
    ['فاتورة الكهرباء', 'مرافق', 1650, 10, 'EQUAL', null, 'CASH'],
    ['صيانة الطابعة', 'صيانة', 600, 15, 'BRANCH', 'NSR', 'CASH'],
    ['إيجار مكتب مرسى مطروح', 'إيجارات', 4200, 35, 'BRANCH', 'MTR', 'BANK'],
    ['إيجار المكتب — الشهر السابق', 'إيجارات', 12500, 32, 'BRANCH', 'HQ', 'BANK'],
    ['خدمات استضافة الموقع', 'اشتراكات', 450, 12, 'EQUAL', null, 'CARD'],
    ['رواتب فريق العمل', 'رواتب', 24000, 6, 'REVENUE', null, 'BANK'],
  ];
  transaction(() => {
    for (const [title, category, amount, ago, allocation, branchCode, method] of expenseData)
      run(
        'INSERT INTO expenses(id,title,category,amount,date,method,notes,created_by,created_at,branch_id,allocation) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
        id(),
        title,
        category,
        amount * 100,
        day(ago),
        method,
        '',
        actor.id,
        now(),
        branchCode ? branches[branchCode].id : null,
        allocation,
      );
    const staffId = id();
    run(
      'INSERT INTO users(id,name,email,password_hash,role,active,created_at) VALUES(?,?,?,?,?,?,?)',
      staffId,
      'سلمى محمود',
      'staff@orqiva.com',
      passwordHash,
      'STAFF',
      1,
      now(),
    );
    run('INSERT INTO user_branches(user_id,branch_id) VALUES(?,?)', staffId, branches.ALX.id);
    audit(
      actor,
      'استيراد البيانات التجريبية',
      'SYSTEM',
      '1',
      'فروع متعددة · ملاك · تحويلات · مصروفات مشتركة',
    );
  });
}

/** Matrouh charges a small premium on A4 paper, as configured on its assortment. */
function priceFor(code: string, product: Product): number {
  if (code === 'MTR' && product.sku === 'OFF-001') return 21000;
  return product.sale_price;
}
