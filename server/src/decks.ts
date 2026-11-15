/**
 * The decks the app teaches. Each maps to an array literal in index.html
 * (`source`), to the field the frontend uses in localStorage (`storageField`),
 * and to a stable key per item so progress survives reordering of the lists.
 */
export type Item = Record<string, unknown>;

export interface DeckDef {
  source: string;
  storageField: string;
  key: (item: Item) => string;
}

export const DECKS = {
  letters: { source: 'LETTERS', storageField: 'lp', key: (i) => String(i.show) },
  vocab: { source: 'VOCAB', storageField: 'vc', key: (i) => String(i.ukr) },
  nouns: { source: 'NOUNS', storageField: 'np', key: (i) => String(i.ukr) },
  de_verbs: { source: 'DE_VERBS', storageField: 'gv', key: (i) => String(i.de) },
  de_nouns: { source: 'DE_NOUNS', storageField: 'gn', key: (i) => `${String(i.art)} ${String(i.de)}` },
  conj: { source: 'CONJ', storageField: 'cj', key: (i) => String(i.inf) },
} satisfies Record<string, DeckDef>;

export type DeckName = keyof typeof DECKS;

export const DECK_NAMES = Object.keys(DECKS) as DeckName[];

export function isDeck(name: string): name is DeckName {
  return Object.hasOwn(DECKS, name);
}

/** Same scoring bounds as the frontend (MAX_PTS in index.html). */
export const MIN_PTS = 0;
export const MAX_PTS = 10;
