/**
 * The Home payload carries what the Home page draws, and nothing else.
 *
 * A Home row shows one line of a table: the one its `line` names, or the
 * table's first. The payload used to carry every line of every table on the
 * page, so the manufacturing PMI's fourteen sub-indices and the twelve retail
 * categories travelled on every visit whether or not a row named them — 250
 * lines to draw 59 sparklines, which at six years a line is half a megabyte
 * of JSON for a page of headline figures.
 *
 * This is the test that would notice it coming back: every line the payload
 * carries is one a Home row names, and every line a Home row names is in the
 * payload. It runs against `HOME_ROWS` itself rather than a fixture, so a row
 * added in a later round is covered without touching this file.
 */

import { test, expect } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.CHINA_DB_PATH ??= join(mkdtempSync(join(tmpdir(), "china-home-")), "test.db");
process.env.CHINA_SEED = "off";
const { CATALOG, HERO_KEYS, catalogList, configuredLabels } = await import("./data.ts");

interface HomeRow { rank: number; title?: string; line?: string; group?: string }
const entries = catalogList();
const onHome = entries.filter((entry) => (entry.homeRows ?? []).length > 0 || HERO_KEYS.includes(entry.key));

/** The same rule the server applies, stated here so the test fails if they drift apart. */
function wantedLines(key: string, rows: HomeRow[], labels: string[]): string[] {
  const named = new Set(rows.map((row) => row.line).filter((line): line is string => typeof line === "string"));
  const needsFirst = rows.length === 0 || rows.some((row) => !row.line) || HERO_KEYS.includes(key);
  return labels.filter((label, index) => (needsFirst && index === 0) || named.has(label));
}

test("every line a Home row names exists on the series it names it from", () => {
  for (const entry of onHome) {
    const labels = configuredLabels(entry.key);
    if (!labels) continue;
    for (const row of entry.homeRows ?? []) {
      if (!row.line) continue;
      // A row naming a line that the table does not have is an empty row on the
      // live page, and nothing else would catch it.
      expect(labels, `${entry.key}: "${row.line}"`).toContain(row.line);
    }
  }
});

test("the payload's rule keeps one line per row, and the first line where a row names none", () => {
  for (const entry of onHome) {
    const labels = configuredLabels(entry.key);
    if (!labels || labels.length === 0) continue;
    const rows = (entry.homeRows ?? []) as HomeRow[];
    const kept = wantedLines(entry.key, rows, labels);
    expect(kept.length, entry.key).toBeGreaterThan(0);
    // Never more lines than the page can draw from this key.
    const drawable = new Set(rows.map((row) => row.line ?? labels[0]));
    if (HERO_KEYS.includes(entry.key)) drawable.add(labels[0]!);
    expect(kept.length, entry.key).toBeLessThanOrEqual(drawable.size);
    // The client reads series[0] for any row that names no line, so it must survive.
    if (rows.length === 0 || rows.some((row) => !row.line) || HERO_KEYS.includes(entry.key)) {
      expect(kept[0], entry.key).toBe(labels[0]);
    }
  }
});

test("trimming the payload to the drawn lines is most of it", () => {
  let all = 0, kept = 0;
  for (const entry of onHome) {
    const labels = configuredLabels(entry.key);
    if (!labels) continue;
    all += labels.length;
    kept += wantedLines(entry.key, (entry.homeRows ?? []) as HomeRow[], labels).length;
  }
  // The tables on Home carry far more lines than the page draws; if that stops
  // being true the trimming has quietly stopped working.
  expect(all).toBeGreaterThan(kept * 1.5);
  expect(kept).toBeGreaterThan(30);
});

test("a table whose lines each get a row keeps every one of them", () => {
  // The unemployment table is the case that would break a naive "first line only":
  // two Home rows name two different lines, and neither is the first.
  const entry = entries.find((item) => item.key === "unemployment");
  const labels = configuredLabels("unemployment") ?? [];
  const rows = (entry?.homeRows ?? []) as HomeRow[];
  expect(rows.length).toBeGreaterThanOrEqual(2);
  const kept = wantedLines("unemployment", rows, labels);
  for (const row of rows) if (row.line) expect(kept).toContain(row.line);
  // It is a hero key, so the headline line rides along with the two named ones.
  expect(kept[0]).toBe(labels[0]);
});

test("every Home key is a curated key that exists", () => {
  for (const entry of onHome) expect(CATALOG[entry.key], entry.key).toBeDefined();
  for (const key of HERO_KEYS) expect(CATALOG[key], key).toBeDefined();
});
