/**
 * Loaded before every `bun test` run (bunfig.toml). The tests build scratch
 * stores and catalog copies under the temp directory, a few hundred megabytes
 * a run, and left them behind: a day of runs filled a disk. Every scratch
 * directory this run created is removed when the process exits.
 */

import { readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const startedAt = Date.now() - 5_000;

process.on("exit", () => {
  let base = "";
  try { base = tmpdir(); } catch { return; }
  for (const name of readdirSync(base)) {
    if (!name.startsWith("china-")) continue;
    const path = join(base, name);
    try {
      if (statSync(path).mtimeMs < startedAt) continue;
      rmSync(path, { recursive: true, force: true });
    } catch {
      // A directory another process still holds is left for the next run.
    }
  }
});
