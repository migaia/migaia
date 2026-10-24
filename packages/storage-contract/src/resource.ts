/** A resource owner exposes explicit and symbolic asynchronous cleanup of one actual lifetime. */
export type IStorageResource = {
  /** Returns the cached main cleanup Promise; cleanup failure rejects with its original cause. */
  dispose(): Promise<void>
  /** Returns a separately cached Promise that reports cleanup failure and resolves. */
  [Symbol.asyncDispose](): Promise<void>
}

/** A live storage iterator closes through the same cleanup path as return and natural completion. */
export type IStorageIterator<T> = AsyncIterableIterator<T> & IStorageResource

/** Shared backend-author lifetime; transaction registration retains scope and error authority. */
export type IStorageIteratorLifetime<T> = {
  readonly isClosing: () => boolean
  readonly advance: (run: () => Promise<IteratorResult<T>>) => Promise<IteratorResult<T>>
  readonly dispose: () => Promise<void>
  readonly returned: (value?: unknown) => Promise<IteratorResult<T>>
  readonly symbolic: () => Promise<void>
}

/** Original native resource callbacks; the supplied owner retains error normalization authority. */
export type IStorageIteratorLifetimeOptions = {
  readonly close: () => Promise<void>
  readonly report: (error: unknown) => void | PromiseLike<void>
  readonly onSettled?: () => void
}

/** Owns the existing accepted-advance drain and cached cleanup paths for one original resource. */
class StorageIteratorLifetime<T> implements IStorageIteratorLifetime<T> {
  /** Native close and diagnostic callbacks remain with their original resource owner. */
  readonly #options: IStorageIteratorLifetimeOptions
  /** Accepted advances must settle before the original resource can be released. */
  readonly #advances = new Set<Promise<unknown>>()
  /** Creating this cached cleanup Promise synchronously stops data admission. */
  #main: Promise<void> | undefined
  /** Symbolic cleanup reports once through its separately cached resolving Promise. */
  #symbolic: Promise<void> | undefined
  /** Iterator return shares cleanup and retains its first completion result. */
  #returned: Promise<IteratorResult<T>> | undefined

  /** Borrows native callbacks without registering a second resource lifetime. */
  constructor(options: IStorageIteratorLifetimeOptions) {
    this.#options = options
  }

  /** Waits accepted advances before releasing the original resource exactly once. */
  #cleanup(): Promise<void> {
    if (this.#main) return this.#main
    this.#main = Promise.resolve().then(async () => {
      await Promise.allSettled(this.#advances)
      await this.#options.close()
    })
    if (this.#options.onSettled)
      void this.#main.then(
        () => this.#options.onSettled!(),
        () => this.#options.onSettled!()
      )
    return this.#main
  }

  /** Closing begins when the main cleanup Promise is first created. */
  readonly isClosing = (): boolean => this.#main !== undefined

  /** Admits the supplied original operation and drains it before any native cleanup. */
  readonly advance = (run: () => Promise<IteratorResult<T>>): Promise<IteratorResult<T>> => {
    /** Admission and transaction authority remain in the supplied original run callback. */
    const pending = run()
    this.#advances.add(pending)
    /** Remove this advance before natural-end cleanup waits for the remaining accepted work. */
    const advancement = pending.then(
      async (result) => {
        this.#advances.delete(pending)
        if (result.done) await this.#cleanup()
        return result
      },
      (error) => {
        this.#advances.delete(pending)
        throw error
      }
    )
    // Caller-visible rejection is unchanged; unawaited advances cannot leak a second rejection.
    void advancement.then(undefined, () => undefined)
    return advancement
  }

  /** Explicit cleanup returns the same main Promise on every call. */
  readonly dispose = (): Promise<void> => this.#cleanup()

  /** Iterator return shares main cleanup and caches the first requested completion value. */
  readonly returned = (value?: unknown): Promise<IteratorResult<T>> => {
    if (!this.#returned) {
      this.#returned = this.#cleanup().then(() => ({ done: true, value: value as T }))
      void this.#returned.then(undefined, () => undefined)
    }
    return this.#returned
  }

  /** Symbolic cleanup reports failure once through the original owner's diagnostic callback. */
  readonly symbolic = (): Promise<void> =>
    (this.#symbolic ??= this.#cleanup().then(undefined, (error) => this.#options.report(error)))
}

/**
 * Reuses the canonical lifetime for native and mapped readers. Accepted advances, explicit return
 * and symbolic cleanup all drain the same resource; admission and transaction registration remain
 * with the original caller.
 */
export function createStorageIteratorLifetime<T>(
  options: IStorageIteratorLifetimeOptions
): IStorageIteratorLifetime<T> {
  return new StorageIteratorLifetime<T>(options)
}
