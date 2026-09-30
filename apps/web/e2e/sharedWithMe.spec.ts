import fs from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { MAIL_LOG } from '../playwright.config';
import { createRcaViaUi, signUpAndVerify, subscribeTeamViaUi, uniqueEmail } from './helpers';

async function invite(owner: Page, rcaPath: string, email: string, role: 'CONTRIBUTOR' | 'VIEWER', team?: 'DEV') {
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

/** Tokens of every invitation email sent to `to`, oldest first. */
function tokensFor(to: string) {
  return fs
    .readFileSync(MAIL_LOG, 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l) as { to: string; template: string; text: string })
    .filter((m) => m.to === to && m.template === 'invitation')
    .map((m) => /token=([A-Za-z0-9_-]+)/.exec(m.text)![1]);
}

const rows = (page: Page) => page.getByTestId('rca-table').locator('tbody tr');

test('Shared with me: RCAs from other people\'s workspaces, with who shared them; same permissions when opened', async ({ browser }) => {
  // alice owns a Team workspace with two RCAs.
  const alice = await signUpAndVerify(browser, 'Alice Sharer', uniqueEmail('alice'));
  await subscribeTeamViaUi(alice, "Alice Sharer's workspace", 3);
  const dev = await createRcaViaUi(alice, { summary: 'Alice Dev RCA' });
  const view = await createRcaViaUi(alice, { summary: 'Alice viewer RCA' });

  // Shubham has his own workspace and RCA.
  const shubhamEmail = uniqueEmail('shubham');
  const shubham = await signUpAndVerify(browser, 'Shubham Invitee', shubhamEmail);
  const own = await createRcaViaUi(shubham, { summary: 'Shubham own RCA' });

  await invite(alice, dev.rcaPath, shubhamEmail, 'CONTRIBUTOR', 'DEV');
  await invite(alice, view.rcaPath, shubhamEmail, 'VIEWER');
  // Accept every invitation email sent to him (strictly: the Accept button must be there).
  for (const token of tokensFor(shubhamEmail)) {
    await shubham.goto(`/invite?token=${token}`);
    await shubham.getByRole('button', { name: 'Accept invitation' }).click();
    await shubham.waitForURL(/\/rcas\/[0-9a-f-]+$/);
  }

  // His own workspace does not list alice's RCAs (the confusion that was reported)…
  await shubham.goto('/rcas');
  const switcher = shubham.getByTestId('workspace-switcher');
  await switcher.selectOption({ label: "Shubham Invitee's workspace (Owner)" });
  await expect(rows(shubham)).toHaveCount(1);
  await expect(rows(shubham).first()).toContainText('Shubham own RCA');

  // …"Shared with me" does, saying who shared each and his access.
  await expect(switcher.locator('option', { hasText: 'Shared with me (2)' })).toHaveCount(1);
  await switcher.selectOption({ label: 'Shared with me (2)' });
  await expect(shubham.getByRole('heading', { name: 'Shared with me' })).toBeVisible();
  await expect(shubham.getByTestId('shared-explainer')).toContainText('They belong to their workspaces');
  await expect(rows(shubham)).toHaveCount(2);
  const devRow = rows(shubham).filter({ hasText: 'Alice Dev RCA' });
  await expect(devRow.getByTestId('shared-tag')).toContainText('Shared by Alice Sharer');
  await expect(devRow.getByTestId('shared-tag')).toContainText("Alice Sharer's workspace · you are contributor (Dev section)");
  await expect(rows(shubham).filter({ hasText: 'Alice viewer RCA' }).getByTestId('shared-tag')).toContainText('you are viewer');
  await expect(rows(shubham).filter({ hasText: 'Shubham own RCA' })).toHaveCount(0);

  // "All workspaces" shows everything; only alice's RCAs carry the tag.
  await switcher.selectOption({ label: 'All workspaces' });
  await expect(rows(shubham)).toHaveCount(3);
  await expect(rows(shubham).filter({ hasText: 'Shubham own RCA' }).getByTestId('shared-tag')).toHaveCount(0);

  // Same permissions as before: contributor edits only Dev; viewer edits nothing.
  await shubham.goto(`${dev.rcaPath}/edit?tab=DEV`);
  await expect(shubham.locator('#DEV-why-1')).toBeEnabled();
  await shubham.goto(`${dev.rcaPath}/edit?tab=QA`);
  await expect(shubham.locator('#QA-why-1')).toBeDisabled();
  await shubham.goto(`${view.rcaPath}/edit?tab=DEV`);
  await expect(shubham.locator('#DEV-why-1')).toBeDisabled();
  await shubham.goto(`${view.rcaPath}/edit?tab=header`);
  await expect(shubham.locator('#ticket_id')).toBeDisabled();
  expect(own.rcaNumber).toBeTruthy();
});
