/**
 * The behaviour a release day needs from the background worker: urgent work
 * goes first, a long job can stop between its own units of work rather than
 * holding the slot for hours, and a job that fails does not keep it.
 */

import { test, expect } from "bun:test";
import { createWorker, PRIORITY } from "./worker.ts";

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

test("a release check does not wait for a long crawl to finish", async () => {
  const worker = createWorker();
  const done: string[] = [];
  let batches = 0;

  // A crawl of twenty table requests that asks, between requests, whether
  // something more urgent is waiting.
  const crawl = worker.run("crawl", PRIORITY.backfill, async () => {
    for (let batch = 0; batch < 20; batch += 1) {
      if (worker.shouldYield(PRIORITY.backfill)) break;
      batches += 1;
      await tick();
    }
    done.push("crawl");
  });

  await tick();
  const release = worker.run("release", PRIORITY.release, async () => { done.push("release"); });
  await Promise.all([crawl, release]);

  expect(done).toEqual(["crawl", "release"]);
  // It stopped early rather than running all twenty of its batches.
  expect(batches).toBeGreaterThan(0);
  expect(batches).toBeLessThan(20);
});

test("a long job that nothing is waiting on runs to the end", async () => {
  const worker = createWorker();
  let batches = 0;
  await worker.run("crawl", PRIORITY.backfill, async () => {
    for (let batch = 0; batch < 5; batch += 1) {
      if (worker.shouldYield(PRIORITY.backfill)) break;
      batches += 1;
      await tick();
    }
  });
  expect(batches).toBe(5);
});

test("the most urgent queued job runs next, and equal ones keep their order", async () => {
  const worker = createWorker();
  const order: string[] = [];
  const first = worker.run("running", PRIORITY.release, async () => { await tick(); order.push("running"); });
  const backfill = worker.run("backfill", PRIORITY.backfill, async () => { order.push("backfill"); });
  const requested = worker.run("requested", PRIORITY.requested, async () => { order.push("requested"); });
  const release = worker.run("release", PRIORITY.release, async () => { order.push("release"); });
  await Promise.all([first, backfill, requested, release]);
  expect(order).toEqual(["running", "release", "requested", "backfill"]);
});

test("a job that throws frees the slot and reports its failure", async () => {
  const worker = createWorker();
  const failed = worker.run("bad", PRIORITY.catchUp, async () => { throw new Error("upstream said no"); });
  await expect(failed).rejects.toThrow("upstream said no");
  let ran = false;
  await worker.run("good", PRIORITY.catchUp, async () => { ran = true; });
  expect(ran).toBe(true);
  expect(worker.state().running).toBeNull();
});

test("the state names what is running and what is waiting", async () => {
  let clock = 1_000;
  const worker = createWorker(() => clock);
  let release: () => void = () => undefined;
  const held = worker.run("crawl", PRIORITY.backfill, () => new Promise<void>((resolve) => { release = resolve; }));
  clock = 3_000;
  const queued = worker.run("release refresh", PRIORITY.release, async () => undefined);
  clock = 4_500;

  const state = worker.state();
  expect(state.running?.label).toBe("crawl");
  expect(state.queued).toEqual([{ label: "release refresh", priority: PRIORITY.release, waitingMs: 1_500 }]);

  release();
  await Promise.all([held, queued]);
  expect(worker.state().running).toBeNull();
  expect(worker.state().queued).toEqual([]);
});
