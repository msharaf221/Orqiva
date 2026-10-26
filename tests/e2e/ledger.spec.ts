import { test, expect } from '@playwright/test';

/**
 * Phase 4.2 UX coverage for the General Ledger:
 *  - posting a sale writes a balanced journal entry that appears in the journal tab;
 *  - the trial balance renders and reconciles debit against credit.
 */
test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('البريد الإلكتروني').fill('admin@orqiva.com');
  await page.getByLabel('كلمة المرور', { exact: true }).fill('E2ETestPassword2026!');
  await page.getByRole('button', { name: 'الدخول إلى مساحة العمل' }).click();
  await expect(page.getByRole('heading', { name: 'أهلاً، أحمد' })).toBeVisible({
    timeout: 10000,
  });
});

test('posts a sale to the ledger and shows it in the journal', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  const headers = { 'X-Orqiva-Request': '1' };
  const stamp = Date.now();
  const today = new Date().toISOString().slice(0, 10);

  const supplier = await page.request.post('/api/parties', {
    headers,
    data: {
      type: 'SUPPLIER',
      name: 'مورد دفتر الأستاذ',
      email: '',
      phone: '',
      address: '',
      tax_number: '',
      notes: '',
    },
  });
  const customer = await page.request.post('/api/parties', {
    headers,
    data: {
      type: 'CUSTOMER',
      name: 'عميل دفتر الأستاذ',
      email: '',
      phone: '',
      address: '',
      tax_number: '',
      notes: '',
    },
  });
  const product = await page.request.post('/api/products', {
    headers,
    data: {
      name: 'منتج دفتر الأستاذ',
      sku: 'GL-E2E-' + stamp,
      category: 'عام',
      unit: 'قطعة',
      sale_price: 10000,
      cost_price: 6000,
      min_stock: 0,
    },
  });
  expect(product.status()).toBe(201);
  const productId = (await product.json()).id;

  // Buy stock so the sale can be posted, then sell it.
  const po = await page.request.post('/api/documents', {
    headers,
    data: {
      type: 'PURCHASE',
      branch_id: 'main',
      party_id: (await supplier.json()).id,
      date: today,
      due_date: today,
      tax_rate: 0,
      discount: 0,
      notes: '',
      lines: [{ product_id: productId, quantity: 10, unit_price: 6000 }],
    },
  });
  expect(po.status()).toBe(201);
  const poId = (await po.json()).id;
  await page.request.post(`/api/documents/${poId}/post`, { headers, data: {} });

  const sale = await page.request.post('/api/documents', {
    headers,
    data: {
      type: 'SALE',
      branch_id: 'main',
      party_id: (await customer.json()).id,
      date: today,
      due_date: today,
      tax_rate: 0,
      discount: 0,
      notes: '',
      lines: [{ product_id: productId, quantity: 2, unit_price: 10000 }],
    },
  });
  expect(sale.status()).toBe(201);
  const saleBody = await sale.json();
  const saleNumber = saleBody.number;
  const saleId = saleBody.id;
  await page.request.post(`/api/documents/${saleId}/post`, { headers, data: {} });

  await page.goto('/ledger');
  await expect(page.getByRole('heading', { name: 'دفتر الأستاذ' })).toBeVisible();

  // The sales journal entry shows in the default (current month) window.
  const row = page.getByRole('row').filter({ hasText: saleNumber });
  await expect(row).toBeVisible();
  await row.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('إيرادات المبيعات')).toBeVisible();
  await expect(dialog.getByText('تكلفة المبيعات')).toBeVisible();
  await dialog.getByRole('button', { name: 'إغلاق', exact: true }).click();

  // Cancel both documents so this spec does not leak profit into the shared report totals
  // that workspace.spec.ts asserts on (e2e specs share one database).
  await page.request.post(`/api/documents/${saleId}/cancel`, { headers, data: {} });
  await page.request.post(`/api/documents/${poId}/cancel`, { headers, data: {} });

  expect(errors).toEqual([]);
});

test('renders a balanced trial balance', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/ledger');
  await page.getByRole('button').filter({ hasText: 'ميزان المراجعة' }).click();
  await expect(page.getByText(/ميزان المراجعة متوازن/)).toBeVisible();
  expect(errors).toEqual([]);
});
