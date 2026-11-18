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
import { CustomWordsStore } from '../src/words.js';

const htmlPath = resolve(import.meta.dirname, '../../index.html');
const decks = withKeys(readDecksFromHtml(htmlPath));

describe('source extraction', () => {
  test('reads every deck from index.html, with keys', () => {
    for (const name of DECK_NAMES) assert.ok(decks[name].length > 0, `${name} is empty`);
    assert.equal(decks.letters[0]?.key, 'А а');
    assert.equal(decks.de_nouns[0]?.key, 'der Mann');
    assert.equal(decks.conj.length, 61);
    assert.equal(decks.conj[0]?.key, 'мати');
    assert.equal(decks.tr_verbs[0]?.key, 'olmak');
    assert.equal(decks.tr_nouns.length, 123);
    assert.equal(decks.tr_conj.length, decks.tr_verbs.length);
  });

  test('handles brackets inside strings and comments', () => {
    const src = `var X = [ /* ] */ { a: 'x]y', b: "[" }, // ]\n { a: \`]\` } ]; var Y = 1;`;
    assert.deepEqual(extractArray(src, 'X'), [{ a: 'x]y', b: '[' }, { a: ']' }]);
  });
});

describe('API', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  before(async () => {
    const kv = new MemoryKV();
    app = await buildApp({
      store: new ProgressStore(kv),
      words: new CustomWordsStore(kv, decks),
      decks,
      adminPassword: 'secret-pw',
      adminHtml: '<!DOCTYPE html><title>admin</title>',
      indexHtml: '<!DOCTYPE html><title>t</title>',
    });
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

describe('custom words + admin', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  const auth = { authorization: 'Bearer secret-pw' };

  before(async () => {
    const kv = new MemoryKV();
    app = await buildApp({
      store: new ProgressStore(kv),
      words: new CustomWordsStore(kv, decks),
      decks,
      adminPassword: 'secret-pw',
      adminHtml: '<!DOCTYPE html><title>admin</title>',
    });
  });
  after(() => app.close());

  test('admin page and schema are public', async () => {
    assert.equal((await app.inject('/admin')).statusCode, 200);
    const schema = (await app.inject('/api/words/schema')).json();
    assert.equal(schema.letters.addable, false);
    assert.equal(schema.vocab.addable, true);
  });

  test('admin routes need the password', async () => {
    assert.equal((await app.inject('/api/admin/check')).statusCode, 401);
    assert.equal((await app.inject({ url: '/api/admin/check', headers: { authorization: 'Bearer nope' } })).statusCode, 401);
    assert.equal((await app.inject({ url: '/api/admin/check', headers: auth })).statusCode, 200);
    const res = await app.inject({ method: 'POST', url: '/api/admin/words/vocab', payload: { ukr: 'x', eng: 'y', type: 'verb' } });
    assert.equal(res.statusCode, 401);
  });

  test('add, list, edit, delete', async () => {
    const add = await app.inject({
      method: 'POST', url: '/api/admin/words/vocab', headers: auth,
      payload: { ukr: '  вишивати ', eng: 'to embroider', type: 'verb' },
    });
    assert.equal(add.statusCode, 201, add.body);
    assert.deepEqual(add.json(), { key: 'вишивати', ukr: 'вишивати', eng: 'to embroider', pron: '', type: 'verb' });

    const gn = await app.inject({
      method: 'POST', url: '/api/admin/words/de_nouns', headers: auth,
      payload: { art: 'das', de: 'Lenkrad', eng: 'steering wheel' },
    });
    assert.equal(gn.json().pl, '—', 'empty plural becomes —');
    assert.equal(gn.json().key, 'das Lenkrad');

    const custom = (await app.inject('/api/words/custom')).json();
    assert.equal(custom.decks.vocab.length, 1);
    assert.equal(custom.decks.de_nouns.length, 1);

    const items = (await app.inject('/api/decks/vocab/items')).json() as { key: string; custom: boolean }[];
    assert.equal(items.at(-1)?.key, 'вишивати');
    assert.equal(items.at(-1)?.custom, true);
    assert.equal(items[0]?.custom, false);
    const deckList = (await app.inject('/api/decks')).json() as { name: string; custom: number }[];
    assert.equal(deckList.find((d) => d.name === 'vocab')?.custom, 1);

    const edit = await app.inject({
      method: 'PUT', url: `/api/admin/words/vocab/${encodeURIComponent('вишивати')}`, headers: auth,
      payload: { ukr: 'вишити', eng: 'to embroider (pf.)', pron: 'VY-shy-ty', type: 'verb' },
    });
    assert.equal(edit.statusCode, 200, edit.body);
    assert.equal(edit.json().key, 'вишити');

    const del = await app.inject({ method: 'DELETE', url: `/api/admin/words/vocab/${encodeURIComponent('вишити')}`, headers: auth });
    assert.equal(del.statusCode, 204);
    assert.equal((await app.inject('/api/words/custom')).json().decks.vocab.length, 0);
  });

  test('rejects duplicates, bad fields and non-addable decks', async () => {
    const post = (deck: string, payload: object) =>
      app.inject({ method: 'POST', url: `/api/admin/words/${deck}`, headers: auth, payload });
    assert.equal((await post('vocab', { ukr: 'мати', eng: 'to have', type: 'verb' })).statusCode, 409, 'built-in word');
    assert.equal((await post('de_verbs', { de: 'gehen2', eng: 'x' })).statusCode, 201);
    assert.equal((await post('de_verbs', { de: 'gehen2', eng: 'y' })).statusCode, 409, 'already added');
    assert.equal((await post('vocab', { ukr: 'a', eng: 'b', type: 'adjective' })).statusCode, 400);
    assert.equal((await post('vocab', { ukr: 'a', type: 'verb' })).statusCode, 400, 'missing English');
    assert.equal((await post('vocab', { ukr: '<b>a</b>', eng: 'b', type: 'verb' })).statusCode, 400);
    assert.equal((await post('vocab', { ukr: 'a', eng: 'b', type: 'verb', extra: 1 })).statusCode, 400);
    assert.equal((await post('letters', { show: 'Ы ы', pron: 'y', desc: 'd', ex: 'e', exEng: 'e' })).statusCode, 400);
    assert.equal((await post('klingon', { a: 1 })).statusCode, 404);
    const missing = await app.inject({ method: 'DELETE', url: '/api/admin/words/vocab/nothing', headers: auth });
    assert.equal(missing.statusCode, 404);
  });

  test('conjugation: validates the number of forms', async () => {
    const post = (payload: object) =>
      app.inject({ method: 'POST', url: '/api/admin/words/conj', headers: auth, payload });
    const ok = await post({ inf: 'вишивати', eng: 'to embroider', pres: 'вишиваю вишиваєш вишиває вишиваємо вишиваєте вишивають', past: 'вишивав вишивала вишивало вишивали' });
    assert.equal(ok.statusCode, 201, ok.body);
    assert.equal((await post({ inf: 'вишити', eng: 'to embroider (pf.)', past: 'вишив вишила вишило вишили' })).statusCode, 201, 'past only');
    assert.equal((await post({ inf: 'x1', eng: 'x', pres: 'a b c', past: 'a b c d' })).statusCode, 400, '3 present forms');
    assert.equal((await post({ inf: 'x2', eng: 'x', past: 'a b c' })).statusCode, 400, '3 past forms');
    assert.equal((await post({ inf: 'читати', eng: 'x', past: 'a b c d' })).statusCode, 409, 'built-in verb');
  });

  test('turkish decks: add words and conjugations', async () => {
    const post = (deck: string, payload: object) =>
      app.inject({ method: 'POST', url: `/api/admin/words/${deck}`, headers: auth, payload });
    assert.equal((await post('tr_nouns', { tr: 'masa', eng: 'table' })).statusCode, 409, 'built-in noun');
    assert.equal((await post('tr_nouns', { tr: 'pencere kenarı', eng: 'window sill' })).statusCode, 201);
    assert.equal((await post('tr_verbs', { tr: 'uçmak', eng: 'to fly' })).statusCode, 201);
    const withEx = await post('tr_nouns', { tr: 'balkon', eng: 'balcony', ex: 'Balkonda çay içeriz.', exEng: 'We drink tea on the balcony.' });
    assert.equal(withEx.statusCode, 201, withEx.body);
    assert.equal(withEx.json().ex, 'Balkonda çay içeriz.');
    assert.equal(decks.tr_nouns.find((n) => n.key === 'kitap')?.ex, 'Her akşam bir kitap okurum.');
    assert.deepEqual((decks.tr_nouns.find((n) => n.key === 'kitap') as { ext?: { past: string[] } }).ext?.past, ['Dün akşam bir kitap ⟦okudum⟧.', 'I read a book yesterday evening.']);
    assert.equal((await post('tr_conj', { inf: 'uçmak', eng: 'to fly', pres: 'uçarım uçarsın uçar uçarız uçarsınız uçarlar' })).statusCode, 201);
    assert.equal((await post('tr_conj', { inf: 'x', eng: 'x', pres: 'a b c' })).statusCode, 400, 'needs 6 forms');
  });

  test('admin disabled without a password', async () => {
    const kv = new MemoryKV();
    const noAdmin = await buildApp({ store: new ProgressStore(kv), words: new CustomWordsStore(kv, decks), decks });
    assert.equal((await noAdmin.inject({ url: '/api/admin/check', headers: auth })).statusCode, 503);
    await noAdmin.close();
  });
});
