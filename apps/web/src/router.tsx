import type { ReactNode } from 'react';
import { createBrowserRouter, Navigate, Outlet, useLocation } from 'react-router';
import { crumb } from './components/Breadcrumbs';
import { Layout } from './components/Layout';
import { RcaCrumb, TabCrumb, WorkspaceCrumb } from './lib/crumbs';
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
import { TemplatePage } from './pages/public/TemplatePage';
import { SettingsPage } from './pages/SettingsPage';
import { BillingPage } from './pages/settings/BillingPage';
import { PricingPage } from './pages/billing/PricingPage';
import { TestCheckoutPage } from './pages/billing/TestCheckoutPage';
import { TestPortalPage } from './pages/billing/TestPortalPage';
import { WelcomePage } from './pages/WelcomePage';
import { InvitePage } from './pages/InvitePage';
import { AdminPage } from './pages/AdminPage';
import { WorkspaceDetailPage, WorkspacesPage } from './pages/WorkspacesPage';
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
      { path: '/pricing', element: <PricingPage /> },
      { path: '/template', element: <TemplatePage /> },
      { path: '/login', element: <LoginPage /> },
      { path: '/signup', element: <SignupPage /> },
      { path: '/verify-email', element: <VerifyEmailPage /> },
      { path: '/forgot-password', element: <ForgotPasswordPage /> },
      { path: '/reset-password', element: <ResetPasswordPage /> },
      { path: '/invite', element: <InvitePage /> },
    ],
  },
  {
    element: <RequireAuth />,
    children: [
      { path: 'rcas/:id/print', element: <RcaPrintPage /> },
      { path: 'billing/test-checkout/:sessionId', element: <TestCheckoutPage /> },
      { path: 'billing/test-portal/:wid', element: <TestPortalPage /> },
      {
        element: <Layout />,
        children: [
          // Breadcrumbs follow this nesting: each route with `handle: crumb(...)` adds a segment (components/Breadcrumbs.tsx).
          { path: 'welcome', element: <WelcomePage />, handle: crumb('Welcome') },
          {
            path: 'settings',
            handle: crumb('Account settings'),
            children: [
              { index: true, element: <SettingsPage /> },
              { path: 'billing', element: <BillingPage />, handle: crumb('Billing') },
            ],
          },
          {
            path: 'workspaces',
            handle: crumb('Workspaces'),
            children: [
              { index: true, element: <WorkspacesPage /> },
              { path: ':wid', element: <WorkspaceDetailPage />, handle: crumb(({ params }) => <WorkspaceCrumb id={params.wid!} />) },
            ],
          },
          { path: 'admin', element: <AdminPage />, handle: crumb('Operator console') },
          { path: 'dashboard', element: <DashboardPage />, handle: crumb('Dashboard') },
          { path: 'my-tasks', element: <MyTasksPage />, handle: crumb('My tasks') },
          {
            path: 'rcas',
            handle: crumb('RCAs'),
            children: [
              { index: true, element: <RcaListPage /> },
              { path: 'new', element: <RcaNewPage />, handle: crumb('New RCA') },
              {
                path: ':id',
                handle: crumb(({ params }) => <RcaCrumb id={params.id!} />),
                children: [
                  { index: true, element: <RcaViewPage /> },
                  { path: 'edit', element: <RcaEditPage />, handle: crumb(({ search }) => <TabCrumb tab={search.get('tab')} />) },
                ],
              },
            ],
          },
          { path: 'audit', element: <AuditOnly><AuditLogPage /></AuditOnly>, handle: crumb('Audit log') },
          { path: '*', element: <Navigate to="/" replace /> },
        ],
      },
    ],
  },
]);
