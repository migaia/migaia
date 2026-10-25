/**
 * Defines pure RPC flow payloads and readonly observations. Native plugin-host owns every stage
 * convention and execution; this module creates no runner or registration state.
 */
import type { IAbortSignal } from '@migaia/utils/promise'
import type {
  IRpcCompletion,
  IRpcEnvelope,
  IRpcHandshake,
  IRpcPortableValue,
  IRpcSemanticFrame
} from '../wire/types.js'
import type {
  IRpcCarrierFrame,
  IRpcPreparedMessage,
  IRpcSessionView,
  IRpcCarrierWriteOptions
} from './carrier.js'

/** A flow context exposes accepted facts, never mutable pending/provider/session tables. */
export type IRpcFlowContext = Readonly<{
  /** Host-local namespace fixes plugin scope before looking at untrusted fields. */
  namespace: string
  /** Actual physical connection identity supplied by the held carrier. */
  carrierId: string
  /** Handshake callbacks run before an accepted session exists. */
  session?: IRpcSessionView
  /** Only the real handshake verifier writes this Session-owned authentication output slot. */
  handshakeResult?: { authentication?: Readonly<{ principalId: string }> }
  /** The actual native source reports current sole-reader ownership, never decoded peer metadata. */
  exclusive?: boolean
  /** The host determines direction; plugins cannot switch it through envelope data. */
  direction: 'outbound' | 'inbound'
  /** Shutdown or operation cancellation reaches retained plugin-owned work. */
  signal: IAbortSignal
  /** Actual Session lifetime remains authoritative when a batch removes one member's cancellation. */
  connectionSignal?: IAbortSignal
  /** Uncorrelated hook and cleanup failures remain observable. */
  report(error: unknown): void
}>

/** Only frame transformations can replace local physical options; these never enter the wire. */
export type IRpcFrameWriteOptions = Pick<
  IRpcCarrierWriteOptions,
  'sendClass' | 'trace' | 'admission'
> &
  Readonly<{
    /** Session has admitted this write into its bounded closing FIFO, outside ordinary batch lanes. */
    closing?: true
    /** False removes one logical member's signal while retaining the Session's close fence. */
    signal?: IAbortSignal | false
    /** Physical transfer authority retains the original native backing identities. */
    transfer?: readonly ArrayBuffer[]
    /** Called at the actual carrier write boundary, including each surviving batch member. */
    onWriteStart?(): void
  }>

/** Only envelope hooks borrow actual codec admission; cached restoration remains codec-owned. */
export type IRpcEnvelopeContext = IRpcFlowContext &
  Readonly<{
    /** Undefined silently filters a foreign source; auth must not commit replay state for it. */
    restore(
      prepared: IRpcPreparedMessage
    ): IRpcSemanticFrame | undefined | Promise<IRpcSemanticFrame | undefined>
  }>

/** An admitted duplicate ends locally without executing or sending another physical terminal. */
export const RpcDispatchDrop = Object.freeze({ kind: 'drop' } as const)

/** Dispatch may expose a scalar/stream terminal or quietly finish an admitted duplicate. */
export type IRpcDispatchOutcome = Readonly<
  | { kind: 'value'; value?: IRpcPortableValue; transfer?: readonly ArrayBuffer[] }
  | {
      kind: 'stream'
      value: AsyncIterable<IRpcPortableValue>
      /** Retained terminal facts reach the sole producer without changing its new signal. */
      completion?: IRpcCompletion
    }
  | typeof RpcDispatchDrop
>

/** Actual provider completion releases leases and seals idempotency after real stream termination. */
export type IRpcDispatchContext = IRpcFlowContext &
  Readonly<{
    /** Admitted call/group/outcome envelope, independent from mutable provider state. */
    envelope: IRpcEnvelope
    /** Settles at actual business terminal, including stream cleanup and cancellation. */
    completion: Promise<IRpcCompletion>
    /** Original admitted members started or handed downstream; used only for unused group credit. */
    started(): number
  }>

/** Readonly projections contain no imperative carrier/session mutation operations. */
export type IRpcObservation = Readonly<{
  /** Stable event names are declared by the probe owner and versioned with its public contract. */
  kind: string
  /** Optional host-local namespace for scope-filtered listeners. */
  namespace?: string
  /** Optional accepted direct peer instance address. */
  peerId?: string
  /** Exact physical source lets lifecycle observers own their original carrier-local resources. */
  carrierId?: string
  /** Optional correlated operation identity. */
  id?: string
  /** Observer-owned immutable event data; it never grants execution authority. */
  data?: unknown
}>

/** A handshake transformation retains the same host-owned negotiation context. */
export type IRpcHandshakePayload = Readonly<{
  handshake: IRpcHandshake
  context: IRpcFlowContext
}>

/** Metadata transformation occurs between the actual carrier preparation and restoration. */
export type IRpcEnvelopePayload = Readonly<{
  prepared: IRpcPreparedMessage
  context: IRpcEnvelopeContext
}>

/** Physical options and logical admission stay local while stages may emit several frames. */
export type IRpcFramePayload = Readonly<{
  frame: IRpcCarrierFrame
  context: IRpcFlowContext
  write?: IRpcFrameWriteOptions
}>

/**
 * One invocation owns the outcome cell. Forwarding a replacement payload retains this cell, so
 * replay and post-provider stages observe the same result without a custom next convention.
 */
export type IRpcDispatchPayload = Readonly<{
  context: IRpcDispatchContext
  outcome: { value: IRpcDispatchOutcome }
}>
