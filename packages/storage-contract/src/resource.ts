/** A resource owner exposes explicit and symbolic asynchronous cleanup of one actual lifetime. */
export type IStorageResource = {
  /** Returns the cached main cleanup Promise; cleanup failure rejects with its original cause. */
  dispose(): Promise<void>
  /** Returns a separately cached Promise that reports cleanup failure and resolves. */
  [Symbol.asyncDispose](): Promise<void>
}

/** A live storage iterator closes through the same cleanup path as return and natural completion. */
export type IStorageIterator<T> = AsyncIterableIterator<T> & IStorageResource
