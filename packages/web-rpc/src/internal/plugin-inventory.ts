import { EndpointKernelState, type IEndpointKernelHost } from '../endpoint-kernel.js'
import type { IWebRpcCoreConfig } from '../core.js'
import {
  EndpointModuleKey,
  activateEndpointModule,
  getEndpointModuleOwner,
  type IEndpointModuleClaims,
  type IRegisteredEndpointModule
} from './endpoint-modules.js'
import type { IPreparedEndpoint } from './endpoint-bootstrap.js'
import type {
  IDeferredPreparedEndpoint,
  IEndpointMiddlewareSnapshot
} from './endpoint-bootstrap.js'
import type {
  IWebRpcPluginDescriptor,
  IWebRpcPluginClaims,
  IWebRpcPluginRuntimeOutput,
  IWebRpcPluginRuntimeOutputPhase
} from './plugin-translator.js'
import type { IWebRpcTranslatedPlugin } from './plugin-translator.js'
import { toPluginDescriptor } from './plugin-descriptor.js'
import {
  WebRpcSharedKey,
  type IWebRpcCandidatePingPort,
  type IWebRpcInboundIdentityPort,
  type IWebRpcIdentityCommand,
  type IWebRpcOutboundOperationsPort,
  type IWebRpcOutboundCommand,
  type IWebRpcOutboundSend,
  type IWebRpcResponseOutboundCommand,
  type IWebRpcSynchronousOutboundCommand,
  type IWebRpcDiscoveryResolverPort,
  type IWebRpcTimePort,
  type IWebRpcVariationAdmissionRequest,
  type IWebRpcVariationCoordinatorPort
} from './plugin-shared-keys.js'
import { WebRpcError, WebRpcErrorCode } from '../errors.js'
import type { IWebRpcCleanupError } from '../errors.js'
import { WebRpcErrorText } from '../error-text.js'
import type { IWebRpcHookEvent, IWebRpcPingOptions } from '../typing.js'
import type { IOutboundAttachmentHost } from './outbound-attachment.js'
import {
  isNativeProviderModule,
  registerNativeProviderClaimAuthority
} from './provider-claim-authority.js'

/** One immutable repository-owned descriptor and its preflight claims. */
export type IWebRpcEndpointPluginInventoryEntry = {
  readonly descriptor: IWebRpcPluginDescriptor
  readonly claims: IWebRpcPluginClaims
}

/** Minimal owner contract used to publish the provider cancellation port. */
type IProviderCancellationOwner = {
  readonly abort: (id: string) => void
}

/** Fixed production batch positions exposed only to bounded internal failure injection tests. */
export type IWebRpcPluginRole =
  | { readonly kind: 'kernel' }
  | { readonly kind: 'middleware'; readonly index: number; readonly name: string }
  | { readonly kind: 'middleware-finalize' }
  | { readonly kind: 'feature'; readonly index: number; readonly key: string }
  | { readonly kind: 'activation' }

/** One production descriptor and its fixed batch position. */
export type IWebRpcComposedPluginInventoryEntry = {
  readonly role: IWebRpcPluginRole
  readonly descriptor: IWebRpcPluginDescriptor
}

/** Runtime batch state observed only by bounded production parity tests. */
export type IWebRpcComposedRuntimeState = {
  readonly routeKeys: readonly string[]
  readonly activated: boolean
}

/** Frozen result of one canonical outbound owner attempt for package-local diagnostics. */
export type IWebRpcOutboundCommandObservation = {
  readonly command: IWebRpcOutboundCommand
  readonly result: void | Promise<void>
  readonly error?: unknown
}

/** Side-effect-free builder inputs; callbacks allocate or mutate only during Host installation. */
export type IWebRpcComposedPluginBuilderOptions = {
  readonly definitions: readonly IRegisteredEndpointModule<IWebRpcCoreConfig>[]
  readonly config: IWebRpcCoreConfig
  readonly kernel: IEndpointKernelHost
  readonly deferred: IDeferredPreparedEndpoint<string>
  readonly middlewareSnapshots: readonly IEndpointMiddlewareSnapshot[]
  readonly hookEvents: IWebRpcHookEvent[]
  readonly onPrepared: (prepared: IPreparedEndpoint<string>) => void
  readonly getPrepared: () => IPreparedEndpoint<string>
  readonly getFeatureInstallations: () => readonly IWebRpcTranslatedPlugin[]
  readonly onActivationCommitted: () => void
  /** Restores the observed activation commit when Host rolls the batch back. */
  readonly onActivationRolledBack?: () => void
  readonly injectRuntimeOutput?: (
    role: IWebRpcPluginRole,
    phase: IWebRpcPluginRuntimeOutputPhase,
    output: IWebRpcPluginRuntimeOutput
  ) => IWebRpcPluginRuntimeOutput
  readonly injectRuntimeState?: (
    role: IWebRpcPluginRole,
    state: IWebRpcComposedRuntimeState
  ) => IWebRpcComposedRuntimeState | Promise<IWebRpcComposedRuntimeState>
  /** Runs the complete activation parity gate before any feature activation callback. */
  readonly onActivationPreflight?: (
    state: IWebRpcComposedRuntimeState,
    getShared: (key: PropertyKey) => unknown
  ) => void
  /** Reports endpoint-root cleanup identities without changing Host's own error contract. */
  readonly onRootDisposalErrors?: (errors: readonly IWebRpcCleanupError[]) => void
  /** Observes canonical outbound results without supplying or altering command behavior. */
  readonly observeOutboundCommand?: (observation: IWebRpcOutboundCommandObservation) => void
  readonly onRuntimeState?: (state: IWebRpcComposedRuntimeState) => void
  readonly injectInstall?: (
    role: IWebRpcPluginRole,
    install: IWebRpcPluginDescriptor['install']
  ) => IWebRpcPluginDescriptor['install']
}

/**
 * Inventories the package's admitted endpoint modules without creating a registry or lifecycle
 * owner. Shared lookup remains a narrow domain callback so the D64 translator stays stateless.
 */
export function createEndpointPluginInventory(
  definitions: readonly IRegisteredEndpointModule<IWebRpcCoreConfig>[],
  config: IWebRpcCoreConfig,
  kernel: IEndpointKernelHost,
  getPrepared: () => IPreparedEndpoint<string>,
  observeOutboundCommand?: (observation: IWebRpcOutboundCommandObservation) => void
): readonly IWebRpcEndpointPluginInventoryEntry[] {
  return definitions.map((definition) => {
    const claims: IEndpointModuleClaims = definition.claims
    if (isNativeProviderModule(definition.sourceToken)) registerNativeProviderClaimAuthority(claims)
    const sharedContract = {
      ...(claims.sharedProvides ? { sharedProvides: claims.sharedProvides } : {}),
      ...(claims.sharedConsumes ? { sharedConsumes: claims.sharedConsumes } : {}),
      ...(claims.sharedOptionalConsumes
        ? { sharedOptionalConsumes: claims.sharedOptionalConsumes }
        : {})
    }
    const descriptor: IWebRpcPluginDescriptor = Object.freeze({
      name: definition.key,
      claims,
      ...sharedContract,
      install: async (scope) =>
        definition.install({
          config,
          kernel,
          prepared: getPrepared(),
          id: scope.id,
          transport: scope.transport,
          signal: scope.signal,
          hooks: scope.hooks,
          own: scope.own,
          getShared: scope.getShared
        }),
      ...(definition.key === EndpointModuleKey.outbound
        ? {
            shared: (installation: unknown) => {
              const owner = getEndpointModuleOwner(installation) as
                | IOutboundAttachmentHost
                | undefined
              if (owner === undefined) return {}
              const outboundOwner = owner
              const verify: IWebRpcInboundIdentityPort['verify'] = (
                command: IWebRpcIdentityCommand
              ) => {
                if (command.operation === 'admit')
                  return owner.inboundIdentity.admit(command.request)
                if (command.operation === 'retain')
                  return owner.inboundIdentity.retain(command.token)
                owner.inboundIdentity.release(command.token)
              }
              const inboundIdentity: IWebRpcInboundIdentityPort = { verify }
              const admit: IWebRpcVariationCoordinatorPort['admit'] = (
                value: IWebRpcVariationAdmissionRequest
              ) => {
                if (value.operation === 'register')
                  return owner.variations.register(value.variation, value.handler)
                if (value.operation === 'consumeAbort')
                  return owner.variations.consumeAbort(value.key)
                if (value.operation === 'abort')
                  return owner.variations.abort(
                    value.key,
                    value.controller,
                    value.expiresAt,
                    value.reason
                  )
                return undefined
              }
              const variationCoordinator: IWebRpcVariationCoordinatorPort = { admit }
              /** Dispatches one bounded provider command while preserving owner timing. */
              function send(command: IWebRpcResponseOutboundCommand): Promise<void>
              function send(command: IWebRpcSynchronousOutboundCommand): void
              function send(command: IWebRpcOutboundCommand): Promise<void> | void {
                const observe = (result: void | Promise<void>, error?: unknown): void => {
                  if (!observeOutboundCommand) return
                  const observation = Object.freeze({
                    command,
                    result,
                    ...(error === undefined ? {} : { error })
                  })
                  try {
                    observeOutboundCommand(observation)
                  } catch (observerError) {
                    outboundOwner.emitFailure(observerError, WebRpcErrorCode.internal)
                  }
                }
                if (command.kind === 'response' || command.kind === 'frame') {
                  try {
                    const result = outboundOwner.sendFrame(command.message, command.transfer)
                    observe(result)
                    return result
                  } catch (error) {
                    observe(undefined, error)
                    throw error
                  }
                }
                if (command.kind === 'dispatch') {
                  try {
                    outboundOwner.dispatch(command.targetId, command.method, command.data)
                    observe(undefined)
                  } catch (error) {
                    observe(undefined, error)
                    throw error
                  }
                  return
                }
                if (command.kind === 'one-way') {
                  try {
                    const result = outboundOwner.sendOneWay(
                      command.targetId,
                      command.method,
                      command.data,
                      { transfer: command.transfer }
                    )
                    observe(result)
                    return result
                  } catch (error) {
                    observe(undefined, error)
                    throw error
                  }
                }
                if (command.kind === 'validate') {
                  try {
                    outboundOwner.validate(command.method, command.side, command.data)
                    observe(undefined)
                  } catch (error) {
                    observe(undefined, error)
                    throw error
                  }
                  return
                }
                if (command.kind === 'diagnostic') {
                  try {
                    outboundOwner.emitDiagnostic(command.event)
                    observe(undefined)
                  } catch (error) {
                    observe(undefined, error)
                    throw error
                  }
                  return
                }
                if (command.kind === 'report') {
                  try {
                    outboundOwner.emitFailure(command.error, command.code)
                    observe(undefined)
                  } catch (error) {
                    observe(undefined, error)
                    throw error
                  }
                  return
                }
              }
              const outboundOperations: IWebRpcOutboundOperationsPort = {
                send: send as IWebRpcOutboundSend
              }
              return {
                [WebRpcSharedKey.inboundIdentity]: Object.freeze(inboundIdentity),
                [WebRpcSharedKey.variationCoordinator]: Object.freeze(variationCoordinator),
                [WebRpcSharedKey.outboundOperations]: Object.freeze(outboundOperations)
              }
            }
          }
        : definition.key === EndpointModuleKey.control
          ? {
              shared: (installation: unknown) => {
                const owner = getEndpointModuleOwner(installation) as
                  | {
                      readonly ping: (
                        targetId: string,
                        receiverId?: string,
                        options?: IWebRpcPingOptions
                      ) => Promise<boolean>
                    }
                  | undefined
                if (!owner) return {}
                const candidatePing: IWebRpcCandidatePingPort = Object.freeze({
                  ping: (candidate, options) =>
                    owner.ping(candidate.targetId, candidate.receiverId, options)
                })
                return { [WebRpcSharedKey.candidatePing]: candidatePing }
              }
            }
          : definition.key === EndpointModuleKey.discovery
            ? {
                shared: (installation: unknown) => {
                  const owner = getEndpointModuleOwner(installation) as
                    | {
                        readonly resolveReceiver: (targetId: string) => Promise<{
                          readonly receiverId: string
                          readonly verifiedPeerKey?: string
                        }>
                      }
                    | undefined
                  if (!owner) return {}
                  const resolver: IWebRpcDiscoveryResolverPort = Object.freeze({
                    resolve: (targetId) => owner.resolveReceiver(targetId)
                  })
                  return { [WebRpcSharedKey.discoveryResolver]: resolver }
                }
              }
            : definition.key === EndpointModuleKey.provider
              ? {
                  shared: (installation: unknown) => {
                    const owner = getEndpointModuleOwner(installation) as
                      | IProviderCancellationOwner
                      | undefined
                    if (!owner) return {}
                    return {
                      [WebRpcSharedKey.providerCancellation]: Object.freeze({
                        abort: (id: string) => owner.abort(id)
                      })
                    }
                  }
                }
              : {})
    })
    return Object.freeze({ descriptor, claims })
  })
}

/**
 * Builds the exact production Host batch without allocating runtime state. The runtime and B12a
 * failure matrix both consume this list; only the bounded install callback may alter role
 * behavior.
 */
export function buildComposedPluginInventory(
  options: IWebRpcComposedPluginBuilderOptions
): readonly IWebRpcComposedPluginInventoryEntry[] {
  const emptyClaims: IWebRpcPluginClaims = {
    routes: [],
    provides: [],
    consumes: [],
    publicKeys: [],
    exposedKeys: [],
    activator: false
  }
  const entries: IWebRpcComposedPluginInventoryEntry[] = []
  const add = (role: IWebRpcPluginRole, descriptor: IWebRpcPluginDescriptor): void => {
    const install = options.injectInstall?.(role, descriptor.install) ?? descriptor.install
    const runtimeOutput = options.injectRuntimeOutput
      ? (phase: IWebRpcPluginRuntimeOutputPhase, output: IWebRpcPluginRuntimeOutput) =>
          options.injectRuntimeOutput!(role, phase, output)
      : descriptor.runtimeOutput
    const baseDescriptor =
      role.kind === 'middleware'
        ? { ...descriptor, preserveRuntimeOutputForHost: true }
        : descriptor
    entries.push({
      role,
      descriptor:
        install === baseDescriptor.install && runtimeOutput === baseDescriptor.runtimeOutput
          ? baseDescriptor
          : { ...baseDescriptor, install, runtimeOutput }
    })
  }
  add(
    { kind: 'kernel' },
    {
      name: 'kernel',
      claims: emptyClaims,
      sharedProvides: [WebRpcSharedKey.time],
      install: async (scope) => {
        scope.own({}, async () => {
          if (options.kernel.state === EndpointKernelState.disposed) return
          options.kernel.beginClose()
          try {
            const errors = await options.kernel.resources.releaseAll()
            const cleanupErrors = errors.flatMap(({ error }) => flattenReleaseErrors(error))
            if (cleanupErrors.length > 0) {
              options.onRootDisposalErrors?.(
                errors.flatMap(({ resource, error }) =>
                  flattenReleaseErrors(error).map((child) => ({ resource, error: child }))
                )
              )
              if (cleanupErrors.length === 1) throw cleanupErrors[0]
              throw new AggregateError(cleanupErrors)
            }
          } finally {
            options.kernel.completeDispose()
          }
        })
        return {}
      },
      shared: () => ({
        [WebRpcSharedKey.time]: Object.freeze({
          now: () => options.kernel.time.now(),
          setTimeout: options.kernel.time.setTimeout,
          clearTimeout: options.kernel.time.clearTimeout
        } satisfies IWebRpcTimePort)
      })
    }
  )
  options.middlewareSnapshots.forEach((snapshot, index) => {
    add(
      { kind: 'middleware', index, name: snapshot.name.replace(/^middleware:/, '') },
      toPluginDescriptor(snapshot.plugin)
    )
  })
  add(
    { kind: 'middleware-finalize' },
    {
      name: 'middleware-finalize',
      claims: emptyClaims,
      sharedProvides: [],
      sharedConsumes: [WebRpcSharedKey.connect],
      sharedOptionalConsumes: [
        WebRpcSharedKey.protocol,
        WebRpcSharedKey.contract,
        WebRpcSharedKey.authentication,
        WebRpcSharedKey.timeout,
        WebRpcSharedKey.abort,
        WebRpcSharedKey.hooks,
        WebRpcSharedKey.ping,
        WebRpcSharedKey.uuid
      ],
      install: async (scope) => {
        const prepared = await options.deferred.finalize(
          options.hookEvents,
          (operation) => Promise.resolve(operation()),
          scope.getShared
        )
        options.onPrepared(prepared)
        return {}
      }
    }
  )
  const featureEntries = createEndpointPluginInventory(
    options.definitions,
    options.config,
    options.kernel,
    options.getPrepared,
    options.observeOutboundCommand
  )
  featureEntries.forEach((entry, index) => {
    add({ kind: 'feature', index, key: entry.descriptor.name }, entry.descriptor)
  })
  add(
    { kind: 'activation' },
    {
      name: 'activation',
      claims: { ...emptyClaims, activator: true },
      install: async (scope) => {
        scope.own({}, () => options.onActivationRolledBack?.())
        scope.own({}, () => {
          options.kernel.beginClose()
          const errors = options.kernel.resources.releaseSync()
          if (errors.length > 0) {
            options.onRootDisposalErrors?.(
              errors.flatMap(({ resource, error }) =>
                flattenReleaseErrors(error).map((child) => ({ resource, error: child }))
              )
            )
            throw new AggregateError(errors.map(({ error }) => error))
          }
        })
        const state = await (options.injectRuntimeState?.(
          { kind: 'activation' },
          { routeKeys: options.kernel.routeKeys, activated: true }
        ) ?? { routeKeys: options.kernel.routeKeys, activated: true })
        options.onActivationPreflight?.(state, scope.getShared)
        for (const item of options.getFeatureInstallations()) {
          const installation = item.getInstallation()
          if (installation === undefined)
            throw new WebRpcError(
              WebRpcErrorCode.invalidConfig,
              WebRpcErrorText.endpointModuleInvalid
            )
          activateEndpointModule(installation)
        }
        options.onRuntimeState?.(state)
        if (state.activated) options.onActivationCommitted()
        return {}
      }
    }
  )
  return Object.freeze(entries)
}

/** Preserves raw cleanup identities while flattening lifecycle/resource diagnostic containers. */
function flattenReleaseErrors(error: unknown): readonly unknown[] {
  if (error instanceof AggregateError)
    return error.errors.flatMap((child) => flattenReleaseErrors(child))
  if (error && typeof error === 'object' && 'error' in error)
    return flattenReleaseErrors((error as { readonly error: unknown }).error)
  return [error]
}
