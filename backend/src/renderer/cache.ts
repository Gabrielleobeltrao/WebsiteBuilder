/**
 * A tiny time-bounded cache.
 *
 * The renderer is stateless in the sense that matters — every entry is derived from the database
 * and expires — but it must not hit the database for every asset request on a busy site. Entries
 * are keyed by tenant so one site's content can never be served under another's key, and a
 * publication invalidates its own key explicitly rather than waiting for the clock.
 */
export class TtlCache<T> {
  private readonly entries = new Map<string, { value: T; expiresAt: number }>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries = 500,
  ) {}

  get(key: string, now = Date.now()): T | undefined {
    const entry = this.entries.get(key);
    if (entry === undefined) return undefined;

    if (entry.expiresAt <= now) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: T, now = Date.now()): void {
    // Oldest-first eviction. The renderer's working set is the sites currently receiving traffic,
    // and an unbounded map on a shared process is a memory leak with extra steps.
    if (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next();
      if (!oldest.done) this.entries.delete(oldest.value);
    }
    this.entries.set(key, { value, expiresAt: now + this.ttlMs });
  }

  invalidate(key: string): void {
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}
