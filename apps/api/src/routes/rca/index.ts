import { Router } from 'express';
import { rcaAccessMiddleware } from './access.js';
import { attachmentsRouter } from './attachments.js';
import { collaboratorsRouter } from './collaborators.js';
import { rcaAuditRouter } from './audit.js';
import { coreRouter } from './core.js';
import { rcaExportsRouter } from './exports.js';
import { followupsRouter } from './followups.js';
import { sectionsRouter } from './sections.js';
import { timelineRouter } from './timeline.js';
import { workflowRouter } from './workflow.js';

/**
 * Every route about one RCA. Mounted at /rcas/:id behind rcaAccessMiddleware, so each of them
 * resolves the caller's access first (404 when not visible). test/isolation.test.ts checks every
 * route registered here against its coverage table.
 */
export const rcaRouter = Router({ mergeParams: true });
rcaRouter.use(coreRouter);
rcaRouter.use(timelineRouter);
rcaRouter.use(sectionsRouter);
rcaRouter.use(workflowRouter);
rcaRouter.use(followupsRouter);
rcaRouter.use(attachmentsRouter);
rcaRouter.use(rcaAuditRouter);
rcaRouter.use(rcaExportsRouter);
rcaRouter.use(collaboratorsRouter);

export { rcaAccessMiddleware };
