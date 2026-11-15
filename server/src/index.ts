import { buildApp } from './app.js';
import { config } from './config.js';
import { decks } from './generated/decks.js';
import { BlobKV } from './store/blob-kv.js';
import { FileKV } from './store/file-kv.js';
import { ProgressStore } from './store/progress-store.js';

const kv = config.storage === 'blob' ? new BlobKV(config.blobPrefix) : new FileKV(config.dataDir);

const app = await buildApp({
  store: new ProgressStore(kv),
  decks,
  webRoot: config.webRoot,
  corsOrigin: config.corsOrigin,
  logger: { level: config.logLevel },
});

app.log.info(
  `storage: ${config.storage === 'blob' ? `Vercel Blob${config.blobPrefix ? ` (prefix "${config.blobPrefix}")` : ''}` : config.dataDir}`,
);

await app.listen({ port: config.port, host: config.host });
