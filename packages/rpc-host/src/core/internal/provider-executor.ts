import type { IProviderConnectionQuota } from './provider-admission.js'
import { orderStringKeys } from '@migaia/utils/string'
import type { INativeAbortSignal } from '@migaia/utils/promise'
import {
  createRpcAbortError,
  createRpcContractError,
  createRpcError,
  createRpcRemoteError,
  createRpcTimeoutError,
  isLocalRpcError,
  localRpcErrorCode,
  RPC_CORE_ERROR_SOURCE,
  RpcCoreErrorCode,
  RpcError,
  RpcSchemaValidationError
} from '../errors.js'
import { deferred, type IDeferred } from '@migaia/utils/promise'
import {
  checkRpcRuntimeStreamFinish,
  checkRpcRuntimeStreamIntent
} from '@migaia/rpc-contract/stream'
import type { IRpcProviderRejection } from '../provider-admission.js'
import {
  RpcProbeDirection,
  RpcProbeKind,
  RpcProbeOutcome,
  RpcProbeStage
} from '../probe/constants.js'
import { runtimeProbeKind, type IProbeEmitter } from './probe-emitter.js'
import {
  createGenerationController,
  type IGenerationController,
  type IGenerationRequest
} from '@migaia/lifecycle'
import type { IRpcProviderController } from './plugin-shared-keys.js'

import type { RequestReplayLedger } from './request-replay-ledger.js'
import type { IRpcRuntimeEnvelope, IRpcRuntimeGeneration } from '@migaia/rpc-contract'
import type {
  IRpcRuntimeCompletion,
  IRpcRuntimeTask,
  IRpcRuntimeStep,
  IRpcRuntimeOutcome,
  IRpcRuntimeOutcomeResult,
  IRpcRuntimeStore
} from '@migaia/rpc-contract/runtime'
import type { IRpcRuntimeStepOutcome } from '@migaia/rpc-contract/v1'
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
} from '@migaia/rpc-contract/framing/v1'
import { RpcRouteProfile, RpcRouteType } from '@migaia/rpc-contract'
import { RpcCoreErrorText } from '../error-text.js'
import {
  normalizePortable,
  RpcStreamEvent,
  type IRpcEnvelope,
  type IRpcEnvelopeData,
  type IRpcSerializedError
} from '@migaia/rpc-contract'
import type { IRpcContext, IRpcProviderResult, IRpcProviderLimits } from '../typing.js'
import type { ProviderRegistry, IProviderSessionPolicy } from './provider.js'
import {
  readProviderBulkAdmission,
  readRuntimeIdempotencyScope,
  readProviderPreflight,
  retainProviderInvocation,
  completeProviderReply,
  type IProviderAdmissionReservation,
  type IProviderBulkAdmission,
  type IProviderRuntimeStream,
  type IProviderRuntimeRelay
} from './provider.js'
import type { IRpcPortableValue } from '@migaia/rpc-contract'
import { hasRpcBinaryEnvelope } from '@migaia/rpc-contract/binary/inspect'
import { prepareRpcBinary } from '@migaia/rpc-contract/binary/lazy'
import { RpcBinaryStorage } from '@migaia/rpc-contract/framing/v1'
import { createRpcBackingDigest } from './authentication-replay.js'
import { safeRead, safeString, tupleKey, runtimeTaskKey } from './safe-value.js'
import { RpcMessageKind, RpcProviderRejectionReason } from '../semantic-constants.js'
import { localErrorWireSummary } from './error-wire-metadata.js'
import { serializeRpcError, deserializeRpcError } from './error-wire-metadata.js'
import { classifyRpcContractError, RpcContractErrorCode } from '@migaia/rpc-contract'
import type {
  IRpcIdempotencyClaim,
  IRpcIdempotencyOutcome,
  IRpcIdempotencyStore
} from '../idempotency-store.js'
import type { IEndpointTimer } from './time-port.js'

/**
 * Per-request cancellation owns lazy native identity independently of executor/provider
 * registration.
 */
class LegacyProviderCancellation implements IRpcProviderController {
  /** Only exact ordinary request execution may defer native signal allocation. */
  readonly #fast: boolean
  /** The actual store claim releases on the same original cancellation or deadline. */
  readonly #claim: IRpcIdempotencyClaim | undefined
  /** Original endpoint timer capability releases its own deadline receipt. */
  readonly #clearTimeout: (timer: IEndpointTimer) => void
  /** Full mode exposes its original native controller, while fast mode exposes this owner. */
  readonly controller: IRpcProviderController
  /** Settlement invalidation remains distinct from native abort state. */
  #expired = false
  /** Native signal creation remains lazy and delegates identity/cancellation to lifecycle. */
  #lifecycle: IGenerationController | undefined
  /** Original token pairs the same signal with its completion generation. */
  #generation: IGenerationRequest | undefined
  /** Unread cancellation records first routed reason without allocating native signal. */
  #canceled = false
  /** Exact first reason is replayed if application code later reads the signal. */
  #cancellationReason: unknown
  /** One endpoint-owned deadline receipt is cleared on original cancellation and completion. */
  #deadline: IEndpointTimer | undefined

  /** Preserve original full controller allocation and fast-mode lazy signal semantics. */
  constructor(
    fast: boolean,
    claim: IRpcIdempotencyClaim | undefined,
    clearTimeout: (timer: IEndpointTimer) => void
  ) {
    this.#fast = fast
    this.#claim = claim
    this.#clearTimeout = clearTimeout
    this.controller = fast ? this : new AbortController()
  }
  /** Materialize only the actual first native signal read and retain its exact identity. */
  get signal(): INativeAbortSignal {
    if (this.#generation === undefined) {
      this.#lifecycle = createGenerationController()
      this.#generation = this.#lifecycle.begin()
      if (this.#canceled) this.#lifecycle.supersede(this.#cancellationReason)
      else if (this.#expired) this.#lifecycle.complete(this.#generation.token)
    }
    return this.#generation.signal
  }
  /** Only the first routed cancellation changes state, preserving its original reason. */
  abort(reason?: unknown): void {
    if (this.#canceled) return
    this.#canceled = true
    this.#cancellationReason = reason
    this.#lifecycle?.supersede(reason)
    this.clearDeadline()
    if (this.#claim?.status === 'claimed') this.#claim.release()
  }
  /** Store exactly the timer created by the executor at its original admission point. */
  set deadline(timer: IEndpointTimer | undefined) {
    this.#deadline = timer
  }
  /** Full-mode native abort retains its own signal and original cleanup listener. */
  watchNative(): void {
    if (!this.#fast)
      this.controller.signal.addEventListener(
        'abort',
        () => {
          this.clearDeadline()
          if (this.#claim?.status === 'claimed') this.#claim.release()
        },
        { once: true }
      )
  }
  /** The context can retain this receiver-independent predicate without a state-capturing factory. */
  readonly isExpired = (): boolean =>
    this.#expired || (this.#fast ? this.#canceled : this.controller.signal.aborted)
  /** Endpoint clearing preserves the original receipt even when called again at finalization. */
  clearDeadline(): void {
    if (this.#deadline) this.#clearTimeout(this.#deadline)
  }
  /** Normal completion expires the context without aborting its original un-aborted signal. */
  complete(): void {
    this.#expired = true
    if (this.#lifecycle && this.#generation) this.#lifecycle.complete(this.#generation.token)
  }
}

/** Canonical request plus WebRPC-owned route data consumed by provider execution. */
export type IProviderRequestInput = Readonly<{
  readonly envelope: Extract<IRpcEnvelope, { readonly kind: 'request' }>
  readonly route: IRpcEnvelopeData
}>
type IProviderAdmission = {
  acquire(taskKey: string, peerKey: string, connectionQuota?: IProviderConnectionQuota): boolean
  release(taskKey: string): void
  acquireMany?(
    taskKeys: readonly string[],
    peerKey: string,
    connectionQuota?: IProviderConnectionQuota
  ): boolean
  enqueueOrder?(orderKey: string, start: () => void): () => void
}
type IControllerRegistry = {
  has(key: string): boolean
  set(key: string, controller: IRpcProviderController): void
  delete(key: string): void
}

type IProviderExecutorOptions<TTargetId extends string> = {
  /** The attachment passes its construction-cached emitter without another port lookup. */
  readonly probe?: IProbeEmitter
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
  /** Only an original session receipt may select its existing shared scope registry. */
  readonly sessionAdmission?: (policy: IProviderSessionPolicy) => IProviderAdmission | undefined
  /** Local owner notification for the three canonical admission refusals. */
  readonly onRejected?: (
    rejection: IRpcProviderRejection,
    observer?: IRpcProviderLimits['onRejected']
  ) => void | Promise<void>
  readonly retainBinding?: (verifiedPeerKey: string) => boolean
  readonly releaseBinding?: (verifiedPeerKey: string) => void
  /** Selects response receiver identity for composed attachment admission. */
  readonly responseReceiverId?: (request: IProviderRequestInput) => string | undefined
  readonly idempotencyStore?: IRpcIdempotencyStore
  /** Only the attachment-created default memory store is necessarily replaced with native execution. */
  readonly runtimeDefaultMemoryStore?: boolean
  readonly idempotencyScope?: (admission: Readonly<{ token: string; senderId: string }>) => string
}
/** Only the exact context-created result retains its original task's settlement authority. */
const providerResultBrand = new WeakMap<IRpcProviderResult, object>()
/** Bound transfer inspection to the original protocol budget before provider delivery. */
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
  /** Response routing derives only from the admitted original request identity. */
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
      /** Keep the canonical serialization result before selecting its wire payload. */
      const encoded = prepared.manifest.envelope
      /** Portable wire data is normalized once at the original outcome-sealing boundary. */
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
  /** Select the existing scalar, notification or stream wire behavior without another dispatch path. */
  const mode = envelope.task.mode
  return JSON.stringify([mode, steps], (_key, value: unknown) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value
    return Object.fromEntries(
      orderStringKeys(Object.keys(value)).map((key) => [key, Reflect.get(value, key)])
    )
  })
}

/** Normalizes provider-owned metadata before it can cross the transport boundary. */
function normalizeTransfer(value: readonly unknown[] | undefined): readonly unknown[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length > maxProviderTransferItems)
    throw createRpcContractError(RpcCoreErrorText.providerTransferMustBeABoundedArray)
  /** Copy only the original normalized outcome facts used by idempotency replay. */
  const snapshot = Array.from(value)
  return Object.freeze(snapshot)
}

/** Validates and snapshots failure metadata created by untrusted JavaScript callers. */
function normalizeFailure(
  message: string,
  code: string
): { readonly message: string; readonly code: string } {
  if (typeof message !== 'string' || typeof code !== 'string')
    throw createRpcContractError(RpcCoreErrorText.providerFailureMessageAndCodeMustBeStrings)
  return Object.freeze({ message, code })
}

/** Runtime task records expose their existing liveness without another captured callback. */
type IProviderContextLifetime = Readonly<{ expired(): boolean }>
/** A lazy runtime record supplies its original native signal only when the public getter reads it. */
type IProviderContextSignal = Readonly<{ readSignal(): INativeAbortSignal }>

/** Context callbacks preserve the original callable lifetime source as well as owned task records. */
function contextExpired(source: (() => boolean) | IProviderContextLifetime): boolean {
  return typeof source === 'function' ? source() : source.expired()
}

/** Only this exact owner-created result can omit the original nonsemantic await. */
class ProviderResult extends class {
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
    return typeof value === 'object' && value !== null && #token in value && value.#token === token
  }
}

/** Owns inbound provider execution and response settlement. */
export class ProviderExecutor<TTargetId extends string> {
  /** Stable context behavior lives on one record; the public object keeps its original own shape. */
  static readonly #Context = class<TId extends string> {
    /** Original endpoint callbacks and native policy owners remain held by this context's executor. */
    readonly #owner: ProviderExecutor<TId>
    /** Signal source is the original signal/callable or the same lazy runtime execution record. */
    readonly #signal: INativeAbortSignal | (() => INativeAbortSignal) | IProviderContextSignal
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
      signal: INativeAbortSignal | (() => INativeAbortSignal) | IProviderContextSignal,
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
        localEndpointId: owner.options.id,
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
        signal: undefined as unknown as INativeAbortSignal,
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
    signal(): INativeAbortSignal {
      return typeof this.#signal === 'function'
        ? this.#signal()
        : ProviderExecutor.#RuntimeExecution.signalFor(this.#signal)
    }
    /** Expired results retain their original unfrozen shape, message, code and task identity. */
    #expiredResult(): IRpcProviderResult {
      /** Expiry still returns the original unfrozen failure record without copyable authority. */
      const result: IRpcProviderResult = {
        ok: false,
        message: RpcCoreErrorText.providerContextExpired,
        code: RpcCoreErrorCode.contextExpired
      }
      providerResultBrand.set(result, this.#taskToken)
      return result
    }
    /** Exact owner-created success retains the original transfer snapshot and frozen public shape. */
    success(
      data?: unknown,
      options?: { readonly transfer?: readonly unknown[] }
    ): IRpcProviderResult {
      if (contextExpired(this.#expired)) return this.#expiredResult()
      /** Business and transfer values retain the original immutable result identity. */
      const result = Object.freeze({
        ok: true as const,
        data,
        transfer: normalizeTransfer(options?.transfer)
      })
      providerResultBrand.set(result, this.#taskToken)
      new ProviderResult(result, this.#taskToken)
      return result
    }
    /** Untrusted failure metadata still enters the original message/code validation owner once. */
    failed(message: string, code: string): IRpcProviderResult {
      if (contextExpired(this.#expired)) return this.#expiredResult()
      /** Keep the original primary failure while cleanup and terminal delivery complete. */
      const failure = normalizeFailure(message, code)
      /** This exact immutable failure remains associated with the context's original task. */
      const result = Object.freeze({
        ok: false as const,
        message: failure.message,
        code: failure.code
      })
      providerResultBrand.set(result, this.#taskToken)
      new ProviderResult(result, this.#taskToken)
      return result
    }
    /** Dispatch retains original default peers, supplied target validation and expired no-op. */
    dispatch({ id, method, data }: { id?: string; method: string; data: unknown }): void {
      if (contextExpired(this.#expired)) return
      if (id !== undefined) {
        if (typeof id !== 'string' || id.length === 0)
          throw createRpcContractError(RpcCoreErrorText.dispatchTargetIdMustBeANonEmptyString)
        this.#owner.options.dispatch(id as TId, method, data)
        return
      }
      for (const peer of this.#owner.options.peers)
        if (peer !== this.#senderId) this.#owner.options.dispatch(peer, method, data)
    }
  }

  /** One admitted legacy request owns its claim, response sealing and original cleanup. */
  static readonly #LegacyExecution = class<TId extends string> {
    /** The canonical executor keeps transport, registry and error ownership. */
    readonly #owner: ProviderExecutor<TId>
    /** Original inbound request remains unchanged across asynchronous store and provider work. */
    readonly #request: IProviderRequestInput
    /** Verified native admission identity is captured before any application callback. */
    readonly #verifiedPeerKey: string
    /** Once-read session policy selects the same claim and quota owners. */
    #policy: IProviderSessionPolicy | undefined
    /** The selected existing quota owner remains paired with its original release. */
    #admission!: IProviderAdmission
    /** Original observation start is allocated only when message probes are enabled. */
    #probeStartedAt!: number
    /** One tuple fences replay, provider cancellation and terminal cleanup. */
    #controllerKey!: string
    /** The canonical store's sole claim remains visible to the response-sealing callback. */
    #claim: IRpcIdempotencyClaim | undefined

    /** Capture identity only; execute preserves the original asynchronous error boundary. */
    constructor(
      owner: ProviderExecutor<TId>,
      request: IProviderRequestInput,
      verifiedPeerKey: string
    ) {
      this.#owner = owner
      this.#request = request
      this.#verifiedPeerKey = verifiedPeerKey
    }

    /** Admit and claim before synchronously entering the original provider invocation. */
    async execute(): Promise<void> {
      /** A legacy operation borrows the same accepted policy for admission, claim and release. */
      this.#policy = this.#owner.options.registry.sessionPolicy?.(
        this.#request.route.route.senderId
      )
      this.#admission =
        (this.#policy && this.#owner.options.sessionAdmission?.(this.#policy)) ??
        this.#owner.options.admission
      /** Logical duration uses the executor's existing monotonic clock only when observed. */
      this.#probeStartedAt =
        this.#owner.#probe !== undefined &&
        (this.#owner.#probe.mask & (1 << RpcProbeStage.message)) !== 0
          ? this.#owner.options.now()
          : -1
      /** Successful admission keeps the original synchronous provider-start path. */
      const admitted = this.#admit()
      if (admitted !== true) {
        await admitted
        return
      }
      /** A keyed claim is made after replay/admission but before provider or schema execution. */
      if (
        this.#owner.#probe !== undefined &&
        (this.#owner.#probe.mask & (1 << RpcProbeStage.message)) !== 0
      )
        this.#owner.#probe.message(
          RpcProbeDirection.inbound,
          this.#request.route.route.dispatchOnly ? RpcProbeKind.notify : RpcProbeKind.request,
          RpcProbeOutcome.admitted,
          this.#request.envelope.id,
          this.#request.envelope.method,
          this.#request.route.route.senderId,
          this.#request.route.route.targetId,
          this.#request.route.route.trace,
          -1,
          undefined,
          undefined
        )
      /**
       * This original tuple identifies only the admitted request or stream in its existing
       * registry.
       */
      const key = this.#request.route.route.idempotencyKey
      /** The accepted policy selects the canonical idempotency store for this original request. */
      const store =
        !this.#request.route.route.dispatchOnly && key !== undefined
          ? (this.#policy?.idempotency?.store ?? this.#owner.options.idempotencyStore)
          : undefined
      if (store) {
        try {
          /** The original scope fences this operation lifetime and its inherited cancellation. */
          const scope =
            (this.#policy?.idempotency?.scope ?? this.#owner.options.idempotencyScope)?.({
              token: this.#verifiedPeerKey,
              senderId: this.#request.route.route.senderId
            }) ?? this.#verifiedPeerKey
          /** Method and idempotency key retain the original store namespace and collision rules. */
          const tuple = tupleKey(this.#request.envelope.method, key!)
          this.#claim = store.claim(scope, tuple, this.#owner.options.now())
          while (this.#claim.status === 'pending') {
            /** A duplicate keeps its own cancellation while awaiting the original store owner. */
            const waiting = await this.#waitForClaim(
              this.#request,
              this.#controllerKey,
              this.#claim
            )
            if (waiting === 'aborted') return
            if (waiting === undefined) {
              this.#claim = store.claim(scope, tuple, this.#owner.options.now())
              continue
            }
            await this.#sendReplayOutcome(this.#request, waiting)
            return
          }
          if (this.#claim.status === 'done') {
            await this.#sendReplayOutcome(this.#request, this.#claim.outcome)
            return
          }
          if (this.#claim.status === 'full') {
            await this.#sendReplayOutcome(this.#request, {
              ok: false,
              code: RpcCoreErrorCode.overloaded,
              message: RpcCoreErrorText.idempotencyStoreFull
            })
            return
          }
        } catch (error) {
          this.#owner.options.emitFailure(error, RpcCoreErrorCode.internal)
          await this.#owner.failureResponse(this.#request, error, RpcCoreErrorCode.internal, true)
          return
        } finally {
          if (this.#claim?.status !== 'claimed') {
            this.#admission.release(this.#controllerKey)
            this.#owner.options.releaseBinding?.(this.#verifiedPeerKey)
            this.#owner.options.markCompleted?.(this.#request, this.#verifiedPeerKey)
          }
        }
      }
      return this.#invoke()
    }

    /** Preflight and quota refusal cannot allocate or release a different request's leases. */
    #admit(): true | void | Promise<void> {
      /**
       * Forward refusal runs synchronously before replay or provider admission can allocate a
       * lease.
       */
      try {
        readProviderPreflight(
          this.#owner.options.registry.getProvider(
            this.#request.envelope.method,
            this.#request.route.route.senderId
          )
        )?.(this.#request.route.route)
      } catch (error) {
        this.#observeLegacyRequest(
          this.#request,
          RpcProbeOutcome.failed,
          this.#probeStartedAt,
          error
        )
        this.#owner.options.emitFailure(
          error,
          isLocalRpcError(error, RpcError) ? localRpcErrorCode(error)! : RpcCoreErrorCode.internal
        )
        if (!this.#request.route.route.dispatchOnly)
          return this.#owner.failureResponse(this.#request, error, undefined, true)
        return
      }
      this.#controllerKey = tupleKey(
        this.#verifiedPeerKey,
        this.#request.route.route.senderId,
        this.#request.envelope.id
      )
      if (this.#owner.options.isReplay?.(this.#request, this.#verifiedPeerKey)) return
      if (
        this.#owner.options.admitReplay &&
        !this.#owner.options.admitReplay(this.#request, this.#verifiedPeerKey)
      ) {
        this.#owner.#notifyRejection(
          this.#request,
          this.#verifiedPeerKey,
          this.#controllerKey,
          RpcProviderRejectionReason.replayLedgerFull
        )
        if (!this.#request.route.route.dispatchOnly)
          return this.#owner.failureResponse(
            this.#request,
            new Error(RpcCoreErrorText.requestReplayLedgerIsFull),
            RpcCoreErrorCode.overloaded
          )
        return
      }
      /** A genuine native session lends its own physical capacity without changing peer identity. */
      const acquired = this.#policy?.connectionQuota
        ? this.#admission.acquire(
            this.#controllerKey,
            this.#verifiedPeerKey,
            this.#policy.connectionQuota
          )
        : this.#admission.acquire(this.#controllerKey, this.#verifiedPeerKey)
      if (!acquired) {
        this.#owner.#notifyRejection(
          this.#request,
          this.#verifiedPeerKey,
          this.#controllerKey,
          RpcProviderRejectionReason.concurrency
        )
        if (!this.#request.route.route.dispatchOnly)
          return this.#owner.failureResponse(
            this.#request,
            new Error(RpcCoreErrorText.providerAdmissionLimitReached),
            RpcCoreErrorCode.overloaded
          )
        return
      }
      if (
        this.#owner.options.retainBinding &&
        !this.#owner.options.retainBinding(this.#verifiedPeerKey)
      ) {
        this.#owner.#notifyRejection(
          this.#request,
          this.#verifiedPeerKey,
          this.#controllerKey,
          RpcProviderRejectionReason.bindingExpired
        )
        return this.#rejectBinding()
      }
      return true
    }

    /** A refused binding releases its acquired quota after the original failure delivery. */
    async #rejectBinding(): Promise<void> {
      try {
        if (!this.#request.route.route.dispatchOnly)
          await this.#owner.failureResponse(
            this.#request,
            new Error(RpcCoreErrorText.verifiedPeerBindingExpired),
            RpcCoreErrorCode.overloaded
          )
      } finally {
        this.#admission.release(this.#controllerKey)
      }
    }

    /** The first terminal response seals a keyed claim before physical delivery is attempted. */
    readonly #sendResponse = async (
      response: unknown,
      transfer?: readonly unknown[]
    ): Promise<void> => {
      if (this.#claim?.status === 'claimed') {
        /** The original terminal envelope supplies the exact portable outcome and error graph. */
        const wire = response as {
          readonly ok: boolean
          readonly data?: unknown
          readonly code?: string
          readonly message?: string
          readonly serializedError?: IRpcSerializedError
        }
        /** Portable wire data is normalized once at the original outcome-sealing boundary. */
        const data = wire.data === undefined ? undefined : normalizePortable(wire.data)
        /** Retain only canonical completed wire facts; never rerun business work during replay. */
        const outcome: IRpcIdempotencyOutcome = wire.ok
          ? { ok: true, ...(data === undefined ? {} : { data }) }
          : {
              ok: false,
              code: wire.code ?? RpcCoreErrorCode.internal,
              message: wire.message ?? RpcCoreErrorText.remoteRequestFailed,
              ...(data === undefined ? {} : { data }),
              ...(wire.serializedError === undefined ? {} : { error: wire.serializedError })
            }
        this.#claim.settle(outcome, this.#owner.options.now())
      }
      /** A sealed keyed outcome retains its replay bytes instead of detaching their backing. */
      const selectedTransfer = this.#claim?.status === 'claimed' ? undefined : transfer
      if (selectedTransfer === undefined) await this.#owner.options.send(response)
      else await this.#owner.options.send(response, selectedTransfer)
    }

    /** Schema admission and cancellation publication precede the first business callback. */
    async #invoke(): Promise<void> {
      try {
        this.#owner.options.validate(
          this.#request.envelope.method,
          'params',
          this.#request.route.payload
        )
      } catch (error) {
        this.#observeLegacyRequest(
          this.#request,
          RpcProbeOutcome.failed,
          this.#probeStartedAt,
          error
        )
        try {
          this.#owner.options.markCompleted?.(this.#request, this.#verifiedPeerKey)
          if (!this.#request.route.route.dispatchOnly)
            await this.#owner.failureResponse(
              this.#request,
              error,
              undefined,
              false,
              this.#sendResponse
            )
        } finally {
          this.#admission.release(this.#controllerKey)
          this.#owner.options.releaseBinding?.(this.#verifiedPeerKey)
          if (this.#claim?.status === 'claimed') this.#claim.release()
        }
        return
      }
      /** Select the original registered callback before any business invocation. */
      const provider = this.#owner.options.registry.getProvider(
        this.#request.envelope.method,
        this.#request.route.route.senderId
      )
      if (this.#owner.options.controllers.has(this.#controllerKey)) {
        if (this.#claim?.status === 'claimed') this.#claim.release()
        this.#admission.release(this.#controllerKey)
        this.#owner.options.releaseBinding?.(this.#verifiedPeerKey)
        this.#owner.options.markCompleted?.(this.#request, this.#verifiedPeerKey)
        return
      }
      /** Only ordinary request/response execution can defer a native provider signal. */
      const fast =
        this.#owner.options.fast === true && this.#request.route.route.dispatchOnly !== true
      /** One request cancellation owner retains the same lazy native signal, timer and claim. */
      const cancellation = new LegacyProviderCancellation(fast, this.#claim, (timer) =>
        this.#owner.options.clearTimeout(timer)
      )
      /**
       * The fast controller is the cancellation owner; full mode retains the original native
       * object.
       */
      const controller = cancellation.controller
      this.#owner.options.controllers.set(this.#controllerKey, controller)
      /** Consume the original retained cancellation before business work can start. */
      const pendingAbort = this.#owner.options.consumePendingAbort?.(this.#controllerKey)
      /** Use the original relative budget with the endpoint monotonic timer. */
      const timeoutMs = this.#request.route.route.timeoutMs
      /** A provider deadline uses only endpoint monotonic timers, never wire sentAt. */
      cancellation.deadline =
        timeoutMs === undefined || timeoutMs === 0
          ? undefined
          : this.#owner.options.setTimeout(
              () => controller.abort(createRpcTimeoutError()),
              timeoutMs
            )
      cancellation.watchNative()
      if (pendingAbort?.found) controller.abort(pendingAbort.reason)
      if (timeoutMs === 0) controller.abort(createRpcTimeoutError())
      /** Only results created by this exact invocation may use the synchronous settlement path. */
      const taskToken = {}
      /** The existing cancellation owner alone decides whether this response may still settle. */
      const isExpired = cancellation.isExpired
      /**
       * The canonical provider context retains this invocation identity, signal and settlement
       * brand.
       */
      const context = this.#owner.createContext(
        this.#request,
        fast ? () => controller.signal : controller.signal,
        isExpired,
        taskToken,
        undefined,
        this.#verifiedPeerKey
      )
      return this.#runProvider(context, provider, cancellation, taskToken)
    }

    /** Invoke once and retain the exact response, probe and cleanup ordering across every exit. */
    async #runProvider(
      context: IRpcContext,
      provider: ReturnType<ProviderRegistry['getProvider']>,
      cancellation: LegacyProviderCancellation,
      taskToken: object
    ): Promise<void> {
      /** Cancellation liveness remains on the original request cancellation owner. */
      const isExpired = cancellation.isExpired
      /** Delivery starts once per original invocation; it suppresses only a second failure frame. */
      let responseSendStarted = false
      /**
       * The original business error is retained directly; serialization cannot replace its
       * identity.
       */
      let probeError: unknown
      /** JavaScript permits throwing undefined, so failure is distinct from its optional value. */
      let probeFailed = false
      try {
        if (
          this.#request.route.route.dispatchOnly &&
          this.#owner.options.registry.hasListeners(this.#request.envelope.method)
        ) {
          await this.#owner.options.registry.dispatch(this.#request.envelope.method, context)
          return
        }
        if (!provider) {
          if (!this.#request.route.route.dispatchOnly) {
            responseSendStarted = true
            await this.#owner.failureResponse(
              this.#request,
              new Error(RpcCoreErrorText.providerNotFound),
              RpcCoreErrorCode.providerNotFound,
              false,
              this.#sendResponse
            )
          }
          return
        }
        /**
         * Exact immutable owner results are synchronous; all opaque returns keep native await
         * semantics.
         */
        const returned = provider(context)
        /** Observe exactly one original provider or iterator result before terminal selection. */
        const result = (
          ProviderResult.matches(returned, taskToken) ? returned : await returned
        ) as IRpcProviderResult
        if (this.#request.route.route.dispatchOnly) return
        if (isExpired()) return
        /** Only a correctly branded result can select the original success or failure envelope. */
        const response: IRpcProviderResult =
          result && typeof result === 'object' && providerResultBrand.get(result) === taskToken
            ? (result as IRpcProviderResult)
            : {
                ok: false,
                message: RpcCoreErrorText.providerDidNotSettle,
                code: RpcCoreErrorCode.providerNotSettled
              }
        if (response.ok)
          this.#owner.options.validate(this.#request.envelope.method, 'result', response.data)
        responseSendStarted = true
        await this.#sendResponse(
          {
            kind: RpcMessageKind.response,
            version: this.#request.route.route.applicationVersion,
            taskId: this.#request.envelope.id,
            senderId: this.#owner.options.id,
            targetId: this.#request.route.route.senderId,
            method: this.#request.envelope.method,
            ok: response.ok,
            data: response.ok ? response.data : undefined,
            message: response.ok ? undefined : response.message,
            code: response.ok ? undefined : response.code,
            ...(!response.ok && this.#owner.options.responseError
              ? {
                  serializedError: this.#formatResultResponseError(response.code, response.message)
                }
              : {}),
            sentAt: this.#owner.options.timestamp(),
            ...((this.#owner.options.responseReceiverId?.(this.#request) ??
              this.#request.route.route.receiverId) === undefined
              ? {}
              : {
                  receiverId:
                    this.#owner.options.responseReceiverId?.(this.#request) ??
                    this.#request.route.route.receiverId
                })
          },
          response.ok ? response.transfer : undefined
        )
      } catch (error) {
        probeError = error
        probeFailed = true
        if (!this.#request.route.route.dispatchOnly && !responseSendStarted && !isExpired())
          await this.#owner.failureResponse(
            this.#request,
            error,
            undefined,
            true,
            this.#sendResponse
          )
        this.#owner.options.emitFailure(
          error,
          isLocalRpcError(error, RpcSchemaValidationError)
            ? RpcCoreErrorCode.schemaInvalid
            : RpcCoreErrorCode.internal
        )
      } finally {
        completeProviderReply(context)
        this.#observeLegacyRequest(
          this.#request,
          probeFailed ? RpcProbeOutcome.failed : RpcProbeOutcome.settled,
          this.#probeStartedAt,
          probeError
        )
        this.#admission.release(this.#controllerKey)
        this.#owner.options.releaseBinding?.(this.#verifiedPeerKey)
        this.#owner.options.controllers.delete(this.#controllerKey)
        this.#owner.options.markCompleted?.(this.#request, this.#verifiedPeerKey)
        cancellation.clearDeadline()
        if (this.#claim?.status === 'claimed') this.#claim.release()
        cancellation.complete()
      }
    }
    /** Observe one original legacy request outcome without copying its timing or failure identity. */
    #observeLegacyRequest(
      request: IProviderRequestInput,
      outcome: typeof RpcProbeOutcome.failed | typeof RpcProbeOutcome.settled,
      startedAt: number,
      error: unknown
    ): void {
      if (
        this.#owner.#probe !== undefined &&
        (this.#owner.#probe.mask & (1 << RpcProbeStage.message)) !== 0
      )
        this.#owner.#probe.message(
          RpcProbeDirection.inbound,
          request.route.route.dispatchOnly ? RpcProbeKind.notify : RpcProbeKind.request,
          outcome,
          request.envelope.id,
          request.envelope.method,
          request.route.route.senderId,
          request.route.route.targetId,
          request.route.route.trace,
          startedAt < 0 ? 0 : this.#owner.options.now() - startedAt,
          undefined,
          error
        )
    }

    /** A duplicate request waits with its own cancellation and deadline state. */
    async #waitForClaim(
      request: IProviderRequestInput,
      controllerKey: string,
      claim: Extract<IRpcIdempotencyClaim, { readonly status: 'pending' }>
    ): Promise<IRpcIdempotencyOutcome | 'unavailable' | undefined | 'aborted'> {
      /** This original cancellation controller stays paired with its registered request key. */
      const controller = new AbortController()
      this.#owner.options.controllers.set(controllerKey, controller)
      /** Consume the original retained cancellation before business work can start. */
      const pendingAbort = this.#owner.options.consumePendingAbort?.(controllerKey)
      if (pendingAbort?.found) controller.abort(pendingAbort.reason)
      /** Use the original relative budget with the endpoint monotonic timer. */
      const timeoutMs = request.route.route.timeoutMs
      /** Retain the original deadline receipt so terminal cleanup clears exactly that timer. */
      const timer =
        timeoutMs === undefined || timeoutMs === 0
          ? undefined
          : this.#owner.options.setTimeout(
              () => controller.abort(createRpcTimeoutError()),
              timeoutMs
            )
      if (timeoutMs === 0) controller.abort(createRpcTimeoutError())
      try {
        if (controller.signal.aborted) return 'aborted'
        return await Promise.race([
          claim.outcome,
          new Promise<'aborted'>((resolve) => {
            controller.signal.addEventListener('abort', () => resolve('aborted'), { once: true })
          })
        ])
      } finally {
        if (timer) this.#owner.options.clearTimeout(timer)
        this.#owner.options.controllers.delete(controllerKey)
      }
    }

    /** Rebuild a response under this request's id without running the provider again. */
    async #sendReplayOutcome(
      request: IProviderRequestInput,
      retained: IRpcIdempotencyOutcome | 'unavailable'
    ): Promise<void> {
      /** Retain only canonical completed wire facts; never rerun business work during replay. */
      const outcome: IRpcIdempotencyOutcome =
        retained === 'unavailable'
          ? {
              ok: false,
              code: RpcCoreErrorCode.idempotencyResultUnavailable,
              message: RpcCoreErrorText.idempotencyResultUnavailable
            }
          : retained
      await this.#owner.options.send({
        kind: RpcMessageKind.response,
        version: request.route.route.applicationVersion,
        taskId: request.envelope.id,
        senderId: this.#owner.options.id,
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
        sentAt: this.#owner.options.timestamp(),
        ...((this.#owner.options.responseReceiverId?.(request) ??
          request.route.route.receiverId) === undefined
          ? {}
          : {
              receiverId:
                this.#owner.options.responseReceiverId?.(request) ?? request.route.route.receiverId
            })
      })
    }
    /**
     * Snapshot a failed result's message through the existing formatter and project its returned
     * code as wire metadata; no package error-code declaration is created.
     */
    #formatResultResponseError(
      code: string | undefined,
      message: string | undefined
    ): IRpcSerializedError | undefined {
      if (!this.#owner.options.responseError) return undefined
      return this.#owner.#formatResponseError(
        new Error(message ?? RpcCoreErrorText.remoteRequestFailed),
        code ?? RpcCoreErrorCode.internal
      )
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
    /** Capture the accepted source's original policy once for this admitted task lifetime. */
    readonly #policy: IProviderSessionPolicy | undefined
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
      this.#policy = owner.options.registry.sessionPolicy?.(envelope.route.senderId)
    }
    /** Complete task identity is still selected by the original inbound grammar. */
    get runtimeTask(): IRpcRuntimeTask {
      return this.#envelope.task
    }
    /** Actual reads retain native signal identity; ordinary unread success allocates none. */
    get signal(): INativeAbortSignal {
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
    readSignal(): INativeAbortSignal {
      return this.#native.signal
    }
    /** Non-record signals preserve the original object and perform no added property probing. */
    static signalFor(value: INativeAbortSignal | IProviderContextSignal): INativeAbortSignal {
      return #nativeResource in value ? value.#native.signal : (value as INativeAbortSignal)
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
      this.#selectAdmission()
      try {
        this.#preflight()
      } catch (error) {
        this.#report(error)
        await this.#respond(this.#failed(error))
        return
      }
      /** Refusals settle only after their original quota rollback; success never yields here. */
      const refused = this.#admitTask()
      if (refused !== undefined) {
        if (refused !== false) await this.#respond(refused)
        return
      }
      this.#activateController()
      /** Retired or cancelled preparation never publishes a new key claim. */
      if (this.#state !== 'queued') return
      try {
        /** All original quotas are committed before a key becomes visible; no provider has started. */
        const key = this.#envelope.options.idempotencyKey
        if (key !== undefined && !this.#relay) {
          /** The canonical configured store owns the whole queued lifetime, including cancellation. */
          const store = this.#policy?.idempotency?.store ?? this.#owner.options.idempotencyStore
          if (!store?.lookup)
            throw createRpcError(
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
          /**
           * Binary preparation may yield; ordinary fingerprints preserve the synchronous claim
           * path.
           */
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
              this.#ports.generation.providerId,
              this.#policy
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
            throw createRpcError(RpcCoreErrorCode.overloaded, RpcCoreErrorText.idempotencyStoreFull)
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
        this.#reserved!.rollback()
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

    /** One synchronous replay/quota transaction reserves native groups or returns its refusal. */
    #admitTask(): IRpcRuntimeCompletion | false | undefined {
      /** Duplicates never acquire the original task's release ownership. */
      if (
        this.#ports.replay.has(this.#memberKeys[0]!, this.#owner.options.now()) ||
        this.#owner.options.controllers.has(this.#controllerKey)
      )
        return false
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
        return this.#failed(
          createRpcError(RpcCoreErrorCode.overloaded, RpcCoreErrorText.requestReplayLedgerIsFull)
        )
      }
      /** Group members reserve both logical and physical dimensions in the original transaction. */
      const acquired = this.#policy?.connectionQuota
        ? this.#admission.acquireMany!(
            this.#memberKeys,
            this.#peerKey,
            this.#policy.connectionQuota
          )
        : this.#admission.acquireMany!(this.#memberKeys, this.#peerKey)
      if (!acquired) {
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
        return this.#failed(
          createRpcError(
            RpcCoreErrorCode.overloaded,
            RpcCoreErrorText.providerAdmissionLimitReached
          )
        )
      }
      if (
        this.#owner.#probe !== undefined &&
        (this.#owner.#probe.mask & (1 << RpcProbeStage.message)) !== 0
      )
        this.#owner.#probe.message(
          RpcProbeDirection.inbound,
          runtimeProbeKind(this.#envelope),
          RpcProbeOutcome.admitted,
          this.#envelope.id,
          this.#envelope.task.method,
          this.#envelope.route.senderId,
          this.#envelope.route.targetId,
          undefined,
          -1,
          undefined,
          undefined
        )
      this.#bulkRegistrations =
        this.#envelope.kind === RpcRuntimeKind.group
          ? this.#steps.map((step) =>
              readProviderBulkAdmission(
                this.#owner.options.registry.getProvider(
                  step.method,
                  this.#envelope.route.senderId
                )!
              )
            )
          : undefined
      this.#bulkReservations = new Map<IProviderBulkAdmission, IProviderAdmissionReservation>()
      try {
        this.#reserveBulk()
      } catch (error) {
        for (const reservation of this.#bulkReservations.values()) reservation.release()
        for (const key of this.#memberKeys) this.#admission.release(key)
        this.#reserved.rollback()
        this.#report(error)
        return this.#failed(error)
      }
    }

    /** Select original identities and clocks before validation or quota publication. */
    #selectAdmission(): void {
      this.#admission =
        (this.#policy && this.#owner.options.sessionAdmission?.(this.#policy)) ??
        this.#ports.admission ??
        this.#owner.options.admission
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
    }

    /** Validate the complete group and forwarding policy before either admission quota changes. */
    #preflight(): void {
      if (
        !sameGeneration(this.#envelope.task.targetGeneration, this.#ports.generation) ||
        !sameGeneration(this.#envelope.task.callerGeneration, this.#ports.callerGeneration)
      )
        throw createRpcError(
          RpcCoreErrorCode.providerGenerationMismatch,
          RpcCoreErrorText.providerGenerationMismatch
        )
      if (
        !this.#admission.acquireMany ||
        (this.#envelope.options.orderKey !== undefined && !this.#admission.enqueueOrder)
      )
        throw createRpcError(
          RpcCoreErrorCode.capabilityUnsupported,
          RpcCoreErrorText.capabilityUnsupported
        )
      /** Whitelist/schema/forward preflight finishes for the entire set before either quota changes. */
      for (const step of this.#steps) {
        /** Select the original registered callback before any business invocation. */
        const provider =
          this.#envelope.task.mode === RpcRuntimeMode.stream
            ? this.#owner.options.registry.streamProviders.get(
                `${RpcRuntimeStreamPrefix}${step.method}`
              )
            : this.#owner.options.registry.getProvider(step.method, this.#envelope.route.senderId)
        if (!provider)
          throw createRpcError(RpcCoreErrorCode.providerNotFound, RpcCoreErrorText.providerNotFound)
        this.#owner.options.validate(step.method, 'params', step.payload)
        readProviderPreflight(provider)?.(runtimeRequestInput(this.#envelope, step).route.route)
      }
      this.#relay = this.#owner.options.registry.runtimeRelay?.(this.#envelope)
    }

    /** Reserve each actual native policy once for its complete original member set. */
    #reserveBulk(): void {
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
    }

    /** Publish the original controller and apply retained cancellation before any claim. */
    #activateController(): void {
      this.#state = 'queued'
      this.#sealed = false
      this.#preparingFingerprint = false
      this.#prepareReachedHead = false
      this.#completion = deferred<void>()
      if (this.#envelope.task.mode === RpcRuntimeMode.stream)
        this.streamIntent = (payload) => {
          if (payload.event !== RpcRuntimeFinish) return Promise.resolve()
          /** Protocol validation reads the actual finish and the admitted start options. */
          const error = checkRpcRuntimeStreamFinish(this.#envelope.options)
          if (error) throw error
          this.cancelIntent(
            payload.reason === undefined ? undefined : deserializeRpcError(payload.reason)
          )
          return Promise.resolve()
        }
      this.#owner.options.controllers.set(this.#controllerKey, this)
      /** Consume the original retained cancellation before business work can start. */
      const pendingAbort = this.#owner.options.consumePendingAbort?.(
        this.#controllerKey,
        runtimeTaskKey(this.#envelope.task)
      )
      if (pendingAbort?.found) {
        /** The retained intent is protocol data; only this owner performs its cancellation effects. */
        const error = checkRpcRuntimeStreamIntent(pendingAbort, this.#envelope.options)
        if (!error) this.#cancelIntent(pendingAbort.reason)
        else {
          /** A forged early finish cannot opt an order-only stream into discard or cancellation. */
          this.#report(error)
          if (pendingAbort.cancelReason) this.#cancelIntent(pendingAbort.cancelReason.value)
        }
      }
      if (this.#envelope.options.timeoutMs === 0) this.#cancelIntent(createRpcTimeoutError())
      else if (this.#envelope.options.timeoutMs !== undefined && this.#state === 'queued')
        this.#deadline = this.#owner.options.setTimeout(
          () => this.#cancelIntent(createRpcTimeoutError()),
          this.#envelope.options.timeoutMs
        )
    }

    /** Report the original failure at the same executor boundary. */
    #report(error: unknown): void {
      return this.#owner.options.emitFailure(
        error,
        isLocalRpcError(error, RpcError) ? localRpcErrorCode(error)! : RpcCoreErrorCode.internal
      )
    }

    /** Serialize terminal failure through the original error owner. */
    #failed(error: unknown): IRpcRuntimeCompletion {
      if (
        this.#owner.#probe !== undefined &&
        (this.#owner.#probe.mask & (1 << RpcProbeStage.message)) !== 0
      )
        this.#owner.#probe.message(
          RpcProbeDirection.inbound,
          runtimeProbeKind(this.#envelope),
          RpcProbeOutcome.failed,
          this.#envelope.id,
          this.#envelope.task.method,
          this.#envelope.route.senderId,
          this.#envelope.route.targetId,
          undefined,
          this.#owner.options.now() - this.#receivedAt,
          undefined,
          error
        )
      return {
        ok: false,
        error: serializeRpcError(error, { report: (failure) => this.#report(failure.error) })
      }
    }

    /**
     * Echo the already selected terminal through its original response port. Wire event labels
     * present admitted error diagnostics; they do not cancel work or mint local error identity.
     */
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
                      completion.error.source === RPC_CORE_ERROR_SOURCE &&
                      (completion.error.code === RpcCoreErrorCode.cancelled ||
                        completion.error.code === RpcCoreErrorCode.deadlineExceeded)
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
        const snapshot = normalizePortable(outcome, 0, new Set<object>(), true)
        this.#claim.settle(
          {
            ok: true,
            data: hasRpcBinaryEnvelope({ payload: snapshot })
              ? normalizePortable(structuredClone(snapshot), 0, new Set<object>(), true)
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
      if (
        completion.ok &&
        this.#owner.#probe !== undefined &&
        (this.#owner.#probe.mask & (1 << RpcProbeStage.message)) !== 0
      )
        this.#owner.#probe.message(
          RpcProbeDirection.inbound,
          runtimeProbeKind(this.#envelope),
          RpcProbeOutcome.settled,
          this.#envelope.id,
          this.#envelope.task.method,
          this.#envelope.route.senderId,
          this.#envelope.route.targetId,
          undefined,
          this.#owner.options.now() - this.#receivedAt,
          undefined,
          undefined
        )
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
          classifyRpcContractError(error)?.code === RpcContractErrorCode.frameLimitExceeded
        ) {
          /**
           * A rejected prepared result has zero writes; retain the actual failure instead of a
           * tombstone.
           */
          const failure = this.#failed(
            createRpcError(
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
      /**
       * Cancellation already won by this operation's state. Preserve an admitted deadline reason's
       * source/code/name/stack for terminal presentation without minting or counting a local
       * timeout.
       */
      const completion = this.#failed(
        localRpcErrorCode(reason) === RpcCoreErrorCode.deadlineExceeded ||
          (safeRead(reason, 'source') === RPC_CORE_ERROR_SOURCE &&
            safeRead(reason, 'code') === RpcCoreErrorCode.deadlineExceeded)
          ? reason
          : createRpcAbortError(undefined, undefined, reason)
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
            /**
             * The store-owned retained outcome is replayed without creating another business
             * invocation.
             */
            const retained = await Promise.race([
              this.#claim.outcome,
              this.#finished.then(() => undefined)
            ])
            if (this.#state !== 'queued') return
            if (retained !== undefined) {
              if (retained === 'unavailable' || !retained.ok || retained.data === undefined)
                throw createRpcError(
                  RpcCoreErrorCode.idempotencyResultUnavailable,
                  RpcCoreErrorText.idempotencyResultUnavailable
                )
              /** Store ownership restores only completed wire data, never an error's live identity. */
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
              throw createRpcError(
                RpcCoreErrorCode.idempotencyResultUnavailable,
                RpcCoreErrorText.idempotencyResultUnavailable
              )
            /** No decoded/minted error or cancellation action is created when replaying this fact. */
            await this.#settle(
              (this.#claim.outcome.data as unknown as IRpcRuntimeOutcome).completion
            )
            return
          }
          if (this.#claim.status === 'full')
            throw createRpcError(RpcCoreErrorCode.overloaded, RpcCoreErrorText.idempotencyStoreFull)
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
          await this.#runStream()
          return
        }
        if (this.#relay && this.#envelope.kind === RpcRuntimeKind.group) {
          await this.#runRelayGroup()
          return
        }
        /**
         * Append one ordered outcome per original group member; failed prefixes prevent later
         * invocation.
         */
        const results: IRpcRuntimeStepOutcome[] = []
        /** A first failed member prevents all later invocation without rescanning prior outcomes. */
        let failed = false
        for (const [index, step] of this.#steps.entries()) {
          /** Cancellation cannot start another group member after its current invocation finishes. */
          if (this.#state !== 'started') return
          if (failed) {
            results.push({ state: RpcRuntimeStepState.notExecuted })
            continue
          }
          /** The original admitted envelope supplies this hop identity and elapsed request budget. */
          const request = runtimeRequestInput(
            this.#envelope,
            step,
            this.#owner.options.now() - this.#receivedAt
          )
          /** Only results created by this exact invocation may use the synchronous settlement path. */
          const taskToken = {}
          /**
           * The canonical provider context retains this invocation identity, signal and settlement
           * brand.
           */
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
            /**
             * Opaque provider returns retain native await semantics; exact owner results do not
             * yield.
             */
            const returned = (
              registration?.invoke ??
              this.#owner.options.registry.getProvider(step.method, this.#envelope.route.senderId)!
            )(context)
            /** Only a correctly branded result can select the original success or failure envelope. */
            const response = (
              ProviderResult.matches(returned, taskToken) ? returned : await returned
            ) as IRpcProviderResult
            if (this.#state !== 'started') return
            if (
              !response ||
              typeof response !== 'object' ||
              providerResultBrand.get(response) !== taskToken
            )
              throw createRpcError(
                RpcCoreErrorCode.providerNotSettled,
                RpcCoreErrorText.providerDidNotSettle
              )
            if (!response.ok) throw createRpcRemoteError(response.code, response.message)
            this.#owner.options.validate(step.method, 'result', response.data)
            results.push({
              state: RpcRuntimeStepState.success,
              ...(response.data === undefined
                ? {}
                : { result: normalizePortable(response.data, 0, new Set<object>(), true) })
            })
          } catch (error) {
            this.#report(error)
            failed = true
            results.push({
              state: RpcRuntimeStepState.failure,
              error: serializeRpcError(error, { report: (failure) => this.#report(failure.error) })
            })
          }
        }
        await this.#settle(this.#stepCompletion(results))
      } catch (error) {
        this.#report(error)
        await this.#settle(this.#failed(error))
      } finally {
        /** Only real execution completion releases a cancelled started scalar/group FIFO entry. */
        if (this.#cancellationCompletion) await this.#settle(this.#cancellationCompletion)
      }
    }
    /** Group wire outcomes and scalar completion share the original exact normalized member facts. */
    #stepCompletion(results: readonly IRpcRuntimeStepOutcome[]): IRpcRuntimeCompletion {
      if (this.#envelope.kind === RpcRuntimeKind.group)
        return {
          ok: true,
          result: normalizePortable(results, 0, new Set<object>(), true)
        }
      else {
        /** Observe exactly one original provider or iterator result before terminal selection. */
        const result = results[0]!
        return result.state === RpcRuntimeStepState.failure
          ? { ok: false, error: result.error }
          : {
              ok: true,
              ...(result.state === RpcRuntimeStepState.success && result.result !== undefined
                ? { result: result.result }
                : {})
            }
      }
    }

    /** The existing stream owner alone constructs, controls and seals this admitted iterator. */
    async #runStream(): Promise<void> {
      if (this.#envelope.kind !== RpcRuntimeKind.call) return
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
              createRpcError(
                RpcCoreErrorCode.providerNotSettled,
                RpcCoreErrorText.providerDidNotSettle
              )
            ),
          this.#streamCompletion !== undefined
        )
    }

    /** One original relay invocation retains native activity for the entire forwarded group. */
    async #runRelayGroup(): Promise<void> {
      if (!this.#relay) return
      /**
       * The original first callback still owns native activity/drain for this whole forwarding
       * task.
       */
      const request = runtimeRequestInput(
        this.#envelope,
        this.#steps[0]!,
        this.#owner.options.now() - this.#receivedAt
      )
      /** Only results created by this exact invocation may use the synchronous settlement path. */
      const taskToken = {}
      /**
       * The canonical provider context retains this invocation identity, signal and settlement
       * brand.
       */
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
      /** Opaque provider returns retain native await semantics; exact owner results do not yield. */
      const returned = (
        this.#bulkRegistrations?.[0]?.invoke ??
        this.#owner.options.registry.getProvider(
          this.#steps[0]!.method,
          this.#envelope.route.senderId
        )!
      )(context)
      /** Only a correctly branded result can select the original success or failure envelope. */
      const response = (
        ProviderResult.matches(returned, taskToken) ? returned : await returned
      ) as IRpcProviderResult
      if (this.#state !== 'started') return
      if (
        !response ||
        typeof response !== 'object' ||
        providerResultBrand.get(response) !== taskToken
      )
        throw createRpcError(
          RpcCoreErrorCode.providerNotSettled,
          RpcCoreErrorText.providerDidNotSettle
        )
      if (!response.ok) throw createRpcRemoteError(response.code, response.message)
      await this.#settle({
        ok: true,
        ...(response.data === undefined
          ? {}
          : { result: normalizePortable(response.data, 0, new Set<object>(), true) })
      })
    }
  }

  readonly options: IProviderExecutorOptions<TTargetId>
  /** Executor retains the same endpoint emitter for every admission and terminal observation. */
  readonly #probe: IProbeEmitter | undefined

  constructor(options: IProviderExecutorOptions<TTargetId>) {
    this.options = options
    this.#probe = options.probe
  }

  /** Creates the core-owned context once for an admitted request or stream open. */
  createContext(
    request: IProviderRequestInput,
    signal: INativeAbortSignal | (() => INativeAbortSignal) | IProviderContextSignal,
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
        this.options.registry.getProvider(request.envelope.method, request.route.route.senderId) ??
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
    if (this.#probe !== undefined && (this.#probe.mask & (1 << RpcProbeStage.message)) !== 0)
      this.#probe.message(
        RpcProbeDirection.inbound,
        request.route.route.dispatchOnly ? RpcProbeKind.notify : RpcProbeKind.request,
        RpcProbeOutcome.rejected,
        request.envelope.id,
        request.envelope.method,
        request.route.route.senderId,
        request.route.route.targetId,
        request.route.route.trace,
        -1,
        reason,
        undefined
      )
    if (!this.options.onRejected) return
    /** Preserve the original observer failure under a core-owned coded wrapper. */
    const report = (cause: unknown): void => {
      this.options.emitFailure(
        createRpcError(
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
          Object.freeze({
            verifiedPeerKey,
            controllerKey,
            method: request.envelope.method,
            reason
          }),
          this.options.registry.sessionPolicy?.(request.route.route.senderId)?.limits?.onRejected
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
      throw createRpcError(
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
        const policy = this.options.registry.sessionPolicy?.(envelope.route.senderId)
        /** The accepted policy selects the canonical idempotency store for this original request. */
        const store = policy?.idempotency?.store ?? this.options.idempotencyStore
        /** The original scope fences this operation lifetime and its inherited cancellation. */
        const scope = this.#runtimeScope(
          peerKey,
          envelope.route.senderId,
          ports.generation.providerId,
          policy
        )
        /** Read only canonical retained store facts before choosing the original replay response. */
        const lookup = store?.lookup?.(scope, envelope.idempotencyKey, this.options.now())
        /** Preserve the original store continuity fact without mutating retained application data. */
        const retainedFacts = store?.readRuntimeFacts?.() ?? {
          kind: RpcRuntimeStoreKind.unavailable,
          continuity: RpcRuntimeStoreContinuity.unavailable
        }
        /**
         * Trusted restart identity describes store replacement; missing keys alone never imply
         * loss.
         */
        const facts: IRpcRuntimeStore =
          policy?.idempotency?.store === undefined &&
          this.options.runtimeDefaultMemoryStore &&
          ports.generation.kind === RpcRuntimeGenerationKind.restart &&
          ports.generation.value > 0 &&
          retainedFacts.kind === RpcRuntimeStoreKind.memory
            ? { ...retainedFacts, continuity: RpcRuntimeStoreContinuity.lost }
            : retainedFacts
        /**
         * The store-owned retained outcome is replayed without creating another business
         * invocation.
         */
        const retained = lookup?.state === RpcRuntimeOutcomeState.done ? lookup.outcome : undefined
        /** Retain only canonical completed wire facts; never rerun business work during replay. */
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
  #runtimeScope(
    peerKey: string,
    senderId: string,
    providerId: string,
    policy?: IProviderSessionPolicy
  ): string {
    /** Canonical principal provenance and ordinary user callbacks keep their original semantics. */
    const scope = policy?.idempotency?.scope ?? this.options.idempotencyScope
    return tupleKey(
      RpcRuntimeProfile,
      providerId,
      readRuntimeIdempotencyScope(scope) ?? scope?.({ token: peerKey, senderId }) ?? peerKey
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

  /** Validates, executes, and settles one inbound request on its sole execution owner. */
  execute(request: IProviderRequestInput, verifiedPeerKey = ''): Promise<void> {
    return new ProviderExecutor.#LegacyExecution(this, request, verifiedPeerKey).execute()
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
    /** A genuine schema failure selects its existing public code and disclosure policy. */
    const schemaError = isLocalRpcError(error, RpcSchemaValidationError)
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
      data: isLocalRpcError(error, RpcSchemaValidationError) ? error.data : undefined,
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
}
