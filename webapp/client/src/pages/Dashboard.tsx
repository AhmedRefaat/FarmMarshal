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
import { useErrorMessage, useI18n } from '../i18n';
import type { MessageKey } from '../i18n';
import type { Task, User } from '../types';

export default function Dashboard() {
  const { t, tc, fmt } = useI18n();
  const describeError = useErrorMessage();
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
      .catch((e) => setError(describeError(e)));
  }, [describeError]);

  if (error) return <p className="error">{error}</p>;

  /** Count tasks matching a status predicate for the KPI cards. */
  const count = (...statuses: string[]) =>
    tasks.filter((t) => statuses.includes(t.status)).length;

  return (
    <>
      <div className="pagehead">
        <p className="eyebrow">{t('dashboard.eyebrow')}</p>
        <h1>{t('dashboard.title')}</h1>
        <p>{t('dashboard.subtitle')}</p>
      </div>

      {/* KPI row: the owner's core questions. Captions are noun phrases, not
          sentences, because the count renders as a separate visual element. */}
      <div className="kpis">
        <div className="kpi red">
          <b>{fmt.number(count('assigned', 'rejected'))}</b>{' '}
          {t('dashboard.problems')}
        </div>
        <div className="kpi orange">
          <b>{fmt.number(count('in_progress', 'submitted'))}</b>{' '}
          {t('dashboard.activities')}
        </div>
        <div className="kpi green">
          <b>{fmt.number(count('approved'))}</b> {t('dashboard.solutions')}
        </div>
      </div>

      <section>
        <h2>{t('dashboard.latestActivity')}</h2>
        {/* Five most recent tasks link into their detail pages */}
        <ul className="feed">
          {tasks.slice(0, 5).map((t2) => (
            <li key={t2.id}>
              <Link to={`/tasks/${t2.id}`}>
                <span className={`badge b-${t2.status}`}>
                  {t(`status.${t2.status}` as MessageKey)}
                </span>{' '}
                <bdi>{tc(t2.title)}</bdi>
              </Link>
            </li>
          ))}
          {tasks.length === 0 && <li>{t('dashboard.noActivity')}</li>}
        </ul>
      </section>

      <section>
        <h2>{t('dashboard.teamQuality')}</h2>
        <ul className="feed">
          {/* Moderators & workers only — owners aren't rated by anyone */}
          {people
            .filter((p) => p.role !== 'owner')
            .map((p) => (
              <li key={p.id}>
                <bdi>{tc(p.name)}</bdi>{' '}
                <span className="role-tag">
                  {t(`role.${p.role}` as MessageKey)}
                </span>{' '}
                — ⭐ {p.avgStars ? fmt.number(p.avgStars) : t('common.none')}
              </li>
            ))}
        </ul>
      </section>
    </>
  );
}
