/**
 * Removing the scratch stores the test suite leaves behind.
 *
 * A run builds a store and a catalog cache under the temp directory, a few
 * hundred megabytes of it, because the catalog alone is about 350 MB. The
 * suite deleted what it had made when the process exited, which is right up
 * until a run does not exit: an interrupted run, a killed one, a crash. Those
 * leavings had no owner and nothing ever swept them, so they accumulated one
 * abandoned run at a time until the disk filled. That stopped work twice in
 * one day, which is twice more than a temp directory should.
 *
 * So there are two sweeps rather than one. A run clears what it made when it
 * exits, as before. And a run clears anything abandoned long enough to be
 * nobody's, at startup — the part that happens whether or not the previous
 * run got to finish.
 */

import { readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * How old a scratch directory must be before another run may delete it.
 *
 * A finished run clears its own, so this only ever catches a run that was
 * killed. Two hours is well beyond any run — half a minute locally, capped at
 * twenty in CI — while still reclaiming the same day rather than the next one,
 * which matters when a single abandoned run is 700 MB. The margin is what
 * keeps a sweep from deleting a store out from under a concurrent run.
 */
export const ABANDONED_AFTER_MS = 2 * 60 * 60 * 1000;

/**
 * Delete directories under `base` whose name starts with `prefix` and whose
 * last-modified time `shouldRemove` accepts. Returns the paths removed, so a
 * caller can say what it reclaimed instead of deleting silently.
 *
 * A directory another process holds is skipped rather than retried: the next
 * run will see it again, and by then it is either gone or genuinely abandoned.
 */
export function sweepScratch(base: string, prefix: string, shouldRemove: (mtimeMs: number) => boolean): string[] {
  const removed: string[] = [];
  let names: string[];
  try { names = readdirSync(base); } catch { return removed; }
  for (const name of names) {
    if (!name.startsWith(prefix)) continue;
    const path = join(base, name);
    try {
      // The directory's own mtime, not its contents': a run that is still
      // writing keeps touching it, so one in use reads as recent.
      if (!shouldRemove(statSync(path).mtimeMs)) continue;
      rmSync(path, { recursive: true, force: true });
      removed.push(path);
    } catch {
      // Held, or already gone. Either way the next run tries again.
    }
  }
  return removed;
}

/** Anything left by a run that never finished, old enough to be nobody's. */
export function sweepAbandoned(base: string, prefix: string, now = Date.now(), olderThanMs = ABANDONED_AFTER_MS): string[] {
  return sweepScratch(base, prefix, (mtimeMs) => mtimeMs < now - olderThanMs);
}

/** What this run made, however new: the tidy-up at the end of a run that does finish. */
export function sweepOwn(base: string, prefix: string, startedAtMs: number): string[] {
  return sweepScratch(base, prefix, (mtimeMs) => mtimeMs >= startedAtMs);
}
