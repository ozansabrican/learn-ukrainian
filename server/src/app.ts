import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import cors from '@fastify/cors';
import Fastify, { type FastifyServerOptions } from 'fastify';
import type { DeckName } from './decks.js';
import { deckRoutes, type KeyedItem } from './routes/decks.js';
import { progressRoutes } from './routes/progress.js';
import type { ProgressStore } from './store/progress-store.js';

export interface AppOptions {
  store: ProgressStore;
  decks: Record<DeckName, KeyedItem[]>;
  /** Folder containing index.html, served at / (local dev; on Vercel the CDN serves public/) */
  webRoot?: string;
  corsOrigin?: true | string[];
  logger?: FastifyServerOptions['logger'];
}

export async function buildApp({ store, decks, webRoot, corsOrigin = true, logger = false }: AppOptions) {
  const app = Fastify({
    logger,
    bodyLimit: 1024 * 1024,
    // Reject unknown fields instead of silently dropping them.
    ajv: { customOptions: { removeAdditional: false } },
  });

  await app.register(cors, { origin: corsOrigin, methods: ['GET', 'PATCH'] });

  app.get('/api/health', async () => ({ ok: true }));
  deckRoutes(app, decks);
  progressRoutes(app, store);

  // Read fresh on every request so edits to index.html show up immediately.
  app.get('/', async (_req, reply) => {
    if (webRoot) {
      try {
        const html = await readFile(join(webRoot, 'index.html'));
        return reply.type('text/html; charset=utf-8').header('cache-control', 'no-cache').send(html);
      } catch {
        // fall through
      }
    }
    return reply.redirect('/index.html');
  });

  return app;
}
