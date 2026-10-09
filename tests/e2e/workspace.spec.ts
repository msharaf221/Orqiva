import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('البريد الإلكتروني').fill('admin@orqiva.com');
  await page.getByLabel('كلمة المرور', { exact: true }).fill('E2ETestPassword2026!');
  await page.getByRole('button', { name: 'الدخول إلى مساحة العمل' }).click();
  await expect(page.getByRole('heading', { name: 'أهلاً، أحمد' })).toBeVisible();
});
test('end-to-end inventory, customer, invoice, payment and expense workflow', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.getByRole('link', { name: 'المنتجات', exact: true }).click();
  await page.getByRole('button', { name: 'إضافة منتج', exact: true }).click();
  await page.getByLabel('اسم المنتج *').fill('شاشة اختبار المتصفح');
  await page.getByLabel('كود المنتج (SKU) *').fill('UI-TEST-001');
  await page.getByLabel('سعر البيع (ج.م) *').fill('1000');
  await page.getByLabel('سعر التكلفة المرجعي (ج.م) *').fill('600');
  await page.getByLabel('الرصيد الافتتاحي للمخزون').fill('20');
  await page.getByRole('dialog').getByRole('button', { name: 'إضافة المنتج', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.getByText('UI-TEST-001', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'العملاء', exact: true }).click();
  await page.getByRole('button', { name: 'إضافة عميل' }).click();
  await page.getByLabel('اسم الحساب أو الشركة *').fill('عميل اختبار المتصفح');
  await page.getByLabel('رقم الهاتف', { exact: true }).fill('01012345678');
  await page.getByRole('button', { name: 'حفظ البيانات' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await page.getByRole('link', { name: 'المبيعات', exact: true }).click();
  await page.getByRole('link', { name: 'فاتورة جديدة' }).click();
  await page
    .getByRole('combobox', { name: 'العميل *', exact: true })
    .selectOption({ label: 'عميل اختبار المتصفح' });
  await page.getByLabel('المنتج', { exact: true }).selectOption({ label: 'شاشة اختبار المتصفح' });
  await page.getByLabel('الكمية', { exact: true }).fill('2');
  await page.getByRole('button', { name: 'حفظ واعتماد الفاتورة' }).click();
  await expect(page.locator('.invoice-paper')).toBeVisible();
  await expect(page.locator('.grand-total')).toContainText('2,280.00');
  await page.getByRole('button', { name: 'تسجيل دفعة', exact: true }).click();
  await page.getByLabel('المبلغ المدفوع (ج.م) *').fill('1000');
  await page.getByRole('button', { name: 'تأكيد تسجيل الدفعة' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.locator('.balance-row')).toContainText('1,280.00');
  await expect(page.getByRole('button', { name: 'إلغاء الفاتورة', exact: true })).toBeDisabled();
  await page.getByRole('link', { name: 'المخزون', exact: true }).click();
  const stockRow = page.getByRole('row').filter({ hasText: 'UI-TEST-001' });
  await expect(stockRow).toContainText('18 قطعة');
  await stockRow.getByRole('button', { name: 'تسوية' }).click();
  await page.getByLabel('الكمية المضافة أو المخصومة *').fill('-1');
  await page.getByLabel('سبب التسوية *').fill('تسوية جرد من المتصفح');
  await page.getByRole('button', { name: 'تسجيل التسوية' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(stockRow).toContainText('17 قطعة');
  await page.getByRole('link', { name: 'المصروفات', exact: true }).click();
  await page.getByRole('button', { name: 'تسجيل مصروف', exact: true }).click();
  await page.getByLabel('وصف المصروف *').fill('مصروف اختبار المتصفح');
  await page.getByRole('combobox', { name: 'الفئة *', exact: true }).fill('شحن');
  await page.getByLabel('المبلغ (ج.م) *', { exact: true }).fill('50');
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'تسجيل المصروف', exact: true })
    .click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.getByText('مصروف اختبار المتصفح', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'التقارير والتحليلات' }).click();
  await expect(page.locator('.stat-card').filter({ hasText: 'صافي الربح التقديري' })).toContainText(
    '750',
  );
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'تصدير التقرير' }).click();
  const exported = await download;
  expect(exported.suggestedFilename()).toContain('.csv');
  const file = await exported.path();
  expect(file).toBeTruthy();
  expect(await readFile(file!, 'utf8')).toContain('صافي الربح التقديري');
  expect(errors).toEqual([]);
});
test('all main screens load without browser exceptions', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  for (const [path, title] of [
    ['/sales', 'فواتير المبيعات'],
    ['/purchases', 'فواتير المشتريات'],
    ['/products', 'المنتجات'],
    ['/inventory', 'إدارة المخزون'],
    ['/customers', 'العملاء'],
    ['/suppliers', 'الموردون'],
    ['/expenses', 'المصروفات'],
    ['/payments', 'المدفوعات والمقبوضات'],
    ['/reports', 'التقارير والتحليلات'],
    ['/settings', 'الإعدادات'],
    ['/activity', 'سجل النشاط'],
  ]) {
    await page.goto(path);
    await expect(page.getByRole('heading', { name: title, exact: true }).first()).toBeVisible();
    await expect(page.locator('.loading-state')).toHaveCount(0);
    await expect(page.getByText('تعذر تحميل البيانات', { exact: true })).toHaveCount(0);
  }
  expect(errors).toEqual([]);
});
test('mobile navigation, global search, settings and logout', async ({ page }) => {
  const product = await page.request.post('/api/products', {
    headers: { 'X-Orqiva-Request': '1' },
    data: {
      name: 'منتج بحث الهاتف',
      sku: 'MOBILE-SEARCH',
      category: 'عام',
      unit: 'قطعة',
      sale_price: 10000,
      cost_price: 5000,
      stock: 5,
      min_stock: 1,
      branch_id: 'main',
    },
  });
  expect(product.status()).toBe(201);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: 'فتح القائمة' })).toBeVisible();
  await page.getByRole('button', { name: 'فتح القائمة' }).click();
  await page.getByRole('link', { name: 'إعدادات النظام' }).click();
  await expect(page.getByRole('heading', { name: 'الإعدادات', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.getByRole('button', { name: /أمان الحساب/ }).click();
  await expect(page.getByLabel('كلمة المرور الحالية *')).toBeVisible();
  await page.keyboard.press('Control+k');
  await expect(page.getByRole('dialog', { name: 'بحث في مساحة العمل' })).toBeVisible();
  await page
    .getByRole('textbox', { name: 'اسم العميل، كود المنتج أو رقم الفاتورة...' })
    .fill('MOBILE-SEARCH');
  await page.getByRole('button').filter({ hasText: 'منتج بحث الهاتف' }).click();
  await expect(page.getByRole('heading', { name: 'المنتجات', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'فتح القائمة' }).click();
  await page.locator('.account').click();
  await page.getByRole('button', { name: 'تسجيل الخروج' }).click();
  await expect(page.getByRole('heading', { name: 'أهلاً بعودتك' })).toBeVisible();
});
