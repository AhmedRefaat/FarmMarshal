/**
 * routes/comments.ts — per-task discussion (text + audio voice notes)
 *   GET  /tasks/:id/comments          → Comment[]           (auth: any)
 *   POST /tasks/:id/comments {text}   → Comment             (auth: any)
 *   POST /tasks/:id/comments/audio    → Comment  (multipart audio file)
 *
 * Audio pipeline: browser MediaRecorder → multipart upload → saved under
 * /uploads/{uuid}.webm → comment row carries the public audioUrl.
 */

import type { FastifyInstance } from 'fastify';
import type { FastifyPluginOptions } from 'fastify';
import { requireRole } from '../auth.js';
import { getTask, insertComment, listComments, getUser } from '../store.js';

/** Plugin options carry the saveAudio helper injected from index.ts. */
export default async function commentRoutes(
  app: FastifyInstance,
  opts: FastifyPluginOptions & { saveAudio: (data: Buffer) => Promise<string> }
) {
  /** Full thread for a task, oldest first. */
  app.get('/tasks/:id/comments', { preHandler: requireRole() }, async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!getTask(id)) return reply.code(404).send({ error: 'Task not found' });
    return listComments(id);
  });

  /** Post a text comment. Any authenticated participant may speak. */
  app.post('/tasks/:id/comments', { preHandler: requireRole() }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { text } = request.body as { text?: string };
    const trimmed = text?.trim();
    if (!trimmed) return reply.code(400).send({ error: 'text required' });
    if (!getTask(id)) return reply.code(404).send({ error: 'Task not found' });

    const session = (request as any).session;
    const author = getUser(session.userId)!;
    return reply.code(201).send(
      insertComment({
        taskId: id,
        authorId: author.id,
        authorName: author.name,
        authorRole: author.role,
        text: trimmed,
      })
    );
  });

  /**
   * Post an AUDIO comment (voice note).
   * Accepts multipart/form-data with a `file` field; content-type must be
   * audio/* and size is capped at 10 MB (field workers on mobile data).
   */
  app.post('/tasks/:id/comments/audio', { preHandler: requireRole() }, async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!getTask(id)) return reply.code(404).send({ error: 'Task not found' });

    const file = await request.file(); // first part of the multipart body
    if (!file) return reply.code(400).send({ error: 'multipart file field required' });
    if (!file.mimetype.startsWith('audio/')) {
      return reply.code(415).send({ error: 'file must be audio/*' });
    }
    const buffer = await file.toBuffer();
    if (buffer.length > 10 * 1024 * 1024) {
      return reply.code(413).send({ error: 'audio exceeds 10 MB' });
    }

    // Persist bytes to /uploads then reference them by public URL.
    const audioUrl = await opts.saveAudio(buffer);
    const session = (request as any).session;
    const author = getUser(session.userId)!;
    return reply.code(201).send(
      insertComment({
        taskId: id,
        authorId: author.id,
        authorName: author.name,
        authorRole: author.role,
        audioUrl,
      })
    );
  });
}
