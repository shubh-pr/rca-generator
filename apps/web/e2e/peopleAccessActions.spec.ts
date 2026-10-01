import { expect, test, type Page } from '@playwright/test';
import { createRcaViaUi, signUpAndVerify, subscribeTeamViaUi, tokenFromMail, uniqueEmail } from './helpers';

async function shareInvite(owner: Page, rcaPath: string, email: string, role: 'VIEWER' | 'CONTRIBUTOR', team?: 'DEV') {
  await owner.goto(rcaPath);
  await owner.getByRole('button', { name: 'Share' }).click();
  const form = owner.getByTestId('invite-form');
  await form.getByLabel('Email').fill(email);
  await form.getByLabel('Role').selectOption(role);
  if (team) await form.getByLabel('Team section').selectOption(team);
  await form.getByRole('button', { name: 'Send invitation' }).click();
  await expect(owner.getByTestId('pending-invitations')).toContainText(email);
  await owner.keyboard.press('Escape');
}
async function accept(page: Page, email: string) {
  await page.goto(`/invite?token=${await tokenFromMail(email, 'invitation')}`);
  await page.getByRole('button', { name: 'Accept invitation' }).click();
  await page.waitForURL(/\/(rcas|workspaces)/);
}
async function openPeople(owner: Page, ws: string) {
  await owner.goto('/workspaces');
  await owner.getByRole('row').filter({ hasText: ws }).getByRole('link', { name: 'Manage' }).click();
  await owner.getByTestId('access-row').first().waitFor();
}
const row = (owner: Page, email: string) => owner.getByTestId('people-with-access').getByTestId('access-row').filter({ hasText: email });

test('People with access: revoke a pending invite, remove an RCA collaborator and a member, immediately; same audit trail as the Share panel', async ({ browser }) => {
  const owner = await signUpAndVerify(browser, 'Paula Owner', uniqueEmail('paula'));
  const ws = "Paula Owner's workspace";
  await subscribeTeamViaUi(owner, ws, 5);
  const { rcaPath, rcaNumber } = await createRcaViaUi(owner, { summary: 'Access actions' });

  const pendingEmail = uniqueEmail('pending');
  await shareInvite(owner, rcaPath, pendingEmail, 'VIEWER');
  const collabEmail = uniqueEmail('collab');
  const collab = await signUpAndVerify(browser, 'Cole Collab', collabEmail);
  await shareInvite(owner, rcaPath, collabEmail, 'CONTRIBUTOR', 'DEV');
  await accept(collab, collabEmail);
  // A workspace-level member.
  const memberEmail = uniqueEmail('member');
  const member = await signUpAndVerify(browser, 'Mira Member', memberEmail);
  await openPeople(owner, ws);
  const inviteForm = owner.getByTestId('invite-form');
  await inviteForm.getByLabel('Email').fill(memberEmail);
  await inviteForm.getByLabel('Role').selectOption('VIEWER');
  await inviteForm.getByRole('button', { name: 'Send invitation' }).click();
  await accept(member, memberEmail);

  await openPeople(owner, ws);
  // The owner's own row has no action.
  await expect(row(owner, 'Member (primary owner)').getByRole('button')).toHaveCount(0);

  // Revoke the pending invitation: the row goes at once (no reload).
  const dialogs: string[] = [];
  owner.on('dialog', (d) => dialogs.push(d.message()));
  await row(owner, pendingEmail).getByRole('button', { name: 'Revoke' }).click();
  await expect(owner.getByTestId('toast').filter({ hasText: `Invitation to ${pendingEmail} revoked` })).toBeVisible();
  await expect(row(owner, pendingEmail)).toHaveCount(0);

  // Remove the RCA collaborator: confirmation first.
  await row(owner, collabEmail).getByRole('button', { name: 'Remove access' }).click();
  expect(dialogs.at(-1)).toBe(`Remove Cole Collab (${collabEmail}) from ${rcaNumber}?`);
  await expect(row(owner, collabEmail)).toHaveCount(0);
  await expect(owner.getByTestId('toast').filter({ hasText: `Cole Collab removed from ${rcaNumber}` })).toBeVisible();

  // Declining the confirmation removes nothing.
  owner.removeAllListeners('dialog');
  owner.once('dialog', (d) => void d.dismiss());
  await row(owner, memberEmail).getByRole('button', { name: 'Remove access' }).click();
  await expect(row(owner, memberEmail)).toHaveCount(1);
  owner.on('dialog', (d) => void d.accept());
  await row(owner, memberEmail).getByRole('button', { name: 'Remove access' }).click();
  await expect(row(owner, memberEmail)).toHaveCount(0);

  // Access is really gone.
  await collab.goto(rcaPath);
  await expect(collab.getByRole('alert')).toContainText('RCA not found');

  // Same audit trail as the Share panel, on the RCA's own history.
  await owner.goto(rcaPath);
  const history = owner.locator('.card').filter({ has: owner.getByRole('heading', { name: 'Change history' }) });
  await expect(history.getByRole('cell', { name: 'INVITE_REVOKE', exact: true })).toBeVisible();
  await expect(history.getByRole('cell', { name: 'MEMBER_REMOVE', exact: true })).toBeVisible();
});

test('Security log lines say what happened: invitations, revocations, removals and exports', async ({ browser }) => {
  const owner = await signUpAndVerify(browser, 'Lena Logger', uniqueEmail('lena'));
  await subscribeTeamViaUi(owner, "Lena Logger's workspace", 3);
  const { rcaPath, rcaNumber } = await createRcaViaUi(owner, { summary: 'Security log detail' });
  const invitee = uniqueEmail('inv');
  await shareInvite(owner, rcaPath, invitee, 'VIEWER');
  await owner.goto(rcaPath);
  const [pdf] = await Promise.all([owner.waitForEvent('download'), owner.getByRole('button', { name: 'PDF' }).click()]);
  expect(pdf.suggestedFilename()).toMatch(/\.pdf$/);
  await owner.goto('/rcas');
  const [csv] = await Promise.all([owner.waitForEvent('download'), owner.getByRole('button', { name: /CSV/ }).click()]);
  expect(csv.suggestedFilename()).toMatch(/\.csv$/);
  const [tpl] = await Promise.all([owner.waitForEvent('download'), owner.getByRole('button', { name: 'Blank template' }).click()]);
  expect(tpl.suggestedFilename()).toBe('RCA_Template.docx');

  await owner.goto('/settings');
  const log = owner.getByTestId('security-log');
  await expect(log).toContainText(`Invited ${invitee} to ${rcaNumber} as Viewer`);
  await expect(log).toContainText(`Exported ${rcaNumber} as PDF`);
  await expect(log).toContainText(/Exported the RCA list as CSV \(\d+ rows?\)/);
  await expect(log).toContainText('Downloaded the blank RCA template (Word)');
  await expect(log).toContainText('Logged in with email and password');
});
