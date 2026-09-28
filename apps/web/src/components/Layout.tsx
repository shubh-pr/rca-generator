import { NavLink, Outlet } from 'react-router';
import { useAuth } from '../lib/auth';
import { ROLE_LABEL } from '../lib/labels';
import { can } from '../lib/permissions';

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `block rounded px-3 py-2 text-sm ${isActive ? 'bg-white/15 font-semibold text-white' : 'text-white/80 hover:bg-white/10 hover:text-white'}`;

export function Layout() {
  const { user, logout } = useAuth();
  return (
    <div className="flex min-h-screen">
      <aside className="flex w-56 shrink-0 flex-col bg-navy px-3 py-4 print:hidden">
        <div className="mb-6 px-3 text-lg font-bold text-white">RCA Dashboard</div>
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
          {can.viewAuditLog(user) && (
            <NavLink to="/audit" className={linkClass}>
              Audit log
            </NavLink>
          )}
          {can.manageMasters(user) && (
            <>
              <div className="mt-4 px-3 text-xs font-semibold tracking-wide text-white/50 uppercase">Masters</div>
              <NavLink to="/admin/users" className={linkClass}>
                Users
              </NavLink>
              <NavLink to="/admin/projects" className={linkClass}>
                Projects
              </NavLink>
              <NavLink to="/admin/companies" className={linkClass}>
                Companies
              </NavLink>
            </>
          )}
        </nav>
        {user && (
          <div className="border-t border-white/20 px-3 pt-3 text-xs text-white/80">
            <div className="font-semibold text-white" data-testid="current-user">
              {user.name}
            </div>
            <div>{ROLE_LABEL[user.role]}</div>
            <button type="button" onClick={logout} className="mt-2 text-white underline">
              Log out
            </button>
          </div>
        )}
      </aside>
      <main className="min-w-0 flex-1 p-6">
        <Outlet />
      </main>
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
