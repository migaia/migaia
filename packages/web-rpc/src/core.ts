import {
  WebRpcConstructionError,
  WebRpcError,
  WebRpcErrorCode,
  type IWebRpcCleanupError
} from './errors.js'
import { WebRpcErrorText } from './error-text.js'
import {
  endpointModuleDuplicate,
  getEndpointModuleRootProjection,
  snapshotEndpointModules
} from './internal/endpoint-modules.js'
import {
  assertPluginClaimParity,
  preflightPluginClaims,
  toPluginHostDefinition,
  type IWebRpcTranslatedPlugin
} from './internal/plugin-translator.js'
import {
  buildComposedPluginInventory,
  type IWebRpcComposedRuntimeState
} from './internal/plugin-inventory.js'
import { createConstructionControl } from './internal/construction-install.js'
import { WebRpcPluginHost } from './internal/web-rpc-plugin-host.js'
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
  registerDiscoveryCleanupFaults,
  registerEndpointDebugSnapshot,
  registerEndpointTimePortOwner
} from './internal/test-observer.js'
import { createEndpointProjection } from './internal/endpoint-projection.js'
import type {
  IFactoryPingCapability,
  IWebRpcEndpoint,
  IWebRpcFactoryConfig,
  IWebRpcPlugin,
  IWebRpcProvider,
  IWebRpcPingEndpointSurface,
  IWebRpcAbortSignal,
  IWebRpcHookEvent
} from './typing.js'

/** Runtime-neutral configuration accepted by the composition kernel. */
export type IWebRpcCoreConfig = IWebRpcFactoryConfig

/** Opaque first-party token used to select statically imported feature modules. */
declare const endpointModuleBrand: unique symbol
declare const endpointModuleRootBrand: unique symbol

/** Non-constructible public brand for package-owned feature tokens. */
export type IWebRpcEndpointModule<
  TSurface extends object = object,
  TRootSurface extends object = TSurface
> = {
  readonly key: string
  readonly [endpointModuleBrand]: TSurface
  readonly [endpointModuleRootBrand]: TRootSurface
}

/** Composes selected first-party modules while preserving existing endpoint ownership. */
export async function createComposedEndpoint<
  const TModules extends readonly IWebRpcEndpointModule[],
  TTargetId extends string = string,
  TMiddlewares extends readonly IWebRpcPlugin[] = readonly IWebRpcPlugin[]
>(
  config: IWebRpcFactoryConfig<TTargetId, TMiddlewares>,
  modules: TModules
): Promise<
  IWebRpcKernelSurface &
    IWebRpcComposedModuleSurface<TModules> &
    IWebRpcPingEndpointSurface<IFactoryPingCapability<TMiddlewares>>
> {
  let definitions: ReturnType<typeof snapshotEndpointModules<IWebRpcCoreConfig>>
  try {
    definitions = snapshotEndpointModules<IWebRpcCoreConfig>(modules)
    if (definitions.length === 0)
      throw new WebRpcError(WebRpcErrorCode.invalidConfig, WebRpcErrorText.endpointModuleInvalid)
  } catch (error) {
    if (error === endpointModuleDuplicate)
      throw new WebRpcError(
        WebRpcErrorCode.capabilityConflict,
        WebRpcErrorText.endpointModuleDuplicated,
        error
      )
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
  let kernel: IEndpointKernelHost | undefined
  let host: WebRpcPluginHost | undefined
  let hostView: import('@migaia/plugin-host').IPluginHostView<WebRpcPluginHost> | undefined
  let construction: ReturnType<typeof createConstructionControl> | undefined
  let prepared: IPreparedEndpoint<TTargetId> | undefined
  let installed: unknown[] = []
  let rootCleanupErrors: IWebRpcCleanupError[] = []
  let publicKeys: readonly string[] = []
  try {
    kernel = createEndpointKernel(deferred.transport)
    const constructionConfig = deferred.construction
    const constructionSignal =
      constructionConfig?.signal ?? (new AbortController().signal as IWebRpcAbortSignal)
    construction = createConstructionControl({
      signal: constructionSignal,
      timeoutMs: constructionConfig?.timeoutMs
    })
    const hookEvents: IWebRpcHookEvent[] = []
    host = new WebRpcPluginHost(
      deferred.id,
      deferred.transport,
      construction,
      (event) => hookEvents.push(event),
      {
        execution: {
          mutationTimeoutMs: constructionConfig?.timeoutMs ?? false,
          pipelineDrainTimeoutMs: constructionConfig?.timeoutMs ?? false
        }
      },
      () => rootCleanupErrors
    )
    let activationCommitted = false
    let translatedFeatures: IWebRpcTranslatedPlugin[] = []
    let activationPreflight:
      | ((
          state: IWebRpcComposedRuntimeState,
          host: { readonly getShared: (key: PropertyKey) => unknown }
        ) => void)
      | undefined
    const inventory = buildComposedPluginInventory({
      definitions,
      config,
      kernel,
      deferred: deferred as unknown as IDeferredPreparedEndpoint<string>,
      middlewareSnapshots: deferred.middlewareSnapshots,
      hookEvents,
      onPrepared: (value) => {
        prepared = value as IPreparedEndpoint<TTargetId>
      },
      getPrepared: () => {
        if (!prepared)
          throw new WebRpcError(
            WebRpcErrorCode.invalidConfig,
            WebRpcErrorText.endpointModuleInvalid
          )
        return prepared as IPreparedEndpoint<string>
      },
      getFeatureInstallations: () => translatedFeatures,
      onActivationCommitted: () => {
        activationCommitted = true
      },
      onActivationRolledBack: () => {
        activationCommitted = false
      },
      onRootDisposalErrors: (errors) => {
        rootCleanupErrors = [...rootCleanupErrors, ...errors]
      },
      onActivationPreflight: (state, getShared) => activationPreflight?.(state, { getShared })
    })
    const descriptors = inventory.map(({ descriptor }) => descriptor)
    publicKeys = [...new Set(descriptors.flatMap((descriptor) => descriptor.claims.publicKeys))]
    const claims = descriptors.map((descriptor) => descriptor.claims)
    const translated = descriptors.map((descriptor, index) =>
      toPluginHostDefinition(descriptor, claims[index]!)
    ) as IWebRpcTranslatedPlugin[]
    translatedFeatures = translated.filter(
      (_item, index) => inventory[index]?.role.kind === 'feature'
    )
    preflightPluginClaims(descriptors, claims)
    const activationHost = host
    const activationKernel = kernel
    if (!activationHost || !activationKernel)
      throw new WebRpcError(WebRpcErrorCode.invalidConfig, WebRpcErrorText.endpointModuleInvalid)
    activationPreflight = (state, candidateHost) =>
      assertPluginClaimParity(claims, descriptors, candidateHost, activationKernel, {
        activated: state.activated,
        activationPhase: 'pre-activation',
        routeKeys: state.routeKeys,
        translated
      })
    hostView = await host.installBatch(translated.map((item) => item.definition))
    assertPluginClaimParity(claims, descriptors, hostView, kernel, {
      activated: activationCommitted,
      translated
    })
    installed = translatedFeatures.map((item) => item.getInstallation())
    if (installed.some((installation) => installation === undefined))
      throw new WebRpcError(WebRpcErrorCode.invalidConfig, WebRpcErrorText.endpointModuleInvalid)
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
  const exposedKeys = [
    ...new Set<string>(modules.flatMap((module) => getEndpointModuleRootProjection(module)))
  ]
  const snapshotReader = installed
    .toReversed()
    .map((value) => getEndpointDebugSnapshotReader(value as object))
    .find((reader): reader is NonNullable<typeof reader> => reader !== undefined)
  const hookOwner = installed.find(
    (value) => typeof (value as { hooks?: unknown }).hooks === 'object'
  ) as { hooks?: IWebRpcKernelSurface['hooks'] } | undefined
  const onOwner = installed.find(
    (value) => typeof (value as { on?: unknown }).on === 'function'
  ) as { on: IWebRpcEndpoint['on'] } | undefined
  let publicSurface: object
  let endpointHostDispose: Promise<void> | undefined
  try {
    publicSurface = createEndpointProjection({
      host: hostView?.extensions ?? host!,
      publicKeys,
      exposedKeys,
      on: (...args) => {
        if (!onOwner)
          throw new WebRpcError(
            WebRpcErrorCode.invalidConfig,
            WebRpcErrorText.endpointModuleInvalid
          )
        return onOwner.on(args[0] as string, args[1] as Parameters<IWebRpcEndpoint['on']>[1])
      },
      hooks: hookOwner?.hooks,
      hostDispose: () => (endpointHostDispose ??= host!.dispose().then(() => undefined)),
      beforeDispose: (endpoint) => {
        const cleanupFaults = readDiscoveryCleanupFaults(endpoint)
        if (!cleanupFaults) return
        for (const value of installed) {
          if (typeof value === 'object' && value !== null)
            registerDiscoveryCleanupFaults(value, cleanupFaults)
        }
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
    IWebRpcComposedModuleSurface<TModules> &
    IWebRpcPingEndpointSurface<IFactoryPingCapability<TMiddlewares>>
}

/** Public methods contributed by selected module tuple; unselected features are absent from types. */
export type IWebRpcModuleSurface<TModules extends readonly IWebRpcEndpointModule[]> = (
  TModules[number] extends infer TModule
    ? TModule extends IWebRpcEndpointModule<infer _TDescriptorSurface, infer TRootSurface>
      ? TRootSurface
      : never
    : never
) extends infer TSurface
  ? IUnionToIntersection<TSurface>
  : never

/** Reprojects a selected module tuple so fluent `provide()` retains the composed surface. */
export type IWebRpcComposedModuleSurface<TModules extends readonly IWebRpcEndpointModule[]> =
  IRecursiveProvideSurface<IWebRpcModuleSurface<TModules> & object>

type IRecursiveProvideSurface<TSurface extends object> = Omit<TSurface, 'provide'> &
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

export type IWebRpcKernelSurface = Pick<IWebRpcEndpoint, 'on' | 'hooks' | 'dispose'>
