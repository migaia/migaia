import { type IStorageKey } from './context.ts'

/** One native batch position retains canonical identity and its first equivalent input position. */
export type IStorageBatchKey = {
  readonly key: IStorageKey
  readonly identity: string
  readonly firstIndex: number
}

/** Native authors choose capture across awaits or projection within one synchronous terminal. */
export type IStorageBatchKeyCapture = (key: IStorageKey) => IStorageBatchKey

/** Pure prefix projection supports native lower-bound cursors and canonical encoded range lookup. */
export type IStorageKeyPrefix = {
  readonly key: IStorageKey
  readonly lower: Uint8Array
  readonly upper: Uint8Array
  matches(key: IStorageKey): boolean
}
