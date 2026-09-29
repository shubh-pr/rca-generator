import { expect, test } from '@playwright/test';
import { createRcaViaUi, fillSection, readDownload, signUpAndVerify, STRONG_PASSWORD, tokenFromMail, uniqueEmail } from './helpers';

test('new visitor: sign up, verify email, create and complete an RCA alone, export PDF and DOCX', async ({ browser }) => {
  const email = uniqueEmail('solo');
  const page = await signUpAndVerify(browser, 'Sam Solo', email);
  await expect(page.getByTestId('verify-banner')).toHaveCount(0);

  const { rcaPath, rcaNumber } = await createRcaViaUi(page);
  expect(rcaNumber).toBe('RCA-2026-0001'); // numbering is per workspace
  for (const team of ['DEV', 'QA', 'PROD'] as const) await fillSection(page, rcaPath, team, 'Sam Solo');
  await page.goto(rcaPath);
  await page.getByRole('button', { name: 'Submit for review' }).click();
  await expect(page.getByTestId('status-chip')).toHaveText('In review');
  await page.goto(`${rcaPath}/edit?tab=closing`);
  for (const role of ['DEV_LEAD', 'QA_LEAD', 'PROD_LEAD', 'PROJECT_OWNER', 'RCA_LEAD']) {
    const row = page.getByTestId(`signoff-${role}`);
    await row.getByRole('button', { name: 'Sign' }).click();
    await expect(row.getByText('Signed', { exact: true })).toBeVisible();
  }
  await page.getByRole('button', { name: 'Close RCA' }).click();
  await expect(page.getByTestId('status-chip')).toHaveText('Closed');

  await page.goto(rcaPath);
  const [pdf] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'PDF' }).click()]);
  expect((await readDownload(pdf)).subarray(0, 5).toString()).toBe('%PDF-');
  const [docx] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Word' }).click()]);
  expect((await readDownload(docx)).subarray(0, 2).toString()).toBe('PK');

  // The session survives a reload (refresh cookie), and logging out ends it.
  await page.reload();
  await expect(page.getByTestId('current-user')).toHaveText('Sam Solo');
  await page.getByRole('button', { name: 'Log out' }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/login\?next=/);
});

test('unverified users can look around but must verify before creating an RCA', async ({ page }) => {
  const email = uniqueEmail('unverified');
  await page.goto('/signup');
  await page.fill('#name', 'Una Verified');
  await page.fill('#email', email);
  await page.fill('#password', STRONG_PASSWORD);
  await page.getByTestId('accept-terms').check();
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByTestId('go-login').click();
  await page.fill('#email', email);
  await page.fill('#password', STRONG_PASSWORD);
  await page.click('button[type=submit]');
  await expect(page.getByTestId('verify-banner')).toBeVisible();
  await page.goto('/rcas/new');
  await expect(page.getByRole('heading', { name: 'Verify your email first' })).toBeVisible();
});

test('forgot password: reset through the emailed link, then log in with the new password', async ({ browser }) => {
  const email = uniqueEmail('forgetful');
  const first = await signUpAndVerify(browser, 'Fran Forgetful', email);
  await first.context().close();

  const page = await browser.newPage();
  await page.goto('/login');
  await page.getByRole('link', { name: 'Forgot your password?' }).click();
  await page.fill('#email', email);
  await page.getByRole('button', { name: 'Send reset link' }).click();
  await expect(page.getByText('If an account exists for this email')).toBeVisible();
  const token = await tokenFromMail(email, 'reset-password');
  await page.goto(`/reset-password?token=${token}`);
  const next = 'Brand-New-Harbour-77';
  await page.fill('#password', next);
  await page.fill('#confirm', next);
  await page.getByRole('button', { name: 'Set new password' }).click();
  await expect(page.getByText('Password changed')).toBeVisible();
  await page.fill('#email', email);
  await page.fill('#password', STRONG_PASSWORD);
  await page.click('button[type=submit]');
  await expect(page.getByRole('alert')).toContainText('Invalid email or password');
  await page.fill('#password', next);
  await page.click('button[type=submit]');
  await expect(page.getByTestId('current-user')).toHaveText('Fran Forgetful');
});
