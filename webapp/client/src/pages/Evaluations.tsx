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
import { useErrorMessage, useI18n } from '../i18n';
import type { MessageKey } from '../i18n';
import type { User } from '../types';

/** One row in the directory: person + their live average stars. */
interface Row {
  user: User;
  avgStars: number;
  count: number;
}

export default function Evaluations() {
  const { user: me } = useAuth();
  const { t, fmt } = useI18n();
  const describeError = useErrorMessage();
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
    } catch (e) {
      setError(describeError(e));
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
    } catch (e) {
      setError(describeError(e));
    }
  }

  if (error) return <p className="error">{error}</p>;

  return (
    <>
      <div className="pagehead">
        <p className="eyebrow">{t('evaluations.eyebrow')}</p>
        <h1>{t('evaluations.title')}</h1>
        <p>
          {me?.role === 'owner'
            ? t('evaluations.subtitleOwner')
            : t('evaluations.subtitleModerator')}
        </p>
      </div>

      <table className="table">
        <thead>
          <tr>
            <th>{t('common.name')}</th>
            <th>{t('common.role')}</th>
            <th>{t('evaluations.average')}</th>
            <th>{t('evaluations.ratings')}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.user.id}>
              <td><bdi>{r.user.name}</bdi></td>
              <td>{t(`role.${r.user.role}` as MessageKey)}</td>
              {/* Render avg as filled/empty stars for instant readability */}
              <td>
                {'⭐'.repeat(Math.round(r.avgStars) || 0) || t('common.none')}{' '}
                {r.avgStars > 0 ? fmt.number(r.avgStars) : ''}
              </td>
              <td>{fmt.number(r.count)}</td>
              <td>
                <button onClick={() => setRatee(r.user)}>
                  {t('evaluations.rate')}
                </button>
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={5} className="muted">
                {t('evaluations.empty')}
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {/* ---- Rating modal ---- */}
      {ratee && (
        <div className="modal" onClick={() => setRatee(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <h3>{t('evaluations.rateTitle', { name: ratee.name })}</h3>
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
              placeholder={t('evaluations.commentPlaceholder')}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <div className="row">
              <button onClick={() => setRatee(null)}>{t('common.cancel')}</button>
              <button className="green" disabled={stars < 1} onClick={submitRating}>
                {t('common.submit')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
