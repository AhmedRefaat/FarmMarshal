/**
 * TaskDetail.tsx — the richest page: evidence, discussion, decisions.
 * ---------------------------------------------------------------------------
 * Sections:
 *   1. Task header + status + description + review note
 *   2. Evidence photos (before / after) when present
 *   3. Moderator decision buttons (approve/reject) when 'submitted'
 *   4. Comment thread — text comments + AUDIO voice notes:
 *        • playback via <audio controls> for existing notes
 *        • recording via the browser MediaRecorder API (no dependencies)
 *   5. Rate-the-worker widget for moderators (after approval)
 */

import React, { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { useErrorMessage, useI18n } from '../i18n';
import type { MessageKey } from '../i18n';
import type { Comment, Task } from '../types';

export default function TaskDetail() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const { t, fmt } = useI18n();
  const describeError = useErrorMessage();

  const [task, setTask] = useState<Task | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');

  // ---- audio recorder state -------------------------------------------------
  /** Live MediaRecorder instance while a voice note is being recorded. */
  const recorder = useRef<MediaRecorder | null>(null);
  /** Audio chunks accumulated during the current recording. */
  const chunks = useRef<Blob[]>([]);
  const [recording, setRecording] = useState(false);

  // Initial load: task + its comment thread in parallel.
  useEffect(() => {
    if (!id) return;
    api.task(id).then(setTask).catch((e) => setError(describeError(e)));
    api.comments(id).then(setComments).catch((e) => setError(describeError(e)));
  }, [id, describeError]);

  /** Moderator decision → PATCH transition → refresh task view. */
  async function decide(action: 'approve' | 'reject') {
    if (!id) return;
    try {
      const note =
        action === 'reject'
          ? window.prompt(t('task.rejectPrompt')) ?? ''
          : undefined;
      setTask(await api.transitionTask(id, action, note));
    } catch (e) {
      setError(describeError(e));
    }
  }

  /** Send the text draft as a comment and clear the box. */
  async function sendComment() {
    if (!id || !draft.trim()) return;
    try {
      const c = await api.addComment(id, draft.trim());
      setComments((cs) => [...cs, c]); // append locally; no refetch needed
      setDraft('');
    } catch (e) {
      setError(describeError(e));
    }
  }

  /** Start capturing microphone audio (asks browser permission). */
  async function startRecording() {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    chunks.current = [];
    const rec = new MediaRecorder(stream);
    rec.ondataavailable = (e) => chunks.current.push(e.data); // collect pieces
    rec.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop()); // release mic
      const blob = new Blob(chunks.current, { type: 'audio/webm' });
      if (id && blob.size > 0) {
        const c = await api.addAudioComment(id, blob); // upload & attach
        setComments((cs) => [...cs, c]);
      }
    };
    rec.start();
    recorder.current = rec;
    setRecording(true);
  }

  /** Stop the active recorder; onstop handler performs the upload. */
  function stopRecording() {
    recorder.current?.stop();
    setRecording(false);
  }

  if (error) return <p className="error">{error}</p>;
  if (!task) return <p>{t('common.loading')}</p>;

  const isMod = user?.role === 'moderator';
  const canDecide = isMod && task.status === 'submitted';

  return (
    <>
      {/* 1 ── Header */}
      <div className="pagehead">
        <p className="eyebrow">{t('taskDetail.eyebrow')}</p>
        <h1><bdi>{task.title}</bdi></h1>
      </div>
      <span className={`badge b-${task.status}`}>
        {t(`status.${task.status}` as MessageKey)}
      </span>
      <p className="desc"><bdi>{task.description}</bdi></p>
      <p className="muted">
        📍{' '}
        {t('task.location', {
          // Coordinates stay Western digits in both locales (ADR-027) and are
          // isolated by the interpolator so RTL never reorders lat/lng.
          lat: fmt.number(Number(task.lat.toFixed(5))),
          lng: fmt.number(Number(task.lng.toFixed(5))),
        })}
      </p>
      {task.reviewNote && (
        <p className="muted">{t('task.reviewNote', { note: task.reviewNote })}</p>
      )}
      <p>
        {/* Full audit trail: reporter, assignee, milestones, issue workflow */}
        <Link to={`/tasks/${task.id}/report`}>📄 {t('task.openReport')}</Link>
      </p>

      {/* 2 ── Evidence photos. With nothing uploaded the workflow reads as
          broken, so a clearly-labelled sample pair stands in for the demo. */}
      <div className="photos">
        {task.beforePhotoUrl || task.afterPhotoUrl ? (
          <>
            {task.beforePhotoUrl && (
              <figure className="photo">
                <figcaption>{t('task.before')}</figcaption>
                <img src={task.beforePhotoUrl} alt={t('task.before')} />
              </figure>
            )}
            {task.afterPhotoUrl && (
              <figure className="photo">
                <figcaption>{t('task.after')}</figcaption>
                <img src={task.afterPhotoUrl} alt={t('task.after')} />
              </figure>
            )}
          </>
        ) : (
          <>
            <figure className="photo">
              <figcaption>{`${t('task.before')} · ${t('task.sampleEvidence')}`}</figcaption>
              <img src="/images/07-irrigation-fault-before.jpg" alt={t('task.before')} />
            </figure>
            <figure className="photo">
              <figcaption>{`${t('task.after')} · ${t('task.sampleEvidence')}`}</figcaption>
              <img src="/images/10-irrigation-after-repair.jpg" alt={t('task.after')} />
            </figure>
          </>
        )}
      </div>

      {/* 3 ── Moderator decision buttons */}
      {canDecide && (
        <div className="row">
          <button className="green" onClick={() => decide('approve')}>
            ✅ {t('task.approve')}
          </button>
          <button className="red" onClick={() => decide('reject')}>
            ❌ {t('task.reject')}
          </button>
        </div>
      )}

      {/* 4 ── Comment thread */}
      <h2>{t('task.discussion', { count: comments.length })}</h2>
      <ul className="thread">
        {comments.map((c) => (
          <li key={c.id}>
            <b><bdi>{c.authorName}</bdi></b>{' '}
            <span className="muted">
              ({t(`role.${c.authorRole}` as MessageKey)}) ·{' '}
              {fmt.time(c.createdAt)}
            </span>
            {c.text && <p><bdi>{c.text}</bdi></p>}
            {/* Voice-note player when this comment carries audio */}
            {c.audioUrl && <audio controls src={c.audioUrl} />}
          </li>
        ))}
      </ul>

      {/* Text composer */}
      <div className="row">
        <input
          placeholder={t('task.commentPlaceholder')}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && sendComment()}
        />
        <button onClick={sendComment}>{t('common.send')}</button>

        {/* Mic button toggles recording state */}
        {!recording ? (
          <button onClick={startRecording}>🎙️ {t('task.record')}</button>
        ) : (
          <button className="red" onClick={stopRecording}>
            ⏹ {t('task.stopSend')}
          </button>
        )}
      </div>
    </>
  );
}
