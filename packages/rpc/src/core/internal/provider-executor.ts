import { RpcContractError, RpcCoreErrorCode, RpcSchemaValidationError } from '../errors.js'
import { RpcCoreErrorText } from '../error-text.js'
import type { IRpcEnvelope } from '../../contract/index.js'
import type { IRpcProviderResult } from '../typing.js'
import type { IRpcRoutingData } from './routing-data.js'
import type { ProviderRegistry } from './provider.js'
import { safeRead, safeString, tupleKey } from './safe-value.js'
import { RpcMessageKind } from '../semantic-constants.js'
import { serializeRpcError } from '../../contract/error.js'

/** Canonical request plus WebRPC-owned route data consumed by provider execution. */
export type IProviderRequestInput = Readonly<{
  readonly envelope: Extract<IRpcEnvelope, { readonly kind: 'request' }>
  readonly route: IRpcRoutingData
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
}
const providerResultBrand = Symbol('web-rpc-provider-result')
type IBrandedProviderResult = IRpcProviderResult & { readonly [providerResultBrand]: object }
const maxProviderTransferItems = 64

/** Normalizes provider-owned metadata before it can cross the transport boundary. */
function normalizeTransfer(value: readonly unknown[] | undefined): readonly unknown[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length > maxProviderTransferItems)
    throw new RpcContractError('provider transfer must be a bounded array')
  const snapshot = Array.from(value)
  return Object.freeze(snapshot)
}

/** Validates and snapshots failure metadata created by untrusted JavaScript callers. */
function normalizeFailure(
  message: string,
  code: string
): { readonly message: string; readonly code: string } {
  if (typeof message !== 'string' || typeof code !== 'string')
    throw new RpcContractError('provider failure message and code must be strings')
  return Object.freeze({ message, code })
}

/** Owns inbound provider execution and response settlement. */
export class ProviderExecutor<TTargetId extends string> {
  readonly options: IProviderExecutorOptions<TTargetId>

  constructor(options: IProviderExecutorOptions<TTargetId>) {
    this.options = options
  }

  /** Validates, executes, and settles one inbound request. */
  async execute(request: IProviderRequestInput, verifiedPeerKey = ''): Promise<void> {
    const controllerKey = tupleKey(
      verifiedPeerKey,
      request.route.webRpc.senderId,
      request.envelope.id
    )
    if (this.options.isReplay?.(request, verifiedPeerKey)) return
    if (this.options.admitReplay && !this.options.admitReplay(request, verifiedPeerKey)) {
      if (!request.route.webRpc.dispatchOnly)
        await this.failureResponse(
          request,
          new Error('Request replay ledger is full'),
          RpcCoreErrorCode.overloaded
        )
      return
    }
    if (!this.options.admission.acquire(controllerKey, verifiedPeerKey)) {
      if (!request.route.webRpc.dispatchOnly)
        await this.failureResponse(
          request,
          new Error('Provider admission limit reached'),
          RpcCoreErrorCode.overloaded
        )
      return
    }
    if (this.options.retainBinding && !this.options.retainBinding(verifiedPeerKey)) {
      try {
        if (!request.route.webRpc.dispatchOnly)
          await this.failureResponse(
            request,
            new Error('Verified peer binding expired'),
            RpcCoreErrorCode.overloaded
          )
      } finally {
        this.options.admission.release(controllerKey)
      }
      return
    }
    try {
      this.options.validate(request.envelope.method, 'params', request.route.payload)
    } catch (error) {
      try {
        this.options.markCompleted?.(request, verifiedPeerKey)
        if (!request.route.webRpc.dispatchOnly) await this.failureResponse(request, error)
      } finally {
        this.options.admission.release(controllerKey)
        this.options.releaseBinding?.(verifiedPeerKey)
      }
      return
    }
    const listeners = this.options.registry.getListeners(request.envelope.method)
    const provider = this.options.registry.getProvider(request.envelope.method)
    let responseSendStarted = false
    if (this.options.controllers.has(controllerKey)) {
      return
    }
    const controller = new AbortController()
    this.options.controllers.set(controllerKey, controller)
    const pendingAbort = this.options.consumePendingAbort?.(controllerKey)
    if (pendingAbort?.found) controller.abort(pendingAbort.reason)
    let expired = false
    const taskToken = {}
    const expiredResult = (): IBrandedProviderResult => ({
      ok: false,
      message: 'Provider context expired',
      code: RpcCoreErrorCode.contextExpired,
      [providerResultBrand]: taskToken
    })
    const isExpired = (): boolean => expired || controller.signal.aborted
    const context = {
      data: request.route.payload,
      signal: controller.signal,
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
            throw new RpcContractError('dispatch target id must be a non-empty string')
          this.options.dispatch(id as TTargetId, method, data)
          return
        }
        for (const peer of this.options.peers)
          if (peer !== request.route.webRpc.senderId) this.options.dispatch(peer, method, data)
      }
    }
    try {
      if (request.route.webRpc.dispatchOnly && listeners?.length) {
        for (const listener of Array.from(listeners)) await listener(context)
        return
      }
      if (!provider) {
        if (!request.route.webRpc.dispatchOnly) {
          responseSendStarted = true
          await this.failureResponse(
            request,
            new Error('Provider not found'),
            RpcCoreErrorCode.providerNotFound
          )
        }
        return
      }
      const result = await provider(context)
      if (request.route.webRpc.dispatchOnly) return
      if (isExpired()) return
      const response: IRpcProviderResult =
        result &&
        typeof result === 'object' &&
        (result as Partial<IBrandedProviderResult>)[providerResultBrand] === taskToken
          ? (result as IRpcProviderResult)
          : {
              ok: false,
              message: 'Provider did not settle',
              code: RpcCoreErrorCode.providerNotSettled
            }
      if (response.ok) this.options.validate(request.envelope.method, 'result', response.data)
      responseSendStarted = true
      await this.options.send(
        {
          kind: RpcMessageKind.response,
          version: request.route.webRpc.applicationVersion,
          taskId: request.envelope.id,
          senderId: this.options.id,
          targetId: request.route.webRpc.senderId,
          method: request.envelope.method,
          ok: response.ok,
          data: response.ok ? response.data : undefined,
          message: response.ok ? undefined : response.message,
          code: response.ok ? undefined : response.code,
          sentAt: this.options.timestamp(),
          ...((this.options.responseReceiverId?.(request) ?? request.route.webRpc.receiverId) ===
          undefined
            ? {}
            : {
                receiverId:
                  this.options.responseReceiverId?.(request) ?? request.route.webRpc.receiverId
              })
        },
        response.ok ? response.transfer : undefined
      )
    } catch (error) {
      if (!request.route.webRpc.dispatchOnly && !responseSendStarted && !isExpired())
        await this.failureResponse(request, error, undefined, true)
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
      expired = true
    }
  }

  private async failureResponse(
    request: IProviderRequestInput,
    error: unknown,
    explicitCode?: string,
    includeSerializedError = false
  ): Promise<void> {
    const schemaError = error instanceof RpcSchemaValidationError
    await this.options.send({
      kind: RpcMessageKind.response,
      version: request.route.webRpc.applicationVersion,
      taskId: request.envelope.id,
      senderId: this.options.id,
      targetId: request.route.webRpc.senderId,
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
            RpcCoreErrorText.schemaValidationFallback
          )
        : 'Provider failed',
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
      ...((this.options.responseReceiverId?.(request) ?? request.route.webRpc.receiverId) ===
      undefined
        ? {}
        : {
            receiverId:
              this.options.responseReceiverId?.(request) ?? request.route.webRpc.receiverId
          })
    })
  }
}
