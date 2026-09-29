/**
 * Sign in with Google / Microsoft through the real app pages and the fake provider (e2e/mockOidc.mjs):
 * the full redirect flow (start → provider page → callback → session) without calling Google or Microsoft.
 */
import { expect, test, type Browser, type Page } from '@playwright/test';
import { signUpAndVerify, STRONG_PASSWORD, uniqueEmail } from './helpers';

type Account = { email: string; sub: string; name?: string; verified?: boolean; msAccount?: 'personal' | 'work' | 'work_edov' };

async function newPage(browser: Browser) {
  const page = await (await browser.newContext()).newPage();
  page.on('dialog', (d) => d.accept());
  return page;
}

/** On the fake provider's sign-in page: fill the account and continue (or cancel). */
async function atProvider(page: Page, provider: 'google' | 'microsoft', a: Account, cancel = false) {
  await expect(page.getByRole('heading', { name: new RegExp(`Mock ${provider === 'google' ? 'Google' : 'Microsoft'} sign-in`) })).toBeVisible();
  if (cancel) return page.getByRole('button', { name: 'Cancel' }).click();
  await page.getByLabel('Email', { exact: true }).fill(a.email);
  await page.getByLabel('Name').fill(a.name ?? '');
  await page.getByLabel('Subject').fill(a.sub);
  if (provider === 'google') await page.getByLabel('Email verified').setChecked(a.verified ?? true);
  else await page.getByLabel('Account type').selectOption(a.msAccount ?? 'personal');
  await page.getByRole('button', { name: 'Continue' }).click();
}

async function providerSignIn(page: Page, from: '/login' | '/signup', provider: 'google' | 'microsoft', a: Account) {
  await page.goto(from);
  await page.getByTestId(`${provider}-signin`).click();
  await atProvider(page, provider, a);
}

async function logOut(page: Page) {
  await page.getByTestId('sidebar').getByRole('button', { name: 'Log out', exact: true }).click();
  await expect(page.getByTestId('current-user')).toHaveCount(0);
}

const method = (page: Page, key: string) => page.getByTestId(`method-${key}`);

test('login and sign-up pages show both provider buttons with the providers\' own marks', async ({ browser }) => {
  const page = await newPage(browser);
  for (const path of ['/login', '/signup']) {
    await page.goto(path);
    await expect(page.getByTestId('google-signin')).toHaveText('Sign in with Google');
    await expect(page.getByTestId('microsoft-signin')).toHaveText('Sign in with Microsoft');
    await expect(page.getByTestId('google-signin')).toHaveAttribute('href', /^\/api\/v1\/auth\/google\/start/);
    await expect(page.getByTestId('microsoft-signin')).toHaveAttribute('href', /^\/api\/v1\/auth\/microsoft\/start/);
    // Email and password stay available.
    await expect(page.locator('#email')).toBeVisible();
    await expect(page.locator('#password')).toBeVisible();
  }
});

test('first sign-in with Google creates the account; the last method cannot be disconnected until a password is set', async ({ browser }) => {
  const page = await newPage(browser);
  const email = uniqueEmail('gnew');
  await providerSignIn(page, '/signup', 'google', { email, sub: `g-${email}`, name: 'Gina Google' });
  await expect(page.getByTestId('current-user')).toHaveText('Gina Google');
  await expect(page).toHaveURL(/\/welcome$/); // new account: onboarding, personal workspace ready
  await expect(page.getByTestId('verify-banner')).toHaveCount(0); // the provider verified the email

  await page.goto('/settings');
  await expect(method(page, 'google')).toContainText(`Connected as ${email}`);
  await expect(method(page, 'password')).toContainText('No password yet');
  await expect(method(page, 'google').getByRole('button', { name: 'Disconnect Google' })).toBeDisabled();
  await expect(method(page, 'google')).toContainText('This is your only way to sign in');

  await page.getByLabel('New password').fill(STRONG_PASSWORD);
  await page.getByRole('button', { name: 'Set password' }).click();
  await expect(method(page, 'password')).toContainText('Password set');
  await method(page, 'google').getByRole('button', { name: 'Disconnect Google' }).click();
  await expect(method(page, 'google')).toContainText('Not connected');
  await expect(method(page, 'google').getByTestId('google-connect')).toBeVisible();

  await logOut(page);
  await page.goto('/login');
  await page.fill('#email', email);
  await page.fill('#password', STRONG_PASSWORD);
  await page.click('button[type=submit]');
  await expect(page.getByTestId('current-user')).toHaveText('Gina Google');
});

test('an existing email+password account signs in with Microsoft (verified personal account): linked, not duplicated', async ({ browser }) => {
  const email = uniqueEmail('mlink');
  const original = await signUpAndVerify(browser, 'Mia Password', email);
  await original.context().close();

  const page = await newPage(browser);
  await providerSignIn(page, '/login', 'microsoft', { email, sub: `m-${email}`, name: 'Some Other Name', msAccount: 'personal' });
  await expect(page.getByTestId('current-user')).toHaveText('Mia Password');
  await page.goto('/settings');
  await expect(method(page, 'microsoft')).toContainText(`Connected as ${email}`);
  await expect(method(page, 'password')).toContainText('Password set');
  // With two methods, either can be disconnected.
  await expect(method(page, 'microsoft').getByRole('button', { name: 'Disconnect Microsoft' })).toBeEnabled();
});

test('unverified provider emails are refused with a clear message and no session (Google unverified, Microsoft work account without verified domain)', async ({ browser }) => {
  const email = uniqueEmail('victim');
  const victim = await signUpAndVerify(browser, 'Val Victim', email);
  await victim.context().close();

  const page = await newPage(browser);
  await providerSignIn(page, '/login', 'google', { email, sub: `g-attacker-${email}`, verified: false });
  await expect(page).toHaveURL(/\/login\?error=email_not_verified&provider=google/);
  await expect(page.getByTestId('oauth-error')).toContainText('Google did not confirm that this email address is verified');
  await expect(page.getByTestId('current-user')).toHaveCount(0);

  await providerSignIn(page, '/login', 'microsoft', { email, sub: `m-attacker-${email}`, msAccount: 'work' });
  await expect(page.getByTestId('oauth-error')).toContainText('Microsoft did not confirm that this email address is verified');
  await expect(page.getByTestId('current-user')).toHaveCount(0);

  // A work account whose domain Entra verified (xms_edov) is accepted.
  await providerSignIn(page, '/login', 'microsoft', { email, sub: `m-real-${email}`, msAccount: 'work_edov' });
  await expect(page.getByTestId('current-user')).toHaveText('Val Victim');
});

test('connect Google from Account settings (different email), then sign in with it; cancelling at the provider is handled', async ({ browser }) => {
  const email = uniqueEmail('linker');
  const page = await signUpAndVerify(browser, 'Lin Linker', email);
  const googleEmail = uniqueEmail('lin.personal');

  await page.goto('/settings');
  await method(page, 'google').getByTestId('google-connect').click();
  await atProvider(page, 'google', { email: googleEmail, sub: `g-${googleEmail}` }, true);
  await expect(page.getByTestId('link-error')).toContainText('Google sign-in was cancelled');

  await method(page, 'google').getByTestId('google-connect').click();
  await atProvider(page, 'google', { email: googleEmail, sub: `g-${googleEmail}` });
  await expect(page).toHaveURL(/\/settings\?linked=google/);
  await expect(page.getByText('Google is connected')).toBeVisible();
  await expect(method(page, 'google')).toContainText(`Connected as ${googleEmail}`);

  await logOut(page);
  await providerSignIn(page, '/login', 'google', { email: googleEmail, sub: `g-${googleEmail}` });
  await expect(page.getByTestId('current-user')).toHaveText('Lin Linker');
});
