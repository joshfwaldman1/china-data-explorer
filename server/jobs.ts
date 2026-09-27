/**
 * Scheduled work that survives a restart.
 *
 * The scheduler lived in timers, and a deploy is a restart. Two things were
 * lost each time. The daily ingest's clock: every boot ran a full ingest two
 * minutes in and started the 24 hours again, so a day of deploys was a day of
 * full sweeps against every publisher. And a release still being retried:
 * the bureau gives itself about three working days to load a release, the
 * refresh keeps checking across that window, and a restart forgot it, since
 * the release plan only schedules releases less than an hour past.
 *
 * Both are rows here, in the store beside the observations (so the nightly
 * backup carries them). A clock is a named job's last finish. A release job
 * is the agenda item, the attempt it is on and when that attempt is due; the
 * scheduler writes the row before it sets the timer and settles it when the
 * release is complete or given up, and a booting process reschedules every
 * row still pending.
 */

import { db } from "./db";

export type JobState = "pending" | "done" | "abandoned";

export interface PersistedJob<Payload> {
  id: string;
  kind: string;
  payload: Payload;
  attempt: number;
  /** Epoch milliseconds the next attempt is due. */
  nextAt: number;
  state: JobState;
  updatedAt: string;
}

let ready = false;

function jobsDb() {
  const database = db();
  if (!ready) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS scheduled_jobs (
        id          TEXT PRIMARY KEY,
        kind        TEXT NOT NULL,
        payload     TEXT NOT NULL DEFAULT '{}',
        attempt     INTEGER NOT NULL DEFAULT 1,
        next_at     INTEGER NOT NULL DEFAULT 0,
        state       TEXT NOT NULL DEFAULT 'pending',
        updated_at  TEXT NOT NULL
      )
    `);
    database.exec("CREATE INDEX IF NOT EXISTS scheduled_jobs_pending ON scheduled_jobs (kind, state, next_at)");
    ready = true;
  }
  return database;
}

interface JobRow { id: string; kind: string; payload: string; attempt: number; next_at: number; state: string; updated_at: string }

function toJob<Payload>(row: JobRow): PersistedJob<Payload> {
  const state: JobState = row.state === "done" || row.state === "abandoned" ? row.state : "pending";
  return { id: row.id, kind: row.kind, payload: JSON.parse(row.payload) as Payload, attempt: row.attempt, nextAt: row.next_at, state, updatedAt: row.updated_at };
}

/** Record that attempt `attempt` of a job is due at `nextAt`. Written before the timer is set, so a restart in between still finds it. */
export function scheduleJob<Payload>(job: { id: string; kind: string; payload: Payload; attempt: number; nextAt: number }): void {
  jobsDb().query(`
    INSERT INTO scheduled_jobs (id, kind, payload, attempt, next_at, state, updated_at)
    VALUES ($id, $kind, $payload, $attempt, $nextAt, 'pending', $now)
    ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, attempt = excluded.attempt, next_at = excluded.next_at, state = 'pending', updated_at = excluded.updated_at
  `).run({ $id: job.id, $kind: job.kind, $payload: JSON.stringify(job.payload), $attempt: job.attempt, $nextAt: job.nextAt, $now: new Date().toISOString() });
}

/** Settle a job: complete, or given up after its last attempt. A settled job is never rescheduled. */
export function settleJob(id: string, state: Exclude<JobState, "pending">): void {
  jobsDb().query("UPDATE scheduled_jobs SET state = $state, updated_at = $now WHERE id = $id").run({ $id: id, $state: state, $now: new Date().toISOString() });
}

export function getJob<Payload>(id: string): PersistedJob<Payload> | null {
  const row = jobsDb().query<JobRow, { $id: string }>("SELECT * FROM scheduled_jobs WHERE id = $id").get({ $id: id });
  return row ? toJob<Payload>(row) : null;
}

/** Every job of a kind still waiting for an attempt, soonest first. */
export function pendingJobs<Payload>(kind: string): PersistedJob<Payload>[] {
  return jobsDb().query<JobRow, { $kind: string }>("SELECT * FROM scheduled_jobs WHERE kind = $kind AND state = 'pending' ORDER BY next_at").all({ $kind: kind }).map((row) => toJob<Payload>(row));
}

/** Settled jobs older than `days` are history nobody reads; the fetch log keeps what they did. */
export function pruneSettledJobs(days = 30, now = Date.now()): number {
  const cutoff = new Date(now - days * 24 * 60 * 60 * 1000).toISOString();
  return jobsDb().query("DELETE FROM scheduled_jobs WHERE state != 'pending' AND updated_at < $cutoff").run({ $cutoff: cutoff }).changes;
}

/** When a recurring job last finished, in epoch milliseconds, or null if it never has. */
export function lastRun(name: string): number | null {
  const job = getJob<{ finishedAt: number }>(`clock:${name}`);
  return job ? job.payload.finishedAt : null;
}

export function recordRun(name: string, finishedAt = Date.now()): void {
  scheduleJob({ id: `clock:${name}`, kind: "clock", payload: { finishedAt }, attempt: 1, nextAt: 0 });
  settleJob(`clock:${name}`, "done");
}

/**
 * How long to wait before a recurring job's next run, given when it last
 * finished: its period from then, but never sooner than `minimumMs` (a
 * booting process has other things to do first). A job that has never run,
 * or is overdue, runs after the minimum.
 */
export function delayUntilDue(last: number | null, periodMs: number, minimumMs: number, now = Date.now()): number {
  if (last === null) return minimumMs;
  return Math.max(minimumMs, last + periodMs - now);
}
