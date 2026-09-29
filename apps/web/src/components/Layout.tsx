import { NavLink, Outlet } from 'react-router';
import { useAuth } from '../lib/auth';
import { ROLE_LABEL } from '../lib/labels';
import { auditWorkspaces } from '../lib/permissions';
import { useWorkspace } from '../lib/workspace';
import { ResendVerification } from '../pages/auth/SignupPage';

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `block rounded px-3 py-2 text-sm ${isActive ? 'bg-white/15 font-semibold text-white' : 'text-white/80 hover:bg-white/10 hover:text-white'}`;

function WorkspaceSwitcher() {
  const { user } = useAuth();
  const { current, select } = useWorkspace();
  if (!user) return null;
  return (
    <label className="mb-4 block px-3 text-xs text-white/70">
      Workspace
      <select
        className="mt-1 w-full rounded border border-white/30 bg-navy-700 px-2 py-1 text-sm text-white"
        value={current?.id ?? ''}
        onChange={(e) => select(e.target.value || null)}
        aria-label="Workspace"
        data-testid="workspace-switcher"
      >
        <option value="">All workspaces</option>
        {user.workspaces.map((w) => (
          <option key={w.id} value={w.id}>
            {w.name} ({ROLE_LABEL[w.role]})
          </option>
        ))}
      </select>
    </label>
  );
}

export function Layout() {
  const { user, logout } = useAuth();
  return (
    <div className="flex min-h-screen">
      <aside className="flex w-56 shrink-0 flex-col bg-navy px-3 py-4 print:hidden">
        <div className="mb-4 px-3 text-lg font-bold text-white">RCA Dashboard</div>
        <WorkspaceSwitcher />
        <nav className="flex flex-1 flex-col gap-1" aria-label="Main">
          <NavLink to="/dashboard" className={linkClass}>
            Dashboard
          </NavLink>
          <NavLink to="/rcas" end className={linkClass}>
            RCA list
          </NavLink>
          <NavLink to="/my-tasks" className={linkClass}>
            My tasks
          </NavLink>
          <NavLink to="/workspaces" className={linkClass}>
            Workspaces
          </NavLink>
          {auditWorkspaces(user).length > 0 && (
            <NavLink to="/audit" className={linkClass}>
              Audit log
            </NavLink>
          )}
        </nav>
        {user && (
          <div className="border-t border-white/20 px-3 pt-3 text-xs text-white/80">
            <div className="font-semibold text-white" data-testid="current-user">
              {user.name}
            </div>
            <div className="truncate">{user.email}</div>
            <NavLink to="/settings" className="mt-2 block text-white underline">
              Account settings
            </NavLink>
            <button type="button" onClick={logout} className="mt-2 text-white underline">
              Log out
            </button>
          </div>
        )}
      </aside>
      <main className="min-w-0 flex-1 p-6">
        {user && !user.email_verified && <VerifyBanner email={user.email} />}
        <Outlet />
      </main>
    </div>
  );
}

function VerifyBanner({ email }: { email: string }) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900" data-testid="verify-banner">
      <span>Verify your email ({email}) to create RCAs. Check your inbox for the link.</span>
      <div className="w-56">
        <ResendVerification email={email} />
      </div>
    </div>
  );
}

/** SPEC 6.3: visible blameless-RCA note at the top of every RCA page. */
export function BlamelessNote() {
  return (
    <div className="mb-4 rounded border-l-4 border-navy bg-label px-3 py-2 text-sm text-navy" data-testid="blameless-note">
      <strong>Blameless RCA:</strong> focus on systems and processes, not individuals. The goal is to learn and prevent
      recurrence.
    </div>
  );
}
