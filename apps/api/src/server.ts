import { createApp } from './app.js';
import { config } from './config.js';
import { disconnectDb } from './db.js';
import { flushEmails } from './email/index.js';
import { closePdfBrowser } from './export/pdf.js';
import { startJobs, stopJobs } from './jobs/index.js';
import { logger } from './lib/logger.js';

const app = createApp();
const server = app.listen(config.port, () => {
  logger.info('api listening', { port: config.port, env: config.env });
});
// Slightly above typical proxy keep-alive, so the proxy closes idle connections first.
server.keepAliveTimeout = 65_000;
server.headersTimeout = 66_000;
startJobs();

let stopping = false;
async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  logger.info('shutting down', { signal });
  const force = setTimeout(() => process.exit(1), 15_000);
  force.unref();
  server.close();
  stopJobs();
  await Promise.allSettled([flushEmails(), closePdfBrowser()]);
  await disconnectDb();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('unhandledRejection', (err) => logger.error('unhandled rejection', { error: String(err) }));
