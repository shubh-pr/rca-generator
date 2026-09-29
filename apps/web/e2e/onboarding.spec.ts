import { expect, test } from '@playwright/test';
import { signUpAndVerify, uniqueEmail } from './helpers';

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
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Root cause analysis that teams actually finish/ })).toBeVisible();
  for (const [link, heading] of [['Terms of Service', 'Terms of Service'], ['Privacy Policy', 'Privacy Policy'], ['Contact', 'Contact']]) {
    await page.getByRole('contentinfo').getByRole('link', { name: link }).click();
    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
    await expect(page.locator('[data-replace-before-launch]').first()).toBeVisible();
  }
});
