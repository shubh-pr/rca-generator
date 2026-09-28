import { Router } from 'express';
import { z } from 'zod';
import { currentUser } from '../../auth/index.js';
import { prisma } from '../../db.js';
import { rcaAudit, writeAudit } from '../../lib/audit.js';
import { parse } from '../../lib/validate.js';
import { renderDocx } from '../../export/docx.js';
import { buildExportModel, exportFileName } from '../../export/model.js';
import { renderPdf } from '../../export/pdf.js';
import { renderPrintHtml } from '../../export/printHtml.js';
import { authorize } from '../../policy/policy.js';
import { loadFullRca } from '../../services/rcaQueries.js';
import { rcaOf } from './access.js';

export const rcaExportsRouter = Router({ mergeParams: true });

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** Print-optimised HTML; the same HTML is the PDF source. */
rcaExportsRouter.get('/print', async (req, res) => {
  const me = currentUser(req);
  const { rca: row, ctx } = rcaOf(req);
  authorize(ctx, 'rca.export');
  const rca = await loadFullRca(prisma, row.id);
  const html = renderPrintHtml(buildExportModel(rca));
  await writeAudit(prisma, rcaAudit(rca, { entity: 'rca', entity_id: rca.id, action: 'EXPORT', new_value: { format: 'print', version: rca.version }, user_id: me.id }));
  res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; img-src data:");
  res.type('html').send(html);
});

rcaExportsRouter.get('/export', async (req, res) => {
  const me = currentUser(req);
  const { rca: row, ctx } = rcaOf(req);
  authorize(ctx, 'rca.export');
  const { format } = parse(z.object({ format: z.enum(['pdf', 'docx']) }), { format: req.query.format });
  const rca = await loadFullRca(prisma, row.id);
  const model = buildExportModel(rca);
  const buf = format === 'pdf' ? await renderPdf(renderPrintHtml(model)) : await renderDocx(model);
  await writeAudit(prisma, rcaAudit(rca, { entity: 'rca', entity_id: rca.id, action: 'EXPORT', new_value: { format, version: rca.version }, user_id: me.id }));
  res.attachment(exportFileName(model, format)).type(format === 'pdf' ? 'application/pdf' : DOCX).send(buf);
});
