/**
 * TaskList.tsx — filterable table of every task on the land.
 * Status chips filter client-side; rows link to the detail page.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useErrorMessage, useI18n } from '../i18n';
import type { MessageKey } from '../i18n';
import type { Task, TaskStatus } from '../types';

const STATUSES: (TaskStatus | 'all')[] = [
  'all', 'assigned', 'in_progress', 'submitted', 'approved', 'rejected',
];

export default function TaskList() {
  const { t, fmt } = useI18n();
  const describeError = useErrorMessage();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [filter, setFilter] = useState<TaskStatus | 'all'>('all');
  const [error, setError] = useState('');

  useEffect(() => {
    api.tasks().then(setTasks).catch((e) => setError(describeError(e)));
  }, [describeError]);

  /** Apply the status chip filter before rendering. */
  const shown = useMemo(
    () => (filter === 'all' ? tasks : tasks.filter((x) => x.status === filter)),
    [tasks, filter]
  );

  if (error) return <p className="error">{error}</p>;

  return (
    <>
      <div className="pagehead">
        <p className="eyebrow">{t('tasks.eyebrow')}</p>
        <h1>{t('tasks.title')}</h1>
        <p>{t('tasks.subtitle')}</p>
      </div>
      {/* Filter chips — one per lifecycle state */}
      <div className="chips">
        {STATUSES.map((s) => (
          <button
            key={s}
            className={filter === s ? 'chip active' : 'chip'}
            onClick={() => setFilter(s)}
          >
            {t(`status.${s}` as MessageKey)}
          </button>
        ))}
      </div>

      <table className="table">
        <thead>
          <tr>
            <th>{t('common.title')}</th>
            <th>{t('common.status')}</th>
            <th>{t('common.created')}</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((row) => (
            <tr key={row.id}>
              <td>
                {/* <bdi> keeps a Latin task title from reordering the RTL row */}
                <Link to={`/tasks/${row.id}`}>
                  <bdi>{row.title}</bdi>
                </Link>
              </td>
              <td>
                <span className={`badge b-${row.status}`}>
                  {t(`status.${row.status}` as MessageKey)}
                </span>
              </td>
              <td>{fmt.date(row.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {shown.length === 0 && <p>{t('tasks.empty')}</p>}
    </>
  );
}
