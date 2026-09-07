import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  CartesianGrid, Legend, Line, LineChart, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import "./styles.css";

interface CatalogEntry {
  key: string;
  title: string;
  group: string;
  agency: string;
  frequency: string;
  unit: string;
}

interface NbsCatalogEntry {
  key: string;
  id: string;
  name: string;
  shortName: string;
  unit: string;
  note: string;
  annotation: string;
  datasetCode: number;
  dataset: string;
  frequency: string;
  geography: string;
  categories: string[];
}

interface SeriesPoint { date: string; value: number; }
interface Series { label: string; points: SeriesPoint[]; }
interface Region { text: string; value: string; }
interface SeriesResult {
  key: string;
  title: string;
  agency: string;
  sourceUrl: string;
  frequency: string;
  unit: string;
  series: Series[];
  metadata?: NbsCatalogEntry;
  region?: Region;
  transform?: string;
  source?: string;
}

interface SearchResponse {
  total: number;
  offset: number;
  limit: number;
  results: NbsCatalogEntry[];
}

interface DatasetStat {
  code: number;
  name: string;
  frequency: string;
  geography: string;
  count: number;
}

interface CatalogStats {
  generatedAt: string;
  seriesCount: number;
  categoryCount: number;
  categories: { name: string; count: number }[];
  datasets: DatasetStat[];
}

function isNbsCatalogEntry(value: unknown): value is NbsCatalogEntry {
  if (typeof value !== "object" || value === null) return false;
  const categories = Reflect.get(value, "categories");
  return typeof Reflect.get(value, "key") === "string"
    && typeof Reflect.get(value, "id") === "string"
    && typeof Reflect.get(value, "name") === "string"
    && typeof Reflect.get(value, "shortName") === "string"
    && typeof Reflect.get(value, "unit") === "string"
    && typeof Reflect.get(value, "note") === "string"
    && typeof Reflect.get(value, "annotation") === "string"
    && typeof Reflect.get(value, "datasetCode") === "number"
    && typeof Reflect.get(value, "dataset") === "string"
    && typeof Reflect.get(value, "frequency") === "string"
    && typeof Reflect.get(value, "geography") === "string"
    && Array.isArray(categories)
    && categories.every((item) => typeof item === "string");
}

function isDatasetStat(value: unknown): value is DatasetStat {
  return typeof value === "object" && value !== null
    && typeof Reflect.get(value, "code") === "number"
    && typeof Reflect.get(value, "name") === "string"
    && typeof Reflect.get(value, "frequency") === "string"
    && typeof Reflect.get(value, "geography") === "string"
    && typeof Reflect.get(value, "count") === "number";
}

function isCatalogStats(value: unknown): value is CatalogStats {
  if (typeof value !== "object" || value === null) return false;
  const datasets = Reflect.get(value, "datasets");
  const categories = Reflect.get(value, "categories");
  return typeof Reflect.get(value, "generatedAt") === "string"
    && typeof Reflect.get(value, "seriesCount") === "number"
    && typeof Reflect.get(value, "categoryCount") === "number"
    && Array.isArray(datasets)
    && datasets.every(isDatasetStat)
    && Array.isArray(categories)
    && categories.every((item) => typeof item === "object" && item !== null
      && typeof Reflect.get(item, "name") === "string"
      && typeof Reflect.get(item, "count") === "number");
}

function isSearchResponse(value: unknown): value is SearchResponse {
  if (typeof value !== "object" || value === null) return false;
  const results = Reflect.get(value, "results");
  return typeof Reflect.get(value, "total") === "number"
    && typeof Reflect.get(value, "offset") === "number"
    && typeof Reflect.get(value, "limit") === "number"
    && Array.isArray(results)
    && results.every(isNbsCatalogEntry);
}

type View = "chart" | "table" | "metadata";
type Transform = "default" | "raw" | "change" | "percent_change" | "yoy" | "index_growth";

const COLORS = ["#2563a6", "#c74343", "#16826c", "#a56b13"];
const RANGES: { label: string; years: number | null }[] = [
  { label: "1Y", years: 1 }, { label: "5Y", years: 5 },
  { label: "10Y", years: 10 }, { label: "20Y", years: 20 },
  { label: "Max", years: null },
];
const TRANSFORMS: { value: Transform; label: string }[] = [
  { value: "default", label: "Recommended" },
  { value: "raw", label: "Level" },
  { value: "change", label: "Change" },
  { value: "percent_change", label: "% change" },
  { value: "yoy", label: "% from year ago" },
  { value: "index_growth", label: "Index minus 100" },
];

function SearchIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m16 16 5 5"/></svg>;
}

function StarIcon(props: { filled: boolean }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true" className={props.filled ? "filled" : ""}><path d="m12 2.8 2.8 5.7 6.3.9-4.6 4.5 1.1 6.3-5.6-3-5.6 3 1.1-6.3-4.6-4.5 6.3-.9z"/></svg>;
}

function ChevronIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>;
}

async function json(url: string): Promise<unknown> {
  const response = await fetch(url);
  const body = await response.json();
  if (!response.ok) {
    const message = typeof body === "object" && body !== null && typeof Reflect.get(body, "error") === "string"
      ? Reflect.get(body, "error")
      : `Request failed (${response.status})`;
    throw new Error(message);
  }
  return body;
}

function readStoredList(key: string): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function writeStoredList(key: string, values: string[]): void {
  localStorage.setItem(key, JSON.stringify(values));
}

function keysFromHash(): string[] {
  const match = window.location.hash.match(/^#\/series\/([a-z0-9_,]+)/i);
  const encodedKeys = match?.[1];
  return encodedKeys ? encodedKeys.split(",").filter(Boolean).slice(0, 4) : ["gdp"];
}

function formatNumber(value: number, unit: string): string {
  const decimals = unit.includes("Percent") || unit === "%" || Math.abs(value) < 1000 ? 2 : 0;
  return value.toLocaleString("en-US", { maximumFractionDigits: decimals });
}

function mergeResults(results: SeriesResult[]): Record<string, number | string>[] {
  const rows = new Map<string, Record<string, number | string>>();
  for (const result of results) {
    for (const series of result.series) {
      const label = results.length > 1 ? `${result.title} · ${series.label}` : series.label;
      for (const point of series.points) {
        const row = rows.get(point.date) ?? { date: point.date };
        row[label] = point.value;
        rows.set(point.date, row);
      }
    }
  }
  return [...rows.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

function cutoff(rows: Record<string, number | string>[], years: number | null): string {
  if (years === null || rows.length === 0) return "0000";
  const last = String(rows[rows.length - 1]?.date ?? "");
  return `${Number(last.slice(0, 4)) - years}${last.slice(4)}`;
}

function downloadCsv(results: SeriesResult[]): void {
  const rows = mergeResults(results);
  const labels = Object.keys(rows[0] ?? {}).filter((key) => key !== "date");
  const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
  const lines = [["date", ...labels].map(quote).join(",")];
  for (const row of rows) {
    lines.push([String(row.date), ...labels.map((label) => String(row[label] ?? ""))].map(quote).join(","));
  }
  const url = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `econstats-china-${results.map((result) => result.key).join("-")}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function downloadJson(results: SeriesResult[]): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(results, null, 2)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `econstats-china-${results.map((result) => result.key).join("-")}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

function downloadPng(results: SeriesResult[]): void {
  const nodes = document.querySelectorAll(".chart-wrap svg.recharts-surface");
  let chart: SVGSVGElement | null = null;
  let area = 0;
  for (const node of Array.from(nodes)) {
    if (!(node instanceof SVGSVGElement)) continue;
    const rect = node.getBoundingClientRect();
    if (rect.width * rect.height > area) {
      chart = node;
      area = rect.width * rect.height;
    }
  }
  if (!chart) return;
  const rect = chart.getBoundingClientRect();
  const width = Math.max(800, Math.round(rect.width));
  const chartHeight = Math.max(400, Math.round(rect.height));
  const image = new Image();
  const serialized = new XMLSerializer().serializeToString(chart.cloneNode(true));
  const source = URL.createObjectURL(new Blob([serialized], { type: "image/svg+xml" }));
  image.onload = () => {
    const canvas = document.createElement("canvas");
    canvas.width = width * 2;
    canvas.height = (chartHeight + 90) * 2;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.scale(2, 2);
    context.fillStyle = "#fff";
    context.fillRect(0, 0, width, chartHeight + 90);
    context.fillStyle = "#17212b";
    context.font = "600 17px -apple-system, sans-serif";
    context.fillText(results.map((result) => result.title).join(" vs. "), 18, 27);
    context.fillStyle = "#5d6b78";
    context.font = "12px -apple-system, sans-serif";
    context.fillText(`${results[0]?.frequency ?? ""} · ${results[0]?.unit ?? ""}`, 18, 47);
    context.drawImage(image, 0, 58, width, chartHeight);
    context.fillStyle = "#84909c";
    context.font = "10px -apple-system, sans-serif";
    context.fillText("Source: originating statistical agency · EconStats China Data", 18, chartHeight + 80);
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "econstats-china-chart.png";
      link.click();
      URL.revokeObjectURL(url);
    }, "image/png");
    URL.revokeObjectURL(source);
  };
  image.src = source;
}

function SeriesChart(props: { results: SeriesResult[]; years: number | null; logScale: boolean }) {
  const rows = useMemo(() => mergeResults(props.results), [props.results]);
  const start = cutoff(rows, props.years);
  const shown = rows.filter((row) => String(row.date) >= start);
  const labels = Object.keys(shown[0] ?? {}).filter((key) => key !== "date");
  const hasZeroLine = props.results.some((result) => result.unit.toLowerCase().includes("percent"));

  return (
    <div className="chart-wrap" style={{ width: "100%", height: 430 }}>
      <ResponsiveContainer width="100%" height="100%" minWidth={0} debounce={0}>
        <LineChart data={shown} margin={{ top: 10, right: 20, bottom: 4, left: 4 }}>
          <CartesianGrid stroke="var(--line)" vertical={false} />
          <XAxis dataKey="date" minTickGap={46} tickMargin={10} tick={{ fontSize: 11, fill: "var(--muted)" }} stroke="var(--line-strong)" />
          <YAxis width={62} scale={props.logScale ? "log" : "auto"} domain={["auto", "auto"]} tick={{ fontSize: 11, fill: "var(--muted)" }} stroke="var(--line-strong)" />
          {hasZeroLine && !props.logScale && <ReferenceLine y={0} stroke="var(--line-strong)" strokeDasharray="4 4" />}
          <Tooltip contentStyle={{ borderRadius: 6, border: "1px solid var(--line)", fontSize: 12 }} />
          {labels.length > 1 && <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />}
          {labels.map((label, index) => (
            <Line key={label} type="monotone" dataKey={label} stroke={COLORS[index % COLORS.length]} strokeWidth={2.2} dot={false} activeDot={{ r: 4 }} connectNulls />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function Sidebar(props: {
  stats: CatalogStats | null;
  featured: CatalogEntry[];
  favorites: string[];
  activeDataset: number | null;
  activeCategory: string;
  onBrowse: (dataset: number | null) => void;
  onCategory: (category: string) => void;
  onOpen: (key: string) => void;
}) {
  return (
    <aside className="sidebar">
      <div className="side-section">
        <button className={`nav-row${props.activeDataset === null ? " active" : ""}`} onClick={() => props.onBrowse(null)}>
          <span>All series</span><span className="count">{props.stats?.seriesCount.toLocaleString() ?? "—"}</span>
        </button>
        {props.stats?.datasets.map((dataset) => (
          <button key={dataset.code} className={`nav-row${props.activeDataset === dataset.code ? " active" : ""}`} onClick={() => props.onBrowse(dataset.code)}>
            <span><strong>{dataset.geography}</strong><small>{dataset.frequency}</small></span>
            <span className="count">{dataset.count.toLocaleString()}</span>
          </button>
        ))}
      </div>
      <div className="side-heading">Popular categories</div>
      <div className="category-list">
        {props.stats?.categories.slice(0, 8).map((category) => (
          <button key={category.name} className={props.activeCategory === category.name ? "active" : ""} onClick={() => props.onCategory(category.name)}><span>{category.name}</span><small>{category.count.toLocaleString()}</small></button>
        ))}
      </div>
      <div className="side-heading">Featured indicators</div>
      <div className="featured-list">
        {props.featured.slice(0, 8).map((entry) => (
          <button key={entry.key} onClick={() => props.onOpen(entry.key)}>{entry.title}<small>{entry.frequency} · {entry.agency}</small></button>
        ))}
      </div>
      <div className="side-heading">My data</div>
      <div className="saved-summary"><StarIcon filled={false}/>{props.favorites.length} saved series</div>
    </aside>
  );
}

function SearchResults(props: {
  response: SearchResponse | null;
  loading: boolean;
  loadingMore: boolean;
  query: string;
  onOpen: (key: string) => void;
  onCompare: (key: string) => void;
  onMore: () => void;
}) {
  return (
    <main className="results-page">
      <div className="page-kicker">Explore NBS data</div>
      <h1>{props.query ? `Search results for “${props.query}”` : "Browse all series"}</h1>
      <p className="result-count">{props.loading ? "Searching…" : `${(props.response?.total ?? 0).toLocaleString()} matching series`}</p>
      <div className="result-list">
        {props.response?.results.map((entry) => (
          <article className="result-row" key={entry.key}>
            <button className="result-main" onClick={() => props.onOpen(entry.key)}>
              <span className="result-title">{entry.name}</span>
              <span className="result-path">{entry.dataset} / {entry.categories.join(" / ")}</span>
              <span className="result-meta">{entry.frequency} · {entry.geography} · {entry.unit || "Unit not stated"}</span>
            </button>
            <button className="compare-button" onClick={() => props.onCompare(entry.key)} title="Add to current chart">Compare</button>
            <ChevronIcon />
          </article>
        ))}
      </div>
      {(props.response?.results.length ?? 0) < (props.response?.total ?? 0) && <button className="load-more" disabled={props.loadingMore} onClick={props.onMore}>{props.loadingMore ? "Loading…" : "Load more series"}</button>}
      {!props.loading && props.response?.results.length === 0 && <div className="empty-state"><strong>No series found</strong><span>Try the Chinese indicator name, a category, or an NBS series ID.</span></div>}
    </main>
  );
}

function SeriesWorkspace(props: {
  keys: string[];
  favorites: string[];
  onToggleFavorite: (key: string) => void;
  onRemove: (key: string) => void;
}) {
  const [results, setResults] = useState<SeriesResult[]>([]);
  const [regions, setRegions] = useState<Region[]>([]);
  const [region, setRegion] = useState("");
  const [transform, setTransform] = useState<Transform>("default");
  const [years, setYears] = useState<number | null>(10);
  const [view, setView] = useState<View>("chart");
  const [logScale, setLogScale] = useState(false);
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  const [error, setError] = useState("");

  useEffect(() => {
    const dynamic = props.keys.find((key) => key.startsWith("nbs_"));
    setRegions([]);
    setRegion("");
    if (!dynamic) return;
    json(`/api/dimensions/${dynamic}`).then((body) => {
      const list = typeof body === "object" && body !== null ? Reflect.get(body, "regions") : undefined;
      if (Array.isArray(list)) {
        const parsed = list.filter((item): item is Region =>
          typeof item === "object" && item !== null &&
          typeof Reflect.get(item, "text") === "string" && typeof Reflect.get(item, "value") === "string"
        );
        setRegions(parsed);
        setRegion(parsed[0]?.value ?? "");
      }
    }).catch(() => setRegions([]));
  }, [props.keys.join(",")]);

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    const query = new URLSearchParams({ limit: "360" });
    if (region) query.set("region", region);
    if (transform !== "default") query.set("transform", transform);
    Promise.all(props.keys.map((key) => json(`/api/series/${key}?${query}`)))
      .then((bodies) => {
        if (cancelled) return;
        const parsed = bodies.filter((body): body is SeriesResult =>
          typeof body === "object" && body !== null && typeof Reflect.get(body, "key") === "string" && Array.isArray(Reflect.get(body, "series"))
        );
        setResults(parsed);
        setStatus("ok");
      })
      .catch((reason) => {
        if (cancelled) return;
        setError(reason instanceof Error ? reason.message : String(reason));
        setStatus("error");
      });
    return () => { cancelled = true; };
  }, [props.keys.join(","), region, transform]);

  if (status === "loading") return <main className="workspace"><div className="loading-state"><span className="loader"/>Loading observations…</div></main>;
  if (status === "error") return <main className="workspace"><div className="error-state"><strong>Series unavailable</strong><span>{error}</span><button onClick={() => window.location.reload()}>Retry</button></div></main>;
  if (results.length === 0) return <main className="workspace"><div className="empty-state">No observations returned.</div></main>;

  const primary = results[0];
  if (!primary) return <main className="workspace"><div className="empty-state">No observations returned.</div></main>;
  const firstSeries = primary.series[0];
  const latest = firstSeries?.points[firstSeries.points.length - 1];
  const rows = mergeResults(results);
  const labels = Object.keys(rows[0] ?? {}).filter((key) => key !== "date");
  const favorite = props.favorites.includes(primary.key);
  const metadata = primary.metadata;

  return (
    <main className="workspace">
      <div className="breadcrumbs">Data / {metadata?.geography ?? "Featured"} / {primary.frequency}</div>
      <div className="series-heading">
        <div>
          <h1>{primary.title}</h1>
          {results.length > 1 && <p className="comparison-note">Compared with {results.slice(1).map((result) => result.title).join(", ")}</p>}
        </div>
        <button className={`favorite-button${favorite ? " active" : ""}`} onClick={() => props.onToggleFavorite(primary.key)}><StarIcon filled={favorite}/>{favorite ? "Saved" : "Save"}</button>
      </div>
      <div className="series-meta-line"><span className="series-id">{primary.key}</span><span>{primary.frequency}</span><span>{primary.unit || "Unit not stated"}</span><span>{primary.agency}</span></div>

      {latest && <section className="latest-strip"><div><span className="latest-value">{formatNumber(latest.value, primary.unit)}</span><span className="latest-unit">{primary.unit}</span></div><div className="latest-period">Latest observation<br/><strong>{latest.date}</strong></div><div className="latest-source">Delivery<br/><strong>{primary.source === "store" ? "Stored snapshot" : "Live source"}</strong></div></section>}

      {results.length > 1 && <div className="comparison-chips">{results.map((result, index) => <span key={result.key} style={{ borderColor: COLORS[index % COLORS.length] ?? COLORS[0] }}>{result.title}<button onClick={() => props.onRemove(result.key)} aria-label={`Remove ${result.title}`}>×</button></span>)}</div>}

      <section className="data-card">
        <div className="toolbar">
          <div className="segmented">{(["chart", "table", "metadata"] satisfies View[]).map((item) => <button key={item} className={view === item ? "active" : ""} onClick={() => setView(item)}>{item.charAt(0).toUpperCase() + item.slice(1)}</button>)}</div>
          {regions.length > 1 && <label>Region<select value={region} onChange={(event) => setRegion(event.target.value)}>{regions.map((item) => <option key={item.value} value={item.value}>{item.text}</option>)}</select></label>}
          <label>Units<select value={transform} onChange={(event) => {
            const value = event.target.value;
            if (value === "default" || value === "raw" || value === "change" || value === "percent_change" || value === "yoy" || value === "index_growth") setTransform(value);
          }}>{TRANSFORMS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
          <label className="check-label"><input type="checkbox" checked={logScale} onChange={(event) => setLogScale(event.target.checked)}/> Log scale</label>
          <div className="toolbar-spacer"/>
          <button className="export-button" onClick={() => downloadCsv(results)}>CSV</button>
          <button className="export-button" onClick={() => downloadJson(results)}>JSON</button>
          <button className="export-button" onClick={() => downloadPng(results)}>PNG</button>
          <button className="export-button" onClick={() => navigator.clipboard?.writeText(window.location.href)}>Share</button>
        </div>
        {view === "chart" && <><div className="range-row">{RANGES.map((item) => <button key={item.label} className={years === item.years ? "active" : ""} onClick={() => setYears(item.years)}>{item.label}</button>)}</div><SeriesChart results={results} years={years} logScale={logScale}/></>}
        {view === "table" && <div className="table-scroll"><table><thead><tr><th>Period</th>{labels.map((label) => <th key={label}>{label}</th>)}</tr></thead><tbody>{rows.slice().reverse().slice(0, 100).map((row) => <tr key={String(row.date)}><td>{row.date}</td>{labels.map((label) => <td key={label}>{row[label] ?? "—"}</td>)}</tr>)}</tbody></table></div>}
        {view === "metadata" && <div className="metadata-grid"><div><span>Dataset</span><strong>{metadata?.dataset ?? "Curated macro series"}</strong></div><div><span>Category</span><strong>{metadata?.categories.join(" / ") || "Macroeconomic indicators"}</strong></div><div><span>Geography</span><strong>{metadata?.geography ?? "National"}</strong></div><div><span>Frequency</span><strong>{primary.frequency}</strong></div><div className="metadata-wide"><span>Series notes</span><p>{metadata?.note || metadata?.annotation || "No additional methodological note is available for this series."}</p></div></div>}
      </section>

      <section className="details-grid"><div><h2>About this series</h2><p>{metadata?.note || "Official macroeconomic data published by the originating Chinese statistical agency."}</p></div><div><h2>Source</h2><p>{primary.agency}</p><a href={primary.sourceUrl} target="_blank" rel="noreferrer">View source release</a></div><div><h2>Suggested citation</h2><p>{primary.agency}, “{primary.title},” retrieved through EconStats China Data Explorer.</p></div></section>
    </main>
  );
}

function ReleaseCalendar() {
  const [items, setItems] = useState<{ id: string; date: string; title: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    json("/api/releases").then((body) => {
      const data = typeof body === "object" && body !== null ? Reflect.get(body, "data") : undefined;
      if (!Array.isArray(data)) return;
      setItems(data.map((item) => ({
        id: typeof item === "object" && item !== null && typeof Reflect.get(item, "_id") === "string" ? Reflect.get(item, "_id") : "",
        date: typeof item === "object" && item !== null && typeof Reflect.get(item, "fb_time") === "string" ? Reflect.get(item, "fb_time") : "",
        title: typeof item === "object" && item !== null && typeof Reflect.get(item, "content") === "string" ? Reflect.get(item, "content") : "",
      })).filter((item) => item.id && item.title));
    }).catch((reason) => setError(reason instanceof Error ? reason.message : String(reason))).finally(() => setLoading(false));
  }, []);
  const grouped = new Map<string, { id: string; date: string; title: string }[]>();
  for (const item of items.sort((a, b) => a.date.localeCompare(b.date))) {
    const date = item.date.slice(0, 10);
    grouped.set(date, [...(grouped.get(date) ?? []), item]);
  }
  return <main className="results-page releases-page"><div className="page-kicker">Official publication schedule</div><h1>NBS releases</h1><p className="result-count">Times shown in China Standard Time</p>{loading ? <div className="loading-state"><span className="loader"/>Loading releases…</div> : error ? <div className="error-state"><strong>Release calendar unavailable</strong><span>{error}</span></div> : <div className="release-list">{[...grouped.entries()].map(([date, releases]) => <section key={date}><div className="release-date"><strong>{new Date(`${date}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</strong><span>{new Date(`${date}T00:00:00`).toLocaleDateString("en-US", { weekday: "short" })}</span></div><div>{releases.map((release) => <article key={release.id}><time>{release.date.slice(11, 16)}</time><span>{release.title.replace(/\(\d{2}:\d{2}\)$/, "")}</span><em>National Bureau of Statistics</em></article>)}</div></section>)}</div>}</main>;
}

function App() {
  const [stats, setStats] = useState<CatalogStats | null>(null);
  const [featured, setFeatured] = useState<CatalogEntry[]>([]);
  const [keys, setKeys] = useState<string[]>(keysFromHash);
  const [query, setQuery] = useState("");
  const [activeDataset, setActiveDataset] = useState<number | null>(null);
  const [activeCategory, setActiveCategory] = useState("");
  const [frequency, setFrequency] = useState("");
  const [geography, setGeography] = useState("");
  const [browsing, setBrowsing] = useState(false);
  const [releaseMode, setReleaseMode] = useState(false);
  const [search, setSearch] = useState<SearchResponse | null>(null);
  const [searching, setSearching] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [favorites, setFavorites] = useState<string[]>(() => readStoredList("china-favorites"));

  useEffect(() => {
    json("/api/catalog/stats").then((body) => {
      if (isCatalogStats(body)) setStats(body);
    }).catch(() => setStats(null));
    json("/api/catalog").then((body) => {
      if (Array.isArray(body)) setFeatured(body);
    }).catch(() => setFeatured([]));
  }, []);

  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return;
      const input = document.getElementById("global-series-search");
      if (!(input instanceof HTMLInputElement)) return;
      event.preventDefault();
      input.focus();
    };
    window.addEventListener("keydown", focusSearch);
    return () => window.removeEventListener("keydown", focusSearch);
  }, []);

  useEffect(() => {
    if (!browsing && !query.trim()) return;
    const timer = window.setTimeout(() => {
      setSearching(true);
      const params = new URLSearchParams({ q: query, limit: "60" });
      if (activeDataset !== null) params.set("dataset", String(activeDataset));
      if (activeCategory) params.set("category", activeCategory);
      if (frequency) params.set("frequency", frequency);
      if (geography) params.set("geography", geography);
      json(`/api/search?${params}`).then((body) => {
        if (isSearchResponse(body)) setSearch(body);
      }).catch(() => setSearch({ total: 0, offset: 0, limit: 60, results: [] })).finally(() => setSearching(false));
    }, 180);
    return () => window.clearTimeout(timer);
  }, [query, activeDataset, activeCategory, frequency, geography, browsing]);

  useEffect(() => {
    const hash = `#/series/${keys.join(",")}`;
    if (window.location.hash !== hash) window.history.pushState(null, "", hash);
  }, [keys.join(",")]);

  useEffect(() => {
    const update = () => setKeys(keysFromHash());
    window.addEventListener("hashchange", update);
    window.addEventListener("popstate", update);
    return () => { window.removeEventListener("hashchange", update); window.removeEventListener("popstate", update); };
  }, []);

  const openSeries = (key: string) => {
    setKeys([key]);
    setQuery("");
    setBrowsing(false);
    setReleaseMode(false);
    const recent = [key, ...readStoredList("china-recent").filter((item) => item !== key)].slice(0, 20);
    writeStoredList("china-recent", recent);
  };
  const addComparison = (key: string) => {
    setKeys((current) => current.includes(key) ? current : [...current, key].slice(0, 4));
    setQuery("");
    setBrowsing(false);
    setReleaseMode(false);
  };
  const loadMore = () => {
    if (!search || search.results.length >= search.total) return;
    setLoadingMore(true);
    const params = new URLSearchParams({ q: query, limit: "60", offset: String(search.results.length) });
    if (activeDataset !== null) params.set("dataset", String(activeDataset));
    if (activeCategory) params.set("category", activeCategory);
    if (frequency) params.set("frequency", frequency);
    if (geography) params.set("geography", geography);
    json(`/api/search?${params}`).then((body) => {
      if (!isSearchResponse(body)) return;
      setSearch((current) => current ? { ...body, results: [...current.results, ...body.results] } : body);
    }).catch(() => undefined).finally(() => setLoadingMore(false));
  };
  const toggleFavorite = (key: string) => setFavorites((current) => {
    const next = current.includes(key) ? current.filter((item) => item !== key) : [key, ...current];
    writeStoredList("china-favorites", next);
    return next;
  });

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={() => openSeries("gdp")}><span className="brand-mark">数</span><span><strong>EconStats</strong><small>China Data</small></span></button>
        <div className="global-search"><SearchIcon/><input id="global-series-search" value={query} onChange={(event) => { setQuery(event.target.value); setBrowsing(true); setReleaseMode(false); }} onFocus={() => { setBrowsing(true); setReleaseMode(false); }} placeholder="Search thousands of economic data series…"/><kbd>/</kbd></div>
        <div className="header-stat"><strong>{stats?.seriesCount.toLocaleString() ?? "—"}</strong><span>official series</span></div>
      </header>
      <div className="filterbar">
        <button className={browsing && activeDataset === null && !activeCategory ? "active" : ""} onClick={() => { setActiveDataset(null); setActiveCategory(""); setBrowsing(true); setReleaseMode(false); }}>Browse</button>
        <button className={releaseMode ? "active" : ""} onClick={() => { setReleaseMode(true); setBrowsing(false); setQuery(""); }}>Releases</button>
        <select value={frequency} onChange={(event) => { setFrequency(event.target.value); setBrowsing(true); setReleaseMode(false); }} aria-label="Frequency"><option value="">All frequencies</option><option>Monthly</option><option>Quarterly</option><option>Annual</option></select>
        <select value={geography} onChange={(event) => { setGeography(event.target.value); setBrowsing(true); setReleaseMode(false); }} aria-label="Geography"><option value="">All geographies</option><option>National</option><option>Province</option><option>City</option><option>Hong Kong, Macao & Taiwan</option></select>
        <span>Source: National Bureau of Statistics · PBOC · GAC</span>
      </div>
      <div className="body-grid">
        <Sidebar stats={stats} featured={featured} favorites={favorites} activeDataset={activeDataset} activeCategory={activeCategory} onBrowse={(dataset) => { setActiveDataset(dataset); setActiveCategory(""); setBrowsing(true); setReleaseMode(false); }} onCategory={(category) => { setActiveCategory(category); setActiveDataset(null); setBrowsing(true); setReleaseMode(false); }} onOpen={openSeries}/>
        {releaseMode
          ? <ReleaseCalendar/>
          : browsing || query.trim()
            ? <SearchResults response={search} loading={searching} loadingMore={loadingMore} query={query} onOpen={openSeries} onCompare={addComparison} onMore={loadMore}/>
            : <SeriesWorkspace keys={keys} favorites={favorites} onToggleFavorite={toggleFavorite} onRemove={(key) => setKeys((current) => current.filter((item) => item !== key))}/>
        }
      </div>
      <footer>Official-source data explorer · Revisions retained locally · Demo project, not affiliated with any statistical agency</footer>
    </div>
  );
}

const rootElement = document.getElementById("root");
if (rootElement) createRoot(rootElement).render(<App/>);
