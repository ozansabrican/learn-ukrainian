import { resolve } from 'node:path';

try {
  process.loadEnvFile('.env');
} catch {
  // no .env file — fall back to defaults
}

const env = process.env;
const onVercel = Boolean(env.VERCEL);

export const config = {
  port: Number(env.PORT ?? 3000),
  /** On Vercel leave it to the platform (as in Vercel's examples). */
  host: onVercel ? undefined : (env.HOST ?? '127.0.0.1'),
  /** 'blob' = Vercel Blob, 'file' = JSON files in DATA_DIR (local dev) */
  storage: (env.STORAGE ?? (onVercel ? 'blob' : 'file')) as 'blob' | 'file',
  dataDir: resolve(env.DATA_DIR ?? 'data'),
  /** Prefix for blob pathnames, e.g. "dev/" to keep test data apart */
  blobPrefix: env.BLOB_PREFIX ?? '',
  /** Local dev only: serve index.html live from here. On Vercel the bundled copy is used. */
  webRoot: onVercel ? undefined : resolve(env.WEB_ROOT ?? '..'),
  corsOrigin: parseCors(env.CORS_ORIGIN ?? '*'),
  logLevel: env.LOG_LEVEL ?? 'info',
};

function parseCors(value: string): true | string[] {
  if (value.trim() === '*') return true;
  return value.split(',').map((s) => s.trim()).filter(Boolean);
}
