import { z } from 'zod';
import { parse } from './validate.js';

export interface Page {
  page: number;
  page_size: number;
  skip: number;
  take: number;
  orderBy: Record<string, 'asc' | 'desc'>;
}

const pageSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(500).default(20),
  sort: z.string().optional(),
});

/**
 * Parse page, page_size and sort ("field" or "-field" for descending).
 * Unknown sort fields are a 400.
 */
export function parsePage(query: unknown, sortable: readonly string[], defaultSort: string): Page {
  const q = parse(pageSchema, pickPageKeys(query));
  const sort = q.sort ?? defaultSort;
  const desc = sort.startsWith('-');
  const field = desc ? sort.slice(1) : sort;
  if (!sortable.includes(field)) {
    parse(z.object({ sort: z.enum(sortable as [string, ...string[]]) }), { sort: field });
  }
  return {
    page: q.page,
    page_size: q.page_size,
    skip: (q.page - 1) * q.page_size,
    take: q.page_size,
    orderBy: { [field]: desc ? 'desc' : 'asc' },
  };
}

function pickPageKeys(query: unknown) {
  const q = (query ?? {}) as Record<string, unknown>;
  return { page: q.page, page_size: q.page_size, sort: q.sort };
}

export function pageResult<T>(data: T[], total: number, p: Page) {
  return { data, page: p.page, page_size: p.page_size, total };
}
