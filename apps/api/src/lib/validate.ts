import { z } from 'zod';
import { badRequest, type FieldErrors } from './errors.js';

/** Parse with zod; on failure throw 400 { error: "VALIDATION", fields }. */
export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const result = schema.safeParse(data);
  if (!result.success) {
    const fields: FieldErrors = {};
    for (const issue of result.error.issues) {
      const key = issue.path.length ? issue.path.join('.') : '_';
      const missing = issue.code === 'invalid_type' && (issue.input === undefined || issue.input === null);
      const unknownKey = issue.code === 'unrecognized_keys';
      if (unknownKey) {
        for (const k of issue.keys) fields[k] ??= 'Unknown or read-only field';
        continue;
      }
      fields[key] ??= missing ? 'Required' : issue.message;
    }
    throw badRequest(fields);
  }
  return result.data;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Date-only value "YYYY-MM-DD" -> Date at UTC midnight. */
export const zDate = z
  .string()
  .regex(DATE_RE, 'Must be a date (YYYY-MM-DD)')
  .refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)), 'Invalid date')
  .transform((s) => new Date(`${s}T00:00:00Z`));

/** ISO 8601 timestamp with offset or Z. */
export const zDateTime = z
  .string()
  .datetime({ offset: true, message: 'Must be an ISO 8601 timestamp' })
  .transform((s) => new Date(s));

export const zUuid = z.string().uuid('Must be a valid id');

/** Optional free text: empty string is stored as null. */
export const zText = (max?: number) => {
  const base = max ? z.string().max(max, `At most ${max} characters`) : z.string();
  return base.transform((s) => (s.trim() === '' ? null : s)).nullable();
};

export const idParam = z.object({ id: zUuid });
