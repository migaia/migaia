/** Non-evicting replay ledger for business requests. */
export class RequestReplayLedger {
  readonly #completed = new Map<string, { readonly peerKey: string; readonly at: number }>();
  readonly #rejected = new Map<string, number>();
  readonly #maxEntries: number;
  readonly #maxEntriesPerPeer: number;
  readonly #ttlMs: number;
  readonly #retain?: (peerKey: string) => void;
  readonly #release?: (peerKey: string) => void;

  constructor(
    maxEntries = 4096,
    maxEntriesPerPeer = 1024,
    ttlMs = 310_000,
    lease?: {
      readonly retain: (peerKey: string) => void;
      readonly release: (peerKey: string) => void;
    }
  ) {
    if (
      ![maxEntries, maxEntriesPerPeer, ttlMs].every(Number.isSafeInteger) ||
      maxEntries < 1 ||
      maxEntriesPerPeer < 1 ||
      ttlMs < 1
    )
      throw new TypeError('request replay limits must be positive safe integers');
    this.#maxEntries = maxEntries;
    this.#maxEntriesPerPeer = maxEntriesPerPeer;
    this.#ttlMs = ttlMs;
    this.#retain = lease?.retain;
    this.#release = lease?.release;
  }

  /** Returns true for a fresh tombstone, otherwise admits and records the key. */
  admit(key: string, peerKey: string, now = Date.now()): boolean {
    this.#purge(now);
    if (this.#rejected.has(key)) return false;
    if (this.#completed.has(key)) return false;
    let peerCount = 0;
    for (const entry of this.#completed.values()) if (entry.peerKey === peerKey) peerCount += 1;
    if (peerCount >= this.#maxEntriesPerPeer || this.#completed.size >= this.#maxEntries) {
      if (this.#rejected.size < this.#maxEntries)
        this.#rejected.set(key, now + Math.min(this.#ttlMs, 1_000));
      return false;
    }
    this.#completed.set(key, { peerKey, at: now });
    this.#retain?.(peerKey);
    return true;
  }

  /** Tests whether a fresh tombstone exists without changing it. */
  has(key: string, now = Date.now()): boolean {
    this.#purge(now);
    return this.#completed.has(key);
  }

  /** Checks replay capacity before a caller consumes a separate admission quota. */
  canAdmit(key: string, peerKey: string, now = Date.now()): boolean {
    this.#purge(now);
    if (this.#rejected.has(key) || this.#completed.has(key)) return false;
    let peerCount = 0;
    for (const entry of this.#completed.values()) if (entry.peerKey === peerKey) peerCount += 1;
    return peerCount < this.#maxEntriesPerPeer && this.#completed.size < this.#maxEntries;
  }

  /** Drops only expired tombstones. */
  clear(): void {
    for (const entry of this.#completed.values()) this.#release?.(entry.peerKey);
    this.#completed.clear();
    this.#rejected.clear();
  }

  /** Purges expired tombstones under the endpoint resource owner. */
  purge(now = Date.now()): void {
    this.#purge(now);
  }

  #purge(now: number): void {
    for (const [key, entry] of this.#completed) {
      if (now - entry.at >= this.#ttlMs) {
        this.#completed.delete(key);
        this.#release?.(entry.peerKey);
      }
    }
    for (const [key, expiresAt] of this.#rejected) if (expiresAt <= now) this.#rejected.delete(key);
  }
}
