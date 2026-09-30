import { expect, test, type Page } from '@playwright/test';
import { createRcaViaUi, signUpAndVerify, STRONG_PASSWORD, uniqueEmail } from './helpers';

/** Record every write to the Dev section: what version was sent and what came back. */
function recordWrites(page: Page) {
  const writes: { sent: number; status?: number; error?: string }[] = [];
  page.on('request', (r) => {
    if (/\/sections\/DEV(\/submit)?$/.test(new URL(r.url()).pathname) && r.method() !== 'GET') writes.push({ sent: JSON.parse(r.postData() ?? '{}').version });
  });
  page.on('response', async (r) => {
    if (/\/sections\/DEV(\/submit)?$/.test(new URL(r.url()).pathname) && r.request().method() !== 'GET') {
      const w = writes.find((x) => x.status === undefined);
      if (w) Object.assign(w, { status: r.status(), error: (await r.json().catch(() => ({}))).error });
    }
  });
  return writes;
}

/** Slow down section writes so overlaps are deterministic. */
async function slowWrites(page: Page, ms = 700) {
  await page.route('**/sections/DEV**', async (route) => {
    if (route.request().method() !== 'GET') await new Promise((r) => setTimeout(r, ms));
    await route.continue();
  });
}

const noConflict = async (page: Page, writes: { error?: string }[]) => {
  await expect(page.getByTestId('conflict-DEV')).toHaveCount(0);
  expect(writes.filter((w) => w.error === 'VERSION_CONFLICT')).toEqual([]);
};

test('auto-save then an immediate manual Save draft from the same tab: no false conflict, nothing typed is lost', async ({ browser }) => {
  const page = await signUpAndVerify(browser, 'Solo Sam', uniqueEmail('solo'));
  await page.clock.install();
  const { rcaPath } = await createRcaViaUi(page, { summary: 'Solo conflicts' });
  await page.goto(`${rcaPath}/edit?tab=DEV`);
  const writes = recordWrites(page);
  await slowWrites(page);

  // Edit, let the 60 s auto-save fire, keep typing while it is in flight, then save by hand at once.
  await page.fill('#DEV-why-1', 'Auto-saved text');
  await page.clock.fastForward(61_000);
  await page.fill('#DEV-why-2', 'Typed during the auto-save');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByTestId('toast').filter({ hasText: 'Dev section draft saved' })).toBeVisible();

  await noConflict(page, writes);
  expect(writes.map((w) => [w.sent, w.status])).toEqual([
    [1, 200],
    [2, 200],
  ]);
  // Nothing was thrown away, before or after a reload.
  await expect(page.locator('#DEV-why-2')).toHaveValue('Typed during the auto-save');
  await page.unroute('**/sections/DEV**');
  await page.reload();
  await expect(page.locator('#DEV-why-1')).toHaveValue('Auto-saved text');
  await expect(page.locator('#DEV-why-2')).toHaveValue('Typed during the auto-save');
  await expect(page.getByTestId('section-DEV').getByText('version 3')).toBeVisible();
});

test('Submit section while an auto-save is in flight waits for it and sends the new version (no false conflict)', async ({ browser }) => {
  const page = await signUpAndVerify(browser, 'Solo Sue', uniqueEmail('solosubmit'));
  await page.clock.install();
  const { rcaPath } = await createRcaViaUi(page, { summary: 'Submit during auto-save' });
  await page.goto(`${rcaPath}/edit?tab=DEV`);
  const writes = recordWrites(page);
  await slowWrites(page);

  await page.fill('#DEV-why-1', 'Before submit');
  await page.clock.fastForward(61_000); // auto-save starts
  await page.getByRole('button', { name: 'Submit section' }).click();
  // The section is incomplete, so Submit is refused by validation, which is correct. It must not be a 409.
  await expect(page.getByTestId('section-errors-DEV')).toBeVisible();
  await noConflict(page, writes);
  expect(writes.map((w) => w.sent)).toEqual([1, 2]);
  expect(writes.map((w) => w.status)).toEqual([200, 422]);
});

test('the same user in two tabs: a real conflict, explained as "another tab", not "someone else"', async ({ browser }) => {
  const email = uniqueEmail('twotabs');
  const tab1 = await signUpAndVerify(browser, 'Two Tabs', email);
  const { rcaPath } = await createRcaViaUi(tab1, { summary: 'Two tabs' });
  await tab1.goto(`${rcaPath}/edit?tab=DEV`);

  const tab2 = await (await browser.newContext()).newPage();
  await tab2.goto('/login');
  await tab2.fill('#email', email);
  await tab2.fill('#password', STRONG_PASSWORD);
  await tab2.click('button[type=submit]');
  await tab2.getByTestId('current-user').waitFor();
  await tab2.goto(`${rcaPath}/edit?tab=DEV`);
  await tab2.fill('#DEV-why-1', 'Saved in tab 2');
  await tab2.getByRole('button', { name: 'Save draft' }).click();
  await expect(tab2.getByTestId('toast').filter({ hasText: 'Dev section draft saved' })).toBeVisible();

  await tab1.fill('#DEV-why-2', 'Saved in tab 1');
  await tab1.getByRole('button', { name: 'Save draft' }).click();
  const banner = tab1.getByTestId('conflict-DEV');
  await expect(banner).toContainText('This section was saved from another tab or window since you opened it here. Reload to continue.');
  await expect(banner).not.toContainText('someone else');
  await expect(tab1.getByTestId('toast').filter({ hasText: 'another tab or window' })).toBeVisible();

  // Reload takes the other tab's version.
  await tab1.getByRole('button', { name: 'Reload' }).click();
  await expect(tab1.locator('#DEV-why-1')).toHaveValue('Saved in tab 2');
  await expect(banner).toHaveCount(0);
});
