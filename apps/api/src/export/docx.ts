import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  HeightRule,
  Packer,
  PageNumber,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TabStopType,
  TextRun,
  WidthType,
} from 'docx';
import { BILLING_WATERMARK_TEXT, type ExportModel, type KV, type TableBlock } from './model.js';

const NAVY = '1F3864';
const LABEL = 'D9E2F3';
const FONT = 'Calibri';
const border = { style: BorderStyle.SINGLE, size: 4, color: '7F8FA9' };
const borders = { top: border, bottom: border, left: border, right: border };
const ROW_MIN = 360; // twips; empty rows stay tall enough to write in by hand

const text = (value: string, opts: { bold?: boolean; color?: string; size?: number } = {}) =>
  value
    .split('\n')
    .map((line, i) => new TextRun({ text: line, break: i > 0 ? 1 : 0, bold: opts.bold, color: opts.color, size: opts.size, font: FONT }));

const para = (value: string, opts: { bold?: boolean; color?: string; size?: number } = {}) => new Paragraph({ children: text(value, opts) });

function labelCell(label: string, width: number) {
  return new TableCell({
    children: [para(label, { bold: true, color: NAVY })],
    shading: { type: ShadingType.CLEAR, fill: LABEL, color: 'auto' },
    width: { size: width, type: WidthType.PERCENTAGE },
    borders,
  });
}

function valueCell(value: string, width: number, span = 1) {
  return new TableCell({ children: [para(value)], width: { size: width, type: WidthType.PERCENTAGE }, columnSpan: span, borders });
}

function kvTable(items: KV[], cols = 2) {
  const rows: TableRow[] = [];
  for (let i = 0; i < items.length; i += cols) {
    const chunk = items.slice(i, i + cols);
    const cells = chunk.flatMap((kv) => [labelCell(kv.label, 22), valueCell(kv.value, 28)]);
    if (chunk.length < cols) cells.push(valueCell('', 50, (cols - chunk.length) * 2));
    rows.push(new TableRow({ children: cells, cantSplit: true, height: { value: ROW_MIN, rule: HeightRule.ATLEAST } }));
  }
  return new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } });
}

function textBlocks(items: KV[]) {
  return items.flatMap((kv) => [
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({ children: [labelCell(kv.label, 100)], cantSplit: true }),
        new TableRow({ children: [valueCell(kv.value, 100)], cantSplit: true, height: { value: ROW_MIN * 2, rule: HeightRule.ATLEAST } }),
      ],
    }),
    spacer(),
  ]);
}

/** Data table whose header row repeats on every page (tblHeader). */
function dataTable(t: TableBlock) {
  const head = new TableRow({
    tableHeader: true,
    cantSplit: true,
    children: t.head.map(
      (h, i) =>
        new TableCell({
          children: [para(h, { bold: true, color: 'FFFFFF' })],
          shading: { type: ShadingType.CLEAR, fill: NAVY, color: 'auto' },
          width: { size: t.widths[i], type: WidthType.PERCENTAGE },
          borders,
        }),
    ),
  });
  const body = t.rows.map(
    (r) =>
      new TableRow({
        cantSplit: true,
        height: { value: ROW_MIN, rule: HeightRule.ATLEAST },
        children: r.map((c, i) => valueCell(c, t.widths[i])),
      }),
  );
  return new Table({ rows: [head, ...body], width: { size: 100, type: WidthType.PERCENTAGE } });
}

const spacer = () => new Paragraph({ children: [], spacing: { after: 60 } });

function h1(value: string) {
  return new Paragraph({ children: text(value, { bold: true, color: NAVY, size: 36 }), spacing: { after: 120 } });
}

function h2(value: string, pageBreakBefore = false) {
  return new Paragraph({
    pageBreakBefore,
    keepNext: true,
    shading: { type: ShadingType.CLEAR, fill: NAVY, color: 'auto' },
    spacing: { before: 240, after: 120 },
    children: text(value, { bold: true, color: 'FFFFFF', size: 25 }),
  });
}

function h3(value: string) {
  return new Paragraph({ keepNext: true, spacing: { before: 160, after: 80 }, children: text(value, { bold: true, color: NAVY, size: 22 }) });
}

/**
 * Word export with the same section order and tables as the template (SPEC 7):
 * A4 portrait, 20 mm margins, Calibri 10.5 pt, header line and "Page X of Y" footer,
 * each team section on a new page, repeating table header rows. Also used for the blank template.
 */
export async function renderDocx(m: ExportModel): Promise<Buffer> {
  const headerLine = [m.rcaNumber || 'RCA-____-____', m.projectName || 'Project: ____________', m.severity ? `Severity ${m.severity}` : 'Severity __'].join('  |  ');
  const children = [
    h1(m.title),
    new Paragraph({
      shading: { type: ShadingType.CLEAR, fill: LABEL, color: 'auto' },
      children: text(m.blameless, { size: 18 }),
      spacing: { after: 120 },
    }),
    kvTable(m.header),
    h2('1. Common sections'),
    h3('1.1 Problem statement'),
    ...textBlocks(m.common.problem),
    h3('1.2 Impact'),
    kvTable(m.common.impact),
    h3('1.3 Detection'),
    kvTable(m.common.detection),
    h3('1.4 Timeline'),
    dataTable(m.common.timeline),
    h3('1.5 Immediate fix'),
    ...textBlocks(m.common.immediateFix),
    ...m.teams.flatMap((t, i) => [
      ...(i === 0 ? [h2('2. Team sections', true)] : []),
      h2(`${t.heading}   (${t.status})`, i > 0),
      kvTable(t.fields),
      h3('Cause: 5 Whys'),
      dataTable(t.whys),
      h3('Escape analysis'),
      ...textBlocks(t.escape),
      h3('Actions'),
      dataTable(t.actions),
      h3('Prevention'),
      ...textBlocks(t.prevention),
      h3('Completion'),
      kvTable(t.completion),
    ]),
    h2('3. Closing sections'),
    h3('3.1 Lessons learned'),
    ...textBlocks(m.closing.lessons),
    h3('3.2 Open risks / follow-ups'),
    dataTable(m.closing.followups),
    h3('3.3 Attachments'),
    dataTable(m.closing.attachments),
    h3('3.4 Sign-off'),
    dataTable(m.closing.signoff),
  ];

  const small = { size: 16, font: FONT, color: '555555' };
  const doc = new Document({
    creator: 'RCA Admin Dashboard',
    title: m.rcaNumber || 'RCA template',
    styles: { default: { document: { run: { font: FONT, size: 21 } } } },
    sections: [
      {
        properties: {
          page: {
            size: { width: 11906, height: 16838 }, // A4 portrait
            margin: { top: 1134, bottom: 1134, left: 1134, right: 1134, header: 567, footer: 567 },
          },
        },
        headers: {
          default: new Header({
            children: [
              new Paragraph({
                tabStops: [{ type: TabStopType.RIGHT, position: 9638 }],
                children: [
                  new TextRun({ text: headerLine, ...small, color: NAVY }),
                  new TextRun({ text: `\t${m.isDraft ? 'DRAFT' : 'Root Cause Analysis'}`, ...small, bold: m.isDraft, color: m.isDraft ? 'C00000' : NAVY, size: m.isDraft ? 28 : 16 }),
                ],
              }),
              ...(m.billingWatermark
                ? [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: BILLING_WATERMARK_TEXT, ...small, bold: true, color: '8EA3C6', size: 18 })] })]
                : []),
            ],
          }),
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.LEFT,
                tabStops: [
                  { type: TabStopType.CENTER, position: 4819 },
                  { type: TabStopType.RIGHT, position: 9638 },
                ],
                children: [
                  new TextRun({ text: 'Confidential\t', ...small }),
                  new TextRun({ children: ['Page ', PageNumber.CURRENT, ' of ', PageNumber.TOTAL_PAGES], ...small }),
                  new TextRun({ text: `\tGenerated ${m.generatedAt}`, ...small }),
                ],
              }),
            ],
          }),
        },
        children,
      },
    ],
  });
  return Packer.toBuffer(doc);
}
