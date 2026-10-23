import { RpcControl, RpcEnvelopeKind, type IRpcEnvelope } from '@migaia/rpc-contract'
import {
  RpcRuntimeKind,
  RpcRuntimeMode,
  RpcRuntimeOperation,
  type IRpcRuntimeEnvelope
} from '@migaia/rpc-contract/runtime'
import { RpcStreamEvent, type IRpcStreamPayload } from '@migaia/rpc-contract/stream'
import { hostRethrowReporter } from '@migaia/utils/promise'
import { createRpcError, RpcCoreErrorCode, tagRpcError } from '../errors.js'
import { RpcCoreErrorText } from '../error-text.js'
import {
  RpcProbeDirection,
  RpcProbeKind,
  RpcProbeOutcome,
  RpcProbeStage
} from '../probe/constants.js'
import { readProbeState, subscribeProbeStages, type IRpcProbeState } from '../probe/internal.js'
import { rpcProbeSampleKey } from '../probe/sample.js'
import type {
  IRpcProbe,
  IRpcProbeDescriptor,
  IRpcProbeEventView,
  IRpcCarrierProbe
} from '../probe/types.js'
import { IpcReporterContext } from '../plugins/reporter-context.js'

/** Runtime failure text belongs to the sole observation/report owner. */
const ProbeText = {
  failure: 'RPC probe callback failed',
  resource: 'RPC probe',
  name: 'middleware:probe'
} as const
/** One installation retains compiled callback references and its cold stage subscription. */
type ISubscriber = {
  state: IRpcProbeState
  selected: boolean
  report: (error: unknown) => void
  release: () => void
}
/** Empty/single/multiple dispatch representations are compiled only on subscription changes. */
type IDispatch = ISubscriber | ISubscriber[] | undefined
/**
 * Transport identity joins the Peer option and the endpoint plugin without altering middleware
 * selection.
 */
const installed = new WeakMap<object, ProbeEmitter>()
/** Revokes only this transport's current observer when its canonical endpoint closes. */
export function releaseInstalledProbe(transport: object, emitter: IProbeEmitter): void {
  if (installed.get(transport) === emitter) {
    installed.delete(transport)
  }
  emitter.dispose()
}

/** Reads the same emitter once during owner construction, never from an observation point. */
export function readInstalledProbe(transport: object): IProbeEmitter | undefined {
  return installed.get(transport)
}
/** Associates one existing emitter with its owned transport; release revokes only that identity. */
export function bindInstalledProbe(transport: object, emitter: IProbeEmitter): () => void {
  /** A custom endpoint cannot replace a caller's already-owned observer during construction. */
  const current = installed.get(transport)
  if (current !== undefined && current !== emitter) {
    emitter.dispose()
    throw createRpcError(RpcCoreErrorCode.capabilityConflict, RpcCoreErrorText.endpointOwnerOwned)
  }
  installed.set(transport, emitter)
  return () => {
    releaseInstalledProbe(transport, emitter)
  }
}
/** Rejects structural handles before acquiring transport or endpoint resources. */
export function validateProbes(probes: readonly IRpcProbe[]): void {
  for (let i = 0; i < probes.length; i++)
    if (!readProbeState(probes[i]!))
      throw tagRpcError(
        new TypeError(RpcCoreErrorText.probeDefinitionInvalid),
        RpcCoreErrorCode.invalidConfig
      )
}
/** Small stage methods expose positional arguments and the precomputed masks to canonical owners. */
export type IProbeEmitter = ProbeEmitter
/**
 * Builds one fixed-shape emitter; no view object or subscriber closure is allocated during
 * successful emission.
 */
export function createProbeEmitter(
  probes: readonly IRpcProbe[],
  now: () => number,
  endpointId: string
): IProbeEmitter {
  return new ProbeEmitter(probes, now, endpointId)
}

/** Owns dispatch, filtering, redaction and one reusable view for one endpoint. */
class ProbeEmitter {
  /** Borrowed original envelope exists only during one synchronous physical send; no context copy. */
  sendContext: IRpcEnvelope | IRpcRuntimeEnvelope | undefined
  /** A carrier's synchronous receive hands this sequence once to the existing physical record. */
  #inboundCarrierSeq = -1
  /** Current stage bits are rebuilt when a genuine probe updates its subscription. */
  mask = 0
  /** Capture bits allow call sites to avoid reading content on metadata-only paths. */
  captureMask = 0
  /** Peer option owns lifecycle observations; endpoint-only plugins do not advertise them. */
  peerOwned = false
  /** Authentication mode is the original Peer configuration, or the endpoint capability fact. */
  authentication: IRpcProbeDescriptor['authentication'] = 'none'
  /** The existing outbound owner supplies its actual finalized path selection. */
  fastPath = false
  /** Endpoint identity is the emitter's existing constructor value. */
  get endpointId(): string {
    return this.#view.endpointId
  }
  /** Dropped nested observations remain visible without recursively entering any subscriber. */
  droppedReentrant = 0
  /** The endpoint clock supplies timestamps without another timer or Promise. */
  readonly #now: () => number
  /** Cold records retain the private compiled state rather than reading frozen hosts at runtime. */
  readonly #subscribers: ISubscriber[] = []
  /** Numeric stages index compiled empty/single/multiple dispatch cells. */
  readonly #table: IDispatch[] = [
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined
  ]
  /** One mutable view is valid only during the synchronous sink callback. */
  readonly #view: IRpcProbeEventView
  /** Monotonic local sequence includes dropped reentrant events as gaps. */
  #seq = 0
  /** A callback cannot recursively mutate the same reusable view. */
  #inSink = false
  /** Disposal makes later observations and stage-change callbacks inert. */
  #closed = false
  /** Describe is delivered at most once after successful endpoint activation. */
  #described = false
  /** Consecutive stages share the deterministic hash of one message. */
  #lastId: string | undefined
  /** Cached key avoids repeat hashing until a different message is observed. */
  #lastKey = 0
  /** Sampling identity includes sender, matching the frozen public hash contract. */
  #lastSender: string | undefined
  /** Physical carrier adapter shares this emitter and retains no separate event view. */
  readonly #carrier: IRpcCarrierProbe

  /** Captures callbacks and subscriptions once, validating every probe before registration. */
  constructor(probes: readonly IRpcProbe[], now: () => number, endpointId: string) {
    validateProbes(probes)
    this.#now = now
    this.#view = {
      seq: 0,
      carrierSeq: -1,
      at: 0,
      endpointId,
      stage: 0,
      direction: 0,
      kind: -1,
      outcome: 0,
      messageId: undefined,
      method: undefined,
      variation: undefined,
      senderId: undefined,
      targetId: undefined,
      receiverId: undefined,
      peerId: undefined,
      trace: undefined,
      sizeBytes: -1,
      chunkIndex: -1,
      chunkCount: -1,
      members: -1,
      durationMs: -1,
      rejection: undefined,
      lifecycle: undefined,
      error: undefined,
      carrier: undefined,
      detail: undefined,
      content: undefined
    }
    for (let i = 0; i < probes.length; i++) {
      /** Each record owns one precomputed rejection reporter; it is reused by all callbacks. */
      const state = readProbeState(probes[i]!)!
      /** This record keeps mutable selection out of public probe hosts. */
      const subscriber: ISubscriber = {
        state,
        selected: false,
        report: (error) => this.#report(state, error),
        release: subscribeProbeStages(probes[i]!, () => this.#rebuild())
      }
      this.#subscribers.push(subscriber)
    }
    /** Carrier getter follows pause/resume while transport keeps the same adapter identity. */
    const capturing = (): boolean => (this.captureMask & (1 << RpcProbeStage.carrier)) !== 0
    this.#carrier = {
      get capturing() {
        return capturing()
      },
      emit: (direction, sizeBytes, carrier, detail, content) => {
        /** Dropped nested receives must not borrow a preceding control or physical frame's ordinal. */
        if (direction === RpcProbeDirection.inbound) this.#inboundCarrierSeq = -1
        /** Only an outbound synchronous send can borrow the original caller routing context. */
        const context = direction === RpcProbeDirection.outbound ? this.sendContext : undefined
        /** Both runtime and legacy envelopes already own their admitted route; no parsing is added. */
        const route =
          context === undefined
            ? undefined
            : 'route' in context
              ? context.route
              : context.data.route
        if (!this.#begin(RpcProbeStage.carrier, context?.id, undefined, route?.senderId)) return
        this.#view.direction = direction
        this.#view.senderId = route?.senderId
        this.#view.targetId = route?.targetId
        this.#view.trace = route !== undefined && 'trace' in route ? route.trace : undefined
        this.#view.sizeBytes = sizeBytes
        this.#view.carrier = carrier
        this.#view.detail = detail
        this.#dispatch(RpcProbeStage.carrier, content)
        // Publish after callbacks so dropped reentrant receives cannot consume this outer event.
        if (direction === RpcProbeDirection.inbound) this.#inboundCarrierSeq = this.#view.seq
      }
    }
    this.#rebuild()
  }
  /** Recomputes dispatch only during cold installation or setStages. */
  #rebuild(): void {
    if (this.#closed) return
    this.mask = 0
    this.captureMask = 0
    for (let stage = 0; stage < 7; stage++) {
      /** The single-subscriber representation avoids a loop on the common path. */
      let entry: IDispatch
      for (let i = 0; i < this.#subscribers.length; i++) {
        /** The state reference is installed once; host fields are never inspected here. */
        const subscriber = this.#subscribers[i]!
        if ((subscriber.state.stageMask & (1 << stage)) === 0) continue
        if (entry === undefined) entry = subscriber
        else if (Array.isArray(entry)) entry.push(subscriber)
        else entry = [entry, subscriber]
        this.mask |= 1 << stage
        this.captureMask |= subscriber.state.captureMask & (1 << stage)
      }
      this.#table[stage] = entry
    }
  }
  /** Filters before the view is written; nested calls consume only a sequence and loss count. */
  #begin(
    stage: number,
    messageId: string | undefined,
    method: string | undefined,
    senderId?: string
  ): boolean {
    if (this.#closed || (this.mask & (1 << stage)) === 0) return false
    if (this.#inSink) {
      this.#seq++
      this.droppedReentrant++
      return false
    }
    /** Dispatch shape remains stable throughout this emission even if a sink changes stages. */
    const entry = this.#table[stage]
    if (entry === undefined) return false
    /** A filtered stage returns before timestamp, view writes and content redaction. */
    let any = false
    if (Array.isArray(entry)) {
      for (let i = 0; i < entry.length; i++) {
        entry[i]!.selected = this.#select(entry[i]!, messageId, method, senderId, stage)
        any = any || entry[i]!.selected
      }
    } else {
      entry.selected = this.#select(entry, messageId, method, senderId, stage)
      any = entry.selected
    }
    if (!any) return false
    /** All optional fields are reset so another stage cannot inherit stale content or errors. */
    const view = this.#view
    view.seq = ++this.#seq
    view.carrierSeq = -1
    view.at = this.#now()
    view.stage = stage
    view.direction = RpcProbeDirection.local
    view.kind = -1
    view.outcome = RpcProbeOutcome.none
    view.messageId = messageId === '' ? undefined : messageId
    view.method = method
    view.variation = undefined
    view.senderId = undefined
    view.targetId = undefined
    view.receiverId = undefined
    view.peerId = undefined
    view.trace = undefined
    view.sizeBytes = -1
    view.chunkIndex = -1
    view.chunkCount = -1
    view.members = -1
    view.durationMs = -1
    view.rejection = undefined
    view.lifecycle = undefined
    view.error = undefined
    view.carrier = undefined
    view.detail = undefined
    view.content = undefined
    return true
  }
  /** Checks only configured filters; deterministic keys are hashed once per consecutive message. */
  #select(
    subscriber: ISubscriber,
    messageId: string | undefined,
    method: string | undefined,
    senderId: string | undefined,
    stage: number
  ): boolean {
    /** Compiled callback/filter record never depends on mutable host fields. */
    const state = subscriber.state
    if (
      state.methods !== undefined &&
      (stage === RpcProbeStage.message || stage === RpcProbeStage.envelope) &&
      method !== undefined &&
      !state.methods.has(method)
    )
      return false
    if (state.sampleThreshold !== 0xffffffff && messageId !== undefined) {
      if (this.#lastId !== messageId || this.#lastSender !== senderId) {
        this.#lastId = messageId
        this.#lastSender = senderId
        this.#lastKey = rpcProbeSampleKey(senderId ?? '', messageId)
      }
      if (this.#lastKey >= state.sampleThreshold) return false
    }
    return true
  }
  /** Calls a cold-compiled dispatch cell and retains no event-specific closure. */
  #dispatch(stage: number, content: unknown): void {
    /** Stage changes replace cells, leaving the current local dispatch receipt unchanged. */
    const entry = this.#table[stage]
    if (entry === undefined) return
    this.#inSink = true
    try {
      if (Array.isArray(entry)) {
        for (let i = 0; i < entry.length; i++)
          if (entry[i]!.selected) this.#invoke(entry[i]!, stage, content)
      } else if (entry.selected) this.#invoke(entry, stage, content)
    } finally {
      this.#inSink = false
      this.#view.content = undefined
      this.#view.error = undefined
      this.#view.detail = undefined
    }
  }
  /** Redacts captured references and isolates each synchronous callback failure. */
  #invoke(subscriber: ISubscriber, stage: number, content: unknown): void {
    /** Private callback state is independent of host snapshots. */
    const state = subscriber.state
    this.#view.content = undefined
    if ((state.captureMask & (1 << stage)) !== 0) {
      try {
        this.#view.content = state.redact ? state.redact(stage as RpcProbeStage, content) : content
        if (this.#observeResult(this.#view.content, subscriber)) {
          this.#view.content = undefined
        }
      } catch (error) {
        subscriber.report(error)
      }
    }
    try {
      this.#observeResult(state.emit(this.#view), subscriber)
    } catch (error) {
      subscriber.report(error)
    }
  }
  /** Attaches only to a callback's existing thenable; ordinary void callbacks allocate nothing. */
  #observeResult(value: unknown, subscriber: ISubscriber): boolean {
    if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return false
    /** Read then once so hostile getters remain one reported callback failure. */
    const then = (value as { then?: unknown }).then
    if (typeof then !== 'function') return false
    Reflect.apply(then, value, [undefined, subscriber.report])
    return true
  }
  /** Reports PROBE_FAILED with the original error identity reachable through cause. */
  #report(state: IRpcProbeState, error: unknown): void {
    /** Failure allocation occurs only on the report path, never for successful events. */
    const failure = createRpcError(RpcCoreErrorCode.probeFailed, ProbeText.failure, error)
    try {
      if (state.onError) state.onError(failure)
      else hostRethrowReporter(failure, IpcReporterContext)
    } catch (reporterError) {
      hostRethrowReporter(reporterError, IpcReporterContext)
    }
  }
  /** Reports transport observation/cleanup failures through every installed probe's reporter. */
  report(error: unknown): void {
    for (let i = 0; i < this.#subscribers.length; i++) this.#subscribers[i]!.report(error)
  }
  /**
   * Delivers one capability descriptor per probe, retaining the endpoint's immutable capability
   * facts.
   */
  describe(descriptor: IRpcProbeDescriptor): void {
    if (this.#closed || this.#described) return
    this.#described = true
    for (let i = 0; i < this.#subscribers.length; i++) {
      /** This callback receipt is precomputed at installation. */ const subscriber =
        this.#subscribers[i]!
      if (!subscriber.state.describe) continue
      try {
        this.#observeResult(subscriber.state.describe(descriptor), subscriber)
      } catch (error) {
        subscriber.report(error)
      }
    }
  }
  /** Records a Peer lifecycle fact with no new lifecycle state machine. */
  peer(lifecycle: string, peerId: string | undefined, error: unknown): void {
    if (!this.#begin(RpcProbeStage.peer, undefined, undefined)) return
    this.#view.kind = RpcProbeKind.lifecycle
    this.#view.lifecycle = lifecycle
    this.#view.peerId = peerId
    this.#view.error = error
    this.#dispatch(RpcProbeStage.peer, undefined)
  }
  /** Records logical progress, borrowing the original variation name and error references. */
  message(
    direction: number,
    kind: number,
    outcome: number,
    messageId: string,
    method: string | undefined,
    senderId: string | undefined,
    targetId: string | undefined,
    trace: string | undefined,
    durationMs: number,
    rejection: string | undefined,
    error: unknown,
    variation?: string
  ): void {
    if (!this.#begin(RpcProbeStage.message, messageId, method, senderId)) return
    this.#view.direction = direction
    this.#view.kind = kind
    this.#view.outcome = outcome
    this.#view.senderId = senderId
    this.#view.targetId = targetId
    this.#view.trace = trace
    this.#view.durationMs = durationMs
    this.#view.rejection = rejection
    this.#view.error = error
    this.#view.variation = variation
    this.#dispatch(RpcProbeStage.message, undefined)
  }
  /** Observes normalized envelope metadata, including variation when content capture is disabled. */
  envelope(
    direction: number,
    messageId: string,
    method: string | undefined,
    members: number,
    value: unknown,
    senderId?: string,
    trace?: string,
    carrierSeq = -1,
    variation?: string
  ): void {
    if (!this.#begin(RpcProbeStage.envelope, messageId, method, senderId)) return
    this.#view.direction = direction
    this.#view.senderId = senderId
    this.#view.trace = trace
    this.#view.carrierSeq = carrierSeq
    this.#view.members = members
    this.#view.variation = variation
    this.#dispatch(RpcProbeStage.envelope, value)
  }
  /** Observes encoded representation before framing or after reassembly. */
  encoded(
    direction: number,
    messageId: string,
    sizeBytes: number,
    value: unknown,
    method?: string,
    senderId?: string
  ): void {
    if (!this.#begin(RpcProbeStage.encoded, messageId, method, senderId)) return
    this.#view.direction = direction
    this.#view.sizeBytes = sizeBytes
    this.#view.senderId = senderId
    this.#dispatch(RpcProbeStage.encoded, value)
  }
  /** Observes one pre-protection frame without changing framing or physical ordering. */
  frame(
    direction: number,
    messageId: string,
    sizeBytes: number,
    index: number,
    count: number,
    value: unknown,
    method?: string,
    senderId?: string,
    carrierSeq = -1
  ): void {
    this.#bytes(
      RpcProbeStage.frame,
      direction,
      messageId,
      sizeBytes,
      index,
      count,
      value,
      method,
      senderId,
      carrierSeq
    )
  }
  /** Observes one protected physical frame without awaiting an additional transform. */
  protected(
    direction: number,
    messageId: string,
    sizeBytes: number,
    index: number,
    count: number,
    value: unknown,
    method?: string,
    senderId?: string,
    carrierSeq = -1
  ): void {
    this.#bytes(
      RpcProbeStage.protected,
      direction,
      messageId,
      sizeBytes,
      index,
      count,
      value,
      method,
      senderId,
      carrierSeq
    )
  }
  /** Writes only frame fields into the common reusable view. */
  #bytes(
    stage: number,
    direction: number,
    messageId: string,
    sizeBytes: number,
    index: number,
    count: number,
    value: unknown,
    method: string | undefined,
    senderId: string | undefined,
    carrierSeq: number
  ): void {
    if (!this.#begin(stage, messageId, method, senderId)) return
    this.#view.direction = direction
    this.#view.sizeBytes = sizeBytes
    this.#view.chunkIndex = index
    this.#view.chunkCount = count
    this.#view.senderId = senderId
    this.#view.carrierSeq = carrierSeq
    this.#dispatch(stage, value)
  }
  /** Returns the one transport observation adapter, never a per-send object. */
  carrier(): IRpcCarrierProbe {
    return this.#carrier
  }
  /** Consume the synchronous arrival once; the existing physical record then owns it across awaits. */
  takeInboundCarrierSeq(): number {
    /** A consumed marker cannot be reused by a later receive that emitted no carrier event. */
    const sequence = this.#inboundCarrierSeq
    this.#inboundCarrierSeq = -1
    return sequence
  }
  /** Revokes stage subscriptions and drops retained view references exactly once. */
  dispose(): void {
    if (this.#closed) return
    this.#closed = true
    this.mask = 0
    this.captureMask = 0
    this.sendContext = undefined
    this.#inboundCarrierSeq = -1
    for (let i = 0; i < this.#subscribers.length; i++) this.#subscribers[i]!.release()
    this.#table.fill(undefined)
    this.#view.content = undefined
    this.#view.error = undefined
    this.#view.detail = undefined
  }
}
/** Maps the existing legacy envelope grammar to the numeric observation vocabulary. */
export function envelopeProbeKind(value: IRpcEnvelope): number {
  if (value.kind === RpcEnvelopeKind.request)
    return value.data.route.dispatchOnly === true ? RpcProbeKind.notify : RpcProbeKind.request
  if (value.kind === RpcEnvelopeKind.response) return RpcProbeKind.response
  if (value.kind === RpcEnvelopeKind.stream) {
    /** Normalization already validated the stream payload; observation does not parse it again. */
    const event = (value.data.payload as IRpcStreamPayload).event
    if (event === RpcStreamEvent.open) return RpcProbeKind.streamOpen
    if (event === RpcStreamEvent.item) return RpcProbeKind.streamChunk
    if (event === RpcStreamEvent.cancel) return RpcProbeKind.cancel
    if (
      event === RpcStreamEvent.end ||
      event === RpcStreamEvent.fail ||
      event === RpcStreamEvent.cancelled
    )
      return RpcProbeKind.streamClose
    return RpcProbeKind.control
  }
  if (value.kind === RpcEnvelopeKind.variation && value.data.route.variation === RpcControl.abort)
    return RpcProbeKind.cancel
  return RpcProbeKind.control
}
/** Maps native task modes and operations without introducing another protocol representation. */
export function runtimeProbeKind(value: IRpcRuntimeEnvelope): number {
  if (value.kind === RpcRuntimeKind.call)
    return value.task.mode === RpcRuntimeMode.notify
      ? RpcProbeKind.notify
      : value.task.mode === RpcRuntimeMode.stream
        ? RpcProbeKind.streamOpen
        : RpcProbeKind.request
  if (value.kind === RpcRuntimeKind.outcome)
    return value.operation === RpcRuntimeOperation.lookup
      ? RpcProbeKind.request
      : RpcProbeKind.response
  if (value.kind === RpcRuntimeKind.control) {
    if (value.operation === RpcRuntimeOperation.cancel) return RpcProbeKind.cancel
    if (value.operation === RpcRuntimeOperation.terminal) return RpcProbeKind.response
    /** Stream intent/control events remain distinct from actual item and close observations. */
    const event = value.stream.event
    if (event === RpcStreamEvent.open) return RpcProbeKind.streamOpen
    if (event === RpcStreamEvent.item) return RpcProbeKind.streamChunk
    if (
      event === RpcStreamEvent.end ||
      event === RpcStreamEvent.fail ||
      event === RpcStreamEvent.cancelled
    )
      return RpcProbeKind.streamClose
    return RpcProbeKind.control
  }
  return RpcProbeKind.request
}
