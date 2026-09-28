import type { ExportModel, KV, TableBlock } from './model.js';

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Escape text for a CSS string literal (used in @page margin boxes). */
const cssStr = (s: string) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\n\r]/g, ' ')}"`;

/** Empty values render as an empty box so the printout can be filled in by hand (SPEC 7.1). */
const cell = (value: string) => (value ? esc(value).replace(/\n/g, '<br>') : '');

function kvTable(items: KV[], cols = 2): string {
  const rows: string[] = [];
  for (let i = 0; i < items.length; i += cols) {
    const chunk = items.slice(i, i + cols);
    const tds = chunk.map((kv) => `<th class="lbl">${esc(kv.label)}</th><td class="val">${cell(kv.value)}</td>`).join('');
    const filler = cols > chunk.length ? `<td class="val" colspan="${(cols - chunk.length) * 2}"></td>` : '';
    rows.push(`<tr>${tds}${filler}</tr>`);
  }
  return `<table class="kv">${rows.join('')}</table>`;
}

function textBlock(items: KV[]): string {
  return items
    .map((kv) => `<table class="kv"><tr><th class="lbl">${esc(kv.label)}</th></tr><tr><td class="val tall">${cell(kv.value)}</td></tr></table>`)
    .join('');
}

function dataTable(t: TableBlock, label: string): string {
  const cols = t.widths.map((w) => `<col style="width:${w}%">`).join('');
  const head = t.head.map((h) => `<th>${esc(h)}</th>`).join('');
  const body = t.rows.map((r) => `<tr>${r.map((c) => `<td>${cell(c)}</td>`).join('')}</tr>`).join('');
  return `<table class="data" aria-label="${esc(label)}"><colgroup>${cols}</colgroup><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

/**
 * Print-optimised HTML for one RCA (SPEC 7.1). This is also the exact source the PDF is rendered from.
 * A4 portrait, 20 mm margins, Calibri 10.5 pt; header/footer via @page margin boxes; each team
 * section on a new page; table headers repeat; DRAFT watermark until CLOSED.
 */
export function renderPrintHtml(m: ExportModel): string {
  const headerLine = [m.rcaNumber || 'RCA-____-____', m.projectName || 'Project: ____________', m.severity ? `Severity ${m.severity}` : 'Severity __'].join('  |  ');
  const team = m.teams
    .map(
      (t, i) => `
  <section class="team">
    ${i === 0 ? '<h2>2. Team sections</h2>' : ''}
    <h2>${esc(t.heading)} <span class="status">${esc(t.status)}</span></h2>
    ${kvTable(t.fields)}
    <h3>Cause: 5 Whys</h3>
    ${dataTable(t.whys, `${t.heading} whys`)}
    <h3>Escape analysis</h3>
    ${textBlock(t.escape)}
    <h3>Actions</h3>
    ${dataTable(t.actions, `${t.heading} actions`)}
    <h3>Prevention</h3>
    ${textBlock(t.prevention)}
    <h3>Completion</h3>
    ${kvTable(t.completion)}
  </section>`,
    )
    .join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="rca-draft" content="${m.isDraft ? 'true' : 'false'}">
<title>${esc(m.rcaNumber || 'RCA template')}</title>
<style>
  @page {
    size: A4 portrait;
    margin: 20mm;
    @top-left { content: ${cssStr(headerLine)}; font: 8pt Calibri, Carlito, Arial, sans-serif; color: #1F3864; }
    @top-right { content: "Root Cause Analysis"; font: 8pt Calibri, Carlito, Arial, sans-serif; color: #1F3864; }
    @bottom-left { content: "Confidential"; font: 8pt Calibri, Carlito, Arial, sans-serif; color: #555; }
    @bottom-center { content: "Page " counter(page) " of " counter(pages); font: 8pt Calibri, Carlito, Arial, sans-serif; color: #555; }
    @bottom-right { content: ${cssStr(`Generated ${m.generatedAt}`)}; font: 8pt Calibri, Carlito, Arial, sans-serif; color: #555; }
  }
  * { box-sizing: border-box; }
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { margin: 0; font-family: Calibri, Carlito, Arial, sans-serif; font-size: 10.5pt; color: #111; background: #fff; }
  h1 { color: #1F3864; font-size: 18pt; margin: 0 0 4pt; }
  h2 { color: #fff; background: #1F3864; font-size: 12.5pt; margin: 14pt 0 6pt; padding: 3pt 6pt; break-after: avoid; }
  h2 .status { float: right; font-size: 9pt; font-weight: normal; }
  h3 { color: #1F3864; font-size: 11pt; margin: 10pt 0 4pt; break-after: avoid; }
  .blameless { border-left: 3pt solid #1F3864; background: #D9E2F3; padding: 4pt 6pt; font-size: 9pt; margin-bottom: 8pt; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 6pt; table-layout: fixed; }
  th, td { border: 0.75pt solid #7f8fa9; padding: 3pt 4pt; vertical-align: top; text-align: left; overflow-wrap: anywhere; }
  table.kv th.lbl { background: #D9E2F3; color: #1F3864; width: 22%; font-weight: bold; }
  table.kv td.val { height: 18pt; }
  table.kv td.val.tall { height: 36pt; }
  table.data thead { display: table-header-group; }
  table.data th { background: #1F3864; color: #fff; }
  table.data td { height: 18pt; }
  tr { break-inside: avoid; page-break-inside: avoid; }
  section.team { break-before: page; page-break-before: always; }
  .watermark { position: fixed; top: 38%; left: 0; width: 100%; text-align: center; font-size: 110pt; font-weight: bold;
    color: rgba(192, 0, 0, 0.13); transform: rotate(-35deg); z-index: 1000; pointer-events: none; letter-spacing: 8pt; }
  .screen-bar { display: none; }
  @media screen {
    body { background: #e5e7eb; }
    .sheet { width: 210mm; min-height: 297mm; margin: 12px auto; padding: 20mm; background: #fff; box-shadow: 0 1px 4px rgba(0,0,0,.2); }
    .screen-bar { display: block; font-size: 8pt; color: #1F3864; border-bottom: 0.75pt solid #1F3864; margin-bottom: 8pt; }
    section.team { border-top: 1.5pt dashed #9aa5b8; margin-top: 18pt; padding-top: 6pt; }
  }
  @media print { .no-print { display: none !important; } }
</style>
</head>
<body>
${m.isDraft ? '<div class="watermark" aria-hidden="true">DRAFT</div>' : ''}
<main class="sheet">
  <div class="screen-bar">${esc(headerLine)}</div>
  <h1>${esc(m.title)}</h1>
  <div class="blameless">${esc(m.blameless)}</div>
  ${kvTable(m.header)}

  <h2>1. Common sections</h2>
  <h3>1.1 Problem statement</h3>
  ${textBlock(m.common.problem)}
  <h3>1.2 Impact</h3>
  ${kvTable(m.common.impact)}
  <h3>1.3 Detection</h3>
  ${kvTable(m.common.detection)}
  <h3>1.4 Timeline</h3>
  ${dataTable(m.common.timeline, 'Timeline')}
  <h3>1.5 Immediate fix</h3>
  ${textBlock(m.common.immediateFix)}

  ${team}

  <h2>3. Closing sections</h2>
  <h3>3.1 Lessons learned</h3>
  ${textBlock(m.closing.lessons)}
  <h3>3.2 Open risks / follow-ups</h3>
  ${dataTable(m.closing.followups, 'Follow-ups')}
  <h3>3.3 Attachments</h3>
  ${dataTable(m.closing.attachments, 'Attachments')}
  <h3>3.4 Sign-off</h3>
  ${dataTable(m.closing.signoff, 'Sign-off')}
</main>
</body>
</html>`;
}
