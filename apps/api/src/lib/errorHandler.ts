import { Prisma } from '@prisma/client';
import type { ErrorRequestHandler } from 'express';
import multer from 'multer';
import { HttpError } from './errors.js';
import { logger } from './logger.js';

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({
      error: err.code,
      message: err.message,
      ...(err.fields ? { fields: err.fields } : {}),
      ...(err.details ? { details: err.details } : {}),
    });
    return;
  }
  if (err instanceof multer.MulterError) {
    const message = err.code === 'LIMIT_FILE_SIZE' ? 'File is larger than 10 MB' : err.message;
    res.status(400).json({ error: 'VALIDATION', message, fields: { file: message } });
    return;
  }
  if (err?.type === 'entity.parse.failed') {
    res.status(400).json({ error: 'VALIDATION', message: 'Request body is not valid JSON', fields: { _: 'Invalid JSON' } });
    return;
  }
  if (err?.type === 'entity.too.large') {
    res.status(400).json({ error: 'VALIDATION', message: 'Request body is too large', fields: { _: 'Too large' } });
    return;
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      res.status(409).json({ error: 'CONFLICT', message: 'A record with these values already exists' });
      return;
    }
    if (err.code === 'P2025') {
      res.status(404).json({ error: 'NOT_FOUND', message: 'Not found' });
      return;
    }
    if (err.code === 'P2003') {
      const field = String(err.meta?.field_name ?? 'reference');
      res.status(400).json({ error: 'VALIDATION', message: 'Referenced record does not exist', fields: { [field]: 'Does not exist' } });
      return;
    }
  }
  // Full details go to the log only; clients never see stack traces.
  logger.error('unhandled error', { error: err instanceof Error ? err.message : String(err), stack: err instanceof Error ? err.stack : undefined, path: _req.path, method: _req.method });
  res.status(500).json({ error: 'INTERNAL', message: 'Unexpected server error' });
};
