/**
 * Server-side data layer for the China Data Explorer.
 *
 * Reuses the same open sources the EconStats agent uses:
 *   - Eastmoney datacenter — mirrors official NBS / PBOC / Customs releases
 *   - NBS new data portal (esData) — for series Eastmoney lacks (unemployment)
 *
 * All fetching happens server-side, which both matches how FRED works (its
 * frontend calls its own API, not the source agencies) and sidesteps the
 * browser CORS restrictions that would block a pure client-side page.
 */

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36";

export interface SeriesPoint {
  date: string; // "YYYY-MM"
  value: number;
}
export interface Series {
  label: string;
  points: SeriesPoint[];
}
export interface SeriesResult {
  key: string;
  title: string;
  agency: string;
  sourceUrl: string;
  frequency: string;
  unit: string;
  series: Series[];
}

// ── Catalog ───────────────────────────────────────────────────────────────────

interface EastmoneyField {
  field: string;
  label: string;
}
interface EastmoneyIndicator {
  kind: "eastmoney";
  group: string;
  title: string;
  agency: string;
  frequency: string;
  unit: string;
  reportName: string;
  fields: EastmoneyField[];
}
interface NbsSeriesId {
  id: string;
  label: string;
}
interface NbsIndicator {
  kind: "nbs";
  group: string;
  title: string;
  agency: string;
  frequency: string;
  unit: string;
  cid: string;
  rootId: string;
  ids: NbsSeriesId[];
}
// AkShare (via a local AKTools HTTP server) — huge breadth of fresh Chinese
// series maintained by the AkShare community. Optional: only these indicators
// need AKTools running (start it with `python -m aktools`); everything else
// works without it. Base URL overridable via AKTOOLS_URL.
interface AktoolsIndicator {
  kind: "aktools";
  group: string;
  title: string;
  agency: string;
  frequency: string;
  unit: string;
  fn: string; // AkShare function name, e.g. "macro_china_lpr"
  dateField: string; // record key holding the date
  // AkShare date formats vary by function; normalize to "YYYY-MM":
  //   iso      -> "2026-08-20T..." (slice by dateLen)
  //   cn_dot   -> "2026.7"
  //   cn_month -> "2026年07月份"
  dateFormat: "iso" | "cn_dot" | "cn_month";
  dateLen?: number; // iso only: 7 (YYYY-MM) or 10 (YYYY-MM-DD)
  fields: EastmoneyField[]; // one entry per series to extract
}
type Indicator = EastmoneyIndicator | NbsIndicator | AktoolsIndicator;

const AKTOOLS_URL = process.env.AKTOOLS_URL ?? "http://127.0.0.1:8080";

export const CATALOG: Record<string, Indicator> = {
  gdp: {
    kind: "eastmoney", group: "Growth & Output",
    title: "Gross Domestic Product", agency: "National Bureau of Statistics",
    frequency: "Quarterly", unit: "Percent change from year ago",
    reportName: "RPT_ECONOMY_GDP",
    fields: [{ field: "SUM_SAME", label: "Real GDP (YoY %)" }],
  },
  industrial_production: {
    kind: "eastmoney", group: "Growth & Output",
    title: "Industrial Production (Value-Added, Large Firms)", agency: "National Bureau of Statistics",
    frequency: "Monthly", unit: "Percent change from year ago",
    reportName: "RPT_ECONOMY_INDUS_GROW",
    fields: [{ field: "BASE_SAME", label: "Industrial production (YoY %)" }],
  },
  cpi: {
    kind: "eastmoney", group: "Prices",
    title: "Consumer Price Index", agency: "National Bureau of Statistics",
    frequency: "Monthly", unit: "Percent change from year ago",
    reportName: "RPT_ECONOMY_CPI",
    fields: [{ field: "NATIONAL_SAME", label: "CPI (YoY %)" }],
  },
  ppi: {
    kind: "eastmoney", group: "Prices",
    title: "Producer Price Index", agency: "National Bureau of Statistics",
    frequency: "Monthly", unit: "Percent change from year ago",
    reportName: "RPT_ECONOMY_PPI",
    fields: [{ field: "BASE_SAME", label: "PPI (YoY %)" }],
  },
  unemployment: {
    kind: "nbs", group: "Labor",
    title: "Surveyed Urban Unemployment Rate", agency: "National Bureau of Statistics",
    frequency: "Monthly", unit: "Percent",
    cid: "ee3b7046b390415b9b7745e3d16f6052",
    rootId: "fc982599aa684be7969d7b90b1bd0e84",
    ids: [
      { id: "3888eac6062945a79c8a27e5f13d4953", label: "Surveyed urban (%)" },
      { id: "bd6da1abb26046c2acb38aa701d90e86", label: "Youth 16-24, ex-students (%)" },
      { id: "7bc1bd5daeac48ae8bb413c34ece1d08", label: "Age 25-29, ex-students (%)" },
      { id: "c03a36c9562246b6bc8aab010951ef1c", label: "Age 30-59, ex-students (%)" },
    ],
  },
  retail_sales: {
    kind: "eastmoney", group: "Consumption",
    title: "Retail Sales of Consumer Goods", agency: "National Bureau of Statistics",
    frequency: "Monthly", unit: "Percent change from year ago",
    reportName: "RPT_ECONOMY_TOTAL_RETAIL",
    fields: [{ field: "RETAIL_TOTAL_SAME", label: "Retail sales (YoY %)" }],
  },
  money_supply: {
    kind: "eastmoney", group: "Money & Credit",
    title: "Money Supply (M1 / M2 Growth)", agency: "People's Bank of China",
    frequency: "Monthly", unit: "Percent change from year ago",
    reportName: "RPT_ECONOMY_CURRENCY_SUPPLY",
    fields: [
      { field: "BASIC_CURRENCY_SAME", label: "M2 (YoY %)" },
      { field: "CURRENCY_SAME", label: "M1 (YoY %)" },
    ],
  },
  new_loans: {
    kind: "eastmoney", group: "Money & Credit",
    title: "New Yuan Loans (Monthly Flow)", agency: "People's Bank of China",
    frequency: "Monthly", unit: "Hundred million yuan (亿元)",
    reportName: "RPT_ECONOMY_RMB_LOAN",
    fields: [{ field: "RMB_LOAN", label: "New RMB loans (100M yuan)" }],
  },
  trade: {
    kind: "eastmoney", group: "Trade & External",
    title: "Merchandise Trade (Exports / Imports)", agency: "General Administration of Customs",
    frequency: "Monthly", unit: "Percent change from year ago",
    reportName: "RPT_ECONOMY_CUSTOMS",
    fields: [
      { field: "EXIT_BASE_SAME", label: "Exports (YoY %)" },
      { field: "IMPORT_BASE_SAME", label: "Imports (YoY %)" },
    ],
  },
  forex_reserves: {
    kind: "eastmoney", group: "Trade & External",
    title: "Official Foreign Exchange Reserves", agency: "People's Bank of China",
    frequency: "Monthly", unit: "Hundred million USD (亿美元)",
    reportName: "RPT_ECONOMY_GOLD_CURRENCY",
    fields: [{ field: "FOREX", label: "FX reserves (100M USD)" }],
  },
  real_estate: {
    kind: "aktools", group: "Property",
    title: "Real Estate Climate Index (国房景气指数)", agency: "National Bureau of Statistics",
    frequency: "Monthly", unit: "Index (100 = neutral)",
    fn: "macro_china_real_estate", dateField: "日期", dateFormat: "iso", dateLen: 7,
    fields: [{ field: "最新值", label: "Real estate climate index" }],
  },
  pmi: {
    kind: "eastmoney", group: "Sentiment",
    title: "Purchasing Managers' Index", agency: "National Bureau of Statistics",
    frequency: "Monthly", unit: "Diffusion index (50 = neutral)",
    reportName: "RPT_ECONOMY_PMI",
    fields: [
      { field: "MAKE_INDEX", label: "Manufacturing PMI" },
      { field: "NMAKE_INDEX", label: "Non-manufacturing PMI" },
    ],
  },
  caixin_pmi: {
    kind: "aktools", group: "Sentiment",
    title: "Caixin Manufacturing PMI", agency: "Caixin / S&P Global",
    frequency: "Monthly", unit: "Diffusion index (50 = neutral)",
    fn: "macro_china_cx_pmi_yearly", dateField: "日期", dateFormat: "iso", dateLen: 7,
    fields: [{ field: "今值", label: "Caixin Manufacturing PMI" }],
  },
  caixin_services_pmi: {
    kind: "aktools", group: "Sentiment",
    title: "Caixin Services PMI", agency: "Caixin / S&P Global",
    frequency: "Monthly", unit: "Diffusion index (50 = neutral)",
    fn: "macro_china_cx_services_pmi_yearly", dateField: "日期", dateFormat: "iso", dateLen: 7,
    fields: [{ field: "今值", label: "Caixin Services PMI" }],
  },
  electricity: {
    kind: "aktools", group: "Growth & Output",
    title: "Electricity Consumption (Total Society)", agency: "National Energy Administration",
    frequency: "Monthly", unit: "Percent change from year ago",
    fn: "macro_china_society_electricity", dateField: "统计时间", dateFormat: "cn_dot",
    fields: [{ field: "全社会用电量同比", label: "Total electricity use (YoY %)" }],
  },
  lpr: {
    kind: "aktools", group: "Interest Rates",
    title: "Loan Prime Rate (LPR)", agency: "People's Bank of China",
    frequency: "Monthly", unit: "Percent per annum",
    fn: "macro_china_lpr", dateField: "TRADE_DATE", dateFormat: "iso", dateLen: 7,
    fields: [
      { field: "LPR1Y", label: "LPR 1-Year (%)" },
      { field: "LPR5Y", label: "LPR 5-Year (%)" },
    ],
  },
};

export interface CatalogEntry {
  key: string;
  title: string;
  group: string;
  agency: string;
  frequency: string;
  unit: string;
}

export function catalogList(): CatalogEntry[] {
  return Object.entries(CATALOG).map(([key, c]) => ({
    key, title: c.title, group: c.group, agency: c.agency,
    frequency: c.frequency, unit: c.unit,
  }));
}

// ── Fetchers ──────────────────────────────────────────────────────────────────

function toMonth(reportDate: string): string {
  const m = reportDate.match(/^(\d{4})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}` : reportDate;
}

async function fetchEastmoney(key: string, cfg: EastmoneyIndicator, limit: number): Promise<SeriesResult> {
  const params = new URLSearchParams({
    reportName: cfg.reportName, columns: "ALL", pageNumber: "1",
    pageSize: String(limit), sortColumns: "REPORT_DATE", sortTypes: "-1",
  });
  const url = `https://datacenter-web.eastmoney.com/api/data/v1/get?${params.toString()}`;
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json, text/plain, */*" } });
  const json = await res.json();
  const rows: Record<string, unknown>[] = json?.result?.data ?? [];

  const series: Series[] = cfg.fields.map((f) => {
    const points: SeriesPoint[] = [];
    for (const row of rows) {
      const rawDate = row.REPORT_DATE;
      const rawVal = row[f.field];
      if (typeof rawDate !== "string") continue;
      const num = typeof rawVal === "number" ? rawVal : Number(rawVal);
      if (rawVal === null || rawVal === "" || Number.isNaN(num)) continue;
      points.push({ date: toMonth(rawDate), value: num });
    }
    points.sort((a, b) => a.date.localeCompare(b.date));
    return { label: f.label, points };
  });

  return {
    key, title: cfg.title, agency: cfg.agency,
    sourceUrl: "https://data.eastmoney.com/cjsj/",
    frequency: cfg.frequency, unit: cfg.unit, series,
  };
}

function nbsMonthlyRange(limit: number): string {
  const now = new Date();
  const end = new Date(now.getFullYear(), now.getMonth(), 1);
  const start = new Date(end.getFullYear(), end.getMonth() - (limit - 1), 1);
  const ym = (d: Date) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;
  return `${ym(start)}MM-${ym(end)}MM`;
}

async function fetchNbs(key: string, cfg: NbsIndicator, limit: number): Promise<SeriesResult> {
  const payload = {
    cid: cfg.cid, indicatorIds: cfg.ids.map((i) => i.id), daCatalogId: "",
    das: [{ text: "全国", value: "000000000000" }], showType: "1",
    dts: [nbsMonthlyRange(limit)], rootId: cfg.rootId,
  };
  const res = await fetch(
    "https://data.stats.gov.cn/dg/website/publicrelease/web/external/stream/esData",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json;charset=UTF-8",
        Origin: "https://data.stats.gov.cn",
        Referer: "https://data.stats.gov.cn/dg/website/page.html",
        "User-Agent": UA,
      },
      body: JSON.stringify(payload),
    },
  );
  const json = await res.json();
  const months: { code?: string; name?: string; values?: { _id?: string; value?: unknown }[] }[] =
    json?.data ?? [];

  const series: Series[] = cfg.ids.map((idcfg) => {
    const points: SeriesPoint[] = [];
    for (const m of months) {
      const code = typeof m.code === "string" ? m.code : "";
      const match = code.match(/^(\d{4})(\d{2})/);
      const date = match ? `${match[1]}-${match[2]}` : code;
      const found = (m.values ?? []).find((v) => v._id === idcfg.id);
      const num = typeof found?.value === "number" ? found.value : Number(found?.value);
      if (found?.value === null || found?.value === undefined || found?.value === "" || Number.isNaN(num)) continue;
      points.push({ date, value: num });
    }
    points.sort((a, b) => a.date.localeCompare(b.date));
    return { label: idcfg.label, points };
  });

  return {
    key, title: cfg.title, agency: cfg.agency,
    sourceUrl: "https://data.stats.gov.cn/dg/website/page.html",
    frequency: cfg.frequency, unit: cfg.unit, series,
  };
}

// Normalize AkShare's varied date strings to a chart-friendly "YYYY-MM".
function normalizeAktoolsDate(raw: string, cfg: AktoolsIndicator): string | null {
  if (cfg.dateFormat === "iso") return raw.slice(0, cfg.dateLen ?? 7);
  if (cfg.dateFormat === "cn_dot") {
    // "2026.7" -> "2026-07"
    const m = raw.match(/^(\d{4})\.(\d{1,2})/);
    return m ? `${m[1]}-${m[2].padStart(2, "0")}` : null;
  }
  if (cfg.dateFormat === "cn_month") {
    // "2026年07月份" -> "2026-07"
    const m = raw.match(/^(\d{4})\D+(\d{1,2})/);
    return m ? `${m[1]}-${m[2].padStart(2, "0")}` : null;
  }
  return null;
}

async function fetchAktools(key: string, cfg: AktoolsIndicator, _limit: number): Promise<SeriesResult> {
  // AkShare functions can take 15-25s, so give them a generous timeout.
  const res = await fetch(`${AKTOOLS_URL}/api/public/${cfg.fn}`, {
    signal: AbortSignal.timeout(45000),
  });
  if (!res.ok) {
    throw new Error(`AKTools ${cfg.fn} -> HTTP ${res.status} (is 'python -m aktools' running on ${AKTOOLS_URL}?)`);
  }
  const rows: Record<string, unknown>[] = await res.json();
  if (!Array.isArray(rows)) throw new Error(`AKTools ${cfg.fn} returned an unexpected shape`);

  const series: Series[] = cfg.fields.map((f) => {
    const points: SeriesPoint[] = [];
    for (const row of rows) {
      const rawDate = row[cfg.dateField];
      const rawVal = row[f.field];
      if (typeof rawDate !== "string") continue;
      const date = normalizeAktoolsDate(rawDate, cfg);
      if (date === null) continue;
      const num = typeof rawVal === "number" ? rawVal : Number(rawVal);
      if (rawVal === null || rawVal === undefined || rawVal === "" || Number.isNaN(num)) continue;
      points.push({ date, value: num });
    }
    points.sort((a, b) => a.date.localeCompare(b.date));
    return { label: f.label, points };
  });

  return {
    key, title: cfg.title, agency: cfg.agency,
    sourceUrl: "https://github.com/akfamily/akshare",
    frequency: cfg.frequency, unit: cfg.unit, series,
  };
}

// Small in-memory cache — repeat clicks are instant, and slow AkShare calls
// happen at most once per TTL. (Bun's process holds this for the server's life.)
interface CacheEntry { at: number; data: SeriesResult; }
const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

export async function getSeries(key: string, limit = 120): Promise<SeriesResult | null> {
  const cfg = CATALOG[key];
  if (!cfg) return null;

  const cacheKey = `${key}:${limit}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.data;

  let data: SeriesResult;
  if (cfg.kind === "nbs") data = await fetchNbs(key, cfg, limit);
  else if (cfg.kind === "aktools") data = await fetchAktools(key, cfg, limit);
  else data = await fetchEastmoney(key, cfg, limit);

  cache.set(cacheKey, { at: Date.now(), data });
  return data;
}
