import type {
  IFactoryPingCapability,
  INativeMiddlewareSurface,
  IRecursiveProvideSurface,
  IRpcRootProjection,
  IRpcKernelSurface
} from './internal/factory-types.js'
import type { IAbortSignal } from '@migaia/utils/promise'
import {
  createRpcConstructionError,
  createRpcError,
  identifyRpcBoundaryFailure,
  type IRpcCleanupError,
  isLocalRpcError,
  RpcCoreErrorCode,
  RpcError
} from './errors.js'
import { isJsonObjectFeature } from './internal/json-object-port.js'

import { RpcCoreErrorText } from './error-text.js'
import {
  buildNativePluginBatch,
  type IRpcComposedRuntimeState
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
import { createWebRpcPluginHost, type IRpcPluginHost } from './internal/web-rpc-plugin-host.js'
import {
  type IDeferredPreparedEndpoint,
  type IPreparedEndpoint,
  prepareEndpoint,
  rollbackTransportConstruction
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
import {
  createEndpointProjection,
  RPC_RESERVED_PROJECTION_KEYS
} from './internal/endpoint-projection.js'
import type {
  IRpcEndpoint,
  IRpcFactoryConfig,
  IRpcMiddleware,
  IRpcPingEndpointSurface,
  IRpcHookEvent
} from './typing.js'
import { inspectFeatures } from '@migaia/plugin-host/composition'
import type { IPluginConstraint } from '@migaia/plugin-host'
import type { IRpcFeature, IRpcFeatureSurface } from './feature.js'
import { readWebRpcPortFeature } from './internal/port-feature.js'

/**
 * Runtime-neutral configuration accepted by the composition kernel; user Feature tuples belong to
 * IRpcFactoryConfig instead.
 */
export type IRpcCoreConfig = Omit<IRpcFactoryConfig, 'features'> & {
  /** This normalized core view omits user Feature selection. */
  readonly features?: undefined
}

/** Composes selected first-party modules while preserving existing endpoint ownership. */
async function createComposedEndpointRuntime<
  TTargetId extends string = string,
  TMiddlewares extends readonly IRpcMiddleware[] = readonly IRpcMiddleware[],
  TFeatures extends readonly IRpcFeature[] = readonly IRpcFeature[]
>(
  config: IRpcFactoryConfig<TTargetId, TMiddlewares, TFeatures> & {
    readonly features?: import('./feature.js').IRpcFiniteFeatureTuple<TFeatures>
  },
  modulesOrRoots: Readonly<Record<string, IRpcFeature>>
): Promise<
  IRpcKernelSurface &
    IRpcFeatureSurface<TFeatures> &
    IRpcPingEndpointSurface<IFactoryPingCapability<TMiddlewares>>
> {
  return new ComposedEndpointResource<TTargetId, TMiddlewares, TFeatures>(
    config,
    modulesOrRoots
  ).open()
}

/** Compose one actual endpoint; the resource owns construction, activation and rollback state. */
class ComposedEndpointResource<
  TTargetId extends string = string,
  TMiddlewares extends readonly IRpcMiddleware[] = readonly IRpcMiddleware[],
  TFeatures extends readonly IRpcFeature[] = readonly IRpcFeature[]
> {
  /** Original configuration is captured without evaluating application getters early. */
  readonly #config: IRpcFactoryConfig<TTargetId, TMiddlewares, TFeatures> & {
    readonly features?: import('./feature.js').IRpcFiniteFeatureTuple<TFeatures>
  }
  /** Actual supplied roots remain distinct from the configured user Feature tuple. */
  readonly #modulesOrRoots: Readonly<Record<string, IRpcFeature>>
  /** The cold immutable tuple is read once before acquiring physical resources. */
  #featureRoots: readonly IRpcFeature[] = []
  /** Public root names grant projection rights without widening dependency-only Features. */
  #publicFirstPartyRoots: readonly string[] = []
  /** The real capability installation supplies public keys and diagnostic ownership. */
  #capabilityPlugin: ReturnType<typeof createEndpointCapabilitiesPlugin> | undefined
  /** Deferred physical preparation is created before the kernel or native Host. */
  #deferred!: IDeferredPreparedEndpoint<TTargetId>
  /** Immutable native middleware claims are checked before resource acquisition. */
  #staticMiddlewareClaims: Extract<
    IDeferredPreparedEndpoint<string>['middlewareSnapshots'][number],
    { kind: 'native' }
  >[] = []
  /** Only the acquired canonical kernel can own transport and endpoint resources. */
  #kernel: IEndpointKernelHost | undefined
  /** The genuine native Host owns atomic installation and reverse rollback. */
  #host: IRpcPluginHost | undefined
  /** Merged native outputs are projected only after their actual batch commits. */
  #hostExtensions: Readonly<Record<string, unknown>> | undefined
  /** Named middleware ports retain their actual held Feature values. */
  #resolvedPorts: ReadonlyMap<PropertyKey, unknown> | undefined
  /** Construction cancellation and timeout remain with the existing control owner. */
  #construction: ReturnType<typeof createConstructionControl> | undefined
  /** The batch activation receipt supplies the actual prepared endpoint identity. */
  #prepared: IPreparedEndpoint<TTargetId> | undefined
  /** Exact root failures stay ordered and reachable through native rollback diagnostics. */
  #rootCleanupErrors: IRpcCleanupError[] = []
  /** Public keys preserve the original admitted publication order. */
  #publicKeys: string[] = []
  /** Membership is indexed once instead of rescanning earlier publications. */
  #publicKeySet = new Set<string>()
  /** Native hook events remain available until the real activation role installs them. */
  #hookEvents: IRpcHookEvent[] = []
  /** Preflight and final parity distinguish a committed activation from a rolled-back candidate. */
  #activationCommitted = false
  /** First-party claims retain the actual capabilities batch's immutable policy objects. */
  #firstPartyPolicies: ReturnType<
    typeof createEndpointCapabilitiesBatchFeature
  >['firstPartyPolicies'] = []
  /** One native batch owns claim parity before activation and after publication. */
  #admissions: ReturnType<typeof buildNativePluginBatch>[number]['admission'][] = []
  /** Public disposal joins its first actual Host cleanup Promise, including failure. */
  #endpointHostDispose: Promise<void> | undefined

  /** Retain only the original inputs; admission and resource acquisition remain ordered in open. */
  constructor(
    config: IRpcFactoryConfig<TTargetId, TMiddlewares, TFeatures> & {
      readonly features?: import('./feature.js').IRpcFiniteFeatureTuple<TFeatures>
    },
    modulesOrRoots: Readonly<Record<string, IRpcFeature>>
  ) {
    this.#config = config
    this.#modulesOrRoots = modulesOrRoots
  }

  /** Run cold validation, physical preparation, native installation and final projection in order. */
  async open(): Promise<
    IRpcKernelSurface &
      IRpcFeatureSurface<TFeatures> &
      IRpcPingEndpointSurface<IFactoryPingCapability<TMiddlewares>>
  > {
    this.#validateFeatures()
    await this.#preparePhysical()
    try {
      this.#initializeHost()
      const batch = this.#buildNativeBatch()
      const pluginDefinitions = this.#prepareDefinitions(batch)
      await this.#installBatch(pluginDefinitions)
    } catch (primary) {
      await this.#rollbackConstruction(primary)
    }
    return this.#project()
  }

  /** Cold tuple/root admission cannot consume a transport or evaluate application outputs. */
  #validateFeatures(): void {
    try {
      this.#featureRoots = snapshotFeatureTuple(this.#config.features)
      inspectFeatures(
        this.#featureRoots.reduce<Record<string, IRpcFeature>>((roots, feature, index) => {
          roots[`feature-${index}`] = feature
          return roots
        }, Object.create(null))
      )
      assertNativeRootRecord(this.#modulesOrRoots)

      const declaredFeatureKeys = this.#featureRoots.flatMap(
        (feature) => readFeaturePolicy(feature).publicKeys ?? []
      )
      if (declaredFeatureKeys.some((key) => RPC_RESERVED_PROJECTION_KEYS.has(key)))
        throw createRpcError(
          RpcCoreErrorCode.capabilityConflict,
          RpcCoreErrorText.endpointModuleDuplicated
        )
      if (new Set(declaredFeatureKeys).size !== declaredFeatureKeys.length)
        throw createRpcError(
          RpcCoreErrorCode.invalidConfig,
          RpcCoreErrorText.endpointModuleDuplicated
        )
    } catch (error) {
      if (this.#config.transport) rollbackTransportConstruction(this.#config.transport)
      if (isLocalRpcError(error, RpcError)) throw error
      throw createRpcError(
        RpcCoreErrorCode.invalidConfig,
        RpcCoreErrorText.endpointModuleInvalid,
        error
      )
    }
  }

  /** Physical preparation and static middleware claim validation preserve their rollback boundary. */
  async #preparePhysical(): Promise<void> {
    try {
      this.#deferred = (await prepareEndpoint(this.#config, {
        deferMiddlewareInstall: true
      })) as IDeferredPreparedEndpoint<TTargetId>
    } catch (error) {
      if (this.#config.transport) rollbackTransportConstruction(this.#config.transport)
      throw error
    }
    this.#staticMiddlewareClaims = this.#deferred.middlewareSnapshots.flatMap((snapshot) =>
      snapshot.kind === 'native' && snapshot.metadata !== undefined ? [snapshot] : []
    )
    try {
      preflightFeatureClaims(
        this.#staticMiddlewareClaims.map((snapshot) => ({
          name: snapshot.name,
          claims: snapshot.metadata!.claims,
          sharedProvides: snapshot.metadata!.sharedProvides,
          sharedConsumes: snapshot.metadata!.sharedConsumes,
          sharedOptionalConsumes: snapshot.metadata!.sharedOptionalConsumes
        })),
        { requireCompleteGraph: false }
      )
    } catch (error) {
      rollbackTransportConstruction(this.#deferred.transport)
      throw error
    }
  }

  /** Acquire the one canonical kernel, construction scope and native installation Host. */
  #initializeHost(): void {
    this.#kernel = createEndpointKernel(
      this.#deferred.transport,
      this.#deferred.transportSnapshot,
      this.#deferred.injectedScheduler,
      this.#deferred.injectedWallClock
    )
    const constructionConfig = this.#deferred.construction
    const constructionSignal =
      constructionConfig?.signal ?? (new AbortController().signal as IAbortSignal)
    this.#construction = createConstructionControl({
      signal: constructionSignal,
      timeoutMs: constructionConfig?.timeoutMs,
      time: this.#kernel!.time
    })
    this.#hookEvents = []
    this.#host = createWebRpcPluginHost(
      this.#deferred.id,
      this.#deferred.transport,
      this.#construction,
      (event: IRpcHookEvent) => this.#hookEvents.push(event),
      {
        scheduler: this.#deferred.injectedScheduler,
        execution: {
          mutationTimeoutMs: constructionConfig?.timeoutMs ?? false,
          pipelineDrainTimeoutMs: constructionConfig?.timeoutMs ?? false
        }
      },
      () => this.#rootCleanupErrors
    )
  }

  /** Build actual native capability roots before their single activation role can run. */
  #buildNativeBatch(): ReturnType<typeof buildNativePluginBatch> {
    const firstPartyRoots = this.#modulesOrRoots as Readonly<Record<string, IRpcFeature>>
    this.#publicFirstPartyRoots = Object.keys(firstPartyRoots)
    const capabilityRoots: Record<string, IRpcFeature> = Object.assign(
      Object.create(null),
      firstPartyRoots,
      this.#featureRoots.reduce<Record<string, IRpcFeature>>((roots, feature, index) => {
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
              getKernel: () => this.#kernel!,
              getPrepared: () => {
                if (!this.#prepared)
                  throw createRpcError(
                    RpcCoreErrorCode.invalidConfig,
                    RpcCoreErrorText.endpointModuleInvalid
                  )
                return this.#prepared as IPreparedEndpoint<string>
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
              ...this.#publicFirstPartyRoots,
              ...this.#featureRoots.map((_feature, index) => `feature-${index}`)
            ])
          )
    this.#capabilityPlugin = capabilityBatch?.plugin
    this.#firstPartyPolicies = capabilityBatch?.firstPartyPolicies ?? []
    const capabilityAdmission = capabilityBatch?.admission
    const batch = buildNativePluginBatch({
      kernel: this.#kernel!,
      deferred: this.#deferred as unknown as IDeferredPreparedEndpoint<string>,
      middlewareSnapshots: this.#deferred.middlewareSnapshots,
      privateFeaturesAllowed: Object.values(capabilityRoots).every(isJsonObjectFeature),
      hookEvents: this.#hookEvents,
      ...(this.#capabilityPlugin && capabilityAdmission
        ? {
            featureDefinitions: [
              {
                key: this.#capabilityPlugin.definition.name,
                definition: this.#capabilityPlugin.definition,
                admission: capabilityAdmission
              }
            ]
          }
        : {}),
      onPrepared: (value) => {
        this.#prepared = value as IPreparedEndpoint<TTargetId>
      },
      onActivationCommitted: () => {
        this.#activationCommitted = true
      },
      onActivationRolledBack: () => {
        this.#activationCommitted = false
      },
      onNativeFeatureActivate: () => this.#capabilityPlugin?.activate(),
      onRootDisposalErrors: (errors) => {
        this.#rootCleanupErrors.push(...errors)
      },
      onActivationPreflight: (state, getPort) => this.#validateActivation(state, { getPort })
    })
    this.#admissions = batch.map((entry) => entry.admission)
    const claims = this.#admissions.map((admission) => admission.claims)
    this.#publicKeys = [...new Set(claims.flatMap((claim) => claim.publicKeys))]
    this.#publicKeySet = new Set(this.#publicKeys)
    return batch
  }

  /** Preflight the exact native batch before the Host can install any definition. */
  #prepareDefinitions(batch: ReturnType<typeof buildNativePluginBatch>): IPluginConstraint<any>[] {
    const pluginDefinitions: IPluginConstraint<any>[] = batch.map((entry) => entry.definition)
    preflightFeatureClaims(this.#admissions)
    if (!this.#host || !this.#kernel)
      throw createRpcError(RpcCoreErrorCode.invalidConfig, RpcCoreErrorText.endpointModuleInvalid)
    return pluginDefinitions
  }

  /** Dynamic keys and claim parity are admitted at the existing pre-activation boundary. */
  #validateActivation = (
    state: IRpcComposedRuntimeState,
    candidateHost: { readonly getPort: (key: PropertyKey) => unknown }
  ) => {
    const capabilityKeys = this.#capabilityPlugin?.getPublicKeys() ?? []
    const dynamicKeys = [...capabilityKeys, ...this.#host!.readNativeMiddlewareKeys()]
    const staticNativeKeys = new Set([
      ...this.#staticMiddlewareClaims.flatMap((snapshot) => snapshot.metadata!.claims.publicKeys),
      ...this.#firstPartyPolicies.flatMap((policy) => policy.firstPartyClaims?.publicKeys ?? [])
    ])

    if (
      dynamicKeys.some(
        (key) =>
          RPC_RESERVED_PROJECTION_KEYS.has(key) ||
          (this.#publicKeySet.has(key) && !staticNativeKeys.has(key))
      ) ||
      new Set(dynamicKeys).size !== dynamicKeys.length
    )
      throw createRpcError(
        RpcCoreErrorCode.capabilityConflict,
        RpcCoreErrorText.endpointModuleDuplicated
      )
    for (const key of dynamicKeys) {
      if (this.#publicKeySet.has(key)) continue
      this.#publicKeySet.add(key)
      this.#publicKeys.push(key)
    }
    assertFeatureClaimParity(this.#admissions, candidateHost, this.#kernel!, {
      activated: state.activated,
      activationPhase: 'pre-activation',
      routeKeys: state.routeKeys
    })
  }

  /** Merge only the real committed outputs and resolve their original Feature-owned ports. */
  async #installBatch(pluginDefinitions: IPluginConstraint<any>[]): Promise<void> {
    const handles = await this.#host!.installBatch(pluginDefinitions)
    this.#hostExtensions = mergeMiddlewareExtensions(handles)
    this.#resolvedPorts = resolveMiddlewarePorts(handles, this.#admissions)
    const publishedKeys = Reflect.ownKeys(this.#hostExtensions).filter(
      (key): key is string => typeof key === 'string'
    )
    for (const key of publishedKeys) {
      if (this.#publicKeySet.has(key)) continue
      this.#publicKeySet.add(key)
      this.#publicKeys.push(key)
    }
    assertFeatureClaimParity(
      this.#admissions,
      {
        extensions: this.#hostExtensions,
        getPort: (key: PropertyKey) => this.#resolvedPorts?.get(key)
      },
      this.#kernel!,
      { activated: this.#activationCommitted }
    )
  }

  /** Preserve primary-first construction failures while releasing every acquired native resource. */
  async #rollbackConstruction(primary: unknown): Promise<never> {
    rollbackTransportConstruction(this.#deferred.transport)
    if (this.#host) {
      try {
        await this.#host!.dispose()
      } catch (error) {
        throw createRpcConstructionError(RpcCoreErrorText.endpointModuleInvalid, primary, [
          { resource: 'plugin-host', error }
        ])
      }
      const hostFailure = primary as {
        readonly code?: unknown
        readonly cause?: unknown
        readonly detail?: { readonly rollbackErrors?: readonly unknown[] }
      }
      if (hostFailure.code === 'PLUGIN_INSTALL_FAILED') {
        const cause = Object.hasOwn(hostFailure, 'cause') ? hostFailure.cause : primary
        const rollbackErrors = (hostFailure.detail?.rollbackErrors ?? []).flatMap((error) =>
          error instanceof AggregateError ? [...error.errors] : [error]
        )
        if (rollbackErrors.length > 0)
          throw createRpcConstructionError(
            RpcCoreErrorText.endpointModuleInvalid,
            cause,
            rollbackErrors.map((error, index) => ({
              resource: `endpoint-module-${index}`,
              error
            }))
          )
        throw identifyRpcBoundaryFailure(
          cause,
          RpcCoreErrorCode.callbackFailed,
          RpcCoreErrorText.callbackFailed
        )
      }
    } else if (this.#kernel) {
      this.#construction?.close()
      if (this.#kernel!.state !== EndpointKernelState.disposed)
        try {
          this.#kernel!.beginClose()
          await this.#kernel!.resources.releaseAll()
          this.#kernel!.completeDispose()
        } catch (error) {
          throw createRpcConstructionError(RpcCoreErrorText.endpointModuleInvalid, primary, [
            { resource: 'endpoint-kernel', error }
          ])
        }
    } else {
      const cleanupErrors: { resource: string; error: unknown }[] = []
      if (this.#deferred.transport.ownership !== 'borrowed')
        try {
          await this.#deferred.transport.close?.()
        } catch (error) {
          cleanupErrors.push({ resource: 'transport', error })
        }
      if (cleanupErrors.length > 0)
        throw createRpcConstructionError(
          RpcCoreErrorText.endpointModuleInvalid,
          primary,
          cleanupErrors
        )
    }
    throw primary
  }

  /** Publish only admitted keys and keep native disposal, hooks and diagnostic owners attached. */
  async #project(): Promise<
    IRpcKernelSurface &
      IRpcFeatureSurface<TFeatures> &
      IRpcPingEndpointSurface<IFactoryPingCapability<TMiddlewares>>
  > {
    const exposedKeys = [...new Set<string>(this.#publicKeys)]
    const snapshotReader =
      this.#capabilityPlugin?.getSnapshotReader() ??
      [this.#hostExtensions]
        .map((value) => getEndpointDebugSnapshotReader(value as object))
        .find((reader): reader is NonNullable<typeof reader> => reader !== undefined)
    const hookOwner = this.#hostExtensions as { hooks?: IRpcEndpoint['hooks'] } | undefined
    const nativeOn = this.#capabilityPlugin?.getOn()
    const nativeHooks = this.#capabilityPlugin?.getHooks()
    let publicSurface: object
    try {
      publicSurface = createEndpointProjection({
        identity: this.#prepared!.id,
        kernel: this.#kernel!,
        // 投影的来源是 view 的 extensions;没有 view 就没有任何可投影的成员。此处曾回退到宿主本身,
        // 那只在宿主是类实例（方法都在原型上、自有键为空）时碰巧等价——宿主改为句柄后就不再成立。
        host: this.#hostExtensions ?? {},
        publicKeys: this.#publicKeys,
        exposedKeys,
        // 扇出成员在守卫前就是以 rejection 形态失败的；`ping`/`provide` 则是同步抛出。
        rejectionKeys: ['sendAll', 'pingAll', 'send'],
        ...(this.#publicFirstPartyRoots.includes('first-party-provider') && nativeOn
          ? {
              on: (...args: readonly unknown[]) =>
                nativeOn(args[0] as string, args[1] as Parameters<IRpcEndpoint['on']>[1])
            }
          : {}),
        ...(this.#publicFirstPartyRoots.includes('first-party-outbound') &&
        (nativeHooks ?? hookOwner?.hooks)
          ? { hooks: nativeHooks ?? hookOwner?.hooks }
          : {}),
        hostDispose: () =>
          (this.#endpointHostDispose ??= this.#host!.dispose().then(() => undefined)),
        beforeDispose: (endpoint) => {
          const cleanupFaults = readDiscoveryCleanupFaults(endpoint)
          if (!cleanupFaults) return
          this.#capabilityPlugin?.propagateDiscoveryCleanupFaults(cleanupFaults)
        }
      })
    } catch (primary) {
      rollbackTransportConstruction(this.#deferred.transport)
      try {
        await this.#host!.dispose()
      } catch (error) {
        throw createRpcConstructionError(RpcCoreErrorText.endpointModuleInvalid, primary, [
          { resource: 'plugin-host', error }
        ])
      }
      throw primary
    }
    registerEndpointTimePortOwner(publicSurface, this.#kernel!.time)
    if (snapshotReader) registerEndpointDebugSnapshot(publicSurface, snapshotReader)
    return publicSurface as IRpcKernelSurface &
      IRpcFeatureSurface<TFeatures> &
      IRpcPingEndpointSurface<IFactoryPingCapability<TMiddlewares>>
  }
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
  <const TConfig extends ICheckedInput, const TRoots extends Readonly<Record<string, IRpcFeature>>>(
    config: TConfig & IChecked<TConfig>,
    firstPartyRoots: TRoots
  ): Promise<
    IRecursiveProvideSurface<
      IRpcKernelSurface &
        IRpcFeatureSurface<IFeatures<TConfig>> &
        INativeMiddlewareSurface<IMiddlewares<TConfig>> &
        IRpcRootProjection<TRoots> &
        IRpcPingEndpointSurface<IFactoryPingCapability<IMiddlewares<TConfig>>>
    >
  >
  <
    TTargetId extends string = string,
    TMiddlewares extends readonly IRpcMiddleware[] = readonly IRpcMiddleware[],
    TFeatures extends readonly IRpcFeature[] = readonly IRpcFeature[],
    TRoots extends Readonly<Record<string, IRpcFeature>> = Readonly<Record<string, IRpcFeature>>
  >(
    config: ILegacyDefault<TTargetId, TMiddlewares, TFeatures>,
    firstPartyRoots: TRoots
  ): Promise<
    IRecursiveProvideSurface<
      IRpcKernelSurface &
        IRpcFeatureSurface<TFeatures> &
        INativeMiddlewareSurface<TMiddlewares> &
        IRpcRootProjection<TRoots> &
        IRpcPingEndpointSurface<IFactoryPingCapability<TMiddlewares>>
    >
  >
}

/**
 * Construct an endpoint from an explicit record of native Feature roots plus the configured
 * middleware tuple. Resolution publishes only admitted public keys after atomic installation and
 * ingress activation. Invalid claims or setup failures reject with rollback; dispose releases the
 * same canonical kernel resources.
 */
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
        throw createRpcError(
          RpcCoreErrorCode.capabilityConflict,
          RpcCoreErrorText.endpointModuleDuplicated
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
        throw createRpcError(
          RpcCoreErrorCode.capabilityConflict,
          RpcCoreErrorText.endpointModuleDuplicated
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
  features: readonly IRpcFeature[] | undefined
): readonly IRpcFeature[] {
  if (features === undefined) return []
  if (!Array.isArray(features))
    throw createRpcError(RpcCoreErrorCode.invalidConfig, RpcCoreErrorText.endpointModuleInvalid)
  try {
    return Object.freeze([...features])
  } catch (error) {
    throw createRpcError(
      RpcCoreErrorCode.invalidConfig,
      RpcCoreErrorText.endpointModuleInvalid,
      error
    )
  }
}

/** Rejects retired iterable module inputs before endpoint preparation or Host construction. */
function assertNativeRootRecord(
  value: unknown
): asserts value is Readonly<Record<string, IRpcFeature>> {
  if (
    Array.isArray(value) ||
    (typeof value === 'object' && value !== null && Symbol.iterator in value)
  )
    throw createRpcError(RpcCoreErrorCode.invalidConfig, RpcCoreErrorText.endpointModuleInvalid)
}
