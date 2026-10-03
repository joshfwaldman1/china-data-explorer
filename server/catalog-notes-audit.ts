import { collectCatalogNotes } from "../shared/catalog-notes";
import { seasonalAdjustmentOf } from "../shared/seasonal-adjustment";
import type { NbsCatalogEntry } from "./nbs-catalog";

/** Exhaustive check against the shipped source snapshot, without fetching observations. */
export function auditCatalogNotes(raw: NbsCatalogEntry[], entries: NbsCatalogEntry[]) {
  const byKey = new Map(entries.map(entry => [entry.key, entry]));
  const sourceByKey = new Map(raw.map(entry => [entry.key, entry]));
  const failures: { key: string; reason: string }[] = [];
  for (const source of raw) {
    const entry = byKey.get(source.key);
    if (!entry) { failures.push({ key: source.key, reason: "Catalogue entry missing" }); continue; }
    for (const field of ["note", "annotation"] as const) {
      if ((entry[field] ?? "").trim() !== (source[field] ?? "").trim()) failures.push({ key: source.key, reason: `${field} changed or missing` });
    }
    for (const table of source.tableNotes ?? []) {
      if (!entry.tableNotes?.some(note => note.id === table.id && note.text === table.text.trim())) failures.push({ key: source.key, reason: `Hierarchy note ${table.id} missing` });
    }
  }
  const heads = entries.filter(entry => !entry.family || entry.family.head === entry.key).sort((a, b) => a.key.localeCompare(b.key));
  let seriesWithNotes = 0, recoveredSeries = 0, familiesWithAdditionalNotes = 0;
  const datasets = new Map<number, { dataset: string; series: number; withNotes: number }>();
  const adjustmentCounts: Record<string, number> = {};
  const digest = new Bun.CryptoHasher("sha256");
  for (const head of heads) {
    const keys = head.family?.members ?? [head.key];
    const members = keys.flatMap(key => {
      const entry = byKey.get(key);
      if (!entry) failures.push({ key: head.key, reason: `Family member ${key} missing` });
      return entry ? [entry] : [];
    });
    const notes = collectCatalogNotes(members);
    // Assert coverage by source, not just a count: identical prose is deduplicated
    // but every contributing catalogue id must still be attributed.
    for (const member of members) {
      const original = sourceByKey.get(member.key);
      if (!original) continue;
      for (const [field, kind] of [["note", "definition"], ["annotation", "annotation"]] as const) {
        const text = original[field]?.trim();
        if (text && !notes.some(note => note.kind === kind && note.text === text && note.sources.some(source => source.key === member.key))) failures.push({ key: head.key, reason: `Joined notes lost ${member.key} ${field}` });
      }
      for (const table of original.tableNotes ?? []) {
        if (!notes.some(note => note.text === table.text.trim() && note.sources.some(source => source.key === member.key))) failures.push({ key: head.key, reason: `Joined notes lost ${member.key} hierarchy note ${table.id}` });
      }
    }
    const own = collectCatalogNotes([head]);
    if (notes.length) seriesWithNotes += 1;
    if (notes.length && !own.length) recoveredSeries += 1;
    if (notes.some(note => !own.some(ownNote => ownNote.kind === note.kind && ownNote.text === note.text))) familiesWithAdditionalNotes += 1;
    const dataset = datasets.get(head.datasetCode) ?? { dataset: head.dataset, series: 0, withNotes: 0 };
    dataset.series += 1;
    dataset.withNotes += Number(notes.length > 0);
    datasets.set(head.datasetCode, dataset);
    const adjustments = new Set(members.map(entry => seasonalAdjustmentOf({ key: entry.key, frequency: entry.frequency, metadata: entry })));
    const adjustment = adjustments.size === 1 ? [...adjustments][0]! : "unknown";
    adjustmentCounts[adjustment] = (adjustmentCounts[adjustment] ?? 0) + 1;
    digest.update(JSON.stringify([head.key, notes, adjustment]));
  }
  return {
    rawEntries: raw.length, loadedEntries: entries.length, series: heads.length,
    seriesWithNotes, seriesWithoutNotes: heads.length - seriesWithNotes,
    recoveredSeries, familiesWithAdditionalNotes,
    definitionsWithoutEnglish: entries.filter(entry => entry.note?.trim() && !entry.noteEn).length,
    annotationsWithoutEnglish: entries.filter(entry => entry.annotation?.trim() && !entry.annotationEn).length,
    adjustmentCounts,
    adjustmentProse: entries.filter(entry => /季节调整|季調|季调|seasonal(?:ly)?/i.test(`${entry.note} ${entry.annotation}`)).map(entry => ({ key: entry.key, name: entry.name, geography: entry.geography, status: seasonalAdjustmentOf({ key: entry.key, frequency: entry.frequency, metadata: entry }) })),
    datasets: [...datasets].map(([code, counts]) => ({ code, ...counts })),
    failures, notesDigest: digest.digest("hex"),
  };
}
