# One round of the improvement loop

You are running one round of a standing improvement loop for the China Data
Explorer, live at https://econstats-china-production.up.railway.app. The
owner wants small, safe, verifiable improvements, one per round, forever,
until he stops the loop. Read this whole file before doing anything.

## Ground rules

- Work on the `china-data-explorer` branch only. Never merge to `main`,
  never force-push, never rewrite history.
- One improvement per round. Small beats ambitious. If a change would take
  more than about 150 lines, log it as a queue item instead and pick
  something smaller.
- Never run `bun run china:seed`, never commit `china.db`, `catalog.db` or
  anything under `china-explorer/catalog/*.partial`. The store lives on a
  Railway volume, not in git.
- Do not add dependencies, do not change `Dockerfile.china` or
  `railway.china.toml`, do not touch `.github/workflows`.
- Follow the repo's conventions: Bun, no `as` casts, no emojis in code,
  direct plain-English headings (measure, geography, period), no middle-dot
  separators, no em dashes in UI copy, English first with the Chinese
  alongside where both exist. See AGENTS.md and IMPROVEMENT_LOG.md.
- Be honest in the log: if a round found nothing to fix, say so and record
  what was checked.

## The round

1. `git pull --ff-only origin china-data-explorer`. Read
   `china-explorer/IMPROVEMENT_LOG.md`: the queue and the last rounds.
2. Pick the highest-value item you can finish in this round. If the queue
   has nothing suitable, audit one surface instead and fix what it shows.
   Audit surfaces, rotate through them in this order: search quality for ten
   plausible researcher queries (compare `/api/search?q=` results on the live
   site to what an economist would expect), a random sample of ten catalog
   series pages via `/api/series/<key>?limit=600` (units, English titles,
   ranges, stitching, notes), the home page and the four hero tiles, the
   Provinces page and `/api/regional/provincial_gdp`, the release calendar
   and `/api/schedule`, `/api/status` for failed fetches, the share image
   layout tests, mobile CSS at 390 px, dark mode tokens, keyboard and
   screen-reader labels, and the docs (README, AGENTS.md) against the code.
3. Reproduce the problem against the live site (curl the API) before
   changing code.
4. Make the change. Then, from the repo root:
   `bunx tsc --noEmit -p tsconfig.json | grep china-explorer` must print
   nothing, and `bun test` must pass. Add or extend a test when the change
   is logic. Gate the commit on that output rather than piping it into
   `grep` and carrying on: a chain that did not stop shipped a broken build
   once (round 31).
   Run `git pull` and `git push` under a hard cap (kill after 60 to 90
   seconds and retry): GitHub connections from this machine have hung for
   up to an hour, and a hung push blocks the deploy behind it.
5. Commit with a message that states the defect and the fix in plain words
   (see `git log` for the voice), and push to `china-data-explorer`.
   Pushing deploys the live site if the Railway service is linked to GitHub;
   if it is not, say so in the log so the owner can deploy.
6. Append a dated entry to the Log in `china-explorer/IMPROVEMENT_LOG.md`
   (what was wrong, what changed, how it was verified), remove the item from
   the queue if it was one, add anything the round surfaced to the queue,
   and commit and push that too.
7. Finish with a five-line summary: what changed, how it was verified,
   what is queued next.

## Things that look like bugs but are not

- Caixin PMI series end in September 2025: Caixin stopped sponsoring the
  survey. They carry an `ended` flag on purpose.
- The Real Estate Climate Index stops at December 2025 in the mirror we use.
  It shows an amber "latest available" notice on purpose.
- Some NBS catalog entries return no data: they are discontinued indicators
  NBS still lists. The crawl records them as empty and retries monthly.
- `/health` is deliberately trivial; do not add store scans to it.
