import { expect, test, type Browser, type Page } from '@playwright/test';

const PASSWORD = 'Password@123';
const USERS = {
  lead: 'lead@rca.local',
  owner: 'jogender.kota@rca.local',
  dev: 'dev@rca.local',
  qa: 'qa@rca.local',
  prod: 'prod@rca.local',
};

async function loginAs(browser: Browser, email: string): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on('dialog', (d) => d.accept());
  await page.goto('/login');
  await page.fill('#email', email);
  await page.fill('#password', PASSWORD);
  await page.click('button[type=submit]');
  await expect(page.getByTestId('current-user')).toBeVisible();
  return page;
}

async function fillAndSubmitSection(browser: Browser, email: string, rcaUrl: string, team: 'DEV' | 'QA' | 'PROD', ownerName: string) {
  const page = await loginAs(browser, email);
  await page.goto(`${rcaUrl}/edit?tab=${team}`);
  const section = page.getByTestId(`section-${team}`);
  await expect(section).toBeVisible();

  // A team member can only edit their own section; the others are greyed out.
  const other = team === 'DEV' ? 'QA' : 'DEV';
  await page.getByRole('tab', { name: new RegExp(other === 'DEV' ? 'Dev' : 'QA') }).click();
  await expect(page.locator(`#${other}-why-1`)).toBeDisabled();
  await page.getByRole('tab', { name: new RegExp(team === 'DEV' ? 'Dev' : team === 'QA' ? 'QA' : 'Production') }).click();

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
  await page.context().close();
}

async function sign(browser: Browser, email: string, rcaUrl: string, role: string) {
  const page = await loginAs(browser, email);
  await page.goto(`${rcaUrl}/edit?tab=closing`);
  const row = page.getByTestId(`signoff-${role}`);
  await row.getByRole('button', { name: 'Sign' }).click();
  await expect(row.getByText('Signed', { exact: true })).toBeVisible();
  await page.context().close();
}

test('full RCA flow: create, three teams submit, review, sign-off, close, download PDF', async ({ browser }) => {
  // 1. RCA Team Leader creates the RCA and completes header and common sections.
  const lead = await loginAs(browser, USERS.lead);
  await lead.goto('/rcas/new');
  await lead.selectOption('#project_id', { label: 'Payment Gateway' });
  await lead.selectOption('#severity', 'P2');
  await lead.selectOption('#environment', 'PROD');
  await lead.fill('#ticket_id', 'INC-E2E-1');
  await lead.fill('#incident_start', '2026-09-27T14:05');
  await lead.fill('#detected_at', '2026-09-27T14:15');
  await lead.fill('#resolved_at', '2026-09-27T14:45');
  await lead.fill('#summary', 'E2E: Payment API returned 500 for 40 minutes.');
  await lead.getByRole('button', { name: 'Create RCA' }).click();
  await lead.waitForURL(/\/rcas\/[0-9a-f-]+\/edit/);
  const rcaNumber = (await lead.getByTestId('rca-number').textContent())!;
  expect(rcaNumber).toMatch(/^RCA-\d{4}-\d{4}$/);
  const rcaUrl = new URL(lead.url()).pathname.replace(/\/edit$/, '');

  await lead.getByRole('tab', { name: /Common/ }).click();
  await lead.fill('#impact_users', 'All card customers');
  await lead.selectOption('#detection_method', 'MONITORING');
  await lead.fill('#immediate_fix', 'Rolled back release');
  await lead.getByRole('button', { name: 'Save common sections' }).click();
  await expect(lead.getByRole('button', { name: 'Save common sections' })).toBeDisabled();

  // Review is refused while team sections are missing.
  await lead.getByRole('button', { name: 'Submit for review' }).click();
  await expect(lead.getByRole('alert').filter({ hasText: 'DEV section is not submitted' })).toBeVisible();

  // 2. Each team fills and submits its own section.
  await fillAndSubmitSection(browser, USERS.dev, rcaUrl, 'DEV', 'Arjun Mehta');
  await fillAndSubmitSection(browser, USERS.qa, rcaUrl, 'QA', 'Neha Gupta');
  await fillAndSubmitSection(browser, USERS.prod, rcaUrl, 'PROD', 'Vikram Singh');

  // 3. Lead submits for review.
  await lead.goto(rcaUrl);
  await lead.getByRole('button', { name: 'Submit for review' }).click();
  await expect(lead.getByTestId('status-chip')).toHaveText('In review');

  // 4. Sign-off: team leads first, then Project Owner and RCA Team Leader.
  await sign(browser, USERS.dev, rcaUrl, 'DEV_LEAD');
  await sign(browser, USERS.qa, rcaUrl, 'QA_LEAD');
  await sign(browser, USERS.prod, rcaUrl, 'PROD_LEAD');
  await sign(browser, USERS.owner, rcaUrl, 'PROJECT_OWNER');
  await sign(browser, USERS.lead, rcaUrl, 'RCA_LEAD');

  // 5. Project Owner closes the RCA.
  const owner = await loginAs(browser, USERS.owner);
  await owner.goto(rcaUrl);
  await owner.getByRole('button', { name: 'Close RCA' }).click();
  await expect(owner.getByTestId('status-chip')).toHaveText('Closed');

  // 6. Download the PDF.
  const [download] = await Promise.all([owner.waitForEvent('download'), owner.getByRole('button', { name: 'PDF' }).click()]);
  expect(download.suggestedFilename()).toBe(`${rcaNumber}_PaymentGateway_v1.pdf`);
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(c as Buffer);
  const pdf = Buffer.concat(chunks);
  expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  expect(pdf.length).toBeGreaterThan(10_000);

  // The close and the export are in the audit log.
  await owner.goto(`/audit?`);
  await owner.getByLabel('RCA number filter').fill(rcaNumber);
  const audit = owner.getByTestId('audit-table');
  // Wait for the filter to apply: only this RCA's rows remain.
  await expect(audit.getByRole('link', { name: 'RCA-2026-0001' })).toHaveCount(0);
  await expect(audit.getByRole('cell', { name: 'CLOSE', exact: true })).toHaveCount(1);
  await expect(audit.getByRole('cell', { name: 'EXPORT', exact: true }).first()).toBeVisible();
});

test('each seeded role can log in and lands on its home page', async ({ browser }) => {
  const homes: Record<string, RegExp> = {
    'admin@rca.local': /\/dashboard$/,
    'jogender.kota@rca.local': /\/dashboard$/,
    'lead@rca.local': /\/dashboard$/,
    'dev@rca.local': /\/my-tasks$/,
    'qa@rca.local': /\/my-tasks$/,
    'prod@rca.local': /\/my-tasks$/,
    'viewer@rca.local': /\/dashboard$/,
  };
  for (const [email, home] of Object.entries(homes)) {
    const page = await loginAs(browser, email);
    await expect(page).toHaveURL(home);
    await page.context().close();
  }
});
