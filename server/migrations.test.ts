/**
 * A migration runs once, in list order, with a record of when; a failing one
 * leaves neither its changes nor a record, and stops the boot.
 */

import { test, expect } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";

process.env.CHINA_DB_PATH ??= join(mkdtempSync(join(tmpdir(), "china-migrations-")), "test.db");
process.env.CHINA_SEED = "off";
const { db, runMigrations, appliedMigrations, MIGRATIONS } = await import("./db.ts");

const scratch = () => new Database(":memory:");

test("each migration runs once, in order, and is recorded", () => {
  const database = scratch();
  const order: string[] = [];
  const list = [
    { name: "first", run: (handle: Database) => { order.push("first"); handle.exec("CREATE TABLE a (x INTEGER)"); } },
    { name: "second", run: (handle: Database) => { order.push("second"); handle.exec("INSERT INTO a VALUES (1)"); } },
  ];
  expect(runMigrations(database, list)).toEqual(["first", "second"]);
  expect(runMigrations(database, list)).toEqual([]);
  expect(order).toEqual(["first", "second"]);
  expect(database.query<{ name: string }, []>("SELECT name FROM schema_migrations ORDER BY name").all().map((row) => row.name)).toEqual(["first", "second"]);
});

test("a failing migration leaves no change and no record, and throws", () => {
  const database = scratch();
  database.exec("CREATE TABLE b (x INTEGER)");
  const list = [{ name: "half", run: (handle: Database) => { handle.exec("INSERT INTO b VALUES (1)"); throw new Error("broke midway"); } }];
  expect(() => runMigrations(database, list)).toThrow("broke midway");
  expect(database.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM b").get()?.n).toBe(0);
  expect(database.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM schema_migrations").get()?.n).toBe(0);
});

test("the store opens with every shipped migration recorded, and names are unique", () => {
  db();
  const names = MIGRATIONS.map((migration) => migration.name);
  expect(new Set(names).size).toBe(names.length);
  const recorded = appliedMigrations().map((row) => row.name);
  for (const name of names) expect(recorded).toContain(name);
});
