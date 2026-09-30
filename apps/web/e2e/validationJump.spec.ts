import { expect, test, type Page } from '@playwright/test';
import { signUpAndVerify, uniqueEmail } from './helpers';

/** A new RCA with only the fields needed to create it, so "Submit for review" has plenty to complain about. */
async function bareRca(page: Page) {
  await page.goto('/rcas/new');
  await page.fill('#project_name', 'Payment Gateway');
  await page.selectOption('#severity', 'P2');
  await page.selectOption('#environment', 'PROD');
  await page.fill('#incident_start', '2026-09-27T14:05');
  await page.fill('#summary', 'Validation jump test');
  await page.getByRole('button', { name: 'Create RCA' }).click();
  await page.waitForURL(/\/rcas\/[0-9a-f-]+\/edit/);
  return new URL(page.url()).pathname.replace(/\/edit$/, '');
}

const problem = (page: Page, text: string) => page.getByTestId('workflow-error').getByRole('button', { name: text, exact: true });
const tab = (page: Page, name: RegExp) => page.getByRole('tab', { name });

async function expectJumpedTo(page: Page, selector: string) {
  const el = page.locator(selector);
  await expect(el).toBeFocused();
  await expect(el).toBeInViewport();
  await expect(el).toHaveClass(/jump-highlight/);
  // The flash is temporary.
  await expect(el).not.toHaveClass(/jump-highlight/, { timeout: 5000 });
}

test('failed "Submit for review": each problem opens its tab and focuses the field or the section area', async ({ browser }) => {
  const page = await signUpAndVerify(browser, 'Val Idation', uniqueEmail('jump'));
  const dialogs: string[] = [];
  page.on('dialog', (d) => dialogs.push(d.message())); // the helper's handler accepts them
  await bareRca(page);

  await page.getByRole('button', { name: 'Submit for review' }).click();
  const summary = page.getByTestId('workflow-error');
  await expect(summary).toContainText('Cannot submit for review');
  for (const text of ['Resolved at is missing', 'Users / clients affected is missing', 'DEV section is not submitted', 'DEV section has no root cause (Why 5)', 'QA section has no action']) {
    await expect(problem(page, text)).toBeVisible();
  }

  await test.step('field on another tab: Users / clients affected → Common tab, textbox focused and highlighted', async () => {
    await expect(tab(page, /1 Header/)).toHaveAttribute('aria-selected', 'true');
    await problem(page, 'Users / clients affected is missing').click();
    await expect(tab(page, /2 Common/)).toHaveAttribute('aria-selected', 'true');
    await expectJumpedTo(page, '#impact_users');
    await expect(page).not.toHaveURL(/focus=/);
  });

  await test.step('field in a team section: Why 5 → Dev tab, Why 5 focused (unsaved changes still ask first)', async () => {
    await page.fill('#impact_users', 'Unsaved text');
    await problem(page, 'DEV section has no root cause (Why 5)').click();
    expect(dialogs).toContain('You have unsaved changes. Leave without saving?');
    await expect(tab(page, /3 Dev/)).toHaveAttribute('aria-selected', 'true');
    await expectJumpedTo(page, '#DEV-why-5');
  });

  await test.step('structural: "DEV section is not submitted" → the section\'s Submit button', async () => {
    await page.getByTestId('main-content').evaluate((el) => el.scrollTo(0, el.scrollHeight));
    await problem(page, 'DEV section is not submitted').click();
    await expect(tab(page, /3 Dev/)).toHaveAttribute('aria-selected', 'true');
    await expectJumpedTo(page, '#DEV-submit');
  });

  await test.step('structural: "QA section has no action" → QA tab, Actions area', async () => {
    await problem(page, 'QA section has no action').click();
    await expect(tab(page, /4 QA/)).toHaveAttribute('aria-selected', 'true');
    await expectJumpedTo(page, '#QA-actions');
    await expect(page.locator('#QA-actions')).toContainText('Actions');
  });

  await test.step('"Section is not complete" uses the same clickable list (same tab)', async () => {
    await tab(page, /3 Dev/).click();
    await page.locator('#DEV-submit').click();
    const list = page.getByTestId('section-errors-DEV');
    await expect(list).toContainText('Section is not complete');
    await list.getByRole('button', { name: 'At least one action is required' }).click();
    await expectJumpedTo(page, '#DEV-actions');
    await list.getByRole('button', { name: 'Cause category is required' }).click();
    await expectJumpedTo(page, '#DEV-cause');
  });

  await test.step('header field: Resolved at → Header tab', async () => {
    await problem(page, 'Resolved at is missing').click();
    await expect(tab(page, /1 Header/)).toHaveAttribute('aria-selected', 'true');
    await expectJumpedTo(page, '#resolved_at');
  });
});

test('from the read-only view, a problem opens the form at the field', async ({ browser }) => {
  const page = await signUpAndVerify(browser, 'View Jumper', uniqueEmail('viewjump'));
  const rcaPath = await bareRca(page);
  await page.goto(rcaPath);
  await expect(page.getByTestId('rca-view')).toBeVisible();
  await page.getByRole('button', { name: 'Submit for review' }).click();
  await problem(page, 'Detection method is missing').click();
  await expect(page).toHaveURL(new RegExp(`${rcaPath}/edit\\?tab=common`));
  await expectJumpedTo(page, '#detection_method');
  await expect(page).not.toHaveURL(/focus=/);
});

test('fields checked by "Submit for review" carry a red asterisk before any attempt', async ({ browser }) => {
  const page = await signUpAndVerify(browser, 'Star Marker', uniqueEmail('stars'));
  await page.goto('/rcas/new');
  await expect(page.getByTestId('required-legend')).toContainText('Required before “Submit for review”');
  const rcaPath = await bareRca(page);
  const marked = (forId: string) => page.locator(`label[for="${forId}"]`).getByTestId('required-mark');

  await page.goto(`${rcaPath}/edit?tab=header`);
  await expect(page.getByTestId('required-legend')).toBeVisible();
  for (const id of ['detected_at', 'resolved_at']) await expect(marked(id)).toBeVisible();

  await tab(page, /2 Common/).click();
  for (const id of ['summary', 'impact_users', 'detection_method', 'immediate_fix']) await expect(marked(id)).toBeVisible();
  await expect(marked('immediate_fix_by')).toHaveCount(0);

  await tab(page, /3 Dev/).click();
  for (const id of ['DEV-cause', 'DEV-why-1', 'DEV-why-5', 'DEV-escape']) await expect(marked(id)).toBeVisible();
  for (const id of ['DEV-why-2', 'DEV-why-3', 'DEV-why-4', 'DEV-extra1']) await expect(marked(id)).toHaveCount(0);
  await expect(page.locator('#DEV-actions-title')).toContainText('at least one');
  await expect(page.locator('#DEV-actions-title').getByTestId('required-mark')).toBeVisible();
});
