import type { ReactNode } from 'react';
import { createBrowserRouter, Navigate, Outlet, useLocation } from 'react-router';
import { Layout } from './components/Layout';
import { useAuth } from './lib/auth';
import { auditWorkspaces } from './lib/permissions';
import { AuditLogPage } from './pages/AuditLogPage';
import { DashboardPage } from './pages/DashboardPage';
import { ForgotPasswordPage } from './pages/auth/ForgotPasswordPage';
import { ResetPasswordPage } from './pages/auth/ResetPasswordPage';
import { SignupPage } from './pages/auth/SignupPage';
import { VerifyEmailPage } from './pages/auth/VerifyEmailPage';
import { LoginPage } from './pages/LoginPage';
import { ContactPage, PrivacyPage, TermsPage } from './pages/public/LegalPages';
import { LandingPage } from './pages/public/LandingPage';
import { SettingsPage } from './pages/SettingsPage';
import { WelcomePage } from './pages/WelcomePage';
import { MyTasksPage } from './pages/MyTasksPage';
import { RcaEditPage } from './pages/rca/RcaEditPage';
import { RcaListPage } from './pages/rca/RcaListPage';
import { RcaNewPage } from './pages/rca/RcaNewPage';
import { RcaPrintPage } from './pages/rca/RcaPrintPage';
import { RcaViewPage } from './pages/rca/RcaViewPage';

function RequireAuth() {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <div className="p-8 text-slate-500">Loading…</div>;
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  // First login: the welcome screen, unless the user follows a direct link (e.g. an invitation).
  if (!user.onboarded && location.pathname === '/dashboard') return <Navigate to="/welcome" replace />;
  return <Outlet />;
}

/** Public pages wait for the session check so a logged-in user is recognised. */
function PublicShell() {
  const { loading } = useAuth();
  if (loading) return <div className="p-8 text-slate-500">Loading…</div>;
  return <Outlet />;
}

function AuditOnly({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  return auditWorkspaces(user).length ? children : <Navigate to="/" replace />;
}

export const router = createBrowserRouter([
  {
    element: <PublicShell />,
    children: [
      { path: '/', element: <LandingPage /> },
      { path: '/terms', element: <TermsPage /> },
      { path: '/privacy', element: <PrivacyPage /> },
      { path: '/contact', element: <ContactPage /> },
      { path: '/login', element: <LoginPage /> },
      { path: '/signup', element: <SignupPage /> },
      { path: '/verify-email', element: <VerifyEmailPage /> },
      { path: '/forgot-password', element: <ForgotPasswordPage /> },
      { path: '/reset-password', element: <ResetPasswordPage /> },
    ],
  },
  {
    element: <RequireAuth />,
    children: [
      { path: 'rcas/:id/print', element: <RcaPrintPage /> },
      {
        element: <Layout />,
        children: [
          { path: 'welcome', element: <WelcomePage /> },
          { path: 'settings', element: <SettingsPage /> },
          { path: 'dashboard', element: <DashboardPage /> },
          { path: 'my-tasks', element: <MyTasksPage /> },
          { path: 'rcas', element: <RcaListPage /> },
          { path: 'rcas/new', element: <RcaNewPage /> },
          { path: 'rcas/:id', element: <RcaViewPage /> },
          { path: 'rcas/:id/edit', element: <RcaEditPage /> },
          { path: 'audit', element: <AuditOnly><AuditLogPage /></AuditOnly> },
          { path: '*', element: <Navigate to="/" replace /> },
        ],
      },
    ],
  },
]);
