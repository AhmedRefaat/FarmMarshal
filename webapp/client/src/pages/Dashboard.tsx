/**
 * Dashboard.tsx — OWNER landing page.
 * ---------------------------------------------------------------------------
 * Answers the owner's three questions at a glance (ARCHITECTURE.md §5.2):
 *   • Problems  = open + rejected tasks on his land
 *   • Activity  = in_progress + submitted tasks
 *   • Solutions = approved tasks
 * Plus quick team-quality signals (average evaluation stars).
 */

import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import type { Task, User } from '../types';

export default function Dashboard() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [people, setPeople] = useState<(User & { avgStars?: number })[]>([]);
  const [error, setError] = useState('');

  // Load everything in parallel; both calls are cheap list endpoints.
  useEffect(() => {
    Promise.all([api.tasks(), api.users()])
      .then(async ([taskList, users]) => {
        setTasks(taskList);
        // Enrich each person with their average rating stars.
        const withStars = await Promise.all(
          users.map(async (u) => ({
            ...u,
            avgStars: (await api.userStats(u.id)).avgStars,
          }))
        );
        setPeople(withStars);
      })
      .catch((e) => setError(e.message));
  }, []);

  if (error) return <p className="error">{error}</p>;

  /** Count tasks matching a status predicate for the KPI cards. */
  const count = (...statuses: string[]) =>
    tasks.filter((t) => statuses.includes(t.status)).length;

  return (
    <>
      <h1>Land Overview</h1>

      {/* KPI row: the owner's core questions */}
      <div className="kpis">
        <div className="kpi red">
          <b>{count('assigned', 'rejected')}</b> problems open
        </div>
        <div className="kpi orange">
          <b>{count('in_progress', 'submitted')}</b> activities ongoing
        </div>
        <div className="kpi green">
          <b>{count('approved')}</b> solutions completed
        </div>
      </div>

      <section>
        <h2>Latest activity</h2>
        {/* Five most recent tasks link into their detail pages */}
        <ul className="feed">
          {tasks.slice(0, 5).map((t) => (
            <li key={t.id}>
              <Link to={`/tasks/${t.id}`}>
                [{t.status}] {t.title}
              </Link>
            </li>
          ))}
          {tasks.length === 0 && <li>No activity yet.</li>}
        </ul>
      </section>

      <section>
        <h2>Team quality</h2>
        <ul className="feed">
          {/* Moderators & workers only — owners aren't rated by anyone */}
          {people
            .filter((p) => p.role !== 'owner')
            .map((p) => (
              <li key={p.id}>
                {p.name} ({p.role}) — ⭐ {p.avgStars ?? '—'}
              </li>
            ))}
        </ul>
      </section>
    </>
  );
}
