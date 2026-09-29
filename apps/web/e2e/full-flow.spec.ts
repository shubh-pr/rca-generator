import { expect, test } from '@playwright/test';
import { createRcaViaUi, fillSection, loginAs } from './helpers';

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
