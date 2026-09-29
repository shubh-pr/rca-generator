/**
 * Sandboxed PDF rendering. Chromium only ever loads one internal URL carrying a one-time token
 * (GET /internal/print/:token on the API's loopback interface); every other request, including
 * sub-resources, is aborted. JavaScript is disabled, renders time out, and concurrency is limited.
 */
import { chromium, type Browser } from 'playwright';
import { randomToken } from '../auth/tokens.js';
import { config } from '../config.js';
import { HttpError } from '../lib/errors.js';

let browser: Promise<Browser> | null = null;

function getBrowser() {
  browser ??= chromium.launch({ chromiumSandbox: config.pdf.chromiumSandbox, args: config.pdf.chromiumSandbox ? [] : ['--no-sandbox'] }).catch((err) => {
    browser = null;
    throw err;
  });
  return browser;
}

// ---------- One-time print tokens ----------

const TOKEN_TTL_MS = 60_000;
const pending = new Map<string, { html: string; expires: number }>();

/** Store the print HTML for exactly one fetch by the renderer. */
function issuePrintToken(html: string): string {
  const token = randomToken();
  pending.set(token, { html, expires: Date.now() + TOKEN_TTL_MS });
  return token;
}

/** Called by the internal route: returns the HTML once, then the token is gone. */
export function takePrintHtml(token: string): string | null {
  const entry = pending.get(token);
  pending.delete(token);
  if (!entry || entry.expires < Date.now()) return null;
  return entry.html;
}

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of pending) if (v.expires < now) pending.delete(k);
}, TOKEN_TTL_MS).unref();

// ---------- Concurrency limit ----------

let running = 0;
const waiting: (() => void)[] = [];
const MAX_QUEUE = 20;

async function acquire() {
  if (running < config.pdf.concurrency) {
    running += 1;
    return;
  }
  if (waiting.length >= MAX_QUEUE) throw new HttpError(503, 'BUSY', 'PDF export is busy. Please try again in a minute.');
  await new Promise<void>((resolve) => waiting.push(resolve));
  running += 1;
}

function release() {
  running -= 1;
  waiting.shift()?.();
}

/**
 * Render the print HTML to PDF. `baseUrl` is where this API listens (loopback). The @page rules in the
 * HTML supply size, margins, header and footer.
 */
export async function renderPdf(html: string, baseUrl: string): Promise<Buffer> {
  await acquire();
  const token = issuePrintToken(html);
  const target = `${baseUrl}/internal/print/${token}`;
  const b = await getBrowser();
  const context = await b.newContext({ javaScriptEnabled: false, acceptDownloads: false, serviceWorkers: 'block' });
  const timer = setTimeout(() => context.close().catch(() => {}), config.pdf.timeoutMs);
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(config.pdf.timeoutMs);
    // Allow-list of exactly one URL: the one-time print page.
    await context.route('**/*', (route) => (route.request().url() === target ? route.continue() : route.abort('blockedbyclient')));
    await page.emulateMedia({ media: 'print' });
    const res = await page.goto(target, { waitUntil: 'load' });
    if (!res || !res.ok()) throw new Error(`print page returned ${res?.status()}`);
    return await page.pdf({ preferCSSPageSize: true, printBackground: true });
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(503, 'PDF_FAILED', 'Could not generate the PDF. Please try again.');
  } finally {
    clearTimeout(timer);
    await context.close().catch(() => {});
    pending.delete(token);
    release();
  }
}

export async function closePdfBrowser() {
  if (browser) await (await browser).close().catch(() => {});
  browser = null;
}
