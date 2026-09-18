/**
 * The household keys point at the NBS quarterly survey tables they claim:
 * each line's id resolves in the shipped snapshot to the named series in the
 * quarterly dataset's 人民生活 category, from the table the line names (the
 * national one, or the urban or rural table beside it).
 */

import { test, expect } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.CHINA_DB_PATH ??= join(mkdtempSync(join(tmpdir(), "china-household-")), "test.db");
process.env.CHINA_SEED = "off";
const { CATALOG } = await import("./data.ts");
const { readCatalogSnapshot } = await import("./catalog-file.ts");

interface Entry { id: string; name: string; cid: string; datasetCode: number; categories?: string[] }
function isEntry(value: unknown): value is Entry {
  return typeof value === "object" && value !== null && typeof Reflect.get(value, "id") === "string" && typeof Reflect.get(value, "name") === "string";
}
const snapshot: unknown = await readCatalogSnapshot();
const list = typeof snapshot === "object" && snapshot !== null ? Reflect.get(snapshot, "entries") : undefined;
const byId = new Map((Array.isArray(list) ? list : []).filter(isEntry).map((entry) => [entry.id, entry]));

const EXPECTED: Record<string, Record<string, string>> = {
  household_income_growth: { "All residents, year to date (YoY %)": "居民人均可支配收入累计增长 (%)", "Urban, year to date (YoY %)": "城镇居民人均可支配收入累计增长 (%)", "Rural, year to date (YoY %)": "农村居民人均可支配收入累计增长 (%)" },
  household_income: { "All residents, year to date (yuan)": "居民人均可支配收入累计值 (元)", "Urban, year to date (yuan)": "城镇居民人均可支配收入累计值 (元)", "Rural, year to date (yuan)": "农村居民人均可支配收入累计值 (元)" },
  household_spending_growth: { "All residents, year to date (YoY %)": "居民人均消费支出累计增长 (%)", "Urban, year to date (YoY %)": "城镇居民人均消费支出累计增长 (%)", "Rural, year to date (YoY %)": "农村居民人均消费支出累计增长 (%)" },
  household_spending: { "All residents, year to date (yuan)": "居民人均消费支出累计值 (元)", "Urban, year to date (yuan)": "城镇居民人均消费支出累计值 (元)", "Rural, year to date (yuan)": "农村居民人均消费支出累计值 (元)" },
};

test("every household line resolves to the named quarterly series from the table it names", () => {
  for (const [key, lines] of Object.entries(EXPECTED)) {
    const cfg: unknown = CATALOG[key];
    expect(cfg).toBeDefined();
    const ids = Reflect.get(cfg as object, "ids") as { id: string; label: string; cid?: string }[];
    const ownCid = Reflect.get(cfg as object, "cid");
    expect(ids.length).toBe(3);
    for (const [label, name] of Object.entries(lines)) {
      const line = ids.find((item) => item.label === label);
      expect(line).toBeDefined();
      const entry = byId.get(line!.id);
      expect(entry?.name.replace(/\s+/g, " ").trim()).toBe(name);
      expect(entry?.datasetCode).toBe(2);
      expect(entry?.categories?.[0]).toBe("人民生活");
      expect(entry?.cid).toBe(line!.cid ?? ownCid);
    }
    // The national line is the key's own table; urban and rural name theirs.
    expect(ids[0]!.cid).toBeUndefined();
    expect(ids[1]!.cid).toBeDefined();
    expect(Reflect.get(cfg as object, "unit")).toContain("year to date");
  }
});
