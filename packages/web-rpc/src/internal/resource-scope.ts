export type IResourceReleaseError = { readonly resource: string; readonly error: unknown };
export type IResourceReleasePhase = 'critical' | 'application';

/** Owns heterogeneous async resources and releases them in reverse registration order. */
export class ResourceScope {
  readonly #resources: Array<{
    name: string;
    release: () => void | Promise<void>;
    phase: IResourceReleasePhase;
  }> = [];
  #released = false;
  #releasePromise: Promise<readonly IResourceReleaseError[]> | undefined;

  /** Returns the number of release records retained by this scope. */
  get size(): number {
    return this.#resources.length;
  }

  /** Registers one resource and returns an idempotent unregister function. */
  add(
    name: string,
    release: () => void | Promise<void>,
    phase: IResourceReleasePhase = 'application'
  ): () => void {
    if (this.#released) throw new Error('ResourceScope is already released');
    let active = true;
    this.#resources.push({
      name,
      phase,
      release: () => {
        if (active) {
          active = false;
          return release();
        }
      }
    });
    return () => {
      active = false;
    };
  }

  /** Releases every resource, continuing after failures and preserving order. */
  releaseAll(): Promise<readonly IResourceReleaseError[]> {
    if (this.#releasePromise) return this.#releasePromise;
    this.#released = true;
    this.#releasePromise = (async () => {
      const errors: IResourceReleaseError[] = [];
      for (const phase of ['critical', 'application'] as const) {
        for (const resource of this.#resources.filter((entry) => entry.phase === phase).reverse()) {
          try {
            const result = resource.release();
            if (result && typeof (result as Promise<void>).then === 'function') await result;
          } catch (error) {
            errors.push({ resource: resource.name, error });
          }
        }
      }
      this.#resources.length = 0;
      return errors;
    })();
    return this.#releasePromise;
  }
}
