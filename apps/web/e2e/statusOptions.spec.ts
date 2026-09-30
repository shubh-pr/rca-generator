import { expect, test, type Locator } from '@playwright/test';
import { createRcaViaUi, signUpAndVerify, uniqueEmail } from './helpers';

const optionTexts = (select: Locator) => select.locator('option').allTextContents();

test('Action Status and section Completion status list Completed with visible text, and it saves and shows', async ({ browser }) => {
  const page = await signUpAndVerify(browser, 'Stella Status', uniqueEmail('status'));
  const { rcaPath } = await createRcaViaUi(page, { summary: 'Status options' });
  await page.goto(`${rcaPath}/edit?tab=DEV`);

  // Action row: every option has text, Completed included.
  await page.getByRole('button', { name: '+ Add action' }).click();
  const actions = page.getByRole('table', { name: 'DEV actions' });
  const status = actions.getByLabel('Status');
  expect(await optionTexts(status)).toEqual(['—', 'Not started', 'In progress', 'Completed']);
  await actions.getByLabel('Action').fill('Add a currency default');
  await actions.getByLabel('Owner').selectOption({ label: 'Stella Status' });
  await actions.getByLabel('Due date').fill('2026-12-31');
  await status.selectOption({ label: 'Completed' });
  await actions.getByLabel('Completed on').fill('2026-12-01');
  await actions.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByTestId('toast').filter({ hasText: 'Action added' })).toBeVisible();
  await expect(actions.getByLabel('Status')).toHaveValue('COMPLETED');
  await expect(actions.getByLabel('Status').locator('option:checked')).toHaveText('Completed');

  // Section Completion status: same options.
  const completion = page.getByTestId('section-DEV').getByLabel('Completion status');
  expect(await optionTexts(completion)).toEqual(['—', 'Not started', 'In progress', 'Completed']);
  await completion.selectOption({ label: 'Completed' });
  // Existing rule (sections.ts): Completed needs an actual date and Verified by, and the form says so.
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByTestId('toast').filter({ hasText: 'Dev section draft not saved' })).toBeVisible();
  await expect(page.getByTestId('section-DEV').getByText('Required when completion is COMPLETED')).toHaveCount(2);
  await page.getByTestId('section-DEV').getByLabel('Actual date').fill('2026-12-02');
  await page.getByTestId('section-DEV').getByLabel('Verified by').fill('Stella Status');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByTestId('toast').filter({ hasText: 'Dev section draft saved' })).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('section-DEV').getByLabel('Completion status').locator('option:checked')).toHaveText('Completed');

  // Read-only view shows the words, not blanks.
  await page.goto(rcaPath);
  await expect(page.getByTestId('rca-view')).toContainText('Completed');
});
