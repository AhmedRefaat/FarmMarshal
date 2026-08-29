/**
 * TaskReport.tsx — the full story of ONE task.
 * ---------------------------------------------------------------------------
 * Backed by the single `GET /tasks/:id/report` aggregate so the page renders
 * from one round trip. It answers, in order:
 *   • WHO reported it, WHO owns it, WHO executed it, and on WHICH farm
 *   • WHAT happened and WHEN (task milestones)
 *   • the originating issue's full 7-stage workflow trail, up to "closed"
 *   • the review verdict and the complete comment thread
 */

import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api';
import { useErrorMessage, useI18n } from '../i18n';
import type { MessageKey } from '../i18n';
import type { PublicUser, TaskReport as Report } from '../types';

/** Small identity card; renders a neutral placeholder when unknown. */
function Person({ label, person }: { label: string; person: PublicUser | null }) {
  const { t } = useI18n();
  return (
    <div className="person">
      <span className="muted">{label}</span>
      <b><bdi>{person ? person.name : t('common.none')}</bdi></b>
      {person && (
        <span className="role-tag">
          {t(`role.${person.role}` as MessageKey)}
        </span>
      )}
    </div>
  );
}

/** The task's happy-path lifecycle, rendered as a progress rail. */
const LIFECYCLE = ['assigned', 'in_progress', 'submitted', 'approved'] as const;

export default function TaskReport() {
  const { id = '' } = useParams();
  const { t, fmt } = useI18n();
  const describeError = useErrorMessage();
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .taskReport(id)
      .then(setReport)
      .catch((e) => setError(describeError(e)));
  }, [id, describeError]);

  if (error) return <p className="error">{error}</p>;
  if (!report) return <p className="muted">{t('report.loading')}</p>;

  const { task, farm, reporter, assignee, worker, issue, issueEvents, comments, milestones } =
    report;

  return (
    <>
      <p className="muted">
        <Link to={`/tasks/${task.id}`}>‹ {t('report.backToTask')}</Link>
        {farm && (
          <>
            {' · '}
            <Link to={`/farms/${farm.id}`}><bdi>{farm.name}</bdi></Link>
          </>
        )}
      </p>

      <div className="pagehead">
        <p className="eyebrow">{t('report.eyebrow')}</p>
        <h1><bdi>{task.title}</bdi></h1>
        <p>{t('report.subtitle')}</p>
      </div>
      <p>
        <span className={`badge b-${task.status}`}>
          {t(`status.${task.status}` as MessageKey)}
        </span>{' '}
        <span className="muted">
          {t('report.location', {
            farm: farm ? farm.name : t('report.unknownFarm'),
            lat: fmt.number(Number(task.lat.toFixed(4))),
            lng: fmt.number(Number(task.lng.toFixed(4))),
          })}
        </span>
      </p>
      <p className="desc"><bdi>{task.description}</bdi></p>

      <section className="panel">
        <h2>{t('report.lifecycle')}</h2>
        {/* A rejected task never reaches "approved", so the rail stops at the
            furthest stage actually reached rather than assuming completion. */}
        <div className="stages">
          {LIFECYCLE.map((stage, i) => {
            const reached = LIFECYCLE.indexOf(
              task.status as (typeof LIFECYCLE)[number]
            );
            const done = reached >= 0 && i <= reached;
            return (
              <div key={stage} className={done ? 'stage done' : 'stage'}>
                <b>{done ? '\u2713' : fmt.number(i + 1)}</b>
                {t(`status.${stage}` as MessageKey)}
              </div>
            );
          })}
        </div>
      </section>

      <section className="panel">
        <h2>{t('report.people')}</h2>
        <div className="people">
          <Person label={t('report.reportedBy')} person={reporter} />
          <Person label={t('report.assignedBy')} person={assignee} />
          <Person label={t('report.executedBy')} person={worker} />
        </div>
      </section>

      <section className="panel">
        <h2>{t('report.milestones')}</h2>
        <ol className="audit">
          {milestones.map((m) => (
            <li key={m.key}>
              <time>{fmt.dateTime(m.at)}</time>
              <span className="what">
                {/* Unknown milestone keys fall back to the raw key rather than
                    to English prose, so a server addition is visibly
                    untranslated instead of silently mixing languages. */}
                <b>{t(`report.milestone.${m.key}` as MessageKey)}</b>
                <small>{t('report.responsible', { who: m.by })}</small>
                {m.note && <span className="desc"><bdi>{m.note}</bdi></span>}
              </span>
            </li>
          ))}
          {milestones.length === 0 && (
            <li className="muted">{t('report.noMilestones')}</li>
          )}
        </ol>
      </section>

      {issue && (
        <section className="panel">
          <h2>{t('report.issue')}</h2>
          <p>
            <b><bdi>{issue.title}</bdi></b>{' '}
            <span className="badge">
              {t(`stage.${issue.stage}` as MessageKey)}
            </span>{' '}
            <span className="muted">
              {t('report.issueMeta', {
                kind: issue.kind,
                severity: issue.severity,
                source: issue.source,
              })}
            </span>
          </p>
          <ol className="audit">
            {issueEvents.map((e) => (
              <li key={e.id}>
                <time>{fmt.dateTime(e.at)}</time>
                <span className="what">
                  <b>
                    {t('farmDetail.transition', {
                      from: t(`stage.${e.fromStage}` as MessageKey),
                      to: t(`stage.${e.toStage}` as MessageKey),
                    })}
                  </b>
                  <small>
                    {t('report.responsible', {
                      who: t(`role.${e.actorRole}` as MessageKey),
                    })}
                  </small>
                  {e.note && <span className="desc"><bdi>{e.note}</bdi></span>}
                </span>
              </li>
            ))}
            {issueEvents.length === 0 && (
              <li className="muted">{t('report.noTransitions')}</li>
            )}
          </ol>
          {issue.closedAt && (
            <p className="muted">
              {t('report.solvedOn', { when: fmt.dateTime(issue.closedAt) })}
            </p>
          )}
        </section>
      )}

      {task.reviewNote && (
        <section className="panel">
          <h2>{t('report.verdict')}</h2>
          <p className="desc"><bdi>{task.reviewNote}</bdi></p>
        </section>
      )}

      {(task.beforePhotoUrl || task.afterPhotoUrl) && (
        <section className="panel">
          <h2>{t('report.evidence')}</h2>
          <div className="photos">
            {task.beforePhotoUrl && (
              <figure>
                <img src={task.beforePhotoUrl} alt={t('task.before')} />
                <figcaption>{t('task.before')}</figcaption>
              </figure>
            )}
            {task.afterPhotoUrl && (
              <figure>
                <img src={task.afterPhotoUrl} alt={t('task.after')} />
                <figcaption>{t('task.after')}</figcaption>
              </figure>
            )}
          </div>
        </section>
      )}

      <section className="panel">
        <h2>{t('report.conversation', { count: comments.length })}</h2>
        <ul className="thread">
          {comments.map((c) => (
            <li key={c.id}>
              <b>
                <bdi>{c.authorName}</bdi>{' '}
                <span className="role-tag">
                  {t(`role.${c.authorRole}` as MessageKey)}
                </span>
              </b>{' '}
              <span className="muted">{fmt.dateTime(c.createdAt)}</span>
              {c.text && <div className="desc"><bdi>{c.text}</bdi></div>}
              {c.audioUrl && <audio controls src={c.audioUrl} />}
            </li>
          ))}
          {comments.length === 0 && (
            <li className="muted">{t('report.noComments')}</li>
          )}
        </ul>
      </section>
    </>
  );
}
