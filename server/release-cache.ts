/** Published pages can be corrected in place. Re-read them after six hours. */
export class ReleaseCache<T> {
  private entries = new Map<string, { at: number; value: T }>();
  constructor(private readonly ttlMs = 6 * 60 * 60 * 1000, private readonly clock: () => number = Date.now) {}
  get(url: string): T | undefined {
    const hit = this.entries.get(url);
    if (!hit) return undefined;
    if (this.clock() - hit.at >= this.ttlMs) { this.entries.delete(url); return undefined; }
    return hit.value;
  }
  set(url: string, value: T): void { this.entries.set(url, { at: this.clock(), value }); }
}
