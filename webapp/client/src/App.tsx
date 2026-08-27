/**
 * App.tsx — SPA shell: routing + role-based layout.
 * ---------------------------------------------------------------------------
 * Routes (guards enforced here AND server-side):
 *   /login       public
 *   /dashboard   owner        — problems / solutions / activities KPIs
 *   /tasks       owner+moderator — full task table
 *   /tasks/:id   any role     — evidence, comments, audio, rating
 *   /evaluations owner+moderator — people directory with stars
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
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import TaskList from './pages/TaskList';
import TaskDetail from './pages/TaskDetail';
import Evaluations from './pages/Evaluations';
import Finance from './pages/Finance';

/** Wraps protected pages with the sidebar; redirects logged-out users. */
function Layout({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  if (!user) return <Navigate to="/login" replace />;

  const isOwner = user.role === 'owner';
  const isMod = user.role === 'moderator';

  return (
    <div className="shell">
      <aside className="sidebar">
        <h2>🌾 AgriTasks</h2>
        <p className="role-tag">{user.role}</p>
        {/* Menu visibility follows the permission matrix in ARCHITECTURE.md §1 */}
        {isOwner && (
          <NavLink to="/dashboard">📊 Dashboard</NavLink>
        )}
        {(isOwner || isMod) && (
          <>
            <NavLink to="/tasks">🗂️ Tasks</NavLink>
            <NavLink to="/evaluations">⭐ Evaluations</NavLink>
          </>
        )}
        {isOwner && (
          <>
            {/* R5: accountant view of the per-farm financial ledger */}
            <NavLink to="/finance">💰 Finance</NavLink>
          </>
        )}
        {user.role === 'worker' && (
          <NavLink to={`/tasks`}>🗂️ My Tasks</NavLink>
        )}
        <button className="logout" onClick={logout}>
          Log out ({user.name})
        </button>
      </aside>
      <main className="content">{children}</main>
    </div>
  );
}

export default function App() {
  const { user } = useAuth();

  return (
    <BrowserRouter>
      <AuthProvider>
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
                  <Route path="/evaluations" element={<Evaluations />} />
                  <Route path="/finance" element={<Finance />} />
                </Routes>
              </Layout>
            }
          />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
