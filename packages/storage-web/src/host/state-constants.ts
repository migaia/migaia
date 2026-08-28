/** Stable live-query state values shared by the computed projection and its consumers. */
export const LiveQueryStateStatus = {
  loading: 'loading',
  ready: 'ready',
  refreshing: 'refreshing',
  error: 'error',
  disposed: 'disposed'
} as const

/** Valid states emitted by the Resource-backed live-query projection. */
export type ILiveQueryStateStatus = (typeof LiveQueryStateStatus)[keyof typeof LiveQueryStateStatus]

/** Canonical consistency visibility values admitted by reactive adapter registration. */
export const StorageReactiveVisibility = {
  instance: 'instance',
  documentEventual: 'document-eventual',
  topLevelContextEventual: 'top-level-context-eventual',
  originJsVisibleEventual: 'origin-js-visible-eventual',
  originEventual: 'origin-eventual'
} as const

/** Rejects forged or stale consistency visibility values before adapter publication. */
export const isStorageReactiveVisibility = (
  value: unknown
): value is (typeof StorageReactiveVisibility)[keyof typeof StorageReactiveVisibility] =>
  Object.values(StorageReactiveVisibility).includes(value as never)
