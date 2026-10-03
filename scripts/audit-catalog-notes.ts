/** Audit every available NBS note through a fresh build and a second process's cache read. */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { readCatalogSnapshot } from "../server/catalog-file";
import { auditCatalogNotes } from "../server/catalog-notes-audit";

const cacheOnly = process.argv.includes("--cache-only");
const scratch = cacheOnly ? undefined : await mkdtemp(join(tmpdir(), "china-catalogue-notes-"));
if (scratch) {
  process.env.CHINA_DB_PATH = join(scratch, "observations.db");
  process.env.CHINA_CATALOG_DB_PATH = join(scratch, "catalogue.db");
}
process.env.CHINA_SEED = "off";
process.env.NBS_QUERY_EXPANSION = "off";
try {
  const { listNbsCatalogEntries } = await import("../server/nbs-catalog");
  const raw = await readCatalogSnapshot() as { generatedAt: string; entries: import("../server/nbs-catalog").NbsCatalogEntry[] };
  const audit = auditCatalogNotes(raw.entries, await listNbsCatalogEntries());
  if (audit.failures.length) throw new Error(JSON.stringify(audit.failures));
  if (cacheOnly) {
    console.log(JSON.stringify(audit));
  } else {
    const child = Bun.spawn([process.execPath, import.meta.path, "--cache-only"], { env: process.env, stdout: "pipe", stderr: "pipe" });
    const [output, errors, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    if (exitCode) throw new Error(`Cached catalogue audit failed: ${errors}`);
    const cached = JSON.parse(output);
    if (cached.notesDigest !== audit.notesDigest || cached.loadedEntries !== audit.loadedEntries) throw new Error("Notes changed after catalogue cache revival");
    const report = { generatedAt: new Date().toISOString(), catalogueSnapshotAt: raw.generatedAt, scope: "All shipped catalogue entries and their joined series; no live recrawl or new observations", ...audit, cacheRoundTrip: "passed" };
    const out = process.argv.find(arg => arg.startsWith("--out="))?.slice(6);
    if (out) await Bun.write(resolve(out), JSON.stringify(report, null, 2) + "\n");
    console.log(JSON.stringify(report, null, 2));
  }
} finally {
  if (scratch) await rm(scratch, { recursive: true, force: true });
}
