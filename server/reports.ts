import { all, one } from './db';
import type { Dashboard, Document, Product, Audit } from '../src/types';
function scalar(sql: string, ...params: string[]) {
  return one<{ value: number | null }>(sql, ...params)?.value || 0;
}
export function report(from: string, to: string): Dashboard {
  const clause = "status='POSTED' AND date BETWEEN ? AND ?";
  const sales = scalar(
    `SELECT SUM(subtotal-discount) value FROM documents WHERE type='SALE' AND ${clause}`,
    from,
    to,
  );
  const purchases = scalar(
    `SELECT SUM(subtotal-discount) value FROM documents WHERE type='PURCHASE' AND ${clause}`,
    from,
    to,
  );
  const expenses = scalar(
    'SELECT SUM(amount) value FROM expenses WHERE date BETWEEN ? AND ?',
    from,
    to,
  );
  const cost = scalar(
    `SELECT SUM(l.quantity*l.cost_price) value FROM document_lines l JOIN documents d ON d.id=l.document_id WHERE d.type='SALE' AND d.${clause}`,
    from,
    to,
  );
  const collected = scalar(
    "SELECT SUM(p.amount) value FROM payments p JOIN documents d ON d.id=p.document_id WHERE d.type='SALE' AND p.date BETWEEN ? AND ?",
    from,
    to,
  );
  const disbursed = scalar(
    "SELECT SUM(p.amount) value FROM payments p JOIN documents d ON d.id=p.document_id WHERE d.type='PURCHASE' AND p.date BETWEEN ? AND ?",
    from,
    to,
  );
  const fromTime = Date.parse(from);
  const days = Math.round((Date.parse(to) - fromTime) / 86400000) + 1;
  const prevFrom = new Date(fromTime - days * 86400000).toISOString().slice(0, 10);
  const prevTo = new Date(fromTime - 86400000).toISOString().slice(0, 10);
  const previous = scalar(
    `SELECT SUM(subtotal-discount) value FROM documents WHERE type='SALE' AND ${clause}`,
    prevFrom,
    prevTo,
  );
  const daily = all<{ date: string; type: string; amount: number }>(
    `SELECT date,type,SUM(subtotal-discount) amount FROM documents WHERE ${clause} GROUP BY date,type`,
    from,
    to,
  );
  const series = Array.from({ length: days }, (_, i) => {
    const date = new Date(fromTime + i * 86400000).toISOString().slice(0, 10);
    return {
      date,
      sales: daily.find((d) => d.date === date && d.type === 'SALE')?.amount || 0,
      purchases: daily.find((d) => d.date === date && d.type === 'PURCHASE')?.amount || 0,
    };
  });
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
      "SELECT SUM(total-paid) value FROM documents WHERE type='SALE' AND status='POSTED'",
    ),
    payables: scalar(
      "SELECT SUM(total-paid) value FROM documents WHERE type='PURCHASE' AND status='POSTED'",
    ),
    stockValue: scalar('SELECT SUM(stock*cost_price) value FROM products'),
    productCount: scalar('SELECT COUNT(*) value FROM products WHERE active=1'),
    customerCount: scalar("SELECT COUNT(*) value FROM parties WHERE type='CUSTOMER' AND active=1"),
    invoiceCount: scalar(
      `SELECT COUNT(*) value FROM documents WHERE type='SALE' AND ${clause}`,
      from,
      to,
    ),
    overdueCount: scalar(
      "SELECT COUNT(*) value FROM documents WHERE type='SALE' AND status='POSTED' AND paid<total AND due_date<?",
      new Date().toISOString().slice(0, 10),
    ),
    series,
    recentDocuments: all<Document>(
      `SELECT d.*,p.name party_name FROM documents d JOIN parties p ON p.id=d.party_id WHERE d.type='SALE' AND d.date BETWEEN ? AND ? ORDER BY d.date DESC,d.created_at DESC LIMIT 5`,
      from,
      to,
    ),
    lowStock: all<Product>(
      'SELECT * FROM products WHERE active=1 AND stock<=min_stock ORDER BY stock LIMIT 20',
    ),
    topProducts: all(
      `SELECT l.name,l.sku,SUM(l.quantity) quantity,SUM(l.total) revenue FROM document_lines l JOIN documents d ON d.id=l.document_id WHERE d.type='SALE' AND d.${clause} GROUP BY l.product_id ORDER BY revenue DESC LIMIT 5`,
      from,
      to,
    ),
    expenseCategories: all(
      'SELECT category,SUM(amount) amount FROM expenses WHERE date BETWEEN ? AND ? GROUP BY category ORDER BY amount DESC',
      from,
      to,
    ),
    activities: all<Audit>('SELECT * FROM audit_logs ORDER BY created_at DESC,rowid DESC LIMIT 8'),
  };
}
