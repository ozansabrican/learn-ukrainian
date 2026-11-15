import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { DECKS, type DeckName, type Item } from './decks.js';

/**
 * Reads the word lists out of index.html, which is still the source of truth.
 * Each list is a `var NAME = [ ... ];` literal; we find it, cut out the array
 * literal by bracket matching (skipping strings and comments), and evaluate
 * just that literal in an empty sandbox.
 */
export function readDecksFromHtml(htmlPath: string): Record<DeckName, Item[]> {
  const html = readFileSync(htmlPath, 'utf8');
  const out = {} as Record<DeckName, Item[]>;
  for (const [deck, def] of Object.entries(DECKS) as [DeckName, (typeof DECKS)[DeckName]][]) {
    out[deck] = extractArray(html, def.source);
  }
  return out;
}

export function extractArray(src: string, varName: string): Item[] {
  const decl = new RegExp(`\\bvar\\s+${varName}\\s*=\\s*\\[`);
  const m = decl.exec(src);
  if (!m) throw new Error(`Could not find "var ${varName} = [" in source`);
  const start = m.index + m[0].length - 1; // position of "["
  const end = matchBracket(src, start);
  const literal = src.slice(start, end + 1);
  const value: unknown = runInNewContext(`(${literal})`, Object.create(null), { timeout: 1000 });
  if (!Array.isArray(value)) throw new Error(`${varName} is not an array`);
  // Round-trip through JSON so the objects belong to this realm, not the sandbox.
  return JSON.parse(JSON.stringify(value)) as Item[];
}

function matchBracket(src: string, open: number): number {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    const next = src[i + 1];
    if (c === "'" || c === '"' || c === '`') {
      i = skipString(src, i, c);
    } else if (c === '/' && next === '/') {
      i = src.indexOf('\n', i);
      if (i === -1) break;
    } else if (c === '/' && next === '*') {
      i = src.indexOf('*/', i + 2) + 1;
      if (i === 0) break;
    } else if (c === '[' || c === '{' || c === '(') {
      depth++;
    } else if (c === ']' || c === '}' || c === ')') {
      depth--;
      if (depth === 0) return i;
    }
  }
  throw new Error('Unbalanced brackets while extracting array');
}

function skipString(src: string, i: number, quote: string): number {
  for (let j = i + 1; j < src.length; j++) {
    if (src[j] === '\\') j++;
    else if (src[j] === quote) return j;
  }
  throw new Error('Unterminated string while extracting array');
}
