/**
 * The catalog cache key depends on what the files contain, not when they were
 * copied.
 *
 * The key used to be each file's modification time. Every Docker build gives
 * the copied catalog files a fresh mtime whenever their layer is rebuilt —
 * nearly every code change, since `COPY catalog` follows `COPY server` — so
 * the key changed on nearly every deploy while the bytes did not. The cache
 * on the volume was thrown away and the catalog rebuilt from scratch, 178 and
 * 189 seconds against a 180-second healthcheck, and three deploys failed in
 * one day. This is the test that pins the key to the bytes.
 */

import { test, expect } from "bun:test";
import { mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.CHINA_DB_PATH ??= join(mkdtempSync(join(tmpdir(), "china-version-")), "test.db");
process.env.CHINA_SEED = "off";
const { contentVersionOf } = await import("./nbs-catalog.ts");

const scratch = () => mkdtempSync(join(tmpdir(), "china-version-files-"));

test("the same bytes give the same version whatever the modification time says", async () => {
  const dir = scratch();
  const a = join(dir, "a.json"), b = join(dir, "b.json");
  writeFileSync(a, '{"entries":[1,2,3]}');
  writeFileSync(b, '{"gloss":true}');
  const first = await contentVersionOf([a, b], "3");
  // A copy into a fresh image: same content, a different mtime by hours.
  const later = new Date(Date.now() + 3 * 60 * 60 * 1000);
  utimesSync(a, later, later);
  utimesSync(b, later, later);
  expect(await contentVersionOf([a, b], "3")).toBe(first);
});

test("different bytes give a different version, and so does a different gloss format", async () => {
  const dir = scratch();
  const a = join(dir, "a.json");
  writeFileSync(a, '{"entries":[1,2,3]}');
  const before = await contentVersionOf([a], "3");
  // The sync scripts replace a file at runtime; the change must be noticed.
  writeFileSync(a, '{"entries":[1,2,3,4]}');
  expect(await contentVersionOf([a], "3")).not.toBe(before);
  // And a change in how glosses are shaped must rebuild stored glosses.
  writeFileSync(a, '{"entries":[1,2,3]}');
  expect(await contentVersionOf([a], "4")).not.toBe(before);
  expect(await contentVersionOf([a], "3")).toBe(before);
});

test("a missing file is part of the version rather than an error", async () => {
  const dir = scratch();
  const present = join(dir, "present.json");
  writeFileSync(present, "{}");
  const version = await contentVersionOf([present, join(dir, "absent.json")], "3");
  expect(version).toContain("|-|");
  expect(version.endsWith("gloss-format:3")).toBe(true);
});

test("the version is a fixed-width hash per file, not a timestamp", async () => {
  const dir = scratch();
  const a = join(dir, "a.json");
  writeFileSync(a, "x".repeat(10_000));
  const [part] = (await contentVersionOf([a], "3")).split("|");
  expect(part).toMatch(/^[0-9a-f]{24}$/);
  // A timestamp would carry a decimal point; a hash never does.
  expect(part).not.toContain(".");
});
