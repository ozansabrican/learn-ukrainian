import { DECKS, type DeckName, type Item } from './decks.js';
import type { KeyedItem } from './routes/decks.js';
import { updateJson, type KV } from './store/kv.js';

/**
 * Words added through /admin. Stored as one JSON document
 * (words/custom.json) next to the built-in lists from index.html;
 * the app appends them to its lists on start.
 */

export interface FieldDef {
  name: string;
  label: string;
  required: boolean;
  options?: string[];
  placeholder?: string;
  /** Value stored when the field is left empty */
  emptyValue?: string;
  /** If set, a non-empty value must have exactly this many space-separated words */
  words?: number;
  hint?: string;
}

export interface DeckInfo {
  label: string;
  /** false = shown in /admin but nothing can be added (the alphabet is complete) */
  addable: boolean;
  fields: FieldDef[];
}

export const DECK_INFO: Record<DeckName, DeckInfo> = {
  letters: {
    label: 'Letters',
    addable: false,
    fields: [
      { name: 'show', label: 'Letter', required: true },
      { name: 'pron', label: 'Sound', required: true },
      { name: 'desc', label: 'Description', required: true },
      { name: 'ex', label: 'Example', required: true },
      { name: 'exEng', label: 'Example (English)', required: true },
    ],
  },
  vocab: {
    label: 'UA verbs & sentences',
    addable: true,
    fields: [
      { name: 'ukr', label: 'Ukrainian', required: true, placeholder: 'читати' },
      { name: 'eng', label: 'English', required: true, placeholder: 'to read' },
      { name: 'pron', label: 'Pronunciation', required: false, placeholder: 'chy-TA-ty', emptyValue: '' },
      { name: 'type', label: 'Type', required: true, options: ['verb', 'phrase'] },
    ],
  },
  nouns: {
    label: 'UA nouns & questions',
    addable: true,
    fields: [
      { name: 'ukr', label: 'Ukrainian', required: true, placeholder: 'книга' },
      { name: 'eng', label: 'English', required: true, placeholder: 'book' },
      { name: 'pron', label: 'Pronunciation', required: false, placeholder: 'KNY-ha', emptyValue: '' },
      { name: 'type', label: 'Type', required: true, options: ['noun', 'question'] },
    ],
  },
  de_verbs: {
    label: 'DE verbs',
    addable: true,
    fields: [
      { name: 'de', label: 'German', required: true, placeholder: 'lesen' },
      { name: 'eng', label: 'English', required: true, placeholder: 'to read' },
    ],
  },
  de_nouns: {
    label: 'DE nouns',
    addable: true,
    fields: [
      { name: 'art', label: 'Article', required: true, options: ['der', 'die', 'das'] },
      { name: 'de', label: 'German', required: true, placeholder: 'Buch' },
      { name: 'pl', label: 'Plural', required: false, placeholder: 'Bücher (empty = no plural)', emptyValue: '—' },
      { name: 'eng', label: 'English', required: true, placeholder: 'book' },
    ],
  },
  conj: {
    label: 'UA conjugation',
    addable: true,
    fields: [
      { name: 'inf', label: 'Infinitive', required: true, placeholder: 'читати' },
      { name: 'eng', label: 'English', required: true, placeholder: 'to read' },
      {
        name: 'pres', label: 'Present (я ти він ми ви вони)', required: false, words: 6, emptyValue: '',
        placeholder: 'читаю читаєш читає читаємо читаєте читають',
        hint: '6 forms separated by spaces; leave empty for perfective verbs (past only)',
      },
      {
        name: 'past', label: 'Past (m f n pl)', required: true, words: 4,
        placeholder: 'читав читала читало читали', hint: '4 forms separated by spaces',
      },
    ],
  },
  tr_verbs: {
    label: 'TR verbs',
    addable: true,
    fields: [
      { name: 'tr', label: 'Turkish', required: true, placeholder: 'okumak' },
      { name: 'eng', label: 'English', required: true, placeholder: 'to read' },
    ],
  },
  tr_nouns: {
    label: 'TR nouns',
    addable: true,
    fields: [
      { name: 'tr', label: 'Turkish', required: true, placeholder: 'kitap' },
      { name: 'eng', label: 'English', required: true, placeholder: 'book' },
    ],
  },
  tr_conj: {
    label: 'TR conjugation',
    addable: true,
    fields: [
      { name: 'inf', label: 'Infinitive', required: true, placeholder: 'okumak' },
      { name: 'eng', label: 'English', required: true, placeholder: 'to read' },
      {
        name: 'pres', label: 'Present simple (ben sen o biz siz onlar)', required: true, words: 6,
        placeholder: 'okurum okursun okur okuruz okursunuz okurlar', hint: '6 forms separated by spaces (geniş zaman)',
      },
    ],
  },
};

const MAX_LEN = 200;

export class WordError extends Error {
  constructor(
    message: string,
    public statusCode: number,
  ) {
    super(message);
  }
}

/** Checks and normalises an item for `deck`; throws WordError(400) if invalid. */
export function validateItem(deck: DeckName, body: unknown): Item {
  const info = DECK_INFO[deck];
  if (!info.addable) throw new WordError(`Words can't be added to "${deck}"`, 400);
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new WordError('Expected an object', 400);
  const input = body as Record<string, unknown>;
  const allowed = new Set(info.fields.map((f) => f.name));
  for (const k of Object.keys(input)) {
    if (!allowed.has(k)) throw new WordError(`Unknown field "${k}"`, 400);
  }
  const item: Item = {};
  for (const f of info.fields) {
    const raw = input[f.name];
    if (raw !== undefined && typeof raw !== 'string') throw new WordError(`${f.label} must be text`, 400);
    const value = (raw ?? '').trim().replace(/\s+/g, ' ');
    if (!value) {
      if (f.required) throw new WordError(`${f.label} is required`, 400);
      item[f.name] = f.emptyValue ?? '';
      continue;
    }
    if (value.length > MAX_LEN) throw new WordError(`${f.label} is too long (max ${MAX_LEN})`, 400);
    if (/[<>]/.test(value)) throw new WordError(`${f.label} can't contain < or >`, 400);
    if (f.words && value.split(' ').length !== f.words) {
      throw new WordError(`${f.label}: needs exactly ${f.words} forms separated by spaces`, 400);
    }
    if (f.options && !f.options.includes(value)) {
      throw new WordError(`${f.label} must be one of: ${f.options.join(', ')}`, 400);
    }
    item[f.name] = value;
  }
  return item;
}

interface WordsDoc {
  v: 1;
  updatedAt: string | null;
  decks: Partial<Record<DeckName, Item[]>>;
}

export interface CustomWords {
  updatedAt: string | null;
  decks: Record<DeckName, KeyedItem[]>;
}

const DOC_KEY = 'words/custom.json';

export class CustomWordsStore {
  private builtinKeys: Record<DeckName, Set<string>>;

  constructor(
    private kv: KV,
    builtins: Record<DeckName, Item[]>,
  ) {
    this.builtinKeys = Object.fromEntries(
      (Object.keys(DECKS) as DeckName[]).map((d) => [d, new Set(builtins[d].map((i) => DECKS[d].key(i)))]),
    ) as Record<DeckName, Set<string>>;
  }

  private static withKeys(doc: WordsDoc): CustomWords {
    const decks = {} as Record<DeckName, KeyedItem[]>;
    for (const d of Object.keys(DECKS) as DeckName[]) {
      decks[d] = (doc.decks[d] ?? []).map((item) => ({ key: DECKS[d].key(item), ...item }));
    }
    return { updatedAt: doc.updatedAt, decks };
  }

  async list(): Promise<CustomWords> {
    const cur = await this.kv.read(DOC_KEY);
    return CustomWordsStore.withKeys(cur ? (JSON.parse(cur.data) as WordsDoc) : empty());
  }

  private ensureFree(deck: DeckName, key: string, list: Item[], except?: string) {
    if (this.builtinKeys[deck].has(key)) throw new WordError(`"${key}" is already in the built-in list`, 409);
    if (list.some((i) => DECKS[deck].key(i) === key && key !== except)) {
      throw new WordError(`"${key}" has already been added`, 409);
    }
  }

  async add(deck: DeckName, body: unknown): Promise<KeyedItem> {
    const item = validateItem(deck, body);
    const key = DECKS[deck].key(item);
    await updateJson<WordsDoc, void>(this.kv, DOC_KEY, empty, (doc) => {
      const list = (doc.decks[deck] ??= []);
      this.ensureFree(deck, key, list);
      list.push(item);
      doc.updatedAt = new Date().toISOString();
    });
    return { key, ...item };
  }

  async update(deck: DeckName, key: string, body: unknown): Promise<KeyedItem> {
    const item = validateItem(deck, body);
    const newKey = DECKS[deck].key(item);
    await updateJson<WordsDoc, void>(this.kv, DOC_KEY, empty, (doc) => {
      const list = (doc.decks[deck] ??= []);
      const idx = list.findIndex((i) => DECKS[deck].key(i) === key);
      if (idx === -1) throw new WordError(`"${key}" not found among added words`, 404);
      if (newKey !== key) this.ensureFree(deck, newKey, list, key);
      list[idx] = item;
      doc.updatedAt = new Date().toISOString();
    });
    return { key: newKey, ...item };
  }

  async remove(deck: DeckName, key: string): Promise<void> {
    await updateJson<WordsDoc, void>(this.kv, DOC_KEY, empty, (doc) => {
      const list = doc.decks[deck] ?? [];
      const idx = list.findIndex((i) => DECKS[deck].key(i) === key);
      if (idx === -1) throw new WordError(`"${key}" not found among added words`, 404);
      list.splice(idx, 1);
      doc.updatedAt = new Date().toISOString();
    });
  }
}

function empty(): WordsDoc {
  return { v: 1, updatedAt: null, decks: {} };
}
