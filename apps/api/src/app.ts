import { randomUUID } from 'node:crypto';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { Router } from 'express';
import helmet from 'helmet';
import { accountRouter, authRouter, publicConfigRouter, requireAuth } from './auth/index.js';
import { config } from './config.js';
import { prisma } from './db.js';
import { notFound } from './lib/errors.js';
import { errorHandler } from './lib/errorHandler.js';
import { jsonReplacer } from './lib/json.js';
import { logger } from './lib/logger.js';
import { adminRouter } from './routes/admin.js';
import { auditRouter } from './routes/audit.js';
import { dashboardRouter } from './routes/dashboard.js';
import { exportsRouter } from './routes/exports.js';
import { internalRouter } from './routes/internal.js';
import { invitationsRouter } from './routes/invitations.js';
import { meDataRouter } from './routes/me.js';
import { rcaAccessMiddleware, rcaRouter } from './routes/rca/index.js';
import { rcasRouter } from './routes/rcas.js';
import { workspacesRouter } from './routes/workspaces.js';
import { storage } from './storage/index.js';

export function createApp() {
  const app = express();
  app.set('json replacer', jsonReplacer);
  app.set('trust proxy', config.trustProxy);
  app.disable('x-powered-by');

  // Security headers. The API only returns JSON and downloads, so the CSP is "nothing"; the print
  // routes set their own narrower policy.
  app.use(
    helmet({
      contentSecurityPolicy: { useDefaults: false, directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
      crossOriginResourcePolicy: { policy: 'same-origin' },
      hsts: config.isProd ? { maxAge: 31_536_000, includeSubDomains: true } : false,
    }),
  );

  // Access log: method, path without query string (tokens may live there), status, duration.
  app.use((req, res, next) => {
    const started = process.hrtime.bigint();
    const id = randomUUID();
    res.setHeader('X-Request-Id', id);
    res.on('finish', () => {
      logger.info('request', {
        request_id: id,
        method: req.method,
        path: req.path,
        status: res.statusCode,
        duration_ms: Number((process.hrtime.bigint() - started) / 1_000_000n),
      });
    });
    next();
  });

  // Liveness and readiness (not under /api, so they are not exposed through the proxy's /api route).
  app.get('/healthz', (_req, res) => {
    res.json({ ok: true });
  });
  app.get('/readyz', async (_req, res) => {
    try {
      await prisma.$queryRawUnsafe('SELECT 1');
      await storage().check();
      res.json({ ok: true });
    } catch (err) {
      logger.warn('readiness check failed', { error: String(err) });
      res.status(503).json({ ok: false });
    }
  });
  app.use(internalRouter);

  // Strict CORS: only the web app's origin, with credentials for the refresh cookie.
  app.use(cors({ origin: (origin, cb) => cb(null, origin === config.corsOrigin), credentials: true, exposedHeaders: ['Content-Disposition'] }));
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false, limit: '100kb' }));
  app.use(cookieParser());

  const api = Router();
  api.get('/health', (_req, res) => {
    res.json({ ok: true });
  });
  api.use(publicConfigRouter);
  api.use(authRouter);
  api.use(accountRouter);
  api.use(invitationsRouter);

  // Everything below requires a logged-in user and runs inside that user's tenant scope.
  const secured = Router();
  secured.use(requireAuth);
  secured.use(meDataRouter);
  secured.use(adminRouter);
  secured.use(workspacesRouter);
  secured.use(exportsRouter); // before /rcas/:id so "export" is not taken as an id
  secured.use(rcasRouter);
  secured.use('/rcas/:id', rcaAccessMiddleware, rcaRouter);
  secured.use(auditRouter);
  secured.use(dashboardRouter);
  api.use(secured);

  api.use(() => {
    throw notFound('Route not found');
  });

  app.use('/api/v1', api);
  app.use((_req, res) => {
    res.status(404).json({ error: 'NOT_FOUND', message: 'Not found' });
  });
  app.use(errorHandler);
  return app;
}
