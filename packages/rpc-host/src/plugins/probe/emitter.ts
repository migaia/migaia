/**
 * Owns compiled probe dispatch, deterministic sampling and the reusable synchronous event view.
 * Readonly Host/native observations supply facts; callback failure isolation, capture and stage
 * subscriptions stay here without owning carrier IO or retaining business event queues.
 */
import {
  RpcProbeObservationKind,
  RpcProbeAuthentication,
  type IRpcObservation
} from '@migaia/rpc-contract/interfaces'
import { createRpcError } from '../../host/error-owner.js'
import { tagRpcError, RpcCoreErrorText } from '@migaia/rpc-contract/errors'
import { RpcCoreErrorCode } from '@migaia/rpc-contract/error-code'
import { defaultRpcReporter, reportDiagnostic } from '../../host/report.js'
import {
  RpcProbeDirection,
  RpcProbeOutcome,
  RpcProbeStage,
  RpcProbeStageName
} from './constants.js'
import { readProbeState, subscribeProbeStages, type IRpcProbeState } from './internal.js'
import { rpcProbeSampleKey } from './sample.js'
import type {
  IRpcProbe,
  IRpcProbeDescriptor,
  IRpcProbeEventView,
  IRpcProbeObservation
} from './types.js'
import { ProbeText } from './text.js'
import { captureTransferredContent } from '../../sdk/wire/probe-content.js'
/** Each installed subscriber retains compiled callbacks and its cold mask subscription. */
type ISubscriber = {
  state: IRpcProbeState
  selected: boolean
  report(error: unknown): void
  release(): void
}
/** Empty/single/multiple cells preserve the original successful dispatch representation. */
type IDispatch = ISubscriber | ISubscriber[] | undefined
/** One synchronous emission shares its preserved transfer backing across selected captures. */
type ITransferCapture = {
  /** The first successful capture replaces only this borrowed reference, never physical content. */
  value: unknown
  /** Actual transfer authority belongs to the original physical handoff. */
  transfer: readonly ArrayBuffer[]
  /** Capture remains lazy until a selected subscriber actually requests content. */
  captured: boolean
}
/** Preserve one backing lazily; later redactors observe the same reference in callback order. */
function readTransferredCapture(capture: ITransferCapture): unknown {
  if (!capture.captured) {
    capture.value = captureTransferredContent(capture.value, capture.transfer)
    capture.captured = true
  }
  return capture.value
}
/** Reject structural handles before installing even a readonly observer. */
export function validateProbes(probes: readonly IRpcProbe[]): void {
  for (const probe of probes)
    if (!readProbeState(probe))
      throw tagRpcError(
        new TypeError(RpcCoreErrorText.probeDefinitionInvalid),
        RpcCoreErrorCode.invalidConfig
      )
}
/** The native receiver and owning tests share this single actual emitter. */
export type IProbeEmitter = ProbeEmitter
/** Allocate the original fixed receiver/view without any carrier or execution facade. */
export function createProbeEmitter(
  probes: readonly IRpcProbe[],
  now: () => number,
  endpointId: string | (() => string),
  report: (error: unknown) => void = defaultRpcReporter
): IProbeEmitter {
  return new ProbeEmitter(probes, now, endpointId, report)
}
/** Own the original filtering, sampling, reusable view and callback isolation algorithm. */
class ProbeEmitter {
  /** Current stage bits are rebuilt when a genuine probe updates its subscription. */
  mask = 0

  /** Capture bits allow call sites to avoid reading content on metadata-only paths. */
  captureMask = 0

  /** Endpoint identity is the emitter's existing constructor value. */
  get endpointId(): string {
    return typeof this.#identity === 'string' ? this.#identity : this.#identity()
  }

  /** Dropped nested observations remain visible without recursively entering any subscriber. */
  droppedReentrant = 0

  /** The endpoint clock supplies timestamps without another timer or Promise. */
  readonly #now: () => number

  /** Cold records retain the private compiled state rather than reading frozen hosts at runtime. */
  readonly #subscribers: ISubscriber[] = []

  /** Numeric stages index compiled empty/single/multiple dispatch cells. */
  readonly #table: IDispatch[] = Array.from({ length: RpcProbeStageName.length }, () => undefined)

  /** One mutable view is valid only during the synchronous sink callback. */
  readonly #view: IRpcProbeEventView

  /** Monotonic local sequence includes dropped reentrant events as gaps. */
  #seq = 0

  /** A callback cannot recursively mutate the same reusable view. */
  #inSink = false

  /** Disposal makes later observations and stage-change callbacks inert. */
  #closed = false

  /** Consecutive stages share the deterministic hash of one message. */
  #lastId: string | undefined

  /** Cached key avoids repeat hashing until a different message is observed. */
  #lastKey = 0

  /** Sampling identity includes sender, matching the frozen public hash contract. */
  #lastSender: string | undefined

  /** Recomputes dispatch only during cold installation or setStages. */
  #rebuild(): void {
    if (this.#closed) return
    this.mask = 0
    this.captureMask = 0
    for (let stage = 0; stage < RpcProbeStageName.length; stage++) {
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
    senderId?: string,
    at?: number
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
    /** Common identity is written once; emit overwrites every optional field before delivery. */
    const view = this.#view
    view.seq = ++this.#seq
    view.at = at ?? this.#now()
    view.endpointId = this.endpointId
    view.stage = stage
    view.messageId = messageId === '' ? undefined : messageId
    view.method = method
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
      (stage === RpcProbeStage.message ||
        stage === RpcProbeStage.envelope ||
        stage === RpcProbeStage.forward) &&
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
  #dispatch(stage: number, content: unknown, transfer?: readonly ArrayBuffer[]): void {
    /** Stage changes replace cells, leaving the current local dispatch receipt unchanged. */
    const entry = this.#table[stage]
    if (entry === undefined) return
    /** Transfer preservation is shared per emission, while ordinary content remains borrowed. */
    const capture: ITransferCapture | undefined =
      transfer !== undefined && (this.captureMask & (1 << stage)) !== 0
        ? { value: content, transfer, captured: false }
        : undefined
    this.#inSink = true
    try {
      if (Array.isArray(entry)) {
        for (let i = 0; i < entry.length; i++)
          if (entry[i]!.selected) this.#invoke(entry[i]!, stage, content, capture)
      } else if (entry.selected) this.#invoke(entry, stage, content, capture)
    } finally {
      this.#inSink = false
      this.#view.content = undefined
      this.#view.error = undefined
      this.#view.detail = undefined
      this.#view.route = undefined
    }
  }

  /** Redacts captured references and isolates each synchronous callback failure. */
  #invoke(
    subscriber: ISubscriber,
    stage: number,
    content: unknown,
    capture?: ITransferCapture
  ): void {
    /** Private callback state is independent of host snapshots. */
    const state = subscriber.state
    this.#view.content = undefined
    if ((state.captureMask & (1 << stage)) !== 0) {
      try {
        /** Only the first selected capture preserves the backing before the actual transfer. */
        const captured = capture === undefined ? content : readTransferredCapture(capture)
        this.#view.content = state.redact
          ? state.redact(stage as RpcProbeStage, captured)
          : captured
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
      else reportDiagnostic(this.#reporter, failure)
    } catch (reporterError) {
      reportDiagnostic(this.#reporter, reporterError)
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
    if (this.#closed) return
    /** Only the actual installed protection fact can declare a protected observation stage. */
    const authentication = descriptor.authentication ?? RpcProbeAuthentication.none
    /** Generic physical stages remain supplied by the acquired Session; protection belongs here. */
    const stageMask =
      descriptor.stageMask |
      (authentication === RpcProbeAuthentication.none ? 0 : 1 << RpcProbeStage.protected)
    /** Session's existing publish fence owns once-per-carrier delivery; this emitter covers a Host. */
    const available = Object.freeze({
      ...descriptor,
      authentication,
      stageMask: stageMask & this.mask
    })
    for (let i = 0; i < this.#subscribers.length; i++) {
      /** This callback receipt is precomputed at installation. */ const subscriber =
        this.#subscribers[i]!
      if (!subscriber.state.describe) continue
      try {
        this.#observeResult(subscriber.state.describe(available), subscriber)
      } catch (error) {
        subscriber.report(error)
      }
    }
  }

  /** Revokes stage subscriptions and drops retained view references exactly once. */
  dispose(): void {
    if (this.#closed) return
    this.#closed = true
    this.mask = 0
    this.captureMask = 0
    for (let i = 0; i < this.#subscribers.length; i++) this.#subscribers[i]!.release()
    this.#table.fill(undefined)
    this.#view.content = undefined
    this.#view.error = undefined
    this.#view.detail = undefined
    this.#view.route = undefined
  }
  /** Actual host identity may adopt native launch facts before any observation is published. */
  readonly #identity: string | (() => string)
  /** Callback failures use the receiving host's existing background report boundary. */
  readonly #reporter: (error: unknown) => void
  /** Install compiled callbacks without acquiring a carrier or execution authority. */
  constructor(
    probes: readonly IRpcProbe[],
    now: () => number,
    endpointId: string | (() => string),
    report: (error: unknown) => void
  ) {
    validateProbes(probes)
    this.#now = now
    this.#identity = endpointId
    this.#reporter = report
    this.#view = {
      seq: 0,
      carrierSeq: -1,
      at: 0,
      endpointId: typeof endpointId === 'string' ? endpointId : '',
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
      hop: -1,
      maxHops: -1,
      route: undefined,
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
      /** Only genuine compiled handles supply callback identity and mutable subscription state. */
      const state = readProbeState(probes[i]!)!
      /** Stage changes rebuild this installed receiver's cold dispatch table only. */
      const subscriber: ISubscriber = {
        state,
        selected: false,
        report: (error) => this.#report(state, error),
        release: subscribeProbeStages(probes[i]!, () => this.#rebuild())
      }
      this.#subscribers.push(subscriber)
    }
    this.#rebuild()
  }
  /** Read actual observations only; filtering precedes clocks, view writes and content capture. */
  emit(input: IRpcProbeObservation): void {
    if (!this.#begin(input.stage, input.messageId, input.method, input.senderId, input.at)) return
    /** Only fixed public view fields cross into observer callbacks. */
    const view = this.#view
    view.carrierSeq = input.carrierSeq ?? -1
    view.direction = input.direction ?? RpcProbeDirection.local
    view.kind = input.kind ?? -1
    view.outcome = input.outcome ?? RpcProbeOutcome.none
    view.variation = input.variation
    view.senderId = input.senderId
    view.targetId = input.targetId
    view.receiverId = input.receiverId
    view.peerId = input.peerId
    view.trace = input.trace
    view.hop = input.hop ?? -1
    view.maxHops = input.maxHops ?? -1
    view.route = input.route
    view.sizeBytes = input.sizeBytes ?? -1
    view.chunkIndex = input.chunkIndex ?? -1
    view.chunkCount = input.chunkCount ?? -1
    view.members = input.members ?? -1
    view.durationMs = input.durationMs ?? -1
    view.rejection = input.rejection
    view.lifecycle = input.lifecycle
    view.error = input.error
    view.carrier = input.carrier
    view.detail = input.detail
    this.#dispatch(input.stage, input.content, input.transfer)
  }
  /** Canonical readonly tags carry facts only, never execution authority. */
  readonly observe = (event: IRpcObservation): void => {
    if (event.kind === RpcProbeObservationKind.event) this.emit(event.data as IRpcProbeObservation)
    else if (event.kind === RpcProbeObservationKind.descriptor)
      this.describe(event.data as IRpcProbeDescriptor)
  }
}
