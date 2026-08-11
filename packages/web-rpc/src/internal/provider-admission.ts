/** Owns global and per-peer admission leases for provider execution. */
export class ProviderAdmissionRegistry {
  readonly #leases = new Map<string, string>();
  readonly #maxGlobal: number;
  readonly #maxPerPeer: number;

  constructor(maxGlobal = 256, maxPerPeer = 64) {
    if (![maxGlobal, maxPerPeer].every(Number.isSafeInteger) || maxGlobal < 1 || maxPerPeer < 1)
      throw new TypeError('provider admission limits must be positive safe integers');
    this.#maxGlobal = maxGlobal;
    this.#maxPerPeer = maxPerPeer;
  }

  /** Atomically reserves one task lease; duplicate keys are rejected. */
  acquire(taskKey: string, peerKey: string): boolean {
    if (this.#leases.has(taskKey)) return false;
    let peerCount = 0;
    for (const value of this.#leases.values()) if (value === peerKey) peerCount += 1;
    if (this.#leases.size >= this.#maxGlobal || peerCount >= this.#maxPerPeer) return false;
    this.#leases.set(taskKey, peerKey);
    return true;
  }

  /** Releases a task lease exactly once. */
  release(taskKey: string): void {
    this.#leases.delete(taskKey);
  }

  /** Clears all leases during endpoint disposal. */
  clear(): void {
    this.#leases.clear();
  }
}
