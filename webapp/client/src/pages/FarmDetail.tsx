/**
 * FarmDetail.tsx — one farm, in depth.
 * ---------------------------------------------------------------------------
 * Three issue columns (New / Active / Solved) mirroring the portfolio cards,
 * plus the farm's task table and — for roles allowed to read money — a small
 * financial roll-up. Selecting an issue expands its immutable stage timeline
 * so the owner can see exactly who moved it and when.
 */

import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api';
import { useErrorMessage, useI18n } from '../i18n';
import type { MessageKey } from '../i18n';
import type { Farm, Issue, IssueEvent, Task } from '../types';
import { bucketOf } from './Farms';

/** Column labels are catalogue KEYS, not text: the array outlives a re-render
 *  but the language does not, so the lookup has to happen inside the render. */
const COLUMNS: {
  key: 'new' | 'active' | 'solved';
  label: MessageKey;
  tone: string;
}[] = [
  { key: 'new', label: 'farms.new', tone: 'red' },
  { key: 'active', label: 'farms.active', tone: 'orange' },
  { key: 'solved', label: 'farms.solved', tone: 'green' },
];

export default function FarmDetail() {
  const { id = '' } = useParams();
  const { t, fmt } = useI18n();
  const describeError = useErrorMessage();
  const [farm, setFarm] = useState<Farm | null>(null);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [money, setMoney] = useState<any | null>(null);
  const [openIssue, setOpenIssue] = useState<string | null>(null);
  const [events, setEvents] = useState<Record<string, IssueEvent[]>>({});
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const [farms, farmIssues, allTasks] = await Promise.all([
          api.v2Farms(),
          api.issues(id),
          api.tasks(),
        ]);
        setFarm(farms.find((f) => f.id === id) ?? null);
        setIssues(farmIssues);
        setTasks(allTasks.filter((x) => x.farmId === id));
        // Finance is owner/accountant-only; a moderator simply sees no panel.
        setMoney(await api.financeSummary(id).catch(() => null));
      } catch (e) {
        setError(describeError(e));
      }
    })();
  }, [id, describeError]);

  /** Lazily load a timeline the first time its issue is expanded. */
  async function toggle(issueId: string) {
    setOpenIssue((cur) => (cur === issueId ? null : issueId));
    if (!events[issueId]) {
      const list = await api.issueEvents(issueId).catch(() => [] as IssueEvent[]);
      setEvents((cur) => ({ ...cur, [issueId]: list }));
    }
  }

  if (error) return <p className="error">{error}</p>;
  if (!farm) return <p className="muted">{t('farmDetail.loading')}</p>;

  return (
    <>
      <p className="muted">
        <Link to="/farms">‹ {t('farmDetail.allFarms')}</Link>
      </p>
      <div className="pagehead">
        <p className="eyebrow">{t('farmDetail.eyebrow')}</p>
        <h1><bdi>{farm.name}</bdi></h1>
      </div>

      <figure className="photo hero-strip">
        <img src="/images/01-farm-overview.jpg" alt="" />
        <figcaption>{t('farmDetail.heroCaption')}</figcaption>
      </figure>

      <section>
        <h2>{t('farmDetail.issues')}</h2>
        <div className="board">
          {COLUMNS.map((col) => {
            const items = issues.filter((i) => bucketOf(i) === col.key);
            return (
              <div className="board-col" key={col.key}>
                <h3>
                  <span className={`chip ${col.tone}`}>
                    {fmt.number(items.length)}
                  </span>{' '}
                  {t(col.label)}
                </h3>
                {items.map((issue) => (
                  <div className="issue-card" key={issue.id}>
                    <button className="link-btn" onClick={() => toggle(issue.id)}>
                      <bdi>{issue.title}</bdi>
                    </button>
                    <p className="muted">
                      {t('farmDetail.issueMeta', {
                        kind: issue.kind,
                        severity: issue.severity,
                      })}{' '}
                      <span className="badge">
                        {t(`stage.${issue.stage}` as MessageKey)}
                      </span>
                    </p>
                    {issue.taskId && (
                      <p>
                        <Link to={`/tasks/${issue.taskId}/report`}>
                          📄 {t('farmDetail.taskReport')}
                        </Link>
                      </p>
                    )}
                    {openIssue === issue.id && (
                      <ol className="timeline">
                        {(events[issue.id] ?? []).map((e) => (
                          <li key={e.id}>
                            <b>
                              {t('farmDetail.transition', {
                                from: t(`stage.${e.fromStage}` as MessageKey),
                                to: t(`stage.${e.toStage}` as MessageKey),
                              })}
                            </b>{' '}
                            <span className="muted">
                              {t('farmDetail.transitionBy', {
                                role: t(`role.${e.actorRole}` as MessageKey),
                                when: fmt.dateTime(e.at),
                              })}
                            </span>
                            {e.note && <div className="desc"><bdi>{e.note}</bdi></div>}
                          </li>
                        ))}
                        {(events[issue.id] ?? []).length === 0 && (
                          <li className="muted">
                            {t('farmDetail.noTransitions')}
                          </li>
                        )}
                      </ol>
                    )}
                  </div>
                ))}
                {items.length === 0 && (
                  <p className="muted">{t('farmDetail.nothingHere')}</p>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section>
        <h2>{t('farmDetail.tasksOnFarm')}</h2>
        <table className="table">
          <thead>
            <tr>
              <th>{t('common.title')}</th>
              <th>{t('common.status')}</th>
              <th>{t('common.created')}</th>
              <th>{t('farmDetail.report')}</th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((row) => (
              <tr key={row.id}>
                <td>
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
                <td>
                  <Link to={`/tasks/${row.id}/report`}>
                    {t('farmDetail.fullReport')}
                  </Link>
                </td>
              </tr>
            ))}
            {tasks.length === 0 && (
              <tr>
                <td colSpan={4} className="muted">
                  {t('farmDetail.noTasks')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      {money && (
        <section>
          <h2>{t('farmDetail.finance')}</h2>
          <div className="kpis">
            <div className="kpi green">
              <b>{fmt.currency(money.totalIncome ?? 0)}</b>{' '}
              {t('farmDetail.income')}
            </div>
            <div className="kpi red">
              <b>{fmt.currency(money.totalExpense ?? 0)}</b>{' '}
              {t('farmDetail.expense')}
            </div>
            <div className="kpi orange">
              <b>{fmt.currency(money.net ?? 0)}</b> {t('farmDetail.net')}
            </div>
          </div>
        </section>
      )}
    </>
  );
}
