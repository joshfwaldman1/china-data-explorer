/**
 * Lists the figures the write path held back, or releases one into the store.
 *
 *   bun run china:release-held                 list what is held
 *   bun run china:release-held <n>             release row n of that list
 *
 * A held figure is a stored value a fetch would have replaced with 0, or
 * with one about 10,000 times larger or smaller (see holdReason in db.ts).
 * Release one only after checking it against the publisher: it is then
 * written as the vintage it was, with the time it was fetched. On Railway,
 * run it in the service: `railway ssh -- bun run china:release-held`.
 */

import { heldObservations, releaseHeld } from "./db.ts";

const held = heldObservations(500);
const pick = process.argv[2];

if (pick === undefined) {
  if (held.length === 0) console.log("Nothing held.");
  for (const [index, row] of held.entries()) {
    console.log(`${String(index + 1).padStart(3)}  ${row.key}${row.region ? `@${row.region}` : ""}  ${row.label}  ${row.period}: stored ${row.previous}, fetched ${row.value} at ${row.fetchedAt} (${row.reason})`);
  }
  process.exit(0);
}

const row = held[Number(pick) - 1];
if (!row) {
  console.error(`No held row ${pick}; run without arguments to list them.`);
  process.exit(1);
}
const released = releaseHeld({ key: row.key, region: row.region, label: row.label, period: row.period, fetchedAt: row.fetchedAt });
console.log(released ? `Released ${row.key} ${row.label} ${row.period} = ${row.value} (fetched ${row.fetchedAt}).` : "Already released.");
