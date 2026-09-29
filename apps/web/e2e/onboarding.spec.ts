import { expect, test } from '@playwright/test';
import { readDownload, signUpAndVerify, STRONG_PASSWORD, uniqueEmail } from './helpers';

test('first login shows the welcome screen; "Create a sample RCA" opens a labelled example that can be deleted', async ({ browser }) => {
  const page = await signUpAndVerify(browser, 'Olive Onboard', uniqueEmail('onboard'));
  await expect(page.getByTestId('welcome')).toBeVisible();
  await page.getByRole('button', { name: /Create a sample RCA/ }).click();
  await expect(page.getByTestId('rca-view')).toBeVisible();
  await expect(page.getByText('Sample RCA', { exact: true })).toBeVisible();
  await expect(page.getByTestId('status-chip')).toHaveText('Closed');

  // Welcome is shown once.
  await page.goto('/dashboard');
  await expect(page.getByTestId('kpi-Closed this month')).toBeVisible();
  await page.goto('/rcas');
  await expect(page.getByTestId('rca-table').getByText('Sample')).toBeVisible();
  await page.getByTestId('rca-table').getByRole('link').first().click();
  await page.getByRole('button', { name: 'Delete' }).click();
  await expect(page).toHaveURL(/\/rcas$/);
  await expect(page.getByText('No RCAs yet. Create your first RCA to get started.')).toBeVisible();
});

test('empty dashboard, settings: profile, sessions and log out of all devices', async ({ browser }) => {
  const page = await signUpAndVerify(browser, 'Eli Empty', uniqueEmail('empty'));
  await page.getByRole('button', { name: 'Skip for now' }).click();
  await expect(page.getByTestId('dashboard-empty')).toBeVisible();
  await page.getByRole('link', { name: 'Account settings' }).click();
  await page.fill('#profile-name', 'Eli Renamed');
  await page.getByRole('button', { name: 'Save profile' }).click();
  await expect(page.getByText('Profile saved.')).toBeVisible();
  await expect(page.getByTestId('current-user')).toHaveText('Eli Renamed');
  await expect(page.getByTestId('sessions').getByText('This device')).toBeVisible();
  await page.getByRole('button', { name: 'Log out of all devices' }).click();
  await expect(page).toHaveURL(/\/login/);
});

test('public pages: landing, terms, privacy and contact are reachable without an account', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Root cause analysis that teams actually finish/ })).toBeVisible();
  const footer = page.getByRole('contentinfo');
  for (const [path, heading] of [['/terms', 'Terms of Service'], ['/privacy', 'Privacy Policy'], ['/contact', 'Contact']]) {
    await expect(footer.getByRole('link', { name: heading })).toHaveAttribute('href', path);
  }
  for (const [path, heading] of [['/terms', 'Terms of Service'], ['/privacy', 'Privacy Policy'], ['/contact', 'Contact']]) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
    await expect(page.locator('[data-replace-before-launch]').first()).toBeVisible();
  }
});

test('export my data and delete my account; the account cannot log in afterwards', async ({ browser }) => {
  const email = uniqueEmail('leaver');
  const page = await signUpAndVerify(browser, 'Lee Leaver', email);
  await page.getByRole('button', { name: /Create a sample RCA/ }).click();
  await expect(page.getByTestId('rca-view')).toBeVisible();
  await page.goto('/settings');
  await expect(page.getByTestId('security-log')).toContainText('Logged in');
  const [zip] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download my data' }).click()]);
  expect(zip.suggestedFilename()).toMatch(/^rca-dashboard-export-.*\.zip$/);
  expect((await readDownload(zip)).subarray(0, 2).toString()).toBe('PK');

  const section = page.getByTestId('delete-account');
  await section.getByLabel('Current password').fill(STRONG_PASSWORD);
  await section.getByLabel('Type DELETE to confirm').fill('DELETE');
  await section.getByRole('button', { name: 'Delete my account' }).click();
  await expect(page.getByTestId('deleted-notice')).toBeVisible();

  await page.goto('/login');
  await page.fill('#email', email);
  await page.fill('#password', STRONG_PASSWORD);
  await page.click('button[type=submit]');
  await expect(page.getByRole('alert')).toContainText('Invalid email or password');
});
