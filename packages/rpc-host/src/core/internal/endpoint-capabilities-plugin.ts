import { createRpcError, RpcCoreErrorCode } from '../errors.js'
import { definePlugin, type IFeatureRecord, type IPluginHostCore } from '@migaia/plugin-host'

import { RpcCoreErrorText } from '../error-text.js'
import {
  readFeaturePolicy,
  type IRpcClaimAdmission,
  type IRpcFeaturePolicy
} from './feature-policy.js'
import { runConstructionInstall } from './construction-install.js'
import type { IRpcFeature } from '../feature.js'
import type { IRpcPluginConstraint, IRpcPluginCore } from './plugin-contract.js'
import type { IRpcFeatureExpose, IRpcOutboundCommandObservation } from './feature-contract.js'
import { RpcPortName, type IRpcCandidatePingPort, type IRpcTimePort } from './plugin-shared-keys.js'
import {
  getEndpointDebugSnapshotReader,
  registerDiscoveryCleanupFaults,
  registerEndpointDebugSnapshot,
  type IRpcDiscoveryCleanupFaults
} from './test-observer.js'
import { createWebRpcPortFeatureSet } from './port-feature.js'

/** Read-only endpoint facts supplied to native first-party Features after middleware preparation. */
export type IEndpointCapabilitiesFeatureExpose = IRpcFeatureExpose

/** Named public shape prevents private PluginHost feature-brand details leaking into declarations. */
export type IEndpointCapabilitiesPlugin = Readonly<{
  readonly definition: IRpcPluginConstraint
  readonly getPublicKeys: () => readonly string[]
  readonly getSnapshotReader: () => ReturnType<typeof getEndpointDebugSnapshotReader> | undefined
  readonly getOn: () => ((event: string, listener: unknown) => unknown) | undefined
  readonly getHooks: () => { on(listener: import('../typing.js').IRpcHook): () => void } | undefined
  readonly propagateDiscoveryCleanupFaults: (faults: IRpcDiscoveryCleanupFaults) => void
  readonly activate: () => void
}>

/** One capability Feature definition and its domain admission for the canonical Host batch. */
export type IEndpointCapabilitiesBatchFeature = Readonly<{
  readonly plugin: IEndpointCapabilitiesPlugin
  readonly admission: IRpcClaimAdmission | undefined
  readonly firstPartyPolicies: readonly IRpcFeaturePolicy[]
}>

/**
 * Composition supplies construction facts and an internal-only output observer for native fault
 * oracles.
 */
type IEndpointCapabilitiesContext = Pick<IRpcFeatureExpose, 'getKernel' | 'getPrepared'> & {
  /** Bounded internal observer receives actual outbound attachment command results. */
  readonly observeOutboundCommand?: (observation: IRpcOutboundCommandObservation) => void
  /**
   * Transforms the exact descriptor output before PluginHost publishes it; production leaves it
   * absent.
   */
  readonly transformOutput?: (
    phase: 'ports' | 'extension',
    output: Readonly<Record<PropertyKey, unknown>>
  ) => Readonly<Record<PropertyKey, unknown>>
  /** Test-only seam wraps a named native prepare operation without cloning its Feature definition. */
  readonly transformFeaturePrepare?: (
    name: string,
    prepare: (scope: import('../typing.js').IRpcPluginInstallScope) => unknown
  ) => (scope: import('../typing.js').IRpcPluginInstallScope) => unknown | Promise<unknown>
}

/** Builds the sole native custom-Feature bridge before endpoint activation. */
/** The native descriptor receives lifecycle methods plus resolved outputs from its selected roots. */
type IEndpointCapabilitiesNativeCore = IRpcPluginCore &
  IPluginHostCore<never> &
  Readonly<{ features: Readonly<Record<string, unknown>> }>

/** Allocate definition-owned projection state once before native installation. */
function endpointCapabilitiesState(
  roots: Readonly<Record<string, IRpcFeature>>,
  context: IEndpointCapabilitiesContext,
  prepareRoots: readonly string[] = [],
  activateRoots: readonly string[] = [],
  sharedRoots: readonly string[] = [],
  publicRoots: ReadonlySet<string> | undefined = undefined
) {
  /** First-party attachments publish these ports as ordinary PluginHost Features. */
  const providedPortNames = getFirstPartyPortNames(roots)
  /** Deferred port cells are allocated separately for each native installation. */
  const portFeatures = createWebRpcPortFeatureSet(providedPortNames)
  /** One installation-owned key snapshot becomes available before the activation Plugin runs. */
  let publicKeys: readonly string[] = Object.freeze([])
  /** The installed attachment lends its original diagnostic hook channel after preparation. */
  const hooks = undefined as
    | { on(listener: import('../typing.js').IRpcHook): () => void }
    | undefined
  /** Installation results supply first-party public surfaces without exposing capability methods. */
  const preparedOutputs: Record<string, unknown> = Object.create(null)
  /** Invokes prepared first-party attachment activation only from the final activation Plugin. */
  let activate = (): void => undefined
  /** Captures the final projected attachment diagnostic without adding a second registry. */
  const snapshotReader = undefined as ReturnType<typeof getEndpointDebugSnapshotReader> | undefined
  /** Retains the provider listener owner without widening the public capability projection. */
  const on = undefined as ((event: string, listener: unknown) => unknown) | undefined

  return {
    providedPortNames,
    portFeatures,
    publicKeys,
    hooks,
    preparedOutputs,
    activate,
    snapshotReader,
    on,
    roots,
    context,
    prepareRoots,
    activateRoots,
    sharedRoots,
    publicRoots
  }
}

/**
 * Each native installation retains its own core and port cells while sharing the definition's
 * projection receipt.
 */
class EndpointCapabilitiesInstallation {
  /**
   * Installation-local native core and deferred port publication remain bound to this exact
   * registration.
   */
  #state: {
    owner: ReturnType<typeof endpointCapabilitiesState>
    core: IEndpointCapabilitiesNativeCore
    portRuntime: ReturnType<ReturnType<typeof createWebRpcPortFeatureSet>['createRuntime']>
  }
  /** Native PluginHost lifecycle calls these stable callbacks in the original preparation order. */
  readonly value
  /** Capture one native core before publishing its install, expose and activation hooks. */
  constructor(
    owner: ReturnType<typeof endpointCapabilitiesState>,
    core: IEndpointCapabilitiesNativeCore
  ) {
    this.#state = { owner, core, portRuntime: owner.portFeatures.createRuntime() }
    owner.activate = this.#activate
    this.value = Object.freeze({
      install: this.#install,
      expose: this.#expose,
      featureExpose: () =>
        Object.freeze({
          ...this.#state.portRuntime.expose,
          getKernel: this.#state.owner.context.getKernel,
          getPrepared: this.#state.owner.context.getPrepared,
          getTime: () => this.#state.core.getPort(RpcPortName.time) as IRpcTimePort,
          getCandidatePing: () =>
            this.#state.core.getPort(RpcPortName.candidatePing) as
              | IRpcCandidatePingPort
              | undefined,
          ...(this.#state.owner.context.observeOutboundCommand
            ? { observeOutboundCommand: this.#state.owner.context.observeOutboundCommand }
            : {})
        })
    })
  }
  /** Activate only the originally selected prepared attachments after native installation. */
  #activate = (): void => {
    for (const name of this.#state.owner.activateRoots) {
      const output = this.#state.core.features[name]
      const activateFeature = output && (output as { readonly activate?: unknown }).activate
      if (typeof activateFeature !== 'function')
        throw createRpcError(RpcCoreErrorCode.invalidConfig, RpcCoreErrorText.endpointModuleInvalid)
      activateFeature()
    }
  }
  /**
   * Runs first-party attachment preparation after middleware finalization, never in Feature
   * factories.
   */
  #install = async (): Promise<Record<never, never>> => {
    await runConstructionInstall(
      {
        id: this.#state.core.id,
        transport: this.#state.core.transport,
        control: this.#state.core.construction,
        hooks: this.#state.core.hooks,
        getPort: (key) => this.#state.core.getPort(key),
        report: (error) => {
          this.#state.core.hooks({
            name: 'failure',
            at: this.#state.core.construction.time.timestamp(),
            localId: this.#state.core.id,
            code: RpcCoreErrorCode.internal,
            error
          })
        },
        registerScope: (_scope, close, awaitClose) => {
          this.#state.core.onDispose(async () => {
            close()
            await awaitClose()
          })
        }
      },
      async (scope) => {
        for (const name of this.#state.owner.prepareRoots) {
          const output = this.#state.core.features[name]
          const prepare = output
            ? (
                output as {
                  readonly prepare?: (
                    scope: import('../typing.js').IRpcPluginInstallScope
                  ) => unknown
                }
              ).prepare
            : undefined
          if (typeof prepare !== 'function')
            throw createRpcError(
              RpcCoreErrorCode.invalidConfig,
              RpcCoreErrorText.endpointModuleInvalid
            )
          const transformedPrepare =
            this.#state.owner.context.transformFeaturePrepare?.(name, prepare) ?? prepare
          this.#state.owner.preparedOutputs[name] = await transformedPrepare(scope)
          const getHooks = (this.#state.core.features[name] as { readonly getHooks?: unknown })
            .getHooks
          if (typeof getHooks === 'function') this.#state.owner.hooks = getHooks()
        }
        return {}
      }
    )
    const ports = this.#collectFirstPartyPorts()
    this.#state.portRuntime.publish(ports)
    this.#state.core.publishPortFeatures(this.#state.portRuntime.outputs)
    return {}
  }

  /** Collects selected first-party ports before dependent attachments install. */
  #collectFirstPartyPorts = (): Readonly<Record<PropertyKey, unknown>> => {
    const ports: Record<PropertyKey, unknown> = Object.create(null)
    for (const name of this.#state.owner.sharedRoots) {
      const output = this.#state.core.features[name]
      const createPorts = output && (output as { readonly ports?: unknown }).ports
      if (typeof createPorts !== 'function')
        throw createRpcError(RpcCoreErrorCode.invalidConfig, RpcCoreErrorText.endpointModuleInvalid)
      const values = createPorts()
      if (!values || typeof values !== 'object')
        throw createRpcError(RpcCoreErrorCode.invalidConfig, RpcCoreErrorText.endpointModuleInvalid)
      for (const key of Reflect.ownKeys(values)) {
        if (key in ports)
          throw createRpcError(
            RpcCoreErrorCode.capabilityConflict,
            RpcCoreErrorText.endpointModuleDuplicated
          )
        const descriptor = Object.getOwnPropertyDescriptor(values, key)
        if (!descriptor || !('value' in descriptor))
          throw createRpcError(
            RpcCoreErrorCode.invalidConfig,
            RpcCoreErrorText.endpointModuleInvalid
          )
        Object.defineProperty(ports, key, descriptor)
      }
    }
    const output = Object.freeze(ports)
    return this.#state.owner.context.transformOutput?.('ports', output) ?? output
  }

  /** Feature outputs become ready after descriptor creation and before Host publication. */
  #expose = (): Readonly<Record<string, unknown>> => {
    const projection: Record<string, unknown> = Object.create(null)
    for (const [name, output] of Object.entries(this.#state.core.features)) {
      if (!Object.hasOwn(this.#state.owner.roots, name)) continue
      if (this.#state.owner.publicRoots && !this.#state.owner.publicRoots.has(name)) continue
      const policy = readFeaturePolicy(this.#state.owner.roots[name]!)
      const prepared = this.#state.owner.preparedOutputs[name] as
        | { readonly public?: object }
        | undefined
      const projectionSource = (prepared?.public ?? output) as object
      const keys = policy.publicKeys ?? Object.keys(projectionSource)
      for (const key of keys) {
        const descriptor = Object.getOwnPropertyDescriptor(projectionSource, key)
        if (!descriptor || !('value' in descriptor))
          throw createRpcError(
            RpcCoreErrorCode.invalidConfig,
            RpcCoreErrorText.endpointModuleInvalid
          )
        if (key in projection)
          throw createRpcError(
            RpcCoreErrorCode.capabilityConflict,
            RpcCoreErrorText.endpointModuleDuplicated
          )
        Object.defineProperty(projection, key, {
          configurable: false,
          enumerable: true,
          value: descriptor.value,
          writable: false
        })
      }
    }
    this.#state.owner.publicKeys = Object.freeze(Object.keys(projection))
    const preferredSnapshotOutputs = [
      this.#state.owner.preparedOutputs['first-party-discovery'],
      this.#state.owner.preparedOutputs['first-party-provider'],
      this.#state.owner.preparedOutputs['first-party-outbound']
    ]
    this.#state.owner.snapshotReader = undefined
    for (const prepared of preferredSnapshotOutputs) {
      if (!prepared) continue
      const reader = getEndpointDebugSnapshotReader(
        (prepared as { readonly public?: object }).public ?? (prepared as object)
      )
      if (reader) {
        this.#state.owner.snapshotReader = reader
        break
      }
    }
    if (this.#state.owner.snapshotReader)
      registerEndpointDebugSnapshot(projection, this.#state.owner.snapshotReader)
    this.#state.owner.on = Object.values(this.#state.owner.preparedOutputs)
      .map((prepared) => (prepared as { readonly public?: { readonly on?: unknown } }).public?.on)
      .find(
        (candidate): candidate is (event: string, listener: unknown) => unknown =>
          typeof candidate === 'function'
      )
    const output = Object.freeze(projection)
    return this.#state.owner.context.transformOutput?.('extension', output) ?? output
  }
}

/**
 * One endpoint definition owns projected public keys and references to its original attachment
 * outputs.
 */
class EndpointCapabilitiesOwner {
  /** Definition-local projection facts never leak into another endpoint's capability registration. */
  #state: ReturnType<typeof endpointCapabilitiesState>
  /** The original frozen bridge exposes no authority beyond the canonical PluginHost definition. */
  readonly value: IEndpointCapabilitiesPlugin
  /** Build the genuine native definition and retain its original diagnostic projection callbacks. */
  constructor(
    roots: Readonly<Record<string, IRpcFeature>>,
    context: IEndpointCapabilitiesContext,
    prepareRoots: readonly string[] = [],
    activateRoots: readonly string[] = [],
    sharedRoots: readonly string[] = [],
    publicRoots: ReadonlySet<string> | undefined = undefined
  ) {
    this.#state = endpointCapabilitiesState(
      roots,
      context,
      prepareRoots,
      activateRoots,
      sharedRoots,
      publicRoots
    )
    const definition = definePlugin<
      IRpcPluginCore,
      Record<never, never>,
      never,
      string,
      IFeatureRecord,
      IEndpointCapabilitiesFeatureExpose,
      Record<string, unknown>,
      Record<never, never>
    >(
      'endpoint-capabilities',
      (core) => new EndpointCapabilitiesInstallation(this.#state, core).value,
      Object.freeze({
        ...this.#state.roots,
        ...this.#state.portFeatures.features
      }) as IFeatureRecord
    )
    this.value = Object.freeze({
      definition: definition as IRpcPluginConstraint,
      getPublicKeys: (): readonly string[] => this.#state.publicKeys,
      getSnapshotReader: () => this.#state.snapshotReader,
      getOn: () => this.#state.on,
      getHooks: () => this.#state.hooks,
      /** Transfers endpoint-scoped test fault injection to native discovery's exact disposal owner. */
      propagateDiscoveryCleanupFaults: (faults: IRpcDiscoveryCleanupFaults): void => {
        for (const output of Object.values(this.#state.preparedOutputs)) {
          const target = (output as { readonly cleanupTarget?: unknown }).cleanupTarget
          if (typeof target === 'object' && target !== null)
            registerDiscoveryCleanupFaults(target, faults)
        }
      },
      activate: () => this.#state.activate()
    })
  }
}

/** Build the sole native custom-Feature bridge with explicit definition and installation owners. */
export const createEndpointCapabilitiesPlugin = (
  roots: Readonly<Record<string, IRpcFeature>>,
  context: IEndpointCapabilitiesContext,
  prepareRoots: readonly string[] = [],
  activateRoots: readonly string[] = [],
  sharedRoots: readonly string[] = [],
  publicRoots: ReadonlySet<string> | undefined = undefined
): IEndpointCapabilitiesPlugin =>
  new EndpointCapabilitiesOwner(
    roots,
    context,
    prepareRoots,
    activateRoots,
    sharedRoots,
    publicRoots
  ).value

/**
 * Produces the sole capability Feature plus its WebRPC-only admission metadata. Feature identity,
 * topology, instances, and disposal remain owned by the PluginHost definition returned above.
 */
export const createEndpointCapabilitiesBatchFeature = (
  roots: Readonly<Record<string, IRpcFeature>>,
  context: IEndpointCapabilitiesContext,
  prepareRoots: readonly string[] = [],
  activateRoots: readonly string[] = [],
  sharedRoots: readonly string[] = [],
  publicRoots: ReadonlySet<string> | undefined = undefined
): IEndpointCapabilitiesBatchFeature => {
  const plugin = createEndpointCapabilitiesPlugin(
    roots,
    context,
    prepareRoots,
    activateRoots,
    sharedRoots,
    publicRoots
  )
  const firstPartyEntries = Object.entries(roots)
    .filter(([name]) => name.startsWith('first-party-'))
    .map(([name, feature]) => [name, readFeaturePolicy(feature)] as const)
  const firstPartyPolicies = firstPartyEntries.map(([, policy]) => policy)
  const claims = firstPartyPolicies
    .map((policy) => policy.firstPartyClaims)
    .filter((claim): claim is NonNullable<typeof claim> => claim !== undefined)
  const publicPolicyNames = publicRoots ?? new Set(firstPartyEntries.map(([name]) => name))
  const publicClaims = firstPartyEntries
    .filter(([name]) => publicPolicyNames.has(name))
    .map(([, policy]) => policy.firstPartyClaims)
    .filter((claim): claim is NonNullable<typeof claim> => claim !== undefined)
  return Object.freeze({
    plugin,
    admission: Object.freeze({
      name: plugin.definition.name,
      claims: Object.freeze({
        routes: claims.flatMap((claim) => claim.routes),
        provides: claims.flatMap((claim) => claim.provides),
        consumes: claims.flatMap((claim) => claim.consumes),
        publicKeys: publicClaims.flatMap((claim) => claim.publicKeys),
        exposedKeys: publicClaims.flatMap((claim) => claim.exposedKeys),
        activator: false
      }),
      sharedProvides: getFirstPartyPortNames(roots)
    }),
    firstPartyPolicies: Object.freeze(firstPartyPolicies)
  })
}

/** Returns the stable port Feature names contributed by selected first-party roots. */
function getFirstPartyPortNames(roots: Readonly<Record<string, IRpcFeature>>): readonly string[] {
  return Object.freeze([
    ...(roots['first-party-outbound']
      ? [
          RpcPortName.inboundIdentity,
          RpcPortName.variationCoordinator,
          RpcPortName.outboundOperations
        ]
      : []),
    ...(roots['first-party-discovery'] ? [RpcPortName.discoveryResolver] : []),
    ...(roots['first-party-control'] ? [RpcPortName.candidatePing] : []),
    ...(roots['first-party-provider'] ? [RpcPortName.providerCancellation] : [])
  ])
}
