/** Stable capability admission method names also resolve the overlapping KV has operation. */
export const StorageCapabilityMethod = {
  use: 'use',
  has: 'has',
  removeByPrefix: 'removeByPrefix'
} as const

/** TTL point operations bind to the existing physical channel owner in both root and transaction. */
export const STORAGE_TTL_METHODS = ['expire', 'remaining', 'persist'] as const
/** A counter is one atomic text update, without independent read/write endpoints. */
export const STORAGE_COUNTER_METHODS = ['increment'] as const

/** Native text batch endpoints share the same public and transaction capability shape. */
export const STORAGE_BATCH_METHODS = [
  'getMany',
  'setMany',
  'removeMany',
  StorageCapabilityMethod.removeByPrefix
] as const

/** Ordinary raw KV remains the original seven-method base, independent of native batch support. */
export const STORAGE_KEY_VALUE_BASE_METHODS = [
  'get',
  'set',
  'remove',
  StorageCapabilityMethod.has,
  'keys',
  'clearValues',
  'clearAll'
] as const

/** A published standard KV capability promises the complete native batch surface too. */
export const STORAGE_KEY_VALUE_METHODS = [
  ...STORAGE_KEY_VALUE_BASE_METHODS,
  ...STORAGE_BATCH_METHODS
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
  ...STORAGE_BATCH_METHODS
] as const

/** Object capabilities retain their own independent string-key and resource API. */
export const STORAGE_BLOB_METHODS = [
  'put',
  'get',
  'head',
  'remove',
  'list',
  'removeByPrefix'
] as const
/** Durable feeds expose replay and a separately disposable tail without a transaction projection. */
export const STORAGE_DURABLE_CHANGE_METHODS = ['readChanges', 'tailChanges'] as const
