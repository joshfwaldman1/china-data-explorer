import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ReferenceLine,
} from "recharts";
import "./styles.css";

// ── Types (mirror data.ts) ────────────────────────────────────────────────────
interface CatalogEntry {
  key: string; title: string; group: string; agency: string; frequency: string; unit: string;
}
interface SeriesPoint { date: string; value: number; }
interface Series { label: string; points: SeriesPoint[]; }
interface SeriesResult {
  key: string; title: string; agency: string; sourceUrl: string;
  frequency: string; unit: string; series: Series[];
}

const LINE_COLORS = ["#2e6da4", "#c0392b", "#1f8a70", "#b5820c"];
const RANGES: { label: string; years: number | null }[] = [
  { label: "3Y", years: 3 }, { label: "5Y", years: 5 },
  { label: "10Y", years: 10 }, { label: "Max", years: null },
];

function formatValue(v: number, unit: string): string {
  if (unit.includes("Percent") || unit.includes("index")) {
    return v.toLocaleString("en-US", { maximumFractionDigits: 1 });
  }
  return v.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

// Merge multiple series into one row-per-date table for Recharts.
function mergeRows(series: Series[]): Record<string, number | string>[] {
  const byDate = new Map<string, Record<string, number | string>>();
  for (const s of series) {
    for (const p of s.points) {
      const row = byDate.get(p.date) ?? { date: p.date };
      row[s.label] = p.value;
      byDate.set(p.date, row);
    }
  }
  return [...byDate.values()].sort((a, b) =>
    String(a.date).localeCompare(String(b.date)),
  );
}

function cutoffDate(rows: Record<string, number | string>[], years: number | null): string {
  if (years === null || rows.length === 0) return "0000-00";
  const last = String(rows[rows.length - 1].date); // "YYYY-MM"
  const y = Number(last.slice(0, 4)) - years;
  return `${y}-${last.slice(5, 7)}`;
}

// Export the full series (all history, all columns) as CSV — a FRED staple.
function downloadCsv(data: SeriesResult): void {
  const rows = mergeRows(data.series);
  const labels = data.series.map((s) => s.label);
  const header = ["date", ...labels];
  const lines = [header.join(",")];
  for (const r of rows) {
    const cells = [
      String(r.date),
      ...labels.map((l) => (r[l] !== undefined && r[l] !== null ? String(r[l]) : "")),
    ];
    lines.push(cells.join(","));
  }
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `china_${data.key}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// Export the current chart as a PNG (FRED offers this). We serialize the
// Recharts SVG, resolve the CSS custom properties it references (var() doesn't
// survive serialization), then paint onto a 2x canvas with a white background.
function downloadPng(data: SeriesResult): void {
  // Recharts gives every legend swatch its own tiny svg.recharts-surface, so a
  // naive querySelector grabs a 14x14 icon on multi-series charts. Pick the
  // largest surface — that's always the plot itself.
  const surfaces = [...document.querySelectorAll<SVGSVGElement>(".chart-wrap svg.recharts-surface")];
  if (surfaces.length === 0) return;
  const svg = surfaces.reduce((best, cur) => {
    const a = cur.getBoundingClientRect();
    const b = best.getBoundingClientRect();
    return a.width * a.height > b.width * b.height ? cur : best;
  });
  const rect = svg.getBoundingClientRect();
  const width = Math.round(rect.width) || 800;
  const chartHeight = Math.round(rect.height) || 420;
  // Leave room above the chart for a title and below for a source line, so a
  // shared image carries its own context.
  const padTop = 56;
  const padBottom = 30;
  const height = chartHeight + padTop + padBottom;

  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  let svgStr = new XMLSerializer().serializeToString(clone);

  const cs = getComputedStyle(document.documentElement);
  for (const v of ["--line", "--muted", "--faint", "--panel", "--ground"]) {
    const val = cs.getPropertyValue(v).trim() || "#cccccc";
    svgStr = svgStr.split(`var(${v})`).join(val);
  }

  const svgUrl = URL.createObjectURL(new Blob([svgStr], { type: "image/svg+xml;charset=utf-8" }));
  const img = new Image();
  img.onload = () => {
    const scale = 2;
    const canvas = document.createElement("canvas");
    canvas.width = width * scale;
    canvas.height = height * scale;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(scale, scale);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);

    // Title + subtitle above the plot.
    ctx.fillStyle = "#1f2933";
    ctx.font = "600 17px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
    ctx.fillText(data.title, 16, 26);
    ctx.fillStyle = "#5b6b7a";
    ctx.font = "12px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
    ctx.fillText(`${data.agency} · ${data.frequency} · ${data.unit}`, 16, 45);

    ctx.drawImage(img, 0, padTop, width, chartHeight);

    // Source line below the plot.
    ctx.fillStyle = "#8595a3";
    ctx.font = "11px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
    ctx.fillText(`Source: ${data.agency} · EconStats China Data Explorer`, 16, height - 10);

    URL.revokeObjectURL(svgUrl);
    canvas.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `china_${data.key}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(a.href);
    }, "image/png");
  };
  img.src = svgUrl;
}

function Sidebar(props: {
  catalog: CatalogEntry[];
  selected: string;
  onSelect: (key: string) => void;
}) {
  const [q, setQ] = useState("");
  const filtered = props.catalog.filter(
    (c) => c.title.toLowerCase().includes(q.toLowerCase()) || c.key.includes(q.toLowerCase()),
  );
  const groups: string[] = [];
  for (const c of filtered) if (!groups.includes(c.group)) groups.push(c.group);

  return (
    <aside className="sidebar">
      <input
        className="search"
        placeholder="Search indicators…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {groups.map((g) => (
        <div key={g}>
          <div className="group-label">{g}</div>
          {filtered.filter((c) => c.group === g).map((c) => (
            <button
              key={c.key}
              className={`series-btn${c.key === props.selected ? " active" : ""}`}
              onClick={() => props.onSelect(c.key)}
            >
              {c.title}
              <span className="meta">{c.agency} · {c.frequency}</span>
            </button>
          ))}
        </div>
      ))}
    </aside>
  );
}

function Chart(props: { data: SeriesResult; years: number | null }) {
  const rows = useMemo(() => mergeRows(props.data.series), [props.data]);
  const cut = cutoffDate(rows, props.years);
  const shown = rows.filter((r) => String(r.date) >= cut);
  const isPercentChange = props.data.unit.toLowerCase().includes("percent change");

  return (
    <div className="chart-wrap" style={{ width: "100%", height: 420 }}>
      <ResponsiveContainer width="100%" height="100%" minWidth={0} debounce={0}>
        <LineChart data={shown} margin={{ top: 8, right: 18, bottom: 4, left: 4 }}>
          <CartesianGrid stroke="var(--line)" vertical={false} />
          <XAxis
            dataKey="date" tick={{ fontSize: 11, fill: "var(--muted)" }}
            minTickGap={40} tickMargin={8} stroke="var(--line)"
          />
          <YAxis
            tick={{ fontSize: 11, fill: "var(--muted)" }} width={52}
            stroke="var(--line)"
            domain={["auto", "auto"]}
            tickFormatter={(v: number) => formatValue(v, props.data.unit)}
          />
          {isPercentChange && <ReferenceLine y={0} stroke="var(--faint)" strokeDasharray="3 3" />}
          <Tooltip
            formatter={(v: number, name: string) => [formatValue(v, props.data.unit), name]}
          />
          {props.data.series.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
          {props.data.series.map((s, i) => (
            <Line
              key={s.label} type="monotone" dataKey={s.label}
              stroke={LINE_COLORS[i % LINE_COLORS.length]} strokeWidth={2}
              dot={false} activeDot={{ r: 4 }} connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function Main(props: { selectedKey: string; catalog: CatalogEntry[] }) {
  const [data, setData] = useState<SeriesResult | null>(null);
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  const [errMsg, setErrMsg] = useState("");
  const [years, setYears] = useState<number | null>(10);
  const [copied, setCopied] = useState(false);

  const onCopyLink = () => {
    navigator.clipboard?.writeText(window.location.href)
      .then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); })
      .catch(() => {});
  };

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    setData(null);
    fetch(`/api/series/${props.selectedKey}`)
      .then((r) => r.json())
      .then((json) => {
        if (cancelled) return;
        if (json.error) { setStatus("error"); setErrMsg(json.error); return; }
        setData(json); setStatus("ok");
      })
      .catch((e) => { if (!cancelled) { setStatus("error"); setErrMsg(String(e)); } });
    return () => { cancelled = true; };
  }, [props.selectedKey]);

  if (status === "loading") return <div className="main"><div className="state">Loading…</div></div>;
  if (status === "error") return <div className="main"><div className="state err">Couldn't load data: {errMsg}</div></div>;
  if (!data) return null;

  const first = data.series[0];
  const lastPoint = first?.points[first.points.length - 1];

  return (
    <div className="main">
      <div className="crumbs">China · {data.agency}</div>
      <h2 className="title">{data.title}</h2>
      <div className="metaline">
        <span className="badge">{data.key}</span>
        <span>{data.frequency}</span>
        <span>{data.unit}</span>
      </div>

      {lastPoint && (
        <div className="readout">
          <span className="big">{formatValue(lastPoint.value, data.unit)}{data.unit.startsWith("Percent") ? "%" : ""}</span>
          <span className="asof">{first.label} · latest {lastPoint.date}</span>
        </div>
      )}

      <div className="controls">
        {RANGES.map((r) => (
          <button
            key={r.label}
            className={`range-btn${r.years === years ? " active" : ""}`}
            onClick={() => setYears(r.years)}
          >
            {r.label}
          </button>
        ))}
        <span className="dl-group">
          <button className="dl-btn" onClick={() => downloadCsv(data)} title="Download all data as CSV">CSV</button>
          <button className="dl-btn" onClick={() => downloadPng(data)} title="Download chart as PNG">PNG</button>
          <button className="dl-btn" onClick={onCopyLink} title="Copy a shareable link to this series">
            {copied ? "Copied" : "Copy link"}
          </button>
        </span>
      </div>

      <div className="card">
        <Chart data={data} years={years} />
      </div>

      <p className="footnote">
        Source: {data.agency}, accessed via{" "}
        <a href={data.sourceUrl} target="_blank" rel="noreferrer">{new URL(data.sourceUrl).host}</a>.
        Chinese macro series are conventionally reported as year-over-year percent change (同比);
        PMI is a diffusion index (50 = neutral); reserves and new loans are levels.
        Demo project — not affiliated with any statistical agency.
      </p>
    </div>
  );
}

// The series key lives in the URL hash (e.g. #/series/cpi) so any view can be
// linked or bookmarked — the same idea as FRED's /series/GDPC1 URLs.
function keyFromHash(): string {
  const m = window.location.hash.match(/^#\/series\/([a-z0-9_]+)/i);
  return m ? m[1] : "gdp";
}

function App() {
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
  const [selected, setSelected] = useState<string>(keyFromHash);

  useEffect(() => {
    fetch("/api/catalog").then((r) => r.json()).then(setCatalog).catch(() => setCatalog([]));
  }, []);

  // Keep the URL in sync with the selection, and respond to back/forward.
  useEffect(() => {
    const target = `#/series/${selected}`;
    if (window.location.hash !== target) window.history.pushState(null, "", target);
  }, [selected]);

  useEffect(() => {
    const onPop = () => setSelected(keyFromHash());
    window.addEventListener("popstate", onPop);
    window.addEventListener("hashchange", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      window.removeEventListener("hashchange", onPop);
    };
  }, []);

  return (
    <>
      <header className="topbar">
        <div className="mark">数</div>
        <h1>EconStats</h1>
        <span className="tag">China Data Explorer</span>
        <div className="spacer" />
        <span className="src">NBS · PBOC · Customs</span>
      </header>
      <div className="layout">
        <Sidebar catalog={catalog} selected={selected} onSelect={setSelected} />
        {catalog.length > 0 ? <Main selectedKey={selected} catalog={catalog} /> : <div className="main"><div className="state">Loading catalog…</div></div>}
      </div>
    </>
  );
}

const root = createRoot(document.getElementById("root")!);
root.render(<App />);
