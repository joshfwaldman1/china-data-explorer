/**
 * The methodology document: every curated series resolves to a section that
 * says who compiled the figure, how it reached the site, and how it is
 * checked. The point of the test is that the document cannot go stale: it is
 * built from the catalog and the audit, so a series added without a path or
 * without a check fails here rather than appearing with an empty section.
 */

import { test, expect } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.CHINA_DB_PATH ??= join(mkdtempSync(join(tmpdir(), "china-methodology-")), "test.db");
process.env.CHINA_SEED = "off";
const { CATALOG, catalogList } = await import("./data.ts");
const { methodology, methodologyFor, SOURCE_METHODOLOGY, SITE_METHODOLOGY } = await import("./methodology.ts");
const { CONCORDANCE_PAIRS, NO_PAIR } = await import("./concordance.ts");

const document = methodology(catalogList());

test("every curated key resolves to a methodology section", () => {
  const keys = Object.keys(CATALOG);
  expect(document.keys.length).toBe(keys.length);
  for (const key of keys) {
    const item = methodologyFor(key);
    expect(item, key).toBeDefined();
    expect(item?.agency.length, key).toBeGreaterThan(2);
    // The path it came by is a section that exists and says something.
    const section = SOURCE_METHODOLOGY[item?.source ?? ""];
    expect(section, `${key} (${item?.source})`).toBeDefined();
    expect(section?.reads.length, key).toBeGreaterThan(40);
  }
});

test("every section describes a path some series actually takes", () => {
  for (const section of document.sources) {
    expect(section.keys.length, section.id).toBeGreaterThan(0);
    // A publisher can be named in three words; a description of the path cannot.
    expect(section.publisher.length, `${section.id}.publisher`).toBeGreaterThan(10);
    for (const field of ["title", "reads", "how", "revisions"] as const) {
      expect(section[field].length, `${section.id}.${field}`).toBeGreaterThan(20);
    }
  }
  // Each key appears in exactly one section, so no series is described twice or not at all.
  const placed = document.sources.flatMap((section) => section.keys);
  expect(new Set(placed).size).toBe(placed.length);
  expect(placed.length).toBe(document.keys.length);
});

test("how a figure is checked is read from the audit, not restated", () => {
  for (const item of document.keys) {
    if (item.check.kind !== "pair") continue;
    for (const name of item.check.names) {
      expect(CONCORDANCE_PAIRS.some((pair) => pair.name === name), `${item.key}: ${name}`).toBe(true);
    }
  }
  // A domestic series with no pair carries the reason recorded in NO_PAIR, word for word.
  for (const item of document.keys) {
    if (item.check.kind !== "none") continue;
    expect(item.check.reason, item.key).toBe(NO_PAIR[item.key] ?? "No reason recorded.");
    expect(item.check.reason, item.key).not.toBe("No reason recorded.");
  }
});

test("a cumulative series says so, and a series whose publisher stopped says when", () => {
  const cumulative = document.keys.find((item) => item.key === "fiscal_revenue");
  expect(cumulative?.caveats.some((line) => line.startsWith("Cumulative from the start of the year"))).toBe(true);
  const ended = document.keys.filter((item) => item.caveats.some((line) => line.startsWith("The publisher stopped this series after")));
  expect(ended.length).toBeGreaterThan(0);
  for (const item of ended) expect(Reflect.get(CATALOG[item.key] as object, "ended")).toBeTypeOf("string");
});

test("a mirrored series says it passed through a mirror", () => {
  const mirrored = document.keys.filter((item) => item.source === "eastmoney");
  expect(mirrored.length).toBeGreaterThan(0);
  for (const item of mirrored) {
    expect(item.caveats, item.key).toContain("Reaches the site through a mirror rather than the publisher's own page.");
    // And the figure is still attributed to the agency that compiled it.
    expect(item.agency, item.key).not.toContain("Eastmoney");
  }
});

test("the site states what it does with a figure, including the append-only store", () => {
  expect(SITE_METHODOLOGY.storage).toContain("append-only");
  expect(SITE_METHODOLOGY.attribution).toContain("never to a mirror");
  for (const text of Object.values(SITE_METHODOLOGY)) expect(text.length).toBeGreaterThan(60);
});
