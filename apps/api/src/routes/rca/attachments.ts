import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { currentUser } from '../../auth/index.js';
import { config } from '../../config.js';
import { prisma } from '../../db.js';
import { rcaAudit, writeAudit } from '../../lib/audit.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { parse, zText, zUuid } from '../../lib/validate.js';
import { authorize } from '../../policy/policy.js';
import { withinQuota } from '../../services/quota.js';
import { userRef } from '../../services/rcaQueries.js';
import { ensureRcaEditable } from '../../services/rcaRules.js';
import { ALLOWED_TYPES, contentMatches } from '../../storage/fileType.js';
import { storage } from '../../storage/index.js';
import { rcaOf } from './access.js';

export const attachmentsRouter = Router({ mergeParams: true });

class FileTypeError extends Error {}

// Files are held in memory (at most MAX_UPLOAD_MB) so type, content and quota are checked before
// anything is written to storage.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxUploadBytes, files: 1, fields: 5 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ALLOWED_TYPES[ext]) cb(null, true);
    else cb(new FileTypeError(`File type ${ext || '(none)'} is not allowed. Allowed: ${Object.keys(ALLOWED_TYPES).join(', ')}`));
  },
});

function runUpload(req: Request, res: Response) {
  return new Promise<void>((resolve, reject) => {
    upload.single('file')(req, res, (err: unknown) => {
      if (err instanceof FileTypeError) reject(badRequest({ file: err.message }));
      else if (err) reject(err);
      else resolve();
    });
  });
}

const linkSchema = z
  .object({
    kind: z.literal('LINK'),
    url: z
      .string()
      .trim()
      .max(2000)
      .url('Must be a valid URL')
      .refine((u) => /^https?:\/\//i.test(u), 'Only http(s) links are allowed'),
    description: zText(255).optional(),
  })
  .strict();

const aidParam = (req: { params: Record<string, string> }) => parse(z.object({ aid: zUuid }), { aid: req.params.aid }).aid;

const publicFields = {
  id: true,
  rca_id: true,
  description: true,
  kind: true,
  url: true,
  file_name: true,
  mime: true,
  size: true,
  uploaded_by: true,
  created_at: true,
  uploader: userRef,
} as const;

/** Display name only: no paths, no control characters. */
const safeName = (name: string) =>
  [...path.basename(name)]
    .map((ch) => (ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127 || ch === '"' || ch === '\\' ? '_' : ch))
    .join('')
    .slice(0, 255) || 'attachment';

attachmentsRouter.get('/attachments', async (req, res) => {
  const { rca, ctx } = rcaOf(req);
  authorize(ctx, 'rca.view');
  const data = await prisma.rcaAttachment.findMany({ where: { rca_id: rca.id }, orderBy: { created_at: 'asc' }, select: publicFields });
  res.json({ data });
});

attachmentsRouter.post('/attachments', async (req, res) => {
  const me = currentUser(req);
  const { rca, ctx } = rcaOf(req);
  authorize(ctx, 'attachment.add');
  ensureRcaEditable(rca);

  if (!req.is('multipart/form-data')) {
    const body = parse(linkSchema, req.body);
    const data = { kind: 'LINK', url: body.url, description: body.description ?? null };
    const created = await prisma.$transaction(async (tx) => {
      const row = await tx.rcaAttachment.create({ data: { ...data, rca_id: rca.id, uploaded_by: me.id }, select: publicFields });
      await writeAudit(tx, rcaAudit(rca, { entity: 'rca_attachment', entity_id: row.id, action: 'CREATE', new_value: data, user_id: me.id }));
      return row;
    });
    res.status(201).json(created);
    return;
  }

  await runUpload(req, res);
  const file = req.file;
  if (!file) throw badRequest({ file: 'Choose a file to upload' });
  const ext = path.extname(file.originalname).toLowerCase();
  if (!contentMatches(ext, file.buffer)) throw badRequest({ file: `The file content does not match the ${ext} type` });
  const { description } = parse(z.object({ description: zText(255).optional() }), req.body);
  const key = `ws/${rca.workspace_id}/rca/${rca.id}/${randomUUID()}${ext}`;
  const data = {
    kind: 'FILE',
    description: description ?? null,
    file_path: key,
    file_name: safeName(file.originalname),
    mime: ALLOWED_TYPES[ext],
    size: file.size,
  };
  await storage().put(key, file.buffer, ALLOWED_TYPES[ext]);
  let created;
  try {
    created = await withinQuota(rca.workspace_id, { bytes: file.size }, async (tx) => {
      const row = await tx.rcaAttachment.create({ data: { ...data, rca_id: rca.id, uploaded_by: me.id }, select: publicFields });
      await writeAudit(tx, rcaAudit(rca, { entity: 'rca_attachment', entity_id: row.id, action: 'CREATE', new_value: { ...data, file_path: undefined }, user_id: me.id }));
      return row;
    });
  } catch (err) {
    // Over quota or failed insert: the stored object is removed again.
    await storage().delete(key).catch(() => {});
    throw err;
  }
  res.status(201).json(created);
});

/** Authenticated download, streamed from storage; always an attachment, never rendered inline. */
attachmentsRouter.get('/attachments/:aid/download', async (req, res) => {
  const { rca, ctx } = rcaOf(req);
  authorize(ctx, 'rca.view');
  const att = await prisma.rcaAttachment.findFirst({ where: { id: aidParam(req), rca_id: rca.id } });
  if (!att) throw notFound('Attachment not found');
  if (att.kind !== 'FILE' || !att.file_path) throw notFound('This attachment is a link, not a file');
  let body;
  try {
    body = await storage().get(att.file_path);
  } catch {
    throw notFound('File is missing from storage');
  }
  res.setHeader('Content-Type', att.mime ?? 'application/octet-stream');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  res.setHeader('Cache-Control', 'private, no-store');
  res.attachment(att.file_name ?? 'attachment');
  await pipeline(body, res);
});

attachmentsRouter.delete('/attachments/:aid', async (req, res) => {
  const me = currentUser(req);
  const { rca, ctx } = rcaOf(req);
  const att = await prisma.rcaAttachment.findFirst({ where: { id: aidParam(req), rca_id: rca.id } });
  if (!att) throw notFound('Attachment not found');
  authorize(ctx, 'attachment.delete', att, 'Only the uploader, an owner or an editor can remove this attachment');
  ensureRcaEditable(rca);
  await prisma.$transaction(async (tx) => {
    await tx.rcaAttachment.delete({ where: { id: att.id } });
    await writeAudit(tx, rcaAudit(rca, {
      entity: 'rca_attachment',
      entity_id: att.id,
      action: 'DELETE',
      old_value: { kind: att.kind, file_name: att.file_name, url: att.url, description: att.description },
      user_id: me.id,
    }));
  });
  if (att.file_path) await storage().delete(att.file_path).catch((err) => logger.warn('storage delete failed', { error: String(err) }));
  res.status(204).end();
});
