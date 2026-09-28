import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { WorkspaceRef } from '../api/types';
import { useAuth } from './auth';

const KEY = 'rca.workspace';

interface WorkspaceState {
  /** Selected workspace, or null for "All workspaces". */
  current: WorkspaceRef | null;
  select: (id: string | null) => void;
  /** Query parameter for list/dashboard requests. */
  filter: { workspace_id?: string };
}

const Ctx = createContext<WorkspaceState | null>(null);

function readStored(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [selected, setSelected] = useState<string | null>(readStored);
  const current = user?.workspaces.find((w) => w.id === selected) ?? null;
  const select = useCallback((id: string | null) => {
    setSelected(id);
    try {
      if (id) localStorage.setItem(KEY, id);
      else localStorage.removeItem(KEY);
    } catch {
      // per-viewer convenience only
    }
  }, []);
  const value = useMemo<WorkspaceState>(
    () => ({ current, select, filter: current ? { workspace_id: current.id } : {} }),
    [current, select],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWorkspace(): WorkspaceState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useWorkspace must be used inside WorkspaceProvider');
  return ctx;
}
