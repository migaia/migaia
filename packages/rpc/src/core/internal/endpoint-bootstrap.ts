import {
  isJsonObjectMiddleware,
  readJsonObjectPort,
  rememberJsonObjectCandidate,
  jsonObjectCandidate,
  selectJsonObjectPort
} from './json-object-port.js'
import { RpcPortName } from './plugin-shared-keys.js'
import type { IRpcEnvelope, IRpcFramer, IRpcProtocol } from '../../contract/index.js'
import { rpcProtocol as rpcProtocolV1 } from '../../contract/v1/protocol.js'
import { identityCodecV1, type ICodec } from '@migaia/serialize/codec'
import { bindRpcFrameIngress } from '../../contract/framing/index.js'
import { messageFramerV1 } from '../../contract/framing/message-framer.js'
import {
  RpcAbortError,
  RpcConfigurationError,
  RpcError,
  RpcCoreErrorCode,
  RpcTimeoutError
} from '../errors.js'
import type { IScheduler, IWallClock } from '@migaia/utils/scheduler'
import { isEndpointSystemScheduler } from '../endpoint-kernel.js'
import { proveFastComponents, proveFastEndpoint } from './fast-path.js'
import {
  readCanonicalMiddlewareProof,
  registerJsonObjectMiddleware,
  registerJsonObjectDescriptorMiddleware
} from './json-object-port.js'
import { safeRead } from './safe-value.js'
import { RpcCoreErrorText } from '../error-text.js'
import type {
  IRpcAbortCapability,
  IRpcTimeoutCapability,
  IRpcFactoryConfig,
  IRpcPingCapability,
  IRpcHookEvent,
  IRpcPlatform,
  IRpcConnectCapability,
  IRpcAuthenticationCapability,
  IRpcContractCapability,
  IRpcHooksConfig,
  IRpcUuidConfig,
  IRpcProtocolCapability,
  IRpcPlugin,
  IRpcMiddleware,
  IRpcProvider,
  IRpcProviderLimits,
  IRpcIdempotencyConfig
} from '../typing.js'
import type { IRpcTransport } from '../transport.js'
import { RpcPlatform } from '../transport-constants.js'
import { readTransportSnapshot, type IEndpointKernelTransportSnapshot } from '../endpoint-kernel.js'
import type { IRpcFeature } from '../feature.js'
import {
  isDefinedMiddleware,
  readDefinedMiddlewareComponents,
  readDefinedMiddlewarePolicy,
  type IRpcMiddlewareComponentPolicy
} from '../middleware.js'
import type { IRpcPluginConstraint } from './plugin-contract.js'
import type { IRpcEndpointOptions, IRpcSelectedComponents } from './endpoint-options.js'
import type { IRpcHooksPort } from './plugin-shared-keys.js'

/** Construction claims follow the transport identity without pulling optional plugins into core. */
const transportConstructionRollbacks = new WeakMap<object, () => void>()

/** Registers a transport wrapper's local claim rollback for failed endpoint construction. */
export function registerTransportConstructionRollback(
  transport: object,
  rollback: () => void
): void {
  transportConstructionRollbacks.set(transport, rollback)
}

/** Releases only construction claims; resource disposal remains with the kernel and Host. */
export function rollbackTransportConstruction(transport: object): void {
  transportConstructionRollbacks.get(transport)?.()
}

/** Canonical validated factory snapshot consumed by WebRPC attachments. */
export type IPreparedEndpoint<TTargetId extends string> = {
  readonly id: string
  readonly transport: IRpcTransport
  readonly providers: Readonly<Record<string, IRpcProvider>> | undefined
  readonly providerLimits?: IRpcProviderLimits
  readonly options: IRpcEndpointOptions<TTargetId>
}

/** Immutable middleware metadata captured before the composed Host batch mutates state. */
export type IEndpointLegacyMiddlewareSnapshot = {
  /** Exact canonical token admission captured before the descriptor is copied. */
  readonly jsonObjectCompatible: boolean
  readonly kind: 'legacy'
  readonly name: string
  readonly plugin: IRpcPlugin
  readonly transport?: IRpcTransport
}
/** Native middleware retains its PluginHost definition for same-order batch installation. */
export type IEndpointNativeMiddlewareSnapshot = {
  /** Native user middleware has no package-owned encoded-path admission. */
  readonly jsonObjectCompatible: boolean
  readonly kind: 'native'
  readonly name: string
  readonly plugin: IRpcPluginConstraint
  /** Object-form metadata is fixed at definition time and admitted before installation. */
  readonly metadata?: IRpcPlugin['metadata']
  /** Object-form components are fixed at definition time outside PluginHost's frozen token. */
  readonly components?: IRpcMiddlewareComponentPolicy
  readonly transport?: IRpcTransport
}
export type IEndpointMiddlewareSnapshot =
  | IEndpointLegacyMiddlewareSnapshot
  | IEndpointNativeMiddlewareSnapshot

/** Deferred bootstrap result used by the Host-owned composed path. */
export type IDeferredPreparedEndpoint<TTargetId extends string = string> = {
  readonly id: string
  readonly transport: IRpcTransport
  /** Complete descriptor snapshot consumed by the feature-neutral kernel. */
  readonly transportSnapshot: IEndpointKernelTransportSnapshot
  readonly providers: Readonly<Record<string, IRpcProvider>> | undefined
  readonly providerLimits: IRpcProviderLimits | undefined
  /** Construction controls snapshotted with the other outer configuration fields. */
  readonly construction: IRpcFactoryConfig['construction']
  /** Caller scheduler, snapshotted once and forwarded by identity to kernel and PluginHost. */
  readonly injectedScheduler: IScheduler | undefined
  /** Caller wall clock, snapshotted once and forwarded by identity to the kernel time port. */
  readonly injectedWallClock: IWallClock | undefined
  readonly middlewareSnapshots: readonly IEndpointMiddlewareSnapshot[]
  readonly finalize: (
    hookEvents: IRpcHookEvent[],
    runConstruction: <T>(operation: () => PromiseLike<T>) => Promise<T>,
    getPort: (key: PropertyKey) => unknown,
    timestamp: () => number,
    privateFeaturesAllowed?: boolean
  ) => Promise<IPreparedEndpoint<TTargetId>>
}

/** Builds endpoint options after Host middleware has published the shared capability port. */
async function finalizePreparedEndpoint<TTargetId extends string>(
  factoryId: string,
  factoryTargetIds: readonly TTargetId[] | undefined,
  factoryProvider: Readonly<Record<string, IRpcProvider>> | undefined,
  factoryProviderLimits: IRpcProviderLimits | undefined,
  factoryReplay: IRpcFactoryConfig['replay'],
  factoryIdempotency: IRpcIdempotencyConfig | undefined,
  transport: IRpcTransport,
  platform: IRpcPlatform,
  encodedType: string | undefined,
  _construction: IRpcFactoryConfig['construction'],
  components: IRpcSelectedComponents,
  installHookEvents: IRpcHookEvent[],
  runConstruction: <T>(operation: () => PromiseLike<T>) => Promise<T>,
  getPort: (key: PropertyKey) => unknown,
  timestamp: () => number,
  privatePathAllowed: boolean
): Promise<IPreparedEndpoint<TTargetId>> {
  const installedConnect = getPort(RpcPortName.connect) as IRpcConnectCapability | undefined
  if (!installedConnect)
    throw new RpcError(
      RpcCoreErrorCode.middlewareMissing,
      RpcCoreErrorText.connectMiddlewareIsRequired
    )
  let connectCapability = installedConnect
  const authenticationCapability = getPort(RpcPortName.authentication) as
    | IRpcAuthenticationCapability
    | undefined
  const contractCapability = getPort(RpcPortName.contract) as
    | { readonly maxIdentifierLength?: number }
    | undefined
  const timeoutCapability = getPort(RpcPortName.timeout) as IRpcTimeoutCapability | undefined
  const abortCapability = getPort(RpcPortName.abort) as IRpcAbortCapability | undefined
  const pingCapability = getPort(RpcPortName.ping) as IRpcPingCapability | undefined
  const uuidCapability = getPort(RpcPortName.uuid) as IRpcUuidConfig | undefined
  const hooksPort = getPort(RpcPortName.hooks) as IRpcHooksPort | undefined
  const hooksCapability: IRpcHooksConfig | undefined = hooksPort
    ? Object.freeze({
        listeners: hooksPort.listeners,
        ...(hooksPort.onHookError === undefined ? {} : { onHookError: hooksPort.onHookError })
      })
    : undefined
  for (const diagnostic of components.shadowed)
    hooksPort?.reportConstructionDiagnostic?.(
      Object.freeze({
        name: RpcCoreErrorText.componentShadowed,
        at: timestamp(),
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
    throw new RpcError(
      RpcCoreErrorCode.invalidConfig,
      RpcCoreErrorText.idAndTargetIdsMustFitTheConfiguredIdentifierLimit
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
      if (error instanceof RpcAbortError || error instanceof RpcTimeoutError) throw error
      throw new RpcError(
        RpcCoreErrorCode.invalidConfig,
        RpcCoreErrorText.connectUniqueTargetIdFactoryFailed,
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
    platform === RpcPlatform.broadcastChannel &&
    [factoryId, ...normalizedTargetIds].some(
      (targetId) => `${targetId}:${connectCapability.uniqueTargetId}`.length > maxIdentifierLength
    )
  ) {
    installHookEvents.push({
      name: 'connect.unique-target-id.ignored',
      at: timestamp(),
      localId: factoryId,
      code: 'UNIQUE_TARGET_ID_DERIVED_ID_TOO_LONG'
    })
    connectCapability = { ...connectCapability, uniqueTargetId: undefined }
  }
  if (!isDirectedCompatible(components, authenticationCapability, encodedType))
    throw new RpcError(
      RpcCoreErrorCode.invalidConfig,
      RpcCoreErrorText.outboundFrameAndTransportEncodedTypesAreIncompatible
    )
  /** Private selection follows all public validation, including installed authentication. */
  const candidate = jsonObjectCandidate(components)
  if (privatePathAllowed && authenticationCapability === undefined && candidate)
    selectJsonObjectPort(components, candidate)
  return {
    id: factoryId,
    transport,
    providers: factoryProvider,
    providerLimits: factoryProviderLimits,
    options: {
      contract: getPort(RpcPortName.contract) as IRpcContractCapability | undefined,
      uuid: uuidCapability,
      protocol: getPort(RpcPortName.protocol) as IRpcProtocolCapability | undefined,
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
      replay: factoryReplay,
      idempotency: factoryIdempotency
    }
  }
}

/** Validates and snapshots config before the single PluginHost construction batch. */
export function prepareEndpoint<
  TTargetId extends string = string,
  TMiddlewares extends readonly IRpcMiddleware[] = readonly IRpcMiddleware[],
  TFeatures extends readonly IRpcFeature[] = readonly IRpcFeature[]
>(
  config: IRpcFactoryConfig<TTargetId, TMiddlewares, TFeatures>,
  options: { readonly deferMiddlewareInstall: true }
): Promise<IDeferredPreparedEndpoint<TTargetId>>
export async function prepareEndpoint<
  TTargetId extends string = string,
  TMiddlewares extends readonly IRpcMiddleware[] = readonly IRpcMiddleware[],
  TFeatures extends readonly IRpcFeature[] = readonly IRpcFeature[]
>(
  config: IRpcFactoryConfig<TTargetId, TMiddlewares, TFeatures>,
  _options: { readonly deferMiddlewareInstall: true }
): Promise<IDeferredPreparedEndpoint<TTargetId>> {
  let factoryId: unknown
  let factoryMiddlewares: unknown
  let factoryTargetIds: unknown
  let factoryTransport: unknown
  let factoryProvider: unknown
  let factoryProviderLimits: unknown
  let construction: IRpcFactoryConfig['construction']
  /** Original injected scheduler value captured with all other outer configuration fields. */
  let factoryScheduler: unknown
  /** Original injected wall clock value captured with all other outer configuration fields. */
  let factoryWallClock: unknown
  let factoryReplay: IRpcFactoryConfig['replay']
  /** Idempotency is read before Host installation and then snapshotted once. */
  let factoryIdempotency: IRpcIdempotencyConfig | undefined
  let factoryProtocol: IRpcFactoryConfig['protocol']
  let factoryCodec: IRpcFactoryConfig['codec']
  let factoryFramer: IRpcFactoryConfig['framer']
  try {
    if (!config || typeof config !== 'object' || Array.isArray(config))
      throw new RpcError(
        RpcCoreErrorCode.invalidConfig,
        RpcCoreErrorText.factoryDescriptorIsInvalid
      )
    factoryId = config.id
    factoryMiddlewares = config.middlewares
    factoryTargetIds = config.targetIds
    factoryTransport = config.transport
    factoryProvider = config.provider
    factoryProviderLimits = config.providerLimits
    construction = config.construction
    factoryScheduler = config.scheduler
    factoryWallClock = config.wallClock
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
    if (error instanceof RpcError) throw error
    throw new RpcError(
      RpcCoreErrorCode.invalidConfig,
      RpcCoreErrorText.factoryDescriptorIsUnreadable,
      error
    )
  }
  try {
    const input = config.idempotency
    if (input !== undefined) {
      if (typeof input !== 'object' || input === null || Array.isArray(input))
        throw new RpcConfigurationError(RpcCoreErrorText.idempotencyConfigInvalid)
      const store = input.store
      const scope = input.scope
      if (
        (store !== undefined &&
          (typeof store !== 'object' || store === null || typeof store.claim !== 'function')) ||
        (scope !== undefined && typeof scope !== 'function')
      )
        throw new RpcConfigurationError(RpcCoreErrorText.idempotencyConfigInvalid)
      factoryIdempotency = Object.freeze({
        ...(store === undefined ? {} : { store }),
        ...(scope === undefined ? {} : { scope })
      })
    }
  } catch (cause) {
    if (cause instanceof RpcConfigurationError) throw cause
    throw new RpcConfigurationError(RpcCoreErrorText.idempotencyConfigInvalid, cause)
  }
  if (typeof factoryId !== 'string' || factoryId.length === 0)
    throw new RpcError(RpcCoreErrorCode.invalidConfig, RpcCoreErrorText.idMustBeANonEmptyString)
  let injectedScheduler: IScheduler | undefined
  if (factoryScheduler !== undefined) {
    try {
      const scheduler = factoryScheduler as IScheduler
      const now = scheduler?.now
      const schedule = scheduler?.schedule
      if (!scheduler || typeof now !== 'function' || typeof schedule !== 'function')
        throw new RpcConfigurationError(RpcCoreErrorText.schedulerInvalid)
      /** One monotonic reading; only its domain is checked, never an epoch interpretation. */
      const instant: unknown = scheduler.now()
      if (typeof instant !== 'number' || !Number.isFinite(instant) || instant < 0)
        throw new RpcConfigurationError(RpcCoreErrorText.schedulerInvalid)
      injectedScheduler = scheduler
    } catch (error) {
      if (error instanceof RpcConfigurationError) throw error
      throw new RpcConfigurationError(RpcCoreErrorText.schedulerInvalid, error)
    }
  }
  /** Admitted caller wall clock; undefined keeps the time port's host default. */
  let injectedWallClock: IWallClock | undefined
  if (factoryWallClock !== undefined) {
    try {
      const wallClock = factoryWallClock as IWallClock
      if (!wallClock || typeof wallClock.timestamp !== 'function')
        throw new RpcConfigurationError(RpcCoreErrorText.wallClockInvalid)
      /** One admission probe of the epoch diagnostic clock. */
      const probe: unknown = wallClock.timestamp()
      if (!Number.isSafeInteger(probe) || (probe as number) < 0)
        throw new RpcConfigurationError(RpcCoreErrorText.wallClockInvalid)
      injectedWallClock = wallClock
    } catch (error) {
      if (error instanceof RpcConfigurationError) throw error
      throw new RpcConfigurationError(RpcCoreErrorText.wallClockInvalid, error)
    }
  }
  try {
    if (!Array.isArray(factoryMiddlewares))
      throw new RpcError(RpcCoreErrorCode.invalidConfig, RpcCoreErrorText.middlewaresMustBeAnArray)
    if (factoryTargetIds !== undefined && !Array.isArray(factoryTargetIds))
      throw new RpcError(RpcCoreErrorCode.invalidConfig, RpcCoreErrorText.targetIdsMustBeAnArray)
    if (
      (factoryTargetIds as readonly unknown[] | undefined)?.some(
        (targetId) => typeof targetId !== 'string' || targetId.length === 0
      )
    )
      throw new RpcError(
        RpcCoreErrorCode.invalidConfig,
        RpcCoreErrorText.targetIdsMustContainNonEmptyStrings
      )
  } catch (error) {
    if (error instanceof RpcError) throw error
    throw new RpcError(
      RpcCoreErrorCode.invalidConfig,
      RpcCoreErrorText.factoryCollectionIsUnreadable,
      error
    )
  }
  let middlewareSnapshots: IEndpointMiddlewareSnapshot[]
  try {
    middlewareSnapshots = (factoryMiddlewares as readonly IRpcPlugin[]).map((middleware) => {
      const name = safeRead<unknown>(middleware, 'name')
      if (isDefinedMiddleware(middleware)) {
        if (typeof name !== 'string' || name.length === 0)
          throw new RpcError(
            RpcCoreErrorCode.invalidConfig,
            RpcCoreErrorText.middlewareMustBePlugin
          )
        const componentPolicy = readDefinedMiddlewareComponents(middleware)
        const middlewareTransport = componentPolicy?.transport
        const metadata = readDefinedMiddlewarePolicy(middleware)
        return Object.freeze({
          jsonObjectCompatible: false,
          kind: 'native' as const,
          name,
          plugin: middleware as unknown as IRpcPluginConstraint,
          ...(middlewareTransport === undefined
            ? {}
            : { transport: middlewareTransport as IRpcTransport }),
          ...(metadata === undefined ? {} : { metadata }),
          ...(componentPolicy === undefined ? {} : { components: componentPolicy })
        })
      }
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
            } as unknown as IRpcPlugin)
          : undefined
      if (
        typeof name !== 'string' ||
        name.length === 0 ||
        !plugin ||
        (middlewareTransport !== undefined &&
          (!middlewareTransport || typeof middlewareTransport !== 'object'))
      )
        throw new RpcError(RpcCoreErrorCode.invalidConfig, RpcCoreErrorText.middlewareMustBePlugin)
      /** Carry factory identity through the already validated immutable descriptor copy. */
      const proof = readCanonicalMiddlewareProof(middleware)
      if (proof === true) registerJsonObjectMiddleware(plugin)
      else if (typeof proof === 'object') registerJsonObjectDescriptorMiddleware(plugin, proof)
      return {
        jsonObjectCompatible: isJsonObjectMiddleware(middleware),
        kind: 'legacy' as const,
        name: name as string,
        plugin,
        transport: middlewareTransport as IRpcTransport | undefined
      }
    })
    const names = new Set<string>()
    for (const middleware of middlewareSnapshots) {
      if (names.has(middleware.name))
        throw new RpcError(
          RpcCoreErrorCode.middlewareDuplicated,
          RpcCoreErrorText.duplicateMiddleware(middleware.name)
        )
      names.add(middleware.name)
    }
  } catch (error) {
    if (error instanceof RpcError) throw error
    throw new RpcError(
      RpcCoreErrorCode.invalidConfig,
      RpcCoreErrorText.middlewaresAreUnreadable,
      error
    )
  }
  const transportCandidates = middlewareSnapshots.flatMap((item) =>
    item.transport === undefined ? [] : [item.transport]
  )
  if (transportCandidates.length > 1)
    throw new RpcError(RpcCoreErrorCode.capabilityConflict, RpcCoreErrorText.endpointRouteOwned)
  const transport = (factoryTransport as IRpcTransport | undefined) ?? transportCandidates[0]
  if (!transport)
    throw new RpcError(
      RpcCoreErrorCode.invalidConfig,
      RpcCoreErrorText.connectMiddlewareMustProvideTransport
    )
  /** Kernel owns the same one-read descriptor snapshot on both construction paths. */
  const transportSnapshot: IEndpointKernelTransportSnapshot = readTransportSnapshot(transport)
  const { send, subscribe, platform, encodedType, ownership } = transportSnapshot
  if (
    typeof send !== 'function' ||
    typeof subscribe !== 'function' ||
    !Object.values(RpcPlatform).includes(platform as IRpcPlatform) ||
    (encodedType !== undefined &&
      encodedType !== 'any' &&
      encodedType !== 'string' &&
      encodedType !== 'uint8array') ||
    (ownership !== undefined && ownership !== 'owned' && ownership !== 'borrowed')
  )
    throw new RpcError(RpcCoreErrorCode.invalidConfig, RpcCoreErrorText.transportDescriptorInvalid)
  const components = selectWebRpcComponents({
    transport,
    protocol: factoryProtocol,
    codec: factoryCodec,
    framer: factoryFramer,
    candidates: middlewareSnapshots.map((snapshot) =>
      snapshot.kind === 'legacy' ? snapshot.plugin : (snapshot.components ?? {})
    ),
    transportShadow:
      factoryTransport !== undefined && transportCandidates[0] !== undefined
        ? Object.freeze({ winner: transport, shadowed: transportCandidates[0] })
        : undefined
  })
  return {
    id: factoryId as string,
    transport,
    transportSnapshot,
    providers: factoryProvider as IRpcFactoryConfig<TTargetId>['provider'],
    providerLimits: factoryProviderLimits as IRpcFactoryConfig<TTargetId>['providerLimits'],
    construction,
    injectedScheduler,
    injectedWallClock,
    middlewareSnapshots: Object.freeze(middlewareSnapshots.map((item) => Object.freeze(item))),
    finalize: async (
      installHookEvents,
      runConstruction,
      getPort,
      timestamp,
      privateFeaturesAllowed = false
    ) => {
      const prepared = await finalizePreparedEndpoint(
        factoryId as string,
        factoryTargetIds as readonly TTargetId[] | undefined,
        factoryProvider as IRpcFactoryConfig<TTargetId>['provider'],
        factoryProviderLimits as IRpcFactoryConfig<TTargetId>['providerLimits'],
        factoryReplay,
        factoryIdempotency,
        transport,
        platform as IRpcPlatform,
        encodedType as string | undefined,
        construction,
        components,
        installHookEvents,
        runConstruction,
        getPort,
        timestamp,
        privateFeaturesAllowed &&
          middlewareSnapshots.every((snapshot) => snapshot.jsonObjectCompatible)
      )
      /** Qualification uses the completed snapshot and the once-read scheduler identity. */
      const options = { ...prepared.options, components }
      proveFastEndpoint(
        options,
        components,
        middlewareSnapshots,
        privateFeaturesAllowed,
        !isEndpointSystemScheduler(injectedScheduler)
      )
      return { ...prepared, options }
    }
  }
}

/** Resolves top-level then one plugin descriptor before Host installation creates subscriptions. */
function selectWebRpcComponents(
  input: Readonly<{
    readonly transport: IRpcTransport
    readonly protocol?: unknown
    readonly codec?: unknown
    readonly framer?: unknown
    readonly candidates?: readonly Pick<IRpcPlugin, 'protocol' | 'codec' | 'framer'>[]
    readonly transportShadow?: Readonly<{ readonly winner: object; readonly shadowed: object }>
  }>
): IRpcSelectedComponents {
  const candidates = input.candidates ?? []
  const shadowed: IRpcSelectedComponents['shadowed'][number][] = []
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
      throw new RpcError(RpcCoreErrorCode.capabilityConflict, RpcCoreErrorText.endpointRouteOwned)
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
  /** Pair before snapshots copy descriptors; registry lookup performs no user getter reads. */
  const privateCandidate = readJsonObjectPort(
    input.transport,
    selectedProtocol.value,
    selectedCodec.value,
    selectedFramer.value
  )
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
    throw new RpcError(RpcCoreErrorCode.invalidConfig, RpcCoreErrorText.codecDescriptorInvalid)
  /** Public snapshot remains the original string pipeline even when a private candidate exists. */
  const components = Object.freeze({
    protocol,
    codec,
    framer,
    ingressPrepare: bindRpcFrameIngress(framer.accept, framer.frame),
    shadowed: Object.freeze(shadowed)
  })
  proveFastComponents(components, selectedProtocol.value, selectedCodec.value, selectedFramer.value)
  if (privateCandidate) rememberJsonObjectCandidate(components, privateCandidate)
  return components
}

/** Captures descriptor identity once for a stable deferred diagnostic. */
function snapshotIdentity(
  value: unknown
): Readonly<{ readonly id: string; readonly version: number }> {
  const id = readDescriptorField(value, 'id')
  const version = readDescriptorField(value, 'version')
  if (!isDescriptorIdentity(id, version) || typeof version !== 'number')
    throw new RpcError(RpcCoreErrorCode.invalidConfig, RpcCoreErrorText.codecDescriptorInvalid)
  return Object.freeze({ id, version })
}

/** Reads one descriptor field once and turns hostile getter failure into one configuration error. */
function readDescriptorField(value: unknown, field: string): unknown {
  try {
    if (!value || typeof value !== 'object') return undefined
    return (value as Record<string, unknown>)[field]
  } catch (cause) {
    throw new RpcError(
      RpcCoreErrorCode.invalidConfig,
      RpcCoreErrorText.codecDescriptorInvalid,
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
    throw new RpcError(RpcCoreErrorCode.invalidConfig, RpcCoreErrorText.codecDescriptorInvalid)
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
    throw new RpcError(RpcCoreErrorCode.invalidConfig, RpcCoreErrorText.codecDescriptorInvalid)
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
    throw new RpcError(RpcCoreErrorCode.invalidConfig, RpcCoreErrorText.framerDescriptorInvalid)
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
  components: IRpcSelectedComponents,
  authentication: IRpcAuthenticationCapability | undefined,
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
