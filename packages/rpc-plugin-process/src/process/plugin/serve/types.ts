/**
 * Defines the native serve policy, fallback lifecycle and returned member-control ports. These
 * contracts borrow accepted Session resources without exposing a per-peer RPC facade.
 */
import type { IScheduler } from '@migaia/utils/scheduler'
import type { IProcessFeature } from '../types.js'
import type { ProcessConnectionCapacity } from './admission.js'
import type { IRpcNativeMemberControls } from '@migaia/rpc-host/sdk'

/** Actual native fallback keeps recovery and its session registration in its existing owner. */
export type IProcessServeFallback = Readonly<{
  version: number
  ready(): Promise<void>
  add(session: Readonly<{ connectionId: string; close(): Promise<void> }>): () => void
  close(): Promise<void>
}>
/** Only concrete process behavior and native resource policy reach the serve owner. */
export type IProcessServeOptions = Readonly<{
  features?: readonly IProcessFeature[]
  maxConnections?: number
  /** Existing shared resilience scopes lend their one actual native capacity instance. */
  connections?: ProcessConnectionCapacity
  drainMs?: number
  scheduler?: IScheduler
  fallback?: IProcessServeFallback
  report?(error: unknown): void
}>
/** No endpoint, service, Peer or request facade is projected by a native serve installation. */
export type IProcessSessionsHandle = Readonly<{
  close(): Promise<void>
  closed(): boolean
  members: IRpcNativeMemberControls<'process'>
}>
