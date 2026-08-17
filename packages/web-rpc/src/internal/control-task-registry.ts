import { RequestReplayLedger } from './request-replay-ledger.js';

/** Owns control-frame replay, admission and unordered abort state. */
export class ControlTaskRegistry {
  readonly #replay: RequestReplayLedger;
  readonly #pendingAborts = new Map<string, number>();
  readonly #maxPendingAborts = 4096;
  readonly #variationAdmissions = new Map<string, { count: number; at: number }>();
  readonly #maxVariationAdmissionsPerPeer = 128;
  readonly #maxVariationAdmissions = 4096;
  readonly #variationAdmissionWindowMs = 60_000;
  #variationAdmissionTotal = 0;
  #variationAdmissionWindowStartedAt = 0;

  constructor(lease?: {
    readonly retain: (peerKey: string) => void;
    readonly release: (peerKey: string) => void;
  }) {
    this.#replay = new RequestReplayLedger(1024, 256, 310_000, lease);
  }

  /** Rejects duplicate or over-budget control frames. */
  admit(key: string, now = Date.now()): boolean {
    this.#purge(now);
    return this.#replay.admit(key, 'control', now);
  }

  /** Atomically rejects duplicates before consuming variation admission budget. */
  admitControl(peerKey: string, key: string, now = Date.now()): boolean {
    this.#purge(now);
    if (!this.#replay.canAdmit(key, peerKey, now)) return false;
    if (!this.admitVariation(peerKey, now)) return false;
    return this.#replay.admit(key, peerKey, now);
  }

  /** Stores an abort that arrived before its request, within a hard cap. */
  rememberAbort(key: string, expiresAt: number, now = Date.now()): boolean {
    this.#purge(now);
    if (this.#pendingAborts.has(key)) return true;
    if (this.#pendingAborts.size >= this.#maxPendingAborts) return false;
    this.#pendingAborts.set(key, expiresAt);
    return true;
  }

  /** Consumes a pending abort only while it remains live. */
  consumeAbort(key: string, now = Date.now()): boolean {
    this.#purge(now);
    const expiresAt = this.#pendingAborts.get(key);
    if (expiresAt === undefined) return false;
    this.#pendingAborts.delete(key);
    return true;
  }

  /** Admits unique variations with independent global and per-peer budgets. */
  admitVariation(peerKey: string, now = Date.now()): boolean {
    if (now - this.#variationAdmissionWindowStartedAt >= this.#variationAdmissionWindowMs) {
      this.#variationAdmissions.clear();
      this.#variationAdmissionTotal = 0;
      this.#variationAdmissionWindowStartedAt = now;
    }
    if (this.#variationAdmissionTotal >= this.#maxVariationAdmissions) return false;
    const current = this.#variationAdmissions.get(peerKey);
    if (!current || now - current.at >= this.#variationAdmissionWindowMs) {
      this.#variationAdmissions.set(peerKey, { count: 1, at: now });
      this.#variationAdmissionTotal += 1;
      return true;
    }
    if (current.count >= this.#maxVariationAdmissionsPerPeer) return false;
    current.count += 1;
    this.#variationAdmissionTotal += 1;
    return true;
  }

  /** Releases all control state during endpoint disposal. */
  clear(): void {
    this.#replay.clear();
    this.#pendingAborts.clear();
    this.#variationAdmissions.clear();
    this.#variationAdmissionTotal = 0;
  }

  /** Purges replay and pending-abort TTL state under the endpoint resource owner. */
  purge(now = Date.now()): void {
    this.#purge(now);
    this.#replay.purge(now);
  }

  #purge(now: number): void {
    for (const [key, expiresAt] of this.#pendingAborts)
      if (expiresAt <= now) this.#pendingAborts.delete(key);
  }
}
