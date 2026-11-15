import type { FastifyInstance } from 'fastify';
import { DECK_NAMES } from '../decks.js';
import type { Progress, ProgressStore } from '../store/progress-store.js';

/**
 * A profile is just a name the user picks (e.g. "ozan") and types on every
 * device they want to share progress between. No password — see README.
 */
export const PROFILE_ID_PATTERN = '^[a-z0-9][a-z0-9_-]{2,39}$';

const profileParams = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'string', pattern: PROFILE_ID_PATTERN } },
} as const;

const progressBody = {
  type: 'object',
  additionalProperties: false,
  properties: Object.fromEntries(
    DECK_NAMES.map((d) => [
      d,
      {
        type: 'object',
        maxProperties: 5000,
        additionalProperties: { type: 'integer' },
      },
    ]),
  ),
} as const;

export function progressRoutes(app: FastifyInstance, store: ProgressStore): void {
  // 404 means "nobody has used this name yet" — the client then offers to
  // start it fresh or copy the device's current progress into it.
  app.get<{ Params: { id: string } }>(
    '/api/profiles/:id/progress',
    { schema: { params: profileParams } },
    async (req, reply) => {
      const found = await store.get(req.params.id);
      if (!found) return reply.code(404).send({ error: 'Profile not found' });
      return found;
    },
  );

  // Merge: only the given items are written; everything else is kept.
  // The profile is created on its first write.
  app.patch<{ Params: { id: string }; Body: Progress }>(
    '/api/profiles/:id/progress',
    { schema: { params: profileParams, body: progressBody } },
    async (req) => store.merge(req.params.id, req.body),
  );
}
