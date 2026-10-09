import { test, expect } from '@playwright/test';
import { startEmbeddedPreview } from './preview-harness';

test.use({ ignoreHTTPSErrors: true });

const credentials = { email: 'admin@orqiva.com', password: 'E2ETestPassword2026!' };

test('login persists in a cross-site HTTPS iframe with third-party cookie restrictions', async ({
  page,
  context,
}) => {
  const harness = await startEmbeddedPreview();
  try {
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.setCookieControls', { enableThirdPartyCookieRestriction: true });
    await page.goto(harness.shell);
    const app = page.frameLocator('iframe');
    await app.getByLabel('البريد الإلكتروني').fill(credentials.email);
    await app.getByLabel('كلمة المرور', { exact: true }).fill(credentials.password);
    await app.getByRole('button', { name: 'الدخول إلى مساحة العمل' }).click();
    await expect(app.getByRole('heading', { name: 'أهلاً، أحمد' })).toBeVisible();
    await expect(app.locator('.stat-card')).toHaveCount(4);
    const cookie = (await context.cookies()).find((c) => c.name === 'orqiva_session');
    expect(cookie).toMatchObject({
      secure: true,
      httpOnly: true,
      sameSite: 'None',
    });
    expect(cookie?.partitionKey).toBe('https://127.0.0.1');
    await page.reload();
    await expect(app.getByRole('heading', { name: 'أهلاً، أحمد' })).toBeVisible();
    await app.getByRole('link', { name: 'المنتجات', exact: true }).click();
    await expect(app.getByRole('heading', { name: 'المنتجات', exact: true })).toBeVisible();
    await expect(app.locator('.toast.error')).toHaveCount(0);
    await app.locator('.account').click();
    await app.getByRole('button', { name: 'تسجيل الخروج' }).click();
    await expect(app.getByRole('heading', { name: 'أهلاً بعودتك' })).toBeVisible();
    expect((await context.cookies()).some((c) => c.name === 'orqiva_session')).toBe(false);
  } finally {
    await harness.stop();
  }
});

test('blocked cookies produce one actionable error instead of loading protected screens', async ({
  page,
}) => {
  const protectedRequests: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/api/company') || r.url().includes('/api/dashboard'))
      protectedRequests.push(r.url());
  });
  await page.route('**/api/auth/login', async (route) => {
    const response = await fetch('http://127.0.0.1:4173/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Orqiva-Request': '1' },
      body: route.request().postData(),
    });
    // Simulate a browser policy discarding the session cookie.
    await route.fulfill({
      status: response.status,
      contentType: 'application/json',
      body: await response.text(),
    });
  });
  await page.goto('/');
  await page.getByLabel('البريد الإلكتروني').fill(credentials.email);
  await page.getByLabel('كلمة المرور', { exact: true }).fill(credentials.password);
  await page.getByRole('button', { name: 'الدخول إلى مساحة العمل' }).click();
  await expect(page.locator('.toast.error')).toHaveCount(1);
  await expect(page.locator('.toast.error')).toContainText('تعذر حفظ جلسة الدخول');
  await expect(page.getByRole('heading', { name: 'أهلاً بعودتك' })).toBeVisible();
  expect(protectedRequests).toEqual([]);
});

test('parallel expired requests show only one session-expiry notification', async ({ page }) => {
  await page.route('**/api/company', (route) =>
    route.fulfill({ status: 401, json: { error: 'Unauthorized' } }),
  );
  await page.route('**/api/dashboard?*', (route) =>
    route.fulfill({ status: 401, json: { error: 'Unauthorized' } }),
  );
  await page.goto('/');
  await page.getByLabel('البريد الإلكتروني').fill(credentials.email);
  await page.getByLabel('كلمة المرور', { exact: true }).fill(credentials.password);
  await page.getByRole('button', { name: 'الدخول إلى مساحة العمل' }).click();
  await expect(
    page.getByText('انتهت جلستك. يرجى تسجيل الدخول مجدداً.', { exact: true }),
  ).toHaveCount(1);
  await expect(page.getByRole('heading', { name: 'أهلاً بعودتك' })).toBeVisible();
  await expect(page.locator('.toast.error')).toHaveCount(1);
});
