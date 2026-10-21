// Store shape contracts and runtime narrowing guards belong to `@migaia/storage-contract`. Re-exports preserve existing import paths.
export type {
  IKeyValueStore,
  ISyncKeyValueStore,
  IRecordStore,
  ISyncCapableStore
} from '@migaia/storage-contract'
export { isKeyValueStore, asRecordStore, isRecordStore } from '@migaia/storage-contract'

/**
 * Matches the DOM `Storage` structure without referencing the global type. The global type requires
 * the DOM library, while this package also supports Worker consumers using `WebWorker` without DOM.
 * Even a consumer importing only `indexedDbHost` causes TypeScript to check the barrel's
 * declaration graph. A direct `Storage` reference would therefore fail to resolve in a Worker
 * compilation. This web backend structure belongs to storage-web rather than
 * `@migaia/storage-contract`.
 */
export type IWebStorageLike = {
  /** Current native physical entry count, including other namespaces. */
  readonly length: number
  /** Read one physical text key, returning null when absent. */
  getItem(key: string): string | null
  /** Write one physical text value; native quota/access errors may throw. */
  setItem(key: string, value: string): void
  /** Remove one physical key without touching other entries. */
  removeItem(key: string): void
  /**
   * Clear the physical storage; storage-web namespace clearing enumerates only its own keys
   * instead.
   */
  clear(): void
  /** Read the physical key at a native enumeration index, or null when absent. */
  key(index: number): string | null
}
