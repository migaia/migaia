/** Provider data and narrow owner ports; no Session facade or optional policy implementation. */
import type { IAbortSignal, INativeAbortSignal } from '@migaia/utils/promise'
import type {
  IRpcCompletion,
  IRpcEnvelope,
  IRpcGeneration,
  IRpcMethodDescription,
  IRpcPortableValue,
  IRpcStep,
  IRpcCallOptions,
  IRpcRoute
} from '@migaia/rpc-contract/protocol'
import type {
  IRpcCarrierWriteOptions,
  IRpcFlowContext,
  IRpcObservation,
  IRpcTargetSource
} from '@migaia/rpc-contract/interfaces'
import type { IRpcPipelineOwner } from '../sdk/flow-pipelines.js'
import type {
  IRpcProviderDeclaration,
  IRpcProviderMethodDeclaration
} from '@migaia/rpc-contract/protocol'

/** Existing explicit provider replies retain their public shape and original transfer list. */
export type IRpcProviderResult =
  | Readonly<{ ok: true; data?: unknown; transfer?: readonly unknown[] }>
  | Readonly<{ ok: false; message: string; code: string }>

/** One actual business invocation; cancellation and context expiry share its original lifetime. */
export type IRpcContext = Readonly<{
  localEndpointId: string
  /** Actual local carrier identity isolates connection-owned resources. */
  connectionId?: string
  /** Native authentication borrows its original session identity; ordinary sources use the carrier. */
  sessionId?: string
  /** Only an explicit verified Auth principal is exposed to business providers. */
  principalId?: string
  callerGeneration?: IRpcGeneration
  targetGeneration?: IRpcGeneration
  data: unknown
  signal: INativeAbortSignal
  senderId: string
  timeoutMs?: number
  route?: readonly string[]
  trace?: string
  success(data?: unknown, options?: Readonly<{ transfer?: readonly unknown[] }>): IRpcProviderResult
  failed(message: string, code: string): IRpcProviderResult
  dispatchTo(input: Readonly<{ id?: string; method: string; data: unknown }>): void
}>

/** Legacy explicit context providers keep their type while object methods receive payload first. */
export type IRpcProvider = (
  context: IRpcContext
) => IRpcProviderResult | Promise<IRpcProviderResult>
/** A captured method keeps its original receiver and gets one context for its actual execution. */
export type IRpcProviderMethod = (payload: any, context: IRpcContext) => unknown
/** Only own data members enter the recursive provider whitelist. */
export type IRpcProvide = Readonly<{ [name: string]: IRpcProviderMethod | IRpcProvide }>

/** Public advanced declarations narrow the same single compiled whitelist. */
export type IRpcProvideOptions = Readonly<{ contract?: IRpcProviderDeclaration }>
/** Local Feature installation metadata belongs to its exact original callable. */
export type IProviderCommitGate = Readonly<{
  isOpen(): boolean
  /** Only the original native lifecycle can authorize joining rejected pre-commit work. */
  isFailed(): boolean
  wait(signal: IAbortSignal): Promise<void>
}>
/** Guard consumers need only the actual origin and already admitted forward path. */
export type IProviderPreflight = (route: Pick<IRpcRoute, 'senderId' | 'forwardRoute'>) => void
/** Compact selected address, never a retained mutable Session or per-peer call facade. */
export type IProviderTarget = import('../call/types.js').ICallTargetRef
/** Captured forward metadata uses the same compiler as local own-data methods. */
export type IProviderForwardEntry = Readonly<{
  kind: 'forward'
  name: string
  method: string
  namespace: string
  targetName: string
  held?: IProviderTarget
  description?: IRpcMethodDescription
  /** Native exposure borrows its original install gate after callable metadata is compiled. */
  commitGate?: IProviderCommitGate
  supportedModes: IRpcMethodDescription['supportedModes']
  declaration?: IRpcProviderMethodDeclaration
}>
/** Local receiver identity is captured once and does not follow later property mutation. */
export type IProviderLocalEntry = Readonly<{
  kind?: 'local'
  name: string
  method: IRpcProviderMethod
  receiver: object
  supportedModes?: IRpcMethodDescription['supportedModes']
  declaration?: IRpcProviderMethodDeclaration
}>
/** One canonical catalog contains both local and explicitly held transparent forwards. */
export type IProviderMethodEntry = IProviderLocalEntry | IProviderForwardEntry
/** Global host identity and accepted generation come from the root owner. */
export type IProviderSelf = Readonly<{
  instanceId: string
  generation: IRpcGeneration
  applicationVersion: string
}>
/** Forward execution remains in Forwarder rather than capturing a namespace facade per provider. */
export type IProviderForwardPort = Readonly<{
  /** Refused forward mode admission has no invocation from which to emit its owner observations. */
  reject?(source: IRpcFlowContext, envelope: IRpcEnvelope, error: unknown): void
  resolveEntry(
    namespace: string,
    method: string,
    source?: IRpcFlowContext,
    envelope?: IRpcEnvelope
  ): IProviderForwardEntry | undefined
  invoke(
    entry: IProviderForwardEntry,
    context: IRpcContext,
    source: IRpcFlowContext,
    mode?: 'request' | 'notify',
    options?: IRpcCallOptions,
    envelope?: IRpcEnvelope
  ): Promise<unknown>
  group(
    entries: readonly IProviderForwardEntry[],
    steps: readonly IRpcStep[],
    context: IRpcContext,
    source: IRpcFlowContext,
    options?: IRpcCallOptions,
    envelope?: IRpcEnvelope
  ): Promise<IRpcPortableValue>
  stream(
    entry: IProviderForwardEntry,
    context: IRpcContext,
    source: IRpcFlowContext,
    options?: IRpcCallOptions,
    envelope?: IRpcEnvelope
  ): AsyncIterable<IRpcPortableValue>
}>
/** The original stream owner retains producer completion until next/return/write work settles. */
export type IProviderStreamPort = Readonly<{
  prepare(iterable: AsyncIterable<IRpcPortableValue>): Promise<void>
  provide(
    source: IRpcFlowContext,
    envelope: IRpcEnvelope,
    iterable: AsyncIterable<IRpcPortableValue> | Iterable<IRpcPortableValue>,
    signal: IAbortSignal,
    complete: (completion: IRpcCompletion) => void,
    targetSource?: IRpcTargetSource,
    /** The actual retained completion carries terminal classification, never cancellation intent. */
    completion?: IRpcCompletion
  ): Promise<void>
}>
/** Root supplies actual IO/flow/namespace ports without optional plugin capabilities. */
export type IProviderDispatcherOptions = Readonly<{
  calls: Pick<import('../call/table.js').CallTable, 'invoke'>
  self(): IProviderSelf
  send(
    carrierId: string,
    envelope: IRpcEnvelope,
    options?: IRpcCarrierWriteOptions,
    source?: IRpcTargetSource
  ): Promise<void>
  /** The provider terminal runs inside this Host's genuine dispatchInbound pipeline. */
  pipelines(): IRpcPipelineOwner
  notify(
    namespace: string,
    input: Readonly<{ id?: string; method: string; data: unknown }>,
    signal: IAbortSignal,
    excludePeerId?: string
  ): Promise<void>
  forward: IProviderForwardPort
  streams: IProviderStreamPort
  /** Count the original business/response terminal once, including producer cleanup. */
  track?<T>(carrierId: string, promise: Promise<T>): Promise<T>
  /** Readonly facts join the same actual flow observer without granting execution authority. */
  observe?(event: IRpcObservation): void
  report(error: unknown): void
  now?(): number
}>
