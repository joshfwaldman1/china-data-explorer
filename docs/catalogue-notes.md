# NBS catalogue notes

Every NBS catalogue series reads the original indicator definition (`note` / `i_mark`) and annotation (`annotation` / `i_annotation`). These fields remain Chinese source text; available English translations are additional fields, never replacements. Untranslated source text remains visible.

`getNbsCatalogSeries` supplies `metadata.sourceNotes` for every joined catalogue segment, including older segments with a definition absent from the newest segment. Notes from a year-to-date sibling used for a January-February point are identified separately. Identical prose is deduplicated while retaining every source id and table scope. Notes from an older table are not silently presented as statements about the entire history.

The series page renders these notes for every member of a comparison. CSV includes the complete prose, translations, original Chinese and table scope; each line remains a CSV comment. JSON retains structured source notes. PNG remains a compact chart with limited notes and a link to the series page; it does not embed every catalogue definition.

The crawler now retains hierarchy explanations alongside indicator annotations rather than choosing one and losing the other. Resumed snapshots and the catalogue cache preserve these fields; the translation collector includes them. This takes effect on future crawls. The current snapshot cannot recover hierarchy notes that the old crawler never saved. No new full live crawl was performed for this repair.

Seasonal adjustment is resolved from each source segment's metadata using the scoped rules in `seasonal-adjustment.md`. Different or missing classifications across joined inputs do not establish a common adjustment status. Carrying all source prose does not mean every sentence can safely be converted into an automatic statistical rule.

## Exhaustive audit

Run `bun run scripts/audit-catalog-notes.ts --out=/path/to/report.json`. The command creates scratch databases, rebuilds all catalogue metadata, checks every original definition and annotation against the loaded entries and joined notes, and starts a second process to verify that cached notes are identical. It does not fetch observations or write to the production/seed store. Any dropped note or missing member fails the audit.

The same exhaustive source-to-joined-notes check runs against the shipped snapshot in the regular test suite, alongside a cache/API regression and a browser comparison/download regression.

Results on 3 October 2026, using the shipped 16 September 2026 snapshot:

| Measure | Count |
| --- | ---: |
| Raw catalogue entries checked | 79,836 |
| Joined, browsable series checked | 66,302 |
| Series with at least one available source note | 41,870 |
| Series with no note in the shipped snapshot | 24,432 |
| Joined series with additional notes from older segments | 4,009 |
| Series previously showing no notes, now recovering older notes | 2,782 |
| Dropped definitions/annotations after build and cache reload | 0 |

There are 1,109 raw entries with a definition lacking English translation and 822 with an annotation lacking English translation (overlap possible). Original Chinese is retained for all of them. These are snapshot coverage counts, not a claim that NBS has never published another explanation elsewhere. The audit is exhaustive for note transport; it is not a manual statistical review of every indicator.
