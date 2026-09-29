import { expect, test, type Page } from '@playwright/test';
import { createRcaViaUi, signUpAndVerify, uniqueEmail } from './helpers';

/** The document itself must never scroll: all scrolling happens inside the main content area. */
async function expectPageDoesNotScroll(page: Page) {
  const doc = await page.evaluate(() => ({ scrollY: window.scrollY, scrollHeight: document.documentElement.scrollHeight, innerHeight: window.innerHeight }));
  expect(doc.scrollY).toBe(0);
  expect(doc.scrollHeight).toBeLessThanOrEqual(doc.innerHeight);
}

async function expectShellInPlace(page: Page) {
  const sidebar = page.getByTestId('sidebar');
  await expect(sidebar.getByRole('button', { name: 'Log out', exact: true })).toBeInViewport({ ratio: 1 });
  await expect(sidebar.getByRole('link', { name: 'Account settings' })).toBeInViewport({ ratio: 1 });
  await expect(sidebar.getByTestId('current-user')).toBeInViewport({ ratio: 1 });
  await expect(page.getByTestId('breadcrumbs')).toBeInViewport({ ratio: 1 });
  await expectPageDoesNotScroll(page);
}

/** Scroll the main content to the bottom (wheel and programmatic) and return how far it moved. */
async function scrollMain(page: Page) {
  const main = page.getByTestId('main-content');
  const { scrollHeight, clientHeight } = await main.evaluate((el) => ({ scrollHeight: el.scrollHeight, clientHeight: el.clientHeight }));
  expect(scrollHeight, 'the page must be taller than the viewport for this test to mean anything').toBeGreaterThan(clientHeight);
  await main.hover();
  await page.mouse.wheel(0, 5000);
  await expect.poll(() => main.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  await main.evaluate((el) => el.scrollTo(0, el.scrollHeight));
  return main.evaluate((el) => el.scrollTop);
}

test('only the main content scrolls; the sidebar with Log out stays fully visible (desktop, short and mobile viewports)', async ({ browser }) => {
  const page = await signUpAndVerify(browser, 'Lay Out', uniqueEmail('layout'));
  const { rcaPath } = await createRcaViaUi(page, { summary: 'Long page for the scroll test' });

  for (const viewport of [
    { width: 1280, height: 720 },
    { width: 1024, height: 480 },
    { width: 390, height: 844 },
  ]) {
    await test.step(`${viewport.width}x${viewport.height}`, async () => {
      await page.setViewportSize(viewport);
      for (const path of ['/settings', `${rcaPath}/edit?tab=DEV`]) {
        await page.goto(path);
        await expect(page.getByTestId('main-content')).toBeVisible();
        await expectShellInPlace(page);
        expect(await scrollMain(page)).toBeGreaterThan(0);
        await expectShellInPlace(page);
      }
    });
  }

  await test.step('very short window: the account block stays pinned, only the sidebar nav scrolls internally', async () => {
    await page.setViewportSize({ width: 1024, height: 300 });
    await page.goto('/settings');
    await expectShellInPlace(page);
    const nav = page.getByTestId('sidebar-scroll');
    const overflow = await nav.evaluate((el) => el.scrollHeight > el.clientHeight);
    expect(overflow).toBe(true);
    await nav.evaluate((el) => el.scrollTo(0, el.scrollHeight));
    await expect(page.getByTestId('sidebar').getByRole('link', { name: 'Workspaces' })).toBeInViewport();
    await scrollMain(page);
    await expectShellInPlace(page);
  });
});

test('breadcrumbs follow the route: every segment but the last is a link', async ({ browser }) => {
  const page = await signUpAndVerify(browser, 'Bree Crumb', uniqueEmail('crumbs'));
  const { rcaPath, rcaNumber } = await createRcaViaUi(page, { summary: 'Breadcrumb RCA' });
  const crumbs = page.getByTestId('breadcrumbs');
  const trail = async () => (await crumbs.getByRole('listitem').allTextContents()).filter((t) => t !== '/');

  await page.goto(`${rcaPath}/edit?tab=DEV`);
  await expect(crumbs.getByText('Dev section')).toBeVisible();
  await expect.poll(trail).toEqual(['Dashboard', 'RCAs', rcaNumber, 'Dev section']);
  await expect(crumbs.getByRole('link')).toHaveCount(3);
  await expect(crumbs.locator('[aria-current="page"]')).toHaveText('Dev section');
  await expect(crumbs.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('href', '/dashboard');
  await expect(crumbs.getByRole('link', { name: 'RCAs' })).toHaveAttribute('href', '/rcas');
  await expect(crumbs.getByRole('link', { name: rcaNumber })).toHaveAttribute('href', rcaPath);

  // Switching tabs updates the last segment.
  await page.getByRole('tab', { name: /4 QA/ }).click();
  await expect(crumbs.locator('[aria-current="page"]')).toHaveText('QA section');

  // The segments navigate.
  await crumbs.getByRole('link', { name: rcaNumber }).click();
  await expect(page).toHaveURL(new RegExp(`${rcaPath}$`));
  await expect.poll(trail).toEqual(['Dashboard', 'RCAs', rcaNumber]);
  await crumbs.getByRole('link', { name: 'RCAs' }).click();
  await expect(page).toHaveURL(/\/rcas$/);
  await expect.poll(trail).toEqual(['Dashboard', 'RCAs']);

  // Before onboarding, /dashboard redirects to the welcome screen; skipping it lands on the Dashboard itself.
  await page.goto('/welcome');
  await expect.poll(trail).toEqual(['Dashboard', 'Welcome']);
  await page.getByRole('button', { name: /skip/i }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect.poll(trail).toEqual(['Dashboard']);
  await expect(crumbs.getByRole('link')).toHaveCount(0);

  const cases: [string, string[]][] = [
    ['/dashboard', ['Dashboard']],
    ['/rcas/new', ['Dashboard', 'RCAs', 'New RCA']],
    ['/my-tasks', ['Dashboard', 'My tasks']],
    ['/settings', ['Dashboard', 'Account settings']],
    ['/settings/billing', ['Dashboard', 'Account settings', 'Billing']],
    ['/workspaces', ['Dashboard', 'Workspaces']],
  ];
  for (const [path, expected] of cases) {
    await page.goto(path);
    await expect(crumbs.locator('[aria-current="page"]')).toHaveText(expected.at(-1)!);
    await expect.poll(trail, { message: path }).toEqual(expected);
  }

  // A workspace page shows the workspace name.
  await page.goto('/workspaces');
  await page.getByLabel('Workspace name').fill('Crumb team');
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page.getByRole('heading', { name: 'Crumb team' })).toBeVisible();
  await expect.poll(trail).toEqual(['Dashboard', 'Workspaces', 'Crumb team']);
  await crumbs.getByRole('link', { name: 'Workspaces' }).click();
  await expect(page).toHaveURL(/\/workspaces$/);
});
