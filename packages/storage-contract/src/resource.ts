/** A resource owner exposes explicit and symbolic asynchronous cleanup of one actual lifetime. */
export type IStorageResource = {
  /** Returns the cached main cleanup Promise; cleanup failure rejects with its original cause. */
  dispose(): Promise<void>
  /** Returns a separately cached Promise that reports cleanup failure and resolves. */
  [Symbol.asyncDispose](): Promise<void>
}

/** A live storage iterator closes through the same cleanup path as return and natural completion. */
export type IStorageIterator<T> = AsyncIterableIterator<T> & IStorageResource

/** Internal shared lifetime; transaction registration retains all scope and error authority. */
export type IStorageIteratorLifetime<T> = {
  readonly isClosing: () => boolean
  readonly advance: (run: () => Promise<IteratorResult<T>>) => Promise<IteratorResult<T>>
  readonly dispose: () => Promise<void>
  readonly returned: (value?: unknown) => Promise<IteratorResult<T>>
  readonly symbolic: () => Promise<void>
}

/**
 * Owns the existing iterator drain and cached cleanup paths. Both native transaction iterators and
 * mapped root readers submit their complete accepted advance here; neither creates another queue or
 * lifecycle implementation. Error normalization and reporting remain with the original caller. This
 * helper is internal and is not exported from the package entry.
 */
export function createStorageIteratorLifetime<T>(options: {
  readonly close: () => Promise<void>
  readonly report: (error: unknown) => void | PromiseLike<void>
  readonly onSettled?: () => void
}): IStorageIteratorLifetime<T> {
  /** Accepted advances finish before the original native resource can be released. */
  const advances = new Set<Promise<unknown>>()
  /** Creating the main cleanup Promise synchronously stops further data admission. */
  let main: Promise<void> | undefined
  /** Symbolic cleanup reports once through a separately cached successful Promise. */
  let symbolic: Promise<void> | undefined
  /** Iterator return shares cleanup and caches its first result. */
  let returned: Promise<IteratorResult<T>> | undefined
  /** One cleanup waits the accepted advances and then releases the original resource once. */
  function cleanup(): Promise<void> {
    if (main) return main
    main = Promise.resolve().then(async () => {
      await Promise.allSettled(advances)
      await options.close()
    })
    if (options.onSettled) void main.then(options.onSettled, options.onSettled)
    return main
  }
  return {
    isClosing: () => main !== undefined,
    advance: (run) => {
      /** Admission and original operation authority remain in the supplied original run callback. */
      const pending = run()
      advances.add(pending)
      /** Completion removes only this accepted advance before natural-end cleanup can wait. */
      const advancement = pending.then(
        async (result) => {
          advances.delete(pending)
          if (result.done) await cleanup()
          return result
        },
        (error) => {
          advances.delete(pending)
          throw error
        }
      )
      // The returned rejection remains observable while an unawaited advance cannot leak globally.
      void advancement.then(undefined, () => undefined)
      return advancement
    },
    dispose: cleanup,
    returned: (value) => {
      if (!returned) {
        returned = cleanup().then(() => ({ done: true, value: value as T }))
        void returned.then(undefined, () => undefined)
      }
      return returned
    },
    symbolic: () => (symbolic ??= cleanup().then(undefined, options.report))
  }
}
