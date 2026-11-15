// Entry point — Vercel detects it because it imports fastify; also used by `npm run dev`.
import Fastify from 'fastify';
import { config } from './config.js';
import { configureApp, serverOptions } from './create-app.js';
import { decks } from './generated/decks.js';
import { adminHtml, indexHtml } from './generated/page.js';
import { BlobKV } from './store/blob-kv.js';
import { FileKV } from './store/file-kv.js';
import { ProgressStore } from './store/progress-store.js';
import { CustomWordsStore } from './words.js';

const kv = config.storage === 'blob' ? new BlobKV(config.blobPrefix) : new FileKV(config.dataDir);

const app = Fastify(serverOptions({ level: config.logLevel }));
await configureApp(app, {
  store: new ProgressStore(kv),
  words: new CustomWordsStore(kv, decks),
  decks,
  adminPassword: config.adminPassword,
  adminHtml,
  adminFile: config.adminFile,
  indexHtml,
  webRoot: config.webRoot,
  corsOrigin: config.corsOrigin,
});

if (!config.adminPassword) app.log.warn('ADMIN_PASSWORD is not set — /admin is read-only.');
app.log.info(
  `storage: ${config.storage === 'blob' ? `Vercel Blob${config.blobPrefix ? ` (prefix "${config.blobPrefix}")` : ''}` : config.dataDir}`,
);

// Not awaited, on purpose: on Vercel, listen() is intercepted and its promise
// never settles — awaiting it here would stop this module from finishing loading,
// so the function never becomes ready (FUNCTION_INVOCATION_FAILED).
// This matches Vercel's own Fastify example.
app.listen({ port: config.port, host: config.host }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
