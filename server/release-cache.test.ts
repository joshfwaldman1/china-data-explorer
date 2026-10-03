import { expect, test } from "bun:test";
import { ReleaseCache } from "./release-cache";

test("both successful and empty archived readings expire so corrections can be fetched", () => {
  let now = 0;
  const cache = new ReleaseCache<number | null>(100, () => now);
  cache.set("release", 1000);
  cache.set("unparsed", null);
  now = 99;
  expect(cache.get("release")).toBe(1000);
  expect(cache.get("unparsed")).toBeNull();
  now = 100;
  expect(cache.get("release")).toBeUndefined();
  expect(cache.get("unparsed")).toBeUndefined();
  cache.set("release", 1001);
  expect(cache.get("release")).toBe(1001);
});
