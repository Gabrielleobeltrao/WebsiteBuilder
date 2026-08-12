/**
 * A fixed-window counter.
 *
 * Two windows rotated in place: when the window ends, the current map is discarded and a fresh one
 * takes over. That bounds memory without an eviction policy, an LRU or a timer — the whole
 * structure is thrown away on a schedule instead of being pruned.
 *
 * State is per process, deliberately. With several renderer replicas the effective limit is the
 * configured one times the replica count, which is documented in `docs/ANALYTICS_OPERATIONS.md`.
 * The alternatives were worse: Redis is a new deployment resource the architecture forbids, and a
 * database round-trip in front of every request would be a larger availability risk than the abuse
 * it prevents.
 *
 * Shared by every public endpoint that takes a write from a stranger. Two copies of this would be
 * two places to get the window rotation wrong.
 */
export class FixedWindowCounter {
  private current = new Map<string, number>();
  private windowStart: number;

  constructor(
    private readonly windowMs: number,
    now: number,
  ) {
    this.windowStart = now;
  }

  /** Returns true when the key is still within its allowance. */
  take(key: string, limit: number, now: number): boolean {
    if (now - this.windowStart >= this.windowMs) {
      this.current = new Map();
      this.windowStart = now;
    }

    const used = this.current.get(key) ?? 0;
    if (used >= limit) return false;
    this.current.set(key, used + 1);
    return true;
  }
}
