import { NavLink } from 'react-router';

const tab = ({ isActive }: { isActive: boolean }) =>
  `border-b-2 px-3 py-2 text-sm ${isActive ? 'border-navy font-semibold text-navy' : 'border-transparent text-slate-600 hover:text-navy'}`;

export function SettingsTabs() {
  return (
    <nav className="flex gap-1 border-b border-slate-200" aria-label="Settings">
      <NavLink to="/settings" end className={tab}>
        Account
      </NavLink>
      <NavLink to="/settings/billing" className={tab}>
        Billing
      </NavLink>
    </nav>
  );
}
