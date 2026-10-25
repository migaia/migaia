/**
 * Defines the fixed RPC flow intervention points and immutable observation surface. The host
 * compiles order once; optional plugins own their own callbacks, state, and cleanup.
 */
import type { IAbortSignal } from '@migaia/utils/promise'
import type { IRpcProbeDescriptor } from './observation.js'
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
  /** Outbound frame plugins retain each member's actual physical write facts until handoff. */
  write?: IRpcFrameWriteOptions
  /** Uncorrelated hook and cleanup failures remain observable. */
  report(error: unknown): void
}>

/** Only frame transformations can replace local physical options; these never enter the wire. */
export type IRpcFrameWriteOptions = Pick<IRpcCarrierWriteOptions, 'sendClass' | 'trace'> &
  Readonly<{
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

/** Frame continuations preserve actual write completion and local options through transformations. */
export type IRpcFrameNext = (
  frame: IRpcCarrierFrame,
  write?: IRpcFrameWriteOptions
) => Promise<void>

/** An admitted duplicate ends locally without executing or sending another physical terminal. */
export const RpcDispatchDrop = Object.freeze({ kind: 'drop' } as const)

/** Dispatch may expose a scalar/stream terminal or quietly finish an admitted duplicate. */
export type IRpcDispatchOutcome = Readonly<
  | { kind: 'value'; value?: IRpcPortableValue; transfer?: readonly ArrayBuffer[] }
  | { kind: 'stream'; value: AsyncIterable<IRpcPortableValue> }
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

/** Only these intervention points may be registered before host startup. */
export type IRpcFlowHooks = Readonly<{
  /** Outbound and inbound handshake values use context.direction to select plugin behavior. */
  handshake?: (
    value: IRpcHandshake,
    context: IRpcFlowContext
  ) => IRpcHandshake | Promise<IRpcHandshake>
  /** Authentication and schema hooks see prepared metadata outside physical codec operations. */
  envelope?: Readonly<{
    /** Runs after carrier.prepare and before carrier.encode. */
    outbound?: (
      value: IRpcPreparedMessage,
      context: IRpcEnvelopeContext
    ) => IRpcPreparedMessage | Promise<IRpcPreparedMessage>
    /** Runs after carrier.decode and before carrier.restore. */
    inbound?: (
      value: IRpcPreparedMessage,
      context: IRpcEnvelopeContext
    ) => IRpcPreparedMessage | Promise<IRpcPreparedMessage>
  }>
  /** Chunk and batch hooks may emit zero or several frames through the ordered continuation. */
  frame?: Readonly<{
    /** Settles only when all frames for this input are written or rejected. */
    outbound?: (
      value: IRpcCarrierFrame,
      context: IRpcFlowContext,
      next: IRpcFrameNext
    ) => Promise<void>
    /** Calls next for each complete admitted inner frame in carrier order. */
    inbound?: (
      value: IRpcCarrierFrame,
      context: IRpcFlowContext,
      next: IRpcFrameNext
    ) => Promise<void>
  }>
  /** An installed plugin can reject, replay, or surround actual provider execution. */
  dispatch?: Readonly<{
    /** Invoke next at most once; completion remains owned by ProviderDispatcher. */
    inbound: (
      context: IRpcDispatchContext,
      next: () => Promise<IRpcDispatchOutcome>
    ) => Promise<IRpcDispatchOutcome>
  }>
  /** Observer failures are reported; readonly observation cannot alter the message flow. */
  observe?: (event: IRpcObservation) => void
}>

/** Flow registration carries complete behavior and optional explicit namespace scope. */
export type IRpcFlowPluginDefinition = Readonly<{
  /** Actual installed ownership supplies these cold readonly facts, never decoded messages. */
  observationFacts?: Readonly<Pick<IRpcProbeDescriptor, 'authentication'>>
  /** Native plugin name determines dependency and installation ordering. */
  name: string
  /** Omission covers the host; a supplied list restricts every declared hook. */
  namespaces?: readonly string[]
  /** Frame extension names actually implemented by this plugin, proposed during handshake. */
  extensions?: readonly string[]
  /** An unavailable required extension rejects handshake; optional absence does not. */
  requiredExtensions?: readonly string[]
  /** Only fixed host-owned stages can be registered during installation. */
  hooks: IRpcFlowHooks
}>
