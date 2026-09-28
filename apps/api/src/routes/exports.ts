import { Router } from 'express';
import { z } from 'zod';
import { currentUser } from '../auth/index.js';
import { prisma } from '../db.js';
import { writeAudit } from '../lib/audit.js';
import { idParam, parse } from '../lib/validate.js';
import { renderDocx } from '../export/docx.js';
import { listTable, toCsv, toXlsx } from '../export/list.js';
import { buildExportModel, exportFileName } from '../export/model.js';
import { renderPdf } from '../export/pdf.js';
import { renderPrintHtml } from '../export/printHtml.js';
import { buildRcaWhere, parseRcaFilters } from '../services/rcaFilters.js';
import { loadFullRca, userRef } from '../services/rcaQueries.js';

export const exportsRouter = Router();

/** entity_id for exports that are not about one RCA (list, blank template). */
const NO_ENTITY = '00000000-0000-0000-0000-000000000000';
const MAX_LIST_ROWS = 50_000;

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

// Registered before /rcas/:id routes so "export" is not taken as an id.
exportsRouter.get('/rcas/export', async (req, res) => {
  const me = currentUser(req);
  const { format, rows } = parse(
    z.object({ format: z.enum(['csv', 'xlsx']), rows: z.enum(['rca', 'actions']).default('rca') }),
    { format: req.query.format, rows: req.query.rows },
  );
  const filters = parseRcaFilters(req.query);
  const rcas = await prisma.rca.findMany({
    where: buildRcaWhere(filters),
    orderBy: [{ rca_date: 'desc' }, { rca_number: 'desc' }],
    take: MAX_LIST_ROWS,
    include: {
      project: { include: { company: true } },
      team_leader: userRef,
      sections: {
        orderBy: { team: 'asc' },
        include: { actions: { orderBy: { seq: 'asc' }, include: { owner: userRef, followup: { select: { id: true } } } } },
      },
    },
  });
  const table = listTable(rcas, rows === 'actions');
  await writeAudit(prisma, {
    entity: 'rca_list',
    entity_id: NO_ENTITY,
    action: 'EXPORT',
    new_value: { format, rows, filters, count: rcas.length },
    user_id: me.id,
  });
  const stamp = new Date().toISOString().slice(0, 10);
  const name = `RCA_list_${rows === 'actions' ? 'actions_' : ''}${stamp}.${format}`;
  res.attachment(name);
  if (format === 'csv') {
    res.type('text/csv; charset=utf-8').send(toCsv(table));
  } else {
    res.type(XLSX).send(await toXlsx(table, rows === 'actions' ? 'Actions' : 'RCAs'));
  }
});

exportsRouter.get('/templates/rca-blank.docx', async (req, res) => {
  const me = currentUser(req);
  const buf = await renderDocx(buildExportModel(null));
  await writeAudit(prisma, { entity: 'template', entity_id: NO_ENTITY, action: 'EXPORT', new_value: { format: 'docx', template: 'blank' }, user_id: me.id });
  res.attachment('RCA_Template.docx').type(DOCX).send(buf);
});

/** Print-optimised HTML; the same HTML is the PDF source. */
exportsRouter.get('/rcas/:id/print', async (req, res) => {
  const me = currentUser(req);
  const { id } = parse(idParam, req.params);
  const rca = await loadFullRca(prisma, id);
  const html = renderPrintHtml(buildExportModel(rca));
  await writeAudit(prisma, { entity: 'rca', entity_id: id, rca_id: id, action: 'EXPORT', new_value: { format: 'print', version: rca.version }, user_id: me.id });
  res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; img-src data:");
  res.type('html').send(html);
});

exportsRouter.get('/rcas/:id/export', async (req, res) => {
  const me = currentUser(req);
  const { id } = parse(idParam, req.params);
  const { format } = parse(z.object({ format: z.enum(['pdf', 'docx']) }), { format: req.query.format });
  const rca = await loadFullRca(prisma, id);
  const model = buildExportModel(rca);
  const buf = format === 'pdf' ? await renderPdf(renderPrintHtml(model)) : await renderDocx(model);
  await writeAudit(prisma, { entity: 'rca', entity_id: id, rca_id: id, action: 'EXPORT', new_value: { format, version: rca.version }, user_id: me.id });
  res.attachment(exportFileName(model, format)).type(format === 'pdf' ? 'application/pdf' : DOCX).send(buf);
});
