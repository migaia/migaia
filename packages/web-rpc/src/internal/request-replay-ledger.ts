import { createStringLeaseRegistry, type ILeaseRegistry } from '@migaia/lifecycle';
import { tagWebRpcError, WebRpcErrorCode } from '../errors.js';

/** Non-evicting replay ledger for business requests. */
export class RequestReplayLedger {
  readonly #completed = new Map<
    string,
    {
      readonly peerKey: string;
      readonly at: number;
      /** Releases this tombstone's per-peer lease (idempotent, O(1) admission). */
      readonly releaseCount: () => void;
    }
  >();
  readonly #rejected = new Map<string, number>();
  readonly #maxEntries: number;
  readonly #maxEntriesPerPeer: number;
  readonly #ttlMs: number;
  readonly #retain?: (peerKey: string) => boolean;
  readonly #release?: (peerKey: string) => void;
  /**
   * Per-peer completed-tombstone counts, owned by `@migaia/lifecycle`'s `LeaseRegistry` so
   * `admit()`/`canAdmit()` read the count in O(1) instead of scanning `#completed` (M-T27). Each
   * admitted tombstone holds one lease; purging/clearing releases it.
   */
  readonly #peerCounts: ILeaseRegistry<string> = createStringLeaseRegistry();

  constructor(
    maxEntries = 4096,
    maxEntriesPerPeer = 1024,
    ttlMs = 310_000,
    lease?: {
      readonly retain: (peerKey: string) => boolean;
      readonly release: (peerKey: string) => void;
    }
  ) {
    if (
      ![maxEntries, maxEntriesPerPeer, ttlMs].every(Number.isSafeInteger) ||
      maxEntries < 1 ||
      maxEntriesPerPeer < 1 ||
      ttlMs < 1
    )
      throw tagWebRpcError(
        new TypeError('request replay limits must be positive safe integers'),
        WebRpcErrorCode.invalidConfig
      );
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
    const peerCount = this.#peerCounts.count(peerKey);
    if (peerCount >= this.#maxEntriesPerPeer || this.#completed.size >= this.#maxEntries) {
      if (this.#rejected.size < this.#maxEntries)
        this.#rejected.set(key, now + Math.min(this.#ttlMs, 1_000));
      return false;
    }
    if (this.#retain && !this.#retain(peerKey)) return false;
    let releaseCount: (() => void) | undefined;
    try {
      releaseCount = this.#peerCounts.retain(peerKey);
      this.#completed.set(key, { peerKey, at: now, releaseCount });
      return true;
    } catch (error) {
      releaseCount?.();
      this.#release?.(peerKey);
      throw error;
    }
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
    const peerCount = this.#peerCounts.count(peerKey);
    return peerCount < this.#maxEntriesPerPeer && this.#completed.size < this.#maxEntries;
  }

  /** Drops only expired tombstones. */
  clear(): void {
    for (const entry of this.#completed.values()) {
      entry.releaseCount();
      this.#release?.(entry.peerKey);
    }
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
        entry.releaseCount();
        this.#release?.(entry.peerKey);
      }
    }
    for (const [key, expiresAt] of this.#rejected) if (expiresAt <= now) this.#rejected.delete(key);
  }
}
