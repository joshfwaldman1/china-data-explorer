/** Original NBS prose and its scope travel together, including older table slices. */
export interface CatalogTableNote { id: string; name: string; text: string; textEn?: string }
export interface CatalogNoteSource { key: string; table: string; tableEn?: string; role: "series" | "february" }
export interface CatalogNote {
  kind: "definition" | "annotation" | "table";
  text: string;
  textEn?: string;
  sources: CatalogNoteSource[];
}
export interface CatalogNotesEntry {
  key: string;
  note?: string;
  noteEn?: string;
  annotation?: string;
  annotationEn?: string;
  categories?: string[];
  categoriesEn?: string[];
  tableNotes?: CatalogTableNote[];
  sourceNotes?: CatalogNote[];
}

export function parseTableNotes(value: unknown): CatalogTableNote[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(item => {
    if (!item || typeof item.id !== "string" || typeof item.name !== "string" || typeof item.text !== "string" || !item.text.trim()) return [];
    return [{ id: item.id, name: item.name, text: item.text.trim(), ...(typeof item.textEn === "string" && item.textEn.trim() ? { textEn: item.textEn.trim() } : {}) }];
  });
}

/** Preserve all definitions/annotations; deduplicate identical prose without losing its sources. */
export function collectCatalogNotes(entries: CatalogNotesEntry[], role: CatalogNoteSource["role"] = "series"): CatalogNote[] {
  const notes = new Map<string, CatalogNote>();
  for (const entry of entries) {
    const completeEnglishPath = entry.categoriesEn?.length === entry.categories?.length && entry.categoriesEn?.every(Boolean);
    const source: CatalogNoteSource = { key: entry.key, table: entry.categories?.join(" / ") ?? "", tableEn: completeEnglishPath ? entry.categoriesEn?.join(" / ") : undefined, role };
    const add = (kind: CatalogNote["kind"], text: string | undefined, textEn?: string, scoped = source) => {
      if (!text?.trim()) return;
      const original = text.trim();
      const id = JSON.stringify([kind, original]);
      const existing = notes.get(id);
      if (existing) {
        if (!existing.sources.some(item => item.key === scoped.key && item.table === scoped.table && item.role === scoped.role)) existing.sources.push(scoped);
        if (!existing.textEn && textEn?.trim()) existing.textEn = textEn.trim();
      } else notes.set(id, { kind, text: original, ...(textEn?.trim() ? { textEn: textEn.trim() } : {}), sources: [scoped] });
    };
    add("definition", entry.note, entry.noteEn);
    add("annotation", entry.annotation, entry.annotationEn);
    for (const note of entry.tableNotes ?? []) {
      // Older crawls used the leaf explanation as annotation. Do not show it twice.
      if (note.text.trim() === entry.annotation?.trim()) continue;
      add("table", note.text, note.textEn, { ...source, table: note.name, tableEn: undefined });
    }
  }
  return [...notes.values()];
}

export function catalogNotesOf(metadata?: CatalogNotesEntry): CatalogNote[] {
  return metadata ? metadata.sourceNotes ?? collectCatalogNotes([metadata]) : [];
}

/** CSV keeps both languages and the table/slice attribution; it never truncates source prose. */
export function catalogNotesForExport(title: string, metadata?: CatalogNotesEntry): string[] {
  return catalogNotesOf(metadata).map(note => {
    const scope = [...new Set(note.sources.map(source => `${source.tableEn || source.table || source.key}${source.role === "february" ? " (January-February source)" : ""}`))].join("; ");
    return `${title} — NBS ${note.kind}${scope ? ` [${scope}]` : ""}: ${note.textEn ? `${note.textEn}\nOriginal Chinese: ` : ""}${note.text}`;
  });
}
