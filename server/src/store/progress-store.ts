import { MAX_PTS, MIN_PTS, type DeckName } from '../decks.js';
import { updateJson, type KV } from './kv.js';

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

  /** Merge `changes` into the profile (creating it if needed). */
  async merge(profileId: string, changes: Progress): Promise<ProfileProgress> {
    const { doc } = await updateJson<StoredDoc, void>(
      this.kv,
      this.key(profileId),
      () => ({ v: 1, updatedAt: '', progress: {} }),
      (doc) => {
        for (const [deck, items] of Object.entries(changes) as [DeckName, Record<string, number>][]) {
          const target = (doc.progress[deck] ??= {});
          for (const [itemKey, pts] of Object.entries(items)) {
            target[itemKey] = Math.max(MIN_PTS, Math.min(MAX_PTS, pts));
          }
        }
        doc.updatedAt = new Date().toISOString();
      },
    );
    return { profileId, updatedAt: doc.updatedAt, progress: doc.progress };
  }
}
