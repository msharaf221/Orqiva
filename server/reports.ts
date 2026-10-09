import { all, one } from './db';
import { allocateExpenses, type AllocationRow } from './allocation';
import { businessToday } from './clock';
import { cashBalance, listOwners } from './owners';
import { inScope, scopeSql, type Scope } from './scope';
import type {
  Audit,
  BranchResult,
  Branch,
  Dashboard,
  Document,
  GroupOverview,
  Product,
  StockMatrix,
} from '../src/types';

function scalar(sql: string, ...params: (string | number)[]) {
  return one<{ value: number | null }>(sql, ...params)?.value || 0;
}

/** Per-branch sales, cost of goods and expenses (direct plus allocated shares) for a period. */
export function branchResults(from: string, to: string): Map<string, BranchResult> {
  const branches = all<Pick<Branch, 'id' | 'code' | 'name'>>(
    'SELECT id,code,name FROM branches ORDER BY code',
  );
  const sales = new Map(
    all<{ branch_id: string; sales: number }>(
      "SELECT d.branch_id,SUM(d.subtotal-d.discount) sales FROM documents d WHERE d.type='SALE' AND d.status='POSTED' AND d.date BETWEEN ? AND ? GROUP BY d.branch_id",
      from,
      to,
    ).map((r) => [r.branch_id, r.sales]),
  );
  const costs = new Map(
    all<{ branch_id: string; cost: number }>(
      "SELECT d.branch_id,SUM(l.quantity*l.cost_price) cost FROM document_lines l JOIN documents d ON d.id=l.document_id WHERE d.type='SALE' AND d.status='POSTED' AND d.date BETWEEN ? AND ? GROUP BY d.branch_id",
      from,
      to,
    ).map((r) => [r.branch_id, r.cost]),
  );
  const expenses = allocateExpenses(from, to);
  const results = new Map<string, BranchResult>();
  for (const branch of branches) {
    const sold = sales.get(branch.id) ?? 0;
    const cost = costs.get(branch.id) ?? 0;
    const spent = expenses
      .filter((e) => e.branch_id === branch.id)
      .reduce((s, e) => s + e.amount, 0);
    results.set(branch.id, {
      branch_id: branch.id,
      code: branch.code,
      name: branch.name,
      sales: sold,
      cost,
      gross: sold - cost,
      expenses: spent,
      net: sold - cost - spent,
    });
  }
  return results;
}

export function allocationRowsFor(from: string, to: string, scope: Scope): AllocationRow[] {
  return allocateExpenses(from, to).filter((r) => inScope(scope, r.branch_id));
}

export function report(from: string, to: string, scope: Scope, withActivity: boolean): Dashboard {
  const docs = scopeSql('d.branch_id', scope);
  const pays = scopeSql('d.branch_id', scope);
  const clause = "d.status='POSTED' AND d.date BETWEEN ? AND ?";
  const sales = scalar(
    `SELECT SUM(d.subtotal-d.discount) value FROM documents d WHERE d.type='SALE' AND ${clause} AND ${docs.sql}`,
    from,
    to,
    ...docs.params,
  );
  const purchases = scalar(
    `SELECT SUM(d.subtotal-d.discount) value FROM documents d WHERE d.type='PURCHASE' AND ${clause} AND ${docs.sql}`,
    from,
    to,
    ...docs.params,
  );
  const rows = allocationRowsFor(from, to, scope);
  const expenses = rows.reduce((s, r) => s + r.amount, 0);
  const cost = scalar(
    `SELECT SUM(l.quantity*l.cost_price) value FROM document_lines l JOIN documents d ON d.id=l.document_id WHERE d.type='SALE' AND ${clause} AND ${docs.sql}`,
    from,
    to,
    ...docs.params,
  );
  const collected = scalar(
    `SELECT SUM(p.amount) value FROM payments p JOIN documents d ON d.id=p.document_id WHERE d.type='SALE' AND p.date BETWEEN ? AND ? AND ${pays.sql}`,
    from,
    to,
    ...pays.params,
  );
  const disbursed = scalar(
    `SELECT SUM(p.amount) value FROM payments p JOIN documents d ON d.id=p.document_id WHERE d.type='PURCHASE' AND p.date BETWEEN ? AND ? AND ${pays.sql}`,
    from,
    to,
    ...pays.params,
  );
  const fromTime = Date.parse(from);
  const days = Math.round((Date.parse(to) - fromTime) / 86400000) + 1;
  const prevFrom = new Date(fromTime - days * 86400000).toISOString().slice(0, 10);
  const prevTo = new Date(fromTime - 86400000).toISOString().slice(0, 10);
  const previous = scalar(
    `SELECT SUM(d.subtotal-d.discount) value FROM documents d WHERE d.type='SALE' AND d.status='POSTED' AND d.date BETWEEN ? AND ? AND ${docs.sql}`,
    prevFrom,
    prevTo,
    ...docs.params,
  );
  const daily = all<{ date: string; type: string; amount: number }>(
    `SELECT d.date,d.type,SUM(d.subtotal-d.discount) amount FROM documents d WHERE ${clause} AND ${docs.sql} GROUP BY d.date,d.type`,
    from,
    to,
    ...docs.params,
  );
  const series = Array.from({ length: days }, (_, i) => {
    const date = new Date(fromTime + i * 86400000).toISOString().slice(0, 10);
    return {
      date,
      sales: daily.find((d) => d.date === date && d.type === 'SALE')?.amount || 0,
      purchases: daily.find((d) => d.date === date && d.type === 'PURCHASE')?.amount || 0,
    };
  });
  const stock = scopeSql('bs.branch_id', scope);
  const listed = scopeSql('bp.branch_id', scope);
  const expenseByCategory = new Map<string, number>();
  for (const r of rows)
    expenseByCategory.set(r.category, (expenseByCategory.get(r.category) ?? 0) + r.amount);
  return {
    sales,
    purchases,
    expenses,
    grossProfit: sales - cost,
    netProfit: sales - cost - expenses,
    salesGrowth: previous ? Math.round(((sales - previous) / previous) * 100) : 0,
    collected,
    disbursed,
    cashFlow: collected - disbursed - expenses,
    receivables: scalar(
      `SELECT SUM(d.total-d.paid) value FROM documents d WHERE d.type='SALE' AND d.status='POSTED' AND ${docs.sql}`,
      ...docs.params,
    ),
    payables: scalar(
      `SELECT SUM(d.total-d.paid) value FROM documents d WHERE d.type='PURCHASE' AND d.status='POSTED' AND ${docs.sql}`,
      ...docs.params,
    ),
    stockValue: scalar(
      `SELECT SUM(bs.quantity*p.cost_price) value FROM branch_stock bs JOIN products p ON p.id=bs.product_id WHERE ${stock.sql}`,
      ...stock.params,
    ),
    productCount: scalar(
      `SELECT COUNT(DISTINCT bp.product_id) value FROM branch_products bp JOIN products p ON p.id=bp.product_id WHERE bp.active=1 AND p.active=1 AND ${listed.sql}`,
      ...listed.params,
    ),
    customerCount: scalar("SELECT COUNT(*) value FROM parties WHERE type='CUSTOMER' AND active=1"),
    invoiceCount: scalar(
      `SELECT COUNT(*) value FROM documents d WHERE d.type='SALE' AND ${clause} AND ${docs.sql}`,
      from,
      to,
      ...docs.params,
    ),
    overdueCount: scalar(
      `SELECT COUNT(*) value FROM documents d WHERE d.type='SALE' AND d.status='POSTED' AND d.paid<d.total AND d.due_date<? AND ${docs.sql}`,
      businessToday(),
      ...docs.params,
    ),
    series,
    recentDocuments: all<Document>(
      `SELECT d.*,p.name party_name,b.name branch_name FROM documents d JOIN parties p ON p.id=d.party_id JOIN branches b ON b.id=d.branch_id
       WHERE d.type='SALE' AND d.date BETWEEN ? AND ? AND ${docs.sql} ORDER BY d.date DESC,d.created_at DESC LIMIT 5`,
      from,
      to,
      ...docs.params,
    ),
    lowStock: lowStock(scope),
    topProducts: all(
      `SELECT l.name,l.sku,SUM(l.quantity) quantity,SUM(l.total) revenue FROM document_lines l JOIN documents d ON d.id=l.document_id WHERE d.type='SALE' AND ${clause} AND ${docs.sql} GROUP BY l.product_id ORDER BY revenue DESC LIMIT 5`,
      from,
      to,
      ...docs.params,
    ),
    expenseCategories: [...expenseByCategory.entries()]
      .map(([category, amount]) => ({ category, amount }))
      .sort((a, b) => b.amount - a.amount),
    // The activity feed spans the whole company, so only administrators receive it.
    activities: withActivity
      ? all<Audit>('SELECT * FROM audit_logs ORDER BY created_at DESC,rowid DESC LIMIT 8')
      : [],
  };
}

/** Products at or below their reorder level, one row per branch that lists them. */
function lowStock(scope: Scope): Product[] {
  const listed = scopeSql('bp.branch_id', scope);
  return all<Product>(
    `SELECT p.id,p.sku,p.name,p.category,p.unit,p.sale_price,p.cost_price,p.active,p.created_at,
      COALESCE(bp.min_stock,p.min_stock) min_stock,COALESCE(bs.quantity,0) stock,
      b.id branch_id,b.name branch_name
    FROM branch_products bp
    JOIN products p ON p.id=bp.product_id
    JOIN branches b ON b.id=bp.branch_id
    LEFT JOIN branch_stock bs ON bs.branch_id=bp.branch_id AND bs.product_id=bp.product_id
    WHERE bp.active=1 AND p.active=1 AND b.active=1 AND ${listed.sql}
      AND COALESCE(bs.quantity,0) <= COALESCE(bp.min_stock,p.min_stock)
    ORDER BY COALESCE(bs.quantity,0)-COALESCE(bp.min_stock,p.min_stock) LIMIT 20`,
    ...listed.params,
  );
}

/** Group view for the owner: every branch side by side, plus group cash and goods in transit. */
export function groupOverview(from: string, to: string): GroupOverview {
  const results = branchResults(from, to);
  const branches = all<Branch>('SELECT * FROM branches ORDER BY code');
  const receivables = new Map(
    all<{ branch_id: string; value: number }>(
      "SELECT branch_id,SUM(total-paid) value FROM documents WHERE type='SALE' AND status='POSTED' GROUP BY branch_id",
    ).map((r) => [r.branch_id, r.value]),
  );
  const stock = new Map(
    all<{ branch_id: string; units: number; value: number }>(
      'SELECT bs.branch_id,SUM(bs.quantity) units,SUM(bs.quantity*p.cost_price) value FROM branch_stock bs JOIN products p ON p.id=bs.product_id GROUP BY bs.branch_id',
    ).map((r) => [r.branch_id, r]),
  );
  const lowCount = new Map<string, number>();
  for (const row of lowStock({ ids: null })) {
    lowCount.set(row.branch_id!, (lowCount.get(row.branch_id!) ?? 0) + 1);
  }
  const outgoing = new Map(
    all<{ id: string; n: number }>(
      "SELECT from_branch_id id,COUNT(*) n FROM transfers WHERE status='IN_TRANSIT' GROUP BY from_branch_id",
    ).map((r) => [r.id, r.n]),
  );
  const incoming = new Map(
    all<{ id: string; n: number }>(
      "SELECT to_branch_id id,COUNT(*) n FROM transfers WHERE status='IN_TRANSIT' GROUP BY to_branch_id",
    ).map((r) => [r.id, r.n]),
  );
  const invoices = new Map(
    all<{ branch_id: string; n: number }>(
      "SELECT branch_id,COUNT(*) n FROM documents WHERE type='SALE' AND status='POSTED' AND date BETWEEN ? AND ? GROUP BY branch_id",
      from,
      to,
    ).map((r) => [r.branch_id, r.n]),
  );
  const rows = branches.map((b) => {
    const r = results.get(b.id)!;
    return {
      ...r,
      id: b.id,
      active: b.active,
      receivables: receivables.get(b.id) ?? 0,
      stockValue: stock.get(b.id)?.value ?? 0,
      stockUnits: stock.get(b.id)?.units ?? 0,
      lowStock: lowCount.get(b.id) ?? 0,
      inTransitOut: outgoing.get(b.id) ?? 0,
      inTransitIn: incoming.get(b.id) ?? 0,
      invoices: invoices.get(b.id) ?? 0,
    };
  });
  const sum = (
    key: 'sales' | 'cost' | 'gross' | 'expenses' | 'net' | 'receivables' | 'stockValue',
  ) => rows.reduce((s, r) => s + r[key], 0);
  const inTransit = scalar(
    "SELECT SUM(tl.quantity_sent*tl.unit_cost) value FROM transfer_lines tl JOIN transfers t ON t.id=tl.transfer_id WHERE t.status='IN_TRANSIT'",
  );
  const shortage = scalar(
    "SELECT SUM((tl.quantity_sent-tl.quantity_received)*tl.unit_cost) value FROM transfer_lines tl JOIN transfers t ON t.id=tl.transfer_id WHERE t.status='RECEIVED' AND substr(t.received_at,1,10) BETWEEN ? AND ?",
    from,
    to,
  );
  return {
    from,
    to,
    branches: rows,
    totals: {
      sales: sum('sales'),
      gross: sum('gross'),
      expenses: sum('expenses'),
      net: sum('net'),
      receivables: sum('receivables'),
      stockValue: sum('stockValue'),
      inTransitValue: inTransit,
      shortageValue: shortage,
    },
    cashAvailable: cashBalance(),
    owners: listOwners(),
  };
}

export function stockMatrix(scope: Scope): StockMatrix {
  const branches = all<{ id: string; code: string; name: string; active: number }>(
    `SELECT id,code,name,active FROM branches WHERE ${scopeSql('id', scope).sql} ORDER BY code`,
    ...scopeSql('id', scope).params,
  );
  const visible = new Set(branches.map((b) => b.id));
  const cells = all<{ product_id: string; branch_id: string; quantity: number }>(
    'SELECT product_id,branch_id,quantity FROM branch_stock WHERE quantity>0',
  );
  const products = all<{ id: string; sku: string; name: string; unit: string; cost_price: number }>(
    'SELECT id,sku,name,unit,cost_price FROM products WHERE active=1 ORDER BY name',
  );
  return {
    branches,
    rows: products.map((p) => {
      const byBranch: Record<string, number> = {};
      for (const c of cells)
        if (c.product_id === p.id && visible.has(c.branch_id)) byBranch[c.branch_id] = c.quantity;
      const total = Object.values(byBranch).reduce((s, q) => s + q, 0);
      return {
        product_id: p.id,
        sku: p.sku,
        name: p.name,
        unit: p.unit,
        cost_price: p.cost_price,
        total,
        by_branch: byBranch,
      };
    }),
  };
}
