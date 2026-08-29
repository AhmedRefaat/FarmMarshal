/**
 * App.tsx — SPA shell: routing + role-based layout.
 * ---------------------------------------------------------------------------
 * Routes (guards enforced here AND server-side):
 *   /login             public
 *   /dashboard         owner           — problems / solutions / activities KPIs
 *   /farms             owner+moderator — portfolio: every farm + issue buckets
 *   /farms/:id         owner+moderator — one farm: new/active/solved issues
 *   /tasks             owner+moderator — full task table
 *   /tasks/:id         any role        — evidence, comments, audio, rating
 *   /tasks/:id/report  any role        — full audit report for one task
 *   /evaluations       owner+moderator — people directory with stars
 *   /finance           owner           — per-farm ledger
 *   /experts           any role        — expert network: cases, bids, chat
 */

import React from 'react';
import {
  BrowserRouter,
  Navigate,
  NavLink,
  Route,
  Routes,
} from 'react-router-dom';
import { AuthProvider, useAuth } from './auth';
import { asset } from './assets';
import { LocaleProvider, LocaleSwitch, useI18n } from './i18n';
import type { MessageKey } from './i18n';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import TaskList from './pages/TaskList';
import TaskDetail from './pages/TaskDetail';
import Evaluations from './pages/Evaluations';
import Finance from './pages/Finance';
import Farms from './pages/Farms';
import FarmDetail from './pages/FarmDetail';
import TaskReport from './pages/TaskReport';
import ExpertNetwork from './pages/ExpertNetwork';

/** Wraps protected pages with the sidebar; redirects logged-out users. */
function Layout({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const { t, tc } = useI18n();
  if (!user) return <Navigate to="/login" replace />;

  const isOwner = user.role === 'owner';
  const isMod = user.role === 'moderator';

  return (
    <div className="shell">
      {/* Product bar: identity and account-level controls sit above the nav so
          the sidebar stays purely "where can I go", never "who am I". */}
      <header className="topbar">
        <div className="brand">
          <img className="brand-mark" src={asset('logo.png')} alt="" />
          <span className="brand-name">
            <b>{t('app.name')}</b>
            <small>{t('app.tagline')}</small>
          </span>
        </div>
        <div className="topbar-actions">
          <span className="pill amber">{t('app.demoData')}</span>
          <LocaleSwitch />
          <button className="logout" onClick={logout}>
            {t('nav.logout', { name: tc(user.name) })}
          </button>
        </div>
      </header>
      <div className="layout">
        <aside className="sidebar">
          <p className="sidebar-label">{t('nav.workspace')}</p>
          <p className="role-tag">{t(`role.${user.role}` as MessageKey)}</p>
          {/* Menu visibility follows the permission matrix in ARCHITECTURE.md §1 */}
          {isOwner && <NavLink to="/dashboard">📊 {t('nav.dashboard')}</NavLink>}
          {(isOwner || isMod) && (
            <>
              {/* Portfolio view: every farm under this person's responsibility */}
              <NavLink to="/farms">🌱 {t('nav.farms')}</NavLink>
              <NavLink to="/tasks">🗂️ {t('nav.tasks')}</NavLink>
              <NavLink to="/evaluations">⭐ {t('nav.evaluations')}</NavLink>
            </>
          )}
          {isOwner && (
            <>
              {/* R5: accountant view of the per-farm financial ledger */}
              <NavLink to="/finance">💰 {t('nav.finance')}</NavLink>
            </>
          )}
          {user.role === 'worker' && (
            <NavLink to={`/tasks`}>🗂️ {t('nav.myTasks')}</NavLink>
          )}
          {/* Open to every role: network experts sign in as ordinary users. */}
          <NavLink to="/experts">🌍 {t('nav.experts')}</NavLink>
        </aside>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}

/** Route table. Separate component so it renders *inside* AuthProvider. */
function AppRoutes() {
  const { user } = useAuth();

  return (
    <Routes>
      {/* Public route: bounce to dashboard when already signed in */}
      <Route
        path="/login"
        element={user ? <Navigate to="/" replace /> : <Login />}
      />
      {/* Everything else lives inside the guarded layout */}
      <Route
        path="*"
        element={
          <Layout>
            <Routes>
              <Route path="/" element={<Navigate to={user?.role === 'owner' ? '/dashboard' : '/tasks'} replace />} />
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/tasks" element={<TaskList />} />
              <Route path="/tasks/:id" element={<TaskDetail />} />
              <Route path="/tasks/:id/report" element={<TaskReport />} />
              <Route path="/farms" element={<Farms />} />
              <Route path="/farms/:id" element={<FarmDetail />} />
              <Route path="/experts" element={<ExpertNetwork />} />
              <Route path="/evaluations" element={<Evaluations />} />
              <Route path="/finance" element={<Finance />} />
            </Routes>
          </Layout>
        }
      />
    </Routes>
  );
}

export default function App() {
  return (
    // Locale sits ABOVE auth: the sign-in card must already be localized.
    <LocaleProvider>
      <AuthProvider>
        {/* basename carries the deploy sub-path: '/' in dev, '/<repo>/' on
            GitHub Pages. Without it every route 404s on a project site. */}
        <BrowserRouter basename={import.meta.env.BASE_URL}>
          <AppRoutes />
        </BrowserRouter>
      </AuthProvider>
    </LocaleProvider>
  );
}
