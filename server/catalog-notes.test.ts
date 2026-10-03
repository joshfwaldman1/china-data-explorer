import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TEST_CATALOG } from "./test-server";
import { auditCatalogNotes } from "./catalog-notes-audit";
import type { NbsCatalogEntry } from "./nbs-catalog";

test("every joined catalogue API result carries source notes after cold and cached loads", async () => {
  const scratch = await mkdtemp(join(tmpdir(), "china-note-roundtrip-"));
  const base = TEST_CATALOG.entries[0]!;
  const entries = [
    { ...base, key: "nbs_notes_old", id: "notes_old", categories: ["价格", "Table (-2023)"], note: "旧定义", annotation: "旧口径", tableNotes: [{ id: "root", name: "Dataset", text: "Root scope" }] },
    { ...base, key: "nbs_notes_new", id: "notes_new", categories: ["价格", "Table (2024-)"], note: "", annotation: "" },
  ];
  try {
    await Bun.write(join(scratch, "catalog.json"), JSON.stringify({ ...TEST_CATALOG, entries }));
    const env = { ...process.env, CHINA_DB_PATH: join(scratch, "store.db"), CHINA_CATALOG_DB_PATH: join(scratch, "catalog.db"), NBS_CATALOG_PATH: join(scratch, "catalog.json"), CHINA_SEED: "off", NBS_QUERY_EXPANSION: "off" };
    const script = `
      globalThis.fetch=async()=>{throw new Error("No publisher requests in this test")};
      const {listNbsCatalogEntries,getNbsCatalogSeries}=await import(${JSON.stringify(new URL("./nbs-catalog.ts", import.meta.url).pathname)});
      const {writeSeries}=await import(${JSON.stringify(new URL("./db.ts", import.meta.url).pathname)});
      const entries=await listNbsCatalogEntries();
      for(const entry of entries)writeSeries({key:entry.key,title:entry.name,agency:"NBS",sourceUrl:"fixture",frequency:"Monthly",unit:"Index",series:[{label:"全国",points:[{date:entry.key.endsWith("old")?"2023-12":"2024-01",value:100}]}]},"000000000000","2026-10-03T00:00:00Z");
      const result=await getNbsCatalogSeries({entry:entries.find(entry=>entry.key==="nbs_notes_new"),storeOnly:true});
      console.log(JSON.stringify({entries,result}));
    `;
    const run = async () => {
      const child = Bun.spawn([process.execPath, "-e", script], { env, stdout: "pipe", stderr: "pipe" });
      const [out, errors, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
      expect(code, errors).toBe(0);
      return JSON.parse(out.trim().split("\n").at(-1)!);
    };
    const cold = await run(), cached = await run();
    expect(cold.result.metadata.sourceNotes.map((note: { text: string }) => note.text)).toEqual(["旧定义", "旧口径", "Root scope"]);
    expect(cold.result.metadata.sourceNotes[0].sources[0].key).toBe("nbs_notes_old");
    expect(cold.result.series[0].points).toHaveLength(2);
    expect(cached.result.metadata.sourceNotes).toEqual(cold.result.metadata.sourceNotes);
    const audit = auditCatalogNotes(entries as NbsCatalogEntry[], cached.entries);
    expect(audit.failures).toEqual([]);
    expect(audit.series).toBe(1);
    expect(audit.recoveredSeries).toBe(1);
    const corrupted = cached.entries.map((entry: NbsCatalogEntry) => ({ ...entry, note: "", tableNotes: [] }));
    expect(auditCatalogNotes(entries as NbsCatalogEntry[], corrupted).failures.length).toBeGreaterThan(0);
  } finally { await rm(scratch, { recursive: true, force: true }); }
}, 30_000);
