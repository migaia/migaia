import { WebRpcSharedKey } from './plugin-shared-keys.js'
import { WebRpcAbortError, WebRpcError, WebRpcErrorCode, WebRpcTimeoutError } from '../errors.js'
import { safeRead } from './safe-value.js'
import { WebRpcErrorText } from '../error-text.js'
import type {
  IWebRpcAbortCapability,
  IWebRpcTimeoutCapability,
  IWebRpcFactoryConfig,
  IWebRpcPingCapability,
  IWebRpcHookEvent,
  IWebRpcPlatform,
  IWebRpcConnectCapability,
  IWebRpcAuthenticationCapability,
  IWebRpcContractCapability,
  IWebRpcChunkCapability,
  IWebRpcHooksConfig,
  IWebRpcUuidConfig,
  IWebRpcProtocolCapability,
  IWebRpcPlugin,
  IWebRpcProvider
} from '../typing.js'
import type { IWebRpcTransport } from '../transport.js'
import type { IWebRpcEndpointOptions } from './endpoint-options.js'
import type { IWebRpcHooksPort } from './plugin-shared-keys.js'

/** Canonical validated factory snapshot consumed by WebRPC attachments. */
export type IPreparedEndpoint<TTargetId extends string> = {
  readonly id: string
  readonly transport: IWebRpcTransport
  readonly providers: Readonly<Record<string, IWebRpcProvider>> | undefined
  readonly options: IWebRpcEndpointOptions<TTargetId>
}

/** Immutable middleware metadata captured before the composed Host batch mutates state. */
export type IEndpointMiddlewareSnapshot = {
  readonly name: string
  readonly plugin: IWebRpcPlugin
  readonly transport?: IWebRpcTransport
}

/** Deferred bootstrap result used by the Host-owned composed path. */
export type IDeferredPreparedEndpoint<TTargetId extends string = string> = {
  readonly id: string
  readonly transport: IWebRpcTransport
  readonly providers: Readonly<Record<string, IWebRpcProvider>> | undefined
  /** Construction controls snapshotted with the other outer configuration fields. */
  readonly construction: IWebRpcFactoryConfig['construction']
  readonly middlewareSnapshots: readonly IEndpointMiddlewareSnapshot[]
  readonly finalize: (
    hookEvents: IWebRpcHookEvent[],
    runConstruction: <T>(operation: () => PromiseLike<T>) => Promise<T>,
    getShared: (key: PropertyKey) => unknown
  ) => Promise<IPreparedEndpoint<TTargetId>>
}

/** Builds endpoint options after Host middleware has published the shared capability port. */
async function finalizePreparedEndpoint<TTargetId extends string>(
  factoryId: string,
  factoryTargetIds: readonly TTargetId[] | undefined,
  factoryProvider: Readonly<Record<string, IWebRpcProvider>> | undefined,
  factoryReplay: IWebRpcFactoryConfig['replay'],
  transport: IWebRpcTransport,
  platform: IWebRpcPlatform,
  encodedType: string | undefined,
  _construction: IWebRpcFactoryConfig['construction'],
  installHookEvents: IWebRpcHookEvent[],
  runConstruction: <T>(operation: () => PromiseLike<T>) => Promise<T>,
  getShared: (key: PropertyKey) => unknown
): Promise<IPreparedEndpoint<TTargetId>> {
  const installedConnect = getShared(WebRpcSharedKey.connect) as
    | IWebRpcConnectCapability
    | undefined
  if (!installedConnect)
    throw new WebRpcError(WebRpcErrorCode.middlewareMissing, 'connect middleware is required')
  let connectCapability = installedConnect
  const protocolCapability = getShared(WebRpcSharedKey.protocol) as
    | { readonly encodedType?: string; readonly identity?: boolean }
    | undefined
  const authenticationCapability = getShared(WebRpcSharedKey.authentication) as
    | IWebRpcAuthenticationCapability
    | undefined
  const contractCapability = getShared(WebRpcSharedKey.contract) as
    | { readonly maxIdentifierLength?: number }
    | undefined
  const timeoutCapability = getShared(WebRpcSharedKey.timeout) as
    | IWebRpcTimeoutCapability
    | undefined
  const abortCapability = getShared(WebRpcSharedKey.abort) as IWebRpcAbortCapability | undefined
  const pingCapability = getShared(WebRpcSharedKey.ping) as IWebRpcPingCapability | undefined
  const uuidCapability = getShared(WebRpcSharedKey.uuid) as IWebRpcUuidConfig | undefined
  const hooksPort = getShared(WebRpcSharedKey.hooks) as IWebRpcHooksPort | undefined
  const hooksCapability: IWebRpcHooksConfig | undefined = hooksPort
    ? Object.freeze({
        listeners: hooksPort.listeners,
        ...(hooksPort.onHookError === undefined ? {} : { onHookError: hooksPort.onHookError })
      })
    : undefined
  const chunkCapability = getShared(WebRpcSharedKey.chunk) as IWebRpcChunkCapability | undefined
  const maxIdentifierLength = contractCapability?.maxIdentifierLength ?? 128
  if (
    !Number.isSafeInteger(maxIdentifierLength) ||
    maxIdentifierLength <= 0 ||
    factoryId.length > maxIdentifierLength ||
    factoryTargetIds?.some((targetId) => targetId.length > maxIdentifierLength)
  )
    throw new WebRpcError(
      WebRpcErrorCode.invalidConfig,
      'id and targetIds must fit the configured identifier limit'
    )
  if (installedConnect.uniqueTargetIdFactory) {
    let generated: string
    try {
      generated = await runConstruction(() =>
        Promise.resolve(
          installedConnect.uniqueTargetIdFactory!({ endpointId: factoryId, platform })
        )
      )
    } catch (error) {
      if (error instanceof WebRpcAbortError || error instanceof WebRpcTimeoutError) throw error
      throw new WebRpcError(
        WebRpcErrorCode.invalidConfig,
        'connect.uniqueTargetId factory failed',
        error
      )
    }
    connectCapability =
      typeof generated === 'string' &&
      generated.length > 0 &&
      generated.length <= maxIdentifierLength
        ? { ...installedConnect, uniqueTargetId: generated }
        : { ...installedConnect, uniqueTargetId: undefined }
  }
  const normalizedTargetIds = Object.freeze(
    [...new Set(factoryTargetIds ?? [])].filter((targetId) => targetId !== factoryId)
  )
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
    })
    connectCapability = { ...connectCapability, uniqueTargetId: undefined }
  }
  if (
    encodedType &&
    encodedType !== 'any' &&
    (authenticationCapability?.encodedType ?? protocolCapability?.encodedType) !== encodedType
  )
    throw new WebRpcError(
      WebRpcErrorCode.invalidConfig,
      'outbound frame and transport encoded types are incompatible'
    )
  if (chunkCapability?.chunkSize && protocolCapability?.encodedType === 'uint8array')
    throw new WebRpcError(
      WebRpcErrorCode.invalidConfig,
      'chunking Uint8Array protocol output is unsupported'
    )
  return {
    id: factoryId,
    transport,
    providers: factoryProvider,
    options: {
      contract: getShared(WebRpcSharedKey.contract) as IWebRpcContractCapability | undefined,
      uuid: uuidCapability,
      protocol: getShared(WebRpcSharedKey.protocol) as IWebRpcProtocolCapability | undefined,
      authentication: authenticationCapability,
      timeout: timeoutCapability,
      hooks: hooksCapability,
      chunk: chunkCapability,
      targetIds: normalizedTargetIds,
      connect: connectCapability,
      features: {
        abort: abortCapability?.enabled,
        ping: pingCapability?.enabled
      },
      initialHookEvents: installHookEvents,
      replay: factoryReplay
    }
  }
}

/** Validates and snapshots config before the single PluginHost construction batch. */
export function prepareEndpoint<
  TTargetId extends string = string,
  TMiddlewares extends readonly IWebRpcPlugin[] = readonly IWebRpcPlugin[]
>(
  config: IWebRpcFactoryConfig<TTargetId, TMiddlewares>,
  options: { readonly deferMiddlewareInstall: true }
): Promise<IDeferredPreparedEndpoint<TTargetId>>
export async function prepareEndpoint<
  TTargetId extends string = string,
  TMiddlewares extends readonly IWebRpcPlugin[] = readonly IWebRpcPlugin[]
>(
  config: IWebRpcFactoryConfig<TTargetId, TMiddlewares>,
  _options: { readonly deferMiddlewareInstall: true }
): Promise<IDeferredPreparedEndpoint<TTargetId>> {
  let factoryId: unknown
  let factoryMiddlewares: unknown
  let factoryTargetIds: unknown
  let factoryTransport: unknown
  let factoryProvider: unknown
  let construction: IWebRpcFactoryConfig['construction']
  let factoryReplay: IWebRpcFactoryConfig['replay']
  try {
    if (!config || typeof config !== 'object' || Array.isArray(config))
      throw new WebRpcError(WebRpcErrorCode.invalidConfig, 'factory descriptor is invalid')
    factoryId = config.id
    factoryMiddlewares = config.middlewares
    factoryTargetIds = config.targetIds
    factoryTransport = config.transport
    factoryProvider = config.provider
    construction = config.construction
    // Snapshotted here with everything else, not read again later at endpoint-construction
    // time: reading it late (past middleware install) means a hostile `replay` getter would
    // surface its error only after side effects already ran, instead of being rejected
    // upfront like every other config field — see WR-R3-2 in
    // docs/review/2026-08-13-plugin-host-logger-web-rpc-hardening.sdd.md.
    factoryReplay = config.replay
  } catch (error) {
    if (error instanceof WebRpcError) throw error
    throw new WebRpcError(WebRpcErrorCode.invalidConfig, 'factory descriptor is unreadable', error)
  }
  if (typeof factoryId !== 'string' || factoryId.length === 0)
    throw new WebRpcError(WebRpcErrorCode.invalidConfig, 'id must be a non-empty string')
  try {
    if (!Array.isArray(factoryMiddlewares))
      throw new WebRpcError(WebRpcErrorCode.invalidConfig, 'middlewares must be an array')
    if (factoryTargetIds !== undefined && !Array.isArray(factoryTargetIds))
      throw new WebRpcError(WebRpcErrorCode.invalidConfig, 'targetIds must be an array')
    if (
      (factoryTargetIds as readonly unknown[] | undefined)?.some(
        (targetId) => typeof targetId !== 'string' || targetId.length === 0
      )
    )
      throw new WebRpcError(
        WebRpcErrorCode.invalidConfig,
        'targetIds must contain non-empty strings'
      )
  } catch (error) {
    if (error instanceof WebRpcError) throw error
    throw new WebRpcError(WebRpcErrorCode.invalidConfig, 'factory collection is unreadable', error)
  }
  let middlewareSnapshots: IEndpointMiddlewareSnapshot[]
  try {
    middlewareSnapshots = (factoryMiddlewares as readonly IWebRpcPlugin[]).map((middleware) => {
      const name = safeRead<unknown>(middleware, 'name')
      const metadata = safeRead<unknown>(middleware, 'metadata')
      const install = safeRead<unknown>(middleware, 'install')
      const middlewareTransport = safeRead<unknown>(middleware, 'transport')
      const discoveryMode = safeRead<unknown>(middleware, 'discoveryMode')
      const pingCapability = safeRead<unknown>(middleware, 'pingCapability')
      const plugin =
        metadata && typeof metadata === 'object' && typeof install === 'function'
          ? Object.freeze({
              name,
              metadata,
              install,
              ...(middlewareTransport === undefined ? {} : { transport: middlewareTransport }),
              ...(discoveryMode === undefined ? {} : { discoveryMode }),
              ...(pingCapability === undefined ? {} : { pingCapability })
            } as unknown as IWebRpcPlugin)
          : undefined
      if (
        typeof name !== 'string' ||
        name.length === 0 ||
        !plugin ||
        (middlewareTransport !== undefined &&
          (!middlewareTransport || typeof middlewareTransport !== 'object'))
      )
        throw new WebRpcError(WebRpcErrorCode.invalidConfig, WebRpcErrorText.middlewareMustBePlugin)
      return {
        name: name as string,
        plugin,
        transport: middlewareTransport as IWebRpcTransport | undefined
      }
    })
    const names = new Set<string>()
    for (const middleware of middlewareSnapshots) {
      if (names.has(middleware.name))
        throw new WebRpcError(
          WebRpcErrorCode.middlewareDuplicated,
          `Duplicate middleware: ${middleware.name}`
        )
      names.add(middleware.name)
    }
  } catch (error) {
    if (error instanceof WebRpcError) throw error
    throw new WebRpcError(WebRpcErrorCode.invalidConfig, 'middlewares are unreadable', error)
  }
  const transport =
    (factoryTransport as IWebRpcTransport | undefined) ??
    middlewareSnapshots.find((item) => item.transport)?.transport
  if (!transport)
    throw new WebRpcError(
      WebRpcErrorCode.invalidConfig,
      'connect middleware must provide transport'
    )
  const send = safeRead<unknown>(transport, 'send')
  const subscribe = safeRead<unknown>(transport, 'subscribe')
  const platform = safeRead<unknown>(transport, 'platform')
  const encodedType = safeRead<unknown>(transport, 'encodedType')
  const ownership = safeRead<unknown>(transport, 'ownership')
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
    throw new WebRpcError(WebRpcErrorCode.invalidConfig, 'transport descriptor is invalid')
  if (middlewareSnapshots.some((item) => item.transport && item.transport !== transport))
    throw new WebRpcError(
      WebRpcErrorCode.invalidConfig,
      'all middleware transports must share the canonical transport'
    )
  return {
    id: factoryId as string,
    transport,
    providers: factoryProvider as IWebRpcFactoryConfig<TTargetId>['provider'],
    construction,
    middlewareSnapshots: Object.freeze(middlewareSnapshots.map((item) => Object.freeze(item))),
    finalize: async (installHookEvents, runConstruction, getShared) =>
      finalizePreparedEndpoint(
        factoryId as string,
        factoryTargetIds as readonly TTargetId[] | undefined,
        factoryProvider as IWebRpcFactoryConfig<TTargetId>['provider'],
        factoryReplay,
        transport,
        platform as IWebRpcPlatform,
        encodedType as string | undefined,
        construction,
        installHookEvents,
        runConstruction,
        getShared
      )
  }
}
