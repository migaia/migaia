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
  RpcTimeoutError
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

/** Owns inbound provider execution and response settlement. */
export class ProviderExecutor<TTargetId extends string> {
  readonly options: IProviderExecutorOptions<TTargetId>

  constructor(options: IProviderExecutorOptions<TTargetId>) {
    this.options = options
  }

  /** Creates the core-owned context once for an admitted request or stream open. */
  createContext(
    request: IProviderRequestInput,
    signal: IRpcAbortSignal | (() => IRpcAbortSignal),
    isExpired: () => boolean,
    taskToken: object = {},
    runtimeTask?: IRpcRuntimeTask,
    peerKey?: string,
    runtime?: IRpcRuntimeEnvelope,
    relay?: IProviderRuntimeRelay
  ): IRpcContext {
    /** This context retains one relative budget; later reads cannot restart the original deadline. */
    const deadlineAt =
      request.route.route.timeoutMs === undefined
        ? undefined
        : this.options.now() + request.route.route.timeoutMs
    /** Capture the canonical clock rather than using wire sentAt or a context receiver. */
    const now = this.options.now
    /** Expired callbacks retain the same task brand as live provider results. */
    const expiredResult = (): IBrandedProviderResult => ({
      ok: false,
      message: RpcCoreErrorText.providerContextExpired,
      code: RpcCoreErrorCode.contextExpired,
      [providerResultBrand]: taskToken
    })
    const context: IRpcContext = {
      data: request.route.payload,
      senderId: request.route.route.senderId,
      route: request.route.route.forwardRoute,
      ...(runtimeTask === undefined
        ? {}
        : {
            callerGeneration: runtimeTask.callerGeneration,
            targetGeneration: runtimeTask.targetGeneration
          }),
      get timeoutMs() {
        return deadlineAt === undefined ? undefined : Math.max(0, Math.floor(deadlineAt - now()))
      },
      get signal() {
        return typeof signal === 'function' ? signal() : signal
      },
      trace: request.route.route.trace,
      success: (
        data?: unknown,
        options?: { readonly transfer?: readonly unknown[] }
      ): IRpcProviderResult =>
        isExpired()
          ? expiredResult()
          : Object.freeze({
              ok: true,
              data,
              transfer: normalizeTransfer(options?.transfer),
              [providerResultBrand]: taskToken
            } as IBrandedProviderResult),
      failed: (message: string, code: string): IRpcProviderResult => {
        if (isExpired()) return expiredResult()
        const failure = normalizeFailure(message, code)
        return Object.freeze({
          ok: false,
          message: failure.message,
          code: failure.code,
          [providerResultBrand]: taskToken
        } as IBrandedProviderResult)
      },
      dispatchTo: ({ id, method, data }: { id?: string; method: string; data: unknown }) => {
        if (isExpired()) return
        if (id !== undefined) {
          if (typeof id !== 'string' || id.length === 0)
            throw new RpcContractError(RpcCoreErrorText.dispatchTargetIdMustBeANonEmptyString)
          this.options.dispatch(id as TTargetId, method, data)
          return
        }
        for (const peer of this.options.peers)
          if (peer !== request.route.route.senderId) this.options.dispatch(peer, method, data)
      }
    }
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
  async executeRuntime(
    envelope: IRpcRuntimeEnvelope,
    peerKey: string,
    ports: IRuntimeExecutionPorts
  ): Promise<void> {
    if (envelope.kind !== RpcRuntimeKind.call && envelope.kind !== RpcRuntimeKind.group) return
    /** This cold opt-in branch never replaces the ordinary executor's endpoint-local quota. */
    const admission = ports.admission ?? this.options.admission
    /**
     * Stream construction and lifetime must be handed to the original stream owner, never
     * scalarized.
     */
    const steps: readonly IRpcRuntimeStep[] =
      envelope.kind === RpcRuntimeKind.group
        ? envelope.steps
        : [
            {
              method: envelope.task.method!,
              ...('payload' in envelope ? { payload: envelope.payload } : {})
            }
          ]
    /** Every member lease is a child of this hop's one original controller/replay task identity. */
    const controllerKey = tupleKey(peerKey, envelope.route.senderId, envelope.id)
    const memberKeys = steps.map((_step, index) => tupleKey(controllerKey, String(index)))
    const input = runtimeRequestInput(envelope, steps[0]!)
    /** This hop captures the original relative deadline before any key waiting or downstream send. */
    const receivedAt = this.options.now()
    /** Only a compiled forward route may delegate final start and complete-group execution. */
    let relay: IProviderRuntimeRelay | undefined
    const report = (error: unknown): void =>
      this.options.emitFailure(
        error,
        error instanceof RpcError ? error.code : RpcCoreErrorCode.internal
      )
    const failed = (error: unknown): IRpcRuntimeCompletion => ({
      ok: false,
      error: serializeRpcError(error, { report: (failure) => report(failure.error) })
    })
    /** Responses echo the original selected task even when the local fence refused it. */
    const respond = (
      completion: IRpcRuntimeCompletion,
      onPrepared?: () => Promise<void>
    ): Promise<void> =>
      envelope.task.mode === RpcRuntimeMode.stream
        ? ports.send(
            {
              profile: RpcRuntimeProfile,
              kind: RpcRuntimeKind.control,
              id: envelope.id,
              route: {
                ...envelope.route,
                senderId: this.options.id,
                targetId: envelope.route.senderId,
                receiverId: ports.replyReceiverId ?? envelope.route.senderId,
                sentAt: this.options.timestamp()
              },
              task: envelope.task,
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
        : envelope.task.mode === RpcRuntimeMode.notify &&
            envelope.options.cancel !== RpcRuntimeCancel &&
            envelope.options.orderKey === undefined &&
            envelope.route.forwardRoute === undefined
          ? Promise.resolve()
          : ports.send(
              {
                profile: RpcRuntimeProfile,
                kind: RpcRuntimeKind.control,
                id: envelope.id,
                route: {
                  ...envelope.route,
                  senderId: this.options.id,
                  targetId: envelope.route.senderId,
                  receiverId: ports.replyReceiverId ?? envelope.route.senderId,
                  sentAt: this.options.timestamp()
                },
                task: envelope.task,
                operation: RpcRuntimeOperation.terminal,
                completion
              },
              onPrepared
            )
    try {
      if (
        !sameGeneration(envelope.task.targetGeneration, ports.generation) ||
        !sameGeneration(envelope.task.callerGeneration, ports.callerGeneration)
      )
        throw new RpcError(
          RpcCoreErrorCode.providerGenerationMismatch,
          RpcCoreErrorText.providerGenerationMismatch
        )
      if (
        !admission.acquireMany ||
        (envelope.options.orderKey !== undefined && !admission.enqueueOrder)
      )
        throw new RpcError(
          RpcCoreErrorCode.capabilityUnsupported,
          RpcCoreErrorText.capabilityUnsupported
        )
      /** Whitelist/schema/forward preflight finishes for the entire set before either quota changes. */
      for (const step of steps) {
        const provider =
          envelope.task.mode === RpcRuntimeMode.stream
            ? this.options.registry.streamProviders.get(`${RpcRuntimeStreamPrefix}${step.method}`)
            : this.options.registry.getProvider(step.method)
        if (!provider)
          throw new RpcError(RpcCoreErrorCode.providerNotFound, RpcCoreErrorText.providerNotFound)
        this.options.validate(step.method, 'params', step.payload)
        readProviderPreflight(provider)?.(runtimeRequestInput(envelope, step).route.route)
      }
      relay = this.options.registry.runtimeRelay?.(envelope)
    } catch (error) {
      report(error)
      await respond(failed(error))
      return
    }
    /** Duplicates never acquire the original task's release ownership. */
    if (
      ports.replay.has(memberKeys[0]!, this.options.now()) ||
      this.options.controllers.has(controllerKey)
    )
      return
    const reserved = ports.replay.reserveMany(
      memberKeys,
      peerKey,
      this.options.now(),
      ports.activeReplay
    )
    if (!reserved) {
      this.#notifyRejection(
        input,
        peerKey,
        controllerKey,
        envelope.kind === RpcRuntimeKind.group
          ? RpcProviderRejectionReason.groupReplayFull
          : RpcProviderRejectionReason.replayLedgerFull
      )
      await respond(
        failed(
          new RpcError(RpcCoreErrorCode.overloaded, RpcCoreErrorText.requestReplayLedgerIsFull)
        )
      )
      return
    }
    if (!admission.acquireMany!(memberKeys, peerKey)) {
      reserved.rollback()
      this.#notifyRejection(
        input,
        peerKey,
        controllerKey,
        envelope.kind === RpcRuntimeKind.group
          ? RpcProviderRejectionReason.groupConcurrency
          : envelope.options.orderKey !== undefined
            ? RpcProviderRejectionReason.orderedQueueFull
            : RpcProviderRejectionReason.concurrency
      )
      await respond(
        failed(
          new RpcError(RpcCoreErrorCode.overloaded, RpcCoreErrorText.providerAdmissionLimitReached)
        )
      )
      return
    }
    /** Only a group discovers native policies; scalar and ordinary execution retain their guards. */
    const bulkRegistrations =
      envelope.kind === RpcRuntimeKind.group
        ? steps.map((step) =>
            readProviderBulkAdmission(this.options.registry.getProvider(step.method)!)
          )
        : undefined
    /** These bounded task-local reservations belong to existing native counters, not a quota table. */
    const bulkReservations = new Map<IProviderBulkAdmission, IProviderAdmissionReservation>()
    try {
      /** Every original policy owner validates its complete member set before any invocation. */
      const payloads = new Map<IProviderBulkAdmission, (IRpcPortableValue | undefined)[]>()
      for (let index = 0; index < steps.length; index += 1) {
        /** Cold callback provenance identifies the actual shared native policy owner. */
        const registration = bulkRegistrations?.[index]
        if (!registration) continue
        /** One owner can guard several methods in this same physical group. */
        const members = payloads.get(registration.admission) ?? []
        members.push(steps[index]!.payload)
        payloads.set(registration.admission, members)
      }
      for (const [owner, members] of payloads)
        bulkReservations.set(owner, owner.reserveMany(members))
    } catch (error) {
      for (const reservation of bulkReservations.values()) reservation.release()
      for (const key of memberKeys) admission.release(key)
      reserved.rollback()
      report(error)
      await respond(failed(error))
      return
    }
    /** The original native controller is never aborted by a before-start intent after start wins. */
    const native = new AbortController()
    /** One task state linearizes cancellation, start and terminal in this final executor. */
    let state: 'queued' | 'started' | 'cancelled' | 'terminal' = 'queued'
    /** Known invocation retains only its prefix; cancellation or uncertain forwarding keeps replay. */
    let invokedMembers: number | undefined
    let deadline: IEndpointTimer | undefined
    let claim: IRpcIdempotencyClaim | undefined
    /** Queued keyed work retains the actual selected store/scope/fingerprint from admission. */
    let claimInput:
      | Readonly<{ store: IRpcIdempotencyStore; scope: string; key: string; fingerprint: string }>
      | undefined
    /** Stream terminal seals once before its original owner sends end/fail. */
    let sealed = false
    /** Only a real producer terminal can supply the stream's final completion. */
    let streamCompletion: IRpcRuntimeCompletion | undefined
    /** A running handler or in-progress binary claim preparation retains its final cancel result. */
    let cancellationCompletion: IRpcRuntimeCompletion | undefined
    /** Ordinary cancellation must not publish a keyed terminal before this original hash completes. */
    let preparingFingerprint = false
    /**
     * Retirement is terminal; only a live preparation's deferred cancel may finish its original
     * claim.
     */
    const canClaimPrepared = (): boolean =>
      state === 'queued' || (state === 'cancelled' && cancellationCompletion !== undefined)
    let releaseOrder: (() => void) | undefined
    /** Only asynchronous binary preparation may reach the original FIFO head before it is ready. */
    let prepareReachedHead = false
    /** The existing run callback is handed to that same FIFO entry after its fingerprint is ready. */
    let preparedOrderStart: (() => void) | undefined
    let finishTask!: () => void
    const finished = new Promise<void>((resolve) => {
      finishTask = resolve
    })
    /**
     * Settlement seals keyed results before delivery, then releases each original member exactly
     * once.
     */
    const seal = async (completion: IRpcRuntimeCompletion): Promise<void> => {
      if (sealed) return
      if (claim?.status === 'claimed') {
        /** Same original store owner retains only the actual final result, never yielded items. */
        const outcome: IRpcRuntimeOutcome = {
          mode: envelope.task.mode as IRpcRuntimeOutcome['mode'],
          targetGeneration: ports.generation,
          completion
        }
        /**
         * The sealed result owns its bytes; this is a completion snapshot, never an input retry
         * backup.
         */
        const snapshot = normalizeRuntimePortable(outcome)
        claim.settle(
          {
            ok: true,
            data: hasRpcPortableBinary(snapshot)
              ? normalizeRuntimePortable(structuredClone(snapshot))
              : snapshot
          },
          this.options.now()
        )
      }
      sealed = true
    }
    const settle = async (completion: IRpcRuntimeCompletion, delivered = false): Promise<void> => {
      if (state === 'terminal') return
      if (
        envelope.kind === RpcRuntimeKind.group &&
        completion.ok &&
        Array.isArray(completion.result)
      ) {
        /** A genuine final or cached report proves the same unused suffix on every physical task. */
        const firstUnused = completion.result.findIndex(
          (step) => safeRead(step, 'state') === RpcRuntimeStepState.notExecuted
        )
        if (firstUnused >= 0) invokedMembers = firstUnused
      }
      state = 'terminal'
      if (deadline) this.options.clearTimeout(deadline)
      try {
        if (envelope.kind === RpcRuntimeKind.group && !delivered)
          await respond(completion, () => seal(completion))
        else {
          await seal(completion)
          if (!delivered) await respond(completion)
        }
      } catch (error) {
        report(error)
        if (
          envelope.kind === RpcRuntimeKind.group &&
          completion.ok &&
          !sealed &&
          safeRead(error, 'code') === RpcContractErrorCode.frameLimitExceeded
        ) {
          /**
           * A rejected prepared result has zero writes; retain the actual failure instead of a
           * tombstone.
           */
          const failure = failed(
            new RpcError(
              RpcCoreErrorCode.payloadInvalid,
              RpcCoreErrorText.runtimeGroupResultTooLarge,
              error
            )
          )
          try {
            await seal(failure)
            await respond(failure)
          } catch (failureError) {
            report(failureError)
          }
        } else if (envelope.kind === RpcRuntimeKind.group && !sealed) {
          /** Preparation refusal cannot make completed business eligible for another key claim. */
          try {
            await seal(completion)
          } catch (sealError) {
            report(sealError)
          }
        }
      } finally {
        if (claim?.status === 'claimed') claim.release()
        this.options.controllers.delete(controllerKey)
        for (const reservation of bulkReservations.values()) reservation.release()
        for (const key of memberKeys) admission.release(key)
        reserved.release(
          this.options.now(),
          envelope.kind === RpcRuntimeKind.group ? invokedMembers : undefined
        )
        releaseOrder?.()
        finishTask()
      }
    }
    /**
     * Ordinary remote cancellation retains running business; resource retirement revokes its
     * session.
     */
    const revoke = (reason?: unknown, retainStarted = false): void => {
      if (state === 'terminal') return
      if (state === 'cancelled') {
        /** Retiring this exact session still releases its entry after prior ordinary cancellation. */
        if (!retainStarted && cancellationCompletion) void settle(cancellationCompletion)
        return
      }
      /** A native abort cannot force the already running business Promise to complete. */
      const started = state === 'started'
      /** A constructed stream retains its lease until original iterator cleanup really ends. */
      const streamCleanup = started ? controller.cancelStream : undefined
      state = 'cancelled'
      native.abort(reason)
      if (deadline) this.options.clearTimeout(deadline)
      deadline = undefined
      /** Preserve the cancellation's original native source, code, stack and primary reason. */
      const completion = failed(
        reason instanceof RpcTimeoutError ||
          (safeRead(reason, 'source') === RpcCoreErrorSource &&
            safeRead(reason, 'code') === RpcCoreErrorCode.deadlineExceeded)
          ? reason
          : new RpcAbortError(undefined, undefined, reason)
      )
      if (streamCleanup)
        void streamCleanup(reason).then(
          () => settle(completion, true),
          (error: unknown) => {
            report(error)
            return settle(failed(error))
          }
        )
      else if (retainStarted && (started || preparingFingerprint))
        cancellationCompletion = completion
      else void settle(completion)
    }
    const cancelIntent = (reason?: unknown): void => {
      if (relay && state === 'started') {
        /** B sends intent through the original downstream signal; C alone decides its final start. */
        native.abort(reason)
        return
      }
      if (state === 'started' && envelope.options.cancel === RpcRuntimeCancel) return
      revoke(reason, true)
    }
    const controller: IRpcProviderController = {
      signal: native.signal,
      runtimeTask: envelope.task,
      abort: revoke,
      cancelIntent,
      ...(envelope.task.mode === RpcRuntimeMode.stream
        ? {
            /** Before construction, only this task's selected before-start finish may revoke start. */
            streamIntent: (payload) => {
              if (payload.event !== RpcRuntimeFinish) return Promise.resolve()
              if (envelope.options.cancel !== RpcRuntimeCancel)
                throw invalidRpcStream(RpcStreamViolation.event, '/stream/event')
              cancelIntent(
                payload.reason === undefined ? undefined : deserializeRpcError(payload.reason)
              )
              return Promise.resolve()
            }
          }
        : {})
    }
    this.options.controllers.set(controllerKey, controller)
    const pendingAbort = this.options.consumePendingAbort?.(
      controllerKey,
      runtimeTaskKey(envelope.task)
    )
    if (pendingAbort?.found) {
      if (!pendingAbort.finish || envelope.options.cancel === RpcRuntimeCancel)
        cancelIntent(pendingAbort.reason)
      else {
        /** A forged early finish cannot opt an order-only stream into discard or cancellation. */
        report(invalidRpcStream(RpcStreamViolation.event, '/stream/event'))
        if (pendingAbort.cancelReason) cancelIntent(pendingAbort.cancelReason.value)
      }
    }
    if (envelope.options.timeoutMs === 0) cancelIntent(new RpcTimeoutError())
    else if (envelope.options.timeoutMs !== undefined && state === 'queued')
      deadline = this.options.setTimeout(
        () => cancelIntent(new RpcTimeoutError()),
        envelope.options.timeoutMs
      )
    /** Retired or cancelled preparation never publishes a new key claim. */
    if (state !== 'queued') return
    try {
      /** All original quotas are committed before a key becomes visible; no provider has started. */
      const key = envelope.options.idempotencyKey
      if (key !== undefined && !relay) {
        /** The canonical configured store owns the whole queued lifetime, including cancellation. */
        const store = this.options.idempotencyStore
        if (!store?.lookup)
          throw new RpcError(
            RpcCoreErrorCode.capabilityUnsupported,
            RpcCoreErrorText.capabilityUnsupported
          )
        /** Non-binary claims keep the original synchronous fingerprint with no extra Promise. */
        const fingerprint = runtimeFingerprint(envelope, steps)
        if (typeof fingerprint !== 'string' && envelope.options.orderKey !== undefined) {
          /** Full backing hashing cannot let a later admitted task take this task's FIFO place. */
          releaseOrder = admission.enqueueOrder!(envelope.options.orderKey, () => {
            prepareReachedHead = true
            preparedOrderStart?.()
          })
        }
        /** The existing controller must remain registered while full binary hashing yields. */
        preparingFingerprint = typeof fingerprint !== 'string'
        const preparedFingerprint =
          typeof fingerprint === 'string' ? fingerprint : await fingerprint
        preparingFingerprint = false
        if (!canClaimPrepared()) return
        claimInput = {
          store,
          key,
          scope: this.#runtimeScope(peerKey, envelope.route.senderId, ports.generation.providerId),
          fingerprint: preparedFingerprint
        }
        claim = store.claim(claimInput.scope, key, this.options.now(), claimInput.fingerprint)
        if (claim.status === 'full')
          throw new RpcError(RpcCoreErrorCode.overloaded, RpcCoreErrorText.idempotencyStoreFull)
        /** A queued cancellation seals/matches the original key before its final terminal is sent. */
        if (cancellationCompletion) {
          await settle(cancellationCompletion)
          return
        }
      }
    } catch (error) {
      preparingFingerprint = false
      /** Store refusal precedes task admission; preserve no tombstones for uncommitted members. */
      report(error)
      if (!canClaimPrepared()) return
      reserved.rollback()
      await settle(failed(error))
      return
    }
    /** Claim waiting remains queued, retains original quotas and cannot run the first group member. */
    const run = async (): Promise<void> => {
      if (state !== 'queued') return
      try {
        if (claimInput && claim) {
          while (claim.status === 'pending') {
            const retained = await Promise.race([claim.outcome, finished.then(() => undefined)])
            if (state !== 'queued') return
            if (retained !== undefined) {
              if (retained === 'unavailable' || !retained.ok || retained.data === undefined)
                throw new RpcError(
                  RpcCoreErrorCode.idempotencyResultUnavailable,
                  RpcCoreErrorText.idempotencyResultUnavailable
                )
              await settle((retained.data as unknown as IRpcRuntimeOutcome).completion)
              return
            }
            claim = claimInput.store.claim(
              claimInput.scope,
              claimInput.key,
              this.options.now(),
              claimInput.fingerprint
            )
          }
          if (claim.status === 'done') {
            if (
              claim.outcome === 'unavailable' ||
              !claim.outcome.ok ||
              claim.outcome.data === undefined
            )
              throw new RpcError(
                RpcCoreErrorCode.idempotencyResultUnavailable,
                RpcCoreErrorText.idempotencyResultUnavailable
              )
            await settle((claim.outcome.data as unknown as IRpcRuntimeOutcome).completion)
            return
          }
          if (claim.status === 'full')
            throw new RpcError(RpcCoreErrorCode.overloaded, RpcCoreErrorText.idempotencyStoreFull)
        }
        if (state !== 'queued') return
        /** The sole synchronous final start point precedes any invocation or iterator construction. */
        state = 'started'
        if (!relay && envelope.options.cancel === RpcRuntimeCancel && deadline) {
          this.options.clearTimeout(deadline)
          deadline = undefined
        }
        if (envelope.task.mode === RpcRuntimeMode.stream && envelope.kind === RpcRuntimeKind.call) {
          /** Logical mode selects the same precompiled canonical stream wire route, not another map. */
          const method = `${RpcRuntimeStreamPrefix}${steps[0]!.method}`
          /** The original context still carries this hop's authenticated task and caller identity. */
          const request = runtimeRequestInput(
            envelope,
            { ...steps[0]!, method },
            this.options.now() - receivedAt
          )
          /** Start is already committed; the stream owner alone constructs and drives its iterator. */
          const runtime: IProviderRuntimeStream = {
            envelope,
            signal: native.signal,
            replyReceiverId: ports.replyReceiverId,
            ...(relay ? { forwarded: true } : {}),
            ...(relay
              ? { prepareStream: relay.prepareStream, finishStream: relay.finishStream }
              : {}),
            seal: async (completion) => {
              streamCompletion = completion
              await seal(completion)
            },
            bindControl: (handler) => {
              controller.streamIntent = handler
            },
            bindCancel: (handler) => {
              controller.cancelStream = handler
            }
          }
          await this.options.registry.streamProviders.get(method)!(
            { envelope: request.envelope, activeLifetime: true, runtime },
            (signal) =>
              this.createContext(
                request,
                signal,
                () => state !== 'started',
                {},
                envelope.task,
                peerKey,
                envelope,
                relay
              )
          )
          if (state === 'started')
            await settle(
              streamCompletion ??
                failed(
                  new RpcError(
                    RpcCoreErrorCode.providerNotSettled,
                    RpcCoreErrorText.providerDidNotSettle
                  )
                ),
              streamCompletion !== undefined
            )
          return
        }
        if (relay && envelope.kind === RpcRuntimeKind.group) {
          /**
           * The original first callback still owns native activity/drain for this whole forwarding
           * task.
           */
          const request = runtimeRequestInput(envelope, steps[0]!, this.options.now() - receivedAt)
          const taskToken = {}
          const context = this.createContext(
            request,
            native.signal,
            () => state !== 'started',
            taskToken,
            envelope.task,
            peerKey,
            envelope,
            relay
          )
          for (const registration of bulkRegistrations ?? [])
            if (registration) bulkReservations.get(registration.admission)!.consume()
          /** Sending one complete group can execute any member until C returns its final report. */
          invokedMembers = steps.length
          const response = await (
            bulkRegistrations?.[0]?.invoke ?? this.options.registry.getProvider(steps[0]!.method)!
          )(context)
          if (state !== 'started') return
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
          await settle({
            ok: true,
            ...(response.data === undefined
              ? {}
              : { result: normalizeRuntimePortable(response.data) })
          })
          return
        }
        const results: IRpcRuntimeStepOutcome[] = []
        for (const [index, step] of steps.entries()) {
          /** Cancellation cannot start another group member after its current invocation finishes. */
          if (state !== 'started') return
          if (results.some((result) => result.state === RpcRuntimeStepState.failure)) {
            results.push({ state: RpcRuntimeStepState.notExecuted })
            continue
          }
          const request = runtimeRequestInput(envelope, step, this.options.now() - receivedAt)
          const taskToken = {}
          const context = this.createContext(
            request,
            native.signal,
            () => state === 'terminal' || state === 'cancelled',
            taskToken,
            envelope.task,
            peerKey,
            envelope,
            relay
          )
          try {
            /** Prepaid invocation retains native activity and drain owners without charging twice. */
            const registration = bulkRegistrations?.[index]
            if (registration) bulkReservations.get(registration.admission)!.consume()
            invokedMembers = index + 1
            const response = await (
              registration?.invoke ?? this.options.registry.getProvider(step.method)!
            )(context)
            if (state !== 'started') return
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
            this.options.validate(step.method, 'result', response.data)
            results.push({
              state: RpcRuntimeStepState.success,
              ...(response.data === undefined
                ? {}
                : { result: normalizeRuntimePortable(response.data) })
            })
          } catch (error) {
            report(error)
            results.push({
              state: RpcRuntimeStepState.failure,
              error: serializeRpcError(error, { report: (failure) => report(failure.error) })
            })
          }
        }
        if (envelope.kind === RpcRuntimeKind.group)
          await settle({ ok: true, result: normalizeRuntimePortable(results) })
        else {
          const result = results[0]!
          await settle(
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
        report(error)
        await settle(failed(error))
      } finally {
        /** Only real execution completion releases a cancelled started scalar/group FIFO entry. */
        if (cancellationCompletion) await settle(cancellationCompletion)
      }
    }
    if (state === 'queued') {
      if (releaseOrder !== undefined) {
        /** One original FIFO entry waits for preparation, with no second queue or execution owner. */
        preparedOrderStart = () => {
          void run()
        }
        if (prepareReachedHead) preparedOrderStart()
      } else if (envelope.options.orderKey !== undefined)
        releaseOrder = admission.enqueueOrder!(envelope.options.orderKey, () => {
          void run()
        })
      else void run()
    }
    await finished
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
      const result = await provider(context)
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
      ...((!localSummary || localSummary.preserveSerializedError === true) &&
      (schemaError || includeSerializedError)
        ? {
            serializedError: serializeRpcError(error, {
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
        ? { code: outcome.code, message: outcome.message, serializedError: outcome.error }
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
