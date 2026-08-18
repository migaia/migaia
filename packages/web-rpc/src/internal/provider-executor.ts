import { WebRpcContractError, WebRpcErrorCode, WebRpcSchemaValidationError } from '../errors.js';
import type { IWebRpcProviderResult } from '../typing.js';
import type { IWebRpcRequest } from '../wire.js';
import type { ProviderRegistry } from './provider.js';
import { safeRead, safeString, tupleKey } from './safe-value.js';
import { WebRpcMessageKind } from '../protocol-constants.js';
import { serializeError } from '../error-serialization.js';
type IProviderAdmission = {
  acquire(taskKey: string, peerKey: string): boolean;
  release(taskKey: string): void;
};
type IControllerRegistry = {
  has(key: string): boolean;
  set(key: string, controller: AbortController): void;
  delete(key: string): void;
};

type IProviderExecutorOptions<TTargetId extends string> = {
  readonly id: string;
  readonly registry: ProviderRegistry;
  readonly controllers: IControllerRegistry;
  readonly peers: Iterable<TTargetId>;
  readonly dispatch: (targetId: TTargetId, method: string, data: unknown) => void;
  readonly send: (response: unknown, transfer?: readonly unknown[]) => Promise<void>;
  readonly validate: (method: string, side: 'params' | 'result', data: unknown) => void;
  readonly emitFailure: (error: unknown, code: string) => void;
  readonly isReplay?: (request: IWebRpcRequest, verifiedPeerKey: string) => boolean;
  readonly admitReplay?: (request: IWebRpcRequest, verifiedPeerKey: string) => boolean;
  readonly markCompleted?: (request: IWebRpcRequest, verifiedPeerKey: string) => void;
  readonly consumePendingAbort?: (key: string) => boolean;
  readonly admission: IProviderAdmission;
  readonly retainBinding?: (verifiedPeerKey: string) => boolean;
  readonly releaseBinding?: (verifiedPeerKey: string) => void;
};
const providerResultBrand = Symbol('web-rpc-provider-result');
type IBrandedProviderResult = IWebRpcProviderResult & { readonly [providerResultBrand]: object };
const maxProviderTransferItems = 64;

/** Normalizes provider-owned metadata before it can cross the transport boundary. */
function normalizeTransfer(value: readonly unknown[] | undefined): readonly unknown[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > maxProviderTransferItems)
    throw new WebRpcContractError('provider transfer must be a bounded array');
  const snapshot = Array.from(value);
  return Object.freeze(snapshot);
}

/** Validates and snapshots failure metadata created by untrusted JavaScript callers. */
function normalizeFailure(
  message: string,
  code: string
): { readonly message: string; readonly code: string } {
  if (typeof message !== 'string' || typeof code !== 'string')
    throw new WebRpcContractError('provider failure message and code must be strings');
  return Object.freeze({ message, code });
}

/** Owns inbound provider execution and response settlement. */
export class ProviderExecutor<TTargetId extends string> {
  readonly options: IProviderExecutorOptions<TTargetId>;

  constructor(options: IProviderExecutorOptions<TTargetId>) {
    this.options = options;
  }

  /** Validates, executes, and settles one inbound request. */
  async execute(request: IWebRpcRequest, verifiedPeerKey = ''): Promise<void> {
    const controllerKey = tupleKey(verifiedPeerKey, request.senderId, request.taskId);
    if (this.options.isReplay?.(request, verifiedPeerKey)) return;
    if (this.options.admitReplay && !this.options.admitReplay(request, verifiedPeerKey)) {
      if (!request.dispatchOnly)
        await this.failureResponse(
          request,
          new Error('Request replay ledger is full'),
          WebRpcErrorCode.overloaded
        );
      return;
    }
    if (!this.options.admission.acquire(controllerKey, verifiedPeerKey)) {
      if (!request.dispatchOnly)
        await this.failureResponse(
          request,
          new Error('Provider admission limit reached'),
          WebRpcErrorCode.overloaded
        );
      return;
    }
    if (this.options.retainBinding && !this.options.retainBinding(verifiedPeerKey)) {
      try {
        if (!request.dispatchOnly)
          await this.failureResponse(
            request,
            new Error('Verified peer binding expired'),
            WebRpcErrorCode.overloaded
          );
      } finally {
        this.options.admission.release(controllerKey);
      }
      return;
    }
    try {
      this.options.validate(request.method, 'params', request.data);
    } catch (error) {
      try {
        this.options.markCompleted?.(request, verifiedPeerKey);
        if (!request.dispatchOnly) await this.failureResponse(request, error);
      } finally {
        this.options.admission.release(controllerKey);
        this.options.releaseBinding?.(verifiedPeerKey);
      }
      return;
    }
    const listeners = this.options.registry.getListeners(request.method);
    const provider = this.options.registry.getProvider(request.method);
    let responseSendStarted = false;
    if (this.options.controllers.has(controllerKey)) {
      return;
    }
    const controller = new AbortController();
    this.options.controllers.set(controllerKey, controller);
    if (this.options.consumePendingAbort?.(controllerKey)) controller.abort();
    let expired = false;
    const taskToken = {};
    const expiredResult = (): IBrandedProviderResult => ({
      ok: false,
      message: 'Provider context expired',
      code: WebRpcErrorCode.contextExpired,
      [providerResultBrand]: taskToken
    });
    const isExpired = (): boolean => expired || controller.signal.aborted;
    const context = {
      data: request.data,
      signal: controller.signal,
      success: (
        data?: unknown,
        options?: { readonly transfer?: readonly unknown[] }
      ): IWebRpcProviderResult =>
        isExpired()
          ? expiredResult()
          : Object.freeze({
              ok: true,
              data,
              transfer: normalizeTransfer(options?.transfer),
              [providerResultBrand]: taskToken
            } as IBrandedProviderResult),
      failed: (message: string, code: string): IWebRpcProviderResult => {
        if (isExpired()) return expiredResult();
        const failure = normalizeFailure(message, code);
        return Object.freeze({
          ok: false,
          message: failure.message,
          code: failure.code,
          [providerResultBrand]: taskToken
        } as IBrandedProviderResult);
      },
      dispatchTo: ({ id, method, data }: { id?: string; method: string; data: unknown }) => {
        if (isExpired()) return;
        if (id !== undefined) {
          if (typeof id !== 'string' || id.length === 0)
            throw new WebRpcContractError('dispatch target id must be a non-empty string');
          this.options.dispatch(id as TTargetId, method, data);
          return;
        }
        for (const peer of this.options.peers)
          if (peer !== request.senderId) this.options.dispatch(peer, method, data);
      }
    };
    try {
      if (request.dispatchOnly && listeners?.length) {
        for (const listener of Array.from(listeners)) await listener(context);
        return;
      }
      if (!provider) {
        if (!request.dispatchOnly) {
          responseSendStarted = true;
          await this.failureResponse(
            request,
            new Error('Provider not found'),
            WebRpcErrorCode.providerNotFound
          );
        }
        return;
      }
      const result = await provider(context);
      if (request.dispatchOnly) return;
      if (isExpired()) return;
      const response: IWebRpcProviderResult =
        result &&
        typeof result === 'object' &&
        (result as Partial<IBrandedProviderResult>)[providerResultBrand] === taskToken
          ? (result as IWebRpcProviderResult)
          : {
              ok: false,
              message: 'Provider did not settle',
              code: WebRpcErrorCode.providerNotSettled
            };
      if (response.ok) this.options.validate(request.method, 'result', response.data);
      responseSendStarted = true;
      await this.options.send(
        {
          kind: WebRpcMessageKind.response,
          version: request.version,
          taskId: request.taskId,
          senderId: this.options.id,
          targetId: request.senderId,
          method: request.method,
          ok: response.ok,
          data: response.ok ? response.data : undefined,
          message: response.ok ? undefined : response.message,
          code: response.ok ? undefined : response.code,
          sentAt: Date.now(),
          ...(request.receiverId === undefined ? {} : { receiverId: request.receiverId })
        },
        response.ok ? response.transfer : undefined
      );
    } catch (error) {
      if (!request.dispatchOnly && !responseSendStarted && !isExpired())
        await this.failureResponse(request, error);
      this.options.emitFailure(
        error,
        error instanceof WebRpcSchemaValidationError
          ? WebRpcErrorCode.schemaInvalid
          : WebRpcErrorCode.internal
      );
    } finally {
      this.options.admission.release(controllerKey);
      this.options.releaseBinding?.(verifiedPeerKey);
      this.options.controllers.delete(controllerKey);
      this.options.markCompleted?.(request, verifiedPeerKey);
      expired = true;
    }
  }

  private async failureResponse(
    request: IWebRpcRequest,
    error: unknown,
    explicitCode?: string
  ): Promise<void> {
    const schemaError = error instanceof WebRpcSchemaValidationError;
    await this.options.send({
      kind: WebRpcMessageKind.response,
      version: request.version,
      taskId: request.taskId,
      senderId: this.options.id,
      targetId: request.senderId,
      method: request.method,
      ok: false,
      code:
        explicitCode ?? (schemaError ? WebRpcErrorCode.schemaInvalid : WebRpcErrorCode.internal),
      message: schemaError
        ? safeString(safeRead<unknown>(error, 'message'), 'Schema validation failed')
        : 'Provider failed',
      data: error instanceof WebRpcSchemaValidationError ? error.data : undefined,
      sentAt: Date.now(),
      ...(schemaError ? { serializedError: serializeError(error) } : {}),
      ...(request.receiverId === undefined ? {} : { receiverId: request.receiverId })
    });
  }
}
