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
