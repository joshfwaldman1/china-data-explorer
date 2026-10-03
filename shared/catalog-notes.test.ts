import { expect, test } from "bun:test";
import { catalogNotesForExport, collectCatalogNotes, parseTableNotes } from "./catalog-notes";
import { csvOf } from "../client/lib";

test("joined source notes retain older definitions, different caveats, both languages and table scope", () => {
  const old = { key: "old", categories: ["Table (to 2020)"], note: "旧定义", noteEn: "Old definition", annotation: "旧口径\n第二行" };
  const current = { key: "new", categories: ["Table (2021-present)"], note: "", annotation: "新口径" };
  const repeat = { ...old, key: "middle", categories: ["Table (2016-2020)"] };
  const notes = collectCatalogNotes([old, repeat, current]);
  expect(notes.map(note => note.text)).toEqual(["旧定义", "旧口径\n第二行", "新口径"]);
  expect(notes[0]?.sources.map(source => source.key)).toEqual(["old", "middle"]);
  expect(notes[0]?.textEn).toBe("Old definition");
  const exported = catalogNotesForExport("Series", { ...current, sourceNotes: notes });
  const csv = csvOf([{ title: "Series", agency: "NBS", unit: "Index" }], [], exported);
  expect(csv).toContain("Old definition");
  expect(csv).toContain("# Note: Original Chinese: 旧定义");
  expect(csv).toContain("# Note: 第二行");
  expect(csv).toContain("Table (to 2020)");
  expect(csv).toContain("新口径");
  const partialEnglish = collectCatalogNotes([{ ...old, categories: ["价格", "旧表 (-2020)"], categoriesEn: ["Prices", ""] }]);
  expect(partialEnglish[0]?.sources[0]?.tableEn).toBeUndefined();
  expect(catalogNotesForExport("Series", { ...old, sourceNotes: partialEnglish })[0]).toContain("旧表 (-2020)");
});

test("hierarchy notes survive alongside indicator annotations and identify February sources", () => {
  const tableNotes = parseTableNotes([{ id: "root", name: "Dataset", text: "Root explanation" }, { id: "leaf", name: "Table", text: "Leaf explanation" }, null, { text: "incomplete" }]);
  const notes = collectCatalogNotes([{ key: "cumulative", annotation: "Indicator caveat", tableNotes }], "february");
  expect(notes.map(note => note.text)).toEqual(["Indicator caveat", "Root explanation", "Leaf explanation"]);
  expect(notes.every(note => note.sources[0]?.role === "february")).toBe(true);
  const oldFallback = collectCatalogNotes([{ key: "old", annotation: "Leaf explanation", tableNotes }]);
  expect(oldFallback.map(note => note.text)).toEqual(["Leaf explanation", "Root explanation"]);
});
