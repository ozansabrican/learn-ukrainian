import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { buildApp } from '../src/create-app.js';
import { DECK_NAMES } from '../src/decks.js';
import { withKeys } from '../src/keyed.js';
import { extractArray, readDecksFromHtml } from '../src/source.js';
import { FileKV } from '../src/store/file-kv.js';
import { MemoryKV, type KV } from '../src/store/kv.js';
import { ProgressStore } from '../src/store/progress-store.js';

const htmlPath = resolve(import.meta.dirname, '../../index.html');
const decks = withKeys(readDecksFromHtml(htmlPath));

describe('source extraction', () => {
  test('reads every deck from index.html, with keys', () => {
    for (const name of DECK_NAMES) assert.ok(decks[name].length > 0, `${name} is empty`);
    assert.equal(decks.letters[0]?.key, 'А а');
    assert.equal(decks.de_nouns[0]?.key, 'der Mann');
  });

  test('handles brackets inside strings and comments', () => {
    const src = `var X = [ /* ] */ { a: 'x]y', b: "[" }, // ]\n { a: \`]\` } ]; var Y = 1;`;
    assert.deepEqual(extractArray(src, 'X'), [{ a: 'x]y', b: '[' }, { a: ']' }]);
  });
});

describe('API', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  before(async () => {
    app = await buildApp({ store: new ProgressStore(new MemoryKV()), decks, indexHtml: '<!DOCTYPE html><title>t</title>' });
  });
  after(() => app.close());

  test('health', async () => {
    assert.equal((await app.inject('/api/health')).statusCode, 200);
  });

  test('serves the app at /', async () => {
    const res = await app.inject('/');
    assert.equal(res.statusCode, 200);
    assert.match(res.headers['content-type'] as string, /text\/html/);
  });

  test('lists decks with counts', async () => {
    const list = (await app.inject('/api/decks')).json() as { name: string; count: number }[];
    assert.deepEqual(list.map((d) => d.name), DECK_NAMES);
    assert.ok(list.every((d) => d.count > 0));
  });

  test('returns items of a deck, and 404 for unknown decks', async () => {
    const items = (await app.inject('/api/decks/letters/items')).json() as { key: string }[];
    assert.equal(items[0]?.key, 'А а');
    assert.equal((await app.inject('/api/decks/nope/items')).statusCode, 404);
  });

  test('profile progress: created on first write, merge, clamp, read back', async () => {
    const url = '/api/profiles/ozan/progress';
    assert.equal((await app.inject(url)).statusCode, 404);

    const first = await app.inject({ method: 'PATCH', url, payload: { letters: { 'А а': 4, 'Б б': 99 } } });
    assert.equal(first.statusCode, 200);
    assert.equal(first.json().profileId, 'ozan');

    const res = await app.inject({ method: 'PATCH', url, payload: { letters: { 'А а': -3 }, vocab: { мати: 6 } } });
    assert.deepEqual(res.json().progress, { letters: { 'А а': 0, 'Б б': 10 }, vocab: { мати: 6 } });
    assert.deepEqual((await app.inject(url)).json().progress, res.json().progress);
  });

  test('rejects bad input', async () => {
    const url = '/api/profiles/someone/progress';
    assert.equal((await app.inject({ method: 'PATCH', url, payload: { bogus: {} } })).statusCode, 400);
    assert.equal((await app.inject({ method: 'PATCH', url, payload: { letters: { x: 'a' } } })).statusCode, 400);
    for (const bad of ['ab', 'Ozan', 'has space', '-dash', 'x'.repeat(41)]) {
      const res = await app.inject(`/api/profiles/${encodeURIComponent(bad)}/progress`);
      assert.equal(res.statusCode, 400, `"${bad}" should be rejected`);
    }
    assert.equal((await app.inject(url)).statusCode, 404, 'a rejected write must not create the profile');
  });
});

/** Two devices writing at the same moment must not lose each other's changes. */
function concurrencyTest(name: string, makeKV: () => KV) {
  test(`${name}: concurrent merges keep every change`, async () => {
    const store = new ProgressStore(makeKV());
    const keys = Array.from({ length: 25 }, (_, i) => `w${i}`);
    await Promise.all(keys.map((k, i) => store.merge('pair', { vocab: { [k]: (i % 10) + 1 } })));
    const got = await store.get('pair');
    assert.equal(Object.keys(got?.progress.vocab ?? {}).length, keys.length);
  });
}

describe('storage', () => {
  /** Like Blob: a slow read lets other writers sneak in between read and write. */
  class SlowKV extends MemoryKV {
    override async read(key: string) {
      const r = await super.read(key);
      await new Promise((res) => setTimeout(res, Math.random() * 5));
      return r;
    }
  }
  concurrencyTest('memory', () => new SlowKV());

  const dir = mkdtempSync(join(tmpdir(), 'lu-'));
  after(() => rmSync(dir, { recursive: true, force: true }));
  concurrencyTest('file', () => new FileKV(dir));

  test('file: survives a new store instance (persisted to disk)', async () => {
    await new ProgressStore(new FileKV(dir)).merge('disk', { letters: { 'А а': 3 } });
    const again = await new ProgressStore(new FileKV(dir)).get('disk');
    assert.deepEqual(again?.progress, { letters: { 'А а': 3 } });
  });
});
