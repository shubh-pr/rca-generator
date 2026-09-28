import ExcelJS from 'exceljs';
import { formatDateOnly, formatIstDateTime, minutesBetween, todayIst } from '../lib/dates.js';

export interface ListRca {
  rca_number: string;
  rca_date: Date;
  severity: string;
  environment: string;
  status: string;
  version: number;
  summary: string;
  ticket_id: string | null;
  incident_start: Date;
  detected_at: Date | null;
  resolved_at: Date | null;
  closed_at: Date | null;
  company_name: string | null;
  project_name: string | null;
  team_leader_name: string | null;
  sections: {
    team: string;
    section_status: string;
    actions: { seq: number | null; action: string; owner: { name: string }; due_date: Date; status: string; completed_on: Date | null; followup: { id: string } | null }[];
  }[];
}

const isOverdue = (a: ListRca['sections'][number]['actions'][number], today: Date) => a.status !== 'COMPLETED' && !a.followup && a.due_date < today;

/** One row per RCA (default) or one row per action (rows=actions). */
export function listTable(rcas: ListRca[], perAction: boolean): { head: string[]; rows: (string | number)[][] } {
  const today = todayIst();
  if (perAction) {
    return {
      head: ['RCA no', 'Project', 'RCA status', 'Team', '#', 'Action', 'Owner', 'Due date', 'Status', 'Completed on', 'Overdue', 'Moved to follow-ups'],
      rows: rcas.flatMap((r) =>
        r.sections.flatMap((s) =>
          s.actions.map((a) => [
            r.rca_number,
            r.project_name ?? '',
            r.status,
            s.team,
            a.seq ?? '',
            a.action,
            a.owner.name,
            formatDateOnly(a.due_date),
            a.status,
            formatDateOnly(a.completed_on),
            isOverdue(a, today) ? 'Yes' : 'No',
            a.followup ? 'Yes' : 'No',
          ]),
        ),
      ),
    };
  }
  const status = (r: ListRca, t: string) => r.sections.find((s) => s.team === t)?.section_status ?? '';
  return {
    head: [
      'RCA no',
      'Date',
      'Company',
      'Project',
      'Severity',
      'Environment',
      'Status',
      'Version',
      'Team leader',
      'Ticket',
      'Summary',
      'Incident start (IST)',
      'Detected at (IST)',
      'Resolved at (IST)',
      'Time to detect (min)',
      'Dev section',
      'QA section',
      'Production section',
      'Actions',
      'Open actions',
      'Overdue actions',
      'Closed at (IST)',
    ],
    rows: rcas.map((r) => {
      const actions = r.sections.flatMap((s) => s.actions);
      return [
        r.rca_number,
        formatDateOnly(r.rca_date),
        r.company_name ?? '',
        r.project_name ?? '',
        r.severity,
        r.environment,
        r.status,
        r.version,
        r.team_leader_name ?? '',
        r.ticket_id ?? '',
        r.summary,
        formatIstDateTime(r.incident_start),
        formatIstDateTime(r.detected_at),
        formatIstDateTime(r.resolved_at),
        minutesBetween(r.incident_start, r.detected_at) ?? '',
        status(r, 'DEV'),
        status(r, 'QA'),
        status(r, 'PROD'),
        actions.length,
        actions.filter((a) => a.status !== 'COMPLETED').length,
        actions.filter((a) => isOverdue(a, today)).length,
        formatIstDateTime(r.closed_at),
      ];
    }),
  };
}

/** CSV with quoting and spreadsheet-formula neutralising. */
export function toCsv(t: { head: string[]; rows: (string | number)[][] }): string {
  const q = (v: string | number) => {
    let s = String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return `\uFEFF${[t.head, ...t.rows].map((r) => r.map(q).join(',')).join('\r\n')}\r\n`;
}

export async function toXlsx(t: { head: string[]; rows: (string | number)[][] }, sheetName: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'RCA Admin Dashboard';
  const ws = wb.addWorksheet(sheetName, { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.addRow(t.head);
  ws.getRow(1).eachCell((c) => {
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3864' } };
  });
  for (const r of t.rows) ws.addRow(r);
  ws.columns.forEach((col, i) => {
    col.width = Math.min(60, Math.max(10, t.head[i].length + 2));
  });
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: t.head.length } };
  return Buffer.from(await wb.xlsx.writeBuffer());
}
