export class PeerRegistry<T extends string = string> {
  readonly #configured = new Set<T>();
  readonly #learned = new Map<T, number>();
  readonly #maxLearned: number;
  readonly #learnedTtlMs: number;

  constructor(maxLearned = 1024, learnedTtlMs = 300_000) {
    if (!Number.isSafeInteger(maxLearned) || maxLearned < 1)
      throw new TypeError('maxLearned must be a positive safe integer');
    if (!Number.isSafeInteger(learnedTtlMs) || learnedTtlMs < 1)
      throw new TypeError('learnedTtlMs must be a positive safe integer');
    this.#maxLearned = maxLearned;
    this.#learnedTtlMs = learnedTtlMs;
  }

  add(id: T, configured = false): void {
    this.#purgeLearned();
    if (configured) {
      this.#configured.add(id);
      this.#learned.delete(id);
      return;
    }
    if (this.#configured.has(id)) return;
    if (!this.#learned.has(id) && this.#learned.size >= this.#maxLearned) {
      const oldest = this.#learned.keys().next().value;
      if (oldest !== undefined) this.#learned.delete(oldest);
    }
    this.#learned.delete(id);
    this.#learned.set(id, Date.now());
  }
  snapshot(): readonly T[] {
    this.#purgeLearned();
    return [...this.#configured, ...this.#learned.keys()];
  }
  remove(id: T): void {
    this.#configured.delete(id);
    this.#learned.delete(id);
  }

  /** Removes discovery state while preserving an explicitly configured peer. */
  removeLearned(id: T): void {
    this.#learned.delete(id);
  }
  has(id: T): boolean {
    this.#purgeLearned();
    return this.#configured.has(id) || this.#learned.has(id);
  }

  /** Clears configured and learned peer state during endpoint disposal. */
  clear(): void {
    this.#configured.clear();
    this.#learned.clear();
  }
  [Symbol.iterator](): Iterator<T> {
    return this.snapshot()[Symbol.iterator]();
  }

  /** Removes learned peers whose authentication knowledge has expired. */
  #purgeLearned(): void {
    const cutoff = Date.now() - this.#learnedTtlMs;
    for (const [id, learnedAt] of this.#learned) {
      if (learnedAt <= cutoff) this.#learned.delete(id);
    }
  }
}
