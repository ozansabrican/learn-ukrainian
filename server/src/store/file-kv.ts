import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { KV, Versioned } from './kv.js';

/**
 * Stores each key as a JSON file under `dir` — for local development, so you
 * don't need Vercel to run the server. Single-process only.
 */
export class FileKV implements KV {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private dir: string) {}

  private path(key: string) {
    return join(this.dir, key);
  }

  async read(key: string): Promise<Versioned | null> {
    try {
      const data = await readFile(this.path(key), 'utf8');
      return { data, version: hash(data) };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  write(key: string, data: string, expected: string | null): Promise<boolean> {
    // Serialise writes so the compare-and-swap below is atomic in-process.
    const run = this.queue.then(async () => {
      const current = await this.read(key);
      if ((current?.version ?? null) !== expected) return false;
      const file = this.path(key);
      await mkdir(dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      await writeFile(tmp, data);
      await rename(tmp, file);
      return true;
    });
    this.queue = run.catch(() => {});
    return run;
  }
}

function hash(s: string) {
  return createHash('sha1').update(s).digest('hex');
}
