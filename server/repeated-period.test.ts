/**
 * A table whose newest year copies the year before, line for line, is flagged;
 * one line holding still, or a table updated normally, is not.
 */
import { test, expect } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.CHINA_DB_PATH ??= join(tmpdir(), `repeated-period-${process.pid}.db`);
const { repeatedTablePeriod } = await import("./nbs-catalog.ts");

/** Two annual points per line, as the 2023-present registration-status tables hold them. */
const line = (y2023: number, y2024: number) => [{ date: "2023", value: y2023 }, { date: "2024", value: y2024 }];

test("finished goods by registration status: 24 of 25 lines repeat 2023 in 2024, and the table is flagged", () => {
  // The total (62,372.91 then 65,657.60) moved; the breakdown did not. Figures as NBS serves them.
  const breakdown = [1473.93, 60616.64, 282.34, 20338.51, 15982.87, 26051.53, 50856.01, 40917.86, 9281.24, 393.65, 216.69, 43.12, 3.46, 5079.76, 4232.79, 782.93, 26.66, 37.38, 6428.40, 5590.47, 667.50, 41.27, 129.16, 8.74];
  // The total already carries 2025 (67,279.70); the breakdown stops at 2024.
  const total = [...line(62372.91, 65657.60), { date: "2025", value: 67279.70 }];
  const table = [total, ...breakdown.map((value) => line(value, value))];
  expect(repeatedTablePeriod(table, "2024")).toEqual({ period: "2024", previous: "2023", same: 24, of: 25 });
});

test("one line holding still in an otherwise updated table is an ordinary flat year", () => {
  const table = [line(10, 10), line(20, 21), line(30, 33), line(40, 38), line(50, 52), line(60, 61)];
  expect(repeatedTablePeriod(table, "2024")).toBeNull();
});

test("a table too small to judge, or repeating only zeros, is not flagged", () => {
  expect(repeatedTablePeriod([line(5, 5), line(6, 6), line(7, 7)], "2024")).toBeNull();
  expect(repeatedTablePeriod([line(0, 0), line(0, 0), line(0, 0), line(0, 0), line(0, 0)], "2024")).toBeNull();
});

test("only lines holding the period asked about are compared", () => {
  const ended = [{ date: "2019", value: 1 }, { date: "2020", value: 1 }];
  const table = [ended, ended, ended, ended, ended, line(1, 2), line(3, 4), line(5, 6), line(7, 8), line(9, 10)];
  expect(repeatedTablePeriod(table, "2024")).toBeNull();
});
