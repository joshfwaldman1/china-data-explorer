/**
 * A province's profile: what one place looks like across the series the site
 * already holds, on one page.
 *
 * The regions page ranks every province on one series at a time. A reader who
 * clicks Guangdong wants the other direction — everything about Guangdong —
 * and until now got a single figure and a link. This assembles it: growth
 * from the curated provincial keys, and size, structure, labour, households
 * and trade from the bureau's provincial tables in the catalog, all read from
 * the store by the province's own code. Nothing here fetches; the crawl and
 * the ingest keep every one of these current, so the page stays current with
 * no adapter of its own.
 *
 * Two things a reader should not be misled about, and the profile says them:
 * the unemployment rate the bureau publishes by province is the *registered*
 * rate, and it stopped after 2021 — the surveyed rate the site shows for the
 * nation is published for the nation and 31 cities only; and the structure of
 * the economy is annual, so it lags the growth figures by up to a year.
 */

import { CATALOG, NBS_PROVINCES, catalogList, type CatalogEntry, type NbsRegion, type SeriesPoint } from "./data";
import { readSeries } from "./db";
import { getNbsCatalogEntry } from "./nbs-catalog";
import { measureOf, type Measure } from "../shared/measure";
import { PROVINCE_PLACES } from "../shared/places";

/** One line of the profile: a key, the line of it to show, and how to name it. */
interface ProfileEntry {
  key: string;
  /** The line to read from a multi-line table; the first when omitted. */
  line?: string;
  label: string;
  /** Set when the publisher stopped the series; the page says so rather than showing it as stale. */
  ended?: string;
  endedNote?: string;
}

interface ProfileSection { title: string; note?: string; entries: ProfileEntry[] }

/** The bureau's provincial series behind the profile, by catalog id. */
const NBS = {
  gdp: "nbs_aff57de5ee994283974705914fbed246",
  gdpPerCapita: "nbs_779b419f7be14d8f823e5e61810a4909",
  population: "nbs_4810ad6e9ddc41fc804a66134afe587f",
  primary: "nbs_615ce248396a4a5fa52bca05f0633e95",
  secondary: "nbs_b8e109ec8d3f465fa39a0de909f730b3",
  tertiary: "nbs_b6ede904e72c41bba796c98d185e62c5",
  industry: "nbs_a3ba91c8d6b84bbb8731128853eaa675",
  construction: "nbs_404510585076430db340d6603e90b345",
  wholesaleRetail: "nbs_2eb4007ec3ea4ff88acf5525c6615400",
  transport: "nbs_6653b413a36044b0b7669a20a247ccbf",
  finance: "nbs_60e33b6cc92b4903aec6cf123db307e9",
  realEstate: "nbs_8dd9e57d562d404abcf111666ad8dffd",
  hotelsCatering: "nbs_91486f21c4b6424eb7562367002a7f94",
  registeredUnemployment: "nbs_11fcb0050abd4937b970e9fed5113a30",
  incomeQuarterly: "nbs_0f6eafa0055f46bfbe61c3e2eafeb218",
  exports: "nbs_6a455b4128994239ab90e5cac2e7aa25",
} as const;

export const PROVINCE_PROFILE: ProfileSection[] = [
  {
    title: "Growth",
    entries: [
      { key: "provincial_gdp", label: "Real GDP growth" },
      { key: "provincial_industry", line: "Industrial output, month (YoY %)", label: "Industrial output growth" },
      { key: "provincial_cpi", label: "Consumer prices" },
    ],
  },
  {
    title: "Size",
    note: "Annual, in current prices.",
    entries: [
      { key: NBS.gdp, label: "Gross regional product" },
      { key: NBS.gdpPerCapita, label: "GRP per person" },
      { key: NBS.population, label: "Resident population, year end" },
    ],
  },
  {
    title: "Labour and households",
    entries: [
      {
        key: NBS.registeredUnemployment, label: "Registered urban unemployment rate", ended: "2021",
        endedNote: "The bureau stopped publishing the registered rate by province after 2021. The surveyed rate, which the site shows for the nation, is published for the nation and 31 major cities only, not by province.",
      },
      { key: NBS.incomeQuarterly, label: "Disposable income per person, year to date" },
    ],
  },
  {
    title: "Trade",
    entries: [{ key: NBS.exports, label: "Exports of operating units" }],
  },
];

/** The sectors and industries the structure section ranks, all annual value added in 亿元. */
export const STRUCTURE = {
  sectors: [
    { key: NBS.primary, label: "Primary (agriculture)" },
    { key: NBS.secondary, label: "Secondary (industry and construction)" },
    { key: NBS.tertiary, label: "Tertiary (services)" },
  ],
  industries: [
    { key: NBS.industry, label: "Industry" },
    { key: NBS.construction, label: "Construction" },
    { key: NBS.wholesaleRetail, label: "Wholesale and retail" },
    { key: NBS.transport, label: "Transport, storage and post" },
    { key: NBS.finance, label: "Finance" },
    { key: NBS.realEstate, label: "Real estate" },
    { key: NBS.hotelsCatering, label: "Hotels and catering" },
  ],
} as const;

export interface ProfileRow {
  key: string;
  label: string;
  agency: string;
  frequency: string;
  unit: string;
  measure: Measure;
  ended?: string;
  endedNote?: string;
  lastPeriod: string | null;
  latest: number | null;
  previous: number | null;
  points: SeriesPoint[];
}

export interface Share { key: string; label: string; value: number; share: number }

export interface ProvinceProfile {
  code: string;
  region: { value: string; text: string; en: string };
  sections: { title: string; note?: string; rows: ProfileRow[] }[];
  /** The economy's makeup in the latest year every part is published for; null until the store holds it. */
  structure: { year: string; gdp: number; sectors: Share[]; industries: Share[] } | null;
}

/** What the catalog knows about a key: a curated entry, or the bureau's own listing for a catalog series. */
async function describe(key: string): Promise<{ agency: string; frequency: string; unit: string }> {
  const curated = catalogList().find((entry: CatalogEntry) => entry.key === key);
  if (curated) return { agency: curated.agency, frequency: curated.frequency, unit: curated.unit };
  const listed = await getNbsCatalogEntry(key);
  return { agency: "National Bureau of Statistics", frequency: listed?.frequency ?? "Annual", unit: listed?.unit ?? "" };
}

async function readRow(entry: ProfileEntry, code: string): Promise<ProfileRow> {
  const about = await describe(entry.key);
  const stored = readSeries(entry.key, 72, code);
  const line = entry.line ? stored?.series.find((item) => item.label === entry.line) : stored?.series[0];
  const points = line?.points ?? [];
  const latest = points.at(-1), previous = points.at(-2);
  const measure = measureOf(about.unit);
  return {
    key: entry.key, label: entry.label, agency: about.agency, frequency: about.frequency, unit: about.unit, measure,
    ...(entry.ended ? { ended: entry.ended, endedNote: entry.endedNote } : {}),
    lastPeriod: latest?.date ?? null, latest: latest?.value ?? null, previous: previous?.value ?? null, points,
  };
}

/** The latest value of a stored series at a given period, or the latest of all when no period is asked. */
function valueAt(key: string, code: string, period?: string): { date: string; value: number } | null {
  const points = readSeries(key, 40, code)?.series[0]?.points ?? [];
  if (period) { const hit = points.find((point) => point.date === period); return hit ? { date: hit.date, value: hit.value } : null; }
  const last = points.at(-1);
  return last ? { date: last.date, value: last.value } : null;
}

/**
 * The makeup of the economy in the latest year GDP and every sector are
 * published for. Shares are computed here from the published levels, not
 * read from a share series, so they always refer to the same year as the
 * levels beside them — and the three sectors sum to GDP by identity, which
 * the audit holds separately.
 */
export function structureOf(code: string): ProvinceProfile["structure"] {
  const gdp = valueAt(NBS.gdp, code);
  if (!gdp) return null;
  const year = gdp.date;
  const shares = (list: readonly { key: string; label: string }[]) =>
    list.map((item) => { const at = valueAt(item.key, code, year); return at ? { key: item.key, label: item.label, value: at.value, share: gdp.value ? Math.round((at.value / gdp.value) * 1000) / 10 : 0 } : null; })
      .filter((item): item is Share => item !== null)
      .sort((left, right) => right.value - left.value);
  const sectors = shares(STRUCTURE.sectors);
  if (sectors.length < 3) return null;
  return { year, gdp: gdp.value, sectors, industries: shares(STRUCTURE.industries) };
}

export function provinceByCode(code: string): NbsRegion | undefined {
  return NBS_PROVINCES.find((region) => region.value === code);
}

export async function provinceProfile(code: string): Promise<ProvinceProfile | null> {
  const region = provinceByCode(code);
  if (!region) return null;
  const sections = await Promise.all(PROVINCE_PROFILE.map(async (section) => ({
    title: section.title, ...(section.note ? { note: section.note } : {}),
    rows: await Promise.all(section.entries.map((entry) => readRow(entry, code))),
  })));
  // The English name comes from the one list client and server share, so
  // "Guangdong" here is the same "Guangdong" as on the map and in search.
  const en = PROVINCE_PLACES.find((place) => place.code === code)?.en ?? region.en ?? region.text;
  return { code, region: { value: region.value, text: region.text, en }, sections, structure: structureOf(code) };
}

/** Every key the profile reads, for the test that holds them to the catalog. */
export function profileKeys(): string[] {
  return [...new Set([...PROVINCE_PROFILE.flatMap((section) => section.entries.map((entry) => entry.key)), ...STRUCTURE.sectors.map((s) => s.key), ...STRUCTURE.industries.map((s) => s.key), NBS.gdp])];
}

/** The catalog ids the audit's Guangdong identity uses, exported so the pair and the test name the same series. */
export const STRUCTURE_IDENTITY = { gdp: NBS.gdp, parts: [NBS.primary, NBS.secondary, NBS.tertiary] } as const;
