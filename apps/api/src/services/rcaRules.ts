import type { Rca } from '@prisma/client';
import { badRequest, conflict, type FieldErrors } from '../lib/errors.js';

/** SPEC 3.3: Incident start <= Detected at <= Resolved at. */
export function checkIncidentTimes(t: { incident_start: Date; detected_at?: Date | null; resolved_at?: Date | null }) {
  const fields: FieldErrors = {};
  if (t.detected_at && t.detected_at < t.incident_start) {
    fields.detected_at = 'Must be after incident_start';
  }
  if (t.resolved_at) {
    if (t.detected_at && t.resolved_at < t.detected_at) fields.resolved_at = 'Must be after detected_at';
    else if (t.resolved_at < t.incident_start) fields.resolved_at = 'Must be after incident_start';
  }
  if (Object.keys(fields).length) throw badRequest(fields);
}

/** Header, common and closing data can change until the RCA is closed. */
export function ensureRcaEditable(rca: Pick<Rca, 'status'>) {
  if (rca.status === 'CLOSED') throw conflict('RCA is closed. Reopen it to make changes.');
}
