import { definePlugin, type IFeatureRecord } from '@migaia/plugin-host'
import { WebRpcError, WebRpcErrorCode } from '../errors.js'
import { WebRpcErrorText } from '../error-text.js'
import {
  readFeaturePolicy,
  type IWebRpcClaimAdmission,
  type IWebRpcFeaturePolicy
} from './feature-policy.js'
import { runConstructionInstall } from './construction-install.js'
import type { IWebRpcFeature } from '../feature.js'
import type { IWebRpcPluginConstraint, IWebRpcPluginCore } from './plugin-contract.js'
import type { IRpcFeatureExpose, IWebRpcOutboundCommandObservation } from './feature-contract.js'
import {
  WebRpcPortName,
  type IWebRpcCandidatePingPort,
  type IWebRpcTimePort
} from './plugin-shared-keys.js'
import {
  getEndpointDebugSnapshotReader,
  registerDiscoveryCleanupFaults,
  registerEndpointDebugSnapshot,
  type IWebRpcDiscoveryCleanupFaults
} from './test-observer.js'
import { createWebRpcPortFeatureSet } from './port-feature.js'

/** Read-only endpoint facts supplied to native first-party Features after middleware preparation. */
export type IEndpointCapabilitiesFeatureExpose = IRpcFeatureExpose

/** Named public shape prevents private PluginHost feature-brand details leaking into declarations. */
export type IEndpointCapabilitiesPlugin = Readonly<{
  readonly definition: IWebRpcPluginConstraint
  readonly getPublicKeys: () => readonly string[]
  readonly getSnapshotReader: () => ReturnType<typeof getEndpointDebugSnapshotReader> | undefined
  readonly getOn: () => ((event: string, listener: unknown) => unknown) | undefined
  readonly getHooks: () =>
    | { on(listener: import('../typing.js').IWebRpcHook): () => void }
    | undefined
  readonly propagateDiscoveryCleanupFaults: (faults: IWebRpcDiscoveryCleanupFaults) => void
  readonly activate: () => void
}>

/** One capability Feature definition and its domain admission for the canonical Host batch. */
export type IEndpointCapabilitiesBatchFeature = Readonly<{
  readonly plugin: IEndpointCapabilitiesPlugin
  readonly admission: IWebRpcClaimAdmission | undefined
  readonly firstPartyPolicies: readonly IWebRpcFeaturePolicy[]
}>

/**
 * Composition supplies construction facts and an internal-only output observer for native fault
 * oracles.
 */
type IEndpointCapabilitiesContext = Pick<IRpcFeatureExpose, 'getKernel' | 'getPrepared'> & {
  /** Bounded internal observer receives actual outbound attachment command results. */
  readonly observeOutboundCommand?: (observation: IWebRpcOutboundCommandObservation) => void
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
    prepare: (scope: import('../typing.js').IWebRpcPluginInstallScope) => unknown
  ) => (scope: import('../typing.js').IWebRpcPluginInstallScope) => unknown | Promise<unknown>
}

/** Builds the sole native custom-Feature bridge before endpoint activation. */
export const createEndpointCapabilitiesPlugin = (
  roots: Readonly<Record<string, IWebRpcFeature>>,
  context: IEndpointCapabilitiesContext,
  prepareRoots: readonly string[] = [],
  activateRoots: readonly string[] = [],
  sharedRoots: readonly string[] = [],
  publicRoots: ReadonlySet<string> | undefined = undefined
): IEndpointCapabilitiesPlugin => {
  /** First-party attachments publish these ports as ordinary PluginHost Features. */
  const providedPortNames = getFirstPartyPortNames(roots)
  const portFeatures = createWebRpcPortFeatureSet(providedPortNames)
  /** One installation-owned key snapshot becomes available before the activation Plugin runs. */
  let publicKeys: readonly string[] = Object.freeze([])
  let hooks: { on(listener: import('../typing.js').IWebRpcHook): () => void } | undefined
  /** Installation results supply first-party public surfaces without exposing capability methods. */
  const preparedOutputs: Record<string, unknown> = Object.create(null)
  /** Invokes prepared first-party attachment activation only from the final activation Plugin. */
  let activate = (): void => undefined
  /** Captures the final projected attachment diagnostic without adding a second registry. */
  let snapshotReader: ReturnType<typeof getEndpointDebugSnapshotReader> | undefined
  /** Retains the provider listener owner without widening the public capability projection. */
  let on: ((event: string, listener: unknown) => unknown) | undefined
  const definition = definePlugin<
    IWebRpcPluginCore,
    Record<never, never>,
    never,
    string,
    IFeatureRecord,
    IEndpointCapabilitiesFeatureExpose,
    Record<string, unknown>,
    Record<never, never>
  >(
    'endpoint-capabilities',
    (core) => {
      const portRuntime = portFeatures.createRuntime()
      /**
       * Runs first-party attachment preparation after middleware finalization, never in Feature
       * factories.
       */
      const install = async (): Promise<Record<never, never>> => {
        await runConstructionInstall(
          {
            id: core.id,
            transport: core.transport,
            control: core.construction,
            hooks: core.hooks,
            getPort: (key) => core.getPort(key),
            report: (error) => {
              core.hooks({
                name: 'failure',
                at: core.construction.time.now(),
                localId: core.id,
                code: WebRpcErrorCode.internal,
                error
              })
            },
            registerScope: (_scope, close, awaitClose) => {
              core.onDispose(async () => {
                close()
                await awaitClose()
              })
            }
          },
          async (scope) => {
            for (const name of prepareRoots) {
              const output = core.features[name]
              const prepare = output && (output as { readonly prepare?: unknown }).prepare
              if (typeof prepare !== 'function')
                throw new WebRpcError(
                  WebRpcErrorCode.invalidConfig,
                  WebRpcErrorText.endpointModuleInvalid
                )
              const transformedPrepare = context.transformFeaturePrepare?.(name, prepare) ?? prepare
              preparedOutputs[name] = await transformedPrepare(scope)
              const getHooks = (core.features[name] as { readonly getHooks?: unknown }).getHooks
              if (typeof getHooks === 'function') hooks = getHooks()
            }
            return {}
          }
        )
        const ports = collectFirstPartyPorts()
        portRuntime.publish(ports)
        core.publishPortFeatures(portRuntime.outputs)
        return {}
      }
      activate = (): void => {
        for (const name of activateRoots) {
          const output = core.features[name]
          const activateFeature = output && (output as { readonly activate?: unknown }).activate
          if (typeof activateFeature !== 'function')
            throw new WebRpcError(
              WebRpcErrorCode.invalidConfig,
              WebRpcErrorText.endpointModuleInvalid
            )
          activateFeature()
        }
      }
      /** Collects selected first-party ports before dependent attachments install. */
      const collectFirstPartyPorts = (): Readonly<Record<PropertyKey, unknown>> => {
        const ports: Record<PropertyKey, unknown> = Object.create(null)
        for (const name of sharedRoots) {
          const output = core.features[name]
          const createPorts = output && (output as { readonly ports?: unknown }).ports
          if (typeof createPorts !== 'function')
            throw new WebRpcError(
              WebRpcErrorCode.invalidConfig,
              WebRpcErrorText.endpointModuleInvalid
            )
          const values = createPorts()
          if (!values || typeof values !== 'object')
            throw new WebRpcError(
              WebRpcErrorCode.invalidConfig,
              WebRpcErrorText.endpointModuleInvalid
            )
          for (const key of Reflect.ownKeys(values)) {
            if (key in ports)
              throw new WebRpcError(
                WebRpcErrorCode.capabilityConflict,
                WebRpcErrorText.endpointModuleDuplicated
              )
            const descriptor = Object.getOwnPropertyDescriptor(values, key)
            if (!descriptor || !('value' in descriptor))
              throw new WebRpcError(
                WebRpcErrorCode.invalidConfig,
                WebRpcErrorText.endpointModuleInvalid
              )
            Object.defineProperty(ports, key, descriptor)
          }
        }
        const output = Object.freeze(ports)
        return context.transformOutput?.('ports', output) ?? output
      }
      /** Feature outputs become ready after descriptor creation and before Host publication. */
      const expose = (): Readonly<Record<string, unknown>> => {
        const projection: Record<string, unknown> = Object.create(null)
        for (const [name, output] of Object.entries(core.features)) {
          if (!Object.hasOwn(roots, name)) continue
          if (publicRoots && !publicRoots.has(name)) continue
          const policy = readFeaturePolicy(roots[name]!)
          const prepared = preparedOutputs[name] as { readonly public?: object } | undefined
          const projectionSource = prepared?.public ?? output
          const keys = policy.publicKeys ?? Object.keys(projectionSource)
          for (const key of keys) {
            const descriptor = Object.getOwnPropertyDescriptor(projectionSource, key)
            if (!descriptor || !('value' in descriptor))
              throw new WebRpcError(
                WebRpcErrorCode.invalidConfig,
                WebRpcErrorText.endpointModuleInvalid
              )
            if (key in projection)
              throw new WebRpcError(
                WebRpcErrorCode.capabilityConflict,
                WebRpcErrorText.endpointModuleDuplicated
              )
            Object.defineProperty(projection, key, {
              configurable: false,
              enumerable: true,
              value: descriptor.value,
              writable: false
            })
          }
        }
        publicKeys = Object.freeze(Object.keys(projection))
        const preferredSnapshotOutputs = [
          preparedOutputs['first-party-discovery'],
          preparedOutputs['first-party-provider'],
          preparedOutputs['first-party-outbound']
        ]
        snapshotReader = undefined
        for (const prepared of preferredSnapshotOutputs) {
          if (!prepared) continue
          const reader = getEndpointDebugSnapshotReader(
            (prepared as { readonly public?: object }).public ?? (prepared as object)
          )
          if (reader) {
            snapshotReader = reader
            break
          }
        }
        if (snapshotReader) registerEndpointDebugSnapshot(projection, snapshotReader)
        on = Object.values(preparedOutputs)
          .map(
            (prepared) => (prepared as { readonly public?: { readonly on?: unknown } }).public?.on
          )
          .find(
            (candidate): candidate is (event: string, listener: unknown) => unknown =>
              typeof candidate === 'function'
          )
        const output = Object.freeze(projection)
        return context.transformOutput?.('extension', output) ?? output
      }
      return Object.freeze({
        install,
        expose,
        featureExpose: () =>
          Object.freeze({
            ...portRuntime.expose,
            getKernel: context.getKernel,
            getPrepared: context.getPrepared,
            getTime: () => core.getPort(WebRpcPortName.time) as IWebRpcTimePort,
            getCandidatePing: () =>
              core.getPort(WebRpcPortName.candidatePing) as IWebRpcCandidatePingPort | undefined,
            ...(context.observeOutboundCommand
              ? { observeOutboundCommand: context.observeOutboundCommand }
              : {})
          })
      })
    },
    Object.freeze({ ...roots, ...portFeatures.features }) as IFeatureRecord
  )
  return Object.freeze({
    definition: definition as IWebRpcPluginConstraint,
    getPublicKeys: (): readonly string[] => publicKeys,
    getSnapshotReader: () => snapshotReader,
    getOn: () => on,
    getHooks: () => hooks,
    /** Transfers endpoint-scoped test fault injection to native discovery's exact disposal owner. */
    propagateDiscoveryCleanupFaults: (faults: IWebRpcDiscoveryCleanupFaults): void => {
      for (const output of Object.values(preparedOutputs)) {
        const target = (output as { readonly cleanupTarget?: unknown }).cleanupTarget
        if (typeof target === 'object' && target !== null)
          registerDiscoveryCleanupFaults(target, faults)
      }
    },
    activate: () => activate()
  })
}

/**
 * Produces the sole capability Feature plus its WebRPC-only admission metadata. Feature identity,
 * topology, instances, and disposal remain owned by the PluginHost definition returned above.
 */
export const createEndpointCapabilitiesBatchFeature = (
  roots: Readonly<Record<string, IWebRpcFeature>>,
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
function getFirstPartyPortNames(
  roots: Readonly<Record<string, IWebRpcFeature>>
): readonly string[] {
  return Object.freeze([
    ...(roots['first-party-outbound']
      ? [
          WebRpcPortName.inboundIdentity,
          WebRpcPortName.variationCoordinator,
          WebRpcPortName.outboundOperations
        ]
      : []),
    ...(roots['first-party-discovery'] ? [WebRpcPortName.discoveryResolver] : []),
    ...(roots['first-party-control'] ? [WebRpcPortName.candidatePing] : []),
    ...(roots['first-party-provider'] ? [WebRpcPortName.providerCancellation] : [])
  ])
}
