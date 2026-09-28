import type { ReactNode } from 'react';
import { createBrowserRouter, Navigate, Outlet } from 'react-router';
import { Layout } from './components/Layout';
import { useAuth } from './lib/auth';
import { can, homeFor } from './lib/permissions';
import { CompaniesPage } from './pages/admin/CompaniesPage';
import { ProjectsPage } from './pages/admin/ProjectsPage';
import { UsersPage } from './pages/admin/UsersPage';
import { DashboardPage } from './pages/DashboardPage';
import { MyTasksPage } from './pages/MyTasksPage';
import { LoginPage } from './pages/LoginPage';
import { RcaEditPage } from './pages/rca/RcaEditPage';
import { RcaListPage } from './pages/rca/RcaListPage';
import { RcaNewPage } from './pages/rca/RcaNewPage';
import { RcaPrintPage } from './pages/rca/RcaPrintPage';
import { RcaViewPage } from './pages/rca/RcaViewPage';
import { AuditLogPage } from './pages/AuditLogPage';

function RequireAuth() {
  const { user, loading } = useAuth();
  if (loading) return <div className="p-8 text-slate-500">Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  return <Outlet />;
}

function AdminOnly({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  return can.manageMasters(user) ? children : <Navigate to="/" replace />;
}

function AuditOnly({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  return can.viewAuditLog(user) ? children : <Navigate to="/" replace />;
}

function Home() {
  const { user } = useAuth();
  return <Navigate to={user ? homeFor(user) : '/login'} replace />;
}

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    element: <RequireAuth />,
    children: [
      { path: 'rcas/:id/print', element: <RcaPrintPage /> },
      {
        element: <Layout />,
        children: [
          { index: true, element: <Home /> },
          { path: 'dashboard', element: <DashboardPage /> },
          { path: 'my-tasks', element: <MyTasksPage /> },
          { path: 'rcas', element: <RcaListPage /> },
          { path: 'rcas/new', element: <RcaNewPage /> },
          { path: 'rcas/:id', element: <RcaViewPage /> },
          { path: 'rcas/:id/edit', element: <RcaEditPage /> },
          { path: 'audit', element: <AuditOnly><AuditLogPage /></AuditOnly> },
          { path: 'admin/users', element: <AdminOnly><UsersPage /></AdminOnly> },
          { path: 'admin/projects', element: <AdminOnly><ProjectsPage /></AdminOnly> },
          { path: 'admin/companies', element: <AdminOnly><CompaniesPage /></AdminOnly> },
          { path: '*', element: <Navigate to="/" replace /> },
        ],
      },
    ],
  },
]);
