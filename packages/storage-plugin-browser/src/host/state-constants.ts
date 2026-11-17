import { StorageReactiveVisibility } from '@migaia/storage-host/sdk'

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

/** Rejects forged or stale consistency visibility values before adapter publication. */
export const isStorageReactiveVisibility = (
  value: unknown
): value is (typeof StorageReactiveVisibility)[keyof typeof StorageReactiveVisibility] =>
  Object.values(StorageReactiveVisibility).includes(value as never)
