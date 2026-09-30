import { expect, test, type Page } from '@playwright/test';
import { signUpAndVerify, uniqueEmail } from './helpers';

async function bareRca(page: Page) {
  await page.goto('/rcas/new');
  await page.fill('#project_name', 'Payment Gateway');
  await page.selectOption('#severity', 'P2');
  await page.selectOption('#environment', 'PROD');
  await page.fill('#incident_start', '2026-09-27T14:05');
  await page.fill('#summary', 'Save feedback test');
  await page.getByRole('button', { name: 'Create RCA' }).click();
  await page.waitForURL(/\/rcas\/[0-9a-f-]+\/edit/);
  return new URL(page.url()).pathname.replace(/\/edit$/, '');
}

const toast = (page: Page, text: string) => page.getByTestId('toast').filter({ hasText: text });

/** Saved → back to the normal, enabled label after the confirmation period. */
async function expectConfirmedThenReady(page: Page, label: string) {
  const button = page.getByRole('button', { name: label, exact: true });
  await expect(button).toHaveAttribute('data-state', 'saved');
  await expect(button).toContainText('Saved');
  await expect(button).toHaveAttribute('data-state', 'idle', { timeout: 5000 });
  await expect(button).toHaveText(label);
  await expect(button).toBeEnabled();
}

test('RCA form: toast, button states and the unsaved indicator on Save common sections, Save header and Save draft', async ({ browser }) => {
  const page = await signUpAndVerify(browser, 'Sally Saver', uniqueEmail('saver'));
  const rcaPath = await bareRca(page);
  const patches: string[] = [];
  page.on('request', (r) => r.method() !== 'GET' && r.url().includes('/api/v1/rcas/') && patches.push(`${r.method()} ${new URL(r.url()).pathname}`));

  await test.step('Common sections: unsaved indicator, toast, Saved, then enabled again', async () => {
    await page.getByRole('tab', { name: /2 Common/ }).click();
    await expect(page.getByTestId('unsaved-indicator')).toHaveCount(0);
    await page.fill('#impact_users', 'All card customers');
    await expect(page.getByTestId('unsaved-indicator')).toBeVisible();
    await expect(page.getByTestId('tab-unsaved')).toBeVisible();
    await page.getByRole('button', { name: 'Save common sections' }).click();
    await expect(toast(page, 'Common sections saved')).toBeVisible();
    await expect(toast(page, 'Common sections saved')).toHaveAttribute('data-tone', 'success');
    await expect(page.getByTestId('unsaved-indicator')).toHaveCount(0);
    await expect(page.getByTestId('tab-unsaved')).toHaveCount(0);
    await expectConfirmedThenReady(page, 'Save common sections');
    // The toast dismisses itself.
    await expect(toast(page, 'Common sections saved')).toHaveCount(0, { timeout: 5000 });
  });

  await test.step('saving again with no edits says so and sends nothing', async () => {
    const before = patches.length;
    await page.getByRole('button', { name: 'Save common sections' }).click();
    await expect(toast(page, 'No changes to save')).toBeVisible();
    expect(patches.length).toBe(before);
    // After more edits it saves again.
    await page.fill('#immediate_fix', 'Rolled back release');
    await page.getByRole('button', { name: 'Save common sections' }).click();
    await expect(toast(page, 'Common sections saved')).toBeVisible();
    expect(patches.length).toBe(before + 1);
  });

  await test.step('Header: validation failure is an error toast, never silent', async () => {
    await page.getByRole('tab', { name: /1 Header/ }).click();
    await page.fill('#detected_at', '2026-09-27T13:00'); // before the incident start
    await page.getByRole('button', { name: 'Save header' }).click();
    await expect(toast(page, 'Header not saved: check the highlighted fields.')).toHaveAttribute('data-tone', 'error');
    await expect(page.getByTestId('unsaved-indicator')).toBeVisible(); // still unsaved
    await page.fill('#detected_at', '2026-09-27T14:15');
    await page.getByRole('button', { name: 'Save header' }).click();
    await expect(toast(page, 'Header saved')).toBeVisible();
    await expectConfirmedThenReady(page, 'Save header');
  });

  await test.step('network failure: error toast with a clear message', async () => {
    await page.fill('#ticket_id', 'INC-1');
    await page.route('**/api/v1/rcas/*', (route) => (route.request().method() === 'PATCH' ? route.abort('failed') : route.continue()));
    await page.getByRole('button', { name: 'Save header' }).click();
    await expect(toast(page, 'Header not saved: the server could not be reached')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save header' })).toBeEnabled();
    await page.unroute('**/api/v1/rcas/*');
    await page.getByRole('button', { name: 'Save header' }).click();
    await expect(toast(page, 'Header saved')).toBeVisible();
  });

  await test.step('Dev section: Save draft confirms and does not lock the section', async () => {
    await page.getByRole('tab', { name: /3 Dev/ }).click();
    await page.fill('#DEV-why-1', 'API returned 500');
    await expect(page.getByTestId('unsaved-indicator')).toBeVisible();
    await page.getByRole('button', { name: 'Save draft' }).click();
    await expect(toast(page, 'Dev section draft saved')).toBeVisible();
    await expectConfirmedThenReady(page, 'Save draft');
    await expect(page.locator('#DEV-why-1')).toBeEnabled();
    await page.fill('#DEV-why-2', 'Missing currency');
    await page.getByRole('button', { name: 'Save draft' }).click();
    await expect(page.getByTestId('section-DEV').getByText('version 3')).toBeVisible();
  });

  await test.step('Action row: toast on add', async () => {
    await page.getByRole('button', { name: '+ Add action' }).click();
    const actions = page.getByRole('table', { name: 'DEV actions' });
    await actions.getByLabel('Action').fill('Add a currency default');
    await actions.getByLabel('Due date').fill('2026-12-31');
    // Missing owner: refused, and said so.
    await actions.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByTestId('toast').filter({ hasText: 'Action not saved' })).toHaveAttribute('data-tone', 'error');
    await actions.getByLabel('Owner').selectOption({ label: 'Sally Saver' });
    await actions.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(toast(page, 'Action added')).toBeVisible();
  });

  expect(rcaPath).toContain('/rcas/');
});

test('outside the RCA form: profile, password and workspace rename give the same feedback', async ({ browser }) => {
  const page = await signUpAndVerify(browser, 'Oscar Other', uniqueEmail('other'));

  await page.goto('/settings');
  await page.fill('#profile-name', 'Oscar Renamed');
  await expect(page.getByTestId('unsaved-indicator')).toBeVisible();
  await page.getByRole('button', { name: 'Save profile' }).click();
  await expect(toast(page, 'Profile saved')).toBeVisible();
  await expect(page.getByTestId('unsaved-indicator')).toHaveCount(0);
  await expectConfirmedThenReady(page, 'Save profile');

  await page.fill('#pw-current', 'wrong-password-1234');
  await page.fill('#pw-new', 'Another-Harbour-Lantern-7');
  await page.getByRole('button', { name: 'Change password' }).click();
  await expect(page.getByTestId('toast').filter({ hasText: 'Password not saved' })).toHaveAttribute('data-tone', 'error');

  await page.goto('/workspaces');
  await page.getByLabel('Workspace name').fill('Feedback team');
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page.getByRole('heading', { name: 'Feedback team' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Workspace name' }).fill('Feedback team renamed');
  await page.getByRole('button', { name: 'Rename', exact: true }).click();
  await expect(toast(page, 'Workspace renamed')).toBeVisible();
  await expectConfirmedThenReady(page, 'Rename');
});
