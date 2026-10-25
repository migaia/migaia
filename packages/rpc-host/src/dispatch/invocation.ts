/**
 * Owns one admitted provider task through commit/preflight, execution, reply and actual completion.
 * Uses the supplied generation, deadline and IO ports while preserving primary failures and
 * cleanup; native acquisition and optional provider policies stay outside this invocation.
 */
import {
  RpcProbeStage,
  RpcProbeDirection,
  RpcProbeOutcome,
  RpcProbeObservationKind,
  RpcDispatchDrop,
  rpcProbeEnvelopeFacts,
  rpcProbeEnvelopeKind
} from '@migaia/rpc-contract/interfaces'
import { RpcWireCancel } from '@migaia/rpc-contract/protocol'
/**
 * Own one incoming business lifetime; notify identities survive cancellation until actual
 * completion.
 */
import { createGenerationController } from '@migaia/lifecycle'
import { deferred, type INativeAbortSignal } from '@migaia/utils/promise'
import { systemScheduler, systemWallClock, type IScheduledTask } from '@migaia/utils/scheduler'
import {
  normalizeRpcPortable,
  RpcWireKind,
  RpcCallMode,
  RpcWireStepState,
  type IRpcEnvelope,
  type IRpcCompletion,
  type IRpcStepOutcome,
  type IRpcStep,
  type IRpcCallOptions,
  type IRpcOutcomeLookupResult,
  type IRpcPortableValue
} from '@migaia/rpc-contract/protocol'
import { RpcStreamEvent } from '@migaia/rpc-contract'
import { RPC_ENDPOINT_ERROR_SOURCE, RpcCoreErrorCode } from '@migaia/rpc-contract/error-code'
import {
  RpcCoreErrorText,
  RuntimeApiErrorText,
  identifyRpcBoundaryFailure,
  safeRead
} from '@migaia/rpc-contract/errors'
import type {
  IRpcFlowContext,
  IRpcDispatchOutcome,
  IRpcTargetSource
} from '@migaia/rpc-contract/interfaces'
import {
  createRpcAbortError,
  createRpcError,
  createRpcRemoteError,
  createRpcSerializationError,
  createRpcTimeoutError,
  localRpcErrorCode
} from '../host/error-owner.js'
import {
  serializeHostWireError,
  registerLocalErrorWireSummary,
  hostErrorWireMetadata
} from '../host/error-wire-metadata.js'
import { ProviderContext } from './context.js'
import { callTarget } from '../call/target.js'
import { readProviderCommitGate, readProviderPreflight } from './catalog.js'
import { completeProviderReturn } from './return.js'
import { RpcFlowPoint } from '../sdk/flow-pipelines.js'
import type { IProviderOrderReceipt, ProviderOrdering } from './ordering.js'
import type {
  IProviderCommitGate,
  IProviderDispatcherOptions,
  IProviderMethodEntry
} from './types.js'

/** Outcome lookup has no call-only policy metadata and cannot invent cancellation options. */
const outcomeCallOptions: IRpcCallOptions = Object.freeze({})

/** Both execution routes borrow the same native installation gate after cold compilation. */
function entryGate(entry: IProviderMethodEntry): IProviderCommitGate | undefined {
  return entry.kind === 'forward' ? entry.commitGate : readProviderCommitGate(entry.method)
}

/** One admitted operation borrows only its catalog index and the root's explicit ports. */
export type IProviderInvocationInput = Readonly<{
  ports: IProviderDispatcherOptions
  source: IRpcFlowContext
  targetSource?: IRpcTargetSource
  sourceGate?: IProviderCommitGate
  envelope: Extract<
    IRpcEnvelope,
    { kind: 'call' | 'group' } | { kind: 'outcome'; operation: 'lookup' }
  >
  methods: ReadonlyMap<string, IProviderMethodEntry>
  admission?: Readonly<{ error: unknown }>
  ordering: ProviderOrdering
}>

/** The sole incoming operation owner retains native cancellation and the actual business terminal. */
export class ProviderInvocation {
  /** Immutable operation input cannot be replaced by later carrier or catalog updates. */
  readonly #input: IProviderInvocationInput
  /** Call-only policy remains the admitted object; outcome borrows the empty grammar. */
  readonly #options: IRpcCallOptions
  /** Capture just this operation's selected registrations before plugin waits or disposal. */
  readonly #methods: ReadonlyMap<string, IProviderMethodEntry>
  /** The lifecycle owner supplies stable native signal identity and parent subscription cleanup. */
  readonly #controller: ReturnType<typeof createGenerationController>
  /** One token belongs to this invocation; it is never reused for a replacement provider. */
  readonly #request: ReturnType<ReturnType<typeof createGenerationController>['begin']>
  /** Plugins observe the actual business terminal, including stream iterator cleanup. */
  readonly #completion = deferred<IRpcCompletion>()
  /** A single inherited deadline owns one scheduler task and cannot reset at each group step. */
  #timer: IScheduledTask | undefined
  /** Monotonic time is supplied by the host rather than trusted incoming sentAt. */
  readonly #now: () => number
  /** The original invocation clock measures business terminal without another timer. */
  readonly #createdAt: number
  /** An absolute local deadline is derived once from the admitted relative budget. */
  readonly #deadline: number | undefined
  /** Before-start cancellation may no longer revoke an already committed local method. */
  #started = 0
  /** Forwarded before-start intent must reach the actual final provider through its original signal. */
  readonly #forwarded: boolean
  /** Closing the carrier suppresses physical replies while business cleanup still runs. */
  #detached = false
  /** One error graph is selected after original business completion, never at mere cancel receipt. */
  #settled = false
  /** The streaming context expires only when the original iterator lifetime really settles. */
  #streamContext: ProviderContext | undefined
  /** Only an entered native gate wait may delay rollback until its original terminal is sent. */
  #waitingGate: IProviderCommitGate | undefined
  /** Only a scalar's original minted success lends explicit backings to its physical reply. */
  #transfer: readonly ArrayBuffer[] | undefined
  /** A validated order key retains one original arrival through actual business completion. */
  readonly #order: IProviderOrderReceipt | undefined

  /** Capture original cancellation, task and elapsed-budget ownership before plugin dispatch. */
  constructor(input: IProviderInvocationInput) {
    this.#input = input
    this.#options =
      input.envelope.kind === RpcWireKind.outcome ? outcomeCallOptions : input.envelope.options
    this.#methods = input.methods
    this.#forwarded = false
    for (const entry of input.methods.values()) {
      if (entry.kind === 'forward') {
        this.#forwarded = true
        break
      }
    }
    this.#now = input.ports.now ?? (() => performance.now())
    this.#createdAt = this.#now()
    this.#deadline =
      input.envelope.route.remainingMs === undefined
        ? undefined
        : this.#now() + input.envelope.route.remainingMs
    this.#controller = createGenerationController({
      parentSignal: input.source.signal,
      report: input.ports.report
    })
    this.#request = this.#controller.begin()
    if (this.#options.orderKey !== undefined) {
      this.#order = input.ordering.enqueue(this.#options.orderKey)
      this.signal.addEventListener('abort', this.#withdrawOrder, { once: true })
      if (this.signal.aborted) this.#withdrawOrder()
    }
    if (input.envelope.route.remainingMs !== undefined) {
      if (input.envelope.route.remainingMs === 0) this.cancel(createRpcTimeoutError())
      else
        this.#timer = systemScheduler.schedule(
          () => this.cancel(createRpcTimeoutError()),
          input.envelope.route.remainingMs
        )
    }
  }

  /** Stable native signal is shared with contexts and the stream producer owner. */
  get signal(): INativeAbortSignal {
    return this.#request.signal
  }
  /** This Promise settles only after actual business and stream cleanup complete. */
  get completion(): Promise<IRpcCompletion> {
    return this.#completion.promise
  }

  /** Selected methods alone cannot prove entry when a dispatch hook is still awaiting user work. */
  belongsToGate(gate: IProviderCommitGate): boolean {
    return this.#waitingGate === gate || this.#input.sourceGate === gate
  }

  /** Borrow the exact original wait; ordinary calls allocate no extra Promise or gate state. */
  #waitForGate(gate: IProviderCommitGate | undefined): Promise<void> | undefined {
    if (!gate || gate.isOpen()) return
    this.#waitingGate = gate
    return gate.wait(this.signal).then(() => {
      this.#waitingGate = undefined
    })
  }

  /** First native abort keeps its reason; before-start intent cannot abort committed local work. */
  cancel(reason?: unknown): void {
    if (
      this.#settled ||
      (this.#started > 0 && !this.#forwarded && this.#options.cancel === RpcWireCancel)
    )
      return
    this.#controller.supersede(reason)
  }

  /** Retired sources release their table entry immediately but cannot send late physical terminals. */
  retire(reason: unknown): void {
    this.#detached = true
    this.#controller.supersede(reason)
  }

  /** Run the fixed plugin chain once around the actual catalog execution. */
  async run(): Promise<void> {
    try {
      await this.#dispatch()
    } finally {
      this.#releaseOrder()
    }
  }

  /** Physical terminal delivery retains the original FIFO lease after business completion. */
  async #dispatch(): Promise<void> {
    this.#observe(RpcProbeOutcome.received)
    /** Reply-bearing failures report their original error only after the physical response settles. */
    let failed: { error: unknown } | undefined
    try {
      /** A late native source cannot enter any business stage before its own atomic commit. */
      const sourceWaiting = this.#waitForGate(this.#input.sourceGate)
      if (sourceWaiting) await sourceWaiting
      if (this.#input.admission) throw this.#input.admission.error
      /** Plugins may replay without calling next; completion still belongs to this operation. */
      /** Replay and the actual provider share one explicit result cell under native void-next. */
      const result: { value: IRpcDispatchOutcome } = { value: RpcDispatchDrop }
      await this.#input.ports
        .pipelines()
        .pipeline(RpcFlowPoint.dispatchInbound, this.#input.source.namespace)
        .run(
          {
            context: {
              ...this.#input.source,
              signal: this.signal,
              connectionSignal: this.#input.source.signal,
              envelope: this.#input.envelope,
              completion: this.completion,
              started: () => this.#started
            },
            outcome: result
          },
          async (payload) => {
            payload.outcome.value = await this.#executeOrdered()
          }
        )
      /** Omitted continuation leaves an admitted local drop, never an invented provider result. */
      const outcome = result.value
      if (outcome.kind === RpcDispatchDrop.kind) return
      if (outcome.kind === 'stream') {
        if (this.#forwarded) await this.#input.ports.streams.prepare(outcome.value)
        await this.#input.ports.streams.provide(
          this.#input.source,
          this.#input.envelope,
          outcome.value,
          this.#forwarded && this.#options.cancel === RpcWireCancel
            ? this.#input.source.signal
            : this.signal,
          (completion) => this.#finish(completion),
          this.#input.targetSource,
          outcome.completion
        )
        return
      }
      this.#transfer = outcome.transfer
      this.#finish(
        this.#cancelled() ?? {
          ok: true,
          ...(outcome.value === undefined ? {} : { result: outcome.value })
        },
        { outcome: RpcProbeOutcome.settled }
      )
    } catch (error) {
      if (this.#oneWay()) this.#input.ports.report(error)
      else failed = { error }
      this.#finish(this.#cancelled() ?? this.#failure(error), {
        outcome: RpcProbeOutcome.failed,
        error
      })
    } finally {
      this.#streamContext?.finish()
      /** The producer Promise includes iterator.return and all outstanding writes. */
      if (!this.#settled) this.#finish(this.#cancelled() ?? { ok: true })
    }
    await this.#respond()
    if (failed) this.#input.ports.report(failed.error)
    this.#waitingGate = undefined
  }

  /** Dispatch preparation runs first; only actual provider execution waits for its original turn. */
  async #executeOrdered(): Promise<IRpcDispatchOutcome> {
    try {
      if (this.#order) await this.#order.permission
      return await this.#execute()
    } catch (error) {
      /** Provider failures acquire their RPC identity before crossing the native runner boundary. */
      throw identifyRpcBoundaryFailure(
        error,
        RpcCoreErrorCode.internal,
        RpcCoreErrorText.providerFailed
      )
    }
  }

  /** Queued cancellation withdraws once; started business keeps its lease until actual completion. */
  readonly #withdrawOrder = (): void => {
    if (this.#started === 0) this.#order?.release()
  }

  /** Scalar replies and complete stream cleanup release the same original FIFO receipt once. */
  #releaseOrder(): void {
    if (!this.#order) return
    this.signal.removeEventListener('abort', this.#withdrawOrder)
    this.#order.release()
  }

  /** Execute a single local/forward route or one fail-stop group over the same selected catalog. */
  async #execute(): Promise<IRpcDispatchOutcome> {
    if (this.signal.aborted) throw this.signal.reason
    if (this.#input.envelope.kind === RpcWireKind.outcome)
      throw createRpcError(
        RpcCoreErrorCode.capabilityUnsupported,
        RpcCoreErrorText.capabilityUnsupported
      )
    /** A group returns its exact ordered success/failure/not-executed prefix without another map. */
    if (this.#input.envelope.kind === RpcWireKind.group)
      return { kind: 'value', value: await this.#group(this.#input.envelope.steps) }
    /** A single admitted call always supplies its method through the validated task shape. */
    return this.#invoke(
      { method: this.#input.envelope.task.method!, payload: this.#input.envelope.payload },
      this.#input.envelope.task.mode
    )
  }

  /** A failed group member prevents all suffix invocation, including after cancellation. */
  async #group(steps: readonly IRpcStep[]): Promise<IRpcPortableValue> {
    /** Atomic groups cannot mix local work with a forwarded operation or split direct targets. */
    const entries = steps.map((step) => {
      /** The complete whitelist is admitted before the first business member starts. */
      const entry = this.#methods.get(step.method)
      if (!entry || (entry.supportedModes && !entry.supportedModes.includes(RpcCallMode.request))) {
        /** Forwarder's own observer also covers refusals before the group can begin. */
        const error = createRpcError(
          RpcCoreErrorCode.providerNotFound,
          RuntimeApiErrorText.methodUnavailable
        )
        if (entry?.kind === 'forward')
          this.#input.ports.forward.reject?.(this.#input.source, this.#input.envelope, error)
        throw error
      }
      return entry
    })
    /** A pending native install must commit before all local guards can be checked together. */
    for (const entry of entries) {
      /** Rollback may join only an actual native wait entered by this invocation. */
      const waiting = this.#waitForGate(entryGate(entry))
      if (waiting) await waiting
      if (this.signal.aborted) throw this.signal.reason
      if (entry.kind !== 'forward')
        readProviderPreflight(entry.method)?.(this.#input.envelope.route)
    }
    /** A forwarded group stays one group on its selected downstream provider. */
    const first = entries[0]!
    if (first.kind === 'forward') {
      if (
        !entries.every(
          (entry) =>
            entry.kind === 'forward' &&
            entry.namespace === first.namespace &&
            entry.targetName === first.targetName &&
            entry.held?.carrierId === first.held?.carrierId
        )
      )
        throw createRpcError(
          RpcCoreErrorCode.contractInvalid,
          RpcCoreErrorText.runtimeGroupTargetsInvalid
        )
      /** Forwarding retains one original group context and its remaining inherited budget. */
      const context = this.#context()
      try {
        this.#begin(steps.length)
        return await this.#input.ports.forward.group(
          entries as readonly import('./types.js').IProviderForwardEntry[],
          steps,
          context.value,
          this.#input.source,
          this.#options,
          this.#input.envelope
        )
      } finally {
        context.finish()
      }
    }
    if (entries.some((entry) => entry.kind === 'forward'))
      throw createRpcError(
        RpcCoreErrorCode.contractInvalid,
        RpcCoreErrorText.runtimeGroupTargetsInvalid
      )
    /** Results grow once in input order; failed prefixes are never copied or rescanned. */
    const results: IRpcStepOutcome[] = []
    /** One flag records the first failure independently from possibly empty business results. */
    let failed = false
    for (const step of steps) {
      if (failed) {
        results.push({ state: RpcWireStepState.notExecuted })
        continue
      }
      try {
        if (this.signal.aborted) throw this.signal.reason
        /** Each member invokes the same request route and receives one expiring context. */
        const outcome = await this.#invoke(step, RpcCallMode.request)
        if (outcome.kind !== 'value')
          throw createRpcError(
            RpcCoreErrorCode.contractInvalid,
            RpcCoreErrorText.runtimeGroupTargetsInvalid
          )
        results.push({
          state: RpcWireStepState.success,
          ...(outcome.value === undefined ? {} : { result: outcome.value })
        })
      } catch (error) {
        this.#input.ports.report(error)
        failed = true
        results.push({ state: RpcWireStepState.failure, error: this.#failure(error).error })
      }
    }
    return results as unknown as IRpcPortableValue
  }

  /** Admission uses the sole compiled Map; no getter or mutable provider property is read here. */
  async #invoke(step: IRpcStep, mode: string): Promise<IRpcDispatchOutcome> {
    /** The registration snapshot retains original receiver and held-forward facts. */
    const entry = this.#methods.get(step.method)
    if (!entry || (entry.supportedModes && !entry.supportedModes.includes(mode as 'request'))) {
      /** The actual refusal remains the same error; Forwarder only borrows its reason for probes. */
      const error = createRpcError(
        RpcCoreErrorCode.providerNotFound,
        RuntimeApiErrorText.methodUnavailable
      )
      if (entry?.kind === 'forward')
        this.#input.ports.forward.reject?.(this.#input.source, this.#input.envelope, error)
      throw error
    }
    /** The original method and stream share one signal and inherited local deadline. */
    const context = this.#context(step.payload)
    try {
      if (mode === RpcCallMode.stream) this.#streamContext = context
      /** Original local and forwarded native candidates wait at this one invocation boundary. */
      const waiting = this.#waitForGate(entryGate(entry))
      if (waiting) await waiting
      if (this.signal.aborted) throw this.signal.reason
      if (entry.kind === 'forward') {
        this.#begin()
        if (mode === RpcCallMode.stream)
          return {
            kind: 'stream',
            value: this.#input.ports.forward.stream(
              entry,
              context.value,
              this.#input.source,
              this.#options,
              this.#input.envelope
            )
          }
        return {
          kind: 'value',
          value: this.#project(
            await this.#input.ports.forward.invoke(
              entry,
              context.value,
              this.#input.source,
              mode as 'request' | 'notify',
              this.#options,
              this.#input.envelope
            )
          )
        }
      }
      readProviderPreflight(entry.method)?.(this.#input.envelope.route)
      this.#begin()
      /** Reflect.apply is required to retain the original captured local receiver. */
      const returned = Reflect.apply(entry.method, entry.receiver, [
        context.value.data,
        context.value
      ])
      if (mode === RpcCallMode.stream) {
        /** A synchronous iterable remains supported through the sole async producer boundary. */
        return { kind: 'stream', value: returned as AsyncIterable<IRpcPortableValue> }
      }
      return await completeProviderReturn(returned, { invocation: this, context }, (value, owner) =>
        owner.invocation.#result(value, owner.context)
      )
    } finally {
      /** Stream contexts expire when iteration/return actually completes, not at iterator creation. */
      if (mode !== RpcCallMode.stream) context.finish()
    }
  }

  /** Group steps and single methods share exact caller identity and native callback routing. */
  #context(payload?: IRpcPortableValue): ProviderContext {
    return new ProviderContext(
      this.#input.ports,
      this.#input.source.namespace,
      this.#input.envelope,
      payload,
      this.signal,
      this.#deadline,
      this.#input.targetSource && this.#input.source.session
        ? callTarget({
            carrierId: this.#input.source.carrierId,
            view: this.#input.source.session,
            source: this.#input.targetSource
          })
        : undefined,
      this.#input.source
    )
  }

  /** Before-start cancellation remains active through native commit and permission waits. */
  #begin(count = 1): void {
    /** Commit admission before a sink can reenter before-start cancellation. */
    const first = this.#started === 0
    this.#started += count
    if (first) this.#observe(RpcProbeOutcome.admitted)
    if (this.signal.aborted) throw this.signal.reason
    if (!this.#forwarded && this.#options.cancel === RpcWireCancel) {
      this.#timer?.cancel()
      this.#timer = undefined
    }
  }

  /** Exact context replies select their data/failure; lookalikes remain ordinary method values. */
  #result(value: unknown, context: ProviderContext): IRpcDispatchOutcome {
    /** Late returns cannot grant result authority; genuine rejected returns still report upstream. */
    if (this.signal.aborted) return { kind: 'value' }
    if (!context.owns(value)) return { kind: 'value', value: this.#project(value) }
    if (!value.ok) throw createRpcRemoteError(value.code, value.message)
    return {
      kind: 'value',
      value: this.#project(value.data),
      transfer: value.transfer as readonly ArrayBuffer[] | undefined
    }
  }

  /** Only portable-result failures are classified as serialization; business exceptions pass intact. */
  #project(value: unknown): IRpcPortableValue | undefined {
    if (value === undefined) return undefined
    try {
      return normalizeRpcPortable(value, hostErrorWireMetadata)
    } catch (cause) {
      /** Only failed portable projection opts in to the original privacy summary. */
      const failure = createRpcSerializationError(RuntimeApiErrorText.resultInvalid, cause)
      registerLocalErrorWireSummary(
        failure,
        RpcCoreErrorCode.payloadInvalid,
        RuntimeApiErrorText.resultInvalid,
        { preserveSerializedError: true }
      )
      throw failure
    }
  }

  /** Cancellation retains the admitted timeout or the original caller reason through cause. */
  #cancelled(): Extract<IRpcCompletion, { ok: false }> | undefined {
    if (!this.signal.aborted || (this.#forwarded && this.#started)) return undefined
    /** Actual cancellation already won; admitted deadline diagnostics retain their original family. */
    const reason = this.signal.reason
    /** Only this actual aborted stream decision records a cancellation terminal for later replay. */
    const completion = this.#failure(
      localRpcErrorCode(reason) === RpcCoreErrorCode.deadlineExceeded ||
        (safeRead(reason, 'source') === RPC_ENDPOINT_ERROR_SOURCE &&
          safeRead(reason, 'code') === RpcCoreErrorCode.deadlineExceeded)
        ? reason
        : createRpcAbortError(undefined, undefined, reason)
    )
    return this.#input.envelope.task.mode === RpcCallMode.stream
      ? { ...completion, streamTerminal: RpcStreamEvent.cancelled }
      : completion
  }

  /** The pure bounded serializer preserves the complete original native error graph. */
  #failure(error: unknown): Extract<IRpcCompletion, { ok: false }> {
    return {
      ok: false,
      error: serializeHostWireError(
        identifyRpcBoundaryFailure(
          error,
          RpcCoreErrorCode.internal,
          RpcCoreErrorText.providerFailed
        ),
        {
          report: (failure) => this.#input.ports.report(failure.error)
        }
      )
    }
  }

  /** Release the one deadline and parent listener exactly once at actual business terminal. */
  #finish(
    completion: IRpcCompletion,
    observation?: Readonly<{ outcome: number; error?: unknown }>
  ): void {
    if (this.#settled) return
    this.#settled = true
    this.#timer?.cancel()
    this.#timer = undefined
    try {
      this.#controller.complete(this.#request.token)
    } catch (error) {
      this.#input.ports.report(error)
    }
    /** Actual business return/throw remains distinct from a caller deadline's wire terminal. */
    this.#observe(
      observation?.outcome ?? (completion.ok ? RpcProbeOutcome.settled : RpcProbeOutcome.failed),
      observation ? observation.error : completion.ok ? undefined : this.signal.reason
    )
    this.#completion.resolve(completion)
  }

  /** A reply is sent only after its actual physical Promise fulfills. */
  async #send(envelope: IRpcEnvelope, transfer?: readonly ArrayBuffer[]): Promise<void> {
    await this.#input.ports.send(
      this.#input.source.carrierId,
      envelope,
      { transfer },
      this.#input.targetSource
    )
    this.#observe(RpcProbeOutcome.sent, undefined, envelope, RpcProbeDirection.outbound)
  }

  /** Only original fixed headers and local diagnostics cross the readonly observer boundary. */
  #observe(
    outcome: number,
    error?: unknown,
    envelope: IRpcEnvelope = this.#input.envelope,
    direction: number = RpcProbeDirection.inbound
  ): void {
    this.#input.ports.observe?.({
      kind: RpcProbeObservationKind.event,
      namespace: this.#input.source.namespace,
      carrierId: this.#input.source.carrierId,
      peerId: this.#input.source.session?.peerId,
      id: envelope.id,
      data: {
        ...rpcProbeEnvelopeFacts(envelope),
        stage: RpcProbeStage.message,
        direction,
        kind: rpcProbeEnvelopeKind(envelope),
        outcome,
        error,
        durationMs:
          outcome === RpcProbeOutcome.settled || outcome === RpcProbeOutcome.failed
            ? Math.max(0, this.#now() - this.#createdAt)
            : -1
      }
    })
  }

  /** Plain notify has no terminal; its original failure is reported before serialization. */
  #oneWay(): boolean {
    return (
      this.#input.envelope.task.mode === RpcCallMode.notify &&
      this.#options.cancel !== RpcWireCancel &&
      this.#options.orderKey === undefined &&
      this.#input.envelope.route.forwardRoute === undefined
    )
  }

  /** Ordinary notify adds no ACK; request/group and existing refusals carry their original terminal. */
  async #respond(): Promise<void> {
    if (this.#detached || this.#oneWay()) return
    /** This is the actual completed operation, not a snapshot taken when cancellation arrived. */
    const completion = await this.completion
    /** Reply routing echoes the selected task and original immediate caller. */
    const self = this.#input.ports.self()
    /** No inherited budget is refreshed by the response path. */
    const common = {
      profile: this.#input.envelope.profile,
      id: this.#input.envelope.id,
      task: this.#input.envelope.task,
      route: {
        applicationVersion: self.applicationVersion,
        senderId: self.instanceId,
        receiverId: this.#input.envelope.route.senderId,
        targetId: this.#input.envelope.route.senderId,
        sentAt: systemWallClock.timestamp(),
        ...(this.#input.envelope.route.trace === undefined
          ? {}
          : { trace: this.#input.envelope.route.trace }),
        ...(this.#input.envelope.route.forwardRoute
          ? { forwardRoute: this.#input.envelope.route.forwardRoute }
          : {})
      }
    }
    try {
      if (this.#input.envelope.kind === RpcWireKind.outcome && completion.ok) {
        /** Installed policy supplies the protocol-owned result; codec admission checks its shape. */
        const outcome = completion.result as IRpcOutcomeLookupResult
        await this.#send({
          ...common,
          ...outcome,
          kind: RpcWireKind.outcome,
          operation: 'result'
        } as Extract<IRpcEnvelope, { kind: 'outcome'; operation: 'result' }>)
        return
      }
      if (this.#input.envelope.task.mode === RpcCallMode.stream) {
        await this.#send({
          ...common,
          kind: RpcWireKind.stream,
          stream: completion.ok
            ? { event: RpcStreamEvent.end, seq: 0 }
            : {
                event: completion.streamTerminal ?? RpcStreamEvent.fail,
                seq: 0,
                error: completion.error
              }
        })
        return
      }
      await this.#send(
        completion.ok
          ? {
              ...common,
              kind: RpcWireKind.result,
              ...(completion.result === undefined ? {} : { result: completion.result })
            }
          : { ...common, kind: RpcWireKind.error, error: completion.error },
        completion.ok ? this.#transfer : undefined
      )
    } catch (error) {
      this.#input.ports.report(error)
    }
  }
}
