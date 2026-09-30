import { expect, test, type Page } from '@playwright/test';
import { createRcaViaUi, fillSection, signUpAndVerify, subscribeTeamViaUi, tokenFromMail, uniqueEmail } from './helpers';

async function openShare(page: Page, rcaPath: string) {
  await page.goto(rcaPath);
  await page.getByRole('button', { name: 'Share' }).click();
  await page.getByTestId('collaborators').waitFor();
}

async function invite(page: Page, email: string, role: 'EDITOR' | 'CONTRIBUTOR' | 'VIEWER', team?: 'DEV') {
  const form = page.getByTestId('invite-form');
  await form.getByLabel('Email').fill(email);
  await form.getByLabel('Role').selectOption(role);
  if (team) await form.getByLabel('Team section').selectOption(team);
  await form.getByRole('button', { name: 'Send invitation' }).click();
}

async function openWorkspace(page: Page, name: string) {
  await page.goto('/workspaces');
  await page.getByRole('row').filter({ hasText: name }).getByRole('link', { name: 'Manage' }).click();
  await page.getByTestId('people-with-access').waitFor();
}

async function acceptInvite(page: Page, email: string) {
  const token = await tokenFromMail(email, 'invitation');
  await page.goto(`/invite?token=${token}`);
  await page.getByRole('button', { name: 'Accept invitation' }).click();
  await page.waitForURL(/\/rcas\/[0-9a-f-]+$/);
}

test('invite shows as pending at once, becomes a collaborator on acceptance, editor can edit; people-with-access and RCA history show it', async ({ browser }) => {
  const owner = await signUpAndVerify(browser, 'Olive Owner', uniqueEmail('olive'));
  const ws = "Olive Owner's workspace";
  await subscribeTeamViaUi(owner, ws, 3);
  const { rcaPath, rcaNumber } = await createRcaViaUi(owner, { summary: 'Invite lifecycle' });
  const edEmail = uniqueEmail('eddie');
  const eddie = await signUpAndVerify(browser, 'Eddie Editor', edEmail);

  await openShare(owner, rcaPath);
  await invite(owner, edEmail, 'EDITOR');
  // Immediately, in the same dialog.
  await expect(owner.getByTestId('pending-invitations')).toContainText(edEmail);
  await expect(owner.getByTestId('collaborators')).toContainText('Not shared with anyone outside the workspace.');

  await acceptInvite(eddie, edEmail);
  await openShare(owner, rcaPath);
  await expect(owner.getByTestId('collaborators')).toContainText(edEmail);
  await expect(owner.getByTestId('pending-invitations')).toHaveCount(0);
  await owner.keyboard.press('Escape');

  // The editor can edit the RCA.
  await eddie.goto(`${rcaPath}/edit?tab=header`);
  await expect(eddie.locator('#ticket_id')).toBeEnabled();
  await eddie.fill('#ticket_id', 'INC-42');
  await eddie.getByRole('button', { name: 'Save header' }).click();
  await expect(eddie.getByTestId('toast').filter({ hasText: 'Header saved' })).toBeVisible();

  // People with access: one place, across RCAs.
  await openWorkspace(owner, ws);
  const people = owner.getByTestId('people-with-access');
  await expect(people.getByTestId('access-row').filter({ hasText: edEmail })).toContainText(rcaNumber);
  await expect(people.getByTestId('access-row').filter({ hasText: edEmail })).toContainText('Editor');

  // The RCA's change history (owner) shows the invitation lifecycle.
  await owner.goto(rcaPath);
  const history = owner.locator('.card').filter({ has: owner.getByRole('heading', { name: 'Change history' }) });
  await expect(history).toContainText('INVITE_ACCEPT');
  await expect(history.getByRole('cell', { name: 'INVITE', exact: true })).toBeVisible();
});

test('contributor whose section gets locked: told which section and why; the owner sees it and can unlock it from the Share panel', async ({ browser }) => {
  const owner = await signUpAndVerify(browser, 'Oscar Owner', uniqueEmail('oscar'));
  const ws = "Oscar Owner's workspace";
  await subscribeTeamViaUi(owner, ws, 3);
  const { rcaPath } = await createRcaViaUi(owner, { summary: 'Locked contributor' });
  const devEmail = uniqueEmail('dina');
  const dina = await signUpAndVerify(browser, 'Dina Dev', devEmail);

  await openShare(owner, rcaPath);
  await invite(owner, devEmail, 'CONTRIBUTOR', 'DEV');
  await expect(owner.getByTestId('pending-invitations')).toContainText(devEmail);
  await acceptInvite(dina, devEmail);

  // Before the lock: Dev is editable, QA is not.
  await dina.goto(`${rcaPath}/edit?tab=DEV`);
  await expect(dina.locator('#DEV-why-1')).toBeEnabled();
  await dina.goto(`${rcaPath}/edit?tab=QA`);
  await expect(dina.locator('#QA-why-1')).toBeDisabled();

  // The owner fills and submits the Dev section: it locks.
  await fillSection(owner, rcaPath, 'DEV', 'Oscar Owner');

  // The contributor sees it the moment they open the RCA, with the section named.
  await dina.goto(rcaPath);
  await expect(dina.getByTestId('nothing-to-edit')).toContainText('Your Dev section was submitted and is locked, so there is nothing for you to edit right now. Ask an owner or editor to unlock it.');
  await dina.goto(`${rcaPath}/edit?tab=DEV`);
  await expect(dina.locator('#DEV-why-1')).toBeDisabled();
  await expect(dina.getByTestId('section-DEV')).toContainText('Your Dev section was submitted by Oscar Owner and is locked');

  // The owner sees it too: in People with access and in the Share panel, where it can be unlocked.
  await openWorkspace(owner, ws);
  await expect(owner.getByTestId('people-with-access').getByTestId('access-row').filter({ hasText: devEmail }).getByTestId('nothing-to-edit-badge')).toContainText('Dev section locked: nothing to edit');
  await openShare(owner, rcaPath);
  const row = owner.getByTestId('collaborators').locator('tr').filter({ hasText: devEmail });
  await expect(row).toContainText('Dev section locked: nothing to edit');
  await row.getByRole('button', { name: 'Unlock Dev' }).click();
  await expect(owner.getByTestId('toast').filter({ hasText: 'Dev section unlocked' })).toBeVisible();
  await expect(row).not.toContainText('nothing to edit');

  // Fresh for the contributor on their next visit.
  await dina.goto(rcaPath);
  await expect(dina.getByTestId('nothing-to-edit')).toHaveCount(0);
  await dina.goto(`${rcaPath}/edit?tab=DEV`);
  await expect(dina.locator('#DEV-why-1')).toBeEnabled();
});
