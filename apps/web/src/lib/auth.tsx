import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, refreshSession, setAccessToken, setSessionHandler, setUnauthorizedHandler } from '../api/client';
import type { Me } from '../api/types';

interface AuthState {
  user: Me | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<Me>;
  logout: () => Promise<void>;
  reload: () => Promise<void>;
  setUser: (u: Me) => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [user, setUser] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  const clear = useCallback(() => {
    setAccessToken(null);
    setUser(null);
    qc.clear();
  }, [qc]);

  useEffect(() => {
    setUnauthorizedHandler(clear);
    setSessionHandler(setUser);
    // Restore the session from the refresh cookie on page load.
    refreshSession().finally(() => setLoading(false));
  }, [clear]);

  const login = useCallback(async (email: string, password: string) => {
    const res = await api.post<{ access_token: string; user: Me }>('/auth/login', { email, password });
    setAccessToken(res.access_token);
    setUser(res.user);
    return res.user;
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } finally {
      clear();
    }
  }, [clear]);

  const reload = useCallback(async () => {
    setUser(await api.get<Me>('/me'));
  }, []);

  const value = useMemo(() => ({ user, loading, login, logout, reload, setUser }), [user, loading, login, logout, reload]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
