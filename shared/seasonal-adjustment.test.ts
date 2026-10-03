import { expect, test } from "bun:test";
import { seasonalAdjustmentOf, adjustmentNotes, adjustmentSummary } from "./seasonal-adjustment";
import { convertTrack, csvOf, movingAverage, rebase, type Track } from "../client/lib";
import catalogFixture from "../server/fixtures/nbs-adjustment-metadata.json";

test("NBS catalogue assertions identify the current series without borrowing another country's or series' status", () => {
  const [gdp, services, manufacturing, unemployment, trade, internationalGdp] = catalogFixture.entries;
  expect(seasonalAdjustmentOf({ key: gdp!.key, metadata: gdp })).toBe("sa");
  // Exercise the catalogue annotation itself, independently of the PMI registry.
  expect(seasonalAdjustmentOf({ key: services!.key, metadata: { ...services!, cid: undefined, categories: [] } })).toBe("sa");
  expect(seasonalAdjustmentOf({ key: manufacturing!.key, metadata: { ...manufacturing!, cid: undefined, categories: [] } })).toBe("unknown");
  for (const metadata of [unemployment!, trade!, internationalGdp!]) expect(seasonalAdjustmentOf({ key: metadata.key, metadata })).toBe("unknown");
  expect(seasonalAdjustmentOf({ key: gdp!.key, metadata: gdp }, { seasonalAdjustment: "nsa" })).toBe("nsa");
});

test("publisher-adjusted PMI and OECD series are identified even without adjustment in their titles", () => {
  for (const key of ["pmi", "pmi_manufacturing", "pmi_nonmanufacturing", "caixin_pmi", "caixin_services_pmi", "real_estate", "oecd_cli", "consumer_confidence_oecd"]) {
    expect(seasonalAdjustmentOf({ key, title: "An ordinary title", frequency: "Monthly" })).toBe("sa");
  }
  expect(seasonalAdjustmentOf({ key: "nbs_employment", metadata: { cid: "93ffbb1aa85740d3aa2618371508b606", name: "从业人员指数 (%)" } })).toBe("sa");
});
test("explicit line adjustment takes precedence; negatives and annual rates are distinguished", () => {
  expect(seasonalAdjustmentOf({ key: "pmi" }, { label: "PMI (not seasonally adjusted)" })).toBe("nsa");
  expect(seasonalAdjustmentOf({ title: "GDP seasonally adjusted annual rate" })).toBe("saar");
  expect(seasonalAdjustmentOf({ title: "Output (未经季节调整)" })).toBe("nsa");
  expect(seasonalAdjustmentOf({ title: "产出（经季节调整）" })).toBe("sa");
  expect(seasonalAdjustmentOf({ title: "产出（季节调整）" })).toBe("sa");
  expect(seasonalAdjustmentOf({ title: "产出（未进行季节调整）" })).toBe("nsa");
  expect(seasonalAdjustmentOf({ title: "产出（非季调）" })).toBe("nsa");
  expect(seasonalAdjustmentOf({ title: "GDP (SA)", frequency: "Annual" })).toBe("sa");
  expect(seasonalAdjustmentOf({ key: "gdp" }, { label: "Quarterly growth (SA)" })).toBe("sa");
});
test("a missing flag or a growth/smoothing label never proves the source is adjusted or unadjusted", () => {
  for (const title of ["CPI", "Growth YoY", "3-month average", "Year to date", "Amplitude adjusted index", "Unadjusted income"]) expect(seasonalAdjustmentOf({ title, frequency: "Monthly" })).toBe("unknown");
  expect(seasonalAdjustmentOf({ frequency: "Annual" })).toBe("annual");
  expect(seasonalAdjustmentOf({ key: "trade_3m" })).toBe("nsa");
});
test("mixed adjustment identifies each line and survives smoothing, rebasing, aggregation and CSV", () => {
  const sa: Track = { id: "PMI", name: "PMI", unit: "Index", frequency: "Monthly", seasonalAdjustment: "sa", color: "#111", dash: "", points: [1,2,3].map(month => ({p:`2026-0${month}`,t:Date.UTC(2026,month-1,1),v:49+month})) };
  const nsa: Track = {...sa,id:"Trade",name:"Trade",seasonalAdjustment:"nsa"};
  expect(adjustmentSummary([sa,nsa])).toBe("Seasonal adjustment varies by series");
  expect(adjustmentNotes([sa,nsa])).toEqual(["PMI: Seasonally adjusted","Trade: Not seasonally adjusted"]);
  const unknown: Track = { ...sa, name: "Other", seasonalAdjustment: "unknown" };
  expect(adjustmentSummary([sa,unknown])).toBe("");
  expect(adjustmentNotes([sa,unknown])).toEqual(["PMI: Seasonally adjusted"]);
  expect(adjustmentNotes([unknown])).toEqual([]);
  expect(adjustmentSummary([])).toBe("");
  expect(csvOf([{title:"Other",unit:"Index",agency:"Fixture"}],[unknown],[])).not.toContain("# Seasonal adjustment:");
  expect(convertTrack(sa,"Quarterly","avg").seasonalAdjustment).toBe("sa");
  expect(movingAverage(sa,3).seasonalAdjustment).toBe("sa");
  expect(rebase([sa],sa.points[0]!.t)[0]?.seasonalAdjustment).toBe("sa");
  const csv=csvOf([{title:"Comparison",unit:"Index",agency:"Fixture"}],[sa,nsa],[]);
  expect(csv).toContain("# Seasonal adjustment: PMI: Seasonally adjusted");
  expect(csv).toContain("# Seasonal adjustment: Trade: Not seasonally adjusted");
});
