/** Breadcrumb labels that need data: they read the same query cache / session as the page itself. */
import { useRca } from '../pages/rca/rcaApi';
import { useAuth } from './auth';
import { TABS } from './rcaStatus';

export function RcaCrumb({ id }: { id: string }) {
  const rca = useRca(id);
  return <>{rca.data?.rca_number ?? 'RCA'}</>;
}

const TAB_CRUMB: Record<string, string> = {
  header: 'Header',
  common: 'Common sections',
  DEV: 'Dev section',
  QA: 'QA section',
  PROD: 'Production section',
  closing: 'Closing',
};

/** The RCA form's current tab (?tab=), defaulting to the first tab like the form does. */
export function TabCrumb({ tab }: { tab: string | null }) {
  const key = TABS.find((t) => t.key === tab)?.key ?? 'header';
  return <>{TAB_CRUMB[key]}</>;
}

export function WorkspaceCrumb({ id }: { id: string }) {
  const { user } = useAuth();
  return <>{user?.workspaces.find((w) => w.id === id)?.name ?? 'Workspace'}</>;
}
