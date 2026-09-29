import { expect, test } from '@playwright/test';
import { createRcaViaUi, fillSection, signUpAndVerify, subscribeTeamViaUi, tokenFromMail, uniqueEmail } from './helpers';

test('owner invites a new person as DEV contributor; after sign-up they edit only the Dev section', async ({ browser }) => {
  const owner = await signUpAndVerify(browser, 'Olga Owner', uniqueEmail('owner'));
  const { rcaPath } = await createRcaViaUi(owner, { summary: 'Checkout outage shared with a contractor' });
  // Inviting people needs the Team plan.
  await subscribeTeamViaUi(owner, "Olga Owner's workspace");

  const devEmail = uniqueEmail('contractor');
  await owner.goto(rcaPath);
  await owner.getByRole('button', { name: 'Share' }).click();
  const form = owner.getByTestId('invite-form');
  await form.getByLabel('Email').fill(devEmail);
  await form.getByLabel('Role').selectOption('CONTRIBUTOR');
  await form.getByLabel('Team section').selectOption('DEV');
  await form.getByRole('button', { name: 'Send invitation' }).click();
  await expect(owner.getByTestId('pending-invitations')).toContainText(devEmail);

  // The invitee follows the link, signs up, verifies; the invitation is applied automatically.
  const token = await tokenFromMail(devEmail, 'invitation');
  const dev = await signUpAndVerify(browser, 'Dora Dev', devEmail, undefined, async (page) => {
    await page.goto(`/invite?token=${token}`);
    await expect(page.getByText(/invited .* as contributor \(Dev section\)/)).toBeVisible();
    await page.getByTestId('invite-signup').click();
  });
  await dev.goto(`${rcaPath}/edit?tab=QA`);
  await expect(dev.locator('#QA-why-1')).toBeDisabled();
  await dev.getByRole('tab', { name: /1 Header/ }).click();
  await expect(dev.locator('#ticket_id')).toBeDisabled();
  await fillSection(dev, rcaPath, 'DEV', 'Dora Dev');
  await dev.goto(`${rcaPath}/edit?tab=DEV`);
  await expect(dev.getByTestId('last-edited-DEV')).toContainText('Dora Dev');

  // The owner sees who edited the section; a stranger cannot open the RCA at all.
  await owner.goto(`${rcaPath}/edit?tab=DEV`);
  await expect(owner.getByTestId('last-edited-DEV')).toContainText('Dora Dev');
  const stranger = await signUpAndVerify(browser, 'Stan Stranger', uniqueEmail('stranger'));
  await stranger.goto(rcaPath);
  await expect(stranger.getByRole('alert')).toContainText('RCA not found');
});

test('team workspace: create it, invite an existing user as editor, they see the workspace RCAs', async ({ browser }) => {
  const lead = await signUpAndVerify(browser, 'Lena Lead', uniqueEmail('lead'));
  const peerEmail = uniqueEmail('peer');
  const peer = await signUpAndVerify(browser, 'Pete Peer', peerEmail);

  await lead.goto('/workspaces');
  await lead.getByLabel('Workspace name').fill('Payments team');
  await lead.getByRole('button', { name: 'Create workspace' }).click();
  await expect(lead.getByRole('heading', { name: 'Payments team' })).toBeVisible();
  const workspacePath = new URL(lead.url()).pathname;
  await subscribeTeamViaUi(lead, 'Payments team');
  await lead.goto(workspacePath);
  const form = lead.getByTestId('invite-form');
  await form.getByLabel('Email').fill(peerEmail);
  await form.getByLabel('Role').selectOption('EDITOR');
  await form.getByRole('button', { name: 'Send invitation' }).click();
  await expect(lead.getByTestId('pending-invitations')).toContainText(peerEmail);
  const { rcaPath } = await createRcaViaUi(lead, { workspace: 'Payments team', summary: 'Team RCA' });

  const token = await tokenFromMail(peerEmail, 'invitation');
  await peer.goto(`/invite?token=${token}`);
  await peer.getByRole('button', { name: 'Accept invitation' }).click();
  await expect(peer).toHaveURL(/\/rcas$/);
  await peer.goto(rcaPath);
  await expect(peer.getByTestId('rca-view')).toBeVisible();
  await expect(peer.getByRole('button', { name: 'Submit for review' })).toBeVisible();
  await peer.goto('/workspaces');
  await expect(peer.getByRole('cell', { name: 'Payments team' })).toBeVisible();
});
