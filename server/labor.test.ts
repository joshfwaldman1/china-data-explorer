/**
 * The labor keys point at the NBS tables they claim: each id resolves in the
 * shipped snapshot to the named migrant-worker series in the quarterly
 * dataset's 人民生活 category, from the one table both share.
 */

import { test, expect } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.CHINA_DB_PATH ??= join(mkdtempSync(join(tmpdir(), "china-labor-")), "test.db");
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

const EXPECTED: Record<string, { name: string; label: string }> = {
  migrant_workers: { name: "农村外出务工劳动力 (万人)", label: "Away from home, quarter end (10,000 persons)" },
  migrant_workers_income: { name: "外出务工农村劳动力月均收入 (元)", label: "Average monthly income (yuan)" },
};

/** Multi-line keys: every id resolves to the named series in the dataset and category claimed. */
const LINES: Record<string, { dataset: number; category: string; lines: Record<string, string> }> = {
  unemployment: { dataset: 1, category: "城镇调查失业率", lines: {
    "Surveyed urban (%)": "全国城镇调查失业率 (%)", "Youth 16-24, ex-students (%)": "全国城镇16—24岁劳动力失业率(%)",
    "31 major cities (%)": "31个大城市城镇调查失业率 (%)", "Local hukou (%)": "全国城镇本地户籍劳动力失业率 (%)", "Non-local hukou (%)": "全国城镇外来户籍劳动力失业率 (%)",
  } },
  working_hours: { dataset: 1, category: "城镇调查失业率", lines: { "Enterprise employees (hours per week)": "企业就业人员周平均工作时间 (小时)" } },
  employment: { dataset: 3, category: "就业人员和工资", lines: { "Total, year end (10,000 persons)": "就业人员 (万人)", "Urban (10,000 persons)": "城镇就业人员 (万人)", "Rural (10,000 persons)": "乡村就业人员 (万人)" } },
  population_nbs: { dataset: 3, category: "人口", lines: { "Total, year end (10,000 persons)": "年末总人口 (万人)", "Urban (10,000 persons)": "城镇人口 (万人)", "Rural (10,000 persons)": "乡村人口 (万人)" } },
  population_rates: { dataset: 3, category: "人口", lines: { "Birth rate (‰)": "人口出生率 (‰)", "Death rate (‰)": "人口死亡率 (‰)", "Natural growth rate (‰)": "人口自然增长率 (‰)" } },
  population_age: { dataset: 3, category: "人口", lines: { "Aged 65 and over (10,000 persons)": "65岁及以上人口 (万人)", "Aged 15 to 64 (10,000 persons)": "15-64岁人口 (万人)", "Aged 0 to 14 (10,000 persons)": "0-14岁人口 (万人)" } },
};

test("the labor and population keys' lines resolve to the named NBS series, one table per key", () => {
  for (const [key, expected] of Object.entries(LINES)) {
    const cfg: unknown = CATALOG[key];
    expect(cfg).toBeDefined();
    const ids = Reflect.get(cfg as object, "ids") as { id: string; label: string }[];
    const cid = Reflect.get(cfg as object, "cid");
    for (const [label, name] of Object.entries(expected.lines)) {
      const line = ids.find((item) => item.label === label);
      expect(line).toBeDefined();
      const entry = byId.get(line!.id);
      expect(entry?.name.replace(/\s+/g, " ").trim()).toBe(name);
      expect(entry?.datasetCode).toBe(expected.dataset);
      expect(entry?.cid).toBe(cid);
      expect(entry?.categories?.[0]).toBe(expected.category);
    }
  }
});

test("each labor key resolves to the named quarterly series from the migrant-worker table", () => {
  for (const [key, expected] of Object.entries(EXPECTED)) {
    const cfg: unknown = CATALOG[key];
    expect(cfg).toBeDefined();
    const ids = Reflect.get(cfg as object, "ids") as { id: string; label: string }[];
    expect(ids.length).toBe(1);
    const entry = byId.get(ids[0]!.id);
    expect(entry?.name).toBe(expected.name);
    expect(ids[0]!.label).toBe(expected.label);
    expect(entry?.datasetCode).toBe(2);
    expect(entry?.cid).toBe(Reflect.get(cfg as object, "cid"));
    expect(entry?.categories?.[0]).toBe("人民生活");
    expect(Reflect.get(cfg as object, "frequency")).toBe("Quarterly");
    expect(Reflect.get(cfg as object, "group")).toBe("Labor");
  }
  // Both lines come from one table, so the catalog serves them by one request each.
  expect(Reflect.get(CATALOG.migrant_workers as object, "cid")).toBe(Reflect.get(CATALOG.migrant_workers_income as object, "cid"));
});
