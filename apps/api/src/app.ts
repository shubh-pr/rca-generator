import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { Router } from 'express';
import { accountRouter, authRouter, publicConfigRouter, requireAuth } from './auth/index.js';
import { config } from './config.js';
import { notFound } from './lib/errors.js';
import { errorHandler } from './lib/errorHandler.js';
import { jsonReplacer } from './lib/json.js';
import { auditRouter } from './routes/audit.js';
import { dashboardRouter } from './routes/dashboard.js';
import { exportsRouter } from './routes/exports.js';
import { rcaAccessMiddleware, rcaRouter } from './routes/rca/index.js';
import { rcasRouter } from './routes/rcas.js';
import { workspacesRouter } from './routes/workspaces.js';

export function createApp() {
  const app = express();
  app.set('json replacer', jsonReplacer);
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);
  app.use(cors({ origin: config.corsOrigin, credentials: true, exposedHeaders: ['Content-Disposition'] }));
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  const api = Router();
  api.get('/health', (_req, res) => {
    res.json({ ok: true });
  });
  api.use(publicConfigRouter);
  api.use(authRouter);
  api.use(accountRouter);

  // Everything below requires a logged-in user and runs inside that user's tenant scope.
  const secured = Router();
  secured.use(requireAuth);
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
  app.use(errorHandler);
  return app;
}
