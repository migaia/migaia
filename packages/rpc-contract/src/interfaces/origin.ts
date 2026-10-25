/** Native origin selection borrows real media; logical targets never encode or handshake. */
import type { IAbortSignal } from '@migaia/utils/promise'
import type { IRpcSemanticFrame } from '../wire/types.js'
import type {
  IRpcCarrierWriteOptions,
  IRpcPingOptions,
  IRpcSessionHandle,
  IRpcSessionView
} from './carrier.js'
import type { IRpcNativeGeneration } from './feature.js'

/** Work owners retain descriptive identity and an explicit native IO collaborator, never a Peer. */
export type IRpcSessionSelection = Readonly<{
  carrierId: string
  view: IRpcSessionView
  source?: IRpcTargetSource
  origin?: IRpcOriginSelection
}>

/** One transport-owned resource index resolves exact physical sessions across native replacement. */
export type IRpcTargetSource = Readonly<{
  current(carrierId: string): IRpcSessionSelection | undefined
  /** Borrow the exact physical Session's closing admission without another public source index. */
  canKeepalive?(carrierId: string): boolean
  send(
    carrierId: string,
    frame: IRpcSemanticFrame,
    options?: IRpcCarrierWriteOptions
  ): Promise<void>
  assertTransfer(carrierId: string, options?: object): void
  nativeGeneration(carrierId: string): IRpcNativeGeneration | undefined
  track<T>(carrierId: string, promise: Promise<T>): Promise<T>
}>

/** The scheduler retains a real member until the original operation completion settles. */
export type IRpcOriginSelection = Readonly<{
  run<T>(invoke: (selection: IRpcSessionSelection) => Promise<T>, signal?: IAbortSignal): Promise<T>
}>

/** The same physical Session handle exposes native media only to its owning transport. */
export type IRpcPrivateSession = IRpcSessionHandle &
  Readonly<{
    carrierId: string
    current(): IRpcSessionSelection | undefined
    /** The existing physical owner alone decides whether new closing keepalive work can enter. */
    canKeepalive(): boolean
    send(frame: IRpcSemanticFrame, options?: IRpcCarrierWriteOptions): Promise<void>
    assertTransfer(options?: object): void
    ping(options?: IRpcPingOptions): Promise<void>
    drain(remainingMs: number): Promise<void>
    announceDirectory(): Promise<void>
    track<T>(promise: Promise<T>): Promise<T>
  }>

/** A local logical target publishes genuine native metadata and owns no media codec or receiver. */
export type IRpcOriginBinding = Readonly<{
  id: string
  view: IRpcSessionView
  origin: IRpcOriginSelection
  source: IRpcTargetSource
  assertTransfer(options?: object): void
  closed: Promise<void>
  close(reason?: unknown): Promise<void>
  ping(options?: IRpcPingOptions): Promise<void>
  drain(remainingMs: number): Promise<void>
  announceDirectory(): Promise<void>
}>

/** Only native directory changes update this one table-visible logical projection. */
export type IRpcOriginHandle = IRpcSessionHandle &
  Readonly<{
    update(view: IRpcSessionView): void
  }>
