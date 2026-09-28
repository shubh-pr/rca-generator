import { useState } from 'react';
import { Link } from 'react-router';

export interface BarItem {
  key: string;
  label: string;
  count: number;
  /** Query for the matching RCA list; omit when the bar has no list equivalent. */
  href?: string;
}

/**
 * Horizontal single-series bar chart (one hue, value labels on every row so identity and
 * magnitude never depend on color). Each bar is a link to the filtered RCA list.
 */
export function BarList({ title, items, unit, empty = 'No data' }: { title: string; items: BarItem[]; unit: string; empty?: string }) {
  const [hover, setHover] = useState<string | null>(null);
  const max = Math.max(1, ...items.map((i) => i.count));
  return (
    <figure className="card" aria-label={title}>
      <figcaption className="mb-3 font-semibold text-navy">{title}</figcaption>
      {items.length === 0 && <p className="text-sm text-slate-500">{empty}</p>}
      <ul className="space-y-0.5">
        {items.map((i) => {
          const pct = (i.count / max) * 100;
          const body = (
            <div
              className={`grid grid-cols-[8rem_1fr_2.5rem] items-center gap-2 rounded px-1 py-1 ${hover === i.key ? 'bg-label/60' : ''}`}
              onMouseEnter={() => setHover(i.key)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(i.key)}
              onBlur={() => setHover(null)}
            >
              <span className="truncate text-sm text-slate-700" title={i.label}>
                {i.label}
              </span>
              <span className="relative h-3.5">
                <span
                  className="absolute inset-y-0 left-0 rounded-r bg-navy"
                  style={{ width: i.count ? `max(${pct}%, 3px)` : 0 }}
                  aria-hidden="true"
                />
                {hover === i.key && (
                  <span className="absolute -top-7 left-0 z-10 rounded bg-slate-900 px-2 py-0.5 text-xs whitespace-nowrap text-white shadow" role="tooltip">
                    {i.label}: {i.count} {unit}
                    {i.href ? ' · click to open list' : ''}
                  </span>
                )}
              </span>
              <span className="text-right text-sm font-semibold text-slate-800 tabular-nums">{i.count}</span>
            </div>
          );
          return (
            <li key={i.key}>
              {i.href ? (
                <Link to={i.href} className="block focus:ring-2 focus:ring-navy focus:outline-none" data-testid={`bar-${title}-${i.key}`}>
                  {body}
                </Link>
              ) : (
                body
              )}
            </li>
          );
        })}
      </ul>
    </figure>
  );
}
