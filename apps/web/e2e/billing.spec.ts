import { expect, test } from '@playwright/test';
import { createRcaViaUi, signUpAndVerify, subscribeTeamViaUi, tokenFromMail, uniqueEmail } from './helpers';

test('free bucket: 3 unpaid RCAs, the 4th is blocked; a TEST MODE unlock removes the watermark and frees a slot', async ({ browser }) => {
  const page = await signUpAndVerify(browser, 'Bea Bucket', uniqueEmail('bucket'));
  const first = await createRcaViaUi(page, { summary: 'Bucket RCA 1' });
  await createRcaViaUi(page, { summary: 'Bucket RCA 2' });
  await createRcaViaUi(page, { summary: 'Bucket RCA 3' });

  await page.goto('/rcas');
  await expect(page.getByTestId('bucket-indicator')).toContainText('3 of 3 unpaid RCAs');

  // The 4th RCA is refused by the server, with a way out.
  await page.goto('/rcas/new');
  await page.fill('#project_name', 'Payment Gateway');
  await page.selectOption('#severity', 'P3');
  await page.selectOption('#environment', 'PROD');
  await page.fill('#incident_start', '2026-09-27T14:05');
  await page.fill('#detected_at', '2026-09-27T14:15');
  await page.fill('#summary', 'Bucket RCA 4');
  await page.getByRole('button', { name: 'Create RCA' }).click();
  await expect(page.getByTestId('blocked-BUCKET_FULL')).toBeVisible();

  // Unlock RCA 1: a failed simulated payment changes nothing, a successful one unlocks it.
  await page.goto(first.rcaPath);
  await expect(page.getByTestId('watermark-bar')).toBeVisible();
  await page.getByRole('button', { name: /Unlock this RCA/ }).click();
  await page.waitForURL(/\/billing\/test-checkout\//);
  await expect(page.getByTestId('test-mode')).toContainText('TEST MODE');
  await expect(page.getByTestId('checkout-summary')).toContainText(first.rcaNumber);
  await page.getByRole('button', { name: 'Simulate failed payment' }).click();
  await expect(page.getByTestId('checkout-status')).toHaveText('FAILED');
  await page.getByRole('button', { name: 'Start over' }).click();
  await expect(page.getByTestId('watermark-bar')).toBeVisible();
  await page.getByRole('button', { name: /Unlock this RCA/ }).click();
  await page.waitForURL(/\/billing\/test-checkout\//);
  await page.getByRole('button', { name: 'Simulate successful payment' }).click();
  await page.waitForURL(/checkout=done/);
  await expect(page.getByTestId('checkout-notice')).toBeVisible();
  await expect(page.getByTestId('paid-badge')).toBeVisible();
  await expect(page.getByTestId('watermark-bar')).toHaveCount(0);

  await page.goto('/rcas');
  await expect(page.getByTestId('bucket-indicator')).toContainText('2 of 3 unpaid RCAs');

  // Both attempts are in the invoice history.
  await page.goto('/settings/billing');
  const history = page.getByTestId('billing-history');
  await expect(history).toContainText('Paid');
  await expect(history).toContainText('Failed');
});

test('Team: inviting needs the plan; after cancellation the owner is warned, invites are blocked and the contributor is read-only', async ({ browser }) => {
  const owner = await signUpAndVerify(browser, 'Tom Team', uniqueEmail('team'));
  const workspace = "Tom Team's workspace";
  const { rcaPath } = await createRcaViaUi(owner, { summary: 'Team billing RCA' });

  const invite = async (email: string) => {
    await owner.goto(rcaPath);
    await owner.getByRole('button', { name: 'Share' }).click();
    const form = owner.getByTestId('invite-form');
    await form.getByLabel('Email').fill(email);
    await form.getByLabel('Role').selectOption('CONTRIBUTOR');
    await form.getByLabel('Team section').selectOption('DEV');
    await form.getByRole('button', { name: 'Send invitation' }).click();
  };

  const devEmail = uniqueEmail('teamdev');
  await invite(devEmail);
  await expect(owner.getByTestId('blocked-SUBSCRIPTION_REQUIRED')).toBeVisible();

  await subscribeTeamViaUi(owner, workspace, 2);
  await invite(devEmail);
  await expect(owner.getByTestId('pending-invitations')).toContainText(devEmail);

  const token = await tokenFromMail(devEmail, 'invitation');
  const dev = await signUpAndVerify(browser, 'Dan Dev', devEmail, undefined, async (page) => {
    await page.goto(`/invite?token=${token}`);
    await page.getByTestId('invite-signup').click();
  });
  await dev.goto(`${rcaPath}/edit?tab=DEV`);
  await expect(dev.locator('#DEV-why-1')).toBeEnabled();

  // Cancel in the TEST MODE billing portal.
  await owner.goto('/settings/billing');
  await owner.getByRole('region', { name: `Billing for ${workspace}` }).getByRole('button', { name: 'Manage billing' }).click();
  await owner.waitForURL(/\/billing\/test-portal\//);
  await expect(owner.getByTestId('test-mode')).toBeVisible();
  await owner.getByRole('button', { name: 'Cancel subscription' }).click();
  await expect(owner.getByTestId('portal-status')).toContainText('CANCELED');

  await owner.goto('/dashboard');
  await expect(owner.getByTestId('billing-alert')).toContainText('canceled');
  await invite(uniqueEmail('another'));
  await expect(owner.getByTestId('blocked-SUBSCRIPTION_REQUIRED')).toBeVisible();

  // The collaborator keeps access, read-only.
  await dev.goto(`${rcaPath}/edit?tab=DEV`);
  await expect(dev.getByTestId('read-only-banner')).toBeVisible();
  await expect(dev.locator('#DEV-why-1')).toBeDisabled();
});
