import type { FastifyInstance } from 'fastify';
import { DECK_NAMES, DECKS, isDeck, type DeckName, type Item } from '../decks.js';
import type { CustomWordsStore } from '../words.js';

export type KeyedItem = Item & { key: string };

/**
 * Built-in word lists (generated from index.html by `npm run gen`) plus the
 * words added in /admin, which are flagged `custom: true`.
 */
export function deckRoutes(
  app: FastifyInstance,
  decks: Record<DeckName, KeyedItem[]>,
  words: CustomWordsStore,
): void {
  app.get('/api/decks', async () => {
    const custom = await words.list();
    return DECK_NAMES.map((name) => ({
      name,
      storageField: DECKS[name].storageField,
      builtin: decks[name].length,
      custom: custom.decks[name].length,
      count: decks[name].length + custom.decks[name].length,
    }));
  });

  app.get<{ Params: { deck: string } }>('/api/decks/:deck/items', async (req, reply) => {
    const { deck } = req.params;
    if (!isDeck(deck)) return reply.code(404).send({ error: `Unknown deck "${deck}"` });
    const custom = await words.list();
    return [
      ...decks[deck].map((i) => ({ ...i, custom: false })),
      ...custom.decks[deck].map((i) => ({ ...i, custom: true })),
    ];
  });
}
