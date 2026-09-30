import { Link, Navigate, useSearchParams } from 'react-router';
import { useAuth } from '../../lib/auth';
import { PublicLayout } from './PublicLayout';

const FEATURES = [
  { title: 'Structured RCAs', text: 'Header, impact, detection, timeline, immediate fix, and a 5 Whys section each for Dev, QA and Production.' },
  { title: 'Works solo or with a team', text: 'Fill every section yourself, or invite people and give each one only the section they own.' },
  { title: 'Review and sign-off', text: 'Submit for review, send back with comments, sign off, close and reopen, with the full history kept.' },
  { title: 'Actions that get done', text: 'Owners, due dates and overdue highlighting, with a personal task list for everyone involved.' },
  { title: 'Print, PDF and Word', text: 'A4 printouts and PDF/Word exports in a consistent template layout, ready to share.' },
  { title: 'Private by default', text: 'Your RCAs are visible only to you and the people you invite. Export or delete your data at any time.' },
];

export function LandingPage() {
  const { user } = useAuth();
  const [params] = useSearchParams();
  if (user) return <Navigate to="/dashboard" replace />;
  return (
    <PublicLayout>
      {params.get('deleted') && (
        <div className="bg-slate-800 px-4 py-2 text-center text-sm text-white" role="status" data-testid="deleted-notice">
          Your account has been deleted. Your data will be permanently erased after the grace period.
        </div>
      )}
      <section className="bg-label">
        <div className="mx-auto grid max-w-5xl items-center gap-8 px-4 py-16 md:grid-cols-2">
          <div className="space-y-4">
            <h1 className="text-4xl leading-tight font-bold text-navy">Root cause analysis that teams actually finish.</h1>
            <p className="text-lg text-slate-700">
              Record an incident, find the root cause with the 5 Whys, track the fixes, and share a clean report. Blameless by design.
            </p>
            <div className="flex gap-3">
              <Link to="/signup" className="btn-primary px-5 py-2 text-base" data-testid="cta-signup">
                Create a free account
              </Link>
              <Link to="/login" className="btn-secondary px-5 py-2 text-base">
                Log in
              </Link>
            </div>
            <p className="text-sm text-slate-600">
              Prefer a document?{' '}
              <Link to="/template" className="font-semibold text-navy underline" data-testid="cta-template">
                Download the blank RCA template
              </Link>{' '}
              (free account, Word).
            </p>
          </div>
          <div
            className="flex aspect-video items-center justify-center rounded-lg border-2 border-dashed border-navy/40 bg-white text-sm text-slate-500"
            aria-label="Product screenshot placeholder"
          >
            Screenshot placeholder: dashboard
          </div>
        </div>
      </section>
      <section className="mx-auto max-w-5xl px-4 py-12">
        <h2 className="mb-6 text-2xl">What you get</h2>
        <div className="grid gap-4 md:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="card">
              <h3 className="mb-1">{f.title}</h3>
              <p className="text-slate-600">{f.text}</p>
            </div>
          ))}
        </div>
        <div className="mt-8 grid gap-4 md:grid-cols-2">
          <div className="flex aspect-video items-center justify-center rounded-lg border-2 border-dashed border-slate-300 text-sm text-slate-500">
            Screenshot placeholder: team section with 5 Whys
          </div>
          <div className="flex aspect-video items-center justify-center rounded-lg border-2 border-dashed border-slate-300 text-sm text-slate-500">
            Screenshot placeholder: PDF export
          </div>
        </div>
        <div className="mt-10 text-center">
          <Link to="/signup" className="btn-primary px-6 py-2 text-base">
            Start your first RCA
          </Link>
        </div>
      </section>
    </PublicLayout>
  );
}
