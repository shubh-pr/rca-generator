import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import pdf from 'pdf-parse/lib/pdf-parse.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePdfBrowser } from '../src/export/pdf.js';
import {
  api,
  bearer,
  createActors,
  createProject,
  createRca,
  prepareForReview,
  prisma,
  resetDb,
  ROLE_KEYS,
  signAll,
  type Actor,
  type RoleKey,
} from './helpers.js';

let a: Record<RoleKey, Actor>;
let draftId: string;
let closedId: string;

const binary = (res: import('superagent').Response, cb: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};

async function pdfPages(buf: Buffer): Promise<string[]> {
  const pages: string[] = [];
  await pdf(buf, {
    pagerender: async (p) => {
      const c = await p.getTextContent();
      const t = c.items.map((i) => i.str).join('').replace(/\s+/g, ' ');
      pages.push(t);
      return t;
    },
  });
  return pages;
}

beforeAll(async () => {
  await resetDb();
  a = await createActors();
  const { project } = await createProject(a.PROJECT_OWNER.id);
  draftId = (await createRca(a.RCA_LEAD, project.id, a.RCA_LEAD.id, { summary: 'Checkout <script>alert(1)</script> failed' })).id;
  // Long timeline to force the table across pages (repeated header check).
  await prisma.rcaTimeline.createMany({
    data: Array.from({ length: 70 }, (_, i) => ({
      rca_id: draftId,
      event_time: new Date(Date.UTC(2026, 8, 27, 8, i)),
      event: `Event number ${i + 1}`,
      sort_order: i + 1,
    })),
  });
  closedId = (await createRca(a.RCA_LEAD, project.id, a.RCA_LEAD.id, { severity: 'P1' })).id;
  await prepareForReview(a, closedId);
  await api().post(`/api/v1/rcas/${closedId}/submit-review`).set(bearer(a.RCA_LEAD)).send({});
  await signAll(a, closedId);
  const closed = await api().post(`/api/v1/rcas/${closedId}/close`).set(bearer(a.PROJECT_OWNER)).send({});
  expect(closed.status).toBe(200);
}, 120_000);

afterAll(async () => {
  await closePdfBrowser();
});

const ORDER = [
  'Root Cause Analysis (RCA)',
  'RCA number',
  '1. Common sections',
  '1.1 Problem statement',
  '1.2 Impact',
  '1.3 Detection',
  '1.4 Timeline',
  '1.5 Immediate fix',
  '2. Team sections',
  '2.1 Dev section',
  '2.2 QA section',
  '2.3 Production section',
  '3. Closing sections',
  '3.1 Lessons learned',
  '3.2 Open risks / follow-ups',
  '3.3 Attachments',
  '3.4 Sign-off',
];

function expectInOrder(text: string, items: string[]) {
  let pos = -1;
  for (const item of items) {
    const next = text.indexOf(item, pos + 1);
    expect(next, `"${item}" should appear after position ${pos}`).toBeGreaterThan(pos);
    pos = next;
  }
}

describe('print view', () => {
  it('is A4 HTML with repeated table headers, page numbers, header/footer, empty boxes and escaped content', async () => {
    const res = await api().get(`/api/v1/rcas/${draftId}/print`).set(bearer(a.VIEWER));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    const html = res.text;
    expectInOrder(html, ORDER);
    expect(html).toContain('size: A4 portrait');
    expect(html).toContain('margin: 20mm');
    expect(html).toContain('10.5pt');
    expect(html).toContain('display: table-header-group');
    expect(html).toContain('break-inside: avoid');
    expect(html).toContain('"Page " counter(page) " of " counter(pages)');
    expect(html).toContain('"Confidential"');
    expect(html).toMatch(/RCA-2026-0001 {2}\| {2}Payment Gateway {2}\| {2}Severity P2/);
    expect(html).toContain('class="watermark"');
    expect(html).toContain('Why it was not caught');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
    // Empty fields are printed as empty boxes, not hidden.
    expect(html).toMatch(/<th class="lbl">Reviewed by<\/th><td class="val"><\/td>/);
  });

  it('has no DRAFT watermark once CLOSED', async () => {
    const res = await api().get(`/api/v1/rcas/${closedId}/print`).set(bearer(a.VIEWER));
    expect(res.text).not.toContain('class="watermark"');
    expect(res.text).toContain('Signed digitally by');
  });
});

describe('PDF export', () => {
  it('acceptance: shows all template sections in order, each team on its own page, repeated headers, page numbers, DRAFT watermark', async () => {
    const res = await api().get(`/api/v1/rcas/${draftId}/export?format=pdf`).set(bearer(a.DEV)).buffer(true).parse(binary);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toContain('RCA-2026-0001_PaymentGateway_v1.pdf');
    const pages = await pdfPages(res.body as Buffer);
    const all = pages.join('\n');
    expectInOrder(all, ORDER);
    const n = pages.length;
    expect(n).toBeGreaterThanOrEqual(5);
    pages.forEach((p, i) => {
      expect(p).toContain(`Page ${i + 1} of ${n}`);
      expect(p).toContain('Confidential');
      expect(p).toContain('RCA-2026-0001');
      expect(p).toContain('DRAFT');
    });
    const pageOf = (s: string) => pages.findIndex((p) => p.includes(s));
    const dev = pageOf('2.1 Dev section');
    const qa = pageOf('2.2 QA section');
    const prod = pageOf('2.3 Production section');
    expect(dev).toBeGreaterThan(0);
    expect(qa).toBeGreaterThan(dev);
    expect(prod).toBeGreaterThan(qa);
    // The 70-row timeline spans pages and repeats its header row on each.
    const timelinePages = pages.filter((p) => p.includes('Event number'));
    expect(timelinePages.length).toBeGreaterThanOrEqual(2);
    for (const p of timelinePages) expect(p).toContain('Time (IST)');
  });

  it('acceptance: no DRAFT watermark on a CLOSED RCA', async () => {
    const res = await api().get(`/api/v1/rcas/${closedId}/export?format=pdf`).set(bearer(a.VIEWER)).buffer(true).parse(binary);
    const pages = await pdfPages(res.body as Buffer);
    expect(pages.join(' ')).not.toContain('DRAFT');
  });
});

describe('DOCX export', () => {
  async function docXml(id: string) {
    const res = await api().get(`/api/v1/rcas/${id}/export?format=docx`).set(bearer(a.QA)).buffer(true).parse(binary);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('wordprocessingml.document');
    const zip = await JSZip.loadAsync(res.body as Buffer);
    const files = Object.keys(zip.files);
    const doc = await zip.file('word/document.xml')!.async('string');
    const footers = await Promise.all(files.filter((f) => /word\/footer\d*\.xml/.test(f)).map((f) => zip.file(f)!.async('string')));
    const headers = await Promise.all(files.filter((f) => /word\/header\d*\.xml/.test(f)).map((f) => zip.file(f)!.async('string')));
    return { res, files, doc, footer: footers.join(''), header: headers.join('') };
  }

  it('acceptance: is a valid Word package matching the template structure', async () => {
    const { res, files, doc, footer, header } = await docXml(draftId);
    expect(res.headers['content-disposition']).toContain('RCA-2026-0001_PaymentGateway_v1.docx');
    expect(files).toEqual(expect.arrayContaining(['[Content_Types].xml', 'word/document.xml', 'word/styles.xml']));
    const text = doc.replace(/<[^>]+>/g, '');
    expectInOrder(text, ORDER);
    expect(doc).toContain('<w:tblHeader/>'); // header rows repeat on each page
    expect(doc).toContain('<w:cantSplit/>');
    expect((doc.match(/<w:pageBreakBefore\/>/g) ?? []).length).toBeGreaterThanOrEqual(3); // each team on a new page
    expect(doc).toContain('w:w="11906"'); // A4 width
    expect(doc).toContain('w:h="16838"');
    expect(doc).toContain('Why it was not prevented or detected early');
    expect(footer).toMatch(/PAGE/);
    expect(footer).toMatch(/NUMPAGES/);
    expect(footer).toContain('Confidential');
    expect(header).toContain('RCA-2026-0001');
    expect(header).toContain('DRAFT');
  });

  it('closed RCA has no DRAFT mark; blank template downloads with the same structure', async () => {
    const { header } = await docXml(closedId);
    expect(header).not.toContain('DRAFT');
    const blank = await api().get('/api/v1/templates/rca-blank.docx').set(bearer(a.VIEWER)).buffer(true).parse(binary);
    expect(blank.status).toBe(200);
    const zip = await JSZip.loadAsync(blank.body as Buffer);
    const text = (await zip.file('word/document.xml')!.async('string')).replace(/<[^>]+>/g, '');
    expectInOrder(text, ORDER);
  });
});

describe('list export', () => {
  it('CSV rows match the filtered list, neutralise formulas, and optionally one row per action', async () => {
    await prisma.rca.update({ where: { id: draftId }, data: { ticket_id: '=HYPERLINK("x")' } });
    const list = await api().get('/api/v1/rcas?status=DRAFT').set(bearer(a.VIEWER));
    const csv = await api().get('/api/v1/rcas/export?format=csv&status=DRAFT').set(bearer(a.VIEWER));
    expect(csv.status).toBe(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    const lines = csv.text.trim().split('\r\n');
    expect(lines).toHaveLength(list.body.total + 1);
    expect(lines[0]).toContain('RCA no');
    expect(csv.text).toContain(`"'=HYPERLINK(""x"")"`);

    const actions = await api().get(`/api/v1/rcas/export?format=csv&rows=actions&status=CLOSED`).set(bearer(a.VIEWER));
    expect(actions.text.trim().split('\r\n')).toHaveLength(4); // header + 3 team actions
    expect((await api().get('/api/v1/rcas/export?format=pdf').set(bearer(a.VIEWER))).status).toBe(400);
  });

  it('XLSX has one row per RCA', async () => {
    const res = await api().get('/api/v1/rcas/export?format=xlsx').set(bearer(a.VIEWER)).buffer(true).parse(binary);
    expect(res.status).toBe(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.body as unknown as ArrayBuffer);
    const ws = wb.worksheets[0];
    expect(ws.rowCount).toBe(3);
    expect(ws.getRow(1).getCell(1).value).toBe('RCA no');
  });
});

describe('export permissions and audit', () => {
  it('every role can print and download; every export is audited as EXPORT', async () => {
    for (const r of ROLE_KEYS) {
      expect((await api().get(`/api/v1/rcas/${closedId}/print`).set(bearer(a[r]))).status).toBe(200);
    }
    const rows = await prisma.auditLog.findMany({ where: { action: 'EXPORT' } });
    const formats = new Set(rows.map((x) => (x.new_value as { format: string }).format));
    for (const f of ['print', 'pdf', 'docx', 'csv', 'xlsx']) expect(formats).toContain(f);
    expect(rows.some((x) => x.entity === 'template')).toBe(true);
    expect((await api().get(`/api/v1/rcas/${closedId}/export?format=pdf`)).status).toBe(401);
  });
});
