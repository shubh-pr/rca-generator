import { Fragment, type ReactNode } from 'react';
import { Link, useMatches, useSearchParams, type Params } from 'react-router';

interface CrumbContext {
  params: Params;
  search: URLSearchParams;
}

/** Route `handle` that gives the route a breadcrumb segment (see router.tsx). */
export interface CrumbHandle {
  crumb: (ctx: CrumbContext) => ReactNode;
}

/** `handle: crumb('RCAs')` or `handle: crumb(({ params }) => <RcaCrumb id={params.id!} />)`. */
export function crumb(label: ReactNode | ((ctx: CrumbContext) => ReactNode)): CrumbHandle {
  return { crumb: typeof label === 'function' ? label : () => label };
}

const hasCrumb = (handle: unknown): handle is CrumbHandle => typeof (handle as CrumbHandle | undefined)?.crumb === 'function';

/**
 * Trail of the matched routes that declare a crumb, always starting at the Dashboard. Every segment but
 * the last links to its route.
 */
export function Breadcrumbs() {
  const matches = useMatches();
  const [search] = useSearchParams();
  const trail = matches
    .filter((m) => hasCrumb(m.handle))
    .map((m) => ({ to: m.pathname, label: (m.handle as CrumbHandle).crumb({ params: m.params, search }) }));
  if (trail[0]?.to !== '/dashboard') trail.unshift({ to: '/dashboard', label: 'Dashboard' });
  return (
    <nav aria-label="Breadcrumb" className="shrink-0 border-b border-slate-200 bg-white px-6 py-2 text-sm print:hidden" data-testid="breadcrumbs">
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {trail.map((c, i) => {
          const last = i === trail.length - 1;
          return (
            <Fragment key={c.to}>
              {i > 0 && (
                <li aria-hidden="true" className="text-slate-400">
                  /
                </li>
              )}
              <li>
                {last ? (
                  <span aria-current="page" className="font-semibold text-navy">
                    {c.label}
                  </span>
                ) : (
                  <Link to={c.to} className="text-slate-600 hover:text-navy hover:underline">
                    {c.label}
                  </Link>
                )}
              </li>
            </Fragment>
          );
        })}
      </ol>
    </nav>
  );
}
