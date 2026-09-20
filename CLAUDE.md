# Working in this repository

The China Data Explorer: a FRED-style web app for Chinese official
statistics. Read `README.md` first; it says what is here and how to run it.

## Stack

Bun (server, bundler, test runner), React 19, Recharts, SQLite through
`bun:sqlite`. No other runtime dependency but `@anthropic-ai/sdk` (search
query expansion) and `pinyin-pro` (romanisation for search). Use `bun`, not
node or npm: `bun run dev`, `bun test`, `bun install`.

## Gates before any commit

```sh
bun run typecheck    # must report nothing
bun test             # must be green (287 tests; the render test needs Chrome)
```

And the store must be clean: no test rows in `china.db`. A test that touches
the store sets `CHINA_DB_PATH` to a scratch path *before* importing anything
from `server/db.ts` or `server/data.ts`, because `bun test` shares one
process.

## Ground rules

- Work on `main`. Never force-push, never rewrite history. A person
  contributing opens a pull request and needs a green CI check; the dataset
  loop commits to `main` directly, because it runs the same gates locally
  and verifies the live site afterwards. `CONTRIBUTING.md` is the short
  version for a collaborator, and `OPERATIONS.md` says how a change reaches
  production — which today is a manual `railway up`, not a push.
- Never commit `china.db`, `catalog.db` or anything under `catalog/*.partial`.
  `seed/china.db` is committed on purpose; refresh it only deliberately, and
  never from production data.
- No new dependencies without a reason written into the commit message. The
  parsers are dependency-free on purpose: `server/xlsx.ts` and
  `server/xls.ts` read both Excel formats themselves.
- Don't raise the request concurrency against a government portal. One
  request at a time, with the pauses already in the adapters.
- Attribute a figure to the publishing agency, never to a mirror. Say "year
  to date" when a series is cumulative. Never derive a January figure NBS
  did not publish.
- A Home row is named for exactly what it shows (`HOME_ROWS` in
  `server/data.ts`).

## Adding a series

The recipe is in `README.md` ("Adding a headline series") and the agent
version is `DATASET_LOOP.md`. In short: a `CATALOG` entry, a captured
fixture with a test that parses it to known figures, a concordance pair or a
written reason in `NO_PAIR`, a Home row if it belongs there, the gates, then
deploy and log the round in `IMPROVEMENT_LOG.md`.

## Style

Verbose, explicit names; comments that say why, not what. Tests read like
statements about the data ("the annual sheet's months sum to its years").
No emoji in code.
