// Entry point — Vercel detects it because it imports fastify; also used by `npm run dev`.
import Fastify from 'fastify';
import { config } from './config.js';
import { configureApp, serverOptions } from './create-app.js';
import { decks } from './generated/decks.js';
import { indexHtml } from './generated/page.js';
import { BlobKV } from './store/blob-kv.js';
import { FileKV } from './store/file-kv.js';
import { ProgressStore } from './store/progress-store.js';

const kv = config.storage === 'blob' ? new BlobKV(config.blobPrefix) : new FileKV(config.dataDir);

const app = Fastify(serverOptions({ level: config.logLevel }));
await configureApp(app, {
  store: new ProgressStore(kv),
  decks,
  indexHtml,
  webRoot: config.webRoot,
  corsOrigin: config.corsOrigin,
});

app.log.info(
  `storage: ${config.storage === 'blob' ? `Vercel Blob${config.blobPrefix ? ` (prefix "${config.blobPrefix}")` : ''}` : config.dataDir}`,
);

await app.listen({ port: config.port, host: config.host });
