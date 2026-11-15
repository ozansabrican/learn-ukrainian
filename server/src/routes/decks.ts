import type { FastifyInstance } from 'fastify';
import { DECK_NAMES, DECKS, isDeck, type DeckName, type Item } from '../decks.js';

export type KeyedItem = Item & { key: string };

/** Word lists are fixed data, generated from index.html by `npm run gen`. */
export function deckRoutes(app: FastifyInstance, decks: Record<DeckName, KeyedItem[]>): void {
  app.get('/api/decks', async () =>
    DECK_NAMES.map((name) => ({
      name,
      storageField: DECKS[name].storageField,
      count: decks[name].length,
    })),
  );

  app.get<{ Params: { deck: string } }>('/api/decks/:deck/items', async (req, reply) => {
    const { deck } = req.params;
    if (!isDeck(deck)) return reply.code(404).send({ error: `Unknown deck "${deck}"` });
    return decks[deck];
  });
}
