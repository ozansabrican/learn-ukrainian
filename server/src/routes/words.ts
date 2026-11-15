import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { isDeck, type DeckName } from '../decks.js';
import { DECK_INFO, WordError, type CustomWordsStore } from '../words.js';

export function wordRoutes(app: FastifyInstance, words: CustomWordsStore, adminPassword?: string): void {
  // Public: the app loads these on start and appends them to its lists.
  app.get('/api/words/custom', async (_req, reply) => {
    reply.header('cache-control', 'no-store');
    return words.list();
  });

  // Public: field definitions per deck, used by the admin page to build its forms.
  app.get('/api/words/schema', async () => DECK_INFO);

  // Everything under /api/admin needs `Authorization: Bearer <ADMIN_PASSWORD>`.
  app.register(async (admin) => {
    admin.addHook('onRequest', async (req, reply) => {
      if (!adminPassword) {
        return reply.code(503).send({ error: 'Admin is disabled: set the ADMIN_PASSWORD environment variable.' });
      }
      const given = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1] ?? '';
      if (!sameSecret(given, adminPassword)) {
        await new Promise((r) => setTimeout(r, 400)); // slow down guessing
        return reply.code(401).send({ error: 'Wrong password' });
      }
    });

    admin.get('/api/admin/check', async () => ({ ok: true }));

    admin.post<{ Params: { deck: string } }>('/api/admin/words/:deck', async (req, reply) => {
      const item = await words.add(deckOf(req.params.deck), req.body);
      return reply.code(201).send(item);
    });

    admin.put<{ Params: { deck: string; key: string } }>('/api/admin/words/:deck/:key', async (req) =>
      words.update(deckOf(req.params.deck), req.params.key, req.body),
    );

    admin.delete<{ Params: { deck: string; key: string } }>('/api/admin/words/:deck/:key', async (req, reply) => {
      await words.remove(deckOf(req.params.deck), req.params.key);
      return reply.code(204).send();
    });
  });
}

function deckOf(name: string): DeckName {
  if (!isDeck(name)) throw new WordError(`Unknown deck "${name}"`, 404);
  return name;
}

function sameSecret(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}
