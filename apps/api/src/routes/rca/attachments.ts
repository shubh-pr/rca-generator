import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { currentUser } from '../../auth/index.js';
import { config } from '../../config.js';
import { prisma } from '../../db.js';
import { rcaAudit, writeAudit } from '../../lib/audit.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { parse, zText, zUuid } from '../../lib/validate.js';
import { authorize } from '../../policy/policy.js';
import { userRef } from '../../services/rcaQueries.js';
import { ensureRcaEditable } from '../../services/rcaRules.js';
import { rcaOf } from './access.js';

export const attachmentsRouter = Router({ mergeParams: true });

/** SPEC 8: allowed types. The served Content-Type comes from this table, never from the client. */
export const ALLOWED_TYPES: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.txt': 'text/plain',
  '.log': 'text/plain',
  '.csv': 'text/csv',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.zip': 'application/zip',
};

class FileTypeError extends Error {}

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      fs.mkdirSync(config.uploadDir, { recursive: true });
      cb(null, config.uploadDir);
    },
    // Random storage name; the original name is only kept in the database.
    filename: (_req, file, cb) => cb(null, `${randomUUID()}${path.extname(file.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: config.maxUploadBytes, files: 1 },
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

  let data;
  if (req.is('multipart/form-data')) {
    await runUpload(req, res);
    const file = req.file;
    if (!file) throw badRequest({ file: 'Choose a file to upload' });
    const ext = path.extname(file.originalname).toLowerCase();
    let description: string | null = null;
    try {
      description = parse(z.object({ description: zText(255).optional() }), req.body).description ?? null;
    } catch (e) {
      fs.rmSync(file.path, { force: true });
      throw e;
    }
    data = {
      kind: 'FILE',
      description,
      file_path: path.basename(file.path),
      file_name: file.originalname.slice(0, 255),
      mime: ALLOWED_TYPES[ext],
      size: file.size,
    };
  } else {
    const body = parse(linkSchema, req.body);
    data = { kind: 'LINK', url: body.url, description: body.description ?? null };
  }

  const created = await prisma.$transaction(async (tx) => {
    const row = await tx.rcaAttachment.create({ data: { ...data, rca_id: rca.id, uploaded_by: me.id }, select: publicFields });
    await writeAudit(tx, rcaAudit(rca, { entity: 'rca_attachment', entity_id: row.id, action: 'CREATE', new_value: { ...data, file_path: undefined }, user_id: me.id }));
    return row;
  });
  res.status(201).json(created);
});

attachmentsRouter.get('/attachments/:aid/download', async (req, res) => {
  const { rca, ctx } = rcaOf(req);
  authorize(ctx, 'rca.view');
  const att = await prisma.rcaAttachment.findFirst({ where: { id: aidParam(req), rca_id: rca.id } });
  if (!att) throw notFound('Attachment not found');
  if (att.kind !== 'FILE' || !att.file_path) throw notFound('This attachment is a link, not a file');
  const full = path.join(config.uploadDir, path.basename(att.file_path));
  if (!fs.existsSync(full)) throw notFound('File is missing from storage');
  // Always a download, never rendered or executed in the browser.
  res.setHeader('Content-Type', att.mime ?? 'application/octet-stream');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  res.attachment(att.file_name ?? 'attachment');
  fs.createReadStream(full).pipe(res);
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
  if (att.file_path) fs.rmSync(path.join(config.uploadDir, path.basename(att.file_path)), { force: true });
  res.status(204).end();
});
