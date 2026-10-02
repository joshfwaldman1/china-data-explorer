/**
 * A revision is one place's figure for one period, restated. Asked without a
 * place, a series published for many partners used to come back with every
 * partner's figure read as a vintage of the same period.
 */

import { test, expect } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.CHINA_DB_PATH ??= join(mkdtempSync(join(tmpdir(), "china-revisions-")), "test.db");
process.env.CHINA_SEED = "off";
const { writeSeries, readRevisionHistory } = await import("./db.ts");

const result = (value: number) => ({
  key: "revisions_place_test", title: "Exports by partner", agency: "General Administration of Customs",
  sourceUrl: "http://www.customs.gov.cn/", frequency: "Monthly", unit: "USD million",
  series: [{ label: "Exports", points: [{ date: "2025-02", value }] }],
});

writeSeries(result(100), "united-states", "2026-09-01T00:00:00.000Z");
writeSeries(result(101), "united-states", "2026-09-02T00:00:00.000Z");
writeSeries(result(50), "japan", "2026-09-01T00:00:00.000Z");
writeSeries(result(52), "japan", "2026-09-02T00:00:00.000Z");
writeSeries(result(7), "korea", "2026-09-01T00:00:00.000Z");
writeSeries(result(7), "korea", "2026-09-02T00:00:00.000Z"); // unchanged: no revision

test("without a place, each place's revisions stay its own, and a place with none is absent", () => {
  const history = readRevisionHistory("revisions_place_test");
  expect(history).toEqual([
    { region: "japan", label: "Exports", period: "2025-02", vintages: [
      { value: 50, fetchedAt: "2026-09-01T00:00:00.000Z" }, { value: 52, fetchedAt: "2026-09-02T00:00:00.000Z" },
    ] },
    { region: "united-states", label: "Exports", period: "2025-02", vintages: [
      { value: 100, fetchedAt: "2026-09-01T00:00:00.000Z" }, { value: 101, fetchedAt: "2026-09-02T00:00:00.000Z" },
    ] },
  ]);
});

test("with a place, only that place", () => {
  expect(readRevisionHistory("revisions_place_test", "korea")).toEqual([]);
  expect(readRevisionHistory("revisions_place_test", "japan").map((entry) => entry.vintages.map((vintage) => vintage.value))).toEqual([[50, 52]]);
  expect(readRevisionHistory("revisions_place_test", "united-states")).toHaveLength(1);
});
