import { Router } from 'express';
import { takePrintHtml } from '../export/pdf.js';

/**
 * Internal routes, reachable only from the loopback interface (the PDF renderer in this process).
 * Not under /api, so the reverse proxy never forwards them.
 */
export const internalRouter = Router();

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

internalRouter.get('/internal/print/:token', (req, res) => {
  if (!LOOPBACK.has(req.socket.remoteAddress ?? '')) {
    res.status(404).end();
    return;
  }
  const html = takePrintHtml(String(req.params.token));
  if (!html) {
    res.status(404).end();
    return;
  }
  res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; img-src data:");
  res.setHeader('Cache-Control', 'no-store');
  res.type('html').send(html);
});
