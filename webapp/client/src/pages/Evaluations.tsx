/**
 * Evaluations.tsx — people directory with star ratings.
 * ---------------------------------------------------------------------------
 * • Owner sees moderators + workers with average stars and may rate both.
 * • Moderator sees workers only (server enforces the same rule).
 * • Rating modal: 5 star buttons + optional comment → POST /ratings.
 */

import React, { useEffect, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import type { User } from '../types';

/** One row in the directory: person + their live average stars. */
interface Row {
  user: User;
  avgStars: number;
  count: number;
}

export default function Evaluations() {
  const { user: me } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState('');

  /** Modal state: which person am I rating right now? */
  const [ratee, setRatee] = useState<User | null>(null);
  const [stars, setStars] = useState(0);
  const [note, setNote] = useState('');

  // Load the rateable people per my role, then enrich each with stats.
  async function load() {
    try {
      const users = await api.users();
      const rateable = users.filter((u) => {
        if (me?.role === 'owner') return u.role !== 'owner'; // owner rates mods+workers
        if (me?.role === 'moderator') return u.role === 'worker'; // mod rates workers
        return false; // workers see an empty page (cannot rate)
      });
      const enriched = await Promise.all(
        rateable.map(async (u) => {
          // Merge identity + aggregate stats into one flat row object.
          const s = await api.userStats(u.id);
          return { user: u, avgStars: s.avgStars, count: s.count } as Row;
        })
      );
      setRows(enriched);
    } catch (e: any) {
      setError(e.message);
    }
  }
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.role]);

  /** Submit the open modal as a rating and refresh the averages. */
  async function submitRating() {
    if (!ratee || stars < 1) return;
    try {
      await api.rate(ratee.id, stars, note.trim() || undefined);
      setRatee(null); // close modal
      setStars(0);
      setNote('');
      await load(); // pull fresh averages
    } catch (e: any) {
      setError(e.message);
    }
  }

  if (error) return <p className="error">{error}</p>;

  return (
    <>
      <h1>Evaluations</h1>
      <p className="muted">
        {me?.role === 'owner'
          ? 'Rate your moderators and workers.'
          : 'Rate your workers.'}
      </p>

      <table className="table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Role</th>
            <th>Average</th>
            <th>#</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.user.id}>
              <td>{r.user.name}</td>
              <td>{r.user.role}</td>
              {/* Render avg as filled/empty stars for instant readability */}
              <td>
                {'⭐'.repeat(Math.round(r.avgStars) || 0) || '—'}{' '}
                {r.avgStars > 0 ? r.avgStars.toFixed(1) : ''}
              </td>
              <td>{r.count}</td>
              <td>
                <button onClick={() => setRatee(r.user)}>Rate</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* ---- Rating modal ---- */}
      {ratee && (
        <div className="modal" onClick={() => setRatee(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <h3>Rate {ratee.name}</h3>
            <div className="stars">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  className={n <= stars ? 'star on' : 'star'}
                  onClick={() => setStars(n)}
                >
                  ★
                </button>
              ))}
            </div>
            <input
              placeholder="Optional comment…"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <div className="row">
              <button onClick={() => setRatee(null)}>Cancel</button>
              <button className="green" disabled={stars < 1} onClick={submitRating}>
                Submit
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
