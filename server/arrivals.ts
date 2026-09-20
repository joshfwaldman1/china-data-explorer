/**
 * When each figure arrived, and which release carried it.
 *
 * The store has always known this and never said it. Every observation is
 * written with the time it was fetched and nothing is ever overwritten, so
 * the first vintage of a period is the moment this site first saw that
 * figure and each later vintage is a restatement it saw afterwards. What was
 * missing was a name for that: a reader looking at August's industrial
 * output could not ask when it appeared, or whether the number on the chart
 * is the one first published.
 *
 * Two things are needed to answer honestly, and the difference between them
 * matters more than either.
 *
 * A figure seen soon after its period closed arrived with the publisher's
 * release: the site was watching, the release landed, the value appeared.
 * A figure seen long after its period closed arrived in a backfill — this
 * site reaching back through a publisher's archive years later — and saying
 * "published on" of such a figure would be a lie about a date the publisher
 * owns. The window that separates them is per frequency and generous, and a
 * point outside it is reported as backfill rather than guessed at.
 *
 * Where the bureau's own calendar names the release, the arrival is matched
 * to it and carries its title and link. Calendar entries are recorded as
 * they are fetched, so the match improves over time and its absence never
 * blocks the answer: an arrival with no calendar entry still says when the
 * figure appeared, and says only that.
 */

import { db } from "./db";
import { comparablePeriod } from "./due";

/** A release the publisher announced, as the bureau's calendar states it. */
export interface ReleaseEvent {
  /** The calendar's own identifier, so re-recording a release updates it rather than duplicating it. */
  id: string;
  agency: string;
  /** When the release was published, as an ISO stamp. */
  publishedAt: string;
  title: string;
  titleEn: string;
  url: string;
  /** The curated keys the release updates, where the calendar names them. */
  keys: string[];
}

/** How a stored figure came to be here. */
export type ArrivalKind = "release" | "revision" | "backfill";

export interface Arrival {
  period: string;
  label: string;
  /** When this site first held a value for the period. */
  firstSeen: string;
  /** When it last changed, when it has been restated. */
  lastRevised: string | null;
  /** How many values have been stored for the period. */
  vintages: number;
  kind: ArrivalKind;
  /** The publisher's release, when the calendar names one that fits. */
  release?: { title: string; url: string; publishedAt: string };
}

/**
 * How long after a period closes a figure can appear and still count as
 * having arrived with its release. A monthly figure is published within
 * weeks; a quarterly one can take two months; an annual one can take most of
 * a year. Anything later is this site reaching into an archive.
 */
const ARRIVAL_WINDOW_DAYS: Record<string, number> = { Monthly: 75, Quarterly: 150, Annual: 400, Daily: 30 };

export function ensureReleaseTable(): void {
  db().exec(`
    CREATE TABLE IF NOT EXISTS release_event (
      id            TEXT PRIMARY KEY,
      agency        TEXT NOT NULL,
      published_at  TEXT NOT NULL,
      title         TEXT NOT NULL,
      title_en      TEXT NOT NULL DEFAULT '',
      url           TEXT NOT NULL DEFAULT '',
      keys          TEXT NOT NULL DEFAULT '[]'
    )
  `);
  db().exec("CREATE INDEX IF NOT EXISTS release_event_at ON release_event (published_at)");
}

/**
 * Record what the calendar said. A release already recorded is updated, so a
 * calendar that gains an English title or a link later improves the row it
 * already wrote rather than adding a second one.
 */
export function recordReleases(events: ReleaseEvent[]): number {
  if (events.length === 0) return 0;
  ensureReleaseTable();
  const insert = db().query(`
    INSERT INTO release_event (id, agency, published_at, title, title_en, url, keys)
    VALUES ($id, $agency, $at, $title, $titleEn, $url, $keys)
    ON CONFLICT(id) DO UPDATE SET
      agency = excluded.agency, published_at = excluded.published_at,
      title = excluded.title, title_en = excluded.title_en,
      url = excluded.url, keys = excluded.keys
  `);
  let written = 0;
  const run = db().transaction((rows: ReleaseEvent[]) => {
    for (const event of rows) {
      if (!event.id || !event.publishedAt) continue;
      insert.run({
        $id: event.id, $agency: event.agency, $at: event.publishedAt,
        $title: event.title, $titleEn: event.titleEn, $url: event.url,
        $keys: JSON.stringify(event.keys),
      });
      written += 1;
    }
  });
  run(events);
  return written;
}

/** Every release recorded, newest first. */
export function storedReleases(limit = 100): ReleaseEvent[] {
  ensureReleaseTable();
  return db().query<{ id: string; agency: string; publishedAt: string; title: string; titleEn: string; url: string; keys: string }, { $limit: number }>(`
    SELECT id, agency, published_at AS publishedAt, title, title_en AS titleEn, url, keys
    FROM release_event ORDER BY published_at DESC LIMIT $limit
  `).all({ $limit: limit }).map((row) => ({ ...row, keys: parseKeys(row.keys) }));
}

function parseKeys(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((key): key is string => typeof key === "string") : [];
  } catch { return []; }
}

/** The end of a period, as a date: the last day of its month, quarter or year. */
export function periodEnd(period: string): Date | null {
  const quarter = period.match(/^(\d{4})-Q([1-4])$/);
  if (quarter) return new Date(Date.UTC(Number(quarter[1]), Number(quarter[2]) * 3, 0));
  const month = period.match(/^(\d{4})-(\d{2})$/);
  if (month) return new Date(Date.UTC(Number(month[1]), Number(month[2]), 0));
  const day = period.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (day) return new Date(`${period}T00:00:00Z`);
  const year = period.match(/^(\d{4})$/);
  if (year) return new Date(Date.UTC(Number(year[1]), 11, 31));
  return null;
}

/**
 * Whether a figure seen at `seenAt` can be said to have arrived with the
 * release of `period`, rather than in a backfill of history.
 */
export function withinReleaseWindow(period: string, seenAt: string, frequency: string): boolean {
  const end = periodEnd(period);
  const seen = new Date(seenAt);
  if (!end || Number.isNaN(seen.getTime())) return false;
  const days = (seen.getTime() - end.getTime()) / 86_400_000;
  // A figure cannot arrive before its period ends by more than a few days;
  // the purchasing managers' index is published on the last day of its month.
  if (days < -3) return false;
  return days <= (ARRIVAL_WINDOW_DAYS[frequency] ?? ARRIVAL_WINDOW_DAYS.Monthly ?? 75);
}

/** The recorded release closest before a moment, for an agency that names this key. */
function releaseNear(agency: string, key: string, seenAt: string): ReleaseEvent | undefined {
  ensureReleaseTable();
  const rows = db().query<{ id: string; agency: string; publishedAt: string; title: string; titleEn: string; url: string; keys: string }, { $agency: string; $at: string }>(`
    SELECT id, agency, published_at AS publishedAt, title, title_en AS titleEn, url, keys
    FROM release_event
    WHERE agency = $agency AND published_at <= $at
    ORDER BY published_at DESC LIMIT 20
  `).all({ $agency: agency, $at: seenAt });
  for (const row of rows) {
    const keys = parseKeys(row.keys);
    // A release with no key list is the agency's release for that day and is
    // accepted; one that names keys must name this one.
    if (keys.length === 0 || keys.includes(key)) {
      // Within three days of the fetch: the scheduler refreshes minutes after
      // a release, and a match weeks earlier would be a different release.
      const gap = (new Date(seenAt).getTime() - new Date(row.publishedAt).getTime()) / 86_400_000;
      if (gap >= 0 && gap <= 3) return { ...row, keys };
    }
  }
  return undefined;
}

/**
 * Every period of a series with when it arrived and how. Newest first.
 *
 * `label` narrows to one line of a multi-line table; without it every line
 * is folded together and the earliest sighting of each period is reported,
 * which is what "when did this month appear" means for a table.
 */
export function arrivalsFor(key: string, options: { region?: string; label?: string; frequency?: string; agency?: string; limit?: number } = {}): Arrival[] {
  const rows = db().query<{ label: string; period: string; firstSeen: string; lastSeen: string; vintages: number }, Record<string, string | number | null>>(`
    SELECT label, period,
           MIN(fetched_at) AS firstSeen,
           MAX(fetched_at) AS lastSeen,
           COUNT(*)        AS vintages
    FROM observations
    WHERE key = $key
      AND ($region IS NULL OR region = $region)
      AND ($label IS NULL OR label = $label)
    GROUP BY label, period
    ORDER BY period DESC
    LIMIT $limit
  `).all({ $key: key, $region: options.region ?? null, $label: options.label ?? null, $limit: options.limit ?? 48 });

  const frequency = options.frequency ?? "Monthly";
  return rows
    .sort((left, right) => comparablePeriod(right.period).localeCompare(comparablePeriod(left.period)))
    .map((row) => {
      const arrived = withinReleaseWindow(row.period, row.firstSeen, frequency);
      const revised = row.vintages > 1 ? row.lastSeen : null;
      const event = arrived && options.agency ? releaseNear(options.agency, key, row.firstSeen) : undefined;
      return {
        period: row.period,
        label: row.label,
        firstSeen: row.firstSeen,
        lastRevised: revised,
        vintages: row.vintages,
        kind: arrived ? (revised ? "revision" : "release") : "backfill",
        ...(event ? { release: { title: event.titleEn || event.title, url: event.url, publishedAt: event.publishedAt } } : {}),
      } satisfies Arrival;
    });
}

/** What the site can say about a figure that did not arrive with a release. */
export const BEFORE_RELEASES_RECORDED =
  "Arrived in a backfill of the publisher's archive, not with a release this site watched for. The publisher's own release date for this period is not recorded here.";

/** One sentence about how a figure got here, for the page to print. */
export function arrivalSentence(arrival: Arrival): string {
  const when = arrival.firstSeen.slice(0, 10);
  if (arrival.kind === "backfill") return BEFORE_RELEASES_RECORDED;
  const named = arrival.release ? ` with the release "${arrival.release.title}"` : "";
  if (arrival.kind === "revision" && arrival.lastRevised) {
    return `First seen ${when}${named}; restated ${arrival.vintages - 1} time${arrival.vintages === 2 ? "" : "s"}, most recently ${arrival.lastRevised.slice(0, 10)}.`;
  }
  return `First seen ${when}${named}, and unchanged since.`;
}
