import { test, expect } from '@playwright/test';

/**
 * Phase 4 UX coverage for the POS edge cases added in this phase:
 *  - parking a cart, listing it, and resuming it back into the cart;
 *  - the ETA e-invoicing settings panel rendering without exceptions.
 */
test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('البريد الإلكتروني').fill('admin@orqiva.com');
  await page.getByLabel('كلمة المرور', { exact: true }).fill('E2ETestPassword2026!');
  await page.getByRole('button', { name: 'الدخول إلى مساحة العمل' }).click();
  await expect(page.getByRole('heading', { name: 'أهلاً، أحمد' })).toBeVisible();
});

test('parks a POS cart and resumes it later', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  const sku = 'PARK-E2E-' + Date.now();
  const product = await page.request.post('/api/products', {
    headers: { 'X-Orqiva-Request': '1' },
    data: {
      name: 'منتج تعليق السلة',
      sku,
      category: 'عام',
      unit: 'قطعة',
      sale_price: 10000,
      cost_price: 5000,
      stock: 10,
      min_stock: 1,
      branch_id: 'main',
    },
  });
  expect(product.status()).toBe(201);

  // Ensure a shift is open for the branch.
  const shift = await page.request.get('/api/pos/shifts/current?branch_id=main', {
    headers: { 'X-Orqiva-Request': '1' },
  });
  if (shift.status() === 200 && !(await shift.json())) {
    const opened = await page.request.post('/api/pos/shifts/open', {
      headers: { 'X-Orqiva-Request': '1' },
      data: { branch_id: 'main', opening_cash: 50000 },
    });
    expect(opened.status()).toBe(201);
  }

  await page.goto('/pos');
  await expect(page.getByPlaceholder(/ابحث بالاسم أو امسح الباركود/)).toBeVisible();

  // Add the product to the cart, then park it.
  await page.getByRole('button').filter({ hasText: 'منتج تعليق السلة' }).first().click();
  await expect(page.getByRole('button', { name: 'تعليق', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'تعليق', exact: true }).click();
  await expect(page.getByText(/تم تعليق السلة/)).toBeVisible();

  // It appears under the parked list and can be resumed.
  await page.getByRole('button', { name: /المعلّقة/ }).first().click();
  const dialog = page.getByRole('dialog').filter({ hasText: 'السلات المعلّقة' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'استئناف' }).first().click();
  await expect(page.getByText(/تم استئناف السلة/)).toBeVisible();

  expect(errors).toEqual([]);
});

test('shows the ETA e-invoicing panel in settings without exceptions', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/settings');
  await page.getByRole('button', { name: /الفاتورة الإلكترونية/ }).click();
  await expect(
    page.getByRole('heading', { name: 'الفاتورة الإلكترونية (هيئة الضرائب)' }),
  ).toBeVisible();
  await expect(page.getByText(/الوضع التجريبي/)).toBeVisible();
  expect(errors).toEqual([]);
});
