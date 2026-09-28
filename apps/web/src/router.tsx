import type { ReactNode } from 'react';
import { createBrowserRouter, Navigate, Outlet } from 'react-router';
import { Layout } from './components/Layout';
import { useAuth } from './lib/auth';
import { can, homeFor } from './lib/permissions';
import { CompaniesPage } from './pages/admin/CompaniesPage';
import { ProjectsPage } from './pages/admin/ProjectsPage';
import { UsersPage } from './pages/admin/UsersPage';
import { HomePage } from './pages/HomePage';
import { LoginPage } from './pages/LoginPage';

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

function Home() {
  const { user } = useAuth();
  return <Navigate to={user ? homeFor(user) : '/login'} replace />;
}

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    element: <RequireAuth />,
    children: [
      {
        element: <Layout />,
        children: [
          { index: true, element: <Home /> },
          { path: 'dashboard', element: <HomePage /> },
          { path: 'my-tasks', element: <HomePage /> },
          { path: 'admin/users', element: <AdminOnly><UsersPage /></AdminOnly> },
          { path: 'admin/projects', element: <AdminOnly><ProjectsPage /></AdminOnly> },
          { path: 'admin/companies', element: <AdminOnly><CompaniesPage /></AdminOnly> },
          { path: '*', element: <Navigate to="/" replace /> },
        ],
      },
    ],
  },
]);
