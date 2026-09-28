import { chromium, type Browser } from 'playwright';

let browser: Promise<Browser> | null = null;

function getBrowser() {
  browser ??= chromium.launch({ args: ['--no-sandbox'] }).catch((err) => {
    browser = null;
    throw err;
  });
  return browser;
}

/** Render the /print HTML with headless Chromium; @page rules supply size, margins, header and footer. */
export async function renderPdf(html: string): Promise<Buffer> {
  const b = await getBrowser();
  const context = await b.newContext({ javaScriptEnabled: false });
  try {
    const page = await context.newPage();
    await page.emulateMedia({ media: 'print' });
    await page.setContent(html, { waitUntil: 'load' });
    return await page.pdf({ preferCSSPageSize: true, printBackground: true });
  } finally {
    await context.close();
  }
}

export async function closePdfBrowser() {
  if (browser) await (await browser).close();
  browser = null;
}
