# learn-ukrainian server

Small API for the app in `../index.html`: serves the word lists and syncs
learning progress across devices. Node + TypeScript + Fastify, deployed on
**Vercel**, with progress stored in **Vercel Blob** (one private JSON file per
profile). Locally it stores the same JSON files in `data/`, so you don't need
Vercel to develop.

## Local development

Requires Node 20.12+ (22 or 24 recommended).

```sh
cd server
npm install
npm run dev        # http://127.0.0.1:3000 — app at /, API at /api/*
```

`npm run dev` first runs `npm run gen`, which extracts the word lists from
`../index.html`. Edits to `index.html` show up on reload; re-run `gen` (or
restart dev) if you change the word lists themselves.

| Script              | What it does                                              |
| ------------------- | --------------------------------------------------------- |
| `npm run dev`       | Start with auto-reload, progress in `data/profiles/*.json` |
| `npm test`          | API + storage tests (incl. concurrent writes)             |
| `npm run typecheck` | Type-check                                                |
| `npm run gen`       | Regenerate `src/generated/` (word lists + bundled page)   |

## Deploy to Vercel (one-time setup)

1. **Push** the repo to GitHub (`git push`).
2. **Import** it at <https://vercel.com/new>.
   - **Root Directory: `server`** (Edit → choose the `server` folder). Vercel
     detects Fastify automatically (entry: `src/index.ts`); leave build
     settings at their defaults.
   - Keep "Include files outside the root directory in the Build Step"
     enabled (the default) — the build reads `../index.html`.
3. **Create the Blob store**: in the project → *Storage* → *Create* → *Blob*,
   choose **Private**, and connect it to the project (all environments).
4. **Redeploy** (Deployments → ⋯ → Redeploy) so the function picks up the store.
5. Open `https://<project>.vercel.app`, tap the profile button, enter your
   name. On the iPhone: open the same URL → Share → *Add to Home Screen*.

From then on every `git push` to `main` deploys automatically; pushes to other
branches get preview URLs.

**Using the real Blob store locally** (optional): `npx vercel link`, then
`npx vercel env pull .env`, and set `STORAGE=blob` and `BLOB_PREFIX=dev/` in
`.env` so local testing doesn't touch your real profiles.

## How it works

- **Vercel**: `src/index.ts` runs as one Vercel Function. Vercel finds it
  because it imports `fastify` — don't add a `src/app.ts`, Vercel would pick
  that file instead. The build (`vercel-build` → `gen`) bundles the word lists
  and a copy of `index.html` into the function, which serves the app at `/`.
- **TypeScript**: Vercel compiles with the project's TypeScript 7, so
  `tsconfig.json` deliberately has no `"types"` entry (it breaks that build).
  To reproduce a Vercel build locally: `npx vercel build`.
- **Storage**: `profiles/<name>.json` in a private Blob store, holding
  `{ deck: { itemKey: points } }`. Writes are *read → merge → conditional
  write* (Blob's `ifMatch` ETag), retried on conflict, so two devices saving at
  the same moment never overwrite each other. Reads bypass the CDN cache
  (`useCache: false`) so you always get the latest copy.
- **Item keys** are the word itself (`"А а"`, `"мати"`, `"der Mann"`), not its
  position, so adding or reordering words doesn't scramble progress.

## API

| Method  | Path                         | Description                                                 |
| ------- | ---------------------------- | ----------------------------------------------------------- |
| `GET`   | `/api/health`                | `{ ok: true }`                                              |
| `GET`   | `/api/decks`                 | Decks with item counts                                      |
| `GET`   | `/api/decks/:deck/items`     | Items of a deck, in order, each with its `key`              |
| `GET`   | `/api/profiles/:id/progress` | `{ profileId, updatedAt, progress }`, 404 if unused         |
| `PATCH` | `/api/profiles/:id/progress` | Merge `{ deck: { key: points } }`; creates the profile      |

Decks: `letters`, `vocab`, `nouns`, `de_verbs`, `de_nouns`. Points are clamped
to 0–10.

A profile id is a name you choose (3–40 chars, `a–z 0–9 - _`, lowercase).
There is no password: anyone who knows or guesses a name can read and change
that profile. Fine for personal use — pick a non-obvious name, and add real
accounts before opening it up to others.

## How the app syncs (SYNC section in `index.html`)

- localStorage stays the working copy, so the app works offline.
- After each answer it sends only the items that changed since the last
  successful sync (debounced), and flushes when the tab is hidden.
- On start it pushes unsent changes first, then loads the server copy.
- Switching to a name that already has data loads it; a brand-new name asks
  whether to copy this device's progress into it or start from zero.

## Layout

```
src/
  index.ts              entry point (Vercel + local): creates Fastify, listens
  create-app.ts         plugins + routes — used by index.ts and the tests
  config.ts             env vars / .env
  decks.ts              deck definitions and item key rules
  keyed.ts              adds keys to items
  source.ts             extracts the word arrays from index.html
  store/
    progress-store.ts   per-profile merge with retry
    kv.ts               storage interface + in-memory version (tests)
    blob-kv.ts          Vercel Blob
    file-kv.ts          local JSON files
  routes/               HTTP routes
  generated/            (git-ignored) word lists, from `npm run gen`
scripts/gen.ts          build step
test/                   node:test tests
```
