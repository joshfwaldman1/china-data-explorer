# Contributing

The China Data Explorer serves Chinese official statistics. The thing it is
trying to be is trustworthy, which shapes most of what follows: a figure has
to be traceable to the agency that compiled it, checkable against an
independent reading, and honest about what it is not.

Read `README.md` for what the project is and how to run it, and `CLAUDE.md`
for the working rules in full. This file is the short version.

## Getting set up

```sh
bun install
bun run dev       # the site, on http://localhost:3000
bun test          # the suite
bun run typecheck
```

Bun, not node or npm. The suite is network-free: every publisher is a
captured fixture, so the tests pass on a plane. The one exception is a
headless render test, which needs Chrome, or Playwright's Chromium with
`PLAYWRIGHT_CHANNEL=chromium`.

## How a change reaches production

Open a pull request against `main`. Continuous integration runs the same two
gates you ran locally, and the pull request needs a green check before it can
merge. A merge to `main` deploys.

Deploys are currently manual while the Railway service is being attached to
this repository; `OPERATIONS.md` has the current state and the two steps
still outstanding. Until that is done, a merge does **not** ship — ask the
owner to deploy.

## The two gates

```sh
bun run typecheck    # must report nothing
bun test             # must be green
```

Both must pass before a pull request is ready. If a test fails on timing
rather than on what it checks, say so in the pull request rather than
re-running until it passes; a test that fails on the clock gets a stated time
budget, not a retry.

## What must never be committed

- `china.db`, `catalog.db`, anything under `catalog/*.partial`. These are the
  store and a derived cache; they are large and they are not source.
  `seed/china.db` is committed on purpose and is refreshed only deliberately,
  never from production data.
- Credentials of any kind. The backup token lives in Railway's service
  variables and in this repository's Actions secrets, nowhere else.
- A new runtime dependency without a reason written into the commit message.
  The Excel parsers are dependency-free on purpose.

## Working with the publishers

- **One request at a time.** Do not raise the concurrency against a
  government portal, and keep the pauses the adapters already have. A
  statistics office is not a CDN.
- **Attribute to the publisher, never to a mirror.** A figure that reaches
  the site through a third party is still the bureau's figure, and the
  methodology page says which path it took.
- **Say "year to date" when a series is cumulative**, in the label, not only
  in a comment.
- **Never derive a figure the publisher did not publish.** The bureau
  releases January and February together for production series; the January
  figure stays missing rather than being inferred.

## Adding a series

The recipe is in `README.md`, and `DATASET_LOOP.md` is the longer version the
automated rounds follow. In short, a change that adds a series carries:

1. An entry in `CATALOG` (`server/data.ts`), named for exactly what it shows.
2. A test that would have caught it being wrong. A parser gets a captured
   fixture; a new series gets a value cross-checked against the publisher's
   own figure, ideally from the prose of the release itself.
3. Either a concordance pair in `server/concordance.ts` — the series against
   an independent reading of the same statistic — or an entry in `NO_PAIR`
   there saying why no independent reading exists. A coverage test holds
   every domestic-publisher key to one or the other, so this is not optional.
4. A Home row only if it belongs on the front page.

## Style

Verbose, explicit names. Comments that say why, not what. Tests that read
like statements about the data ("the annual sheet's months sum to its
years"). No emoji in code.

The commit message says what was missing and what now answers it. The
`IMPROVEMENT_LOG.md` entry says what was built, what the test is, and what
the live value was — including what did not work, because the next person
needs to know what has already been tried.
