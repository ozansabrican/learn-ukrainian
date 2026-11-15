import { MAX_PTS, MIN_PTS, type DeckName } from '../decks.js';
import type { KV } from './kv.js';

/** { [deck]: { [itemKey]: points } } */
export type Progress = Partial<Record<DeckName, Record<string, number>>>;

export interface ProfileProgress {
  profileId: string;
  updatedAt: string | null;
  progress: Progress;
}

interface StoredDoc {
  v: 1;
  updatedAt: string;
  progress: Progress;
}

const MAX_ATTEMPTS = 8;

/** One JSON document per profile: profiles/<id>.json */
export class ProgressStore {
  constructor(private kv: KV) {}

  private key(profileId: string) {
    return `profiles/${profileId}.json`;
  }

  async get(profileId: string): Promise<ProfileProgress | null> {
    const cur = await this.kv.read(this.key(profileId));
    if (!cur) return null;
    const doc = JSON.parse(cur.data) as StoredDoc;
    return { profileId, updatedAt: doc.updatedAt, progress: doc.progress };
  }

  /**
   * Merge `changes` into the profile (creating it if needed). Uses
   * read → merge → conditional write, retrying if another device wrote
   * in between, so concurrent updates are never lost.
   */
  async merge(profileId: string, changes: Progress): Promise<ProfileProgress> {
    const key = this.key(profileId);
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const cur = await this.kv.read(key);
      const progress: Progress = cur ? (JSON.parse(cur.data) as StoredDoc).progress : {};

      for (const [deck, items] of Object.entries(changes) as [DeckName, Record<string, number>][]) {
        const target = (progress[deck] ??= {});
        for (const [itemKey, pts] of Object.entries(items)) {
          target[itemKey] = Math.max(MIN_PTS, Math.min(MAX_PTS, pts));
        }
      }

      const doc: StoredDoc = { v: 1, updatedAt: new Date().toISOString(), progress };
      if (await this.kv.write(key, JSON.stringify(doc), cur?.version ?? null)) {
        return { profileId, updatedAt: doc.updatedAt, progress };
      }
      await sleep(20 * 2 ** attempt * Math.random());
    }
    throw new Error(`Could not save progress for "${profileId}" (too many concurrent writes)`);
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
