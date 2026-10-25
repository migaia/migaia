/**
 * Defines the native connection facts, cancellation admission and batch-write guards borrowed by
 * Process features. Facts come from actual Process installation and codec boundaries.
 */
import type { IRpcFeatureContext } from '@migaia/rpc-contract/interfaces'
import type { IpcFlowControl, IRpcFlowControlFeature } from './flow-control.js'

/**
 * Concrete process installation supplies only original connection facts and an optional shared
 * flow.
 */
export type IProcessFeatureContext = IRpcFeatureContext &
  Readonly<{
    connectionId: string
    sessionId?: string
    flow?: Readonly<{ feature: IRpcFlowControlFeature; value: IpcFlowControl }>
  }>
/** Physical admission facts originate in the admitted process codec, never opaque wire inspection. */
export type IIpcSendFacts = Readonly<{ sendClass: 'data' | 'control'; trace?: string }>
/** Original operation cancellation is borrowed until actual native preparation starts. */
export type IIpcSendAdmission = Readonly<{
  signal?: import('@migaia/utils/promise').IAbortSignal
  assertCanSend?(): void
  coalesced?: boolean
}>
/** A batch producer removes only its own still-queued logical member on physical queue shutdown. */
export type IIpcBatchGuard = (cancelQueued?: (reason: unknown) => void) => (() => void) | undefined
/** Whole logical writes settle only at their original physical flush, including explicit batching. */
export type IIpcWrite = (guard?: IIpcBatchGuard) => void | Promise<void>
