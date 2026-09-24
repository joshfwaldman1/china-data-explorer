import { expect, test } from "bun:test";
import {
  indexOfficialEnglish,
  parseOfficialEnglishSnapshot,
  resolveEnglishLabelFrom,
} from "./official-english";

const currentKey = "nbs_0123456789abcdef0123456789abcdef";
const official = {
  schemaVersion: 1,
  generatedAt: "2026-09-07T00:00:00.000Z",
  source: "National Bureau of Statistics of China",
  entries: [{
    currentKey,
    nameZh: "居民消费价格指数 (上年同月=100)",
    nameEn: "Consumer Price Index (The same month last year=100)",
    sourceUrl: "https://data.stats.gov.cn/english/easyquery.htm?cn=A01",
    capturedAt: "2026-09-07T00:00:00.000Z",
    legacyDatabase: "hgyd",
    legacyIndicatorCode: "A01010101",
  }],
};

test("an exact current key and Chinese title uses the official NBS label", () => {
  const entries = indexOfficialEnglish(parseOfficialEnglishSnapshot(official));
  expect(resolveEnglishLabelFrom(entries, currentKey, official.entries[0]!.nameZh, "Generated CPI")).toEqual({
    nameEn: official.entries[0]!.nameEn,
    nameEnSource: "nbs-official",
    nameEnSourceUrl: official.entries[0]!.sourceUrl,
    nameEnCapturedAt: official.entries[0]!.capturedAt,
    legacyDatabase: "hgyd",
    legacyIndicatorCode: "A01010101",
  });
});

test("a renamed Chinese series fails safe to the generated gloss", () => {
  const entries = indexOfficialEnglish(parseOfficialEnglishSnapshot(official));
  expect(resolveEnglishLabelFrom(entries, currentKey, "居民消费价格指数 (2026口径)", "Consumer price index")).toEqual({
    nameEn: "Consumer price index",
    nameEnSource: "generated",
  });
});

test("invalid provenance cannot be imported as an official label", () => {
  const invalid = structuredClone(official);
  invalid.entries[0]!.sourceUrl = "https://example.com/translation";
  expect(() => parseOfficialEnglishSnapshot(invalid)).toThrow("invalid entry");
});

test("an official label with no letters in it is not a title and fails safe to the gloss", () => {
  const broken = structuredClone(official);
  broken.entries[0]!.nameEn = "1";
  const entries = indexOfficialEnglish(parseOfficialEnglishSnapshot(broken));
  expect(resolveEnglishLabelFrom(entries, currentKey, official.entries[0]!.nameZh, "Consumer price index")).toEqual({ nameEn: "Consumer price index", nameEnSource: "generated" });
  expect(resolveEnglishLabelFrom(entries, currentKey, official.entries[0]!.nameZh).nameEnSource).toBe("unavailable");
});

test("a zero-width character the portal prefixes is stripped from an official label", () => {
  const prefixed = structuredClone(official);
  prefixed.entries[0]!.nameEn = "\u200cUrban Population Share (%)";
  const entries = indexOfficialEnglish(parseOfficialEnglishSnapshot(prefixed));
  expect(resolveEnglishLabelFrom(entries, currentKey, official.entries[0]!.nameZh, "x").nameEn).toBe("Urban Population Share (%)");
});
