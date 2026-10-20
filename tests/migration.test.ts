import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('upgrading a single-warehouse installation', () => {
  it('moves every existing record into the HQ branch without losing or renumbering anything', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'orqiva-upgrade-'));
    const path = join(dir, 'legacy.db');
    const migrations = 'database/migrations/';
    const legacy = new DatabaseSync(path);
    legacy.exec('PRAGMA foreign_keys=ON');
    legacy.exec(readFileSync(join(migrations, '001_initial.sql'), 'utf8'));
    legacy.exec(readFileSync(join(migrations, '002_payment_idempotency.sql'), 'utf8'));
    legacy.exec('CREATE TABLE schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
    legacy.exec(
      "INSERT INTO schema_migrations VALUES('001_initial.sql','2026-01-01T00:00:00.000Z'),('002_payment_idempotency.sql','2026-01-01T00:00:00.000Z')",
    );
    legacy.exec(`
      INSERT INTO users VALUES('u-admin','مدير','admin@legacy.local','hash','ADMIN',1,'2026-01-01T00:00:00.000Z');
      INSERT INTO users VALUES('u-staff','موظف','staff@legacy.local','hash','STAFF',1,'2026-01-01T00:00:00.000Z');
      INSERT INTO parties VALUES('c1','CUSTOMER','عميل','','','','','',1,'2026-01-01T00:00:00.000Z');
      INSERT INTO products VALUES('p1','SKU-L1','منتج','عام','قطعة',10000,6000,7,3,1,'2026-01-01T00:00:00.000Z');
      INSERT INTO sequences VALUES('INV-2026',1);
      INSERT INTO documents(id,number,type,status,party_id,date,due_date,subtotal,discount,tax_rate,tax,total,paid,notes,created_by,created_at)
        VALUES('d1','INV-2026-0001','SALE','POSTED','c1','2026-03-01','2026-03-15',20000,0,1400,2800,22800,5000,'','u-admin','2026-03-01T00:00:00.000Z');
      INSERT INTO document_lines VALUES('l1','d1','p1','منتج','SKU-L1',2,10000,6000,20000);
      INSERT INTO payments VALUES('pay1','d1',5000,'CASH','2026-03-02','','u-admin','2026-03-02T00:00:00.000Z',NULL);
      INSERT INTO stock_movements VALUES('m1','p1','d1',-2,'بيع','u-admin','2026-03-01T00:00:00.000Z');
      INSERT INTO expenses VALUES('e1','إيجار','إيجارات',50000,'2026-03-01','BANK','','u-admin','2026-03-01T00:00:00.000Z');
    `);
    legacy.close();

    // The application opens the database named by DATABASE_PATH; point it at the legacy file.
    process.env.DATABASE_PATH = path;
    const { all, one, migrate } = await import('../server/db');
    migrate();
    expect(
      all<{ name: string }>('SELECT name FROM schema_migrations ORDER BY name').map((r) => r.name),
    ).toEqual([
      '001_initial.sql',
      '002_payment_idempotency.sql',
      '003_multi_branch.sql',
      '004_weighted_avg_cost.sql',
      '005_returns_and_notes.sql',
      '006_cash_accounts.sql',
      '007_granular_rbac.sql',
      '008_pos_and_treasury.sql',
      '009_pos_multitender_and_proofs.sql',
      '010_rbac_cleanup.sql',
      '011_eta_einvoicing.sql',
    ]);
    expect(one("SELECT role_id FROM user_roles WHERE user_id='u-admin'")).toEqual({
      role_id: 'role_admin',
    });
    expect(one("SELECT role_id FROM user_roles WHERE user_id='u-staff'")).toEqual({
      role_id: 'role_sales',
    });
    expect(one("SELECT code FROM branches WHERE id='main'")).toEqual({ code: 'HQ' });
    expect(
      one("SELECT quantity FROM branch_stock WHERE branch_id='main' AND product_id='p1'"),
    ).toEqual({
      quantity: 7,
    });
    expect(one("SELECT branch_id,number FROM documents WHERE id='d1'")).toEqual({
      branch_id: 'main',
      number: 'INV-2026-0001',
    });
    expect(one("SELECT branch_id FROM stock_movements WHERE id='m1'")).toEqual({
      branch_id: 'main',
    });
    expect(one("SELECT branch_id,allocation FROM expenses WHERE id='e1'")).toEqual({
      branch_id: 'main',
      allocation: 'BRANCH',
    });
    expect(all('SELECT user_id,branch_id FROM user_branches ORDER BY user_id')).toEqual([
      { user_id: 'u-admin', branch_id: 'main' },
      { user_id: 'u-staff', branch_id: 'main' },
    ]);
    expect(one("SELECT share_bps FROM owners WHERE id='owner-main'")).toEqual({ share_bps: 10000 });
    expect(all<{ name: string }>('PRAGMA table_info(products)').map((c) => c.name)).not.toContain(
      'stock',
    );
    expect(all('PRAGMA foreign_key_check')).toHaveLength(0);
    expect(one<{ integrity_check: string }>('PRAGMA integrity_check')?.integrity_check).toBe('ok');

    // The upgraded database keeps working: a new sale draws from the HQ branch stock.
    const { saveDocument, postDocument } = await import('../server/service');
    const actor = { id: 'u-admin', name: 'مدير', role: 'ADMIN' as const };
    const sale = saveDocument(
      {
        type: 'SALE',
        branch_id: 'main',
        party_id: 'c1',
        date: '2026-03-10',
        due_date: '2026-03-20',
        discount: 0,
        tax_rate: 0,
        notes: '',
        lines: [{ product_id: 'p1', quantity: 1, unit_price: 10000 }],
      },
      actor,
    );
    expect(sale.number).toBe('INV-HQ-2026-0001');
    postDocument(sale.id, actor);
    expect(
      one("SELECT quantity FROM branch_stock WHERE branch_id='main' AND product_id='p1'"),
    ).toEqual({
      quantity: 6,
    });
    rmSync(dir, { recursive: true, force: true });
  });
});
