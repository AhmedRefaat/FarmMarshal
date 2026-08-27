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
import { useParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import type { Comment, Task } from '../types';

export default function TaskDetail() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();

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
    api.task(id).then(setTask).catch((e) => setError(e.message));
    api.comments(id).then(setComments).catch((e) => setError(e.message));
  }, [id]);

  /** Moderator decision → PATCH transition → refresh task view. */
  async function decide(action: 'approve' | 'reject') {
    if (!id) return;
    try {
      const note =
        action === 'reject'
          ? window.prompt('Rejection note for the worker:') ?? ''
          : undefined;
      setTask(await api.transitionTask(id, action, note));
    } catch (e: any) {
      setError(e.message);
    }
  }

  /** Send the text draft as a comment and clear the box. */
  async function sendComment() {
    if (!id || !draft.trim()) return;
    try {
      const c = await api.addComment(id, draft.trim());
      setComments((cs) => [...cs, c]); // append locally; no refetch needed
      setDraft('');
    } catch (e: any) {
      setError(e.message);
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
  if (!task) return <p>Loading…</p>;

  const isMod = user?.role === 'moderator';
  const canDecide = isMod && task.status === 'submitted';

  return (
    <>
      {/* 1 ── Header */}
      <h1>{task.title}</h1>
      <span className={`badge b-${task.status}`}>{task.status}</span>
      <p className="desc">{task.description}</p>
      <p className="muted">
        📍 {task.lat.toFixed(5)}, {task.lng.toFixed(5)}
        {task.reviewNote ? ` · note: ${task.reviewNote}` : ''}
      </p>

      {/* 2 ── Evidence photos */}
      <div className="photos">
        {task.beforePhotoUrl && (
          <figure>
            <figcaption>BEFORE</figcaption>
            <img src={task.beforePhotoUrl} alt="before" />
          </figure>
        )}
        {task.afterPhotoUrl && (
          <figure>
            <figcaption>AFTER</figcaption>
            <img src={task.afterPhotoUrl} alt="after" />
          </figure>
        )}
      </div>

      {/* 3 ── Moderator decision buttons */}
      {canDecide && (
        <div className="row">
          <button className="green" onClick={() => decide('approve')}>
            ✅ Approve
          </button>
          <button className="red" onClick={() => decide('reject')}>
            ❌ Reject
          </button>
        </div>
      )}

      {/* 4 ── Comment thread */}
      <h2>Discussion ({comments.length})</h2>
      <ul className="thread">
        {comments.map((c) => (
          <li key={c.id}>
            <b>{c.authorName}</b>{' '}
            <span className="muted">
              ({c.authorRole}) · {new Date(c.createdAt).toLocaleTimeString()}
            </span>
            {c.text && <p>{c.text}</p>}
            {/* Voice-note player when this comment carries audio */}
            {c.audioUrl && <audio controls src={c.audioUrl} />}
          </li>
        ))}
      </ul>

      {/* Text composer */}
      <div className="row">
        <input
          placeholder="Write a comment…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && sendComment()}
        />
        <button onClick={sendComment}>Send</button>

        {/* Mic button toggles recording state */}
        {!recording ? (
          <button onClick={startRecording}>🎙️ Record</button>
        ) : (
          <button className="red" onClick={stopRecording}>
            ⏹ Stop &amp; send
          </button>
        )}
      </div>
    </>
  );
}
