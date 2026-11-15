/**
 * Tiny key/value interface with optimistic concurrency, implemented by
 * Vercel Blob (production), local JSON files (dev) and memory (tests).
 */
export interface Versioned {
  data: string;
  /** Opaque version token (an ETag for Blob, a counter/hash locally). */
  version: string;
}

export interface KV {
  read(key: string): Promise<Versioned | null>;
  /**
   * Write `data` only if the stored version still equals `expected`
   * (`null` = the key must not exist yet). Returns false on a conflict.
   */
  write(key: string, data: string, expected: string | null): Promise<boolean>;
}

/** In-memory KV, used by the tests. */
export class MemoryKV implements KV {
  private items = new Map<string, Versioned>();
  private counter = 0;

  async read(key: string) {
    return this.items.get(key) ?? null;
  }

  async write(key: string, data: string, expected: string | null) {
    const current = this.items.get(key)?.version ?? null;
    if (current !== expected) return false;
    this.items.set(key, { data, version: String(++this.counter) });
    return true;
  }
}

/**
 * Read → change → conditional write, retried when someone else wrote in
 * between, so concurrent updates are never lost. `change` may throw to abort.
 */
export async function updateJson<T, R>(
  kv: KV,
  key: string,
  empty: () => T,
  change: (doc: T) => R,
  maxAttempts = 8,
): Promise<{ doc: T; result: R }> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const cur = await kv.read(key);
    const doc = cur ? (JSON.parse(cur.data) as T) : empty();
    const result = change(doc);
    if (await kv.write(key, JSON.stringify(doc), cur?.version ?? null)) return { doc, result };
    await new Promise((r) => setTimeout(r, 20 * 2 ** attempt * Math.random()));
  }
  throw new Error(`Could not save "${key}" (too many concurrent writes)`);
}
