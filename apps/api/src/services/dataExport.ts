/**
 * "Export my data" (GDPR Art. 15/20, DPDP s.11): a zip with the account, memberships, security log,
 * every RCA in workspaces the user primarily owns (JSON + PDF), and the files the user uploaded.
 */
import type { Response } from 'express';
import archiver from 'archiver';
import { prisma } from '../db.js';
import { buildExportModel } from '../export/model.js';
import { renderPdf } from '../export/pdf.js';
import { renderPrintHtml } from '../export/printHtml.js';
import { toJson } from '../lib/json.js';
import { logger } from '../lib/logger.js';
import { storage } from '../storage/index.js';
import { unscoped } from '../tenancy/context.js';
import { listSessions } from '../auth/sessions.js';
import { rcaInclude, serializeRca } from './rcaQueries.js';

const json = (v: unknown) => JSON.stringify(toJson(v), null, 2);

export async function streamDataExport(userId: string, res: Response, pdfBaseUrl: string) {
  const data = await unscoped('data export of the user\'s own data', async () => {
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { id: true, name: true, email: true, email_verified_at: true, created_at: true, last_login_at: true, is_platform_admin: true },
    });
    const memberships = await prisma.workspaceMember.findMany({ where: { user_id: userId }, include: { workspace: { select: { id: true, name: true, is_personal: true, owner_id: true } } } });
    const collaborations = await prisma.rcaCollaborator.findMany({ where: { user_id: userId }, include: { rca: { select: { id: true, rca_number: true, workspace_id: true } } } });
    const security = await prisma.auditLog.findMany({ where: { category: 'SECURITY', user_id: userId }, orderBy: { at: 'asc' } });
    const rcas = await prisma.rca.findMany({ where: { is_deleted: false, workspace: { owner_id: userId } }, include: rcaInclude, orderBy: { rca_number: 'asc' } });
    const uploads = await prisma.rcaAttachment.findMany({ where: { uploaded_by: userId, kind: 'FILE', file_path: { not: null } }, select: { id: true, file_name: true, file_path: true, rca_id: true } });
    return { user, memberships, collaborations, security, rcas, uploads, sessions: await listSessions(userId) };
  });

  const stamp = new Date().toISOString().slice(0, 10);
  res.attachment(`rca-dashboard-export-${stamp}.zip`);
  res.type('application/zip');
  const zip = archiver('zip', { zlib: { level: 6 } });
  zip.on('warning', (err) => logger.warn('export zip warning', { error: String(err) }));
  zip.pipe(res);

  zip.append(
    [
      'RCA Dashboard: export of your data',
      `Created: ${new Date().toISOString()}`,
      '',
      'account.json         your profile, workspaces, direct RCA access, active sessions',
      'security-log.json    logins, password and email changes, invitations, exports',
      'rcas/<number>.json   every RCA in the workspaces you own (all sections, actions, sign-offs, history is in the app)',
      'rcas/<number>.pdf    the same RCAs as printable PDF',
      'uploads/             the files you uploaded',
    ].join('\n'),
    { name: 'README.txt' },
  );
  zip.append(json({ user: data.user, workspaces: data.memberships.map((m) => ({ ...m.workspace, role: m.role, team: m.team })), rca_access: data.collaborations, sessions: data.sessions }), { name: 'account.json' });
  zip.append(json(data.security), { name: 'security-log.json' });

  for (const rca of data.rcas) {
    const base = `rcas/${rca.workspace_id.slice(0, 8)}-${rca.rca_number}`;
    zip.append(json(serializeRca(rca)), { name: `${base}.json` });
    try {
      zip.append(await renderPdf(renderPrintHtml(buildExportModel(rca)), pdfBaseUrl), { name: `${base}.pdf` });
    } catch (err) {
      logger.warn('export: pdf failed', { rca_id: rca.id, error: String(err) });
      zip.append(`PDF could not be generated for ${rca.rca_number}; the JSON file has all data.`, { name: `${base}.pdf.txt` });
    }
  }
  for (const f of data.uploads) {
    try {
      zip.append(await storage().get(f.file_path!), { name: `uploads/${f.id.slice(0, 8)}-${f.file_name ?? 'file'}` });
    } catch (err) {
      logger.warn('export: file missing', { attachment_id: f.id, error: String(err) });
    }
  }
  await zip.finalize();
  return { rcas: data.rcas.length, files: data.uploads.length };
}
