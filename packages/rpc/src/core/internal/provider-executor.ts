import {
  RpcContractError,
  RpcCoreErrorCode,
  RpcSchemaValidationError,
  RpcTimeoutError
} from '../errors.js'
import { RpcCoreErrorText } from '../error-text.js'
import {
  normalizePortable,
  type IRpcEnvelope,
  type IRpcEnvelopeData,
  type IRpcSerializedError
} from '../../contract/index.js'
import type { IRpcAbortSignal, IRpcContext, IRpcProviderResult } from '../typing.js'
import type { ProviderRegistry } from './provider.js'
import { safeRead, safeString, tupleKey } from './safe-value.js'
import { RpcMessageKind } from '../semantic-constants.js'
import { serializeRpcError } from '../../contract/error.js'
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
}
type IControllerRegistry = {
  has(key: string): boolean
  set(key: string, controller: AbortController): void
  delete(key: string): void
}

type IProviderExecutorOptions<TTargetId extends string> = {
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
  readonly consumePendingAbort?: (key: string) => {
    readonly found: boolean
    readonly reason: unknown
  }
  readonly admission: IProviderAdmission
  readonly retainBinding?: (verifiedPeerKey: string) => boolean
  readonly releaseBinding?: (verifiedPeerKey: string) => void
  /** Selects response receiver identity for composed attachment admission. */
  readonly responseReceiverId?: (request: IProviderRequestInput) => string | undefined
  readonly idempotencyStore?: IRpcIdempotencyStore
  readonly idempotencyScope?: (admission: Readonly<{ token: string; senderId: string }>) => string
}
const providerResultBrand = Symbol('web-rpc-provider-result')
type IBrandedProviderResult = IRpcProviderResult & { readonly [providerResultBrand]: object }
const maxProviderTransferItems = 64

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
    signal: IRpcAbortSignal,
    isExpired: () => boolean,
    taskToken: object = {}
  ): IRpcContext {
    /** Expired callbacks retain the same task brand as live provider results. */
    const expiredResult = (): IBrandedProviderResult => ({
      ok: false,
      message: RpcCoreErrorText.providerContextExpired,
      code: RpcCoreErrorCode.contextExpired,
      [providerResultBrand]: taskToken
    })
    return {
      data: request.route.payload,
      signal,
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
  }

  /** Validates, executes, and settles one inbound request. */
  async execute(request: IProviderRequestInput, verifiedPeerKey = ''): Promise<void> {
    const controllerKey = tupleKey(
      verifiedPeerKey,
      request.route.route.senderId,
      request.envelope.id
    )
    if (this.options.isReplay?.(request, verifiedPeerKey)) return
    if (this.options.admitReplay && !this.options.admitReplay(request, verifiedPeerKey)) {
      if (!request.route.route.dispatchOnly)
        await this.failureResponse(
          request,
          new Error(RpcCoreErrorText.requestReplayLedgerIsFull),
          RpcCoreErrorCode.overloaded
        )
      return
    }
    if (!this.options.admission.acquire(controllerKey, verifiedPeerKey)) {
      if (!request.route.route.dispatchOnly)
        await this.failureResponse(
          request,
          new Error(RpcCoreErrorText.providerAdmissionLimitReached),
          RpcCoreErrorCode.overloaded
        )
      return
    }
    if (this.options.retainBinding && !this.options.retainBinding(verifiedPeerKey)) {
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
    const controller = new AbortController()
    this.options.controllers.set(controllerKey, controller)
    const pendingAbort = this.options.consumePendingAbort?.(controllerKey)
    const timeoutMs = request.route.route.timeoutMs
    /** A provider deadline uses only endpoint monotonic timers, never wire sentAt. */
    const deadlineTimer =
      timeoutMs === undefined || timeoutMs === 0
        ? undefined
        : this.options.setTimeout(() => controller.abort(new RpcTimeoutError()), timeoutMs)
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
    let expired = false
    const taskToken = {}
    const isExpired = (): boolean => expired || controller.signal.aborted
    const context = this.createContext(request, controller.signal, isExpired, taskToken)
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
        explicitCode ?? (schemaError ? RpcCoreErrorCode.schemaInvalid : RpcCoreErrorCode.internal),
      message: schemaError
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
        : RpcCoreErrorText.providerFailed,
      data: error instanceof RpcSchemaValidationError ? error.data : undefined,
      sentAt: this.options.timestamp(),
      ...(schemaError || includeSerializedError
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
