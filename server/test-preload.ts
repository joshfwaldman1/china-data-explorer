/**
 * Loaded before every `bun test` run (bunfig.toml). The tests build scratch
 * stores and catalog copies under the temp directory, a few hundred megabytes
 * a run. Two sweeps keep that from accumulating: anything abandoned by a run
 * that never finished goes at startup, and what this run makes goes when it
 * exits. See `test-scratch.ts` for why the first of those exists.
 */

import { afterAll } from "bun:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { sweepAbandoned, sweepOwn } from "./test-scratch.ts";

const PREFIX = "china-";
const startedAt = Date.now() - 5_000;

// Before anything else: reclaim what previous runs could not. An exit handler
// does not run when a process is killed, so without this a cancelled run's
// store stays until a disk fills — which is how it has gone twice.
const base = (() => { try { return tmpdir(); } catch { return ""; } })();
if (base) {
  const reclaimed = sweepAbandoned(base, PREFIX);
  if (reclaimed.length > 0) console.log(`  Reclaimed ${reclaimed.length} abandoned test scratch ${reclaimed.length === 1 ? "directory" : "directories"}`);
}

// A test that forgets to name its own store writes to the repository's, and the
// catalog cache it builds is 350 MB. Both default to this run's scratch directory
// instead; a test that sets its own path still wins, because it is imported after
// this and these are ??= assignments there too.
const scratch = mkdtempSync(join(tmpdir(), `${PREFIX}test-run-`));
process.env.CHINA_DB_PATH ??= join(scratch, "china.db");
process.env.CHINA_CATALOG_DB_PATH ??= join(scratch, "catalog.db");
process.env.CHINA_SEED ??= "off";

// `afterAll` in a preload runs after the whole suite; `process.on("exit")` does
// not run at all under the test runner, which is why the original tidy-up never
// fired and a day of runs could fill a disk while appearing to clean up after
// itself. Checked by running a one-test suite under a preload registering both.
afterAll(() => { if (base) sweepOwn(base, PREFIX, startedAt); });
