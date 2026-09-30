/**
 * The curated catalog list as the client sees it.
 */
import { test, expect } from "bun:test";

const { catalogList } = await import("./data.ts");

test("a deployment without AKTools marks the AkShare series as not refreshable, and nothing else", () => {
  const before = process.env.AKTOOLS_URL;
  process.env.AKTOOLS_URL = "off";
  const list = catalogList();
  if (before === undefined) delete process.env.AKTOOLS_URL; else process.env.AKTOOLS_URL = before;
  const climate = list.find((entry) => entry.key === "real_estate");
  expect(climate?.refreshBlocked).toBe("AkShare");
  expect(list.find((entry) => entry.key === "cpi")?.refreshBlocked).toBeUndefined();
  expect(list.filter((entry) => entry.refreshBlocked).map((entry) => entry.key).sort()).toEqual(["caixin_pmi", "caixin_services_pmi", "real_estate"]);
});

test("a title several tables share says which table it came from", async () => {
  const { qualifyDuplicateTitles } = await import("./nbs-catalog.ts");
  const entry = (key: string, nameEn: string, categories: string[], categoriesEn: string[]) => ({
    key, id: key, name: "人口数", shortName: "人口数", nameEn, unit: "人", note: "", annotation: "",
    datasetCode: 6, dataset: "分省年度数据", frequency: "Annual" as const, geography: "Province" as const,
    cid: key, rootId: "r", categories, categoriesEn, precision: null,
  });
  const out = qualifyDuplicateTitles([
    entry("a", "Population", ["人口", "按户口登记状况分人口数"], ["Population", "Population by household registration"]),
    entry("b", "Population", ["人口", "人口年龄构成和抚养比"], ["Population", "Age composition and dependency ratio"]),
    entry("c", "Birth rate", ["人口", "人口出生率"], ["Population", "Birth rate"]),
  ]);
  expect(out[0]?.nameEn).toBe("Population by household registration: population");
  expect(out[1]?.nameEn).toBe("Age composition and dependency ratio: population");
  // A qualifier the table already carries is not said twice.
  const sampled = qualifyDuplicateTitles([
    entry("d", "Population (population sample survey)", ["人口", "按户口登记状况分人口数 (人口抽样调查)"], ["Population", "Population by household registration status (population sample survey)"]),
    entry("e", "Population (population sample survey)", ["人口", "人口年龄构成和抚养比 (人口抽样调查)"], ["Population", "Age composition and dependency ratio (population sample survey)"]),
  ]);
  expect(sampled[0]?.nameEn).toBe("Population by household registration status (population sample survey): population");
  // A unique title is left alone, and so is a table whose name repeats the title.
  expect(out[2]?.nameEn).toBe("Birth rate");
});

test("a shared title whose table has no English name is left as it is", async () => {
  const { qualifyDuplicateTitles } = await import("./nbs-catalog.ts");
  const entry = (key: string, categories: string[]) => ({
    key, id: key, name: "人口数 (人口抽样调查)", shortName: "人口数", nameEn: "Population (population sample survey)",
    unit: "人", note: "", annotation: "", datasetCode: 6, dataset: "分省年度数据", frequency: "Annual" as const,
    geography: "Province" as const, cid: key, rootId: "r", categories, precision: null,
  });
  const out = qualifyDuplicateTitles([entry("a", ["人口", "人口数 (人口抽样调查)"]), entry("b", ["人口", "按户口登记状况分人口数"])]);
  // Chinese inside an English title reads as a mistake; both keep the plain gloss.
  expect(out[0]?.nameEn).toBe("Population (population sample survey)");
  expect(out[1]?.nameEn).toBe("Population (population sample survey)");
});

test("the same title in the same table is one series published for several places, and is left alone", async () => {
  const { qualifyDuplicateTitles } = await import("./nbs-catalog.ts");
  const entry = (key: string) => ({
    key, id: key, name: "地区生产总值", shortName: "地区生产总值", nameEn: "Gross regional product", unit: "亿元",
    note: "", annotation: "", datasetCode: 6, dataset: "分省年度数据", frequency: "Annual" as const,
    geography: "Province" as const, cid: "same-table", rootId: "r", categories: ["综合", "地区生产总值"],
    categoriesEn: ["Overview", "Gross regional product"], precision: null,
  });
  const out = qualifyDuplicateTitles([entry("a"), entry("b")]);
  expect(out[0]?.nameEn).toBe("Gross regional product");
});

test("a shared title that opens with its table's name takes the table's vintage, not the name again", async () => {
  const { qualifyDuplicateTitles } = await import("./nbs-catalog.ts");
  const entry = (key: string, nameEn: string, categoriesEn: string[]) => ({
    key, id: key, name: "中型工业企业产成品 (亿元)", shortName: "产成品", nameEn, unit: "亿元", note: "", annotation: "",
    datasetCode: 3, dataset: "年度数据", frequency: "Annual" as const, geography: "National" as const,
    cid: key, rootId: "r", categories: ["工业", key], categoriesEn, precision: null,
  });
  // The bureau's two registration-status tables, before and after its 2023 reclassification.
  const title = "Finished goods of medium-sized industrial enterprises (100 million yuan)";
  const out = qualifyDuplicateTitles([
    entry("a", title, ["Industry", "Economic indicators by registration status category (2023-present)", "Finished goods (2023-present)"]),
    entry("b", title, ["Industry", "Economic indicators by type of registration (to 2022)", "Finished goods (to 2022)"]),
  ]);
  expect(out[0]?.nameEn).toBe("Finished goods of medium-sized industrial enterprises, 2023-present (100 million yuan)");
  expect(out[1]?.nameEn).toBe("Finished goods of medium-sized industrial enterprises, to 2022 (100 million yuan)");
});

test("a title in the bureau's title case keeps its capital after the table's name", async () => {
  const { qualifyDuplicateTitles, isTitleCase } = await import("./nbs-catalog.ts");
  const entry = (key: string, table: string) => ({
    key, id: key, name: "流动资产合计", shortName: "流动资产合计", nameEn: "Total Current Assets of Private Industrial Enterprises (100 million yuan)",
    unit: "亿元", note: "", annotation: "", datasetCode: 3, dataset: "年度数据", frequency: "Annual" as const,
    geography: "National" as const, cid: key, rootId: "r", categories: ["工业", key], categoriesEn: ["Industry", table], precision: null,
  });
  const out = qualifyDuplicateTitles([entry("a", "Main indicators of private enterprises"), entry("b", "Assets of private enterprises by industry")]);
  expect(out[0]?.nameEn).toBe("Main indicators of private enterprises: Total Current Assets of Private Industrial Enterprises (100 million yuan)");
  expect(isTitleCase("Total Current Assets of Private Industrial Enterprises")).toBe(true);
  expect(isTitleCase("Population by household registration")).toBe(false);
});

test("a title two year-range tables still share after the table is named takes each table's range", async () => {
  const { qualifyDuplicateTitles } = await import("./nbs-catalog.ts");
  const title = "Selling Expenses of Large and Medium-sized Industrial Enterprises, Mining of Other Ores (100 million yuan)";
  const entry = (key: string, table: string, family?: { head: string; members: string[]; span: string }) => ({
    key, id: key, name: "其他采矿业大中型工业企业销售费用 (亿元)", shortName: "销售费用", nameEn: title, unit: "亿元", note: "", annotation: "",
    datasetCode: 3, dataset: "年度数据", frequency: "Annual" as const, geography: "National" as const,
    cid: key, rootId: "r", categories: ["工业", key, "销售费用"], categoriesEn: ["Industry", table, "Selling expenses"], precision: null,
    ...(family ? { family } : {}),
  });
  // NBS renamed the industry in Chinese for 2000-2002, so that slice is not in the family the later two form.
  const family = { head: "late", members: ["mid", "late"], span: "2003 to 2022" };
  const out = qualifyDuplicateTitles([
    entry("early", "Main economic indicators of large and medium-sized industrial enterprises by industry (2000-2002)"),
    entry("mid", "Main economic indicators of large and medium-sized industrial enterprises by industry (2003-2011)", family),
    entry("late", "Main economic indicators of large and medium-sized industrial enterprises by industry (2012-2022)", family),
  ]);
  expect(out.find((item) => item.key === "early")?.nameEn).toBe("Selling Expenses of Large and Medium-sized Industrial Enterprises, Mining of Other Ores, 2000-2002 (100 million yuan)");
  // The family head speaks for both of its slices.
  expect(out.find((item) => item.key === "late")?.nameEn).toBe("Selling Expenses of Large and Medium-sized Industrial Enterprises, Mining of Other Ores, 2003-2022 (100 million yuan)");
});
