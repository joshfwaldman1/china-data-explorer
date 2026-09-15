# One round of the dataset loop

You are running one round of a standing loop that works through
`china-explorer/COVERAGE_PLAN.md`: adding the sources and series that give a
cohesive picture of the Chinese economy. The owner wants steady, tested,
verifiable progress, one item per round. Read this whole file, then the queue
in `DATASET_QUEUE.md`, before doing anything.

## Ground rules

- Work on `main` (`china-data-explorer` is pushed in step with it). Never
  force-push, never rewrite history. Never run `bun run china:seed`, never
  commit `china.db`, `catalog.db` or anything under `catalog/*.partial`.
- One queue item per round, the highest one you can finish. If an item turns
  out to need a decision from the owner (a paid source, a key, a merge), record
  what it needs in the queue and take the next item instead.
- **Every item ships with a test that would have caught it being wrong**: a
  fixture-parsed table for a new source, a value cross-checked against the
  publisher's own figure for a new series, a behaviour test for scheduling.
  A round without a test is not finished.
- Measure before optimising, and say what was measured. Attribute series to
  the publisher (Customs, PBOC, MOF, NEA, SAFE), never to a mirror. Cumulative
  year-to-date stays labelled as such. A proxy is labelled a proxy. No January
  is derived. No unchanged value is stored as a revision.
- Do not add dependencies. Do not touch `Dockerfile.china`,
  `railway.china.toml` or `.github/workflows`. Do not raise request
  concurrency against any government portal; pace as the existing adapters do.
- The Anthropic API account may be out of credit: the gloss translation and
  search expansion degrade gracefully. Do not spend rounds on translation until
  the queue says credit is restored.

## The round

1. `git pull --ff-only origin main`. Read `DATASET_QUEUE.md` and the last
   entries of `IMPROVEMENT_LOG.md`.
2. Pick the top item whose prerequisites are met. Re-read its acceptance test
   before writing code; it is the definition of done.
3. For a new source, probe first with one or two requests and keep the answer
   as a fixture under `server/fixtures/<source>/`. If the site answers a
   foreign address with a challenge or 4xx, say so in the queue and move on.
4. Build it the way the existing adapters are built: `server/customs.ts` is
   the model for a release-table source, `server/data.ts` for a curated key,
   `server/release-plan.ts` and `server/due.ts` for scheduling.
5. Gates, from the repo root, each read in full rather than piped into grep:
   `bunx tsc --noEmit -p tsconfig.json` must show no `china-explorer` errors
   (33 pre-existing errors elsewhere are known); `bun test` must pass; the
   item's own acceptance test must pass.
6. Commit with a message that says what was missing and what now answers it,
   in the voice of `git log`. Push to `main` and to `china-data-explorer`.
   Deploy with `railway up --detach` from the repo root (a push does not
   deploy). Wait for the build, then verify live: `/health`, the new series
   through `/api/series/<key>`, and `/api/schedule` if scheduling changed.
   Health alone is not verification.
7. Append a dated entry to the Log in `IMPROVEMENT_LOG.md`: what was missing,
   what was built, the test, the live value seen. Move the item in
   `DATASET_QUEUE.md` from Queue to Done with the date, add anything the round
   surfaced, commit and push that too.
8. Finish with a five-line summary: what shipped, the test, the live value,
   what is queued next, anything the owner must decide.

## Things that look wrong but are not

- UN Comtrade's monthly data for China ends in December 2024. Do not build on
  it for current trade.
- Customs' Chinese site and its statistics portal answer HTTP 412 to foreign
  addresses; the English site carries the same tables and answers.
- The CFETS yield endpoint answers JSON to POST and a challenge page to GET.
- `RPT_ECONOMY_FDI` on Eastmoney stops at July 2023; the ministry ended the
  monthly USD release. Not a bug to fix.
- Caixin PMI ended September 2025 and carries an `ended` flag on purpose.
