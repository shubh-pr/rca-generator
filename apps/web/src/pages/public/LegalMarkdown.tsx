import { Fragment, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Replace } from './PublicLayout';

/**
 * Renders the legal documents in ./legal/*.md (kept as Markdown so the text can be edited without
 * touching code). Supports what those documents use: #/##/### headings, paragraphs (line breaks
 * kept), "-" lists (also indented under a paragraph), tables, "---", **bold**, *italic*, links.
 *
 * [SQUARE BRACKETS] without a following (url) are placeholders, shown as the REPLACE BEFORE LAUNCH
 * marker (docs/DEPLOY.md launch checklist), except the names of our own pages, which become links.
 */
const PAGES: Record<string, string> = { 'Pricing page': '/pricing', 'Privacy Policy': '/privacy', 'Terms of Service': '/terms' };

/** Split text into plain runs and top-level [bracket] groups, respecting nested brackets. */
function brackets(text: string): { text: string; bracket: boolean; url?: string }[] {
  const out: { text: string; bracket: boolean; url?: string }[] = [];
  let i = 0;
  let plain = '';
  while (i < text.length) {
    if (text[i] !== '[') {
      plain += text[i++];
      continue;
    }
    let depth = 0;
    let j = i;
    for (; j < text.length; j++) {
      if (text[j] === '[') depth++;
      else if (text[j] === ']' && --depth === 0) break;
    }
    if (j >= text.length) {
      plain += text.slice(i);
      break;
    }
    if (plain) out.push({ text: plain, bracket: false });
    plain = '';
    const inner = text.slice(i + 1, j);
    const link = /^\(([^)\s]+)\)/.exec(text.slice(j + 1));
    if (link) {
      out.push({ text: inner, bracket: true, url: link[1] });
      i = j + 1 + link[0].length;
    } else {
      out.push({ text: inner, bracket: true });
      i = j + 1;
    }
  }
  if (plain) out.push({ text: plain, bracket: false });
  return out;
}

/** **bold** and *italic* inside a plain run. */
function emphasis(text: string, key: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') ? (
      <strong key={`${key}-${i}`}>{part.slice(2, -2)}</strong>
    ) : part.startsWith('*') && part.endsWith('*') && part.length > 2 ? (
      <em key={`${key}-${i}`}>{part.slice(1, -1)}</em>
    ) : (
      <Fragment key={`${key}-${i}`}>{part}</Fragment>
    ),
  );
}

function inline(text: string, key: string): ReactNode[] {
  return brackets(text).flatMap((run, i): ReactNode[] => {
    const k = `${key}-${i}`;
    if (!run.bracket) return emphasis(run.text, k);
    if (run.url)
      return [
        run.url.startsWith('/') ? (
          <Link key={k} to={run.url} className="text-navy underline">
            {run.text}
          </Link>
        ) : (
          <a key={k} href={run.url} target="_blank" rel="noopener noreferrer" className="text-navy underline">
            {run.text}
          </a>
        ),
      ];
    if (PAGES[run.text])
      return [
        <Link key={k} to={PAGES[run.text]} className="text-navy underline">
          {run.text}
        </Link>,
      ];
    return [<Replace key={k}>{run.text}</Replace>];
  });
}

const isList = (l: string) => /^\s*- /.test(l);
const isTable = (l: string) => l.trim().startsWith('|');

function block(lines: string[], key: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const heading = /^(#{1,3}) (.*)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const content = inline(heading[2], `${key}-h${i}`);
      nodes.push(level === 1 ? <h1 key={`${key}-${i}`} className="text-3xl">{content}</h1> : level === 2 ? <h2 key={`${key}-${i}`}>{content}</h2> : <h3 key={`${key}-${i}`}>{content}</h3>);
      i++;
    } else if (line.trim() === '---') {
      nodes.push(<hr key={`${key}-${i}`} className="my-6 border-slate-200" />);
      i++;
    } else if (isList(line)) {
      const items: string[] = [];
      while (i < lines.length && isList(lines[i])) items.push(lines[i++].replace(/^\s*- /, ''));
      nodes.push(
        <ul key={`${key}-${i}`} className="ml-5 list-disc space-y-1">
          {items.map((it, n) => (
            <li key={n}>{inline(it, `${key}-li${i}-${n}`)}</li>
          ))}
        </ul>,
      );
    } else if (isTable(line)) {
      const rows: string[][] = [];
      while (i < lines.length && isTable(lines[i])) {
        const cells = lines[i++].trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
        if (!cells.every((c) => /^-+$/.test(c))) rows.push(cells);
      }
      const [head, ...body] = rows;
      nodes.push(
        <table key={`${key}-${i}`} className="table">
          <thead>
            <tr>
              {head.map((c, n) => (
                <th key={n}>{inline(c, `${key}-th${n}`)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {body.map((r, ri) => (
              <tr key={ri}>
                {r.map((c, n) => (
                  <td key={n}>{inline(c, `${key}-td${ri}-${n}`)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>,
      );
    } else {
      const para: string[] = [];
      while (i < lines.length && !isList(lines[i]) && !isTable(lines[i]) && !/^#{1,3} /.test(lines[i]) && lines[i].trim() !== '---') para.push(lines[i++]);
      nodes.push(
        <p key={`${key}-${i}`}>
          {para.map((l, n) => (
            <Fragment key={n}>
              {n > 0 && <br />}
              {inline(l, `${key}-p${i}-${n}`)}
            </Fragment>
          ))}
        </p>,
      );
    }
  }
  return nodes;
}

export function LegalMarkdown({ source }: { source: string }) {
  const blocks = source.replace(/\r\n/g, '\n').trim().split(/\n\s*\n/);
  return <>{blocks.flatMap((b, i) => block(b.split('\n'), `b${i}`))}</>;
}
