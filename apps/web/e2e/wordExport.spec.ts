import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import JSZip from 'jszip';
import { createRcaViaUi, readDownload, signUpAndVerify, STRONG_PASSWORD, tokenFromMail, uniqueEmail } from './helpers';

/** Bearer token for direct API calls, bypassing the UI entirely. */
async function apiToken(request: APIRequestContext, email: string) {
  const res = await request.post('/api/v1/auth/login', { data: { email, password: STRONG_PASSWORD } });
  expect(res.ok()).toBe(true);
  return (await res.json()).access_token as string;
}

async function downloadWord(page: Page) {
  const [file] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Word', exact: true }).click()]);
  const buf = await readDownload(file);
  expect(buf.subarray(0, 2).toString()).toBe('PK');
  const zip = await JSZip.loadAsync(buf);
  const headers = await Promise.all(Object.keys(zip.files).filter((f) => /word\/header\d*\.xml/.test(f)).map((f) => zip.file(f)!.async('string')));
  return { name: file.suggestedFilename(), watermarked: headers.join('').includes('FREE PLAN') };
}

test('unpaid RCA: Word is replaced by "Unlock to get Word", the API refuses it (403); unlocking makes Word available without watermark', async ({ browser, request }) => {
  const email = uniqueEmail('wordgate');
  const page = await signUpAndVerify(browser, 'Walt Word', email);
  const { rcaPath } = await createRcaViaUi(page, { summary: 'Word gating' });
  const rcaId = rcaPath.split('/').pop()!;

  await page.goto(rcaPath);
  await expect(page.getByTestId('word-locked')).toContainText('Unlock to get Word');
  await expect(page.getByRole('button', { name: 'Word', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'PDF' })).toBeEnabled(); // PDF stays available (watermarked)

  // Direct API call: the server is the gate, not the hidden button.
  const token = await apiToken(request, email);
  const direct = await request.get(`/api/v1/rcas/${rcaId}/export?format=docx`, { headers: { Authorization: `Bearer ${token}` } });
  expect(direct.status()).toBe(403);
  expect((await direct.json()).error).toBe('PAYMENT_REQUIRED');
  const pdf = await request.get(`/api/v1/rcas/${rcaId}/export?format=pdf`, { headers: { Authorization: `Bearer ${token}` } });
  expect(pdf.status()).toBe(200);

  // The prompt runs the same unlock checkout as the watermark bar.
  await page.getByTestId('word-locked').click();
  await page.waitForURL(/\/billing\/test-checkout\//);
  await page.getByRole('button', { name: 'Simulate successful payment' }).click();
  await page.waitForURL(/checkout=done/);
  await expect(page.getByTestId('word-locked')).toHaveCount(0);
  expect(await downloadWord(page)).toMatchObject({ watermarked: false });
  expect((await request.get(`/api/v1/rcas/${rcaId}/export?format=docx`, { headers: { Authorization: `Bearer ${token}` } })).status()).toBe(200);
});

test('subscribed workspace: Word works for any RCA, without watermark', async ({ browser }) => {
  const page = await signUpAndVerify(browser, 'Sue Scriber', uniqueEmail('wordsub'));
  const workspace = "Sue Scriber's workspace";
  await page.goto('/settings/billing');
  await page.getByRole('region', { name: `Billing for ${workspace}` }).getByRole('button', { name: 'Subscribe to Solo' }).click();
  await page.waitForURL(/\/billing\/test-checkout\//);
  await page.getByRole('button', { name: 'Simulate successful payment' }).click();
  await page.waitForURL(/\/settings\/billing\?checkout=done/);

  const { rcaPath } = await createRcaViaUi(page, { summary: 'Subscribed Word export' });
  await page.goto(rcaPath);
  await expect(page.getByTestId('word-locked')).toHaveCount(0);
  expect(await downloadWord(page)).toMatchObject({ watermarked: false });
});

test('blank template: logged-out visitors go to sign-up; an unverified new account downloads after logging in; a verified user downloads directly', async ({ browser }) => {
  // Logged out: the landing page link leads to sign-up, and the API refuses anonymous requests.
  const visitor = await (await browser.newContext()).newPage();
  await visitor.goto('/');
  await visitor.getByTestId('cta-template').click();
  await expect(visitor).toHaveURL(/\/signup\?next=%2Ftemplate$/);
  expect((await visitor.request.get('/api/v1/templates/rca-blank.docx')).status()).toBe(401);

  // Sign up; do NOT verify. Logging in is enough, and the download starts by itself.
  const email = uniqueEmail('tmpl');
  await visitor.fill('#name', 'Tina Template');
  await visitor.fill('#email', email);
  await visitor.fill('#password', STRONG_PASSWORD);
  await visitor.getByTestId('accept-terms').check();
  await visitor.getByRole('button', { name: 'Create account' }).click();
  await expect(visitor.getByRole('heading', { name: 'Check your email' })).toBeVisible();
  await tokenFromMail(email, 'verify-email'); // the verification email exists, but we ignore it
  await visitor.getByTestId('go-login').click();
  await expect(visitor).toHaveURL(/\/login\?next=%2Ftemplate$/);
  await visitor.fill('#email', email);
  await visitor.fill('#password', STRONG_PASSWORD);
  const [unverifiedDownload] = await Promise.all([visitor.waitForEvent('download'), visitor.click('button[type=submit]')]);
  expect(unverifiedDownload.suggestedFilename()).toBe('RCA_Template.docx');
  expect((await readDownload(unverifiedDownload)).subarray(0, 2).toString()).toBe('PK');
  await expect(visitor.getByTestId('template-started')).toBeVisible();

  // Verified user: straight download from the same link.
  const verified = await signUpAndVerify(browser, 'Vera Verified', uniqueEmail('tmplv'));
  const [verifiedDownload] = await Promise.all([verified.waitForEvent('download'), verified.goto('/template')]);
  expect(verifiedDownload.suggestedFilename()).toBe('RCA_Template.docx');
  await expect(verified.getByTestId('template-started')).toBeVisible();
});
