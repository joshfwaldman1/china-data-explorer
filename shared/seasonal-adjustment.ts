/** Source adjustment, independent of display transforms. Evidence: docs/seasonal-adjustment.md. */
export type SeasonalAdjustment = "sa" | "nsa" | "saar" | "annual" | "unknown";

interface AdjustmentInput {
  key?: string;
  title?: string;
  unit?: string;
  frequency?: string;
  seasonalAdjustment?: SeasonalAdjustment;
  metadata?: { name?: string; nameEn?: string; cid?: string; categories?: string[] };
}
interface AdjustmentLine { label?: string; seasonalAdjustment?: SeasonalAdjustment }

const VERIFIED: Record<string, SeasonalAdjustment> = {
  pmi: "sa", pmi_manufacturing: "sa", pmi_nonmanufacturing: "sa",
  caixin_pmi: "sa", caixin_services_pmi: "sa", real_estate: "sa",
  oecd_cli: "sa", consumer_confidence_oecd: "sa",
  gdp: "nsa", trade: "nsa", trade_values: "nsa", trade_3m: "nsa",
};
const PMI_TABLES = new Set(["93ffbb1aa85740d3aa2618371508b606", "7a64a6e25aec4a8e9dde044ecd9e2cce", "455378e1c3264a32875768a35ba5de76"]);

/** Read only explicit series/line labels, never prose mentioning another adjusted series. */
function explicitAdjustment(text: string): SeasonalAdjustment | undefined {
  if (/not seasonally adjusted|non[- ]?seasonally adjusted|seasonally unadjusted|\bNSA\b|未(?:经|經|进行|進行)?季(?:节|節)?(?:调|調)(?:整)?/i.test(text)) return "nsa";
  if (/seasonally adjusted (?:at (?:an? )?)?annual(?:ized)? rate|\bSAAR\b/i.test(text)) return "saar";
  if (/seasonally adjusted|\bSA\b|季节调整|季節調整|季调|季調/i.test(text)) return "sa";
  return undefined;
}

export function seasonalAdjustmentOf(input: AdjustmentInput, line?: AdjustmentLine): SeasonalAdjustment {
  if (line?.seasonalAdjustment) return line.seasonalAdjustment;
  const lineLabel = explicitAdjustment(line?.label ?? "");
  if (lineLabel) return lineLabel;
  if (input.seasonalAdjustment) return input.seasonalAdjustment;
  const labelled = explicitAdjustment([input.title, input.unit, input.metadata?.name, input.metadata?.nameEn].filter(Boolean).join(" "));
  if (labelled) return labelled;
  const verified = input.key ? VERIFIED[input.key] : undefined;
  if (verified) return verified;
  // The NBS release explicitly covers every PMI sub-index, including employment.
  if (input.key?.startsWith("nbs_") && (PMI_TABLES.has(input.metadata?.cid ?? "") || input.metadata?.categories?.includes("采购经理指数"))) return "sa";
  if (input.frequency === "Annual") return "annual";
  // A blank title flag, YoY rate, moving average or YTD total is not evidence of adjustment.
  return "unknown";
}

export function adjustmentLabel(status: SeasonalAdjustment = "unknown"): string {
  return { sa: "Seasonally adjusted", nsa: "Not seasonally adjusted", saar: "Seasonally adjusted annual rate", annual: "Seasonal adjustment not applicable (annual data)", unknown: "Seasonal adjustment not verified" }[status];
}
export function adjustmentShortLabel(status: SeasonalAdjustment = "unknown"): string {
  return { sa: "SA", nsa: "NSA", saar: "SAAR", annual: "Annual", unknown: "Adjustment unverified" }[status];
}

export function adjustmentSummary(tracks: { seasonalAdjustment?: SeasonalAdjustment }[]): string {
  const statuses = new Set(tracks.map(track => track.seasonalAdjustment ?? "unknown"));
  return statuses.size > 1 ? "Seasonal adjustment varies by series" : adjustmentLabel([...statuses][0]);
}
export function adjustmentNotes(tracks: { name: string; seasonalAdjustment?: SeasonalAdjustment }[]): string[] {
  if (!tracks.length) return [];
  return new Set(tracks.map(track => track.seasonalAdjustment ?? "unknown")).size === 1
    ? [adjustmentSummary(tracks)]
    : tracks.map(track => `${track.name}: ${adjustmentLabel(track.seasonalAdjustment)}`);
}
