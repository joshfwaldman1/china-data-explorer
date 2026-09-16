/**
 * Every series title in the shipped snapshot renders to English without a
 * Chinese character left in it: the translation table where it has an entry,
 * the token dictionary where it has none, and pinyin for the rest.
 */

import { test, expect } from "bun:test";
import { readCatalogSnapshot } from "./catalog-file.ts";
import { glossTitle, warmGloss } from "./gloss.ts";

interface Entry { name: string }
function isEntry(value: unknown): value is Entry { return typeof value === "object" && value !== null && typeof Reflect.get(value, "name") === "string"; }

test("no English title in the shipped snapshot carries Chinese characters", async () => {
  await warmGloss();
  const snapshot: unknown = await readCatalogSnapshot();
  const list = typeof snapshot === "object" && snapshot !== null ? Reflect.get(snapshot, "entries") : undefined;
  const entries = (Array.isArray(list) ? list : []).filter(isEntry);
  expect(entries.length).toBeGreaterThan(70000);
  const leftovers = entries.map((entry) => [entry.name, glossTitle(entry.name)]).filter(([, en]) => /[一-鿿]/.test(en ?? ""));
  expect(leftovers.slice(0, 10)).toEqual([]);
  expect(leftovers.length).toBe(0);
});

test("a port and a country the dictionary does not know still read as English", async () => {
  await warmGloss();
  expect(glossTitle("日照港口码头长度 (米)")).toBe("Rizhao port quay length");
  expect(glossTitle("汕头港口泊位数 (个)")).toBe("Shantou port berths number");
  expect(glossTitle("爱尔兰发明专利申请受理数 (项)")).toBe("Ireland invention patent applications accepted number");
  expect(glossTitle("艾滋病死亡人数 (人)")).toBe("HIV/AIDS deaths");
});
