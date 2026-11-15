import { BlobPreconditionFailedError, get, put } from '@vercel/blob';
import type { KV, Versioned } from './kv.js';

/**
 * Vercel Blob, private store. On Vercel the SDK authenticates automatically;
 * locally it needs BLOB_READ_WRITE_TOKEN (e.g. from `vercel env pull`).
 */
export class BlobKV implements KV {
  constructor(private prefix = '') {}

  async read(key: string): Promise<Versioned | null> {
    // useCache: false → always the latest write, not a CDN-cached copy.
    const res = await get(this.prefix + key, { access: 'private', useCache: false });
    if (!res || res.statusCode !== 200) return null;
    const data = await new Response(res.stream).text();
    return { data, version: res.blob.etag };
  }

  async write(key: string, data: string, expected: string | null): Promise<boolean> {
    const pathname = this.prefix + key;
    const common = {
      access: 'private' as const,
      addRandomSuffix: false,
      contentType: 'application/json',
      cacheControlMaxAge: 60,
    };
    try {
      if (expected === null) {
        // Create: fails if someone else created it in the meantime.
        await put(pathname, data, { ...common, allowOverwrite: false });
      } else {
        await put(pathname, data, { ...common, allowOverwrite: true, ifMatch: expected });
      }
      return true;
    } catch (err) {
      if (err instanceof BlobPreconditionFailedError) return false;
      // "already exists" on create → treat as a conflict if it really exists now.
      if (expected === null && (await this.read(key))) return false;
      throw err;
    }
  }
}
