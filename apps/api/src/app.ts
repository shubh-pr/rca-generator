import cors from 'cors';
import express, { Router } from 'express';
import { authRouter, meRouter, requireAuth } from './auth/index.js';
import { config } from './config.js';
import { notFound } from './lib/errors.js';
import { errorHandler } from './lib/errorHandler.js';
import { jsonReplacer } from './lib/json.js';
import { companiesRouter } from './routes/companies.js';
import { projectsRouter } from './routes/projects.js';
import { rcasRouter } from './routes/rcas.js';
import { sectionsRouter } from './routes/sections.js';
import { attachmentsRouter } from './routes/attachments.js';
import { auditRouter } from './routes/audit.js';
import { dashboardRouter } from './routes/dashboard.js';
import { exportsRouter } from './routes/exports.js';
import { followupsRouter } from './routes/followups.js';
import { workflowRouter } from './routes/workflow.js';
import { usersRouter } from './routes/users.js';

export function createApp() {
  const app = express();
  app.set('json replacer', jsonReplacer);
  app.disable('x-powered-by');
  app.use(cors({ origin: config.corsOrigin, exposedHeaders: ['Content-Disposition'] }));
  app.use(express.json({ limit: '1mb' }));

  const api = Router();
  api.get('/health', (_req, res) => {
    res.json({ ok: true });
  });
  api.use(authRouter);
  api.use(meRouter);

  // Everything below requires a logged-in user.
  const secured = Router();
  secured.use(requireAuth);
  secured.use(usersRouter);
  secured.use(companiesRouter);
  secured.use(projectsRouter);
  secured.use(exportsRouter);
  secured.use(rcasRouter);
  secured.use(sectionsRouter);
  secured.use(workflowRouter);
  secured.use(followupsRouter);
  secured.use(attachmentsRouter);
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
