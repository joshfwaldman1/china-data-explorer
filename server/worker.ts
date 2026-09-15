/**
 * One background job at a time, in priority order, with long jobs yielding.
 *
 * Everything that fetches from the bureau shares one slot, so that the site
 * never has several jobs asking a government portal at once. That was a single
 * boolean: whoever set it first held it until they finished, and the catalog
 * crawl finishes in hours. A release refresh queued behind it waited for the
 * whole crawl, which is the opposite of what a release day needs.
 *
 * So the slot is a worker with priorities. A release check jumps the queue, and
 * a long job asks `shouldYield` between its own units of work — between table
 * requests, never inside one — and stops early when something more urgent is
 * waiting. Stopping early is safe for the jobs here: the crawl skips what it
 * has already stored, so its next run carries on where this one left off.
 *
 * Priorities, lowest number first:
 *   0  release checks and headline updates
 *   1  catching up an active series, reconciling an incomplete release
 *   2  regional coverage someone asked for
 *   3  historical backfill and metadata discovery
 */

export const PRIORITY = { release: 0, catchUp: 1, requested: 2, backfill: 3 } as const;

export type Priority = typeof PRIORITY[keyof typeof PRIORITY];

interface Queued {
  label: string;
  priority: Priority;
  job: () => Promise<void>;
  resolve: () => void;
  reject: (error: unknown) => void;
  queuedAt: number;
}

export interface WorkerState {
  running: { label: string; priority: Priority; startedAt: string } | null;
  queued: { label: string; priority: Priority; waitingMs: number }[];
}

export interface Worker {
  /** Queue a job. Resolves when it has run (or rejects with what it threw). */
  run(label: string, priority: Priority, job: () => Promise<void>): Promise<void>;
  /** For a long job: is something more urgent than `priority` waiting? */
  shouldYield(priority: Priority): boolean;
  /** Whether anything is running or queued, for the status route. */
  state(): WorkerState;
}

export function createWorker(now: () => number = Date.now): Worker {
  const queue: Queued[] = [];
  let active: { label: string; priority: Priority; startedAt: number } | null = null;

  const pump = (): void => {
    if (active || queue.length === 0) return;
    // Stable within a priority: the earliest queued of the most urgent kind.
    queue.sort((a, b) => a.priority - b.priority || a.queuedAt - b.queuedAt);
    const next = queue.shift();
    if (!next) return;
    active = { label: next.label, priority: next.priority, startedAt: now() };
    // The slot is freed before the caller is told, so a caller that looks at
    // the state as its job returns does not see itself still running.
    const settle = (finish: () => void) => {
      active = null;
      finish();
      // A job queued by this one gets its turn before the loop unwinds.
      queueMicrotask(pump);
    };
    void next.job().then(
      () => settle(next.resolve),
      (error: unknown) => settle(() => next.reject(error)),
    );
  };

  return {
    run(label, priority, job) {
      return new Promise<void>((resolve, reject) => {
        queue.push({ label, priority, job, resolve, reject, queuedAt: now() });
        pump();
      });
    },
    shouldYield(priority) {
      return queue.some((item) => item.priority < priority);
    },
    state() {
      return {
        running: active ? { label: active.label, priority: active.priority, startedAt: new Date(active.startedAt).toISOString() } : null,
        queued: queue.map((item) => ({ label: item.label, priority: item.priority, waitingMs: now() - item.queuedAt })),
      };
    },
  };
}
