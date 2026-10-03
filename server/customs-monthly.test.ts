import { expect, test } from "bun:test";
import { MONTHLY_INDEX, bulletinYears, parseBulletinIndex, parseMonthlyBulletin, fetchCustomsMonthly } from "./customs-monthly";
import type { CustomsIndicator } from "./customs";
const fixture = (name: string) => Bun.file(`${import.meta.dir}/fixtures/customs/${name}.html`).text();
const cfg: CustomsIndicator = { kind: "customs", table: "totals", publication: "monthly-bulletin", measure: "growth", regions: [{text: "Total", value: "total"}], group: "Trade", title: "Trade", agency: "Customs", frequency: "Monthly", unit: "%" };

test("the monthly index selects USD table 1B and the latest issue", async () => {
  const html = await fixture("monthly-index-2026");
  expect(bulletinYears(html)).toContain(2024);
  expect(parseBulletinIndex(html, 2026)[0]).toEqual({ period: "2026-08", url: "http://english.customs.gov.cn/Statics/d14f71f5-1ac9-431f-b8d7-b7a7a0b58af7.html" });
});

test("Customs publishes separate January and February rates, distinct from MoM and YTD", async () => {
  const rows = parseMonthlyBulletin(await fixture("monthly-2026-08"), "2026-08");
  expect(rows.find(r => r.period === "2026-01")).toMatchObject({ levels: [5931.08, 3565.57, 2365.51, 1200.06], growth: [16.2, 10, 26.9] });
  expect(rows.find(r => r.period === "2026-02")).toMatchObject({ growth: [28.1, 39.6, 14.7], ytdGrowth: [21.4, 21.8, 20.8] });
  expect(rows.find(r => r.period === "2025-01")?.growth).toEqual([null, null, null]);
  for (const [year, january, february] of [[2024, 7.7, 6.3], [2025, 5.9, -3.1]]) {
    const history = parseMonthlyBulletin(await fixture(`monthly-${year}-12`), `${year}-12`);
    expect(history.find(r => r.period === `${year}-01`)?.growth[1]).toBe(january);
    expect(history.find(r => r.period === `${year}-02`)?.growth[1]).toBe(february);
  }
});

test("a wrong currency or missing calendar month is rejected, not silently stored", async () => {
  const html = await fixture("monthly-2026-08");
  expect(() => parseMonthlyBulletin(html.replace(/US\$/g, "RMB"), "2026-08")).toThrow(/unit/);
  expect(() => parseMonthlyBulletin(html.replace(/2026\.01/g, "2026.00"), "2026-08")).toThrow(/invalid period/);
  expect(() => parseMonthlyBulletin(html.replace(/2026\.01/g, "missing"), "2026-08")).toThrow(/coverage/);
});

test("the adapter fills calendar gaps and prefers newer restated levels while preserving published rates", async () => {
  const pages: Record<string, string> = {};
  for (const [year, issue] of [[2026, "2026-08"], [2025, "2025-12"], [2024, "2024-12"]] as const) {
    const html = await fixture(`monthly-index-${year}`);
    pages[year === 2026 ? MONTHLY_INDEX : MONTHLY_INDEX.replace("monthly.html", `monthly${year}.html`)] = html;
    pages[parseBulletinIndex(html, year)[0]!.url] = await fixture(`monthly-${issue}`);
  }
  const read = async (url: string) => { if (!pages[url]) throw new Error(`Missing fixture ${url}`); return pages[url]!; };
  const growth = await fetchCustomsMonthly("trade", cfg, 24, read);
  for (const line of growth.series) {
    expect(line.points).toHaveLength(24);
    expect(line.points[0]?.date).toBe("2024-09");
    expect(line.points.at(-1)?.date).toBe("2026-08");
  }
  expect(growth.series.find(l => l.label === "Exports (YoY %)")?.points.find(p => p.date === "2025-01")?.value).toBe(5.9);
  const levels = await fetchCustomsMonthly("trade_values", { ...cfg, measure: "levels" }, 24, read);
  expect(levels.series.find(l => l.label === "Exports")?.points.find(p => p.date === "2025-12")?.value).toBe(3572.38);
  // The older bulletin reported 3577.47: do not overwrite the later restatement.
  expect(parseMonthlyBulletin(await fixture("monthly-2025-12"), "2025-12").find(r => r.period === "2025-12")?.levels[1]).toBe(3577.47);
});
