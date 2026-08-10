import {
  WebRpcAbortError,
  WebRpcError,
  WebRpcErrorCode,
  WebRpcContractError,
  WebRpcLifecycleError,
  WebRpcRemoteError,
  WebRpcSerializationError,
  WebRpcSchemaValidationError,
  WebRpcTransportError,
  WebRpcTimeoutError
} from './errors';
import type {
  IWebRpcContractConfig,
  IWebRpcEndpoint,
  IWebRpcEventListener,
  IWebRpcHook,
  IWebRpcProvider,
  IWebRpcProviderResult,
  ISendOptions,
  IWebRpcSchemaIssue,
  IWebRpcUuidConfig,
  IWebRpcProtocolConfig,
  IWebRpcTimeoutConfig,
  IWebRpcHooksConfig,
  IWebRpcChunkConfig,
  IWebRpcConnectConfig
} from './typing';
import type { IWebRpcTransport } from './transport';
import {
  assertMethod,
  isWebRpcEnvelope,
  type IWebRpcChunkAck,
  type IWebRpcChunkFrame,
  type IWebRpcRequest,
  type IWebRpcResponse
} from './wire';

type IPendingTask = {
  method: string;
  targetId: string;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
  timer?: ReturnType<typeof setTimeout>;
  abort?: () => void;
};

export class WebRpcEndpoint<
  TTargetId extends string = string
> implements IWebRpcEndpoint<TTargetId> {
  readonly #id: string;
  readonly #transport: IWebRpcTransport;
  readonly #pending = new Map<string, IPendingTask>();
  readonly #providers = new Map<string, IWebRpcProvider>();
  readonly #events = new Map<string, IWebRpcEventListener[]>();
  readonly #peers = new Set<TTargetId>();
  readonly #hooks = new Set<IWebRpcHook>();
  readonly #pingPending = new Map<
    string,
    { resolve: (value: boolean) => void; timer: ReturnType<typeof setTimeout> }
  >();
  readonly #activeControllers = new Map<string, AbortController>();
  readonly #contract: IWebRpcContractConfig;
  readonly #version: string;
  readonly #acceptedVersions: readonly string[];
  readonly #maxIdentifierLength: number;
  readonly #uuid: IWebRpcUuidConfig;
  readonly #protocol: IWebRpcProtocolConfig;
  readonly #timeout: IWebRpcTimeoutConfig;
  readonly #hooksConfig: IWebRpcHooksConfig;
  readonly #chunk: IWebRpcChunkConfig;
  readonly #chunks = new Map<string, { total: number; parts: Map<number, string> }>();
  readonly #connect: IWebRpcConnectConfig | undefined;
  readonly #unsubscribe: () => void;
  readonly #unsubscribeTransportError: (() => void) | undefined;
  readonly #unsubscribeListenerError: (() => void) | undefined;
  #disposed = false;

  constructor(
    id: string,
    transport: IWebRpcTransport,
    providers?: Readonly<Record<string, IWebRpcProvider>>,
    contract: IWebRpcContractConfig = {},
    uuid: IWebRpcUuidConfig = {},
    protocol: IWebRpcProtocolConfig = {},
    timeout: IWebRpcTimeoutConfig = {},
    hooksConfig: IWebRpcHooksConfig = {},
    chunk: IWebRpcChunkConfig = {},
    targetIds: readonly TTargetId[] = [],
    connect: IWebRpcConnectConfig | undefined = undefined
  ) {
    if (typeof id !== 'string' || id.length === 0)
      throw new TypeError('id must be a non-empty string');
    if (
      typeof contract.version !== 'undefined' &&
      (typeof contract.version !== 'string' || contract.version.length === 0)
    )
      throw new WebRpcContractError('contract version must be a non-empty string');
    if (
      !Number.isSafeInteger(contract.maxIdentifierLength ?? 128) ||
      (contract.maxIdentifierLength ?? 128) <= 0
    )
      throw new WebRpcContractError('maxIdentifierLength must be a positive safe integer');
    if (
      contract.acceptVersions &&
      !contract.acceptVersions.every((version) => typeof version === 'string' && version.length > 0)
    )
      throw new WebRpcContractError('acceptVersions must contain non-empty strings');
    this.#id = id;
    this.#transport = transport;
    this.#contract = contract;
    this.#version = contract.version ?? '1.0';
    this.#acceptedVersions = contract.acceptVersions ?? [this.#version];
    this.#maxIdentifierLength = contract.maxIdentifierLength ?? 128;
    this.#uuid = uuid;
    this.#protocol = protocol;
    this.#timeout = timeout;
    this.#hooksConfig = hooksConfig;
    this.#chunk = chunk;
    for (const targetId of targetIds) this.#peers.add(targetId);
    this.#connect = connect;
    const configuredHooks = hooksConfig.listeners
      ? Array.isArray(hooksConfig.listeners)
        ? hooksConfig.listeners
        : [hooksConfig.listeners]
      : [];
    for (const listener of configuredHooks) this.#hooks.add(listener);
    this.#protocol = protocol;
    for (const [method, provider] of Object.entries(providers ?? {}))
      this.provide(method, provider);
    this.#unsubscribe = transport.subscribe((message) => {
      void this.#receive(message);
    });
    this.#unsubscribeTransportError = transport.onTransportError?.((error) =>
      this.#failTransport(error)
    );
    this.#unsubscribeListenerError = transport.onListenerError?.((error) =>
      this.#emit({ name: 'transport.listener.failure', code: WebRpcErrorCode.transport, error })
    );
  }

  get hooks(): { on(listener: IWebRpcHook): () => void } {
    return {
      on: (listener) => {
        this.#hooks.add(listener);
        return () => this.#hooks.delete(listener);
      }
    };
  }
  provide(method: string, provider: IWebRpcProvider): this {
    this.#assertActive();
    assertMethod(method);
    if (typeof provider !== 'function') throw new TypeError('provider must be a function');
    if (this.#providers.has(method))
      throw new WebRpcError(
        WebRpcErrorCode.providerDuplicated,
        `Provider already registered: ${method}`
      );
    this.#providers.set(method, provider);
    return this;
  }
  on(event: string, listener: IWebRpcEventListener): () => void {
    this.#assertActive();
    assertMethod(event);
    const listeners = this.#events.get(event) ?? [];
    listeners.push(listener);
    this.#events.set(event, listeners);
    return () => {
      const current = this.#events.get(event);
      if (!current) return;
      const index = current.indexOf(listener);
      if (index >= 0) current.splice(index, 1);
      if (current.length === 0) this.#events.delete(event);
    };
  }
  async send<T>(
    targetId: TTargetId,
    method: string,
    data: unknown,
    options: ISendOptions = {}
  ): Promise<T> {
    this.#assertActive();
    assertMethod(method);
    this.#peers.add(targetId);
    this.#validateData(method, 'params', data);
    const retry = this.#timeout.retry;
    let attempt = 0;
    while (true) {
      const request: IWebRpcRequest = {
        kind: 'request',
        version: this.#version,
        taskId: this.#makeId('task', targetId),
        senderId: this.#id,
        targetId,
        method,
        data,
        sentAt: Date.now()
      };
      try {
        return await this.#request<T>(request, options);
      } catch (error) {
        const maxAttempts = retry?.maxAttempts ?? 0;
        if (!retry || attempt >= maxAttempts) throw error;
        const context = { attempt: attempt + 1, error, targetId: String(targetId), method, data };
        if (retry.shouldRetry && !(await retry.shouldRetry(context))) throw error;
        const delay = retry.delay ? await retry.delay(context) : 0;
        if (delay === false || delay === null) throw error;
        if (delay > 0) await new Promise<void>((resolve) => setTimeout(resolve, delay));
        attempt += 1;
      }
    }
  }
  async sendAll<T>(
    method: string,
    data: unknown,
    options?: ISendOptions
  ): Promise<Record<TTargetId, T>> {
    const targets = [...this.#peers] as TTargetId[];
    const entries = await Promise.all(
      targets.map(
        async (target) => [target, await this.send<T>(target, method, data, options)] as const
      )
    );
    return Object.fromEntries(entries) as Record<TTargetId, T>;
  }
  dispatch(targetId: TTargetId, method: string, data: unknown): void {
    this.#assertActive();
    assertMethod(method);
    this.#peers.add(targetId);
    void this.#send({
      kind: 'request',
      version: this.#version,
      taskId: this.#makeId('message', targetId),
      senderId: this.#id,
      targetId,
      method,
      data,
      dispatchOnly: true,
      sentAt: Date.now()
    });
  }
  dispatchAll(method: string, data: unknown): void {
    for (const target of [...this.#peers]) this.dispatch(target, method, data);
  }
  ping(targetId: TTargetId): Promise<boolean> {
    this.#assertActive();
    const taskId = this.#makeId('variation', targetId);
    this.#peers.add(targetId);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.#pingPending.delete(taskId);
        resolve(false);
      }, 1000);
      this.#pingPending.set(taskId, { resolve, timer });
      void this.#transport.send({
        kind: 'variation',
        variation: 'ping',
        taskId,
        senderId: this.#id,
        targetId
      });
    });
  }
  async pingAll(): Promise<Record<TTargetId, boolean>> {
    const targets = [...this.#peers] as TTargetId[];
    const entries = await Promise.all(
      targets.map(async (target) => [target, await this.ping(target)] as const)
    );
    return Object.fromEntries(entries) as Record<TTargetId, boolean>;
  }
  async dispose(): Promise<void> {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#unsubscribe();
    this.#unsubscribeTransportError?.();
    this.#unsubscribeListenerError?.();
    for (const [taskId, pending] of this.#pending) {
      if (pending.timer) clearTimeout(pending.timer);
      pending.abort?.();
      pending.reject(new WebRpcLifecycleError('Endpoint disposed'));
      this.#pending.delete(taskId);
    }
    for (const [taskId, pending] of this.#pingPending) {
      clearTimeout(pending.timer);
      pending.resolve(false);
      this.#pingPending.delete(taskId);
    }
    for (const controller of this.#activeControllers.values()) controller.abort();
    this.#activeControllers.clear();
    await this.#transport.close?.();
  }
  #assertActive(): void {
    if (this.#disposed) throw new WebRpcLifecycleError('Endpoint disposed');
  }
  #failTransport(error: unknown): void {
    const failure = new WebRpcTransportError('Transport failure', error);
    for (const [taskId, pending] of this.#pending) {
      if (pending.timer) clearTimeout(pending.timer);
      pending.abort?.();
      pending.reject(failure);
      this.#pending.delete(taskId);
    }
    this.#emit({ name: 'transport.failure', code: WebRpcErrorCode.transport, error });
  }
  #emit(event: {
    readonly name: string;
    readonly code?: string;
    readonly error?: unknown;
    readonly contract?: unknown;
    readonly variation?: unknown;
  }): void {
    const full = { ...event, at: Date.now(), localId: this.#id };
    for (const listener of [...this.#hooks]) {
      try {
        const result = listener(full);
        if (result instanceof Promise)
          void result.catch((error) => {
            try {
              this.#hooksConfig.onHookError?.(error, full);
            } catch {
              /* hook error handlers are isolated */
            }
          });
      } catch (error) {
        try {
          this.#hooksConfig.onHookError?.(error, full);
        } catch {
          /* hook error handlers are isolated */
        }
      }
    }
  }
  async #request<T>(request: IWebRpcRequest, options: ISendOptions): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (options.signal?.aborted) {
        reject(new WebRpcAbortError());
        return;
      }
      const pending: IPendingTask = {
        method: request.method,
        targetId: request.targetId,
        resolve: (value) => resolve(value as T),
        reject
      };
      if (options.signal) {
        const abort = () => {
          this.#pending.delete(request.taskId);
          reject(new WebRpcAbortError());
          void this.#transport.send({
            kind: 'variation',
            variation: 'abort',
            taskId: request.taskId,
            senderId: this.#id,
            targetId: request.targetId
          });
        };
        options.signal.addEventListener('abort', abort, { once: true });
        pending.abort = () => options.signal?.removeEventListener('abort', abort);
      }
      const timeoutMs =
        options.timeoutMs === undefined ? this.#timeout.timeoutMs : options.timeoutMs;
      if (timeoutMs !== undefined && timeoutMs !== false) {
        if (timeoutMs <= 0) {
          reject(new WebRpcTimeoutError());
          return;
        }
        pending.timer = setTimeout(() => {
          this.#pending.delete(request.taskId);
          pending.abort?.();
          reject(new WebRpcTimeoutError());
        }, timeoutMs);
      }
      this.#pending.set(request.taskId, pending);
      Promise.resolve(this.#send(request)).catch((error) => {
        this.#pending.delete(request.taskId);
        if (pending.timer) clearTimeout(pending.timer);
        reject(new WebRpcTransportError('Transport send failed', error));
      });
    });
  }
  async #receive(message: unknown): Promise<void> {
    if (
      message &&
      typeof message === 'object' &&
      (message as { kind?: unknown }).kind === 'chunk'
    ) {
      const assembled = this.#receiveChunk(message as IWebRpcChunkFrame);
      if (assembled === undefined) return;
      message = assembled;
    }
    let decoded: unknown;
    try {
      decoded = this.#protocol.decode ? this.#protocol.decode(message) : message;
    } catch (error) {
      this.#emit({ name: 'failure', code: 'PAYLOAD_INVALID', error });
      return;
    }
    if (!isWebRpcEnvelope(decoded)) return;
    const envelope = decoded;
    if (envelope.kind === 'chunk-ack') {
      this.#emit({ name: 'chunk.ack', variation: envelope });
      return;
    }
    if (envelope.kind === 'chunk') return;
    if (this.#connect) {
      if (this.#connect.transport.peerId && envelope.senderId !== this.#connect.transport.peerId) {
        this.#emit({ name: 'failure', code: 'UNAUTHENTICATED' });
        return;
      }
      if (
        this.#connect.identifier &&
        !(await this.#connect.identifier({
          senderId: envelope.senderId,
          targetId: envelope.targetId,
          peerId: this.#connect.transport.peerId,
          origin: this.#connect.transport.origin
        }))
      ) {
        this.#emit({ name: 'failure', code: 'UNAUTHENTICATED' });
        return;
      }
    }
    if (envelope.kind !== 'variation' && !this.#validContract(envelope)) {
      this.#emit({ name: 'failure', code: 'CONTRACT_INVALID', contract: envelope });
      return;
    }
    if (envelope.targetId !== this.#id) return;
    this.#peers.add(envelope.senderId as TTargetId);
    if (envelope.kind === 'response') {
      this.#settle(envelope);
      return;
    }
    if (envelope.kind === 'variation') {
      if (envelope.variation === 'abort' && envelope.taskId) {
        this.#activeControllers.get(`${envelope.senderId}:${envelope.taskId}`)?.abort();
        return;
      }
      if (envelope.variation === 'ping')
        void this.#transport.send({
          kind: 'variation',
          variation: 'pong',
          taskId: envelope.taskId,
          senderId: this.#id,
          targetId: envelope.senderId
        });
      if (envelope.variation === 'pong' && envelope.taskId) {
        const pending = this.#pingPending.get(envelope.taskId);
        if (pending) {
          clearTimeout(pending.timer);
          this.#pingPending.delete(envelope.taskId);
          pending.resolve(true);
        }
      }
      return;
    }
    await this.#handleRequest(envelope);
  }
  #settle(response: IWebRpcResponse): void {
    const pending = this.#pending.get(response.taskId);
    if (!pending) return;
    if (
      response.method !== pending.method ||
      response.senderId !== pending.targetId ||
      response.targetId !== this.#id
    ) {
      this.#pending.delete(response.taskId);
      if (pending.timer) clearTimeout(pending.timer);
      pending.abort?.();
      pending.reject(new WebRpcContractError('Response does not match pending request'));
      return;
    }
    this.#pending.delete(response.taskId);
    if (pending.timer) clearTimeout(pending.timer);
    pending.abort?.();
    if (response.ok) {
      try {
        this.#validateData(response.method ?? '', 'result', response.data);
        pending.resolve(response.data);
      } catch (error) {
        pending.reject(error);
      }
    } else if (response.code === WebRpcErrorCode.schemaInvalid)
      pending.reject(
        new WebRpcSchemaValidationError(
          response.message ?? 'Schema validation failed',
          response.data
        )
      );
    else
      pending.reject(
        new WebRpcRemoteError(
          response.code ?? WebRpcErrorCode.internal,
          response.message ?? 'Remote provider failed',
          response.data
        )
      );
  }
  async #handleRequest(request: IWebRpcRequest): Promise<void> {
    try {
      this.#validateData(request.method, 'params', request.data);
    } catch (error) {
      if (!request.dispatchOnly)
        await this.#send({
          kind: 'response',
          version: this.#version,
          taskId: request.taskId,
          senderId: this.#id,
          targetId: request.senderId,
          method: request.method,
          ok: false,
          code: WebRpcErrorCode.schemaInvalid,
          message: error instanceof Error ? error.message : String(error),
          data: error instanceof WebRpcSchemaValidationError ? error.data : undefined,
          sentAt: Date.now()
        });
      return;
    }
    const listeners = this.#events.get(request.method);
    const provider = this.#providers.get(request.method);
    const controller = new AbortController();
    const controllerKey = `${request.senderId}:${request.taskId}`;
    this.#activeControllers.set(controllerKey, controller);
    let expired = false;
    const context = {
      data: request.data,
      signal: controller.signal,
      success: (data?: unknown): IWebRpcProviderResult =>
        expired
          ? { ok: false, message: 'Provider context expired', code: WebRpcErrorCode.contextExpired }
          : { ok: true, data },
      failed: (message: string, code: string): IWebRpcProviderResult =>
        expired
          ? { ok: false, message: 'Provider context expired', code: WebRpcErrorCode.contextExpired }
          : { ok: false, message, code },
      dispatchTo: ({ id, method, data }: { id?: string; method: string; data: unknown }) => {
        if (id) this.dispatch(id as TTargetId, method, data);
        else
          for (const peer of this.#peers)
            if (peer !== request.senderId) this.dispatch(peer, method, data);
      }
    };
    try {
      if (request.dispatchOnly && listeners?.length) {
        for (const listener of [...listeners]) await listener(context);
        return;
      }
      if (!provider) {
        if (request.dispatchOnly) return;
        await this.#send({
          kind: 'response',
          version: this.#version,
          taskId: request.taskId,
          senderId: this.#id,
          targetId: request.senderId,
          method: request.method,
          ok: false,
          code: 'PROVIDER_NOT_FOUND',
          message: 'Provider not found',
          sentAt: Date.now()
        });
        return;
      }
      const result = await provider(context);
      if (request.dispatchOnly) return;
      const response: IWebRpcProviderResult =
        result && typeof result === 'object' && 'ok' in result
          ? result
          : {
              ok: false,
              message: 'Provider did not settle',
              code: WebRpcErrorCode.providerNotSettled
            };
      if (response.ok) this.#validateData(request.method, 'result', response.data);
      await this.#send({
        kind: 'response',
        version: this.#version,
        taskId: request.taskId,
        senderId: this.#id,
        targetId: request.senderId,
        method: request.method,
        ...response,
        sentAt: Date.now()
      });
    } catch (error) {
      const code =
        error instanceof WebRpcSchemaValidationError
          ? WebRpcErrorCode.schemaInvalid
          : WebRpcErrorCode.internal;
      if (!request.dispatchOnly)
        await this.#send({
          kind: 'response',
          version: this.#version,
          taskId: request.taskId,
          senderId: this.#id,
          targetId: request.senderId,
          method: request.method,
          ok: false,
          code,
          message: error instanceof Error ? error.message : String(error),
          data: error instanceof WebRpcSchemaValidationError ? error.data : undefined,
          sentAt: Date.now()
        });
      this.#emit({ name: 'failure', error, code });
    } finally {
      this.#activeControllers.delete(controllerKey);
      expired = true;
    }
  }
  #validateData(method: string, side: 'params' | 'result', data: unknown): void {
    const schema = this.#contract.schemas?.[method]?.[side];
    if (!schema) return;
    try {
      schema.parse(data);
    } catch (cause) {
      const issue: IWebRpcSchemaIssue = {
        path: [],
        message: cause instanceof Error ? cause.message : String(cause)
      };
      throw new WebRpcSchemaValidationError(
        `Schema validation failed for ${method} ${side}`,
        { kind: 'schema-validation', method, side, issues: [issue] },
        cause
      );
    }
  }
  #validContract(message: IWebRpcRequest | IWebRpcResponse): boolean {
    return (
      this.#acceptedVersions.includes(message.version) &&
      Number.isSafeInteger(message.sentAt) &&
      message.senderId.length > 0 &&
      message.senderId.length <= this.#maxIdentifierLength &&
      message.targetId.length > 0 &&
      message.targetId.length <= this.#maxIdentifierLength &&
      message.taskId.length > 0 &&
      message.taskId.length <= this.#maxIdentifierLength &&
      message.method.length > 0 &&
      message.method.length <= this.#maxIdentifierLength
    );
  }
  #send(message: unknown): void | Promise<void> {
    try {
      const encoded = this.#protocol.encode ? this.#protocol.encode(message) : message;
      const chunkSize = this.#chunk.chunkSize ?? 0;
      if (
        this.#chunk.maxMessageBytes &&
        typeof encoded === 'string' &&
        encoded.length > this.#chunk.maxMessageBytes
      )
        throw new WebRpcSerializationError('Encoded message exceeds configured maximum');
      if (chunkSize > 0 && typeof encoded === 'string' && encoded.length > chunkSize) {
        const targetId = (message as { targetId: TTargetId }).targetId;
        const messageId = this.#makeId('message', targetId);
        const total = Math.ceil(encoded.length / chunkSize);
        return Promise.all(
          Array.from({ length: total }, (_, index) =>
            this.#transport.send({
              kind: 'chunk',
              messageId,
              index,
              total,
              data: encoded.slice(index * chunkSize, (index + 1) * chunkSize),
              senderId: this.#id,
              targetId
            })
          )
        ).then(() => undefined);
      }
      return this.#transport.send(encoded);
    } catch (cause) {
      throw new WebRpcSerializationError('Protocol encode failed', cause);
    }
  }
  #receiveChunk(frame: IWebRpcChunkFrame): string | undefined {
    const current = this.#chunks.get(frame.messageId) ?? {
      total: frame.total,
      parts: new Map<number, string>()
    };
    if (
      current.total !== frame.total ||
      frame.index < 0 ||
      frame.index >= frame.total ||
      current.parts.has(frame.index)
    )
      return undefined;
    current.parts.set(frame.index, frame.data);
    this.#chunks.set(frame.messageId, current);
    if (current.parts.size !== current.total) return undefined;
    this.#chunks.delete(frame.messageId);
    void this.#transport.send({
      kind: 'chunk-ack',
      messageId: frame.messageId,
      senderId: frame.targetId,
      targetId: frame.senderId
    } satisfies IWebRpcChunkAck);
    return Array.from({ length: current.total }, (_, index) => current.parts.get(index) ?? '').join(
      ''
    );
  }
  #makeId(variation: 'task' | 'message' | 'variation', targetId: TTargetId): string {
    const generated =
      this.#uuid.generate?.({ variation, senderId: this.#id, targetId }) ?? this.#defaultId();
    if (typeof generated !== 'string' || generated.length === 0)
      throw new WebRpcError(
        WebRpcErrorCode.invalidConfig,
        'UUID generator must return a non-empty string'
      );
    const id = `${variation.toUpperCase()}:${this.#id}:${generated}`;
    if (this.#pending.has(id) || this.#pingPending.has(id))
      throw new WebRpcError(WebRpcErrorCode.invalidConfig, `UUID conflict: ${id}`);
    return id;
  }
  #defaultId(): string {
    const cryptoApi = globalThis.crypto;
    if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();
    if (cryptoApi?.getRandomValues) {
      const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
      return [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
    }
    throw new WebRpcError(WebRpcErrorCode.invalidConfig, 'UUID unavailable');
  }
}
