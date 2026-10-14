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
  readonly length: number
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
  clear(): void
  key(index: number): string | null
}
