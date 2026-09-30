import { expect, type Browser, type Download, type Locator, type Page } from '@playwright/test';

export const DEMO_PASSWORD = 'Demo-Password-2026';

export async function loginAs(browser: Browser, email: string, password = DEMO_PASSWORD): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on('dialog', (d) => d.accept());
  await page.goto('/login');
  await page.fill('#email', email);
  await page.fill('#password', password);
  await page.click('button[type=submit]');
  await expect(page.getByTestId('current-user')).toBeVisible();
  return page;
}

export async function readDownload(download: Download): Promise<Buffer> {
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(c as Buffer);
  return Buffer.concat(chunks);
}

const TEAM_TAB = { DEV: /3 Dev/, QA: /4 QA/, PROD: /5 Production/ } as const;

/** Fill cause, whys, escape analysis and one completed action on a team tab, then submit it. */
export async function fillSection(page: Page, rcaPath: string, team: 'DEV' | 'QA' | 'PROD', ownerName: string) {
  await page.goto(`${rcaPath}/edit?tab=${team}`);
  const section: Locator = page.getByTestId(`section-${team}`);
  await expect(section).toBeVisible();
  await page.selectOption(`#${team}-cause`, team === 'QA' ? 'TEST_GAP' : 'CODE_DEFECT');
  await page.fill(`#${team}-why-1`, `${team}: API returned 500`);
  await page.fill(`#${team}-why-5`, `${team}: missing default currency`);
  await page.fill(`#${team}-escape`, `${team}: no check covered this case`);
  await section.getByRole('button', { name: 'Save draft' }).click();
  await expect(section.getByText('version 2')).toBeVisible();
  await section.getByRole('button', { name: '+ Add action' }).click();
  const actions = page.getByRole('table', { name: `${team} actions` });
  await actions.getByLabel('Action').fill(`${team} corrective action`);
  await actions.getByLabel('Owner').selectOption({ label: ownerName });
  await actions.getByLabel('Due date').fill('2026-12-31');
  await actions.getByLabel('Status').selectOption('COMPLETED');
  await actions.getByLabel('Completed on').fill('2026-12-01');
  await actions.getByRole('button', { name: 'Save' }).click();
  await expect(actions.getByRole('button', { name: 'Delete' })).toBeVisible();
  await section.getByRole('button', { name: 'Submit section' }).click();
  await expect(section.getByText('Submitted', { exact: true })).toBeVisible();
  await expect(page.getByRole('tab', { name: TEAM_TAB[team] })).toContainText('Submitted');
}

/** Header + common for a new RCA; returns the RCA path (/rcas/{id}) and number. */
export async function createRcaViaUi(page: Page, opts: { workspace?: string; summary?: string } = {}) {
  await page.goto('/rcas/new');
  if (opts.workspace) await page.selectOption('#workspace_id', { label: opts.workspace });
  await page.fill('#project_name', 'Payment Gateway');
  await page.selectOption('#severity', 'P2');
  await page.selectOption('#environment', 'PROD');
  await page.fill('#incident_start', '2026-09-27T14:05');
  await page.fill('#detected_at', '2026-09-27T14:15');
  await page.fill('#resolved_at', '2026-09-27T14:45');
  await page.fill('#summary', opts.summary ?? 'E2E: Payment API returned 500 for 40 minutes.');
  await page.getByRole('button', { name: 'Create RCA' }).click();
  await page.waitForURL(/\/rcas\/[0-9a-f-]+\/edit/);
  const rcaNumber = (await page.getByTestId('rca-number').textContent())!;
  const rcaPath = new URL(page.url()).pathname.replace(/\/edit$/, '');
  await page.getByRole('tab', { name: /Common/ }).click();
  await page.fill('#impact_users', 'All card customers');
  await page.selectOption('#detection_method', 'MONITORING');
  await page.fill('#immediate_fix', 'Rolled back release');
  await page.getByRole('button', { name: 'Save common sections' }).click();
  await expect(page.getByRole('button', { name: 'Save common sections' })).toBeDisabled();
  return { rcaPath, rcaNumber };
}

import fs from 'node:fs';
import { MAIL_LOG } from '../playwright.config';

/** Wait for the console mailer to log an email to `to` and return the token from its link. */
export async function tokenFromMail(to: string, template: string): Promise<string> {
  for (let i = 0; i < 50; i++) {
    const lines = fs.existsSync(MAIL_LOG) ? fs.readFileSync(MAIL_LOG, 'utf8').trim().split('\n').filter(Boolean) : [];
    const mail = lines.map((l) => JSON.parse(l) as { to: string; template: string; text: string }).reverse().find((m) => m.to === to && m.template === template);
    const token = mail && /token=([A-Za-z0-9_-]+)/.exec(mail.text)?.[1];
    if (token) return token;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`No ${template} email for ${to}`);
}

/** Wait for an email of `template` to `to` in the console mail log and return it. */
export async function mailTo(to: string, template: string): Promise<{ to: string; template: string; subject: string; text: string }> {
  for (let i = 0; i < 50; i++) {
    const lines = fs.existsSync(MAIL_LOG) ? fs.readFileSync(MAIL_LOG, 'utf8').trim().split('\n').filter(Boolean) : [];
    const mail = lines.map((l) => JSON.parse(l) as { to: string; template: string; subject: string; text: string }).reverse().find((m) => m.to === to && m.template === template);
    if (mail) return mail;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`No ${template} email for ${to}`);
}

export const uniqueEmail = (prefix: string) => `${prefix}.${Date.now()}.${Math.floor(Math.random() * 1e6)}@e2e.test`;
export const STRONG_PASSWORD = 'Harbour-Lantern-Forty-2';

/** Sign up through the UI and verify through the emailed link; returns a logged-in page. */
export async function signUpAndVerify(browser: Browser, name: string, email: string, password = STRONG_PASSWORD, startAt?: (page: Page) => Promise<void>): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  page.on('dialog', (d) => d.accept());
  if (startAt) await startAt(page);
  else {
    await page.goto('/');
    await page.getByTestId('cta-signup').click();
  }
  await page.fill('#name', name);
  await page.fill('#email', email);
  await page.fill('#password', password);
  await page.getByTestId('accept-terms').check();
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
  const token = await tokenFromMail(email, 'verify-email');
  await page.goto(`/verify-email?token=${token}`);
  await expect(page.getByText('Your email is verified')).toBeVisible();
  await page.goto('/login');
  await page.fill('#email', email);
  await page.fill('#password', password);
  await page.click('button[type=submit]');
  await expect(page.getByTestId('current-user')).toHaveText(name);
  return page;
}

/** Subscribe a workspace the page's user owns to Team through the TEST MODE checkout. */
export async function subscribeTeamViaUi(page: Page, workspaceName: string, seats = 5) {
  await page.goto('/settings/billing');
  const card = page.getByRole('region', { name: `Billing for ${workspaceName}` });
  await card.getByLabel('Team seats').fill(String(seats));
  await card.getByRole('button', { name: /Subscribe to Team/ }).click();
  await page.waitForURL(/\/billing\/test-checkout\//);
  await expect(page.getByTestId('test-mode')).toBeVisible();
  await page.getByRole('button', { name: 'Simulate successful payment' }).click();
  await page.waitForURL(/\/settings\/billing\?checkout=done/);
  await expect(page.getByRole('region', { name: `Billing for ${workspaceName}` }).getByTestId('billing-plan')).toHaveText('Team');
}
