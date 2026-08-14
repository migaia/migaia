import { WebRpcEndpoint } from './endpoint';
import { WebRpcCapabilityKey, WebRpcCapabilityRegistry } from './internal/runtime';
import {
  WebRpcAbortError,
  WebRpcConstructionError,
  WebRpcError,
  WebRpcErrorCode,
  WebRpcTimeoutError
} from './errors';
import { raceWithAsyncControl } from './internal/async-control';
import { safeRead } from './internal/safe-value';
import type {
  IWebRpcAbortCapability,
  IWebRpcFactoryConfig,
  IWebRpcPingCapability,
  IWebRpcHookEvent,
  IWebRpcMiddleware,
  IWebRpcPlatform,
  IWebRpcConnectCapability,
  IWebRpcAuthenticationCapability,
  IFactoryDiscoveryMode,
  IFactoryPingCapability,
  IWebRpcMiddleware as IWebRpcMiddlewareType,
  IWebRpcEndpoint as IWebRpcEndpointType
} from './typing';
import type { IWebRpcTransport } from './transport';

export async function createEndpoint<
  TTargetId extends string = string,
  TMiddlewares extends readonly IWebRpcMiddlewareType[] = readonly IWebRpcMiddlewareType[]
>(
  config: IWebRpcFactoryConfig<TTargetId, TMiddlewares>
): Promise<
  IWebRpcEndpointType<
    TTargetId,
    IFactoryDiscoveryMode<TMiddlewares>,
    IFactoryPingCapability<TMiddlewares>
  >
> {
  let factoryId: unknown;
  let factoryMiddlewares: unknown;
  let factoryTargetIds: unknown;
  let factoryTransport: unknown;
  let factoryProvider: unknown;
  let construction: IWebRpcFactoryConfig['construction'];
  let factoryReplay: IWebRpcFactoryConfig['replay'];
  try {
    if (!config || typeof config !== 'object' || Array.isArray(config))
      throw new Error('factory descriptor is invalid');
    factoryId = config.id;
    factoryMiddlewares = config.middlewares;
    factoryTargetIds = config.targetIds;
    factoryTransport = config.transport;
    factoryProvider = config.provider;
    construction = config.construction;
    // Snapshotted here with everything else, not read again later at endpoint-construction
    // time: reading it late (past middleware install) means a hostile `replay` getter would
    // surface its error only after side effects already ran, instead of being rejected
    // upfront like every other config field — see WR-R3-2 in
    // docs/review/2026-08-13-plugin-host-logger-web-rpc-hardening.sdd.md.
    factoryReplay = config.replay;
  } catch (error) {
    throw new WebRpcError(WebRpcErrorCode.invalidConfig, 'factory descriptor is unreadable', error);
  }
  if (typeof factoryId !== 'string' || factoryId.length === 0)
    throw new WebRpcError(WebRpcErrorCode.invalidConfig, 'id must be a non-empty string');
  try {
    if (!Array.isArray(factoryMiddlewares))
      throw new WebRpcError(WebRpcErrorCode.invalidConfig, 'middlewares must be an array');
    if (factoryTargetIds !== undefined && !Array.isArray(factoryTargetIds))
      throw new WebRpcError(WebRpcErrorCode.invalidConfig, 'targetIds must be an array');
    if (
      (factoryTargetIds as readonly unknown[] | undefined)?.some(
        (targetId) => typeof targetId !== 'string' || targetId.length === 0
      )
    )
      throw new WebRpcError(
        WebRpcErrorCode.invalidConfig,
        'targetIds must contain non-empty strings'
      );
  } catch (error) {
    if (error instanceof WebRpcError) throw error;
    throw new WebRpcError(WebRpcErrorCode.invalidConfig, 'factory collection is unreadable', error);
  }
  let middlewareSnapshots: Array<{
    readonly name: string;
    readonly install: IWebRpcMiddleware['install'];
    readonly transport?: IWebRpcTransport;
  }>;
  try {
    middlewareSnapshots = (factoryMiddlewares as readonly IWebRpcMiddleware[]).map((middleware) => {
      const name = safeRead<unknown>(middleware, 'name');
      const install = safeRead<unknown>(middleware, 'install');
      const middlewareTransport = safeRead<unknown>(middleware, 'transport');
      if (
        typeof name !== 'string' ||
        name.length === 0 ||
        typeof install !== 'function' ||
        (middlewareTransport !== undefined &&
          (!middlewareTransport || typeof middlewareTransport !== 'object'))
      )
        throw new WebRpcError(
          WebRpcErrorCode.invalidConfig,
          'middleware must contain a valid name and install function'
        );
      return {
        name,
        install: install as IWebRpcMiddleware['install'],
        transport: middlewareTransport as IWebRpcTransport | undefined
      };
    });
    const names = new Set<string>();
    for (const middleware of middlewareSnapshots) {
      if (names.has(middleware.name))
        throw new WebRpcError(
          WebRpcErrorCode.middlewareDuplicated,
          `Duplicate middleware: ${middleware.name}`
        );
      names.add(middleware.name);
    }
  } catch (error) {
    if (error instanceof WebRpcError) throw error;
    throw new WebRpcError(WebRpcErrorCode.invalidConfig, 'middlewares are unreadable', error);
  }
  const transport =
    (factoryTransport as IWebRpcTransport | undefined) ??
    middlewareSnapshots.find((item) => item.transport)?.transport;
  if (!transport)
    throw new WebRpcError(
      WebRpcErrorCode.invalidConfig,
      'connect middleware must provide transport'
    );
  const send = safeRead<unknown>(transport, 'send');
  const subscribe = safeRead<unknown>(transport, 'subscribe');
  const platform = safeRead<unknown>(transport, 'platform');
  const encodedType = safeRead<unknown>(transport, 'encodedType');
  const ownership = safeRead<unknown>(transport, 'ownership');
  if (
    typeof send !== 'function' ||
    typeof subscribe !== 'function' ||
    ![
      'Worker',
      'Iframe',
      'BroadcastChannel',
      'MessagePort',
      'Memory',
      'WebTransport',
      'RTCDataChannel'
    ].includes(platform as string) ||
    (encodedType !== undefined &&
      encodedType !== 'any' &&
      encodedType !== 'string' &&
      encodedType !== 'uint8array') ||
    (ownership !== undefined && ownership !== 'owned' && ownership !== 'borrowed')
  )
    throw new WebRpcError(WebRpcErrorCode.invalidConfig, 'transport descriptor is invalid');
  if (middlewareSnapshots.some((item) => item.transport && item.transport !== transport))
    throw new WebRpcError(
      WebRpcErrorCode.invalidConfig,
      'all middleware transports must share the canonical transport'
    );
  const capabilities = new WebRpcCapabilityRegistry();
  const middlewareDisposers: Array<() => void | Promise<void>> = [];
  let middlewareInstallPromise: Promise<void> | undefined;
  let middlewareInstallSettled = false;
  const disposeMiddlewares = async (): Promise<void> => {
    const errors: unknown[] = [];
    if (middlewareInstallPromise && !middlewareInstallSettled) {
      try {
        await middlewareInstallPromise;
      } catch (error) {
        errors.push(error);
      }
    }
    middlewareInstallPromise = undefined;
    while (middlewareDisposers.length > 0) {
      const dispose = middlewareDisposers.pop();
      if (!dispose) continue;
      try {
        await dispose();
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) throw new AggregateError(errors, 'middleware disposal failed');
  };
  const installHookEvents: IWebRpcHookEvent[] = [];
  const constructionController = new AbortController();
  let removeConstructionAbortListener: (() => void) | undefined;
  if (construction?.signal) {
    if (construction.signal.aborted) constructionController.abort();
    else {
      const onConstructionAbort = (): void => constructionController.abort();
      construction.signal.addEventListener('abort', onConstructionAbort, { once: true });
      removeConstructionAbortListener = () =>
        construction.signal?.removeEventListener('abort', onConstructionAbort);
    }
  }
  const runConstruction = <T>(operation: () => PromiseLike<T>): Promise<T> =>
    raceWithAsyncControl({
      operation,
      timeoutMs: construction?.timeoutMs,
      signals: [constructionController.signal],
      onTimeout: () => queueMicrotask(() => constructionController.abort()),
      createTimeoutError: () => new WebRpcTimeoutError('Endpoint construction deadline exceeded'),
      createAbortError: () => new WebRpcAbortError('Endpoint construction cancelled')
    });
  const runCleanup = (operation: () => PromiseLike<void>): Promise<void> =>
    raceWithAsyncControl({
      operation,
      timeoutMs: 1000,
      createTimeoutError: () => new Error('construction cleanup deadline exceeded'),
      createAbortError: () => new Error('construction cleanup cancelled')
    });
  try {
    const installMiddlewares = async (): Promise<void> => {
      for (const item of middlewareSnapshots) {
        let result: void | (() => void) | Promise<void | (() => void)>;
        try {
          result = await item.install({
            id: factoryId,
            transport,
            signal: constructionController.signal,
            hooks: (event: IWebRpcHookEvent) => installHookEvents.push(event),
            capabilities
          });
        } catch (error) {
          if (error instanceof WebRpcError && error.code === WebRpcErrorCode.capabilityConflict)
            throw error;
          throw new WebRpcError(
            'PLUGIN_INSTALL_FAILED',
            `Middleware "${item.name}" installation failed: ${
              error instanceof Error ? error.message : String(error)
            }`,
            error
          );
        }
        if (typeof result === 'function') middlewareDisposers.push(result);
      }
    };
    middlewareInstallSettled = false;
    middlewareInstallPromise = installMiddlewares().finally(() => {
      middlewareInstallSettled = true;
    });
    await runConstruction(() => middlewareInstallPromise!);
    middlewareInstallPromise = undefined;
    const installedConnect = capabilities.get<IWebRpcConnectCapability>(
      WebRpcCapabilityKey.connectCapability
    );
    if (!installedConnect)
      throw new WebRpcError(WebRpcErrorCode.middlewareMissing, 'connect middleware is required');
    let connectCapability = installedConnect;
    const protocolCapability = capabilities.get<{ encodedType?: string; identity?: boolean }>(
      WebRpcCapabilityKey.protocolCapability
    );
    const authenticationCapability = capabilities.get<IWebRpcAuthenticationCapability>(
      WebRpcCapabilityKey.authenticationCapability
    );
    const contractCapability = capabilities.get<{ maxIdentifierLength?: number }>(
      WebRpcCapabilityKey.contractCapability
    );
    const maxIdentifierLength = contractCapability?.maxIdentifierLength ?? 128;
    if (
      !Number.isSafeInteger(maxIdentifierLength) ||
      maxIdentifierLength <= 0 ||
      factoryId.length > maxIdentifierLength ||
      (factoryTargetIds as readonly string[] | undefined)?.some(
        (targetId) => targetId.length > maxIdentifierLength
      )
    )
      throw new WebRpcError(
        WebRpcErrorCode.invalidConfig,
        'id and targetIds must fit the configured identifier limit'
      );
    if (installedConnect.uniqueTargetIdFactory) {
      const platform = safeRead<unknown>(transport, 'platform');
      let generated: string;
      try {
        generated = await runConstruction(() =>
          Promise.resolve(
            installedConnect.uniqueTargetIdFactory!({
              endpointId: factoryId,
              platform: platform as IWebRpcPlatform
            })
          )
        );
      } catch (error) {
        if (error instanceof WebRpcAbortError || error instanceof WebRpcTimeoutError) throw error;
        throw new WebRpcError(
          WebRpcErrorCode.invalidConfig,
          'connect.uniqueTargetId factory failed',
          error
        );
      }
      if (
        typeof generated === 'string' &&
        generated.length > 0 &&
        generated.length <= maxIdentifierLength
      )
        connectCapability = { ...installedConnect, uniqueTargetId: generated };
      else connectCapability = { ...installedConnect, uniqueTargetId: undefined };
    }
    const normalizedTargetIds = Object.freeze(
      [...new Set((factoryTargetIds as readonly TTargetId[] | undefined) ?? [])].filter(
        (targetId) => targetId !== factoryId
      )
    );
    if (
      connectCapability.uniqueTargetId !== undefined &&
      platform === 'BroadcastChannel' &&
      [factoryId, ...normalizedTargetIds].some(
        (targetId) => `${targetId}:${connectCapability.uniqueTargetId}`.length > maxIdentifierLength
      )
    ) {
      installHookEvents.push({
        name: 'connect.unique-target-id.ignored',
        at: Date.now(),
        localId: factoryId,
        code: 'UNIQUE_TARGET_ID_DERIVED_ID_TOO_LONG'
      });
      connectCapability = { ...connectCapability, uniqueTargetId: undefined };
    }
    if (
      encodedType &&
      encodedType !== 'any' &&
      (authenticationCapability?.encodedType ?? protocolCapability?.encodedType) !== encodedType
    )
      throw new WebRpcError(
        WebRpcErrorCode.invalidConfig,
        'outbound frame and transport encoded types are incompatible'
      );
    const chunkCapability = capabilities.get<{ chunkSize?: number }>(
      WebRpcCapabilityKey.chunkCapability
    );
    if (chunkCapability?.chunkSize && protocolCapability?.encodedType === 'uint8array')
      throw new WebRpcError(
        WebRpcErrorCode.invalidConfig,
        'chunking Uint8Array protocol output is unsupported'
      );
    capabilities.freeze();
    const endpoint = new WebRpcEndpoint<TTargetId>(
      factoryId,
      transport,
      factoryProvider as IWebRpcFactoryConfig<TTargetId>['provider'],
      {
        capabilities,
        contract: capabilities.get(WebRpcCapabilityKey.contractCapability),
        uuid: capabilities.get(WebRpcCapabilityKey.uuid),
        protocol: capabilities.get(WebRpcCapabilityKey.protocolCapability),
        authentication: authenticationCapability,
        timeout: capabilities.get(WebRpcCapabilityKey.timeoutCapability),
        hooks: capabilities.get(WebRpcCapabilityKey.hooks),
        chunk: capabilities.get(WebRpcCapabilityKey.chunkCapability),
        targetIds: normalizedTargetIds,
        connect: connectCapability,
        features: {
          abort: capabilities.get<IWebRpcAbortCapability>(WebRpcCapabilityKey.abortCapability)
            ?.enabled,
          ping: capabilities.get<IWebRpcPingCapability>(WebRpcCapabilityKey.pingCapability)?.enabled
        },
        initialHookEvents: installHookEvents,
        replay: factoryReplay
      }
    );
    endpoint.addDisposer(disposeMiddlewares);
    return endpoint as unknown as IWebRpcEndpointType<
      TTargetId,
      IFactoryDiscoveryMode<TMiddlewares>,
      IFactoryPingCapability<TMiddlewares>
    >;
  } catch (error) {
    const cleanupErrors: Array<{ readonly resource: string; readonly error: unknown }> = [];
    if (error instanceof WebRpcAbortError || error instanceof WebRpcTimeoutError) {
      const cleanupPromise = Promise.resolve().then(async () => {
        const deferredErrors: Array<{ readonly resource: string; readonly error: unknown }> = [];
        try {
          await runCleanup(disposeMiddlewares);
        } catch (cleanupError) {
          deferredErrors.push({ resource: 'middleware', error: cleanupError });
        }
        if (ownership !== 'borrowed') {
          try {
            await runCleanup(() => Promise.resolve(transport.close?.()));
          } catch (cleanupError) {
            deferredErrors.push({ resource: 'transport', error: cleanupError });
          }
        }
        capabilities.clear();
        return deferredErrors;
      });
      void cleanupPromise.catch(() => undefined);
      if (error instanceof WebRpcAbortError)
        throw new WebRpcAbortError(error.message, cleanupPromise);
      throw new WebRpcTimeoutError(error.message, cleanupPromise);
    }
    if (error instanceof WebRpcConstructionError && error.cleanupPromise) {
      cleanupErrors.push(...(await error.cleanupPromise));
    }
    try {
      await runCleanup(disposeMiddlewares);
    } catch (cleanupError) {
      cleanupErrors.push({ resource: 'middleware', error: cleanupError });
    }
    if (
      !(error instanceof WebRpcConstructionError && error.cleanupPromise) &&
      ownership !== 'borrowed'
    ) {
      try {
        await runCleanup(() => Promise.resolve(transport.close?.()));
      } catch (cleanupError) {
        cleanupErrors.push({ resource: 'transport', error: cleanupError });
      }
    }
    capabilities.clear();
    if (cleanupErrors.length) {
      throw new WebRpcConstructionError(
        'Endpoint construction failed; cleanup also failed',
        error,
        cleanupErrors
      );
    }
    const cause = (error as { cause?: unknown }).cause;
    if (cause instanceof WebRpcError && cause.code === WebRpcErrorCode.capabilityConflict)
      throw cause;
    throw error;
  } finally {
    try {
      removeConstructionAbortListener?.();
    } catch {
      // The construction signal is caller-owned; a hostile cleanup hook must not mask the result.
    }
  }
}
