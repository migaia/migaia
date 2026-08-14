export class ResourceCachePolicy {
  readonly #keepAliveMs: number;
  #evictionTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(keepAliveMs: number) {
    if (!Number.isFinite(keepAliveMs) || keepAliveMs < 0)
      throw new RangeError('[store] keepAliveMs must be a finite non-negative number');
    this.#keepAliveMs = keepAliveMs;
  }

  scheduleEviction(evict: () => void): void {
    this.cancelEviction();
    this.#evictionTimer = setTimeout(() => {
      this.#evictionTimer = undefined;
      evict();
    }, this.#keepAliveMs);
  }

  cancelEviction(): void {
    if (this.#evictionTimer === undefined) return;
    clearTimeout(this.#evictionTimer);
    this.#evictionTimer = undefined;
  }

  dispose(): void {
    this.cancelEviction();
  }
}
