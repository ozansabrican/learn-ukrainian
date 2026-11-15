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
