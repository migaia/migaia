/** Stable capability admission method names also resolve the overlapping KV has operation. */
export const StorageCapabilityMethod = {
  use: 'use',
  has: 'has',
  removeByPrefix: 'removeByPrefix'
} as const

/** Standard key-value methods validated and published by the canonical capability provider. */
export const STORAGE_KEY_VALUE_METHODS = [
  'get',
  'set',
  'remove',
  StorageCapabilityMethod.has,
  'keys',
  'clearValues',
  'clearAll'
] as const

/** The existing synchronous channel has six methods and deliberately does not expose clearAll. */
export const SYNC_KEY_VALUE_METHODS = [
  'get',
  'set',
  'remove',
  StorageCapabilityMethod.has,
  'keys',
  'clearValues'
] as const

/** Non-method key-value members retain their original descriptor and precise static type. */
export const STORAGE_KEY_VALUE_PROPERTIES = ['sync'] as const

/** Capability-owned base members are installed together after complete provider admission. */
export const STORAGE_CAPABILITY_METHODS = [
  StorageCapabilityMethod.use,
  StorageCapabilityMethod.has
] as const

/** Complete original transaction KV projection, including native batch and prefix operations. */
export const TRANSACTION_KEY_VALUE_METHODS = [
  'get',
  'set',
  'remove',
  StorageCapabilityMethod.has,
  'getMany',
  'setMany',
  'removeMany',
  StorageCapabilityMethod.removeByPrefix
] as const
