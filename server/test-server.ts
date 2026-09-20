/** A real HTTP server for integration tests, with publisher access blocked. */
import { resolve } from "node:path";

export const TEST_CATALOG = {
  generatedAt: "2026-09-20T00:00:00Z", source: "offline test fixture",
  entries: [{
    key: "nbs_test_cpi", id: "test_cpi", name: "居民消费价格指数", shortName: "居民消费价格指数",
    unit: "%", note: "", annotation: "", datasetCode: 1, dataset: "月度数据",
    frequency: "Monthly", geography: "National", cid: "test", rootId: "test",
    categories: ["价格"], precision: 1,
  }],
};

export async function startOfflineServer(env: Record<string, string | undefined>): Promise<{ url: string; stop: () => Promise<void>; logs: () => string }> {
  const script = `
    globalThis.fetch = async () => { throw new Error("Publisher requests are disabled in integration tests"); };
    await import(${JSON.stringify(resolve(import.meta.dir, "app.ts"))});
  `;
  const child = Bun.spawn(["bun", "-e", script], { env, stdout: "pipe", stderr: "pipe" });
  let output = "";
  let announce = (_url: string) => {};
  const listening = new Promise<string>((resolve) => { announce = resolve; });
  const consume = async (stream: ReadableStream<Uint8Array>) => {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        output = (output + decoder.decode(value, { stream: true })).slice(-8000);
        const match = output.match(/running at (http:\/\/[^\s/]+)/);
        if (match?.[1]) announce(match[1].replace("0.0.0.0", "127.0.0.1").replace("localhost", "127.0.0.1"));
      }
    } finally {
      reader.releaseLock();
    }
  };
  const readers = Promise.all([consume(child.stdout), consume(child.stderr)]);
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error(`Test server did not start: ${output}`)), 30_000);
  });
  const stop = async () => {
    child.kill();
    await child.exited;
    await readers;
  };
  try {
    const url = await Promise.race([
      listening,
      child.exited.then(() => { throw new Error(`Test server exited before listening: ${output}`); }),
      expired,
    ]);
    return { url, stop, logs: () => output };
  } catch (error) {
    await stop();
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
