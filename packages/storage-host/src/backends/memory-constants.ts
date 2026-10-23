import type { IStorageChannel } from '../errors.js'

/** Stable memory endpoint names bind real operations to the original host execution list. */
export const MemoryOperation = {
  get: 'get',
  set: 'set',
  remove: 'remove',
  has: 'has',
  keys: 'keys',
  clearValues: 'clearValues',
  getBytes: 'getBytes',
  setBytes: 'setBytes',
  removeBytes: 'removeBytes',
  clearBytes: 'clearBytes',
  getRecord: 'getRecord',
  putRecord: 'putRecord',
  deleteRecord: 'deleteRecord',
  clearRecords: 'clearRecords',
  iterateRecords: 'iterateRecords',
  clearAll: 'clearAll',
  transaction: 'transaction',
  /** Authentic expired views retain the historical scope operation in their cached failure. */
  transactionScope: 'transaction.scope',
  inspectLocks: 'inspectLocks',
  getMany: 'getMany',
  setMany: 'setMany',
  removeMany: 'removeMany',
  removeByPrefix: 'removeByPrefix',
  recordRemoveByPrefix: 'records.removeByPrefix'
} as const

/** Physical memory identity and diagnostic names remain private to this native backend. */
export const MemoryState = {
  defaultNamespace: 'default',
  querySource: 'memory',
  channels: ['value', 'bytes', 'record'] as const,
  identity: (channel: IStorageChannel, encoded: string): string => `${channel}:${encoded}`,
  ownerLabel: (runtime: string | undefined, pid: number | undefined): string =>
    runtime === undefined ? 'browser' : `${runtime}:${pid}`
} as const
