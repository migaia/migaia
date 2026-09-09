import { WebRpcSharedKey } from './plugin-shared-keys.js'
import {
  rpcProtocolV1,
  type IRpcEnvelope,
  type IRpcFramer,
  type IRpcProtocol
} from '@migaia/rpc-contract'
import { identityCodecV1, type ICodec } from '@migaia/serialize/codec'
import { bindRpcFrameIngress, messageFramerV1 } from '@migaia/rpc-contract/framing'
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
  IWebRpcHooksConfig,
  IWebRpcUuidConfig,
  IWebRpcProtocolCapability,
  IWebRpcPlugin,
  IWebRpcProvider,
  IWebRpcProviderLimits
} from '../typing.js'
import type { IWebRpcTransport } from '../transport.js'
import type { IEndpointKernelTransportSnapshot } from '../endpoint-kernel.js'
import type { IWebRpcFeature } from '../feature.js'
import type { IWebRpcEndpointOptions, IWebRpcSelectedComponents } from './endpoint-options.js'
import type { IWebRpcHooksPort } from './plugin-shared-keys.js'

/** Canonical validated factory snapshot consumed by WebRPC attachments. */
export type IPreparedEndpoint<TTargetId extends string> = {
  readonly id: string
  readonly transport: IWebRpcTransport
  readonly providers: Readonly<Record<string, IWebRpcProvider>> | undefined
  readonly providerLimits?: IWebRpcProviderLimits
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
  /** Complete descriptor snapshot consumed by the feature-neutral kernel. */
  readonly transportSnapshot: IEndpointKernelTransportSnapshot
  readonly providers: Readonly<Record<string, IWebRpcProvider>> | undefined
  readonly providerLimits: IWebRpcProviderLimits | undefined
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
  factoryProviderLimits: IWebRpcProviderLimits | undefined,
  factoryReplay: IWebRpcFactoryConfig['replay'],
  transport: IWebRpcTransport,
  platform: IWebRpcPlatform,
  encodedType: string | undefined,
  _construction: IWebRpcFactoryConfig['construction'],
  components: IWebRpcSelectedComponents,
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
  for (const diagnostic of components.shadowed)
    hooksPort?.reportConstructionDiagnostic?.(
      Object.freeze({
        name: WebRpcErrorText.componentShadowed,
        at: Date.now(),
        localId: factoryId,
        contract: diagnostic
      })
    )
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
  if (!isDirectedCompatible(components, authenticationCapability, encodedType))
    throw new WebRpcError(
      WebRpcErrorCode.invalidConfig,
      'outbound frame and transport encoded types are incompatible'
    )
  return {
    id: factoryId,
    transport,
    providers: factoryProvider,
    providerLimits: factoryProviderLimits,
    options: {
      contract: getShared(WebRpcSharedKey.contract) as IWebRpcContractCapability | undefined,
      uuid: uuidCapability,
      protocol: getShared(WebRpcSharedKey.protocol) as IWebRpcProtocolCapability | undefined,
      authentication: authenticationCapability,
      timeout: timeoutCapability,
      hooks: hooksCapability,
      targetIds: normalizedTargetIds,
      providerLimits: factoryProviderLimits,
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
  TMiddlewares extends readonly IWebRpcPlugin[] = readonly IWebRpcPlugin[],
  TFeatures extends readonly IWebRpcFeature[] = readonly IWebRpcFeature[]
>(
  config: IWebRpcFactoryConfig<TTargetId, TMiddlewares, TFeatures>,
  options: { readonly deferMiddlewareInstall: true }
): Promise<IDeferredPreparedEndpoint<TTargetId>>
export async function prepareEndpoint<
  TTargetId extends string = string,
  TMiddlewares extends readonly IWebRpcPlugin[] = readonly IWebRpcPlugin[],
  TFeatures extends readonly IWebRpcFeature[] = readonly IWebRpcFeature[]
>(
  config: IWebRpcFactoryConfig<TTargetId, TMiddlewares, TFeatures>,
  _options: { readonly deferMiddlewareInstall: true }
): Promise<IDeferredPreparedEndpoint<TTargetId>> {
  let factoryId: unknown
  let factoryMiddlewares: unknown
  let factoryTargetIds: unknown
  let factoryTransport: unknown
  let factoryProvider: unknown
  let factoryProviderLimits: unknown
  let construction: IWebRpcFactoryConfig['construction']
  let factoryReplay: IWebRpcFactoryConfig['replay']
  let factoryProtocol: IWebRpcFactoryConfig['protocol']
  let factoryCodec: IWebRpcFactoryConfig['codec']
  let factoryFramer: IWebRpcFactoryConfig['framer']
  try {
    if (!config || typeof config !== 'object' || Array.isArray(config))
      throw new WebRpcError(WebRpcErrorCode.invalidConfig, 'factory descriptor is invalid')
    factoryId = config.id
    factoryMiddlewares = config.middlewares
    factoryTargetIds = config.targetIds
    factoryTransport = config.transport
    factoryProvider = config.provider
    factoryProviderLimits = config.providerLimits
    construction = config.construction
    // Snapshotted here with everything else, not read again later at endpoint-construction
    // time: reading it late (past middleware install) means a hostile `replay` getter would
    // surface its error only after side effects already ran, instead of being rejected
    // upfront like every other config field — see WR-R3-2 in
    // docs/review/2026-08-13-plugin-host-logger-web-rpc-hardening.sdd.md.
    factoryReplay = config.replay
    factoryProtocol = config.protocol
    factoryCodec = config.codec
    factoryFramer = config.framer
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
      const protocol = safeRead<unknown>(middleware, 'protocol')
      const codec = safeRead<unknown>(middleware, 'codec')
      const framer = safeRead<unknown>(middleware, 'framer')
      const plugin =
        metadata && typeof metadata === 'object' && typeof install === 'function'
          ? Object.freeze({
              name,
              metadata,
              install,
              ...(middlewareTransport === undefined ? {} : { transport: middlewareTransport }),
              ...(discoveryMode === undefined ? {} : { discoveryMode }),
              ...(pingCapability === undefined ? {} : { pingCapability }),
              ...(protocol === undefined ? {} : { protocol }),
              ...(codec === undefined ? {} : { codec }),
              ...(framer === undefined ? {} : { framer })
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
  const transportCandidates = middlewareSnapshots.flatMap((item) =>
    item.transport === undefined ? [] : [item.transport]
  )
  if (transportCandidates.length > 1)
    throw new WebRpcError(WebRpcErrorCode.capabilityConflict, WebRpcErrorText.endpointRouteOwned)
  const transport = (factoryTransport as IWebRpcTransport | undefined) ?? transportCandidates[0]
  if (!transport)
    throw new WebRpcError(
      WebRpcErrorCode.invalidConfig,
      'connect middleware must provide transport'
    )
  const send = safeRead<unknown>(transport, 'send')
  const subscribe = safeRead<unknown>(transport, 'subscribe')
  const close = safeRead<unknown>(transport, 'close')
  const onTransportError = safeRead<unknown>(transport, 'onTransportError')
  const onListenerError = safeRead<unknown>(transport, 'onListenerError')
  const platform = safeRead<unknown>(transport, 'platform')
  const topology = safeRead<unknown>(transport, 'topology')
  const origin = safeRead<unknown>(transport, 'origin')
  const encodedType = safeRead<unknown>(transport, 'encodedType')
  const ownership = safeRead<unknown>(transport, 'ownership')
  const transportSnapshot: IEndpointKernelTransportSnapshot = Object.freeze({
    send,
    subscribe,
    close,
    onTransportError,
    onListenerError,
    platform,
    topology,
    origin,
    encodedType,
    ownership
  })
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
  const components = selectWebRpcComponents({
    protocol: factoryProtocol,
    codec: factoryCodec,
    framer: factoryFramer,
    candidates: middlewareSnapshots.map(({ plugin }) => plugin),
    transportShadow:
      factoryTransport !== undefined && transportCandidates[0] !== undefined
        ? Object.freeze({ winner: transport, shadowed: transportCandidates[0] })
        : undefined
  })
  return {
    id: factoryId as string,
    transport,
    transportSnapshot,
    providers: factoryProvider as IWebRpcFactoryConfig<TTargetId>['provider'],
    providerLimits: factoryProviderLimits as IWebRpcFactoryConfig<TTargetId>['providerLimits'],
    construction,
    middlewareSnapshots: Object.freeze(middlewareSnapshots.map((item) => Object.freeze(item))),
    finalize: async (installHookEvents, runConstruction, getShared) => {
      const prepared = await finalizePreparedEndpoint(
        factoryId as string,
        factoryTargetIds as readonly TTargetId[] | undefined,
        factoryProvider as IWebRpcFactoryConfig<TTargetId>['provider'],
        factoryProviderLimits as IWebRpcFactoryConfig<TTargetId>['providerLimits'],
        factoryReplay,
        transport,
        platform as IWebRpcPlatform,
        encodedType as string | undefined,
        construction,
        components,
        installHookEvents,
        runConstruction,
        getShared
      )
      return {
        ...prepared,
        options: { ...prepared.options, components }
      }
    }
  }
}

/** Resolves top-level then one plugin descriptor before Host installation creates subscriptions. */
function selectWebRpcComponents(
  input: Readonly<{
    readonly protocol?: unknown
    readonly codec?: unknown
    readonly framer?: unknown
    readonly candidates?: readonly IWebRpcPlugin[]
    readonly transportShadow?: Readonly<{ readonly winner: object; readonly shadowed: object }>
  }>
): IWebRpcSelectedComponents {
  const candidates = input.candidates ?? []
  const shadowed: IWebRpcSelectedComponents['shadowed'][number][] = []
  const select = (
    name: 'protocol' | 'codec' | 'framer',
    topLevel: unknown,
    fallback: unknown
  ): Readonly<{ readonly value: unknown; readonly shadowed?: unknown }> => {
    const contributed = candidates.flatMap((candidate) => {
      const value = candidate[name]
      return value === undefined ? [] : [value]
    })
    if (contributed.length > 1)
      throw new WebRpcError(WebRpcErrorCode.capabilityConflict, WebRpcErrorText.endpointRouteOwned)
    return Object.freeze({
      value: topLevel ?? contributed[0] ?? fallback,
      ...(topLevel !== undefined && contributed[0] !== undefined
        ? { shadowed: contributed[0] }
        : {})
    })
  }
  const selectedProtocol = select('protocol', input.protocol, rpcProtocolV1)
  const selectedCodec = select('codec', input.codec, identityCodecV1)
  const selectedFramer = select('framer', input.framer, messageFramerV1)
  const protocol = snapshotProtocol(selectedProtocol.value)
  const codec = snapshotCodec(selectedCodec.value)
  const framer = snapshotFramer(selectedFramer.value)
  const recordShadow = (
    component: string,
    winner: { readonly id: string; readonly version: number },
    ignored: unknown
  ) => {
    if (ignored === undefined) return
    shadowed.push(
      Object.freeze({
        component,
        winner: Object.freeze({ id: winner.id, version: winner.version }),
        shadowed: snapshotIdentity(ignored)
      })
    )
  }
  recordShadow('protocol', protocol, selectedProtocol.shadowed)
  recordShadow('codec', codec, selectedCodec.shadowed)
  recordShadow('framer', framer, selectedFramer.shadowed)
  if (input.transportShadow)
    shadowed.push(
      Object.freeze({
        component: 'transport',
        winner: input.transportShadow.winner,
        shadowed: input.transportShadow.shadowed
      })
    )
  if (!isCompatible(codec, framer))
    throw new WebRpcError(WebRpcErrorCode.invalidConfig, WebRpcErrorText.codecDescriptorInvalid)
  return Object.freeze({
    protocol,
    codec,
    framer,
    ingressPrepare: bindRpcFrameIngress(framer.accept, framer.frame),
    shadowed: Object.freeze(shadowed)
  })
}

/** Captures descriptor identity once for a stable deferred diagnostic. */
function snapshotIdentity(
  value: unknown
): Readonly<{ readonly id: string; readonly version: number }> {
  const id = readDescriptorField(value, 'id')
  const version = readDescriptorField(value, 'version')
  if (!isDescriptorIdentity(id, version) || typeof version !== 'number')
    throw new WebRpcError(WebRpcErrorCode.invalidConfig, WebRpcErrorText.codecDescriptorInvalid)
  return Object.freeze({ id, version })
}

/** Reads one descriptor field once and turns hostile getter failure into one configuration error. */
function readDescriptorField(value: unknown, field: string): unknown {
  try {
    if (!value || typeof value !== 'object') return undefined
    return (value as Record<string, unknown>)[field]
  } catch (cause) {
    throw new WebRpcError(
      WebRpcErrorCode.invalidConfig,
      WebRpcErrorText.codecDescriptorInvalid,
      cause
    )
  }
}

/** Snapshots protocol normalization and rejects the removed byte encode/decode capability. */
function snapshotProtocol(value: unknown): IRpcProtocol<IRpcEnvelope, string, number> {
  const normalize = readDescriptorField(value, 'normalize')
  const id = readDescriptorField(value, 'id')
  const version = readDescriptorField(value, 'version')
  if (
    typeof normalize !== 'function' ||
    !isDescriptorIdentity(id, version) ||
    readDescriptorField(value, 'encode') !== undefined ||
    readDescriptorField(value, 'decode') !== undefined
  )
    throw new WebRpcError(WebRpcErrorCode.invalidConfig, WebRpcErrorText.codecDescriptorInvalid)
  return Object.freeze({
    id,
    version,
    normalize
  }) as IRpcProtocol<IRpcEnvelope, string, number>
}

/** Snapshots codec callables and metadata so later descriptor mutation cannot affect transport. */
function snapshotCodec(value: unknown): ICodec<IRpcEnvelope, unknown> {
  const encode = readDescriptorField(value, 'encode')
  const decode = readDescriptorField(value, 'decode')
  const id = readDescriptorField(value, 'id')
  const version = readDescriptorField(value, 'version')
  const encodedType = readDescriptorField(value, 'encodedType')
  if (
    typeof encode !== 'function' ||
    typeof decode !== 'function' ||
    !isDescriptorIdentity(id, version) ||
    !isEncodedType(encodedType)
  )
    throw new WebRpcError(WebRpcErrorCode.invalidConfig, WebRpcErrorText.codecDescriptorInvalid)
  return Object.freeze({
    id,
    version,
    encodedType,
    encode,
    decode
  }) as ICodec<IRpcEnvelope, unknown>
}

/** Snapshots framer callables and metadata so accepted frame behavior stays construction-stable. */
function snapshotFramer(value: unknown): IRpcFramer<unknown, unknown, string, number> {
  const frame = readDescriptorField(value, 'frame')
  const accept = readDescriptorField(value, 'accept')
  const id = readDescriptorField(value, 'id')
  const version = readDescriptorField(value, 'version')
  const inputEncodedType = readDescriptorField(value, 'inputEncodedType')
  const outputEncodedType = readDescriptorField(value, 'outputEncodedType')
  const close = readDescriptorField(value, 'close')
  if (
    typeof frame !== 'function' ||
    typeof accept !== 'function' ||
    typeof close !== 'function' ||
    !isDescriptorIdentity(id, version) ||
    !isEncodedType(inputEncodedType) ||
    !isEncodedType(outputEncodedType)
  )
    throw new WebRpcError(WebRpcErrorCode.invalidConfig, WebRpcErrorText.framerDescriptorInvalid)
  return Object.freeze({
    id,
    version,
    inputEncodedType,
    outputEncodedType,
    frame,
    accept,
    close
  }) as IRpcFramer<unknown, unknown, string, number>
}

/** Validates the stable public identity required before a component enters construction. */
function isDescriptorIdentity(id: unknown, version: unknown): id is string {
  return (
    typeof id === 'string' &&
    id.length > 0 &&
    typeof version === 'number' &&
    Number.isSafeInteger(version) &&
    version > 0
  )
}

/** Limits directed metadata to the existing codec/framer runtime domain. */
function isEncodedType(value: unknown): value is 'unknown' | 'string' | 'uint8array' {
  return value === 'unknown' || value === 'string' || value === 'uint8array'
}

/** Rejects incompatible codec output before a Host install can create subscriptions. */
function isCompatible(
  codec: ICodec<IRpcEnvelope, unknown>,
  framer: IRpcFramer<unknown, unknown, string, number>
): boolean {
  return framer.inputEncodedType === 'unknown' || codec.encodedType === framer.inputEncodedType
}

/**
 * Verifies codec, actual framing output, authentication output and transport in their send order. A
 * native carrier-or-fragment output is mixed until authentication proves a concrete carrier.
 */
function isDirectedCompatible(
  components: IWebRpcSelectedComponents,
  authentication: IWebRpcAuthenticationCapability | undefined,
  transportEncodedType: string | undefined
): boolean {
  if (!isCompatible(components.codec, components.framer)) return false
  if (transportEncodedType === undefined || transportEncodedType === 'any') return true
  const postAuthentication = authentication?.encodedType
  if (postAuthentication === 'any') return false
  if (postAuthentication === 'string' || postAuthentication === 'uint8array')
    return postAuthentication === transportEncodedType
  if (components.ingressPrepare.nativeOutputDomain !== undefined) return false
  return components.framer.outputEncodedType === transportEncodedType
}
