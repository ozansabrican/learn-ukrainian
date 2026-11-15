import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import cors from '@fastify/cors';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import type { DeckName } from './decks.js';
import { deckRoutes, type KeyedItem } from './routes/decks.js';
import { progressRoutes } from './routes/progress.js';
import type { ProgressStore } from './store/progress-store.js';

export interface AppOptions {
  store: ProgressStore;
  decks: Record<DeckName, KeyedItem[]>;
  /** The app's HTML, served at / (bundled copy from `npm run gen`) */
  indexHtml?: string;
  /** Local dev: read index.html from this folder on every request instead */
  webRoot?: string;
  corsOrigin?: true | string[];
}

/** Options for the Fastify() constructor. */
export function serverOptions(logger: FastifyServerOptions['logger'] = false): FastifyServerOptions {
  return {
    logger,
    bodyLimit: 1024 * 1024,
    // Reject unknown fields instead of silently dropping them.
    ajv: { customOptions: { removeAdditional: false } },
  };
}

/** Builds a ready-to-use app (used by the tests). */
export async function buildApp(opts: AppOptions) {
  const app = Fastify(serverOptions());
  await configureApp(app, opts);
  return app;
}

/** Registers plugins and routes on an existing Fastify instance. */
export async function configureApp(
  app: FastifyInstance,
  { store, decks, indexHtml, webRoot, corsOrigin = true }: AppOptions,
) {
  await app.register(cors, { origin: corsOrigin, methods: ['GET', 'PATCH'] });

  app.get('/api/health', async () => ({ ok: true }));
  deckRoutes(app, decks);
  progressRoutes(app, store);

  app.get('/', async (_req, reply) => {
    let html = indexHtml;
    if (webRoot) {
      // Local dev: read fresh so edits to index.html show up on reload.
      html = await readFile(join(webRoot, 'index.html'), 'utf8').catch(() => indexHtml);
    }
    if (!html) return reply.code(404).send({ error: 'index.html not available' });
    return reply.type('text/html; charset=utf-8').header('cache-control', 'no-cache').send(html);
  });
}
