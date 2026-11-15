import { DECKS, type DeckName, type Item } from './decks.js';
import type { KeyedItem } from './routes/decks.js';

/**
 * Adds each item's stable key (duplicates get a #2, #3… suffix). The same
 * rule is implemented in index.html (SYNC_DECKS), so keep the two in step.
 */
export function withKeys(decks: Record<DeckName, Item[]>): Record<DeckName, KeyedItem[]> {
  const out = {} as Record<DeckName, KeyedItem[]>;
  for (const deck of Object.keys(decks) as DeckName[]) {
    const seen = new Map<string, number>();
    out[deck] = decks[deck].map((item) => {
      const base = DECKS[deck].key(item);
      const n = (seen.get(base) ?? 0) + 1;
      seen.set(base, n);
      return { key: n > 1 ? `${base}#${n}` : base, ...item };
    });
  }
  return out;
}
