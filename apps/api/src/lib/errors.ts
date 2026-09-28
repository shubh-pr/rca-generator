export type FieldErrors = Record<string, string>;

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fields?: FieldErrors,
    public details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export const badRequest = (fields: FieldErrors, message = 'Validation failed') =>
  new HttpError(400, 'VALIDATION', message, fields);

export const unauthorized = (message = 'Not logged in') => new HttpError(401, 'UNAUTHORIZED', message);

export const forbidden = (message = 'You do not have permission for this action') =>
  new HttpError(403, 'FORBIDDEN', message);

export const notFound = (message = 'Not found') => new HttpError(404, 'NOT_FOUND', message);

export const conflict = (message: string, details?: Record<string, unknown>, code = 'CONFLICT') =>
  new HttpError(409, code, message, undefined, details);

export const businessRule = (message: string, details?: Record<string, unknown>, fields?: FieldErrors) =>
  new HttpError(422, 'BUSINESS_RULE', message, fields, details);
