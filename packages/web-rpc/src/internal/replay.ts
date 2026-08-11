/** Owns bounded task tombstones and recently reserved outbound identifiers. */
export class ReplayWindow {
  readonly #completed = new Map<string, number>();
  readonly #reservedIds = new Map<string, number>();
  readonly #maxEntries: number;
  readonly #ttlMs: number;

  constructor(maxEntries = 4096, ttlMs = 310_000) {
    if (
      !Number.isSafeInteger(maxEntries) ||
      maxEntries < 1 ||
      !Number.isSafeInteger(ttlMs) ||
      ttlMs < 1
    )
      throw new TypeError('replay limits must be positive safe integers');
    this.#maxEntries = maxEntries;
    this.#ttlMs = ttlMs;
  }

  /** Tests whether a completed task remains inside the replay window. */
  hasCompleted(key: string): boolean {
    this.#purge(this.#completed);
    return this.#completed.has(key);
  }

  /** Records a completed task without evicting a fresh tombstone. */
  rememberCompleted(key: string): boolean {
    return this.#remember(this.#completed, key);
  }

  /** Tests whether an outbound identifier remains reserved. */
  hasReservedId(id: string): boolean {
    this.#purge(this.#reservedIds);
    return this.#reservedIds.has(id);
  }

  /** Reserves an outbound identifier for the replay window. */
  reserveId(id: string): boolean {
    return this.#remember(this.#reservedIds, id);
  }

  /** Releases all replay state during endpoint disposal. */
  clear(): void {
    this.#completed.clear();
    this.#reservedIds.clear();
  }

  #remember(entries: Map<string, number>, key: string): boolean {
    this.#purge(entries);
    if (entries.has(key)) return false;
    if (entries.size >= this.#maxEntries) return false;
    entries.set(key, Date.now());
    return true;
  }

  #purge(entries: Map<string, number>): void {
    const now = Date.now();
    for (const [key, createdAt] of entries) if (now - createdAt >= this.#ttlMs) entries.delete(key);
  }
}
