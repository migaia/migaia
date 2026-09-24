import {
  WebRpcConstructionError,
  WebRpcError,
  WebRpcErrorCode,
  type IWebRpcCleanupError
} from './errors.js'
import { WebRpcErrorText } from './error-text.js'
import {
  buildNativePluginBatch,
  type IWebRpcComposedRuntimeState
} from './internal/plugin-inventory.js'
import { createConstructionControl } from './internal/construction-install.js'
import {
  createEndpointCapabilitiesBatchFeature,
  createEndpointCapabilitiesPlugin
} from './internal/endpoint-capabilities-plugin.js'
import {
  assertFeatureClaimParity,
  preflightFeatureClaims,
  readFeaturePolicy
} from './internal/feature-policy.js'
import { createWebRpcPluginHost, type IWebRpcPluginHost } from './internal/web-rpc-plugin-host.js'
import {
  readFirstPartyPublicRoots,
  type IWebRpcPublicFirstPartyRootNames
} from './internal/first-party-roots.js'
import {
  type IDeferredPreparedEndpoint,
  type IPreparedEndpoint,
  prepareEndpoint
} from './internal/endpoint-bootstrap.js'
import {
  createEndpointKernel,
  EndpointKernelState,
  type IEndpointKernelHost
} from './endpoint-kernel.js'
import {
  getEndpointDebugSnapshotReader,
  readDiscoveryCleanupFaults,
  registerEndpointDebugSnapshot,
  registerEndpointTimePortOwner
} from './internal/test-observer.js'
import { createEndpointProjection } from './internal/endpoint-projection.js'
import type {
  IFactoryPingCapability,
  IWebRpcEndpoint,
  IWebRpcFactoryConfig,
  IWebRpcMiddleware,
  IWebRpcProvider,
  IWebRpcPingEndpointSurface,
  IWebRpcAbortSignal,
  IWebRpcHookEvent
} from './typing.js'
import { inspectFeatures } from '@migaia/plugin-host/composition'
import type { IPluginConstraint } from '@migaia/plugin-host'
import type { IWebRpcFeature, IWebRpcFeatureSurface } from './feature.js'
import { readWebRpcPortFeature } from './internal/port-feature.js'

/** Runtime-neutral configuration accepted by the composition kernel. */
export type IWebRpcCoreConfig = Omit<IWebRpcFactoryConfig, 'features'> & {
  /** Internal normalized view omits optional custom features from legacy fixtures. */
  readonly features?: undefined
}

/** Composes selected first-party modules while preserving existing endpoint ownership. */
async function createComposedEndpointRuntime<
  TTargetId extends string = string,
  TMiddlewares extends readonly IWebRpcMiddleware[] = readonly IWebRpcMiddleware[],
  TFeatures extends readonly IWebRpcFeature[] = readonly IWebRpcFeature[]
>(
  config: IWebRpcFactoryConfig<TTargetId, TMiddlewares, TFeatures> & {
    readonly features?: import('./feature.js').IWebRpcFiniteFeatureTuple<TFeatures>
  },
  modulesOrRoots: Readonly<Record<string, IWebRpcFeature>>
): Promise<
  IWebRpcKernelSurface &
    IWebRpcFeatureSurface<TFeatures> &
    IWebRpcPingEndpointSurface<IFactoryPingCapability<TMiddlewares>>
> {
  let featureRoots: readonly IWebRpcFeature[] = []
  /** Records only this composition's explicitly public first-party roots. */
  let publicFirstPartyRoots: readonly string[] = []
  let capabilityPlugin: ReturnType<typeof createEndpointCapabilitiesPlugin> | undefined
  try {
    featureRoots = snapshotFeatureTuple(config.features)
    inspectFeatures(
      featureRoots.reduce<Record<string, IWebRpcFeature>>((roots, feature, index) => {
        roots[`feature-${index}`] = feature
        return roots
      }, Object.create(null))
    )
    assertNativeRootRecord(modulesOrRoots)
    const reservedKeys = new Set([
      'on',
      'hooks',
      'dispose',
      'use',
      'unUse',
      'config',
      'getPort',
      'usePipeline',
      '__proto__'
    ])
    const declaredFeatureKeys = featureRoots.flatMap(
      (feature) => readFeaturePolicy(feature).publicKeys ?? []
    )
    if (declaredFeatureKeys.some((key) => reservedKeys.has(key)))
      throw new WebRpcError(
        WebRpcErrorCode.capabilityConflict,
        WebRpcErrorText.endpointModuleDuplicated
      )
    if (new Set(declaredFeatureKeys).size !== declaredFeatureKeys.length)
      throw new WebRpcError(WebRpcErrorCode.invalidConfig, WebRpcErrorText.endpointModuleDuplicated)
  } catch (error) {
    if (error instanceof WebRpcError) throw error
    throw new WebRpcError(
      WebRpcErrorCode.invalidConfig,
      WebRpcErrorText.endpointModuleInvalid,
      error
    )
  }
  const deferred = (await prepareEndpoint(config, {
    deferMiddlewareInstall: true
  })) as IDeferredPreparedEndpoint<TTargetId>
  /**
   * Object-form native middleware carries immutable claims. Reject conflicts before the endpoint
   * creates its kernel or Host; function-form middleware intentionally has dynamic output keys.
   */
  const staticMiddlewareClaims = deferred.middlewareSnapshots.flatMap((snapshot) =>
    snapshot.kind === 'native' && snapshot.metadata !== undefined ? [snapshot] : []
  )
  preflightFeatureClaims(
    staticMiddlewareClaims.map((snapshot) => ({
      name: snapshot.name,
      claims: snapshot.metadata!.claims,
      sharedProvides: snapshot.metadata!.sharedProvides,
      sharedConsumes: snapshot.metadata!.sharedConsumes,
      sharedOptionalConsumes: snapshot.metadata!.sharedOptionalConsumes
    })),
    { requireCompleteGraph: false }
  )
  let kernel: IEndpointKernelHost | undefined
  let host: IWebRpcPluginHost | undefined
  let hostExtensions: Readonly<Record<string, unknown>> | undefined
  let resolvedPorts: ReadonlyMap<PropertyKey, unknown> | undefined
  let construction: ReturnType<typeof createConstructionControl> | undefined
  let prepared: IPreparedEndpoint<TTargetId> | undefined
  let rootCleanupErrors: IWebRpcCleanupError[] = []
  let publicKeys: readonly string[] = []
  try {
    kernel = createEndpointKernel(deferred.transport, deferred.transportSnapshot)
    const constructionConfig = deferred.construction
    const constructionSignal =
      constructionConfig?.signal ?? (new AbortController().signal as IWebRpcAbortSignal)
    construction = createConstructionControl({
      signal: constructionSignal,
      timeoutMs: constructionConfig?.timeoutMs
    })
    const hookEvents: IWebRpcHookEvent[] = []
    host = createWebRpcPluginHost(
      deferred.id,
      deferred.transport,
      construction,
      (event: IWebRpcHookEvent) => hookEvents.push(event),
      {
        execution: {
          mutationTimeoutMs: constructionConfig?.timeoutMs ?? false,
          pipelineDrainTimeoutMs: constructionConfig?.timeoutMs ?? false
        }
      },
      () => rootCleanupErrors
    )
    let activationCommitted = false
    let activationPreflight:
      | ((
          state: IWebRpcComposedRuntimeState,
          host: { readonly getPort: (key: PropertyKey) => unknown }
        ) => void)
      | undefined
    const activationKernel = kernel
    /** Only direct callers supply first-party Features; retired tokens cannot mint native owners. */
    const firstPartyRoots = modulesOrRoots as Readonly<Record<string, IWebRpcFeature>>
    publicFirstPartyRoots = readFirstPartyPublicRoots(firstPartyRoots)
    const capabilityRoots: Record<string, IWebRpcFeature> = Object.assign(
      Object.create(null),
      firstPartyRoots,
      featureRoots.reduce<Record<string, IWebRpcFeature>>((roots, feature, index) => {
        roots[`feature-${index}`] = feature
        return roots
      }, Object.create(null))
    )
    const capabilityBatch =
      Object.keys(capabilityRoots).length === 0
        ? undefined
        : createEndpointCapabilitiesBatchFeature(
            capabilityRoots,
            Object.freeze({
              getKernel: () => activationKernel,
              getPrepared: () => {
                if (!prepared)
                  throw new WebRpcError(
                    WebRpcErrorCode.invalidConfig,
                    WebRpcErrorText.endpointModuleInvalid
                  )
                return prepared as IPreparedEndpoint<string>
              }
            }),
            Object.keys(capabilityRoots).filter((name) => name.startsWith('first-party-')),
            'first-party-outbound' in firstPartyRoots ? ['first-party-outbound'] : [],
            Object.keys(capabilityRoots).filter((name) =>
              [
                'first-party-outbound',
                'first-party-discovery',
                'first-party-control',
                'first-party-provider'
              ].includes(name)
            ),
            new Set([
              ...publicFirstPartyRoots,
              ...featureRoots.map((_feature, index) => `feature-${index}`)
            ])
          )
    capabilityPlugin = capabilityBatch?.plugin
    const firstPartyPolicies = capabilityBatch?.firstPartyPolicies ?? []
    const capabilityAdmission = capabilityBatch?.admission
    /** Direct native batch includes the capability Feature before its single activation role. */
    const batch = buildNativePluginBatch({
      kernel,
      deferred: deferred as unknown as IDeferredPreparedEndpoint<string>,
      middlewareSnapshots: deferred.middlewareSnapshots,
      hookEvents,
      ...(capabilityPlugin && capabilityAdmission
        ? {
            featureDefinitions: [
              {
                key: capabilityPlugin.definition.name,
                definition: capabilityPlugin.definition,
                admission: capabilityAdmission
              }
            ]
          }
        : {}),
      onPrepared: (value) => {
        prepared = value as IPreparedEndpoint<TTargetId>
      },
      onActivationCommitted: () => {
        activationCommitted = true
      },
      onActivationRolledBack: () => {
        activationCommitted = false
      },
      onNativeFeatureActivate: () => capabilityPlugin?.activate(),
      onRootDisposalErrors: (errors) => {
        rootCleanupErrors = [...rootCleanupErrors, ...errors]
      },
      onActivationPreflight: (state, getPort) => activationPreflight?.(state, { getPort })
    })
    const admissions = batch.map((entry) => entry.admission)
    const claims = admissions.map((admission) => admission.claims)
    publicKeys = [...new Set(claims.flatMap((claim) => claim.publicKeys))]
    const pluginDefinitions: IPluginConstraint<any>[] = batch.map((entry) => entry.definition)
    preflightFeatureClaims(admissions)
    const activationHost = host
    if (!activationHost || !activationKernel)
      throw new WebRpcError(WebRpcErrorCode.invalidConfig, WebRpcErrorText.endpointModuleInvalid)
    activationPreflight = (state, candidateHost) => {
      const capabilityKeys = capabilityPlugin?.getPublicKeys() ?? []
      const dynamicKeys = [...capabilityKeys, ...activationHost.readNativeMiddlewareKeys()]
      const staticNativeKeys = new Set([
        ...staticMiddlewareClaims.flatMap((snapshot) => snapshot.metadata!.claims.publicKeys),
        ...firstPartyPolicies.flatMap((policy) => policy.firstPartyClaims?.publicKeys ?? [])
      ])
      const reservedKeys = new Set([
        'on',
        'hooks',
        'dispose',
        'use',
        'unUse',
        'config',
        'getPort',
        'usePipeline',
        '__proto__'
      ])
      if (
        dynamicKeys.some(
          (key) => reservedKeys.has(key) || (publicKeys.includes(key) && !staticNativeKeys.has(key))
        ) ||
        new Set(dynamicKeys).size !== dynamicKeys.length
      )
        throw new WebRpcError(
          WebRpcErrorCode.capabilityConflict,
          WebRpcErrorText.endpointModuleDuplicated
        )
      publicKeys = [...publicKeys, ...dynamicKeys.filter((key) => !publicKeys.includes(key))]
      assertFeatureClaimParity(admissions, candidateHost, activationKernel, {
        activated: state.activated,
        activationPhase: 'pre-activation',
        routeKeys: state.routeKeys
      })
    }
    const handles = await host.installBatch(pluginDefinitions)
    hostExtensions = mergeMiddlewareExtensions(handles)
    resolvedPorts = resolveMiddlewarePorts(handles, admissions)
    /** Dynamic native Feature output is admitted by Host; append only keys it actually published. */
    const publishedKeys = Reflect.ownKeys(hostExtensions).filter(
      (key): key is string => typeof key === 'string'
    )
    publicKeys = [...publicKeys, ...publishedKeys.filter((key) => !publicKeys.includes(key))]
    assertFeatureClaimParity(
      admissions,
      {
        extensions: hostExtensions,
        getPort: (key: PropertyKey) => resolvedPorts?.get(key)
      },
      kernel,
      { activated: activationCommitted }
    )
  } catch (primary) {
    if (host) {
      try {
        await host.dispose()
      } catch (error) {
        throw new WebRpcConstructionError(WebRpcErrorText.endpointModuleInvalid, primary, [
          { resource: 'plugin-host', error }
        ])
      }
      const hostFailure = primary as {
        readonly code?: unknown
        readonly cause?: unknown
        readonly detail?: { readonly rollbackErrors?: readonly unknown[] }
      }
      if (hostFailure.code === 'PLUGIN_INSTALL_FAILED') {
        const cause = hostFailure.cause ?? primary
        const rollbackErrors = (hostFailure.detail?.rollbackErrors ?? []).flatMap((error) =>
          error instanceof AggregateError ? [...error.errors] : [error]
        )
        if (rollbackErrors.length > 0)
          throw new WebRpcConstructionError(
            WebRpcErrorText.endpointModuleInvalid,
            cause,
            rollbackErrors.map((error, index) => ({
              resource: `endpoint-module-${index}`,
              error
            }))
          )
        throw cause
      }
    } else if (kernel) {
      construction?.close()
      if (kernel.state !== EndpointKernelState.disposed)
        try {
          kernel.beginClose()
          await kernel.resources.releaseAll()
          kernel.completeDispose()
        } catch (error) {
          throw new WebRpcConstructionError(WebRpcErrorText.endpointModuleInvalid, primary, [
            { resource: 'endpoint-kernel', error }
          ])
        }
    } else {
      const cleanupErrors: { resource: string; error: unknown }[] = []
      if (deferred.transport.ownership !== 'borrowed')
        try {
          await deferred.transport.close?.()
        } catch (error) {
          cleanupErrors.push({ resource: 'transport', error })
        }
      if (cleanupErrors.length > 0)
        throw new WebRpcConstructionError(
          WebRpcErrorText.endpointModuleInvalid,
          primary,
          cleanupErrors
        )
    }
    throw primary
  }
  /** Project only selected root tokens; dependencies install privately and never widen the root. */
  const exposedKeys = [...new Set<string>(publicKeys)]
  const snapshotReader =
    capabilityPlugin?.getSnapshotReader() ??
    [hostExtensions]
      .map((value) => getEndpointDebugSnapshotReader(value as object))
      .find((reader): reader is NonNullable<typeof reader> => reader !== undefined)
  const hookOwner = hostExtensions as { hooks?: IWebRpcEndpoint['hooks'] } | undefined
  const nativeOn = capabilityPlugin?.getOn()
  const nativeHooks = capabilityPlugin?.getHooks()
  let publicSurface: object
  let endpointHostDispose: Promise<void> | undefined
  try {
    publicSurface = createEndpointProjection({
      // 投影的来源是 view 的 extensions;没有 view 就没有任何可投影的成员。此处曾回退到宿主本身,
      // 那只在宿主是类实例（方法都在原型上、自有键为空）时碰巧等价——宿主改为句柄后就不再成立。
      host: hostExtensions ?? {},
      publicKeys,
      exposedKeys,
      // 扇出成员在守卫前就是以 rejection 形态失败的；`ping`/`provide` 则是同步抛出。
      rejectionKeys: ['sendAll', 'pingAll', 'send'],
      ...(publicFirstPartyRoots.includes('first-party-provider') && nativeOn
        ? {
            on: (...args: readonly unknown[]) =>
              nativeOn(args[0] as string, args[1] as Parameters<IWebRpcEndpoint['on']>[1])
          }
        : {}),
      ...(publicFirstPartyRoots.includes('first-party-outbound') &&
      (nativeHooks ?? hookOwner?.hooks)
        ? { hooks: nativeHooks ?? hookOwner?.hooks }
        : {}),
      hostDispose: () => (endpointHostDispose ??= host!.dispose().then(() => undefined)),
      beforeDispose: (endpoint) => {
        const cleanupFaults = readDiscoveryCleanupFaults(endpoint)
        if (!cleanupFaults) return
        capabilityPlugin?.propagateDiscoveryCleanupFaults(cleanupFaults)
      }
    })
  } catch (primary) {
    try {
      await host!.dispose()
    } catch (error) {
      throw new WebRpcConstructionError(WebRpcErrorText.endpointModuleInvalid, primary, [
        { resource: 'plugin-host', error }
      ])
    }
    throw primary
  }
  registerEndpointTimePortOwner(publicSurface, kernel.time)
  if (snapshotReader) registerEndpointDebugSnapshot(publicSurface, snapshotReader)
  return publicSurface as IWebRpcKernelSurface &
    IWebRpcFeatureSurface<TFeatures> &
    IWebRpcPingEndpointSurface<IFactoryPingCapability<TMiddlewares>>
}

import type {
  IChecked,
  ICheckedInput,
  IFeatures,
  ILegacyDefault,
  IMiddlewares
} from './pipeline-contract.js'

/** Public composition accepts only native Feature roots and native Middleware declared in config. */
type IPublicCallable = {
  <
    const TConfig extends ICheckedInput,
    const TRoots extends Readonly<Record<string, IWebRpcFeature>>
  >(
    config: TConfig & IChecked<TConfig>,
    firstPartyRoots: TRoots
  ): Promise<
    IRecursiveProvideSurface<
      IWebRpcKernelSurface &
        IWebRpcFeatureSurface<IFeatures<TConfig>> &
        IWebRpcRootProjection<TRoots> &
        IWebRpcPingEndpointSurface<IFactoryPingCapability<IMiddlewares<TConfig>>>
    >
  >
  <
    TTargetId extends string = string,
    TMiddlewares extends readonly IWebRpcMiddleware[] = readonly IWebRpcMiddleware[],
    TFeatures extends readonly IWebRpcFeature[] = readonly IWebRpcFeature[],
    TRoots extends Readonly<Record<string, IWebRpcFeature>> = Readonly<
      Record<string, IWebRpcFeature>
    >
  >(
    config: ILegacyDefault<TTargetId, TMiddlewares, TFeatures>,
    firstPartyRoots: TRoots
  ): Promise<
    IRecursiveProvideSurface<
      IWebRpcKernelSurface &
        IWebRpcFeatureSurface<TFeatures> &
        IWebRpcRootProjection<TRoots> &
        IWebRpcPingEndpointSurface<IFactoryPingCapability<TMiddlewares>>
    >
  >
}

/** Checked public boundary reuses the original composition runtime and prepare path. */
export const createComposedEndpoint = createComposedEndpointRuntime as unknown as IPublicCallable

/** Resolves every declared middleware port from the matching PluginHost handle Feature. */
function resolveMiddlewarePorts(
  handles: readonly Readonly<{
    readonly extensions: object
    getFeature(name: never): unknown
  }>[],
  admissions: readonly Readonly<{ readonly sharedProvides?: readonly PropertyKey[] }>[]
): ReadonlyMap<PropertyKey, unknown> {
  const ports = new Map<PropertyKey, unknown>()
  handles.forEach((handle, index) => {
    for (const name of admissions[index]?.sharedProvides ?? []) {
      if (typeof name !== 'string' || ports.has(name))
        throw new WebRpcError(
          WebRpcErrorCode.capabilityConflict,
          WebRpcErrorText.endpointModuleDuplicated
        )
      ports.set(name, readWebRpcPortFeature(handle.getFeature(name as never)))
    }
  })
  return ports
}

/** Merges per-registration extensions while retaining the existing duplicate-key failure. */
function mergeMiddlewareExtensions(
  handles: readonly Readonly<{ readonly extensions: Readonly<Record<string, unknown>> }>[]
): Readonly<Record<string, unknown>> {
  const merged: Record<string, unknown> = Object.create(null)
  for (const handle of handles)
    for (const key of Reflect.ownKeys(handle.extensions)) {
      if (typeof key !== 'string' || Object.hasOwn(merged, key))
        throw new WebRpcError(
          WebRpcErrorCode.capabilityConflict,
          WebRpcErrorText.endpointModuleDuplicated
        )
      Object.defineProperty(merged, key, {
        configurable: false,
        enumerable: true,
        value: handle.extensions[key],
        writable: false
      })
    }
  return Object.freeze(merged)
}

/** Snapshots the optional feature tuple before endpoint preparation can cause side effects. */
function snapshotFeatureTuple(
  features: readonly IWebRpcFeature[] | undefined
): readonly IWebRpcFeature[] {
  if (features === undefined) return []
  if (!Array.isArray(features))
    throw new WebRpcError(WebRpcErrorCode.invalidConfig, WebRpcErrorText.endpointModuleInvalid)
  try {
    return Object.freeze([...features])
  } catch (error) {
    throw new WebRpcError(
      WebRpcErrorCode.invalidConfig,
      WebRpcErrorText.endpointModuleInvalid,
      error
    )
  }
}

/** Rejects retired iterable module inputs before endpoint preparation or Host construction. */
function assertNativeRootRecord(
  value: unknown
): asserts value is Readonly<Record<string, IWebRpcFeature>> {
  if (
    Array.isArray(value) ||
    (typeof value === 'object' && value !== null && Symbol.iterator in value)
  )
    throw new WebRpcError(WebRpcErrorCode.invalidConfig, WebRpcErrorText.endpointModuleInvalid)
}

/** Mirrors the runtime branch: only private first-party roots prepare then project `public`. */
type IWebRpcFeatureRootSurface<TName extends string, TFeature> =
  TFeature extends IWebRpcFeature<infer TOutput>
    ? TName extends `first-party-${string}`
      ? TOutput extends { readonly prepare: (...args: readonly never[]) => infer TPrepared }
        ? TPrepared extends { readonly public: infer TPublic extends object }
          ? TPublic
          : Record<never, never>
        : Record<never, never>
      : TOutput
    : Record<never, never>

/** Intersects only explicitly selected roots; private closure dependencies never widen this type. */
export type IWebRpcRootProjection<TRoots extends Readonly<Record<string, IWebRpcFeature>>> =
  IUnionToIntersection<
    {
      [TName in IWebRpcPublicFirstPartyRootNames<TRoots>]: IWebRpcFeatureRootSurface<
        TName,
        TRoots[TName]
      >
    }[IWebRpcPublicFirstPartyRootNames<TRoots>]
  >

/** Reprojects the completed endpoint so detached `provide()` remains fluent over every surface. */
export type IRecursiveProvideSurface<TSurface extends object> = Omit<TSurface, 'provide'> &
  ('provide' extends keyof TSurface
    ? {
        provide(method: string, provider: IWebRpcProvider): IRecursiveProvideSurface<TSurface>
      }
    : {})

type IUnionToIntersection<T> = (T extends unknown ? (value: T) => void : never) extends (
  value: infer I
) => void
  ? I
  : never

export type IWebRpcKernelSurface = Pick<IWebRpcEndpoint, 'dispose'>
