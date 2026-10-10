import { deferred, type IDeferred } from '@migaia/utils/promise'
import { invalidRpcStream } from '../../contract/stream-error.js'
import type { IRpcProviderRejection } from '../provider-admission.js'
import {
  createGenerationController,
  type IGenerationController,
  type IGenerationRequest
} from '@migaia/lifecycle'
import type { IRpcProviderController } from './plugin-shared-keys.js'
import {
  RpcError,
  RpcContractError,
  RpcCoreErrorCode,
  RpcSchemaValidationError,
  RpcTimeoutError,
  RPC_CORE_ERROR_SOURCE
} from '../errors.js'
import { RpcAbortError, RpcRemoteError } from '../errors.js'
import type { RequestReplayLedger } from './request-replay-ledger.js'
import type {
  IRpcRuntimeEnvelope,
  IRpcRuntimeGeneration,
  IRpcRuntimeCompletion,
  IRpcRuntimeTask,
  IRpcRuntimeStep,
  IRpcRuntimeStepOutcome,
  IRpcRuntimeOutcome,
  IRpcRuntimeOutcomeResult,
  IRpcRuntimeStore
} from '../../contract/runtime-api/types.js'
import {
  RpcRuntimeKind,
  RpcRuntimeMode,
  RpcRuntimeOperation,
  RpcRuntimeCancel,
  RpcRuntimeFinish,
  RpcRuntimeStepState,
  RpcRuntimeProfile,
  RpcRuntimeOutcomeState,
  RpcRuntimeStoreKind,
  RpcRuntimeStoreContinuity,
  RpcRuntimeGenerationKind,
  RpcRuntimeStreamPrefix
} from '../../contract/runtime-api/constants.js'
import { RpcRouteProfile, RpcRouteType } from '../../contract/wire-constants.js'
import { RpcCoreErrorText } from '../error-text.js'
import { ERROR_SOURCE as RpcCoreErrorSource } from '../error-code.js'
import {
  normalizePortable,
  RpcStreamViolation,
  RpcStreamEvent,
  type IRpcEnvelope,
  type IRpcEnvelopeData,
  type IRpcSerializedError
} from '../../contract/index.js'
import type { IRpcAbortSignal, IRpcContext, IRpcProviderResult } from '../typing.js'
import type { ProviderRegistry } from './provider.js'
import {
  readProviderBulkAdmission,
  readRuntimeIdempotencyScope,
  readProviderPreflight,
  retainProviderInvocation,
  type IProviderAdmissionReservation,
  type IProviderBulkAdmission,
  type IProviderRuntimeStream,
  type IProviderRuntimeRelay
} from './provider.js'
import type { IRpcPortableValue } from '../../contract/types.js'
import { normalizeRuntimePortable, hasRpcPortableBinary } from '../../contract/normalize.js'
import { hasRpcBinaryEnvelope } from '../../contract/runtime-api/binary-capture.js'
import { prepareRpcBinaryLazy as prepareRpcBinary } from '../../contract/runtime-api/binary-lazy.js'
import { RpcBinaryStorage } from '../../contract/runtime-api/binary-constants.js'
import { createRpcBackingDigest } from './authentication-replay.js'
import { safeRead, safeString, tupleKey, runtimeTaskKey } from './safe-value.js'
import { RpcMessageKind, RpcProviderRejectionReason } from '../semantic-constants.js'
import { localErrorWireSummary } from '../../contract/contract-error.js'
import { serializeRpcError, deserializeRpcError } from '../../contract/error.js'
import { RpcContractErrorCode } from '../../contract/error-code.js'
import type {
  IRpcIdempotencyClaim,
  IRpcIdempotencyOutcome,
  IRpcIdempotencyStore
} from '../idempotency-store.js'
import type { IEndpointTimer } from './time-port.js'

/** Canonical request plus WebRPC-owned route data consumed by provider execution. */
export type IProviderRequestInput = Readonly<{
  readonly envelope: Extract<IRpcEnvelope, { readonly kind: 'request' }>
  readonly route: IRpcEnvelopeData
}>
type IProviderAdmission = {
  acquire(taskKey: string, peerKey: string): boolean
  release(taskKey: string): void
  acquireMany?(taskKeys: readonly string[], peerKey: string): boolean
  enqueueOrder?(orderKey: string, start: () => void): () => void
}
type IControllerRegistry = {
  has(key: string): boolean
  set(key: string, controller: IRpcProviderController): void
  delete(key: string): void
}

type IProviderExecutorOptions<TTargetId extends string> = {
  /** Only finalized canonical ordinary requests may defer their unread native signal. */
  readonly fast?: boolean
  /** Endpoint wall clock for response wire `sentAt` diagnostics; never used for deadlines. */
  /** The installed response format can preserve the genuine original failure graph. */
  readonly responseError?: (error: unknown) => IRpcSerializedError
  readonly timestamp: () => number
  /** Monotonic endpoint time and timer lifecycle used for incoming relative deadlines. */
  readonly now: () => number
  readonly setTimeout: (task: () => void, delayMs: number) => IEndpointTimer
  readonly clearTimeout: (timer: IEndpointTimer) => void
  readonly id: string
  readonly registry: ProviderRegistry
  readonly controllers: IControllerRegistry
  readonly peers: Iterable<TTargetId>
  readonly dispatch: (targetId: TTargetId, method: string, data: unknown) => void
  readonly send: (response: unknown, transfer?: readonly unknown[]) => Promise<void>
  readonly validate: (method: string, side: 'params' | 'result', data: unknown) => void
  readonly emitFailure: (error: unknown, code: string, field?: string) => void
  readonly isReplay?: (request: IProviderRequestInput, verifiedPeerKey: string) => boolean
  readonly admitReplay?: (request: IProviderRequestInput, verifiedPeerKey: string) => boolean
  readonly markCompleted?: (request: IProviderRequestInput, verifiedPeerKey: string) => void
  readonly consumePendingAbort?: (
    key: string,
    association?: string
  ) => import('./variation-coordinator.js').IRpcEarlyProviderIntent
  readonly admission: IProviderAdmission
  /** Local owner notification for the three canonical admission refusals. */
  readonly onRejected?: (rejection: IRpcProviderRejection) => void | Promise<void>
  readonly retainBinding?: (verifiedPeerKey: string) => boolean
  readonly releaseBinding?: (verifiedPeerKey: string) => void
  /** Selects response receiver identity for composed attachment admission. */
  readonly responseReceiverId?: (request: IProviderRequestInput) => string | undefined
  readonly idempotencyStore?: IRpcIdempotencyStore
  /** Only the attachment-created default memory store is necessarily replaced with native execution. */
  readonly runtimeDefaultMemoryStore?: boolean
  readonly idempotencyScope?: (admission: Readonly<{ token: string; senderId: string }>) => string
}
const providerResultBrand = Symbol('web-rpc-provider-result')
type IBrandedProviderResult = IRpcProviderResult & { readonly [providerResultBrand]: object }
const maxProviderTransferItems = 64

/** These facts come from the accepted original identity and replay owners, never business data. */
export type IRuntimeExecutionPorts = Readonly<{
  generation: IRpcRuntimeGeneration
  callerGeneration: IRpcRuntimeGeneration
  /** Listener/Host assembly can borrow the same original registry across physical sessions. */
  admission?: IProviderAdmission
  replay: RequestReplayLedger
  /** Original authentication/native qualification decides active replay, never the new grammar. */
  activeReplay?: boolean
  /** Reverse authentication supplies an exact multiplexed reply receiver. */
  replyReceiverId?: string
  send(envelope: IRpcRuntimeEnvelope, onPrepared?: () => Promise<void>): Promise<void>
}>

/** Exact tuple equality fences this physical hop without treating an attempt number as a restart. */
function sameGeneration(left: IRpcRuntimeGeneration, right: IRpcRuntimeGeneration): boolean {
  return (
    left.kind === right.kind && left.value === right.value && left.providerId === right.providerId
  )
}

/** Internal context input reuses the original executor; this record never enters a physical frame. */
function runtimeRequestInput(
  envelope: IRpcRuntimeEnvelope,
  step: IRpcRuntimeStep,
  elapsedMs = 0
): IProviderRequestInput {
  const route: IRpcEnvelopeData = {
    route: {
      ...envelope.route,
      profile: RpcRouteProfile,
      type: RpcRouteType.request,
      ...('options' in envelope && envelope.options.timeoutMs !== undefined
        ? { timeoutMs: Math.max(0, envelope.options.timeoutMs - elapsedMs) }
        : {}),
      ...(envelope.task.mode === RpcRuntimeMode.notify ? { dispatchOnly: true } : {})
    },
    ...(step.payload === undefined ? {} : { payload: step.payload })
  }
  return {
    envelope: { kind: RpcMessageKind.request, id: envelope.id, method: step.method, data: route },
    route
  }
}

/** Canonical portable object ordering makes the same admitted body independent of insertion order. */
function runtimeFingerprint(
  envelope: IRpcRuntimeEnvelope,
  steps: readonly IRpcRuntimeStep[]
): string | Promise<string> {
  if (hasRpcBinaryEnvelope(envelope)) {
    /** Complete native refs/digests include bytes, type, offset and aliases in the original claim. */
    const digest = createRpcBackingDigest()
    return prepareRpcBinary(
      envelope,
      digest ? RpcBinaryStorage.native : RpcBinaryStorage.inline,
      undefined,
      digest
    ).then((prepared) => {
      const encoded = prepared.manifest.envelope
      const data =
        'steps' in encoded
          ? encoded.steps
          : [
              {
                method: encoded.task.method,
                ...('payload' in encoded ? { payload: encoded.payload } : {})
              }
            ]
      return JSON.stringify([envelope.task.mode, data, prepared.manifest.backings])
    })
  }
  const mode = envelope.task.mode
  return JSON.stringify([mode, steps], (_key, value: unknown) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, Reflect.get(value, key)])
    )
  })
}

/** Normalizes provider-owned metadata before it can cross the transport boundary. */
function normalizeTransfer(value: readonly unknown[] | undefined): readonly unknown[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length > maxProviderTransferItems)
    throw new RpcContractError(RpcCoreErrorText.providerTransferMustBeABoundedArray)
  const snapshot = Array.from(value)
  return Object.freeze(snapshot)
}

/** Validates and snapshots failure metadata created by untrusted JavaScript callers. */
function normalizeFailure(
  message: string,
  code: string
): { readonly message: string; readonly code: string } {
  if (typeof message !== 'string' || typeof code !== 'string')
    throw new RpcContractError(RpcCoreErrorText.providerFailureMessageAndCodeMustBeStrings)
  return Object.freeze({ message, code })
}

/** Runtime task records expose their existing liveness without another captured callback. */
type IProviderContextLifetime = Readonly<{ expired(): boolean }>
/** A lazy runtime record supplies its original native signal only when the public getter reads it. */
type IProviderContextSignal = Readonly<{ readSignal(): IRpcAbortSignal }>

/** Context callbacks preserve the original callable lifetime source as well as owned task records. */
function contextExpired(source: (() => boolean) | IProviderContextLifetime): boolean {
  return typeof source === 'function' ? source() : source.expired()
}

/** Owns inbound provider execution and response settlement. */
export class ProviderExecutor<TTargetId extends string> {
  /** Only this exact owner-created result can omit the original nonsemantic await. */
  static readonly #Result = class extends class {
    constructor(value: object) {
      return value
    }
  } {
    /** Retains the original task token without adding a reflected property or changing result shape. */
    readonly #token: object
    constructor(value: object, token: object) {
      super(value)
      this.#token = token
    }
    /** Copies, proxies, foreign tasks and native/foreign Promises retain the original await path. */
    static matches(value: unknown, token: object): boolean {
      return (
        typeof value === 'object' && value !== null && #token in value && value.#token === token
      )
    }
  }

  /** Stable context behavior lives on one record; the public object keeps its original own shape. */
  static readonly #Context = class<TId extends string> {
    /** Original endpoint callbacks and native policy owners remain held by this context's executor. */
    readonly #owner: ProviderExecutor<TId>
    /** Signal source is the original signal/callable or the same lazy runtime execution record. */
    readonly #signal: IRpcAbortSignal | (() => IRpcAbortSignal) | IProviderContextSignal
    /** The actual executor alone decides expiry; this record adds no lifecycle state. */
    readonly #expired: (() => boolean) | IProviderContextLifetime
    /** The exact original task token still brands every completion and expired result. */
    readonly #taskToken: object
    /** Deadline captures the original relative budget once at context creation. */
    readonly #deadlineAt: number | undefined
    /** Preserve the original once-selected monotonic clock callable and receiver-free use. */
    readonly #now: () => number
    /** Original sender selects default dispatch peers and never grants another owner's rights. */
    readonly #senderId: string
    /** The public object retains own getters and receiver-free callbacks without a prototype change. */
    readonly value: IRpcContext

    constructor(
      owner: ProviderExecutor<TId>,
      request: IProviderRequestInput,
      signal: IRpcAbortSignal | (() => IRpcAbortSignal) | IProviderContextSignal,
      expired: (() => boolean) | IProviderContextLifetime,
      taskToken: object,
      runtimeTask?: IRpcRuntimeTask
    ) {
      this.#owner = owner
      this.#signal = signal
      this.#expired = expired
      this.#taskToken = taskToken
      this.#deadlineAt =
        request.route.route.timeoutMs === undefined
          ? undefined
          : owner.options.now() + request.route.route.timeoutMs
      this.#now = owner.options.now
      this.#senderId = request.route.route.senderId
      this.value = {
        data: request.route.payload,
        senderId: request.route.route.senderId,
        route: request.route.route.forwardRoute,
        ...(runtimeTask === undefined
          ? {}
          : {
              callerGeneration: runtimeTask.callerGeneration,
              targetGeneration: runtimeTask.targetGeneration
            }),
        timeoutMs: undefined,
        signal: undefined as unknown as IRpcAbortSignal,
        trace: request.route.route.trace,
        success: (data, options) => this.success(data, options),
        failed: (message, code) => this.failed(message, code),
        dispatchTo: (value) => this.dispatch(value)
      }
      // Preserve object-literal getter descriptors and key order with lexical, receiver-free reads.
      Object.defineProperties(this.value, {
        timeoutMs: { configurable: true, enumerable: true, get: () => this.timeout() },
        signal: { configurable: true, enumerable: true, get: () => this.signal() }
      })
    }

    /** Repeated timeout reads retain the original deadline and integer floor policy. */
    timeout(): number | undefined {
      return this.#deadlineAt === undefined
        ? undefined
        : Math.max(0, Math.floor(this.#deadlineAt - this.#now()))
    }
    /** Only the public signal getter materializes a lazy owned runtime record. */
    signal(): IRpcAbortSignal {
      return typeof this.#signal === 'function'
        ? this.#signal()
        : ProviderExecutor.#RuntimeExecution.signalFor(this.#signal)
    }
    /** Expired results retain their original unfrozen shape, message, code and task identity. */
    #expiredResult(): IBrandedProviderResult {
      const result: IBrandedProviderResult = {
        ok: false,
        message: RpcCoreErrorText.providerContextExpired,
        code: RpcCoreErrorCode.contextExpired,
        [providerResultBrand]: this.#taskToken
      }
      return result
    }
    /** Exact owner-created success retains the original transfer snapshot and frozen public shape. */
    success(
      data?: unknown,
      options?: { readonly transfer?: readonly unknown[] }
    ): IRpcProviderResult {
      if (contextExpired(this.#expired)) return this.#expiredResult()
      const result = Object.freeze({
        ok: true,
        data,
        transfer: normalizeTransfer(options?.transfer),
        [providerResultBrand]: this.#taskToken
      } as IBrandedProviderResult)
      new ProviderExecutor.#Result(result, this.#taskToken)
      return result
    }
    /** Untrusted failure metadata still enters the original message/code validation owner once. */
    failed(message: string, code: string): IRpcProviderResult {
      if (contextExpired(this.#expired)) return this.#expiredResult()
      const failure = normalizeFailure(message, code)
      const result = Object.freeze({
        ok: false,
        message: failure.message,
        code: failure.code,
        [providerResultBrand]: this.#taskToken
      } as IBrandedProviderResult)
      new ProviderExecutor.#Result(result, this.#taskToken)
      return result
    }
    /** Dispatch retains original default peers, supplied target validation and expired no-op. */
    dispatch({ id, method, data }: { id?: string; method: string; data: unknown }): void {
      if (contextExpired(this.#expired)) return
      if (id !== undefined) {
        if (typeof id !== 'string' || id.length === 0)
          throw new RpcContractError(RpcCoreErrorText.dispatchTargetIdMustBeANonEmptyString)
        this.#owner.options.dispatch(id as TId, method, data)
        return
      }
      for (const peer of this.#owner.options.peers)
        if (peer !== this.#senderId) this.#owner.options.dispatch(peer, method, data)
    }
  }

  /** Same-owner runtime task record retains original quota, replay, claim and cancellation state. */
  static readonly #RuntimeExecution = class<TId extends string> {
    /** Existing executor owns all callbacks and registries; this record adds no alternate provider. */
    readonly #owner: ProviderExecutor<TId>
    /** Closed admitted envelope is reused by response and full task fencing. */
    readonly #envelope: Extract<
      IRpcRuntimeEnvelope,
      { kind: typeof RpcRuntimeKind.call | typeof RpcRuntimeKind.group }
    >
    /** Authenticated peer identity remains the original physical-admission key. */
    readonly #peerKey: string
    /** Original generation/replay/physical ports stay on this same task. */
    readonly #ports: IRuntimeExecutionPorts
    /** Original admission owns quotas and FIFO release. */
    #admission!: IProviderAdmission
    /** One admitted step array preserves complete-group validation and order. */
    #steps!: readonly IRpcRuntimeStep[]
    /** The existing controller registry still uses the exact selected tuple. */
    #controllerKey!: string
    /** Original replay/member leases use these same task keys. */
    #memberKeys!: string[]
    /** Original first-member request supplies reporting and quota rejection identity. */
    #input!: IProviderRequestInput
    /** Relative timeout starts at the same original monotonic receive point. */
    #receivedAt!: number
    /** Only a compiled original provider can supply forwarding behavior. */
    #relay: IProviderRuntimeRelay | undefined
    /** One original replay reservation owns rollback and terminal release. */
    #reserved: NonNullable<ReturnType<RequestReplayLedger['reserveMany']>> | undefined
    /** Group-only native policies retain their original callback identities. */
    #bulkRegistrations: ReturnType<typeof readProviderBulkAdmission>[] | undefined
    /** Existing native quota reservations retain their original actual lifetime. */
    #bulkReservations!: Map<IProviderBulkAdmission, IProviderAdmissionReservation>
    /** The same original four states linearize start/cancel/terminal, without another state machine. */
    #state!: 'queued' | 'started' | 'cancelled' | 'terminal'
    /** Original known invocation prefix decides terminal replay ownership. */
    #invokedMembers: number | undefined
    /** Original endpoint timer owns the admitted deadline. */
    #deadline: IEndpointTimer | undefined
    /** The original configured store owns the sole claim. */
    #claim: IRpcIdempotencyClaim | undefined
    /** Retain the exact scope/key/fingerprint chosen during original admission. */
    #claimInput:
      | Readonly<{ store: IRpcIdempotencyStore; scope: string; key: string; fingerprint: string }>
      | undefined
    /** Seal changes only once at the same original store commit point. */
    #sealed!: boolean
    /** Only the real stream terminal supplies this completion. */
    #streamCompletion: IRpcRuntimeCompletion | undefined
    /** Started business or hashing retains its original deferred cancel completion. */
    #cancellationCompletion: IRpcRuntimeCompletion | undefined
    /** Hash preparation is the original live claim window, not another task owner. */
    #preparingFingerprint!: boolean
    /** Existing FIFO entry supplies its own idempotent release. */
    #releaseOrder: (() => void) | undefined
    /** Async binary preparation can reach the same original FIFO head first. */
    #prepareReachedHead!: boolean
    /** The original queued callback is supplied only after actual preparation. */
    #preparedOrderStart: (() => void) | undefined
    /** Completion exists only at the original post-admission point. */
    #completion: IDeferred<void> | undefined
    /** The original native controller is allocated only on a real signal read or actual abort. */
    #nativeResource: AbortController | undefined
    /** Stream handler remains absent until its actual mode or producer binds it. */
    declare streamIntent?: IRpcProviderController['streamIntent']
    /** The original producer alone can bind actual iterator cancellation. */
    declare cancelStream?: IRpcProviderController['cancelStream']

    constructor(
      owner: ProviderExecutor<TId>,
      envelope: Extract<
        IRpcRuntimeEnvelope,
        { kind: typeof RpcRuntimeKind.call | typeof RpcRuntimeKind.group }
      >,
      peerKey: string,
      ports: IRuntimeExecutionPorts
    ) {
      this.#owner = owner
      this.#envelope = envelope
      this.#peerKey = peerKey
      this.#ports = ports
    }
    /** Complete task identity is still selected by the original inbound grammar. */
    get runtimeTask(): IRpcRuntimeTask {
      return this.#envelope.task
    }
    /** Actual reads retain native signal identity; ordinary unread success allocates none. */
    get signal(): IRpcAbortSignal {
      return this.#native.signal
    }
    /** The original native resource still owns default reason, stack and idempotent abort. */
    get #native(): AbortController {
      return (this.#nativeResource ??= new AbortController())
    }
    /** Context retains the actual executor's existing liveness, with no captured callback. */
    expired(): boolean {
      return this.#state !== 'started'
    }
    /** The public own signal getter delegates only when its application reads it. */
    readSignal(): IRpcAbortSignal {
      return this.#native.signal
    }
    /** Non-record signals preserve the original object and perform no added property probing. */
    static signalFor(value: IRpcAbortSignal | IProviderContextSignal): IRpcAbortSignal {
      return #nativeResource in value ? value.#native.signal : (value as IRpcAbortSignal)
    }
    /** Existing lifecycle retirement calls the same task's revoke method. */
    abort(reason?: unknown, retainStarted = false): void {
      this.#revoke(reason, retainStarted)
    }
    /** Original routed intent calls the same final-start decision. */
    cancelIntent(reason?: unknown): void {
      this.#cancelIntent(reason)
    }
    /** Completion is the original retained Promise, not another done-state registry. */
    get #finished(): Promise<void> {
      return this.#completion!.promise
    }
    /** Terminal cleanup resolves the same original execution completion. */
    #finishTask(): void {
      this.#completion!.resolve()
    }
    /** Admit this task through the unchanged original execution sequence. */
    async execute(): Promise<void> {
      this.#admission = this.#ports.admission ?? this.#owner.options.admission
      this.#steps =
        this.#envelope.kind === RpcRuntimeKind.group
          ? this.#envelope.steps
          : [
              {
                method: this.#envelope.task.method!,
                ...('payload' in this.#envelope ? { payload: this.#envelope.payload } : {})
              }
            ]
      this.#controllerKey = tupleKey(
        this.#peerKey,
        this.#envelope.route.senderId,
        this.#envelope.id
      )
      this.#memberKeys = this.#steps.map((_step, index) =>
        tupleKey(this.#controllerKey, String(index))
      )
      this.#input = runtimeRequestInput(this.#envelope, this.#steps[0]!)
      this.#receivedAt = this.#owner.options.now()
      try {
        if (
          !sameGeneration(this.#envelope.task.targetGeneration, this.#ports.generation) ||
          !sameGeneration(this.#envelope.task.callerGeneration, this.#ports.callerGeneration)
        )
          throw new RpcError(
            RpcCoreErrorCode.providerGenerationMismatch,
            RpcCoreErrorText.providerGenerationMismatch
          )
        if (
          !this.#admission.acquireMany ||
          (this.#envelope.options.orderKey !== undefined && !this.#admission.enqueueOrder)
        )
          throw new RpcError(
            RpcCoreErrorCode.capabilityUnsupported,
            RpcCoreErrorText.capabilityUnsupported
          )
        /**
         * Whitelist/schema/forward preflight finishes for the entire set before either quota
         * changes.
         */
        for (const step of this.#steps) {
          const provider =
            this.#envelope.task.mode === RpcRuntimeMode.stream
              ? this.#owner.options.registry.streamProviders.get(
                  `${RpcRuntimeStreamPrefix}${step.method}`
                )
              : this.#owner.options.registry.getProvider(step.method)
          if (!provider)
            throw new RpcError(RpcCoreErrorCode.providerNotFound, RpcCoreErrorText.providerNotFound)
          this.#owner.options.validate(step.method, 'params', step.payload)
          readProviderPreflight(provider)?.(runtimeRequestInput(this.#envelope, step).route.route)
        }
        this.#relay = this.#owner.options.registry.runtimeRelay?.(this.#envelope)
      } catch (error) {
        this.#report(error)
        await this.#respond(this.#failed(error))
        return
      }
      /** Duplicates never acquire the original task's release ownership. */
      if (
        this.#ports.replay.has(this.#memberKeys[0]!, this.#owner.options.now()) ||
        this.#owner.options.controllers.has(this.#controllerKey)
      )
        return
      this.#reserved = this.#ports.replay.reserveMany(
        this.#memberKeys,
        this.#peerKey,
        this.#owner.options.now(),
        this.#ports.activeReplay
      )
      if (!this.#reserved) {
        this.#owner.#notifyRejection(
          this.#input,
          this.#peerKey,
          this.#controllerKey,
          this.#envelope.kind === RpcRuntimeKind.group
            ? RpcProviderRejectionReason.groupReplayFull
            : RpcProviderRejectionReason.replayLedgerFull
        )
        await this.#respond(
          this.#failed(
            new RpcError(RpcCoreErrorCode.overloaded, RpcCoreErrorText.requestReplayLedgerIsFull)
          )
        )
        return
      }
      if (!this.#admission.acquireMany!(this.#memberKeys, this.#peerKey)) {
        this.#reserved.rollback()
        this.#owner.#notifyRejection(
          this.#input,
          this.#peerKey,
          this.#controllerKey,
          this.#envelope.kind === RpcRuntimeKind.group
            ? RpcProviderRejectionReason.groupConcurrency
            : this.#envelope.options.orderKey !== undefined
              ? RpcProviderRejectionReason.orderedQueueFull
              : RpcProviderRejectionReason.concurrency
        )
        await this.#respond(
          this.#failed(
            new RpcError(
              RpcCoreErrorCode.overloaded,
              RpcCoreErrorText.providerAdmissionLimitReached
            )
          )
        )
        return
      }
      this.#bulkRegistrations =
        this.#envelope.kind === RpcRuntimeKind.group
          ? this.#steps.map((step) =>
              readProviderBulkAdmission(this.#owner.options.registry.getProvider(step.method)!)
            )
          : undefined
      this.#bulkReservations = new Map<IProviderBulkAdmission, IProviderAdmissionReservation>()
      try {
        /** Every original policy owner validates its complete member set before any invocation. */
        const payloads = new Map<IProviderBulkAdmission, (IRpcPortableValue | undefined)[]>()
        for (let index = 0; index < this.#steps.length; index += 1) {
          /** Cold callback provenance identifies the actual shared native policy owner. */
          const registration = this.#bulkRegistrations?.[index]
          if (!registration) continue
          /** One owner can guard several methods in this same physical group. */
          const members = payloads.get(registration.admission) ?? []
          members.push(this.#steps[index]!.payload)
          payloads.set(registration.admission, members)
        }
        for (const [owner, members] of payloads)
          this.#bulkReservations.set(owner, owner.reserveMany(members))
      } catch (error) {
        for (const reservation of this.#bulkReservations.values()) reservation.release()
        for (const key of this.#memberKeys) this.#admission.release(key)
        this.#reserved.rollback()
        this.#report(error)
        await this.#respond(this.#failed(error))
        return
      }
      this.#state = 'queued'
      this.#sealed = false
      this.#preparingFingerprint = false
      this.#prepareReachedHead = false
      this.#completion = deferred<void>()
      if (this.#envelope.task.mode === RpcRuntimeMode.stream)
        this.streamIntent = (payload) => {
          if (payload.event !== RpcRuntimeFinish) return Promise.resolve()
          if (this.#envelope.options.cancel !== RpcRuntimeCancel)
            throw invalidRpcStream(RpcStreamViolation.event, '/stream/event')
          this.cancelIntent(
            payload.reason === undefined ? undefined : deserializeRpcError(payload.reason)
          )
          return Promise.resolve()
        }
      this.#owner.options.controllers.set(this.#controllerKey, this)
      const pendingAbort = this.#owner.options.consumePendingAbort?.(
        this.#controllerKey,
        runtimeTaskKey(this.#envelope.task)
      )
      if (pendingAbort?.found) {
        if (!pendingAbort.finish || this.#envelope.options.cancel === RpcRuntimeCancel)
          this.#cancelIntent(pendingAbort.reason)
        else {
          /** A forged early finish cannot opt an order-only stream into discard or cancellation. */
          this.#report(invalidRpcStream(RpcStreamViolation.event, '/stream/event'))
          if (pendingAbort.cancelReason) this.#cancelIntent(pendingAbort.cancelReason.value)
        }
      }
      if (this.#envelope.options.timeoutMs === 0) this.#cancelIntent(new RpcTimeoutError())
      else if (this.#envelope.options.timeoutMs !== undefined && this.#state === 'queued')
        this.#deadline = this.#owner.options.setTimeout(
          () => this.#cancelIntent(new RpcTimeoutError()),
          this.#envelope.options.timeoutMs
        )
      /** Retired or cancelled preparation never publishes a new key claim. */
      if (this.#state !== 'queued') return
      try {
        /** All original quotas are committed before a key becomes visible; no provider has started. */
        const key = this.#envelope.options.idempotencyKey
        if (key !== undefined && !this.#relay) {
          /** The canonical configured store owns the whole queued lifetime, including cancellation. */
          const store = this.#owner.options.idempotencyStore
          if (!store?.lookup)
            throw new RpcError(
              RpcCoreErrorCode.capabilityUnsupported,
              RpcCoreErrorText.capabilityUnsupported
            )
          /** Non-binary claims keep the original synchronous fingerprint with no extra Promise. */
          const fingerprint = runtimeFingerprint(this.#envelope, this.#steps)
          if (typeof fingerprint !== 'string' && this.#envelope.options.orderKey !== undefined) {
            /** Full backing hashing cannot let a later admitted task take this task's FIFO place. */
            this.#releaseOrder = this.#admission.enqueueOrder!(
              this.#envelope.options.orderKey,
              () => {
                this.#prepareReachedHead = true
                this.#preparedOrderStart?.()
              }
            )
          }
          /** The existing controller must remain registered while full binary hashing yields. */
          this.#preparingFingerprint = typeof fingerprint !== 'string'
          const preparedFingerprint =
            typeof fingerprint === 'string' ? fingerprint : await fingerprint
          this.#preparingFingerprint = false
          if (!this.#canClaimPrepared()) return
          this.#claimInput = {
            store,
            key,
            scope: this.#owner.#runtimeScope(
              this.#peerKey,
              this.#envelope.route.senderId,
              this.#ports.generation.providerId
            ),
            fingerprint: preparedFingerprint
          }
          this.#claim = store.claim(
            this.#claimInput.scope,
            key,
            this.#owner.options.now(),
            this.#claimInput.fingerprint
          )
          if (this.#claim.status === 'full')
            throw new RpcError(RpcCoreErrorCode.overloaded, RpcCoreErrorText.idempotencyStoreFull)
          /** A queued cancellation seals/matches the original key before its final terminal is sent. */
          if (this.#cancellationCompletion) {
            await this.#settle(this.#cancellationCompletion)
            return
          }
        }
      } catch (error) {
        this.#preparingFingerprint = false
        /** Store refusal precedes task admission; preserve no tombstones for uncommitted members. */
        this.#report(error)
        if (!this.#canClaimPrepared()) return
        this.#reserved.rollback()
        await this.#settle(this.#failed(error))
        return
      }
      if (this.#state === 'queued') {
        if (this.#releaseOrder !== undefined) {
          /** One original FIFO entry waits for preparation, with no second queue or execution owner. */
          this.#preparedOrderStart = () => {
            void this.#run()
          }
          if (this.#prepareReachedHead) this.#preparedOrderStart()
        } else if (this.#envelope.options.orderKey !== undefined)
          this.#releaseOrder = this.#admission.enqueueOrder!(
            this.#envelope.options.orderKey,
            () => {
              void this.#run()
            }
          )
        else void this.#run()
      }
      await this.#finished
    }

    /** Report the original failure at the same executor boundary. */
    #report(error: unknown): void {
      return this.#owner.options.emitFailure(
        error,
        error instanceof RpcError ? error.code : RpcCoreErrorCode.internal
      )
    }

    /** Serialize terminal failure through the original error owner. */
    #failed(error: unknown): IRpcRuntimeCompletion {
      return {
        ok: false,
        error: serializeRpcError(error, { report: (failure) => this.#report(failure.error) })
      }
    }

    /** Echo the exact selected task through its original physical response port. */
    #respond(completion: IRpcRuntimeCompletion, onPrepared?: () => Promise<void>): Promise<void> {
      return this.#envelope.task.mode === RpcRuntimeMode.stream
        ? this.#ports.send(
            {
              profile: RpcRuntimeProfile,
              kind: RpcRuntimeKind.control,
              id: this.#envelope.id,
              route: {
                ...this.#envelope.route,
                senderId: this.#owner.options.id,
                targetId: this.#envelope.route.senderId,
                receiverId: this.#ports.replyReceiverId ?? this.#envelope.route.senderId,
                sentAt: this.#owner.options.timestamp()
              },
              task: this.#envelope.task,
              operation: RpcRuntimeOperation.stream,
              stream: completion.ok
                ? {
                    event: RpcStreamEvent.end,
                    seq: 0,
                    ...(completion.result === undefined ? {} : { value: completion.result })
                  }
                : {
                    event:
                      completion.error.code === RpcCoreErrorCode.cancelled ||
                      completion.error.code === RpcCoreErrorCode.deadlineExceeded
                        ? RpcStreamEvent.cancelled
                        : RpcStreamEvent.fail,
                    seq: 0,
                    error: completion.error
                  }
            },
            onPrepared
          )
        : this.#envelope.task.mode === RpcRuntimeMode.notify &&
            this.#envelope.options.cancel !== RpcRuntimeCancel &&
            this.#envelope.options.orderKey === undefined &&
            this.#envelope.route.forwardRoute === undefined
          ? Promise.resolve()
          : this.#ports.send(
              {
                profile: RpcRuntimeProfile,
                kind: RpcRuntimeKind.control,
                id: this.#envelope.id,
                route: {
                  ...this.#envelope.route,
                  senderId: this.#owner.options.id,
                  targetId: this.#envelope.route.senderId,
                  receiverId: this.#ports.replyReceiverId ?? this.#envelope.route.senderId,
                  sentAt: this.#owner.options.timestamp()
                },
                task: this.#envelope.task,
                operation: RpcRuntimeOperation.terminal,
                completion
              },
              onPrepared
            )
    }

    /** Keep claim preparation live only for the original queued or deferred-cancel state. */
    #canClaimPrepared(): boolean {
      return (
        this.#state === 'queued' ||
        (this.#state === 'cancelled' && this.#cancellationCompletion !== undefined)
      )
    }

    /** Seal the original keyed outcome once before physical delivery. */
    #seal(completion: IRpcRuntimeCompletion): void {
      if (this.#sealed) return
      if (this.#claim?.status === 'claimed') {
        /** Same original store owner retains only the actual final result, never yielded items. */
        const outcome: IRpcRuntimeOutcome = {
          mode: this.#envelope.task.mode as IRpcRuntimeOutcome['mode'],
          targetGeneration: this.#ports.generation,
          completion
        }
        /**
         * The sealed result owns its bytes; this is a completion snapshot, never an input retry
         * backup.
         */
        const snapshot = normalizeRuntimePortable(outcome)
        this.#claim.settle(
          {
            ok: true,
            data: hasRpcPortableBinary(snapshot)
              ? normalizeRuntimePortable(structuredClone(snapshot))
              : snapshot
          },
          this.#owner.options.now()
        )
      }
      this.#sealed = true
    }

    /** Group preparation preserves its original Promise callback contract after valid frame capture. */
    async #prepareSeal(completion: IRpcRuntimeCompletion): Promise<void> {
      this.#seal(completion)
    }

    /** Retain original terminal delivery and release every admitted member exactly once. */
    async #settle(completion: IRpcRuntimeCompletion, delivered = false): Promise<void> {
      if (this.#state === 'terminal') return
      if (
        this.#envelope.kind === RpcRuntimeKind.group &&
        completion.ok &&
        Array.isArray(completion.result)
      ) {
        /** A genuine final or cached report proves the same unused suffix on every physical task. */
        const firstUnused = completion.result.findIndex(
          (step) => safeRead(step, 'state') === RpcRuntimeStepState.notExecuted
        )
        if (firstUnused >= 0) this.#invokedMembers = firstUnused
      }
      this.#state = 'terminal'
      if (this.#deadline) this.#owner.options.clearTimeout(this.#deadline)
      try {
        if (this.#envelope.kind === RpcRuntimeKind.group && !delivered)
          await this.#respond(completion, () => this.#prepareSeal(completion))
        else {
          this.#seal(completion)
          if (!delivered) await this.#respond(completion)
        }
      } catch (error) {
        this.#report(error)
        if (
          this.#envelope.kind === RpcRuntimeKind.group &&
          completion.ok &&
          !this.#sealed &&
          safeRead(error, 'code') === RpcContractErrorCode.frameLimitExceeded
        ) {
          /**
           * A rejected prepared result has zero writes; retain the actual failure instead of a
           * tombstone.
           */
          const failure = this.#failed(
            new RpcError(
              RpcCoreErrorCode.payloadInvalid,
              RpcCoreErrorText.runtimeGroupResultTooLarge,
              error
            )
          )
          try {
            this.#seal(failure)
            await this.#respond(failure)
          } catch (failureError) {
            this.#report(failureError)
          }
        } else if (this.#envelope.kind === RpcRuntimeKind.group && !this.#sealed) {
          /** Preparation refusal cannot make completed business eligible for another key claim. */
          try {
            this.#seal(completion)
          } catch (sealError) {
            this.#report(sealError)
          }
        }
      } finally {
        if (this.#claim?.status === 'claimed') this.#claim.release()
        this.#owner.options.controllers.delete(this.#controllerKey)
        for (const reservation of this.#bulkReservations.values()) reservation.release()
        for (const key of this.#memberKeys) this.#admission.release(key)
        this.#reserved!.release(
          this.#owner.options.now(),
          this.#envelope.kind === RpcRuntimeKind.group ? this.#invokedMembers : undefined
        )
        this.#releaseOrder?.()
        this.#finishTask()
      }
    }

    /** Retirement revokes this session while started business keeps its original completion lease. */
    #revoke(reason?: unknown, retainStarted = false): void {
      if (this.#state === 'terminal') return
      if (this.#state === 'cancelled') {
        /** Retiring this exact session still releases its entry after prior ordinary cancellation. */
        if (!retainStarted && this.#cancellationCompletion)
          void this.#settle(this.#cancellationCompletion)
        return
      }
      /** A native abort cannot force the already running business Promise to complete. */
      const started = this.#state === 'started'
      /** A constructed stream retains its lease until original iterator cleanup really ends. */
      const streamCleanup = started ? this.cancelStream : undefined
      this.#state = 'cancelled'
      this.#native.abort(reason)
      if (this.#deadline) this.#owner.options.clearTimeout(this.#deadline)
      this.#deadline = undefined
      /** Preserve the cancellation's original native source, code, stack and primary reason. */
      const completion = this.#failed(
        reason instanceof RpcTimeoutError ||
          (safeRead(reason, 'source') === RpcCoreErrorSource &&
            safeRead(reason, 'code') === RpcCoreErrorCode.deadlineExceeded)
          ? reason
          : new RpcAbortError(undefined, undefined, reason)
      )
      if (streamCleanup)
        void streamCleanup(reason).then(
          () => this.#settle(completion, true),
          (error: unknown) => {
            this.#report(error)
            return this.#settle(this.#failed(error))
          }
        )
      else if (retainStarted && (started || this.#preparingFingerprint))
        this.#cancellationCompletion = completion
      else void this.#settle(completion)
    }

    /** Keep original before-start cancellation and downstream relay semantics. */
    #cancelIntent(reason?: unknown): void {
      if (this.#relay && this.#state === 'started') {
        /** B sends intent through the original downstream signal; C alone decides its final start. */
        this.#native.abort(reason)
        return
      }
      if (this.#state === 'started' && this.#envelope.options.cancel === RpcRuntimeCancel) return
      this.#revoke(reason, true)
    }

    /** Commit the original final start and preserve group, stream and business completion leases. */
    async #run(): Promise<void> {
      if (this.#state !== 'queued') return
      try {
        if (this.#claimInput && this.#claim) {
          while (this.#claim.status === 'pending') {
            const retained = await Promise.race([
              this.#claim.outcome,
              this.#finished.then(() => undefined)
            ])
            if (this.#state !== 'queued') return
            if (retained !== undefined) {
              if (retained === 'unavailable' || !retained.ok || retained.data === undefined)
                throw new RpcError(
                  RpcCoreErrorCode.idempotencyResultUnavailable,
                  RpcCoreErrorText.idempotencyResultUnavailable
                )
              await this.#settle((retained.data as unknown as IRpcRuntimeOutcome).completion)
              return
            }
            this.#claim = this.#claimInput.store.claim(
              this.#claimInput.scope,
              this.#claimInput.key,
              this.#owner.options.now(),
              this.#claimInput.fingerprint
            )
          }
          if (this.#claim.status === 'done') {
            if (
              this.#claim.outcome === 'unavailable' ||
              !this.#claim.outcome.ok ||
              this.#claim.outcome.data === undefined
            )
              throw new RpcError(
                RpcCoreErrorCode.idempotencyResultUnavailable,
                RpcCoreErrorText.idempotencyResultUnavailable
              )
            await this.#settle(
              (this.#claim.outcome.data as unknown as IRpcRuntimeOutcome).completion
            )
            return
          }
          if (this.#claim.status === 'full')
            throw new RpcError(RpcCoreErrorCode.overloaded, RpcCoreErrorText.idempotencyStoreFull)
        }
        if (this.#state !== 'queued') return
        /** The sole synchronous final start point precedes any invocation or iterator construction. */
        this.#state = 'started'
        if (!this.#relay && this.#envelope.options.cancel === RpcRuntimeCancel && this.#deadline) {
          this.#owner.options.clearTimeout(this.#deadline)
          this.#deadline = undefined
        }
        if (
          this.#envelope.task.mode === RpcRuntimeMode.stream &&
          this.#envelope.kind === RpcRuntimeKind.call
        ) {
          /** Logical mode selects the same precompiled canonical stream wire route, not another map. */
          const method = `${RpcRuntimeStreamPrefix}${this.#steps[0]!.method}`
          /** The original context still carries this hop's authenticated task and caller identity. */
          const request = runtimeRequestInput(
            this.#envelope,
            { ...this.#steps[0]!, method },
            this.#owner.options.now() - this.#receivedAt
          )
          /** Start is already committed; the stream owner alone constructs and drives its iterator. */
          const runtime: IProviderRuntimeStream = {
            envelope: this.#envelope,
            signal: this.#native.signal,
            replyReceiverId: this.#ports.replyReceiverId,
            ...(this.#relay ? { forwarded: true } : {}),
            ...(this.#relay
              ? { prepareStream: this.#relay.prepareStream, finishStream: this.#relay.finishStream }
              : {}),
            seal: async (completion) => {
              this.#streamCompletion = completion
              this.#seal(completion)
            },
            bindControl: (handler) => {
              this.streamIntent = handler
            },
            bindCancel: (handler) => {
              this.cancelStream = handler
            }
          }
          await this.#owner.options.registry.streamProviders.get(method)!(
            { envelope: request.envelope, activeLifetime: true, runtime },
            (signal) =>
              this.#owner.createContext(
                request,
                signal,
                () => this.#state !== 'started',
                {},
                this.#envelope.task,
                this.#peerKey,
                this.#envelope,
                this.#relay
              )
          )
          if (this.#state === 'started')
            await this.#settle(
              this.#streamCompletion ??
                this.#failed(
                  new RpcError(
                    RpcCoreErrorCode.providerNotSettled,
                    RpcCoreErrorText.providerDidNotSettle
                  )
                ),
              this.#streamCompletion !== undefined
            )
          return
        }
        if (this.#relay && this.#envelope.kind === RpcRuntimeKind.group) {
          /**
           * The original first callback still owns native activity/drain for this whole forwarding
           * task.
           */
          const request = runtimeRequestInput(
            this.#envelope,
            this.#steps[0]!,
            this.#owner.options.now() - this.#receivedAt
          )
          const taskToken = {}
          const context = this.#owner.createContext(
            request,
            this,
            this,
            taskToken,
            this.#envelope.task,
            this.#peerKey,
            this.#envelope,
            this.#relay
          )
          for (const registration of this.#bulkRegistrations ?? [])
            if (registration) this.#bulkReservations.get(registration.admission)!.consume()
          /** Sending one complete group can execute any member until C returns its final report. */
          this.#invokedMembers = this.#steps.length
          const returned = (
            this.#bulkRegistrations?.[0]?.invoke ??
            this.#owner.options.registry.getProvider(this.#steps[0]!.method)!
          )(context)
          const response = (
            ProviderExecutor.#Result.matches(returned, taskToken) ? returned : await returned
          ) as IRpcProviderResult
          if (this.#state !== 'started') return
          if (
            !response ||
            typeof response !== 'object' ||
            (response as Partial<IBrandedProviderResult>)[providerResultBrand] !== taskToken
          )
            throw new RpcError(
              RpcCoreErrorCode.providerNotSettled,
              RpcCoreErrorText.providerDidNotSettle
            )
          if (!response.ok) throw new RpcRemoteError(response.code, response.message)
          await this.#settle({
            ok: true,
            ...(response.data === undefined
              ? {}
              : { result: normalizeRuntimePortable(response.data) })
          })
          return
        }
        const results: IRpcRuntimeStepOutcome[] = []
        for (const [index, step] of this.#steps.entries()) {
          /** Cancellation cannot start another group member after its current invocation finishes. */
          if (this.#state !== 'started') return
          if (results.some((result) => result.state === RpcRuntimeStepState.failure)) {
            results.push({ state: RpcRuntimeStepState.notExecuted })
            continue
          }
          const request = runtimeRequestInput(
            this.#envelope,
            step,
            this.#owner.options.now() - this.#receivedAt
          )
          const taskToken = {}
          const context = this.#owner.createContext(
            request,
            this,
            this,
            taskToken,
            this.#envelope.task,
            this.#peerKey,
            this.#envelope,
            this.#relay
          )
          try {
            /** Prepaid invocation retains native activity and drain owners without charging twice. */
            const registration = this.#bulkRegistrations?.[index]
            if (registration) this.#bulkReservations.get(registration.admission)!.consume()
            this.#invokedMembers = index + 1
            const returned = (
              registration?.invoke ?? this.#owner.options.registry.getProvider(step.method)!
            )(context)
            const response = (
              ProviderExecutor.#Result.matches(returned, taskToken) ? returned : await returned
            ) as IRpcProviderResult
            if (this.#state !== 'started') return
            if (
              !response ||
              typeof response !== 'object' ||
              (response as Partial<IBrandedProviderResult>)[providerResultBrand] !== taskToken
            )
              throw new RpcError(
                RpcCoreErrorCode.providerNotSettled,
                RpcCoreErrorText.providerDidNotSettle
              )
            if (!response.ok) throw new RpcRemoteError(response.code, response.message)
            this.#owner.options.validate(step.method, 'result', response.data)
            results.push({
              state: RpcRuntimeStepState.success,
              ...(response.data === undefined
                ? {}
                : { result: normalizeRuntimePortable(response.data) })
            })
          } catch (error) {
            this.#report(error)
            results.push({
              state: RpcRuntimeStepState.failure,
              error: serializeRpcError(error, { report: (failure) => this.#report(failure.error) })
            })
          }
        }
        if (this.#envelope.kind === RpcRuntimeKind.group)
          await this.#settle({ ok: true, result: normalizeRuntimePortable(results) })
        else {
          const result = results[0]!
          await this.#settle(
            result.state === RpcRuntimeStepState.failure
              ? { ok: false, error: result.error }
              : {
                  ok: true,
                  ...(result.state === RpcRuntimeStepState.success && result.result !== undefined
                    ? { result: result.result }
                    : {})
                }
          )
        }
      } catch (error) {
        this.#report(error)
        await this.#settle(this.#failed(error))
      } finally {
        /** Only real execution completion releases a cancelled started scalar/group FIFO entry. */
        if (this.#cancellationCompletion) await this.#settle(this.#cancellationCompletion)
      }
    }
  }

  readonly options: IProviderExecutorOptions<TTargetId>

  constructor(options: IProviderExecutorOptions<TTargetId>) {
    this.options = options
  }

  /** Creates the core-owned context once for an admitted request or stream open. */
  createContext(
    request: IProviderRequestInput,
    signal: IRpcAbortSignal | (() => IRpcAbortSignal) | IProviderContextSignal,
    isExpired: (() => boolean) | IProviderContextLifetime,
    taskToken: object = {},
    runtimeTask?: IRpcRuntimeTask,
    peerKey?: string,
    runtime?: IRpcRuntimeEnvelope,
    relay?: IProviderRuntimeRelay
  ): IRpcContext {
    /** Internal behavior is stable; public callback/getter descriptors remain owned by this object. */
    const context = new ProviderExecutor.#Context(
      this,
      request,
      signal,
      isExpired,
      taskToken,
      runtimeTask
    ).value
    /** Only forward providers retain private operation metadata; ordinary contexts need no copy. */
    if (
      readProviderPreflight(
        this.options.registry.getProvider(request.envelope.method) ??
          this.options.registry.streamProviders.get(request.envelope.method)
      )
    )
      retainProviderInvocation(context, request.route.route, peerKey, runtime, relay)
    return context
  }

  /** Report observer failures locally; neither synchronous nor asynchronous failure changes replies. */
  #notifyRejection(
    request: IProviderRequestInput,
    verifiedPeerKey: string,
    controllerKey: string,
    reason: RpcProviderRejectionReason
  ): void {
    if (!this.options.onRejected) return
    /** Preserve the original observer failure under a core-owned coded wrapper. */
    const report = (cause: unknown): void => {
      this.options.emitFailure(
        new RpcError(
          RpcCoreErrorCode.internal,
          RpcCoreErrorText.providerAdmissionObserverFailed,
          cause
        ),
        RpcCoreErrorCode.internal
      )
    }
    try {
      /** Snapshot only already verified local identity; payloads never enter this notification. */
      void Promise.resolve(
        this.options.onRejected(
          Object.freeze({ verifiedPeerKey, controllerKey, method: request.envelope.method, reason })
        )
      ).catch(report)
    } catch (error) {
      report(error)
    }
  }

  /** Shared streams report replay capacity through this executor's existing rejection observer. */
  notifyReplayCapacityRejection(request: IProviderRequestInput, verifiedPeerKey: string): void {
    this.#notifyRejection(
      request,
      verifiedPeerKey,
      tupleKey(verifiedPeerKey, request.route.route.senderId, request.envelope.id),
      RpcProviderRejectionReason.replayLedgerFull
    )
  }

  /** The same final executor admits a complete group and owns its single start/terminal decision. */
  async lookupRuntime(
    envelope: IRpcRuntimeEnvelope,
    peerKey: string,
    ports: IRuntimeExecutionPorts
  ): Promise<void> {
    if (
      envelope.kind !== RpcRuntimeKind.outcome ||
      envelope.operation !== RpcRuntimeOperation.lookup
    )
      return
    if (
      !sameGeneration(envelope.task.targetGeneration, ports.generation) ||
      !sameGeneration(envelope.task.callerGeneration, ports.callerGeneration)
    )
      throw new RpcError(
        RpcCoreErrorCode.providerGenerationMismatch,
        RpcCoreErrorText.providerGenerationMismatch
      )
    /** One query result belongs to the final store; a relay never reads or claims its local store. */
    let result: IRpcRuntimeOutcomeResult
    try {
      if (this.options.registry.runtimeLookup)
        result = await this.options.registry.runtimeLookup(envelope)
      else {
        /** Lookup neither leases business/replay capacity nor allocates a claim waiter. */
        const store = this.options.idempotencyStore
        const scope = this.#runtimeScope(
          peerKey,
          envelope.route.senderId,
          ports.generation.providerId
        )
        const lookup = store?.lookup?.(scope, envelope.idempotencyKey, this.options.now())
        const retainedFacts = store?.readRuntimeFacts?.() ?? {
          kind: RpcRuntimeStoreKind.unavailable,
          continuity: RpcRuntimeStoreContinuity.unavailable
        }
        /**
         * Trusted restart identity describes store replacement; missing keys alone never imply
         * loss.
         */
        const facts: IRpcRuntimeStore =
          this.options.runtimeDefaultMemoryStore &&
          ports.generation.kind === RpcRuntimeGenerationKind.restart &&
          ports.generation.value > 0 &&
          retainedFacts.kind === RpcRuntimeStoreKind.memory
            ? { ...retainedFacts, continuity: RpcRuntimeStoreContinuity.lost }
            : retainedFacts
        const retained = lookup?.state === RpcRuntimeOutcomeState.done ? lookup.outcome : undefined
        const outcome =
          retained && retained !== 'unavailable' && retained.ok && retained.data !== undefined
            ? (retained.data as unknown as IRpcRuntimeOutcome)
            : undefined
        result =
          outcome === undefined
            ? {
                store: facts,
                state:
                  lookup?.state === RpcRuntimeOutcomeState.pending
                    ? RpcRuntimeOutcomeState.pending
                    : RpcRuntimeOutcomeState.unknown
              }
            : { store: facts, state: RpcRuntimeOutcomeState.done, outcome }
      }
    } catch (error) {
      /**
       * Existing terminal/correlation grammar carries an actual lookup failure rather than hanging
       * the query.
       */
      await ports.send({
        profile: RpcRuntimeProfile,
        kind: RpcRuntimeKind.control,
        operation: RpcRuntimeOperation.terminal,
        id: envelope.id,
        task: envelope.task,
        route: {
          ...envelope.route,
          senderId: this.options.id,
          targetId: envelope.route.senderId,
          receiverId: ports.replyReceiverId ?? envelope.route.senderId,
          sentAt: this.options.timestamp()
        },
        completion: {
          ok: false,
          error: serializeRpcError(error, {
            report: (failure) => this.options.emitFailure(failure.error, RpcCoreErrorCode.internal)
          })
        }
      })
      return
    }
    await ports.send({
      profile: RpcRuntimeProfile,
      kind: RpcRuntimeKind.outcome,
      operation: RpcRuntimeOperation.result,
      id: envelope.id,
      task: envelope.task,
      route: {
        ...envelope.route,
        senderId: this.options.id,
        targetId: envelope.route.senderId,
        receiverId: ports.replyReceiverId ?? envelope.route.senderId,
        sentAt: this.options.timestamp()
      },
      ...result
    })
  }

  /** New key scope is logical provider plus authenticated direct caller, independent of method. */
  #runtimeScope(peerKey: string, senderId: string, providerId: string): string {
    return tupleKey(
      RpcRuntimeProfile,
      providerId,
      readRuntimeIdempotencyScope(this.options.idempotencyScope) ??
        this.options.idempotencyScope?.({ token: peerKey, senderId }) ??
        peerKey
    )
  }

  /** The same final executor admits a complete group and owns its single start/terminal decision. */
  /** Retain the original runtime entry Promise while its same-owner task record executes. */
  executeRuntime(
    envelope: IRpcRuntimeEnvelope,
    peerKey: string,
    ports: IRuntimeExecutionPorts
  ): Promise<void> {
    if (envelope.kind !== RpcRuntimeKind.call && envelope.kind !== RpcRuntimeKind.group)
      return Promise.resolve()
    return new ProviderExecutor.#RuntimeExecution(this, envelope, peerKey, ports).execute()
  }

  /** Validates, executes, and settles one inbound request. */
  async execute(request: IProviderRequestInput, verifiedPeerKey = ''): Promise<void> {
    /** Forward refusal runs synchronously before replay or provider admission can allocate a lease. */
    try {
      readProviderPreflight(this.options.registry.getProvider(request.envelope.method))?.(
        request.route.route
      )
    } catch (error) {
      this.options.emitFailure(
        error,
        error instanceof RpcError ? error.code : RpcCoreErrorCode.internal
      )
      if (!request.route.route.dispatchOnly)
        await this.failureResponse(request, error, undefined, true)
      return
    }
    const controllerKey = tupleKey(
      verifiedPeerKey,
      request.route.route.senderId,
      request.envelope.id
    )
    if (this.options.isReplay?.(request, verifiedPeerKey)) return
    if (this.options.admitReplay && !this.options.admitReplay(request, verifiedPeerKey)) {
      this.#notifyRejection(
        request,
        verifiedPeerKey,
        controllerKey,
        RpcProviderRejectionReason.replayLedgerFull
      )
      if (!request.route.route.dispatchOnly)
        await this.failureResponse(
          request,
          new Error(RpcCoreErrorText.requestReplayLedgerIsFull),
          RpcCoreErrorCode.overloaded
        )
      return
    }
    if (!this.options.admission.acquire(controllerKey, verifiedPeerKey)) {
      this.#notifyRejection(
        request,
        verifiedPeerKey,
        controllerKey,
        RpcProviderRejectionReason.concurrency
      )
      if (!request.route.route.dispatchOnly)
        await this.failureResponse(
          request,
          new Error(RpcCoreErrorText.providerAdmissionLimitReached),
          RpcCoreErrorCode.overloaded
        )
      return
    }
    if (this.options.retainBinding && !this.options.retainBinding(verifiedPeerKey)) {
      this.#notifyRejection(
        request,
        verifiedPeerKey,
        controllerKey,
        RpcProviderRejectionReason.bindingExpired
      )
      try {
        if (!request.route.route.dispatchOnly)
          await this.failureResponse(
            request,
            new Error(RpcCoreErrorText.verifiedPeerBindingExpired),
            RpcCoreErrorCode.overloaded
          )
      } finally {
        this.options.admission.release(controllerKey)
      }
      return
    }
    /** A keyed claim is made after replay/admission but before provider or schema execution. */
    let claim: IRpcIdempotencyClaim | undefined
    const key = request.route.route.idempotencyKey
    const store =
      !request.route.route.dispatchOnly && key !== undefined
        ? this.options.idempotencyStore
        : undefined
    if (store) {
      try {
        const scope =
          this.options.idempotencyScope?.({
            token: verifiedPeerKey,
            senderId: request.route.route.senderId
          }) ?? verifiedPeerKey
        const tuple = tupleKey(request.envelope.method, key!)
        claim = store.claim(scope, tuple, this.options.now())
        while (claim.status === 'pending') {
          const waiting = await this.#waitForClaim(request, controllerKey, claim)
          if (waiting === 'aborted') return
          if (waiting === undefined) {
            claim = store.claim(scope, tuple, this.options.now())
            continue
          }
          await this.#sendReplayOutcome(request, waiting)
          return
        }
        if (claim.status === 'done') {
          await this.#sendReplayOutcome(request, claim.outcome)
          return
        }
        if (claim.status === 'full') {
          await this.#sendReplayOutcome(request, {
            ok: false,
            code: RpcCoreErrorCode.overloaded,
            message: RpcCoreErrorText.idempotencyStoreFull
          })
          return
        }
      } catch (error) {
        this.options.emitFailure(error, RpcCoreErrorCode.internal)
        await this.failureResponse(request, error, RpcCoreErrorCode.internal, true)
        return
      } finally {
        if (claim?.status !== 'claimed') {
          this.options.admission.release(controllerKey)
          this.options.releaseBinding?.(verifiedPeerKey)
          this.options.markCompleted?.(request, verifiedPeerKey)
        }
      }
    }
    /** The first terminal response seals a keyed claim before physical delivery is attempted. */
    const sendResponse = async (
      response: unknown,
      transfer?: readonly unknown[]
    ): Promise<void> => {
      if (claim?.status === 'claimed') {
        const wire = response as {
          readonly ok: boolean
          readonly data?: unknown
          readonly code?: string
          readonly message?: string
          readonly serializedError?: IRpcSerializedError
        }
        const data = wire.data === undefined ? undefined : normalizePortable(wire.data)
        const outcome: IRpcIdempotencyOutcome = wire.ok
          ? { ok: true, ...(data === undefined ? {} : { data }) }
          : {
              ok: false,
              code: wire.code ?? RpcCoreErrorCode.internal,
              message: wire.message ?? RpcCoreErrorText.remoteRequestFailed,
              ...(data === undefined ? {} : { data }),
              ...(wire.serializedError === undefined ? {} : { error: wire.serializedError })
            }
        claim.settle(outcome, this.options.now())
      }
      const selectedTransfer = claim?.status === 'claimed' ? undefined : transfer
      if (selectedTransfer === undefined) await this.options.send(response)
      else await this.options.send(response, selectedTransfer)
    }
    try {
      this.options.validate(request.envelope.method, 'params', request.route.payload)
    } catch (error) {
      try {
        this.options.markCompleted?.(request, verifiedPeerKey)
        if (!request.route.route.dispatchOnly)
          await this.failureResponse(request, error, undefined, false, sendResponse)
      } finally {
        this.options.admission.release(controllerKey)
        this.options.releaseBinding?.(verifiedPeerKey)
        if (claim?.status === 'claimed') claim.release()
      }
      return
    }
    const provider = this.options.registry.getProvider(request.envelope.method)
    let responseSendStarted = false
    if (this.options.controllers.has(controllerKey)) {
      if (claim?.status === 'claimed') claim.release()
      this.options.admission.release(controllerKey)
      this.options.releaseBinding?.(verifiedPeerKey)
      this.options.markCompleted?.(request, verifiedPeerKey)
      return
    }
    /** Only ordinary request/response execution can defer a native provider signal. */
    const fast = this.options.fast === true && request.route.route.dispatchOnly !== true
    /** Existing context settlement invalidation stays independent of native cancellation. */
    let expired = false
    /** Canonical lifecycle owns the real native signal whenever it is materialized. */
    let lifecycle: IGenerationController | undefined
    /** Token and signal remain paired through completion and late reads. */
    let generation: IGenerationRequest | undefined
    /** Unread cancellation invalidates work without constructing a substitute signal. */
    let canceled = false
    /** Exactly the first routed reason survives materialization after cancellation. */
    let cancellationReason: unknown
    /** Timer ownership is unchanged; unread cancellation must still release it immediately. */
    let deadlineTimer: IEndpointTimer | undefined
    /** First read delegates native identity and original abort semantics to lifecycle. */
    const readSignal = (): IRpcAbortSignal => {
      if (generation === undefined) {
        lifecycle = createGenerationController()
        generation = lifecycle.begin()
        if (canceled) lifecycle.supersede(cancellationReason)
        else if (expired) lifecycle.complete(generation.token)
      }
      return generation.signal as IRpcAbortSignal
    }
    /** The private command defers allocation; the full provider remains its original native owner. */
    const controller: IRpcProviderController = fast
      ? {
          get signal() {
            return readSignal()
          },
          abort: (reason?: unknown) => {
            if (canceled) return
            canceled = true
            cancellationReason = reason
            lifecycle?.supersede(reason)
            if (deadlineTimer) this.options.clearTimeout(deadlineTimer)
            if (claim?.status === 'claimed') claim.release()
          }
        }
      : new AbortController()
    this.options.controllers.set(controllerKey, controller)
    const pendingAbort = this.options.consumePendingAbort?.(controllerKey)
    const timeoutMs = request.route.route.timeoutMs
    /** A provider deadline uses only endpoint monotonic timers, never wire sentAt. */
    deadlineTimer =
      timeoutMs === undefined || timeoutMs === 0
        ? undefined
        : this.options.setTimeout(() => controller.abort(new RpcTimeoutError()), timeoutMs)
    if (!fast)
      controller.signal.addEventListener(
        'abort',
        () => {
          if (deadlineTimer) this.options.clearTimeout(deadlineTimer)
          if (claim?.status === 'claimed') claim.release()
        },
        { once: true }
      )
    if (pendingAbort?.found) controller.abort(pendingAbort.reason)
    if (timeoutMs === 0) controller.abort(new RpcTimeoutError())
    const taskToken = {}
    const isExpired = (): boolean => expired || (fast ? canceled : controller.signal.aborted)
    const context = this.createContext(
      request,
      fast ? () => controller.signal : controller.signal,
      isExpired,
      taskToken,
      undefined,
      verifiedPeerKey
    )
    try {
      if (
        request.route.route.dispatchOnly &&
        this.options.registry.hasListeners(request.envelope.method)
      ) {
        await this.options.registry.dispatch(request.envelope.method, context)
        return
      }
      if (!provider) {
        if (!request.route.route.dispatchOnly) {
          responseSendStarted = true
          await this.failureResponse(
            request,
            new Error(RpcCoreErrorText.providerNotFound),
            RpcCoreErrorCode.providerNotFound,
            false,
            sendResponse
          )
        }
        return
      }
      /**
       * Exact immutable owner results are synchronous; all opaque returns keep native await
       * semantics.
       */
      const returned = provider(context)
      const result = (
        ProviderExecutor.#Result.matches(returned, taskToken) ? returned : await returned
      ) as IRpcProviderResult
      if (request.route.route.dispatchOnly) return
      if (isExpired()) return
      const response: IRpcProviderResult =
        result &&
        typeof result === 'object' &&
        (result as Partial<IBrandedProviderResult>)[providerResultBrand] === taskToken
          ? (result as IRpcProviderResult)
          : {
              ok: false,
              message: RpcCoreErrorText.providerDidNotSettle,
              code: RpcCoreErrorCode.providerNotSettled
            }
      if (response.ok) this.options.validate(request.envelope.method, 'result', response.data)
      responseSendStarted = true
      await sendResponse(
        {
          kind: RpcMessageKind.response,
          version: request.route.route.applicationVersion,
          taskId: request.envelope.id,
          senderId: this.options.id,
          targetId: request.route.route.senderId,
          method: request.envelope.method,
          ok: response.ok,
          data: response.ok ? response.data : undefined,
          message: response.ok ? undefined : response.message,
          code: response.ok ? undefined : response.code,
          ...(!response.ok && this.options.responseError
            ? { serializedError: this.#formatResultResponseError(response.code, response.message) }
            : {}),
          sentAt: this.options.timestamp(),
          ...((this.options.responseReceiverId?.(request) ?? request.route.route.receiverId) ===
          undefined
            ? {}
            : {
                receiverId:
                  this.options.responseReceiverId?.(request) ?? request.route.route.receiverId
              })
        },
        response.ok ? response.transfer : undefined
      )
    } catch (error) {
      if (!request.route.route.dispatchOnly && !responseSendStarted && !isExpired())
        await this.failureResponse(request, error, undefined, true, sendResponse)
      this.options.emitFailure(
        error,
        error instanceof RpcSchemaValidationError
          ? RpcCoreErrorCode.schemaInvalid
          : RpcCoreErrorCode.internal
      )
    } finally {
      this.options.admission.release(controllerKey)
      this.options.releaseBinding?.(verifiedPeerKey)
      this.options.controllers.delete(controllerKey)
      this.options.markCompleted?.(request, verifiedPeerKey)
      if (deadlineTimer) this.options.clearTimeout(deadlineTimer)
      if (claim?.status === 'claimed') claim.release()
      expired = true
      // Complete preserves the original provider's un-aborted signal after normal settlement.
      if (lifecycle && generation) lifecycle.complete(generation.token)
    }
  }

  private async failureResponse(
    request: IProviderRequestInput,
    error: unknown,
    explicitCode?: string,
    includeSerializedError = false,
    send: (response: unknown, transfer?: readonly unknown[]) => Promise<void> = (
      response,
      transfer
    ) =>
      transfer === undefined ? this.options.send(response) : this.options.send(response, transfer)
  ): Promise<void> {
    /** Trusted Remote/Contract failures disclose only their factory-owned code and text. */
    const localSummary = localErrorWireSummary(error)
    const schemaError = error instanceof RpcSchemaValidationError
    await send({
      kind: RpcMessageKind.response,
      version: request.route.route.applicationVersion,
      taskId: request.envelope.id,
      senderId: this.options.id,
      targetId: request.route.route.senderId,
      method: request.envelope.method,
      ok: false,
      code:
        explicitCode ??
        localSummary?.code ??
        (schemaError ? RpcCoreErrorCode.schemaInvalid : RpcCoreErrorCode.internal),
      message:
        localSummary?.message ??
        (schemaError
          ? safeString(
              safeRead<unknown>(error, 'message', ({ key, error: readError }) => {
                this.options.emitFailure(
                  readError,
                  RpcCoreErrorCode.payloadInvalid,
                  typeof key === 'string' ? key : undefined
                )
                return undefined
              }),
              RpcCoreErrorText.schemaValidationFallback,
              ({ error: conversionError }) => {
                this.options.emitFailure(conversionError, RpcCoreErrorCode.schemaInvalid)
                return undefined
              }
            )
          : RpcCoreErrorText.providerFailed),
      data: error instanceof RpcSchemaValidationError ? error.data : undefined,
      sentAt: this.options.timestamp(),
      ...(((!localSummary || localSummary.preserveSerializedError === true) &&
        (schemaError || includeSerializedError)) ||
      this.options.responseError !== undefined
        ? {
            serializedError:
              this.#formatResponseError(error, explicitCode) ??
              serializeRpcError(error, {
                report: (failure) =>
                  this.options.emitFailure(failure.error, RpcCoreErrorCode.payloadInvalid)
              })
          }
        : {}),
      ...((this.options.responseReceiverId?.(request) ?? request.route.route.receiverId) ===
      undefined
        ? {}
        : {
            receiverId: this.options.responseReceiverId?.(request) ?? request.route.route.receiverId
          })
    })
  }

  /** The selected wire formatter snapshots the original error; metadata projection never mutates it. */
  #formatResponseError(error: unknown, explicitCode?: string): IRpcSerializedError | undefined {
    /** The factory-held operation preserves its original secrecy, name, stack and cause policy. */
    const formatted = this.options.responseError?.(error)
    return formatted &&
      explicitCode &&
      error instanceof Error &&
      !('source' in error) &&
      !('code' in error)
      ? Object.freeze({ ...formatted, source: RPC_CORE_ERROR_SOURCE, code: explicitCode })
      : formatted
  }

  /**
   * Snapshot a failed result's message through the existing formatter and project its returned code
   * as wire metadata; no package error-code declaration is created.
   */
  #formatResultResponseError(
    code: string | undefined,
    message: string | undefined
  ): IRpcSerializedError | undefined {
    if (!this.options.responseError) return undefined
    return this.#formatResponseError(
      new Error(message ?? RpcCoreErrorText.remoteRequestFailed),
      code ?? RpcCoreErrorCode.internal
    )
  }

  /** A duplicate request waits with its own cancellation and deadline state. */
  async #waitForClaim(
    request: IProviderRequestInput,
    controllerKey: string,
    claim: Extract<IRpcIdempotencyClaim, { readonly status: 'pending' }>
  ): Promise<IRpcIdempotencyOutcome | 'unavailable' | undefined | 'aborted'> {
    const controller = new AbortController()
    this.options.controllers.set(controllerKey, controller)
    const pendingAbort = this.options.consumePendingAbort?.(controllerKey)
    if (pendingAbort?.found) controller.abort(pendingAbort.reason)
    const timeoutMs = request.route.route.timeoutMs
    const timer =
      timeoutMs === undefined || timeoutMs === 0
        ? undefined
        : this.options.setTimeout(() => controller.abort(new RpcTimeoutError()), timeoutMs)
    if (timeoutMs === 0) controller.abort(new RpcTimeoutError())
    try {
      if (controller.signal.aborted) return 'aborted'
      return await Promise.race([
        claim.outcome,
        new Promise<'aborted'>((resolve) => {
          controller.signal.addEventListener('abort', () => resolve('aborted'), { once: true })
        })
      ])
    } finally {
      if (timer) this.options.clearTimeout(timer)
      this.options.controllers.delete(controllerKey)
    }
  }

  /** Rebuild a response under this request's id without running the provider again. */
  async #sendReplayOutcome(
    request: IProviderRequestInput,
    retained: IRpcIdempotencyOutcome | 'unavailable'
  ): Promise<void> {
    const outcome: IRpcIdempotencyOutcome =
      retained === 'unavailable'
        ? {
            ok: false,
            code: RpcCoreErrorCode.idempotencyResultUnavailable,
            message: RpcCoreErrorText.idempotencyResultUnavailable
          }
        : retained
    await this.options.send({
      kind: RpcMessageKind.response,
      version: request.route.route.applicationVersion,
      taskId: request.envelope.id,
      senderId: this.options.id,
      targetId: request.route.route.senderId,
      method: request.envelope.method,
      ok: outcome.ok,
      data: outcome.data,
      ...(!outcome.ok
        ? {
            code: outcome.code,
            message: outcome.message,
            serializedError:
              outcome.error ?? this.#formatResultResponseError(outcome.code, outcome.message)
          }
        : {}),
      sentAt: this.options.timestamp(),
      ...((this.options.responseReceiverId?.(request) ?? request.route.route.receiverId) ===
      undefined
        ? {}
        : {
            receiverId: this.options.responseReceiverId?.(request) ?? request.route.route.receiverId
          })
    })
  }
}
