# FRED parity roadmap

The product target is FRED for Chinese economic data, not a small chart demo.
FRED's information architecture and workflows are the reference; its branding,
copy, and visual assets are not.

## Shipped foundation

- Search across the generated official NBS catalog, including names, IDs,
  datasets, and category paths.
- Browse by dataset, category, frequency, and geography.
- Series pages with deep links, latest observations, charts, tables, metadata,
  source attribution, citations, and multiple time ranges.
- Transformations for levels, changes, percent changes, year-over-year changes,
  and NBS index-to-growth conversion.
- Up to four series on one chart, with removable comparison chips.
- Province/city dimension discovery where the official series supports it.
- CSV, JSON, and PNG downloads plus shareable URLs.
- Locally saved series, an official NBS releases view, and a JSON API.
- An append-only revision store that every series is served from: curated
  series on a schedule, catalog series on first view and then refreshed daily.
  Page views never call the portal for a series the store already holds.
- Responsive desktop and compact layouts.

## P0: data completeness and reliability

- Complete all ten NBS catalog families and refresh their metadata on a
  conservative schedule.
- Store observations for the whole catalog on a schedule, not only for series
  that have been viewed, once the catalog lives in SQLite and the crawl can be
  budgeted.
- Add per-series freshness, last-success, and upstream-health fields.
- Persist NBS vintages and expose an ALFRED-style observation/revision timeline.
- Add release-page ingestion for PBOC, GAC, SAFE, MOF, and other official
  Chinese agencies, with stable source-document links.

## P1: full chart and workspace parity

- Formula builder for arithmetic, ratios, rebasing, annualization, and custom
  frequency aggregation.
- Per-series axes, units, colors, line styles, chart types, and observation
  labels; recession/event shading and user annotations.
- Editable start/end dates, zoom, frequency conversion, missing-value rules,
  and scale/axis-bound controls.
- Saved graphs, named lists, folders, recently viewed series, and a dashboard
  home page. Move browser-local state to optional account sync when auth exists.
- Embeddable charts, stable image URLs, and publication-ready citation formats.

## P2: discovery and research surfaces

- Dedicated category, release, source, tag, and geographic landing pages with
  breadcrumbs and related-series recommendations.
- Province and city choropleth maps with time controls and regional comparison.
- Curated dashboards for growth, inflation, property, labor, credit, trade, and
  provincial conditions.
- Chinese/English aliases, pinyin search, synonyms, acronym matching, and
  economic-concept tags.
- User alerts for new releases, threshold crossings, and revisions.

## P3: platform parity

- Versioned public API with pagination, documented schemas, bulk download,
  rate limits, API keys, and client examples.
- Accounts, team sharing, permissions, durable saved artifacts, and audit logs.
- Accessibility review, keyboard-first navigation, print views, telemetry,
  error reporting, automated browser coverage, and performance budgets.

## Definition of done

A feature is not considered complete merely because a control is visible. It
must operate on real source data, survive refresh and upstream failure, work at
compact and desktop widths, expose a testable API contract where appropriate,
and preserve source and methodology metadata.
