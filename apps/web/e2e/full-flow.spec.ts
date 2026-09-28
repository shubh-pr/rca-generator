import { expect, test } from '@playwright/test';
import { createRcaViaUi, fillSection, loginAs, readDownload } from './helpers';

test('solo user: create an RCA, fill every section, review, sign all roles, close, download PDF and DOCX', async ({ browser }) => {
  // Priya's personal workspace: nobody else is needed.
  const page = await loginAs(browser, 'lead@rca.local');
  const { rcaPath, rcaNumber } = await createRcaViaUi(page, { workspace: "Priya Sharma's workspace" });
  expect(rcaNumber).toMatch(/^RCA-\d{4}-\d{4}$/);
  for (const team of ['DEV', 'QA', 'PROD'] as const) await fillSection(page, rcaPath, team, 'Priya Sharma');

  await page.goto(rcaPath);
  await page.getByRole('button', { name: 'Submit for review' }).click();
  await expect(page.getByTestId('status-chip')).toHaveText('In review');

  await page.goto(`${rcaPath}/edit?tab=closing`);
  for (const role of ['DEV_LEAD', 'QA_LEAD', 'PROD_LEAD', 'PROJECT_OWNER', 'RCA_LEAD']) {
    const row = page.getByTestId(`signoff-${role}`);
    await row.getByRole('button', { name: 'Sign' }).click();
    await expect(row.getByText('Signed', { exact: true })).toBeVisible();
  }
  await page.getByRole('button', { name: 'Close RCA' }).click();
  await expect(page.getByTestId('status-chip')).toHaveText('Closed');

  await page.goto(rcaPath);
  const [pdf] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'PDF' }).click()]);
  expect(pdf.suggestedFilename()).toBe(`${rcaNumber}_PaymentGateway_v1.pdf`);
  expect((await readDownload(pdf)).subarray(0, 5).toString()).toBe('%PDF-');
  const [docx] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Word' }).click()]);
  expect(docx.suggestedFilename()).toBe(`${rcaNumber}_PaymentGateway_v1.docx`);
  expect((await readDownload(docx)).subarray(0, 2).toString()).toBe('PK');
});

test('team workspace: a DEV contributor edits only the Dev section; outsiders cannot open the RCA', async ({ browser }) => {
  const owner = await loginAs(browser, 'jogender.kota@rca.local');
  const { rcaPath } = await createRcaViaUi(owner, { workspace: 'Acme Payments (demo)' });

  const dev = await loginAs(browser, 'dev@rca.local');
  await dev.goto(`${rcaPath}/edit?tab=QA`);
  await expect(dev.locator('#QA-why-1')).toBeDisabled();
  await expect(dev.getByText('Only owners, editors and the QA contributor can edit this section.')).toBeVisible();
  await fillSection(dev, rcaPath, 'DEV', 'Arjun Mehta');
  await dev.goto(`${rcaPath}/edit?tab=DEV`);
  await expect(dev.getByTestId('last-edited-DEV')).toContainText('Arjun Mehta');

  // The platform operator is not a member: the RCA does not exist for them.
  const operator = await loginAs(browser, 'admin@rca.local');
  await operator.goto(rcaPath);
  await expect(operator.getByRole('alert')).toContainText('RCA not found');
});
