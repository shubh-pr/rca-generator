import { useQuery } from '@tanstack/react-query';
import { useRef } from 'react';
import { Link, useParams } from 'react-router';
import { fetchText } from '../../api/client';
import { ErrorBanner } from '../../components/Form';

/**
 * Print view: shows the server's /print HTML (the same HTML the PDF is made from) and prints it with
 * the browser. The toolbar sits outside the printed document, so menus and buttons never print.
 */
export function RcaPrintPage() {
  const { id = '' } = useParams();
  const frame = useRef<HTMLIFrameElement>(null);
  const html = useQuery({ queryKey: ['print', id], queryFn: () => fetchText(`/rcas/${id}/print`), gcTime: 0 });
  return (
    <div className="flex h-screen flex-col bg-slate-200">
      <div className="flex items-center justify-between bg-navy px-4 py-2 text-white print:hidden">
        <Link to={`/rcas/${id}`} className="text-white underline">
          ← Back to RCA
        </Link>
        <span className="text-sm">Print preview (A4 portrait)</span>
        <button type="button" className="btn bg-white text-navy" disabled={!html.data} onClick={() => frame.current?.contentWindow?.print()}>
          Print
        </button>
      </div>
      {html.error ? (
        <div className="p-4">
          <ErrorBanner error={html.error} />
        </div>
      ) : (
        <iframe ref={frame} title="RCA print view" className="w-full flex-1 border-0" sandbox="allow-same-origin allow-modals" srcDoc={html.data ?? ''} />
      )}
    </div>
  );
}
