/**
 * routes/ratings.ts — evaluations (owner→moderator/worker, moderator→worker)
 *   POST /ratings {rateeId, stars, comment?} → Rating
 *   GET  /ratings?rateeId=                   → Rating[]
 *
 * The who-may-rate-whom matrix is enforced HERE (server-side), not in the UI:
 *   owner → moderator | worker ; moderator → worker ; worker → nobody.
 */

import type { FastifyInstance } from 'fastify';
import type { Role } from '../types.js';
import { requireRole } from '../auth.js';
import {
  canRate,
  getUser,
  insertRating,
  listRatingsFor,
} from '../store.js';

export default async function ratingRoutes(app: FastifyInstance) {
  /** Submit an evaluation. Ratings are append-only (audit trail). */
  app.post(
    '/ratings',
    { preHandler: requireRole('owner', 'moderator') }, // workers can't rate
    async (request, reply) => {
      const { rateeId, stars, comment } = request.body as {
        rateeId?: string;
        stars?: number;
        comment?: string;
      };
      // ---- validation ----
      if (!rateeId || !stars) {
        return reply.code(400).send({ error: 'rateeId and stars required' });
      }
      if (!Number.isInteger(stars) || stars < 1 || stars > 5) {
        return reply.code(400).send({ error: 'stars must be an integer 1–5' });
      }
      const ratee = getUser(rateeId);
      if (!ratee) return reply.code(404).send({ error: 'Ratee not found' });

      // ---- central permission rule (ARCHITECTURE.md §1) ----
      const session = (request as any).session;
      if (!canRate(session.role, ratee.role as Role)) {
        return reply.code(403).send({
          error: `${session.role} cannot rate ${ratee.role}`,
        });
      }
      const rater = getUser(session.userId)!;
      return reply.code(201).send(
        insertRating({
          raterId: rater.id,
          rateeId,
          stars: stars as 1 | 2 | 3 | 4 | 5,
          comment: comment?.trim() || undefined,
        })
      );
    }
  );

  /** List evaluations, optionally filtered to one person's profile feed. */
  app.get('/ratings', { preHandler: requireRole() }, async (request) => {
    const { rateeId } = request.query as { rateeId?: string };
    if (rateeId) return listRatingsFor(rateeId);
    // No filter → all ratings the caller may see (dev convenience).
    return [...listRatingsFor('')]; // empty match → [] keeps contract simple
  });
}
