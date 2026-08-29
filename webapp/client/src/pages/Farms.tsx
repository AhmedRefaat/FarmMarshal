/**
 * Farms.tsx — the land owner's (and moderator's) PORTFOLIO view.
 * ---------------------------------------------------------------------------
 * Answers "which farms am I responsible for, and what is the state of each?"
 * Every farm card carries the three issue buckets the owner asked for:
 *
 *   New     = stage `detected`                      (nobody has looked yet)
 *   Active  = inspected…reviewed                    (work in flight)
 *   Solved  = stage `closed`
 *
 * Issues are fetched PER FARM on purpose: `GET /v2/issues` without a farmId
 * collapses the farm-scoped authorization check to admin-only, so the client
 * fans out instead of asking for everything at once.
 */

import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useErrorMessage, useI18n } from '../i18n';
import type { Farm, Issue, Task } from '../types';

/** Bucket definitions shared with FarmDetail so both views always agree. */
export const NEW_STAGES = ['detected'] as const;
export const ACTIVE_STAGES = [
  'inspected',
  'identified',
  'recommended',
  'implemented',
  'reviewed',
] as const;

export function bucketOf(issue: Issue): 'new' | 'active' | 'solved' {
  if (issue.stage === 'closed') return 'solved';
  return (NEW_STAGES as readonly string[]).includes(issue.stage)
    ? 'new'
    : 'active';
}

interface FarmRow {
  farm: Farm;
  issues: Issue[];
  tasks: Task[];
}

export default function Farms() {
  const { t, fmt } = useI18n();
  const describeError = useErrorMessage();
  const [rows, setRows] = useState<FarmRow[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [farms, tasks] = await Promise.all([api.v2Farms(), api.tasks()]);
        const withIssues = await Promise.all(
          farms.map(async (farm) => ({
            farm,
            // A farm the caller can list but not read issues for must not blank
            // the whole page — degrade that single card to zero counts.
            issues: await api.issues(farm.id).catch(() => [] as Issue[]),
            tasks: tasks.filter((x) => x.farmId === farm.id),
          }))
        );
        setRows(withIssues);
      } catch (e) {
        setError(describeError(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [describeError]);

  if (error) return <p className="error">{error}</p>;
  if (loading) return <p className="muted">{t('farms.loading')}</p>;

  const all = rows.flatMap((r) => r.issues);
  const total = (bucket: 'new' | 'active' | 'solved') =>
    all.filter((i) => bucketOf(i) === bucket).length;

  return (
    <>
      <h1>{t('farms.title')}</h1>
      {/* Arabic agrees the noun with the count, so the whole sentence is one
          plural-aware key rather than a number glued to a bare noun. */}
      <p className="muted">{t('farms.subtitle', { count: rows.length })}</p>

      {/* Portfolio-wide roll-up across every farm. */}
      <div className="kpis">
        <div className="kpi red">
          <b>{fmt.number(total('new'))}</b> {t('farms.newIssues')}
        </div>
        <div className="kpi orange">
          <b>{fmt.number(total('active'))}</b> {t('farms.activeIssues')}
        </div>
        <div className="kpi green">
          <b>{fmt.number(total('solved'))}</b> {t('farms.solvedIssues')}
        </div>
      </div>

      <div className="card-grid">
        {rows.map(({ farm, issues, tasks }) => {
          const n = (b: 'new' | 'active' | 'solved') =>
            issues.filter((i) => bucketOf(i) === b).length;
          return (
            <Link key={farm.id} to={`/farms/${farm.id}`} className="farm-card">
              <h3><bdi>{farm.name}</bdi></h3>
              <p className="muted">
                {t('farms.cardCounts', {
                  tasks: fmt.number(tasks.length),
                  issues: fmt.number(issues.length),
                })}
              </p>
              <div className="chips">
                <span className="chip red">
                  {fmt.number(n('new'))} {t('farms.new')}
                </span>
                <span className="chip orange">
                  {fmt.number(n('active'))} {t('farms.active')}
                </span>
                <span className="chip green">
                  {fmt.number(n('solved'))} {t('farms.solved')}
                </span>
              </div>
            </Link>
          );
        })}
        {rows.length === 0 && <p>{t('farms.empty')}</p>}
      </div>
    </>
  );
}
