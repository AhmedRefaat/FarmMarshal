/**
 * TaskList.tsx — filterable table of every task on the land.
 * Status chips filter client-side; rows link to the detail page.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import type { Task, TaskStatus } from '../types';

const STATUSES: (TaskStatus | 'all')[] = [
  'all', 'assigned', 'in_progress', 'submitted', 'approved', 'rejected',
];

export default function TaskList() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [filter, setFilter] = useState<TaskStatus | 'all'>('all');
  const [error, setError] = useState('');

  useEffect(() => {
    api.tasks().then(setTasks).catch((e) => setError(e.message));
  }, []);

  /** Apply the status chip filter before rendering. */
  const shown = useMemo(
    () => (filter === 'all' ? tasks : tasks.filter((t) => t.status === filter)),
    [tasks, filter]
  );

  if (error) return <p className="error">{error}</p>;

  return (
    <>
      <h1>Tasks</h1>
      {/* Filter chips — one per lifecycle state */}
      <div className="chips">
        {STATUSES.map((s) => (
          <button
            key={s}
            className={filter === s ? 'chip active' : 'chip'}
            onClick={() => setFilter(s)}
          >
            {s}
          </button>
        ))}
      </div>

      <table className="table">
        <thead>
          <tr>
            <th>Title</th>
            <th>Status</th>
            <th>Created</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((t) => (
            <tr key={t.id}>
              <td>
                <Link to={`/tasks/${t.id}`}>{t.title}</Link>
              </td>
              <td>
                <span className={`badge b-${t.status}`}>{t.status}</span>
              </td>
              <td>{new Date(t.createdAt).toLocaleDateString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {shown.length === 0 && <p>No tasks match this filter.</p>}
    </>
  );
}
