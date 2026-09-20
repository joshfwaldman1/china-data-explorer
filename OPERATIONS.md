# Operating the China Data Explorer

The production service uses one persistent SQLite store at `/data/china.db`.
Keep one application replica while writes and scheduling live in that process.
`/data/catalog.db` is a derived cache; the observation store and its revision
history are irreplaceable. A persistent volume alone is not a backup.

## Backups and recovery

Set the same randomly generated `BACKUP_TOKEN` in Railway's service variables
and this repository's GitHub Actions secrets. Deploy after changing the service
variable. Use the Authorization header; do not put credentials in shared URLs.

The `China store backup` workflow runs daily at 18:30 UTC. To exercise it now:

```sh
gh workflow run backup.yml --repo joshfwaldman1/china-data-explorer
gh run list --workflow backup.yml --repo joshfwaldman1/china-data-explorer
```

A successful run downloads a consistent SQLite snapshot, checks its SHA-256
against the server manifest, runs SQLite integrity and foreign-key checks, and
opens an independent restored copy in a fresh process. It records actual row
counts, latest period and last successful fetch. Only then does it upload the
database, `.manifest.json` and `.sha256` files as a 90-day artifact. Missing
credentials, missing manifests, empty stores, damaged downloads and failed
restores fail the job. Enable GitHub Actions failure notifications for the
operator account and investigate a missing daily success.

Snapshot creation and validation run in a separate Bun process so their SQLite
scans do not block the HTTP event loop. One snapshot or download may be active;
additional requests receive 429 with `Retry-After`. Creation is limited to ten
minutes and streaming to thirty minutes. Completion, cancellation and timeout
remove the temporary copy; startup removes abandoned private copies older than
24 hours. Allow free volume space for the snapshot and WAL growth during its
read transaction. These limits may need adjustment as the store grows.

To inspect a downloaded artifact from a successful run, install Bun, check out
this repository, and run (substitute the downloaded filename):

```sh
bun scripts/verify-backup.ts /path/to/china-YYYY-MM-DD.db /path/to/china-YYYY-MM-DD.db.manifest.json
```

This repeats checksum, integrity, row-count and independent restore checks
without importing the application, seeding, migrating or contacting publishers.
It updates the local verification timestamp. Keep the original artifact intact.

For an actual recovery:

1. Download and verify the chosen artifact on a separate machine. Check its
   snapshot time and counts against the desired recovery point.
2. Stop all processes writing the destination volume. Preserve the damaged
   database and its matching `-wal` and `-shm` files together in a separate
   recovery directory; never copy new data over an active SQLite connection.
3. Copy the verified standalone database to an empty destination as `china.db`,
   with the service's ownership and permissions. Do not carry old WAL/SHM files
   into that destination. Preserve the artifact and incident copy.
4. Start the service on that volume. It applies additive schema migrations and
   rebuilds the catalog cache if needed. Require `/ready` to return 200, then
   compare observation counts and sample series/revisions with the manifest.
5. Run and verify another backup after recovery. Record the artifact, incident,
   recovery point and measured time to restore.

With daily successful backups, potential data loss is approximately one day;
missed runs extend it. Restore time is not yet an operational guarantee. GitHub
artifact expiry is not a long-term archive: independent object storage, retention
controls and periodic recovery drills remain follow-up work.

## How a change reaches production

Read this before assuming a merge ships anything.

**Today (manual).** The Railway service `econstats-china` has no repository
attached. It builds only what `railway up --detach` uploads from a working
directory. A push to GitHub deploys nothing on its own, and an uncommitted
local edit would ship. Every deployment so far has been preceded by a commit
and a push in the same minute, but that is a habit, not a mechanism.

**The target (GitHub-triggered).** The service is attached to
`joshfwaldman1/china-data-explorer` on `main`, so a merge builds and deploys
using the `Dockerfile` that `railway.toml` already names, and CI's typecheck
and test run is the gate in front of it. Two steps, both of which need the
repository owner and neither of which can be done from a script:

1. Grant Railway's GitHub app access to `china-data-explorer`. Railway's app
   is installed with access to selected repositories only, and this one is
   not among them, so Railway cannot see it. In GitHub: Settings → 
   Applications → Railway → Configure → add the repository. Then attach it
   in the Railway service's Settings → Source.
2. Upgrade the GitHub account to Pro. Branch protection is unavailable on a
   private repository on the free plan, so required status checks and
   required reviews cannot be turned on until then.

**Once both are done**, `main` is protected as follows: a pull request with a
green CI check is required for collaborators, and administrators may still
push directly. That is deliberate. The dataset loop runs the same two gates
locally before every push and verifies the live site afterwards, so putting
it behind its own review would add a step without adding a check. Everyone
else goes through a pull request.

## Contributing

`CONTRIBUTING.md` is the short version for a collaborator: the two gates, what
must never be committed, and how a series is added.

## Readiness and deployment

`/live` reports that the HTTP process answers. `/ready` and legacy `/health`
return 503 until a usable, nonempty catalog and its search index load and SQLite
answers. A healthy empty observation store is allowed on a fresh installation.
Failed catalog warmup remains unavailable and logs its cause; time elapsed alone
never makes a deployment ready. Ready processes continue checking the store.

Before committing or deploying, run `bun run typecheck` and `bun test`. Browser
tests require Chrome, or Playwright Chromium with `PLAYWRIGHT_CHANNEL=chromium`.
Tests use scratch stores; never point them at production data.

Deploy from the repository root using `railway up --detach` while the service
has no repository attached; once it is attached, a push to `main` with a green
CI check deploys instead, and `railway up` stays available for a rollback or a
deploy from a working directory. Railway and Docker
allow 180 seconds for startup. Confirm deployment success and `/ready`, inspect
the startup log, then exercise the backup workflow. Do not treat a successful
upload or a process that answers `/live` as a completed deployment.

## Historical revision checks

`series_refresh_state` tracks full-history checks separately for each NBS
`(key, region)`. A successful nonempty full-window write advances the clock in
the same transaction as its observations. Recent-window, empty and failed
fetches do not postpone historical checks. Even an unchanged full read counts
as a successful audit. Due full audits take priority over missing-new-period
catch-up when the refresh planner chooses a window.

Existing rows have no trustworthy historical full-check timestamp. The
migration leaves that value unknown and schedules each first audit between
one and 45 days after migration using a stable hash. Restarts and recent
refreshes preserve that deadline. Later full checks are due every 45 days.
Due dates request work; source outages and available worker capacity can delay
completion. Requests remain paced, and failed release batches spend their
configured request budget just like successful ones.

## Remaining scaling work

This hardening pass does not make the service horizontally scalable. Next:

- Persist jobs, attempts, retry times and leases so restarts cannot lose work;
  separate scheduled ingestion from HTTP serving while preserving portal pacing.
- Archive original publisher responses with content hashes, parser versions and
  metadata versions, so a parsed observation can be reproduced and audited.
- Monitor source freshness, overdue full audits, queue age, backup age, disk/WAL
  growth and request latency. Define service and recovery objectives.
- Measure query load and index coverage. Choose a managed database migration
  when concurrent writers, additional replicas or recovery requirements justify
  it; moving SQLite rows alone will not repair scheduling or provenance.
