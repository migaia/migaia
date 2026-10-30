/** Narrow call ports retain selected identity facts without borrowing a Session or its carrier. */
import type {
  IRpcCallOptions,
  IRpcEnvelope,
  IRpcGeneration,
  IRpcPortableValue,
  IRpcStep
} from '@migaia/rpc-contract/protocol'
import type {
  IRpcCallFeatures,
  IRpcAttemptFacts,
  IRpcObservation,
  IRpcTargetSource,
  IRpcOriginSelection,
  IRpcTimeoutExecution
} from '@migaia/rpc-contract/interfaces'
import type { IAbortSignal } from '@migaia/utils/promise'
import type { FeatureScope } from '../feature/scope.ts'
import type { SessionTable } from '../session/table.ts'
import type { RpcCallIdAllocator } from './id.ts'

/** One attempt captures the exact accepted binding; later replacement cannot settle this task. */
export type ICallTargetRef = Readonly<{
  namespace: string
  carrierId: string
  peerId: string
  name: string
  generation: IRpcGeneration
  source?: IRpcTargetSource
  origin?: IRpcOriginSelection
  /** A compact held target borrows its actual native registration's complete call wall cap. */
  callTimeoutCap?: IRpcTimeoutExecution
}>

/** The host supplies its admitted identity after native bootstrap facts have been reconciled. */
export type ICallSelf = Readonly<{
  instanceId: string
  generation: IRpcGeneration
  applicationVersion: string
}>

/** Local commands contain business input only while an originating feature may repeat it. */
export type ICallCommand = Readonly<
  | { mode: 'request' | 'notify'; method: string; payload?: IRpcPortableValue }
  | { mode: 'group'; steps: readonly IRpcStep[] }
  | { mode: 'outcome'; idempotencyKey: string }
>

/** StreamChannel borrows header/id preparation while retaining its own iterator and credit state. */
export type ICallPreparationCommand =
  | ICallCommand
  | Readonly<{ mode: 'stream'; method: string; payload?: IRpcPortableValue }>

/** Preparation owns no scalar waiter and performs no physical write. */
export type IPreparedCall = Readonly<{
  target: ICallTargetRef
  envelope: IRpcEnvelope
  signal: IAbortSignal
  remainingMs?: number
  /** Admission freezes this flag before any feature or physical encode may suspend. */
  keepalive?: boolean
}>

/** Local feature/signal/transfer choices never leak into the closed wire options record. */
export type ICallLocalOptions = IRpcCallFeatures &
  IRpcCallOptions &
  Readonly<{
    signal?: IAbortSignal
    /** Only an already-closing supported Session can turn this local intent into an admitted write. */
    keepalive?: boolean
    transfer?: readonly ArrayBuffer[]
    /** Explicit caller correlation remains local until copied to the one route. */
    trace?: string
    remainingMs?: number
    forwardRoute?: readonly string[]
    /** Forward observations join the existing physical handoff, without becoming a wire option. */
    onWriteStart?: () => void
    /** Transit may apply an installed timeout but must never initiate a retry policy. */
    origin?: false
  }>

/** The Session reports handoff immediately before the real carrier.write invocation. */
export type ICallWriteOptions = Readonly<{
  signal?: IAbortSignal
  /** This is the call admission snapshot, never a wire option or a late upgrade from open work. */
  keepalive?: boolean
  transfer?: readonly ArrayBuffer[]
  onWriteStart?: () => void
}>

/** Explicit collaborators own media, feature policy, clocks and reporting outside this table. */
export type ICallTableOptions = Readonly<{
  /** Public and private sources borrow the same exact Session's existing closing admission fact. */
  canKeepalive?(carrierId: string, source?: IRpcTargetSource): boolean
  /** The original Session checks actual native transfer capability before caller option getters. */
  assertTransfer(carrierId: string, options?: object): void
  send(
    carrierId: string,
    frame: IRpcEnvelope,
    options?: ICallWriteOptions,
    source?: IRpcTargetSource
  ): void | Promise<void>
  self(): ICallSelf
  /** Readonly facts join the same actual flow observer without granting execution authority. */
  observe?(event: IRpcObservation): void
  report(error: unknown): void
  /** The canonical drain counts this exact attempt Promise without replacing its identity. */
  track?<T>(carrierId: string, promise: Promise<T>): Promise<T>
  features: Pick<FeatureScope, 'resolve' | 'executeSelected'>
  /** Attempt facts borrow accepted Session queries without granting mutation or media ownership. */
  sessions?: Pick<SessionTable, 'get' | 'getById'> &
    Readonly<{
      availability(
        ...args: Parameters<SessionTable['availability']>
      ): IRpcAttemptFacts['availability']
    }>
  now?: () => number
  timestamp?: () => number
  allocator?: RpcCallIdAllocator
}>
