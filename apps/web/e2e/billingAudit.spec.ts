/**
 * Phase 8 audit journeys (docs/PHASE8_AUDIT.md, section 3). Everything runs through the UI and the
 * mock provider's TEST MODE checkout and portal buttons; nothing is set up through the API.
 */
import { expect, test, type Browser, type Page } from '@playwright/test';
import JSZip from 'jszip';
import { createRcaViaUi, readDownload, signUpAndVerify, subscribeTeamViaUi, tokenFromMail, uniqueEmail } from './helpers';

const WATERMARK = 'FREE PLAN';

/**
 * Does this RCA's export carry the billing watermark? The print page (the PDF's source) is checked;
 * on the free plan Word is not offered at all (a .docx watermark could be deleted), so a watermarked
 * RCA must show "Unlock to get Word", and an unwatermarked one must download a clean Word file.
 */
async function exportWatermarked(page: Page, rcaPath: string): Promise<boolean> {
  await page.goto(`${rcaPath}/print`);
  const frame = page.frameLocator('iframe[title="RCA print view"]');
  await expect(frame.locator('h1')).toHaveText('Root Cause Analysis (RCA)');
  const inPrint = (await frame.locator('[data-billing-watermark]').count()) > 0;

  await page.goto(rcaPath);
  await expect(page.getByRole('button', { name: 'PDF' })).toBeVisible();
  const wordLocked = (await page.getByTestId('word-locked').count()) > 0;
  expect(wordLocked, 'Word must be locked exactly when the print/PDF is watermarked').toBe(inPrint);
  if (!wordLocked) {
    const [docx] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Word', exact: true }).click()]);
    const zip = await JSZip.loadAsync(await readDownload(docx));
    const headers = await Promise.all(Object.keys(zip.files).filter((f) => /word\/header\d*\.xml/.test(f)).map((f) => zip.file(f)!.async('string')));
    expect(headers.join('').includes(WATERMARK), 'a Word file must never carry the free-plan watermark').toBe(false);
  }
  return inPrint;
}

async function bucketText(page: Page) {
  await page.goto('/rcas');
  const chip = page.getByTestId('bucket-indicator').or(page.getByTestId('plan-chip'));
  await expect(chip).toBeVisible();
  return chip.textContent();
}

/** Submit the New RCA form; returns without waiting for success so blocked states can be checked. */
async function submitNewRca(page: Page, summary: string) {
  await page.goto('/rcas/new');
  await page.fill('#project_name', 'Payment Gateway');
  await page.selectOption('#severity', 'P3');
  await page.selectOption('#environment', 'PROD');
  await page.fill('#incident_start', '2026-09-27T14:05');
  await page.fill('#detected_at', '2026-09-27T14:15');
  await page.fill('#summary', summary);
  await page.getByRole('button', { name: 'Create RCA' }).click();
}

async function inviteContributor(owner: Page, rcaPath: string, email: string) {
  await owner.goto(rcaPath);
  await owner.getByRole('button', { name: 'Share' }).click();
  const form = owner.getByTestId('invite-form');
  await form.getByLabel('Email').fill(email);
  await form.getByLabel('Role').selectOption('CONTRIBUTOR');
  await form.getByLabel('Team section').selectOption('DEV');
  await form.getByRole('button', { name: 'Send invitation' }).click();
}

async function checkout(page: Page, button: 'Simulate successful payment' | 'Simulate failed payment' | 'Cancel') {
  await page.waitForURL(/\/billing\/test-checkout\//);
  await expect(page.getByTestId('test-mode')).toContainText('TEST MODE');
  await page.getByRole('button', { name: button, exact: true }).click();
}

async function billingCard(page: Page, workspace: string) {
  await page.goto('/settings/billing');
  return page.getByRole('region', { name: `Billing for ${workspace}` });
}

async function portal(page: Page, workspace: string, button: string, expected: string) {
  await (await billingCard(page, workspace)).getByRole('button', { name: 'Manage billing' }).click();
  await page.waitForURL(/\/billing\/test-portal\//);
  await expect(page.getByTestId('test-mode')).toBeVisible();
  await page.getByRole('button', { name: button }).click();
  await expect(page.getByTestId('portal-status')).toContainText(expected);
}

async function newOwner(browser: Browser, name: string) {
  const page = await signUpAndVerify(browser, name, uniqueEmail(name.split(' ')[0].toLowerCase()));
  return { page, workspace: `${name}'s workspace` };
}

test('bucket: 3 RCAs fill it, the 4th is blocked with BUCKET_FULL; deleting one allows creation again', async ({ browser }) => {
  const { page } = await newOwner(browser, 'Bucky Bucket');
  const first = await createRcaViaUi(page, { summary: 'Bucket A' });
  await createRcaViaUi(page, { summary: 'Bucket B' });
  await createRcaViaUi(page, { summary: 'Bucket C' });
  expect(await bucketText(page)).toContain('3 of 3 unpaid RCAs');

  await submitNewRca(page, 'Bucket D (refused)');
  await expect(page.getByTestId('blocked-BUCKET_FULL')).toBeVisible();
  await expect(page).toHaveURL(/\/rcas\/new$/);

  await page.goto(first.rcaPath);
  await page.getByRole('button', { name: 'Delete' }).click();
  await expect(page).toHaveURL(/\/rcas$/);
  expect(await bucketText(page)).toContain('2 of 3 unpaid RCAs');

  await submitNewRca(page, 'Bucket D (allowed after delete)');
  await page.waitForURL(/\/rcas\/[0-9a-f-]+\/edit/);
  expect(await bucketText(page)).toContain('3 of 3 unpaid RCAs');
});

test('unlock: a simulated payment removes the watermark from that RCA only; the other 2 unpaid RCAs still count', async ({ browser }) => {
  const { page } = await newOwner(browser, 'Una Unlock');
  const paid = await createRcaViaUi(page, { summary: 'To be unlocked' });
  const other = await createRcaViaUi(page, { summary: 'Stays unpaid 1' });
  await createRcaViaUi(page, { summary: 'Stays unpaid 2' });
  expect(await exportWatermarked(page, paid.rcaPath)).toBe(true);

  await page.goto(paid.rcaPath);
  await page.getByRole('button', { name: /Unlock this RCA/ }).click();
  await checkout(page, 'Simulate successful payment');
  await page.waitForURL(/checkout=done/);
  await expect(page.getByTestId('paid-badge')).toBeVisible();

  expect(await exportWatermarked(page, paid.rcaPath)).toBe(false);
  expect(await exportWatermarked(page, other.rcaPath)).toBe(true);
  expect(await bucketText(page)).toContain('2 of 3 unpaid RCAs');
});

test('Solo: removes the cap and the watermark workspace-wide, but invitations stay blocked', async ({ browser }) => {
  const { page, workspace } = await newOwner(browser, 'Sol Solo');
  const a = await createRcaViaUi(page, { summary: 'Solo A' });
  await createRcaViaUi(page, { summary: 'Solo B' });
  await createRcaViaUi(page, { summary: 'Solo C' });
  expect(await bucketText(page)).toContain('3 of 3');

  await (await billingCard(page, workspace)).getByRole('button', { name: 'Subscribe to Solo' }).click();
  await checkout(page, 'Simulate successful payment');
  await page.waitForURL(/\/settings\/billing\?checkout=done/);
  await expect((await billingCard(page, workspace)).getByTestId('billing-plan')).toHaveText('Solo');

  expect(await bucketText(page)).toContain('Solo plan');
  await submitNewRca(page, 'Solo D (beyond the free cap)');
  await page.waitForURL(/\/rcas\/[0-9a-f-]+\/edit/);
  await page.goto(a.rcaPath);
  await expect(page.getByTestId('watermark-bar')).toHaveCount(0);
  expect(await exportWatermarked(page, a.rcaPath)).toBe(false);

  await inviteContributor(page, a.rcaPath, uniqueEmail('solo.invitee'));
  await expect(page.getByTestId('blocked-SUBSCRIPTION_REQUIRED')).toBeVisible();
});

test('Team: subscribe, invite a collaborator, and they can open and edit their section', async ({ browser }) => {
  const { page: owner, workspace } = await newOwner(browser, 'Tara Team');
  const { rcaPath } = await createRcaViaUi(owner, { summary: 'Team access' });
  await subscribeTeamViaUi(owner, workspace, 2);
  const devEmail = uniqueEmail('tara.dev');
  await inviteContributor(owner, rcaPath, devEmail);
  await expect(owner.getByTestId('pending-invitations')).toContainText(devEmail);

  const token = await tokenFromMail(devEmail, 'invitation');
  const dev = await signUpAndVerify(browser, 'Dev Dana', devEmail, undefined, async (p) => {
    await p.goto(`/invite?token=${token}`);
    await p.getByTestId('invite-signup').click();
  });
  await dev.goto(rcaPath);
  await expect(dev.getByTestId('rca-number')).toBeVisible();
  await dev.goto(`${rcaPath}/edit?tab=DEV`);
  await expect(dev.locator('#DEV-why-1')).toBeEnabled();
  await expect(dev.getByTestId('read-only-banner')).toHaveCount(0);
});

test('failed and canceled checkouts leave the workspace unchanged (no partial activation or unlock)', async ({ browser }) => {
  const { page, workspace } = await newOwner(browser, 'Fay Failure');
  const { rcaPath } = await createRcaViaUi(page, { summary: 'Failure paths' });
  const assertUnchanged = async () => {
    const card = await billingCard(page, workspace);
    await expect(card.getByTestId('billing-plan')).toHaveText('Free');
    await expect(card.getByTestId('billing-status')).toHaveText('No subscription');
    await expect(card.getByRole('button', { name: 'Manage billing' })).toHaveCount(0);
    expect(await bucketText(page)).toContain('1 of 3 unpaid RCAs');
    await page.goto(rcaPath);
    await expect(page.getByTestId('watermark-bar')).toBeVisible();
    await expect(page.getByTestId('paid-badge')).toHaveCount(0);
  };

  await test.step('Team subscription: payment fails', async () => {
    const card = await billingCard(page, workspace);
    await card.getByLabel('Team seats').fill('2');
    await card.getByRole('button', { name: /Subscribe to Team/ }).click();
    await checkout(page, 'Simulate failed payment');
    await expect(page.getByTestId('checkout-status')).toHaveText('FAILED');
    await page.getByRole('button', { name: 'Start over' }).click();
    await assertUnchanged();
  });

  await test.step('Team subscription: buyer cancels mid-checkout', async () => {
    const card = await billingCard(page, workspace);
    await card.getByLabel('Team seats').fill('2');
    await card.getByRole('button', { name: /Subscribe to Team/ }).click();
    await checkout(page, 'Cancel');
    await page.waitForURL(/\/settings\/billing\?checkout=canceled/);
    await expect(page.getByTestId('checkout-notice')).toContainText('canceled');
    await assertUnchanged();
  });

  await test.step('RCA unlock: payment fails, then the buyer cancels', async () => {
    await page.goto(rcaPath);
    await page.getByRole('button', { name: /Unlock this RCA/ }).click();
    await checkout(page, 'Simulate failed payment');
    await expect(page.getByTestId('checkout-status')).toHaveText('FAILED');
    await page.getByRole('button', { name: 'Start over' }).click();
    await page.getByRole('button', { name: /Unlock this RCA/ }).click();
    await checkout(page, 'Cancel');
    await page.waitForURL(/checkout=canceled/);
    await assertUnchanged();
    expect(await exportWatermarked(page, rcaPath)).toBe(true);
  });

  await test.step('invitations are still blocked, and the history shows only failures', async () => {
    await inviteContributor(page, rcaPath, uniqueEmail('fay.invitee'));
    await expect(page.getByTestId('blocked-SUBSCRIPTION_REQUIRED')).toBeVisible();
    const history = (await billingCard(page, workspace)).getByTestId('billing-history');
    await expect(history).toContainText('Failed');
    await expect(history).not.toContainText('Paid');
  });
});

test('PAST_DUE then CANCELED: cap and watermark return, the paid RCA stays unlocked, the collaborator is read-only but kept, the owner is warned', async ({ browser }) => {
  const { page: owner, workspace } = await newOwner(browser, 'Pat Pastdue');
  const paid = await createRcaViaUi(owner, { summary: 'Paid individually' });
  const shared = await createRcaViaUi(owner, { summary: 'Shared with a contributor' });

  // Unlock one RCA individually, then subscribe to Team and invite a DEV contributor.
  await owner.goto(paid.rcaPath);
  await owner.getByRole('button', { name: /Unlock this RCA/ }).click();
  await checkout(owner, 'Simulate successful payment');
  await expect(owner.getByTestId('paid-badge')).toBeVisible();
  await subscribeTeamViaUi(owner, workspace, 2);
  const third = await createRcaViaUi(owner, { summary: 'Created while subscribed' });
  const devEmail = uniqueEmail('pat.dev');
  await inviteContributor(owner, shared.rcaPath, devEmail);
  const token = await tokenFromMail(devEmail, 'invitation');
  const dev = await signUpAndVerify(browser, 'Dev Drew', devEmail, undefined, async (p) => {
    await p.goto(`/invite?token=${token}`);
    await p.getByTestId('invite-signup').click();
  });
  await dev.goto(`${shared.rcaPath}/edit?tab=DEV`);
  await expect(dev.locator('#DEV-why-1')).toBeEnabled();
  expect(await exportWatermarked(owner, shared.rcaPath)).toBe(false);

  const lapsed = async (label: 'past due' | 'canceled') => {
    // Owner warning on every app page.
    await owner.goto('/dashboard');
    await expect(owner.getByTestId('billing-alert')).toContainText(label);
    // The individually paid RCA stays unlocked; the others are watermarked again.
    await owner.goto(paid.rcaPath);
    await expect(owner.getByTestId('paid-badge')).toBeVisible();
    expect(await exportWatermarked(owner, paid.rcaPath)).toBe(false);
    expect(await exportWatermarked(owner, shared.rcaPath)).toBe(true);
    await owner.goto(third.rcaPath);
    await expect(owner.getByTestId('watermark-bar')).toBeVisible();
    // The collaborator keeps access, read-only, and is still listed.
    await dev.goto(`${shared.rcaPath}/edit?tab=DEV`);
    await expect(dev.getByTestId('read-only-banner')).toBeVisible();
    await expect(dev.locator('#DEV-why-1')).toBeDisabled();
    await owner.goto(shared.rcaPath);
    await owner.getByRole('button', { name: 'Share' }).click();
    await expect(owner.getByTestId('collaborators')).toContainText(devEmail);
    // No new invitations.
    await inviteContributor(owner, shared.rcaPath, uniqueEmail('pat.more'));
    await expect(owner.getByTestId('blocked-SUBSCRIPTION_REQUIRED')).toBeVisible();
  };

  await test.step('SUBSCRIPTION_PAST_DUE', async () => {
    await portal(owner, workspace, 'Simulate failed renewal (past due)', 'PAST_DUE');
    await expect((await billingCard(owner, workspace)).getByTestId('billing-status')).toHaveText('Past due');
    await lapsed('past due');
    // The cap is back: 2 unpaid (the paid RCA does not count), one more fits, the next is refused.
    expect(await bucketText(owner)).toContain('2 of 3 unpaid RCAs');
    await submitNewRca(owner, 'Fits in the returned cap');
    await owner.waitForURL(/\/rcas\/[0-9a-f-]+\/edit/);
    await submitNewRca(owner, 'Over the returned cap');
    await expect(owner.getByTestId('blocked-BUCKET_FULL')).toBeVisible();
  });

  await test.step('SUBSCRIPTION_CANCELED after PAST_DUE', async () => {
    await portal(owner, workspace, 'Cancel subscription', 'CANCELED');
    await expect((await billingCard(owner, workspace)).getByTestId('billing-status')).toHaveText('Canceled');
    await lapsed('canceled');
    expect(await bucketText(owner)).toContain('3 of 3 unpaid RCAs');
    await submitNewRca(owner, 'Still over the cap');
    await expect(owner.getByTestId('blocked-BUCKET_FULL')).toBeVisible();
  });
});
