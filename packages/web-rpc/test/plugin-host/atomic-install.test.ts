import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { createMemoryTransportPair } from '../../src/adapters/memory.js'
import { rpcProtocolV1 } from '@migaia/rpc-contract'
import { createStringFramer } from '@migaia/rpc-contract/framing'
import { defineJsonCodec } from '@migaia/serialize/codecs/json'
import { createComposedEndpoint, type IWebRpcCoreConfig } from '../../src/core.js'
import { createClientEndpoint } from '../../src/client.js'
import { createEndpoint } from '../../src/index.js'
import { defineMiddleware } from '../../src/middleware.js'
import { abort } from '../../src/middleware/abort.js'
import { authentication } from '../../src/middleware/authentication.js'
import { codec } from '../../src/middleware/codec.js'
import { connect } from '../../src/middleware/connect.js'
import { contract } from '../../src/middleware/contract.js'
import { hooks } from '../../src/middleware/hooks.js'
import { ping } from '../../src/middleware/ping.js'
import { canonicalProtocol as protocol } from '../../src/middleware/canonical-protocol.js'
import { timeout } from '../../src/middleware/timeout.js'
import { uuid } from '../../src/middleware/uuid.js'
import { createProviderEndpoint } from '../../src/provider.js'
import { createClientFirstPartyRoots } from '../../src/internal/client-first-party-roots.js'
import { createProviderFirstPartyRoots } from '../../src/internal/provider-first-party-roots.js'
import {
  createFirstPartyRoots,
  type IWebRpcFirstPartyRootName
} from '../../src/internal/first-party-roots.js'
import type { IWebRpcPluginConstraint } from '../../src/internal/plugin-contract.js'
import type {
  IWebRpcAbortSignal,
  IWebRpcHookEvent,
  IWebRpcAuthenticationCapability,
  IWebRpcConnectCapability,
  IWebRpcPlugin,
  IWebRpcPluginInstallScope,
  IWebRpcPluginInstallResult,
  IWebRpcEndpoint,
  IWebRpcProvider
} from '../../src/typing.js'
import {
  createWebRpcPluginHost,
  type IWebRpcPluginHost
} from '../../src/internal/web-rpc-plugin-host.js'
import { definePlugin } from '@migaia/plugin-host'
import {
  createConstructionControl,
  runConstructionInstall
} from '../../src/internal/construction-install.js'
import { createEndpointKernel } from '../../src/endpoint-kernel.js'
import {
  prepareEndpoint,
  type IDeferredPreparedEndpoint,
  type IPreparedEndpoint
} from '../../src/internal/endpoint-bootstrap.js'
import {
  buildNativePluginBatch,
  type IWebRpcNativeFeatureDefinition,
  type IWebRpcComposedRuntimeState,
  type IWebRpcPluginRole
} from '../../src/internal/plugin-inventory.js'
import { createEndpointCapabilitiesBatchFeature } from '../../src/internal/endpoint-capabilities-plugin.js'
import { assertPluginInstallResult } from '../../src/internal/plugin-descriptor.js'
import type { IWebRpcPluginDescriptor } from '../../src/internal/plugin-descriptor.js'
import {
  assertFeatureClaimParity,
  preflightFeatureClaims,
  type IWebRpcClaimAdmission
} from '../../src/internal/feature-policy.js'
import type { IWebRpcPluginClaims } from '../../src/typing.js'
import {
  WebRpcSharedKey,
  WebRpcPingEnablePortShape,
  type IWebRpcContractPort
} from '../../src/internal/plugin-shared-keys.js'
import { WebRpcOutboundAttachment } from '../../src/internal/outbound-attachment.js'
import { WebRpcFirstPartyRoleSchema } from '../../src/internal/plugin-contract.js'
import {
  WEBRPC_SOURCE,
  WebRpcConfigurationError,
  WebRpcError,
  WebRpcErrorCode,
  WebRpcLifecycleError
} from '../../src/errors.js'
import { WebRpcErrorText } from '../../src/error-text.js'
import {
  readEndpointDebugSnapshot,
  registerDiscoveryCleanupFaults,
  type IWebRpcDiscoveryCleanupFaults
} from '../../src/internal/test-observer.js'
import { readComposedDisposalPromises } from '../../src/internal/composed-disposal-observer.js'

const abortTransportKey = WebRpcSharedKey.providerCancellation
const plannedAbortEnablementKey = WebRpcSharedKey.abort

/** Formats a PropertyKey without claiming object identity for symbols in a message contract. */
function stablePropertyKeyDescription(key: PropertyKey): string {
  return typeof key === 'symbol' ? `symbol:${key.description ?? '<anonymous>'}` : `string:${key}`
}

/** Reads the runtime-projected sender from a statically selected client root. */
function readProjectedSend(endpoint: object): IWebRpcEndpoint['send'] {
  const send = Reflect.get(endpoint, 'send')
  expect(typeof send).toBe('function')
  return send as IWebRpcEndpoint['send']
}

/** Builds the canonical first-party role-admission message expected by the RED contract. */
function roleAdmissionMessage(role: string, slot: string, key: PropertyKey | undefined): string {
  return `${WebRpcErrorText.endpointModuleInvalid}; role=${role}; slot=${slot}; key=${
    key === undefined ? 'unavailable' : stablePropertyKeyDescription(key)
  }`
}

const emptyClaims: IWebRpcPluginClaims = {
  routes: [],
  provides: [],
  consumes: [],
  publicKeys: [],
  exposedKeys: [],
  activator: false
}

function descriptor(
  name: string,
  claims: IWebRpcPluginClaims,
  options: {
    readonly sharedProvides?: readonly PropertyKey[]
    readonly sharedConsumes?: readonly PropertyKey[]
    readonly install?: IWebRpcPluginDescriptor['install']
  } = {}
): IWebRpcPluginDescriptor {
  return {
    name,
    claims,
    sharedProvides: options.sharedProvides,
    sharedConsumes: options.sharedConsumes,
    install: options.install ?? (async () => ({}))
  }
}

function composedConfig(
  transport: IWebRpcCoreConfig['transport'],
  middlewares: readonly IWebRpcPlugin[]
): IWebRpcCoreConfig {
  return { id: `b12a-atomic-${Math.random()}`, transport, middlewares }
}

type IProductionBatch = {
  readonly host: IWebRpcPluginHost
  readonly kernel: ReturnType<typeof createEndpointKernel>
  /** Fixture transport used to verify the kernel retains the production transport owner. */
  readonly transport: IWebRpcCoreConfig['transport']
  readonly construction: ReturnType<typeof createConstructionControl>
  /** Host-owned early-construction diagnostics, replayed only after middleware finalization. */
  readonly hookEvents: readonly IWebRpcHookEvent[]
  readonly inventory: readonly IProductionNativeEntry[]
  readonly descriptors: readonly IWebRpcPluginDescriptor[]
  /** Native admission records are the sole pre-install policy input. */
  readonly admissions: readonly IWebRpcClaimAdmission[]
  readonly claims: readonly IWebRpcPluginClaims[]
  readonly translated: readonly IWebRpcTranslatedPlugin[]
  readonly getPrepared: () => IPreparedEndpoint<string> | undefined
  readonly getRuntimeState: () => IWebRpcComposedRuntimeState | undefined
  /** Reaches the prepared discovery surface's owned cleanup fault observer. */
  readonly propagateDiscoveryCleanupFaults: (faults: IWebRpcDiscoveryCleanupFaults) => void
  readonly stats: {
    activeSubscriptions: number
    subscribeCalls: number
    dispatches: number
    closeCalls: number
  }
  readonly isActivated: () => boolean
}

/** Metadata-only fixture view of one current native batch entry; it is not a legacy runtime path. */
type IProductionNativeEntry = Readonly<{
  readonly role: IWebRpcPluginRole
  /** Test metadata preserves prior assertions while runtime always originates from native entries. */
  readonly descriptor: IWebRpcPluginDescriptor
}>

/** Test-only output observation; native production definitions never expose translator output. */
type IWebRpcPluginRuntimeOutput = Readonly<Record<PropertyKey, unknown>>
type IWebRpcPluginRuntimeOutputPhase = 'extension' | 'shared'
type IWebRpcTranslatedPlugin = Readonly<{ readonly definition: IWebRpcPluginConstraint }>

type IProductionLifecycleTraceEntry = {
  readonly kind: string
  readonly instance: unknown
}

type IProductionBatchOptions = {
  readonly providers?: Readonly<Record<string, IWebRpcProvider>>
  readonly protocolMiddleware?: IWebRpcPlugin
  readonly codecMiddleware?: IWebRpcPlugin
  readonly contractMiddleware?: IWebRpcPlugin
  readonly authenticationMiddleware?: IWebRpcPlugin
  readonly connectMiddleware?: IWebRpcPlugin
  readonly abortMiddleware?: IWebRpcPlugin
  readonly timeoutMiddleware?: IWebRpcPlugin
  readonly hooksMiddleware?: IWebRpcPlugin
  readonly pingMiddleware?: IWebRpcPlugin
  readonly uuidMiddleware?: IWebRpcPlugin
  readonly framer?: IWebRpcCoreConfig['framer']
  readonly omitProtocol?: boolean
  readonly omitContract?: boolean
  readonly omitAuthentication?: boolean
  readonly omitConnect?: boolean
  readonly omitPing?: boolean
  readonly omitAbort?: boolean
  readonly omitTimeout?: boolean
  readonly transportOwnership?: 'owned' | 'borrowed'
  readonly transportCloseError?: Error
  readonly construction?: IWebRpcCoreConfig['construction']
  readonly lifecycleTrace?: IProductionLifecycleTraceEntry[]
  readonly injectInstall?: (
    role: IWebRpcPluginRole,
    install: IWebRpcPluginDescriptor['install']
  ) => IWebRpcPluginDescriptor['install']
  /** Only intentionally pending fault bodies opt into the existing construction gate. */
  readonly injectConstructionGate?: (role: IWebRpcPluginRole) => boolean
  readonly injectRuntimeOutput?: (
    role: IWebRpcPluginRole,
    phase: IWebRpcPluginRuntimeOutputPhase,
    output: IWebRpcPluginRuntimeOutput
  ) => IWebRpcPluginRuntimeOutput
  readonly injectRuntimeState?: (
    role: IWebRpcPluginRole,
    state: IWebRpcComposedRuntimeState
  ) => IWebRpcComposedRuntimeState | Promise<IWebRpcComposedRuntimeState>
  readonly injectDescriptor?: (
    role: IWebRpcPluginRole,
    descriptor: IWebRpcPluginDescriptor
  ) => IWebRpcPluginDescriptor
  readonly additionalDescriptors?: readonly IWebRpcPluginDescriptor[]
  /** Extra definitions join the production Host transaction for native lifecycle fault rows. */
  readonly additionalNativeFeatures?: readonly IWebRpcNativeFeatureDefinition[]
  readonly skipPreflight?: boolean
  readonly report?: (error: unknown) => void
  readonly onInstalled?: (installation: unknown) => void
  readonly onTransferredCleanup?: (pluginName: string) => void
  /** Observes the actual native activation port after finalization and before ingress commits. */
  readonly onActivationPreflight?: (
    state: IWebRpcComposedRuntimeState,
    getShared: (key: PropertyKey) => unknown
  ) => void
}

let productionBatchId = 0

function sameRole(left: IWebRpcPluginRole, right: IWebRpcPluginRole): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function productionMiddleware(
  transport: IWebRpcCoreConfig['transport'],
  protocolMiddleware: IWebRpcPlugin | null | undefined = protocol(),
  codecMiddleware: IWebRpcPlugin | null | undefined = codec(defineJsonCodec({ version: 1 })),
  contractMiddleware: IWebRpcPlugin | null | undefined = contract(),
  authenticationMiddleware: IWebRpcPlugin | null | undefined = authentication({
    encrypt: (value) => value,
    decrypt: (value) => value
  }),
  connectMiddleware: IWebRpcPlugin | null | undefined = connect({ transport }),
  abortMiddleware: IWebRpcPlugin | null | undefined = abort(),
  timeoutMiddleware: IWebRpcPlugin | null | undefined = timeout(),
  hooksMiddleware: IWebRpcPlugin | null | undefined = hooks(),
  pingMiddleware: IWebRpcPlugin | null | undefined = ping(),
  uuidMiddleware: IWebRpcPlugin | null | undefined = uuid()
): readonly IWebRpcPlugin[] {
  return [
    protocolMiddleware,
    codecMiddleware,
    authenticationMiddleware,
    contractMiddleware,
    connectMiddleware,
    uuidMiddleware,
    pingMiddleware,
    abortMiddleware,
    timeoutMiddleware,
    hooksMiddleware
  ].filter((middleware): middleware is IWebRpcPlugin => middleware != null)
}

async function createProductionBatch(
  optionsOrInject?: IProductionBatchOptions | IProductionBatchOptions['injectInstall']
): Promise<IProductionBatch> {
  const options: IProductionBatchOptions =
    typeof optionsOrInject === 'function'
      ? { injectInstall: optionsOrInject }
      : (optionsOrInject ?? {})
  const [baseTransport] = createMemoryTransportPair()
  const stats = { activeSubscriptions: 0, subscribeCalls: 0, dispatches: 0, closeCalls: 0 }
  const trace = options.lifecycleTrace
  const close = (): void => {
    stats.closeCalls += 1
    trace?.push({ kind: 'transport.close', instance: close })
    if (options.transportCloseError) throw options.transportCloseError
    baseTransport.close?.()
  }
  const transport = {
    ...baseTransport,
    ownership: options.transportOwnership,
    send: (message: unknown) => {
      stats.dispatches += 1
      baseTransport.send(message)
    },
    close,
    subscribe: (listener: Parameters<typeof baseTransport.subscribe>[0]) => {
      stats.subscribeCalls += 1
      stats.activeSubscriptions += 1
      const unsubscribe = baseTransport.subscribe(listener)
      const tracedUnsubscribe = () => {
        trace?.push({ kind: 'unsubscribe', instance: tracedUnsubscribe })
        stats.activeSubscriptions -= 1
        unsubscribe()
      }
      return tracedUnsubscribe
    }
  }
  const config: IWebRpcCoreConfig = {
    id: `b12a-production-${productionBatchId++}`,
    transport,
    provider: options.providers,
    construction: options.construction,
    framer: options.framer ?? (createStringFramer() as unknown as IWebRpcCoreConfig['framer']),
    middlewares: productionMiddleware(
      transport,
      options.omitProtocol ? null : options.protocolMiddleware,
      options.codecMiddleware ?? codec(defineJsonCodec({ version: 1 })),
      options.omitContract ? null : options.contractMiddleware,
      options.omitAuthentication ? null : options.authenticationMiddleware,
      options.omitConnect ? null : options.connectMiddleware,
      options.omitAbort ? null : (options.abortMiddleware ?? abort()),
      options.omitTimeout ? null : (options.timeoutMiddleware ?? timeout()),
      options.hooksMiddleware ?? hooks(),
      options.omitPing ? null : (options.pingMiddleware ?? ping()),
      options.uuidMiddleware ?? uuid()
    )
  }
  /** The fixture exercises the same native root record and capability Feature as production. */
  const roots = createFirstPartyRoots(
    new Set([
      'first-party-outbound',
      'first-party-provider',
      'first-party-discovery',
      'first-party-control',
      'first-party-chunk'
    ] satisfies readonly IWebRpcFirstPartyRootName[])
  )
  const deferred = (await prepareEndpoint(config, {
    deferMiddlewareInstall: true
  })) as IDeferredPreparedEndpoint<string>
  /** Match core: retain bootstrap's validated transport-method snapshot for the native kernel. */
  const rawKernel = createEndpointKernel(deferred.transport, deferred.transportSnapshot)
  let kernel = rawKernel
  if (trace) {
    const observedKernel = new Proxy(rawKernel, {
      get: (target, key) => {
        if (key === 'completeDispose')
          return () => {
            trace.push({ kind: 'kernel.completeDispose', instance: observedKernel })
            target.completeDispose()
          }
        const member = Reflect.get(target, key, target)
        if (typeof member !== 'function') return member
        return (...args: readonly unknown[]) =>
          (target as unknown as Record<PropertyKey, (...values: readonly unknown[]) => unknown>)[
            key
          ](...args)
      }
    })
    kernel = observedKernel
  }
  const construction = createConstructionControl({
    signal: (options.construction?.signal ?? new AbortController().signal) as IWebRpcAbortSignal,
    timeoutMs: options.construction?.timeoutMs
  })
  const hookEvents: IWebRpcHookEvent[] = []
  const host = createWebRpcPluginHost(
    deferred.id,
    deferred.transport,
    construction,
    (event: IWebRpcHookEvent) => hookEvents.push(event),
    { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
  )
  let prepared: IPreparedEndpoint<string> | undefined
  let activated = false
  let runtimeState: IWebRpcComposedRuntimeState | undefined
  let activationPreflight:
    | ((state: IWebRpcComposedRuntimeState, getShared: (key: PropertyKey) => unknown) => void)
    | undefined
  const capabilityBatch = createEndpointCapabilitiesBatchFeature(
    roots,
    Object.freeze({
      getKernel: () => kernel,
      getPrepared: () => {
        if (!prepared) throw new Error('production batch prepared endpoint missing')
        return prepared
      },
      transformOutput: options.injectRuntimeOutput
        ? (phase, output) =>
            options.injectRuntimeOutput!(
              { kind: 'feature', index: 0, key: 'endpoint-capabilities' },
              phase,
              output as IWebRpcPluginRuntimeOutput
            )
        : undefined,
      transformFeaturePrepare: (name, prepare) =>
        options.injectInstall?.({ kind: 'feature', index: 0, key: name }, prepare) ?? prepare
    }),
    Object.keys(roots).filter((name) => name.startsWith('first-party-')),
    'first-party-outbound' in roots ? ['first-party-outbound'] : [],
    Object.keys(roots).filter((name) =>
      [
        'first-party-outbound',
        'first-party-discovery',
        'first-party-control',
        'first-party-provider'
      ].includes(name)
    ),
    new Set(Object.keys(roots))
  )
  /**
   * Native feature definitions stay one typed Host batch; fault injection never creates a side
   * registry.
   */
  const featureDefinitions: readonly IWebRpcNativeFeatureDefinition[] = capabilityBatch.admission
    ? [
        {
          key: capabilityBatch.plugin.definition.name,
          definition: capabilityBatch.plugin.definition,
          admission: capabilityBatch.admission
        },
        ...(options.additionalNativeFeatures ?? [])
      ]
    : []
  const nativeBatch = buildNativePluginBatch({
    kernel,
    deferred,
    middlewareSnapshots: deferred.middlewareSnapshots,
    hookEvents,
    onPrepared: (value) => {
      prepared = value
    },
    onActivationCommitted: () => {
      activated = true
    },
    onActivationRolledBack: () => {
      activated = false
    },
    onNativeFeatureActivate: () => capabilityBatch.plugin.activate(),
    onActivationPreflight: async (state, getShared) => {
      const observed = options.injectRuntimeState
        ? await options.injectRuntimeState({ kind: 'activation' }, state)
        : state
      runtimeState = observed
      return activationPreflight?.(observed, getShared)
    },
    transformMiddlewareInstall: (role, install) =>
      options.injectInstall?.(role, install) ?? install,
    /**
     * Fault injection replaces the real native definition install directly; it never rebuilds a
     * descriptor.
     */
    transformDefinition: (role, definition) => {
      if (role.kind === 'middleware') return definition
      let activeCore: Parameters<typeof definition.install>[0] | undefined
      const originalInstall: IWebRpcPluginDescriptor['install'] = async () => {
        if (!activeCore) throw new Error('native injection core unavailable')
        return definition.install(activeCore)
      }
      const install = options.injectInstall?.(role, originalInstall)
      /** A pass-through keeps definePlugin's opaque identity and descriptor factory intact. */
      return install === undefined || install === originalInstall
        ? definition
        : Object.freeze({
            ...definition,
            install: async (core): Promise<Record<string, unknown>> => {
              activeCore = core
              const scope: IWebRpcPluginInstallScope = {
                id: core.id,
                transport: core.transport,
                signal: core.signal,
                hooks: core.hooks,
                getShared: core.getShared,
                own: (resource, release) => {
                  core.onDispose(release)
                  return resource
                }
              }
              const result = options.injectConstructionGate?.(role)
                ? await runConstructionInstall(
                    {
                      id: core.id,
                      transport: core.transport,
                      control: core.construction,
                      hooks: core.hooks,
                      getShared: core.getShared,
                      registerScope: (_scope, close, awaitClose) => {
                        core.onDispose(async () => {
                          close()
                          await awaitClose()
                        })
                      }
                    },
                    () => install(scope)
                  )
                : await install(scope)
              if (result === null || typeof result !== 'object')
                throw new WebRpcError(
                  WebRpcErrorCode.invalidConfig,
                  WebRpcErrorText.endpointModuleInvalid
                )
              const disposer =
                result !== null && typeof result === 'object'
                  ? Object.getOwnPropertyDescriptor(result, 'dispose')?.value
                  : undefined
              if (typeof disposer === 'function') core.onDispose(() => disposer())
              const output: Record<string, unknown> = { ...result }
              delete output.dispose
              return output
            }
          })
    },
    featureDefinitions
  })
  /** Compatibility-shaped observations point at the native definition; no legacy translation runs. */
  const inventory = nativeBatch.map(({ role, definition, admission }) => ({
    role,
    descriptor: {
      ...definition,
      claims: admission.claims,
      ...(admission.sharedProvides === undefined
        ? {}
        : { sharedProvides: admission.sharedProvides }),
      ...(admission.sharedConsumes === undefined
        ? {}
        : { sharedConsumes: admission.sharedConsumes }),
      ...(admission.sharedOptionalConsumes === undefined
        ? {}
        : { sharedOptionalConsumes: admission.sharedOptionalConsumes })
    }
  })) as unknown as readonly IProductionNativeEntry[]
  const descriptors = nativeBatch.map(({ definition, admission }) =>
    Object.freeze({
      ...definition,
      claims: admission.claims,
      ...(admission.sharedProvides === undefined
        ? {}
        : { sharedProvides: admission.sharedProvides }),
      ...(admission.sharedConsumes === undefined
        ? {}
        : { sharedConsumes: admission.sharedConsumes }),
      ...(admission.sharedOptionalConsumes === undefined
        ? {}
        : { sharedOptionalConsumes: admission.sharedOptionalConsumes })
    })
  ) as unknown as IWebRpcPluginDescriptor[]
  const claims = nativeBatch.map(({ admission }) => admission.claims)
  const translated = nativeBatch.map(({ definition }) => ({
    definition
  })) as IWebRpcTranslatedPlugin[]
  if (!options.skipPreflight) {
    try {
      preflightFeatureClaims(nativeBatch.map(({ admission }) => admission))
    } catch (error) {
      if (!options.omitConnect) throw error
    }
  }
  activationPreflight = options.onActivationPreflight
  return {
    host,
    kernel,
    transport,
    construction,
    hookEvents,
    inventory,
    descriptors,
    admissions: nativeBatch.map(({ admission }) => admission),
    claims,
    translated,
    getPrepared: () => prepared,
    getRuntimeState: () => runtimeState,
    propagateDiscoveryCleanupFaults: capabilityBatch.plugin.propagateDiscoveryCleanupFaults,
    stats,
    isActivated: () => activated
  }
}

/** Captures only public Host/lifecycle dimensions used by no-mutation RED rows. */
function productionHostSnapshot(batch: IProductionBatch): Readonly<{
  readonly hostKeys: readonly PropertyKey[]
  readonly shared: readonly unknown[]
  readonly extensions: readonly (PropertyDescriptor | undefined)[]
  readonly installations: readonly {
    readonly installed: boolean
    readonly extensionKeys: readonly PropertyKey[]
    readonly sharedKeys: readonly PropertyKey[]
  }[]
  readonly stats: Readonly<{
    readonly activeSubscriptions: number
    readonly subscribeCalls: number
    readonly dispatches: number
  }>
  readonly activated: boolean
  readonly kernelState: string
}> {
  const keys = [
    WebRpcSharedKey.hooks,
    WebRpcSharedKey.ping,
    WebRpcSharedKey.uuid,
    WebRpcSharedKey.outboundAttachment
  ] as const
  return {
    hostKeys: Reflect.ownKeys(batch.host),
    shared: keys.map((key) => batch.host.getShared(key)),
    extensions: batch.descriptors
      .flatMap(({ claims }) => claims.publicKeys)
      .map((key) => Object.getOwnPropertyDescriptor(batch.host, key)),
    installations: batch.admissions.map((admission) => {
      const extensionKeys = admission.claims.publicKeys
      const sharedKeys = admission.sharedProvides ?? []
      return {
        installed: batch.isActivated(),
        extensionKeys,
        sharedKeys
      }
    }),
    stats: {
      activeSubscriptions: batch.stats.activeSubscriptions,
      subscribeCalls: batch.stats.subscribeCalls,
      dispatches: batch.stats.dispatches
    },
    activated: batch.isActivated(),
    kernelState: batch.kernel.state
  }
}

type IProductionResidueSnapshot = Readonly<{
  readonly shared: readonly { readonly key: PropertyKey; readonly value: unknown }[]
  readonly extensions: readonly {
    readonly key: PropertyKey
    readonly descriptor: PropertyDescriptor | undefined
  }[]
  readonly installations: readonly {
    readonly name: string
    readonly installed: boolean
    readonly extensionKeys: readonly PropertyKey[]
    readonly sharedKeys: readonly PropertyKey[]
    readonly expectedSharedKeys: readonly PropertyKey[]
    readonly actualSharedKeys: readonly PropertyKey[]
  }[]
  readonly activeSubscriptions: number
  readonly subscribeCalls: number
  readonly dispatches: number
  readonly activated: boolean
  readonly kernelState: string
  readonly kernelOwners: readonly string[]
  readonly kernelRoutes: readonly string[]
  readonly ownedResources: number
}>

/** Captures terminal-safe public Host, translator, activation, and kernel residue dimensions. */
function productionResidueSnapshot(batch: IProductionBatch): IProductionResidueSnapshot {
  const readShared = (key: PropertyKey): unknown => {
    try {
      return batch.host.getShared(key)
    } catch {
      return undefined
    }
  }
  const shared = Object.values(WebRpcSharedKey).map((key) => ({
    key,
    value: readShared(key)
  }))
  const extensionKeys = [...new Set(batch.descriptors.flatMap(({ claims }) => claims.publicKeys))]
  const extensions = extensionKeys.map((key) => ({
    key,
    descriptor: Object.getOwnPropertyDescriptor(batch.host, key)
  }))
  const installations = batch.admissions.map((admission, index) => {
    const extensionKeys = admission.claims.publicKeys
    const sharedKeys = admission.sharedProvides ?? []
    return {
      name: admission.name ?? batch.descriptors[index]?.name ?? `native:${index}`,
      installed: batch.isActivated(),
      extensionKeys,
      sharedKeys,
      expectedSharedKeys: sharedKeys,
      actualSharedKeys: sharedKeys.filter((key) => readShared(key) !== undefined)
    }
  })
  return {
    shared,
    extensions,
    installations,
    activeSubscriptions: batch.stats.activeSubscriptions,
    subscribeCalls: batch.stats.subscribeCalls,
    dispatches: batch.stats.dispatches,
    activated: batch.isActivated(),
    kernelState: batch.kernel.state,
    kernelOwners: batch.kernel.ownerKeys,
    kernelRoutes: batch.kernel.routeKeys,
    ownedResources: batch.kernel.resources.size
  }
}

/** Asserts that one terminal Host transaction left no package-owned lifecycle residue. */
function expectTerminalResidue(snapshot: IProductionResidueSnapshot): void {
  expect(snapshot.shared.every(({ value }) => value === undefined)).toBe(true)
  expect(snapshot.extensions.every(({ descriptor }) => descriptor === undefined)).toBe(true)
  expect(snapshot.activeSubscriptions).toBe(0)
  expect(snapshot.kernelState).toBe('disposed')
  expect(snapshot.kernelOwners).toEqual([])
  expect(snapshot.kernelRoutes).toEqual([])
  expect(snapshot.ownedResources).toBe(0)
}

const plannedB12b04Keys = {
  hooks: WebRpcSharedKey.hooks,
  ping: WebRpcSharedKey.ping,
  uuid: WebRpcSharedKey.uuid
} as const

function errorChainContains(failure: unknown, expected: unknown): boolean {
  const pending = [failure]
  const visited = new Set<unknown>()
  while (pending.length > 0) {
    const current = pending.shift()
    if (current === expected) return true
    if (!current || (typeof current !== 'object' && typeof current !== 'function')) continue
    if (visited.has(current)) continue
    visited.add(current)
    const value = current as {
      readonly cause?: unknown
      readonly errors?: readonly unknown[]
      readonly cleanupErrors?: readonly { readonly error: unknown }[]
      readonly detail?: { readonly rollbackErrors?: readonly unknown[] }
    }
    if (value.cause !== undefined) pending.push(value.cause)
    if (value.errors) pending.push(...value.errors)
    if (value.cleanupErrors) pending.push(...value.cleanupErrors.map(({ error }) => error))
    if (value.detail?.rollbackErrors) pending.push(...value.detail.rollbackErrors)
  }
  return false
}

async function expectRuntimeParityFailure(
  options: IProductionBatchOptions,
  primary: Error
): Promise<void> {
  const rollback = new Error('runtime parity rollback')
  let batch!: IProductionBatch
  batch = await createProductionBatch({
    ...options,
    injectInstall: (role, install) => {
      const admitted = options.injectInstall?.(role, install) ?? install
      if (role.kind !== 'middleware' || role.index !== 0) return admitted
      return async (scope) => ({
        ...((await admitted(scope)) as object),
        dispose: () => {
          throw rollback
        }
      })
    },
    onActivationPreflight: (state) => {
      try {
        assertFeatureClaimParity(batch.admissions, batch.host, batch.kernel, {
          activated: state.activated,
          activationPhase: 'pre-activation',
          routeKeys: state.routeKeys
        })
      } catch {
        throw primary
      }
    }
  })
  let failure: unknown
  let sharedAfterFailure: readonly unknown[] = []
  try {
    const installed = await batch.host.installBatch(
      batch.translated.map(({ definition }) => definition)
    )
    try {
      assertFeatureClaimParity(batch.admissions, installed, batch.kernel, {
        activated: batch.isActivated(),
        routeKeys: batch.getRuntimeState()?.routeKeys
      })
    } catch {
      throw primary
    }
  } catch (error) {
    failure = error
    sharedAfterFailure = [
      batch.host.getShared(WebRpcSharedKey.outboundOperations),
      batch.host.getShared(WebRpcSharedKey.outboundAttachment)
    ]
  } finally {
    await batch.host.dispose()
  }
  expect(
    errorChainContains(failure, primary),
    `runtime mismatch failure: ${String((failure as { readonly cause?: { readonly message?: unknown } })?.cause?.message)}`
  ).toBe(true)
  expect(failure).toMatchObject({
    code: 'PLUGIN_INSTALL_FAILED',
    cause: primary,
    detail: { failedName: 'activation' }
  })
  const rollbackErrors = (
    failure as { readonly detail?: { readonly rollbackErrors?: readonly unknown[] } }
  ).detail?.rollbackErrors
  const rollbackIdentities = (rollbackErrors ?? []).flatMap((error) =>
    error instanceof AggregateError ? [...error.errors] : [error]
  )
  expect(
    rollbackIdentities.some((error) => error === rollback || errorChainContains(error, rollback))
  ).toBe(true)
  expect(batch.stats.subscribeCalls).toBe(0)
  expect(batch.stats.activeSubscriptions).toBe(0)
  expect(batch.stats.dispatches).toBe(0)
  expect(batch.kernel.state).toBe('disposed')
  expect(sharedAfterFailure.every((value) => value === undefined)).toBe(true)
}

describe('B12a atomic middleware and claim contracts', () => {
  it.each([
    ['null', null],
    ['primitive', 0]
  ] as const)(
    'rejects injected native activation %s output through the existing Host rollback path',
    async (_label, invalidOutput) => {
      const batch = await createProductionBatch({
        injectInstall: (role, install) =>
          role.kind === 'activation'
            ? async () => invalidOutput as unknown as IWebRpcPluginInstallResult
            : install
      })
      const failure = await batch.host
        .installBatch(batch.translated.map(({ definition }) => definition))
        .catch((error: unknown) => error)
      expect(failure).toMatchObject({
        code: 'PLUGIN_INSTALL_FAILED',
        cause: {
          source: WEBRPC_SOURCE,
          code: WebRpcErrorCode.invalidConfig,
          message: WebRpcErrorText.endpointModuleInvalid
        }
      })
      expect(batch.stats.activeSubscriptions).toBe(0)
      expect(batch.kernel.state).toBe('disposed')
      await batch.host.dispose()
    }
  )

  it('YS31 publishes dynamic native middleware keys before activation', async () => {
    const [transport] = createMemoryTransportPair()
    let descriptors = 0
    const middleware = defineMiddleware('ys31-native', () => {
      descriptors += 1
      return {
        expose: () => ({ nativeMiddleware: () => 'ready' })
      }
    })
    const endpoint = await createEndpoint({
      id: 'ys31-native',
      transport,
      middlewares: [connect({ transport }), middleware] as const
    })
    expect(descriptors).toBe(1)
    expect((endpoint as { nativeMiddleware: () => string }).nativeMiddleware()).toBe('ready')
    await endpoint.dispose()
  })

  it('YS31 retains WebRPC owned-resource cleanup for native Middleware', async () => {
    const [transport] = createMemoryTransportPair()
    let releases = 0
    const middleware = defineMiddleware('ys31-owned-resource', (core) => ({
      install: () => {
        core.own({}, () => {
          releases += 1
        })
        return {}
      },
      expose: () => ({ ownedMiddleware: () => 'ready' })
    }))
    const endpoint = await createEndpoint({
      id: 'ys31-owned-resource',
      transport,
      middlewares: [connect({ transport }), middleware] as const
    })
    expect((endpoint as { ownedMiddleware: () => string }).ownedMiddleware()).toBe('ready')
    await endpoint.dispose()
    await endpoint.dispose()
    expect(releases).toBe(1)
  })

  it('YS31 normalizes object middleware through the native installation path', async () => {
    const [transport] = createMemoryTransportPair()
    let installs = 0
    const middleware = defineMiddleware({
      name: 'ys31-object-native',
      metadata: {
        claims: {
          ...emptyClaims,
          publicKeys: ['objectNativeMiddleware'],
          exposedKeys: ['objectNativeMiddleware']
        }
      },
      install: (scope) => {
        installs += 1
        scope.own({}, () => undefined)
        return { extension: { objectNativeMiddleware: () => 'ready' }, shared: {} }
      }
    })
    const endpoint = await createEndpoint({
      id: 'ys31-object-native',
      transport,
      middlewares: [connect({ transport }), middleware] as const
    })
    expect(installs).toBe(1)
    expect(
      (endpoint as unknown as { objectNativeMiddleware: () => string }).objectNativeMiddleware()
    ).toBe('ready')
    await endpoint.dispose()
  })

  it('YS31 selects an object middleware transport without a factory transport', async () => {
    const [transport] = createMemoryTransportPair()
    const legacyConnect = connect({ transport })
    const middleware = defineMiddleware({
      ...legacyConnect,
      name: 'ys31-object-transport',
      transport
    })
    const endpoint = await createEndpoint({
      id: 'ys31-object-transport',
      middlewares: [middleware] as const
    })
    expect(endpoint).toBeDefined()
    await endpoint.dispose()
  })

  it('YS31 captures object middleware install and metadata at definition time', async () => {
    const [transport] = createMemoryTransportPair()
    let capturedInstalls = 0
    let mutatedInstalls = 0
    const definition = {
      name: 'ys31-object-capture',
      metadata: { claims: emptyClaims },
      install: () => {
        capturedInstalls += 1
        return { extension: {}, shared: {} }
      }
    }
    const middleware = defineMiddleware(definition)
    definition.install = () => {
      mutatedInstalls += 1
      return { extension: { mutated: () => 'nope' }, shared: {} }
    }
    definition.metadata = {
      claims: { ...emptyClaims, publicKeys: ['mutated'], exposedKeys: ['mutated'] }
    }
    const endpoint = await createEndpoint({
      id: 'ys31-object-capture',
      transport,
      middlewares: [connect({ transport }), middleware] as const
    })
    expect(capturedInstalls).toBe(1)
    expect(mutatedInstalls).toBe(0)
    await endpoint.dispose()
  })

  it('YS31 rejects explicit empty object publicKeys with a nonempty extension', async () => {
    const [baseTransport] = createMemoryTransportPair()
    const stats = { subscribeCalls: 0 }
    const transport = {
      ...baseTransport,
      subscribe: (listener: Parameters<typeof baseTransport.subscribe>[0]) => {
        stats.subscribeCalls += 1
        return baseTransport.subscribe(listener)
      }
    }
    let releases = 0
    const middleware = defineMiddleware({
      name: 'ys31-object-empty-public',
      metadata: { claims: emptyClaims },
      install: (scope) => {
        scope.own({}, () => {
          releases += 1
        })
        return { extension: { forbidden: () => 'nope' }, shared: {} }
      }
    })
    await expect(
      createEndpoint({
        id: 'ys31-object-empty-public',
        transport,
        middlewares: [connect({ transport }), middleware] as const
      })
    ).rejects.toMatchObject({ code: WebRpcErrorCode.invalidConfig })
    expect(stats.subscribeCalls).toBe(0)
    expect(releases).toBe(1)
  })

  it('YS31 rejects explicit empty object sharedProvides before ingress', async () => {
    const [baseTransport] = createMemoryTransportPair()
    const stats = { subscribeCalls: 0 }
    const transport = {
      ...baseTransport,
      subscribe: (listener: Parameters<typeof baseTransport.subscribe>[0]) => {
        stats.subscribeCalls += 1
        return baseTransport.subscribe(listener)
      }
    }
    let releases = 0
    const middleware = defineMiddleware({
      name: 'ys31-object-empty-shared',
      metadata: { claims: emptyClaims, sharedProvides: [] },
      install: (scope) => {
        scope.own({}, () => {
          releases += 1
        })
        return { extension: {}, shared: { forbidden: () => 'nope' } }
      }
    })
    await expect(
      createEndpoint({
        id: 'ys31-object-empty-shared',
        transport,
        middlewares: [connect({ transport }), middleware] as const
      })
    ).rejects.toMatchObject({ code: WebRpcErrorCode.invalidConfig })
    expect(stats.subscribeCalls).toBe(0)
    expect(releases).toBe(1)
  })

  it('YS31 keeps dynamic native middleware keys isolated across concurrent Hosts', async () => {
    const [firstTransport] = createMemoryTransportPair()
    const [secondTransport] = createMemoryTransportPair()
    const middleware = defineMiddleware<{
      readonly firstNativeMiddleware?: () => string
      readonly secondNativeMiddleware?: () => string
    }>('ys31-isolation', (core) => ({
      expose: () =>
        core.id === 'ys31-first'
          ? { firstNativeMiddleware: () => 'first' }
          : { secondNativeMiddleware: () => 'second' }
    }))
    const [first, second] = await Promise.all([
      createEndpoint({
        id: 'ys31-first',
        transport: firstTransport,
        middlewares: [connect({ transport: firstTransport }), middleware] as const
      }),
      createEndpoint({
        id: 'ys31-second',
        transport: secondTransport,
        middlewares: [connect({ transport: secondTransport }), middleware] as const
      })
    ])
    expect((first as { firstNativeMiddleware: () => string }).firstNativeMiddleware()).toBe('first')
    expect((second as { secondNativeMiddleware: () => string }).secondNativeMiddleware()).toBe(
      'second'
    )
    await Promise.all([first.dispose(), second.dispose()])
  })
  it('invokes the captured middleware install once with an undefined receiver', async () => {
    const [transport] = createMemoryTransportPair()
    let reads = 0
    let receiverWasUndefined = false
    let disposed = 0
    const install = function (this: unknown, _scope: IWebRpcPluginInstallScope) {
      receiverWasUndefined = this === undefined
      return () => {
        disposed += 1
      }
    }
    const middleware = {} as IWebRpcPlugin
    Object.defineProperty(middleware, 'name', { configurable: true, value: 'getter-middleware' })
    Object.defineProperty(middleware, 'metadata', {
      configurable: true,
      value: { claims: emptyClaims }
    })
    Object.defineProperty(middleware, 'install', {
      configurable: true,
      get: () => {
        reads += 1
        if (reads > 1) throw new Error('install reread')
        return function (this: unknown, scope: IWebRpcPluginInstallScope) {
          const release = install(scope as never)
          if (typeof release === 'function') scope.own({}, release)
          return { extension: {}, shared: {} }
        }
      }
    })
    const endpoint = await createComposedEndpoint(
      composedConfig(transport, [connect({ transport }), middleware]),
      createClientFirstPartyRoots()
    )
    expect(reads).toBe(1)
    expect(receiverWasUndefined).toBe(true)
    await endpoint.dispose()
    expect(disposed).toBe(1)
  })

  it('keeps the admitted install after post-snapshot mutation', async () => {
    const [transport] = createMemoryTransportPair()
    let installed = 0
    let disposed = 0
    const middleware = {
      name: 'post-snapshot-middleware',
      metadata: { claims: emptyClaims },
      install: (scope: IWebRpcPluginInstallScope) => {
        installed += 1
        scope.own({}, () => {
          disposed += 1
        })
        return { extension: {}, shared: {} }
      }
    } as IWebRpcPlugin
    const creation = createComposedEndpoint(
      composedConfig(transport, [connect({ transport }), middleware]),
      createClientFirstPartyRoots()
    )
    Object.defineProperty(middleware, 'install', {
      configurable: true,
      value: () => {
        throw new Error('post-snapshot install mutation escaped')
      }
    })
    const endpoint = await creation
    expect(installed).toBe(1)
    await endpoint.dispose()
    expect(disposed).toBe(1)
  })

  it('rejects fixed-role claim mismatches before Host mutation', () => {
    const roles = [
      descriptor('kernel', emptyClaims, { sharedProvides: [WebRpcSharedKey.time] }),
      descriptor('middleware:connect', emptyClaims, {
        sharedConsumes: [WebRpcSharedKey.time]
      }),
      descriptor(
        'feature:outbound',
        { ...emptyClaims, routes: ['response'] },
        { sharedProvides: [WebRpcSharedKey.outboundAttachment] }
      ),
      descriptor('activation', { ...emptyClaims, activator: true })
    ]
    expect(() => preflightFeatureClaims(roles)).not.toThrow()

    const cases = [
      roles.map((item, index) =>
        index === 2 ? descriptor(item.name, { ...item.claims, activator: true }) : item
      ),
      roles.map((item, index) =>
        index === 1
          ? descriptor(item.name, item.claims, { sharedConsumes: [Symbol('missing')] })
          : item
      ),
      roles.map((item, index) =>
        index === 2 ? descriptor(item.name, { ...item.claims, exposedKeys: ['send'] }) : item
      ),
      roles.map((item, index) =>
        index === 3 ? descriptor(item.name, { ...item.claims, routes: ['response'] }) : item
      )
    ]
    for (const invalid of cases) expect(() => preflightFeatureClaims(invalid)).toThrow()
  })

  it.each(['kernel', 'middleware:connect', 'feature:outbound', 'activation'] as const)(
    'preserves PH01 primary and rollback identities when %s fails',
    async (failedRole) => {
      const roles = ['kernel', 'middleware:connect', 'feature:outbound', 'activation'] as const
      const failureIndex = roles.indexOf(failedRole)
      const primary = new Error(`${failedRole} primary`)
      const rollback = roles.map((role) => new Error(`${role} rollback`))
      const [transport] = createMemoryTransportPair()
      const host = createWebRpcPluginHost(
        failedRole,
        transport,
        createConstructionControl({ signal: new AbortController().signal as IWebRpcAbortSignal }),
        () => undefined,
        { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
      )
      const definitions = roles.map((role, index) =>
        definePlugin(role, (core) => ({
          install: async () => {
            if (index === failureIndex) throw primary
            core.onDispose(() => {
              throw rollback[index]
            })
            return {}
          }
        }))
      )
      let failure: unknown
      try {
        await host.installBatch(definitions)
      } catch (error) {
        failure = error
      } finally {
        await host.dispose()
      }
      expect(failure).toMatchObject({
        code: 'PLUGIN_INSTALL_FAILED',
        cause: primary,
        detail: { failedName: failedRole }
      })
      const rollbackErrors = (
        failure as { readonly detail?: { readonly rollbackErrors?: readonly unknown[] } }
      ).detail?.rollbackErrors
      const rollbackIdentities = (rollbackErrors ?? []).flatMap((error) =>
        error instanceof AggregateError ? [...error.errors] : [error]
      )
      expect(rollbackIdentities).toHaveLength(failureIndex)
      rollbackIdentities.forEach((error, index) =>
        expect(error).toBe(rollback[failureIndex - index - 1])
      )
    }
  )

  it('drives every production role through one injected batch with PH01 identities and no residue', async () => {
    const baseline = await createProductionBatch()
    const roles = baseline.inventory.map(({ role }) => role)
    await baseline.host.dispose()

    for (const failedRole of roles) {
      const primary = new Error(`production ${JSON.stringify(failedRole)} primary`)
      const rollback = new Error(`production ${JSON.stringify(failedRole)} rollback`)
      const batch = await createProductionBatch((role, install) => {
        if (sameRole(role, failedRole))
          return async () => {
            throw primary
          }
        if (role.kind === 'middleware' && role.index === 0 && failedRole.kind !== 'kernel')
          return async (scope) => ({
            ...((await install(scope)) as object),
            dispose: () => {
              throw rollback
            }
          })
        return install
      })
      let failure: unknown
      try {
        await batch.host.installBatch(batch.translated.map(({ definition }) => definition))
      } catch (error) {
        failure = error
      } finally {
        await batch.host.dispose()
      }
      const failedName = batch.inventory.find(({ role }) => sameRole(role, failedRole))?.descriptor
        .name
      const failureIndex = roles.findIndex((role) => sameRole(role, failedRole))
      expect(failure).toMatchObject({
        code: 'PLUGIN_INSTALL_FAILED',
        detail: { failedName }
      })
      expect(errorChainContains(failure, primary)).toBe(true)
      if (failureIndex > 0 && !(failedRole.kind === 'middleware' && failedRole.index === 0))
        expect(
          (
            (failure as { readonly detail?: { readonly rollbackErrors?: readonly unknown[] } })
              .detail?.rollbackErrors ?? []
          ).some((error) => error === rollback || errorChainContains(error, rollback)),
          `${failedName} rollback missing: ${String(
            (failure as { readonly detail?: { readonly rollbackErrors?: readonly unknown[] } })
              .detail?.rollbackErrors?.length ?? 0
          )}`
        ).toBe(true)
      expect(batch.stats.activeSubscriptions).toBe(0)
      expect(batch.stats.dispatches).toBe(0)
      expect(batch.isActivated()).toBe(false)
    }
  })

  it('preflights the production inventory and rejects static/runtime claim mismatches before Host mutation', async () => {
    const batch = await createProductionBatch()
    expect(batch.stats.subscribeCalls).toBe(0)
    expect(batch.stats.dispatches).toBe(0)
    const roleIndex = (predicate: (role: IWebRpcPluginRole) => boolean): number =>
      batch.inventory.findIndex(({ role }) => predicate(role))
    const kernelIndex = roleIndex((role) => role.kind === 'kernel')
    const outboundIndex = roleIndex((role) => role.kind === 'feature')
    const activationIndex = roleIndex((role) => role.kind === 'activation')
    const middlewareIndex = roleIndex(
      (role) => role.kind === 'middleware' && role.name === 'protocol'
    )
    expect(
      [kernelIndex, outboundIndex, activationIndex, middlewareIndex].every((index) => index >= 0)
    ).toBe(true)
    const invalid = [
      batch.admissions.map((admission, index) =>
        index === kernelIndex
          ? {
              ...admission,
              sharedProvides: [WebRpcSharedKey.protocol]
            }
          : admission
      ),
      batch.admissions.map((admission, index) =>
        index === middlewareIndex
          ? { ...admission, sharedConsumes: [Symbol('forged-web-rpc-shared-key')] }
          : admission
      ),
      batch.admissions.map((admission, index) =>
        index === middlewareIndex
          ? { ...admission, sharedConsumes: ['web-rpc.shared.capabilities'] }
          : admission
      ),
      batch.admissions.map((admission, index) =>
        index === outboundIndex
          ? {
              ...admission,
              sharedConsumes: [Symbol('missing-outbound-shared-key')]
            }
          : admission
      ),
      batch.admissions.map((admission, index) =>
        index === outboundIndex
          ? {
              ...admission,
              claims: { ...admission.claims, exposedKeys: ['missing-production-key'] }
            }
          : admission
      ),
      batch.admissions.map((admission, index) =>
        index === outboundIndex
          ? { ...admission, claims: { ...admission.claims, activator: true } }
          : admission
      ),
      batch.admissions.map((admission, index) =>
        index === activationIndex
          ? { ...admission, claims: { ...admission.claims, routes: ['response'] } }
          : admission
      ),
      batch.admissions.map((admission, index) =>
        index === activationIndex
          ? { ...admission, claims: { ...admission.claims, activator: false } }
          : admission
      )
    ]
    for (const [invalidIndex, descriptors] of invalid.entries())
      expect(
        () => preflightFeatureClaims(descriptors),
        `invalid production claim case ${invalidIndex}`
      ).toThrow()
    expect(() =>
      preflightFeatureClaims(
        batch.admissions.map((admission, index) =>
          index === activationIndex
            ? { ...admission, claims: { ...admission.claims, activator: false } }
            : admission
        )
      )
    ).toThrow()
    const optionalConsumer = batch.admissions.map((admission, index) =>
      index === middlewareIndex ? { ...admission, sharedConsumes: undefined } : admission
    )
    expect(() => preflightFeatureClaims(optionalConsumer)).not.toThrow()

    const installed = await batch.host.installBatch(
      batch.translated.map(({ definition }) => definition)
    )
    assertFeatureClaimParity(batch.admissions, installed, batch.kernel, {
      activated: batch.isActivated(),
      routeKeys: batch.getRuntimeState()?.routeKeys
    })
    expect(batch.stats.activeSubscriptions).toBeGreaterThan(0)
    await batch.host.dispose()
  })

  it('routes protocol and contract through typed Host shared ports without legacy registry writes', async () => {
    const batch = await createProductionBatch()
    const protocolEntry = batch.inventory.find(
      ({ role }) => role.kind === 'middleware' && role.name === 'protocol'
    )
    const contractEntry = batch.inventory.find(
      ({ role }) => role.kind === 'middleware' && role.name === 'contract'
    )
    expect(protocolEntry?.descriptor.name).toBe('protocol')
    expect(contractEntry?.descriptor.name).toBe('contract')
    expect(protocolEntry?.descriptor.sharedProvides).toEqual([WebRpcSharedKey.protocol])
    expect(contractEntry?.descriptor.sharedProvides).toEqual([WebRpcSharedKey.contract])

    await batch.host.installBatch(batch.translated.map(({ definition }) => definition))

    expect(batch.host.getShared(WebRpcSharedKey.protocol)).toMatchObject({
      id: 'migaia.rpc',
      version: 1,
      normalize: expect.any(Function)
    })
    expect(batch.host.getShared(WebRpcSharedKey.contract)).toMatchObject({
      validateData: expect.any(Function)
    })

    await batch.host.dispose()
  })

  it('keeps production shared publication isolated between endpoint Hosts', async () => {
    const left = await createProductionBatch()
    const right = await createProductionBatch()
    const leftHost = await left.host.installBatch(
      left.translated.map(({ definition }) => definition)
    )
    const rightHost = await right.host.installBatch(
      right.translated.map(({ definition }) => definition)
    )
    expect(leftHost.getShared(WebRpcSharedKey.connect)).toBeDefined()
    expect(rightHost.getShared(WebRpcSharedKey.connect)).toBeDefined()
    expect(left.stats.activeSubscriptions).toBeGreaterThan(0)
    expect(right.stats.activeSubscriptions).toBeGreaterThan(0)
    await left.host.dispose()
    expect(right.host.getShared(WebRpcSharedKey.connect)).toBeDefined()
    await right.host.dispose()
  })

  it.each([
    'extra-shared',
    'wrong-shared-value',
    'missing-public',
    'extra-public',
    'route-mismatch',
    'activation-mismatch'
  ] as const)(
    'rejects production runtime %s output with exact primary and zero residue',
    async (kind) => {
      const primary = new Error(`runtime output ${kind} primary`)
      await expectRuntimeParityFailure(
        {
          injectRuntimeOutput: (role, phase, output) => {
            if (kind === 'extra-shared' && role.kind === 'kernel' && phase === 'shared')
              return { ...output, 'runtime-forged-shared': {} }
            if (
              kind === 'wrong-shared-value' &&
              role.kind === 'feature' &&
              role.key === 'endpoint-capabilities' &&
              phase === 'shared'
            ) {
              const original = output[WebRpcSharedKey.outboundOperations] as object
              const wrong = new Proxy(original, {
                get: (target, key) => {
                  const value = Reflect.get(target, key, target)
                  return typeof value === 'function'
                    ? (...args: readonly unknown[]) =>
                        (target as Record<PropertyKey, (...args: readonly unknown[]) => unknown>)[
                          key
                        ](...args)
                    : value
                }
              })
              return { ...output, [WebRpcSharedKey.outboundOperations]: wrong }
            }
            if (
              kind === 'missing-public' &&
              role.kind === 'feature' &&
              role.key === 'endpoint-capabilities' &&
              phase === 'extension'
            ) {
              const { provide: _provide, ...rest } = output
              return rest
            }
            if (
              kind === 'extra-public' &&
              role.kind === 'feature' &&
              role.key === 'endpoint-capabilities' &&
              phase === 'extension'
            )
              return { ...output, 'runtime-forged-public': () => undefined }
            return output
          },
          injectRuntimeState: (role, state) => {
            if (role.kind !== 'activation') return state
            if (kind === 'route-mismatch')
              return { ...state, routeKeys: [...state.routeKeys, 'runtime-forged-route'] }
            if (kind === 'activation-mismatch') return { ...state, activated: false }
            return state
          }
        },
        primary
      )
    }
  )

  it('rejects an accessor runtime public output before projection escape and rolls back the production batch', async () => {
    const batch = await createProductionBatch({
      injectRuntimeOutput: (role, phase, output) => {
        if (
          role.kind !== 'feature' ||
          role.key !== 'endpoint-capabilities' ||
          phase !== 'extension'
        )
          return output
        const accessorOutput = { ...output }
        Object.defineProperty(accessorOutput, 'provide', {
          configurable: true,
          enumerable: true,
          get: () => undefined
        })
        return accessorOutput
      }
    })
    let failure: unknown
    try {
      await batch.host.installBatch(batch.translated.map(({ definition }) => definition))
    } catch (error) {
      failure = error
    } finally {
      await batch.host.dispose()
    }
    expect(failure).toMatchObject({ code: 'PLUGIN_INSTALL_FAILED' })
    expect(batch.stats.activeSubscriptions).toBe(0)
    expect(batch.stats.dispatches).toBe(0)
    expect(batch.kernel.state).toBe('disposed')
    expect(batch.isActivated()).toBe(false)
  })

  it('fails closed when a production required shared provider omits its runtime output', async () => {
    let batch!: IProductionBatch
    batch = await createProductionBatch({
      injectDescriptor: (role, descriptor) => {
        if (role.kind !== 'feature' || role.key !== 'provider') return descriptor
        return {
          ...descriptor,
          shared: (installation) => {
            const published = descriptor.shared?.(installation) ?? {}
            expect(published[WebRpcSharedKey.providerCancellation]).toMatchObject({
              abort: expect.any(Function)
            })
            const { [WebRpcSharedKey.providerCancellation]: _cancellation, ...rest } = published
            return rest
          }
        }
      },
      onActivationPreflight: (state) =>
        assertFeatureClaimParity(batch.admissions, batch.host, batch.kernel, {
          activated: state.activated,
          activationPhase: 'pre-activation',
          routeKeys: state.routeKeys
        })
    })
    let failure: unknown
    try {
      await batch.host.installBatch(batch.translated.map(({ definition }) => definition))
    } catch (error) {
      failure = error
    } finally {
      await batch.host.dispose()
    }
    expect(failure).toMatchObject({
      code: 'PLUGIN_INSTALL_FAILED',
      detail: { failedName: 'activation' },
      cause: { code: WebRpcErrorCode.invalidConfig }
    })
    expect(batch.stats.activeSubscriptions).toBe(0)
    expect(batch.stats.dispatches).toBe(0)
    expect(batch.kernel.state).toBe('disposed')
  })

  it('keeps a fresh native Host transaction isolated after an actual install failure', async () => {
    const primary = new Error('native retry primary')
    const failed = await createProductionBatch({
      injectInstall: (role, install) => {
        if (role.kind !== 'middleware' || role.index !== 0) return install
        return async () => {
          throw primary
        }
      }
    })
    let failure: unknown
    try {
      await failed.host.installBatch(failed.translated.map(({ definition }) => definition))
    } catch (error) {
      failure = error
    } finally {
      await failed.host.dispose()
    }
    expect(failure).toMatchObject({ code: 'PLUGIN_INSTALL_FAILED' })
    expect(errorChainContains(failure, primary)).toBe(true)
    expect(failed.stats.activeSubscriptions).toBe(0)
    const retry = await createProductionBatch()
    try {
      await retry.host.installBatch(retry.translated.map(({ definition }) => definition))
      expect(retry.stats.activeSubscriptions).toBeGreaterThan(0)
    } finally {
      await retry.host.dispose()
    }
    expect(retry.stats.activeSubscriptions).toBe(0)
  })

  it.each(['throw', 'reject'] as const)(
    'preserves activation runtime %s identity and removes all prior shared output',
    async (mode) => {
      const primary = new Error(`activation runtime ${mode} primary`)
      const rollback = new Error(`activation runtime ${mode} rollback`)
      const batch = await createProductionBatch({
        injectInstall: (role, install) => {
          if (role.kind !== 'middleware' || role.index !== 0) return install
          return async (scope) => ({
            ...((await install(scope)) as object),
            dispose: () => {
              throw rollback
            }
          })
        },
        injectRuntimeState: (role, state) => {
          if (role.kind !== 'activation') return state
          if (mode === 'throw') throw primary
          return Promise.reject(primary)
        }
      })
      let failure: unknown
      try {
        await batch.host.installBatch(batch.translated.map(({ definition }) => definition))
      } catch (error) {
        failure = error
      }
      console.error('hostile-native-host-failure', (failure as { readonly cause?: unknown })?.cause)
      expect(failure).toMatchObject({
        code: 'PLUGIN_INSTALL_FAILED',
        cause: primary,
        detail: { failedName: 'activation' }
      })
      expect(errorChainContains(failure, primary)).toBe(true)
      const rollbackErrors = (
        failure as { readonly detail?: { readonly rollbackErrors?: readonly unknown[] } }
      ).detail?.rollbackErrors
      const rollbackIdentities = (rollbackErrors ?? []).flatMap((error) =>
        error instanceof AggregateError ? [...error.errors] : [error]
      )
      expect(
        rollbackIdentities.some(
          (error) => error === rollback || errorChainContains(error, rollback)
        )
      ).toBe(true)
      expect(batch.host.getShared(WebRpcSharedKey.outboundAttachment)).toBeUndefined()
      await batch.host.dispose()
      expect(batch.stats.subscribeCalls).toBe(0)
      expect(batch.stats.activeSubscriptions).toBe(0)
      expect(batch.stats.dispatches).toBe(0)
      expect(batch.isActivated()).toBe(false)
    }
  )

  it('preserves custom protocol/contract behavior and read order through the production seam', async () => {
    const trace: string[] = []
    const jsonCodec = defineJsonCodec({ version: 1 })
    const customCodec = codec({
      ...jsonCodec,
      get encode() {
        trace.push('codec.encode')
        return jsonCodec.encode
      },
      get decode() {
        trace.push('codec.decode')
        return jsonCodec.decode
      },
      get encodedType() {
        trace.push('codec.encodedType')
        return 'string' as const
      }
    })
    const schema = {
      parse(value: unknown) {
        trace.push('contract.schema.parse')
        return value
      }
    }
    const customContract = contract({
      get version() {
        trace.push('contract.version')
        return 'v1'
      },
      get acceptVersions() {
        trace.push('contract.acceptVersions')
        return ['v1']
      },
      get maxIdentifierLength() {
        trace.push('contract.maxIdentifierLength')
        return 64
      },
      get schemas() {
        trace.push('contract.schemas')
        return { echo: { params: schema, result: schema } }
      }
    })
    const batch = await createProductionBatch({
      protocolMiddleware: protocol(),
      codecMiddleware: customCodec,
      contractMiddleware: customContract
    })
    const host = await batch.host.installBatch(batch.translated.map(({ definition }) => definition))
    const prepared = batch.getPrepared()!
    const contractPort = host.getShared(WebRpcSharedKey.contract) as IWebRpcContractPort
    expect(prepared.options.components?.codec.encodedType).toBe('string')
    expect(
      prepared.options.components?.codec.decode(
        prepared.options.components.codec.encode({
          kind: 'response',
          ok: true,
          id: 'value',
          data: null
        })
      )
    ).toBeDefined()
    contractPort?.validateData('echo', 'params', { ok: true })
    expect(trace.slice(0, 9)).toEqual([
      'codec.encode',
      'codec.decode',
      'codec.encode',
      'codec.decode',
      'codec.encodedType',
      'contract.version',
      'contract.acceptVersions',
      'contract.maxIdentifierLength',
      'contract.schemas'
    ])
    expect(trace.at(-1)).toBe('contract.schema.parse')
    await batch.host.dispose()
    expect(batch.stats.activeSubscriptions).toBe(0)
  })

  it('accepts absent optional protocol and contract providers at the exact production seam', async () => {
    const batch = await createProductionBatch({ omitProtocol: true, omitContract: true })
    const host = await batch.host.installBatch(batch.translated.map(({ definition }) => definition))
    expect(host.getShared(WebRpcSharedKey.protocol)).toBeUndefined()
    expect(host.getShared(WebRpcSharedKey.contract)).toBeUndefined()
    expect(batch.stats.activeSubscriptions).toBeGreaterThan(0)
    await batch.host.dispose()
    expect(batch.stats.activeSubscriptions).toBe(0)
  })

  it.each(['protocol', 'contract'] as const)(
    'rejects admitted %s runtime shared omission before activation with PH01 identity',
    async (missingRole) => {
      const primary = new Error(`${missingRole} shared publication mismatch`)
      const rollback = new Error(`${missingRole} shared rollback`)
      let batch!: IProductionBatch
      batch = await createProductionBatch({
        injectInstall: (role, install) => {
          if (role.kind === 'middleware' && role.name === 'protocol')
            return async (scope) => ({
              ...((await install(scope)) as object),
              dispose: () => {
                throw rollback
              }
            })
          return install
        },
        injectRuntimeOutput: (role, phase, output) =>
          role.kind === 'middleware' && role.name === missingRole && phase === 'shared'
            ? {}
            : output,
        onActivationPreflight: (state) => {
          try {
            assertFeatureClaimParity(batch.admissions, batch.host, batch.kernel, {
              activated: state.activated,
              activationPhase: 'pre-activation',
              routeKeys: state.routeKeys
            })
          } catch {
            throw primary
          }
        }
      })
      let failure: unknown
      try {
        await batch.host.installBatch(batch.translated.map(({ definition }) => definition))
      } catch (error) {
        failure = error
      }
      expect(failure).toMatchObject({
        code: 'PLUGIN_INSTALL_FAILED',
        cause: primary,
        detail: { failedName: 'activation' }
      })
      const rollbackErrors =
        (failure as { readonly detail?: { readonly rollbackErrors?: readonly unknown[] } }).detail
          ?.rollbackErrors ?? []
      expect(rollbackErrors.some((error) => errorChainContains(error, rollback))).toBe(true)
      expect(batch.stats.subscribeCalls).toBe(0)
      expect(batch.stats.activeSubscriptions).toBe(0)
      expect(batch.stats.dispatches).toBe(0)
      expect(batch.isActivated()).toBe(false)
      expect(batch.kernel.state).toBe('disposed')
      expect(batch.host.getShared(WebRpcSharedKey.protocol)).toBeUndefined()
      expect(batch.host.getShared(WebRpcSharedKey.contract)).toBeUndefined()
      await batch.host.dispose()
    }
  )

  it.each([
    ['protocol', 'sync'],
    ['protocol', 'async'],
    ['contract', 'sync'],
    ['contract', 'async']
  ] as const)(
    'preserves native %s install %s PH01 identity and rollback residue',
    async (failedRole, mode) => {
      const primary = new Error(`${failedRole} ${mode} primary`)
      const rollback = new Error(`protocol ${mode} rollback`)
      const batch = await createProductionBatch({
        injectInstall: (role, install) => {
          if (failedRole === 'contract' && role.kind === 'middleware' && role.name === 'protocol')
            return async (scope) => ({
              ...((await install(scope)) as object),
              dispose: () => {
                throw rollback
              }
            })
          if (role.kind === 'middleware' && role.name === failedRole) {
            if (mode === 'sync')
              return () => {
                throw primary
              }
            return async () => {
              throw primary
            }
          }
          return install
        }
      })
      let failure: unknown
      try {
        await batch.host.installBatch(batch.translated.map(({ definition }) => definition))
      } catch (error) {
        failure = error
      }
      expect(failure).toMatchObject({
        code: 'PLUGIN_INSTALL_FAILED',
        cause: primary,
        detail: { failedName: failedRole }
      })
      if (failedRole === 'contract') {
        const rollbackErrors =
          (failure as { readonly detail?: { readonly rollbackErrors?: readonly unknown[] } }).detail
            ?.rollbackErrors ?? []
        expect(rollbackErrors.some((error) => errorChainContains(error, rollback))).toBe(true)
      }
      expect(batch.stats.subscribeCalls).toBe(0)
      expect(batch.stats.activeSubscriptions).toBe(0)
      expect(batch.kernel.state).toBe('disposed')
      await batch.host.dispose()
    }
  )

  it.each(['protocol', 'contract'] as const)(
    'preserves native %s hostile configuration cause identity and zero residue',
    async (failedRole) => {
      const hostile = new Error(`${failedRole} hostile getter`)
      let primary: unknown
      const config = new Proxy(
        {},
        {
          get(_target, key) {
            if (key === (failedRole === 'protocol' ? 'normalize' : 'version')) throw hostile
            return undefined
          }
        }
      )
      if (failedRole === 'protocol') {
        let failure: unknown
        try {
          protocol(config as never)
        } catch (error) {
          failure = error
        }
        expect(failure).toBeInstanceOf(WebRpcError)
        expect((failure as { readonly cause?: unknown }).cause).toBe(hostile)
        let normalizeReads = 0
        const selectedDescriptor = new Proxy(
          { id: 'hostile-selected-protocol', version: 1 },
          {
            get(target, key, receiver) {
              if (key === 'normalize') {
                normalizeReads += 1
                if (normalizeReads > 1) throw hostile
                return rpcProtocolV1.normalize
              }
              return Reflect.get(target, key, receiver)
            }
          }
        )
        const selectedProtocol = protocol(selectedDescriptor as never)
        const [baseTransport] = createMemoryTransportPair()
        let subscribeCalls = 0
        const transport = {
          ...baseTransport,
          subscribe: (listener: Parameters<typeof baseTransport.subscribe>[0]) => {
            subscribeCalls += 1
            return baseTransport.subscribe(listener)
          }
        }
        const constructionFailure = await createComposedEndpoint(
          {
            id: 'protocol-hostile-selected-normalize',
            transport,
            middlewares: [connect({ transport }), selectedProtocol]
          },
          createClientFirstPartyRoots()
        ).catch((error: unknown) => error)
        expect(errorChainContains(constructionFailure, hostile)).toBe(true)
        expect(subscribeCalls).toBe(0)
        return
      }
      const batch = await createProductionBatch({
        protocolMiddleware: undefined,
        contractMiddleware: failedRole === 'contract' ? contract(config as never) : undefined,
        injectInstall: (role, install) => {
          if (role.kind !== 'middleware' || role.name !== failedRole) return install
          return async (scope) => {
            try {
              return await install(scope)
            } catch (error) {
              primary = error
              throw error
            }
          }
        }
      })
      let failure: unknown
      try {
        await batch.host.installBatch(batch.translated.map(({ definition }) => definition))
      } catch (error) {
        failure = error
      }
      expect(failure).toMatchObject({
        code: 'PLUGIN_INSTALL_FAILED',
        cause: primary,
        detail: { failedName: failedRole }
      })
      expect(primary).toBeInstanceOf(WebRpcError)
      expect((primary as { readonly cause?: unknown }).cause).toBe(hostile)
      expect(errorChainContains(failure, hostile)).toBe(true)
      expect(batch.stats.subscribeCalls).toBe(0)
      expect(batch.stats.activeSubscriptions).toBe(0)
      expect(batch.kernel.state).toBe('disposed')
      await batch.host.dispose()
    }
  )

  it('releases native protocol resources exactly once on success and failure, and preserves factory disposal identity', async () => {
    let successfulReleases = 0
    const successful = await createProductionBatch({
      injectInstall: (role, install) => {
        if (role.kind !== 'middleware' || role.name !== 'protocol') return install
        return async (scope) => {
          const result = await install(scope)
          scope.own({}, () => {
            successfulReleases += 1
          })
          return result
        }
      }
    })
    await successful.host.installBatch(successful.translated.map(({ definition }) => definition))
    const successfulDispose = successful.host.dispose()
    expect(successful.host.dispose()).toBe(successfulDispose)
    await successfulDispose
    expect(successfulReleases).toBe(1)
    expect(successful.stats.activeSubscriptions).toBe(0)

    let failedReleases = 0
    const failed = await createProductionBatch({
      injectInstall: (role, install) => {
        if (role.kind === 'middleware' && role.name === 'protocol')
          return async (scope) => {
            const result = await install(scope)
            scope.own({}, () => {
              failedReleases += 1
            })
            return result
          }
        if (role.kind === 'middleware' && role.name === 'contract')
          return async () => {
            throw new Error('contract rollback primary')
          }
        return install
      }
    })
    await expect(
      failed.host.installBatch(failed.translated.map(({ definition }) => definition))
    ).rejects.toMatchObject({
      code: 'PLUGIN_INSTALL_FAILED',
      detail: { failedName: 'contract' }
    })
    await failed.host.dispose()
    expect(failedReleases).toBe(1)
    expect(failed.stats.activeSubscriptions).toBe(0)

    const [transport] = createMemoryTransportPair()
    const endpoint = await createEndpoint({
      id: 'native-factory-equivalence',
      transport,
      middlewares: [protocol(), contract(), connect({ transport })]
    })
    const endpointDispose = endpoint.dispose()
    expect(endpoint.dispose()).toBe(endpointDispose)
    await endpointDispose
  })

  it('B12b02 RED: publishes authentication and connect through typed Host shared ports', async () => {
    const encrypted = (value: unknown): unknown => `encrypted:${String(value)}`
    const decrypted = (value: unknown): unknown => `decrypted:${String(value)}`
    const identified = async (): Promise<boolean> => true
    const batch = await createProductionBatch({
      authenticationMiddleware: authentication({
        encrypt: encrypted,
        decrypt: decrypted,
        encodedType: 'string'
      }),
      connectMiddleware: connect({ identifier: identified })
    })
    try {
      await batch.host.installBatch(batch.translated.map(({ definition }) => definition))
      const authenticationPort = batch.host.getShared(WebRpcSharedKey.authentication) as
        | {
            readonly encodedType: string
            readonly protect: (value: unknown, context: unknown) => unknown
            readonly unprotect: (value: unknown, context: unknown) => unknown
          }
        | undefined
      const connectPort = batch.host.getShared(WebRpcSharedKey.connect) as
        | {
            readonly transport: unknown
            readonly verify: (context: unknown) => unknown
          }
        | undefined
      expect(authenticationPort).toBeDefined()
      expect(connectPort).toBeDefined()
      expect(authenticationPort?.encodedType).toBe('string')
      expect(
        await authenticationPort?.protect('frame', {
          direction: 'outbound',
          endpointId: 'id',
          platform: 'Memory'
        })
      ).toBe('encrypted:frame')
      expect(
        await authenticationPort?.unprotect('frame', {
          direction: 'inbound',
          endpointId: 'id',
          platform: 'Memory'
        })
      ).toBe('decrypted:frame')
      expect(
        await connectPort?.verify({
          senderId: 'id',
          targetId: batch.getPrepared()?.id,
          platform: 'Memory'
        })
      ).toBe(true)
    } finally {
      await batch.host.dispose()
    }
  })

  it('B12b02 RED: declares required connect and optional authentication shared consumption', async () => {
    const batch = await createProductionBatch()
    try {
      const authenticationEntry = batch.inventory.find(
        (entry) => entry.role.kind === 'middleware' && entry.role.name === 'authentication'
      )
      const connectEntry = batch.inventory.find(
        (entry) => entry.role.kind === 'middleware' && entry.role.name === 'connect'
      )
      const finalizer = batch.inventory.find((entry) => entry.role.kind === 'middleware-finalize')
      expect(authenticationEntry?.descriptor.sharedProvides).toEqual([
        WebRpcSharedKey.authentication
      ])
      expect(connectEntry?.descriptor.sharedProvides).toEqual([WebRpcSharedKey.connect])
      expect(finalizer?.descriptor.sharedConsumes).toContain(WebRpcSharedKey.connect)
      expect(finalizer?.descriptor.sharedOptionalConsumes).toContain(WebRpcSharedKey.authentication)
    } finally {
      await batch.host.dispose()
    }
  })

  it('B12b02 RED: accepts absent optional authentication and rejects absent required connect', async () => {
    const withoutAuthentication = await createProductionBatch({ omitAuthentication: true })
    try {
      await withoutAuthentication.host.installBatch(
        withoutAuthentication.translated.map(({ definition }) => definition)
      )
      expect(withoutAuthentication.isActivated()).toBe(true)
      expect(withoutAuthentication.host.getShared(WebRpcSharedKey.authentication)).toBeUndefined()
      expect(withoutAuthentication.stats.subscribeCalls).toBe(1)
    } finally {
      await withoutAuthentication.host.dispose()
    }

    const withoutConnect = await createProductionBatch({ omitConnect: true })
    try {
      await expect(
        withoutConnect.host.installBatch(
          withoutConnect.translated.map(({ definition }) => definition)
        )
      ).rejects.toMatchObject({ code: 'PLUGIN_INSTALL_FAILED' })
      expect(withoutConnect.isActivated()).toBe(false)
      expect(withoutConnect.stats.subscribeCalls).toBe(0)
      expect(withoutConnect.stats.closeCalls).toBe(1)
    } finally {
      await withoutConnect.host.dispose()
    }
  })

  it.each([
    ['authentication', 'sync'],
    ['authentication', 'async'],
    ['connect', 'sync'],
    ['connect', 'async']
  ] as const)('B12b02 RED: preserves native %s %s failure identity', async (failedRole, mode) => {
    const primary = new Error(`${failedRole}-${mode}-primary`)
    const batch = await createProductionBatch({
      injectInstall: (role, install) => {
        if (role.kind !== 'middleware' || role.name !== failedRole) return install
        if (mode === 'sync')
          return () => {
            throw primary
          }
        return async () => {
          await Promise.resolve()
          throw primary
        }
      }
    })
    let failure: unknown
    try {
      await batch.host.installBatch(batch.translated.map(({ definition }) => definition))
    } catch (error) {
      failure = error
    } finally {
      await batch.host.dispose()
    }
    expect(failure).toMatchObject({
      code: 'PLUGIN_INSTALL_FAILED',
      cause: primary,
      detail: { failedName: failedRole }
    })
    expect(batch.stats.subscribeCalls).toBe(0)
    expect(batch.stats.activeSubscriptions).toBe(0)
    expect(batch.stats.closeCalls).toBe(1)
  })

  it('B12b02 RED: preserves one transport close owner through the canonical factory', async () => {
    let closeCalls = 0
    const authenticationMiddleware = authentication({
      encrypt: (value) => value,
      decrypt: (value) => value
    })
    const [endpointTransport] = createMemoryTransportPair()
    const ownedTransport = {
      ...endpointTransport,
      ownership: 'owned' as const,
      close: () => {
        closeCalls += 1
        endpointTransport.close?.()
      }
    }
    const endpoint = await createEndpoint({
      id: 'b12b02-native-equivalence',
      transport: ownedTransport,
      middlewares: [authenticationMiddleware, connect({ transport: ownedTransport })]
    })
    const firstDispose = endpoint.dispose()
    expect(endpoint.dispose()).toBe(firstDispose)
    await firstDispose
    expect(closeCalls).toBe(1)
  })

  it('B12b02 RED: runs production authentication encrypt-sign and verify-decrypt with exact published identity', async () => {
    const calls: Array<{
      readonly name: string
      readonly value: unknown
      readonly context: unknown
    }> = []
    const outboundContext = {
      direction: 'outbound' as const,
      endpointId: 'b12b02-auth-order',
      platform: 'Memory' as const
    }
    const inboundContext = { ...outboundContext, direction: 'inbound' as const }
    const encrypted = Object.freeze({ stage: 'encrypted', value: 'frame' })
    const signed = Object.freeze({ stage: 'signed', value: encrypted })
    const authenticationMiddleware = authentication({
      encrypt: (value, context) => {
        calls.push({ name: 'encrypt', value, context })
        return encrypted
      },
      sign: (value, context) => {
        calls.push({ name: 'sign', value, context })
        return signed
      },
      verify: (value, context) => {
        calls.push({ name: 'verify', value, context })
        return encrypted
      },
      decrypt: (value, context) => {
        calls.push({ name: 'decrypt', value, context })
        return 'frame'
      },
      encodedType: 'string'
    })
    const batch = await createProductionBatch({ authenticationMiddleware })
    try {
      await batch.host.installBatch(batch.translated.map(({ definition }) => definition))
      const publishedCapability = batch.host.getShared(WebRpcSharedKey.authentication) as
        | IWebRpcAuthenticationCapability
        | undefined
      expect(publishedCapability).toBeDefined()
      expect(await publishedCapability?.protect('frame', outboundContext)).toBe(signed)
      expect(await publishedCapability?.unprotect(signed, inboundContext)).toBe('frame')
      expect(calls.map(({ name }) => name)).toEqual(['encrypt', 'sign', 'verify', 'decrypt'])
      expect(calls[0]).toEqual({ name: 'encrypt', value: 'frame', context: outboundContext })
      expect(calls[1]).toEqual({ name: 'sign', value: encrypted, context: outboundContext })
      expect(calls[2]).toEqual({ name: 'verify', value: signed, context: inboundContext })
      expect(calls[3]).toEqual({ name: 'decrypt', value: encrypted, context: inboundContext })
      expect(batch.host.getShared(WebRpcSharedKey.authentication)).toBe(publishedCapability)
    } finally {
      await batch.host.dispose()
    }
  })

  it('B12b02 RED: executes production connect discovery, selection, fixed unique target, and identity', async () => {
    const selectorCalls: Array<{
      readonly servers: readonly unknown[]
      readonly context: unknown
    }> = []
    const identifier = async (): Promise<boolean> => true
    const receiverSelector = (servers: readonly unknown[], context: unknown): string => {
      selectorCalls.push({ servers, context })
      return 'receiver-1'
    }
    const connectMiddleware = connect({
      discoveryMode: 'manual',
      useBaseIdVerifyOnly: false,
      identifier,
      receiverSelector,
      uniqueTargetId: 'fixed-target'
    })
    const batch = await createProductionBatch({ connectMiddleware })
    try {
      await batch.host.installBatch(batch.translated.map(({ definition }) => definition))
      const publishedCapability = batch.host.getShared(WebRpcSharedKey.connect) as
        | IWebRpcConnectCapability
        | undefined
      expect(publishedCapability).toBeDefined()
      expect(publishedCapability?.discoveryMode).toBe('manual')
      expect(publishedCapability?.receiverSelector).toBe(receiverSelector)
      expect(publishedCapability?.identifier).toBe(identifier)
      expect(publishedCapability?.uniqueTargetId).toBe('fixed-target')
      expect(
        await publishedCapability?.receiverSelector?.([], {
          endpointId: 'endpoint',
          targetId: 'target',
          operation: {} as never
        })
      ).toBe('receiver-1')
      expect(selectorCalls).toHaveLength(1)
      expect(selectorCalls[0]?.servers).toEqual([])
      expect(batch.host.getShared(WebRpcSharedKey.connect)).toBe(publishedCapability)
    } finally {
      await batch.host.dispose()
    }
  })

  it('B12b02 RED: invokes async uniqueTargetId factory during production finalization and preserves result', async () => {
    const events: string[] = []
    const contexts: unknown[] = []
    const identifier = async (): Promise<boolean> => true
    const receiverSelector = (): string => 'receiver-1'
    let sharedBeforeFinalization: IWebRpcConnectCapability | undefined
    let consumedConnect: IWebRpcConnectCapability | undefined
    let batch!: IProductionBatch
    const uniqueTargetIdFactory = async (context: unknown): Promise<string> => {
      sharedBeforeFinalization = batch.host.getShared(WebRpcSharedKey.connect)
      events.push('uniqueTargetIdFactory')
      contexts.push(context)
      await Promise.resolve()
      return 'generated-target'
    }
    const connectMiddleware = connect({
      discoveryMode: 'manual',
      useBaseIdVerifyOnly: false,
      identifier,
      receiverSelector,
      uniqueTargetId: uniqueTargetIdFactory
    })
    events.push('factory-snapshot')
    batch = await createProductionBatch({
      connectMiddleware,
      onActivationPreflight: (_state, getShared) => {
        events.push('activation-preflight')
        consumedConnect = getShared(WebRpcSharedKey.connect) as IWebRpcConnectCapability | undefined
      }
    })
    try {
      await batch.host.installBatch(batch.translated.map(({ definition }) => definition))
      expect(events).toEqual(['factory-snapshot', 'uniqueTargetIdFactory', 'activation-preflight'])
      expect(events.filter((event) => event === 'uniqueTargetIdFactory')).toHaveLength(1)
      expect(contexts).toHaveLength(1)
      expect(contexts[0]).toMatchObject({ endpointId: expect.any(String), platform: 'Memory' })
      const publishedAfterFinalization = batch.host.getShared(WebRpcSharedKey.connect) as
        | IWebRpcConnectCapability
        | undefined
      const finalizedConnect = batch.getPrepared()?.options.connect as
        | IWebRpcConnectCapability
        | undefined
      // The external Host view remains isolated until the complete async batch commits.
      expect(sharedBeforeFinalization).toBeUndefined()
      expect(publishedAfterFinalization).toBeDefined()
      expect(publishedAfterFinalization?.uniqueTargetIdFactory).toBe(uniqueTargetIdFactory)
      expect(finalizedConnect?.uniqueTargetId).toBe('generated-target')
      expect(finalizedConnect?.uniqueTargetIdFactory).toBe(uniqueTargetIdFactory)
      expect(finalizedConnect?.discoveryMode).toBe('manual')
      expect(finalizedConnect?.receiverSelector).toBe(receiverSelector)
      expect(finalizedConnect?.identifier).toBe(identifier)
      expect(finalizedConnect?.transport).toBe(publishedAfterFinalization?.transport)
      expect(finalizedConnect?.verify).toBe(publishedAfterFinalization?.verify)
      /** The native shared port is immutable; finalization derives its endpoint-only target id. */
      expect(consumedConnect).toBe(publishedAfterFinalization)
      expect(consumedConnect?.uniqueTargetId).toBeUndefined()
      expect(consumedConnect?.uniqueTargetIdFactory).toBe(uniqueTargetIdFactory)
    } finally {
      const firstDispose = batch.host.dispose()
      expect(batch.host.dispose()).toBe(firstDispose)
      await firstDispose
      expect(batch.host.dispose()).toBe(firstDispose)
    }
  })

  it('B12b02 RED: preserves hostile async uniqueTargetId factory primary and cause through finalizer', async () => {
    const hostile = new Error('hostile async unique target factory')
    const connectMiddleware = connect({
      useBaseIdVerifyOnly: false,
      identifier: async () => true,
      uniqueTargetId: async () => {
        await Promise.resolve()
        throw hostile
      }
    })
    const batch = await createProductionBatch({ connectMiddleware })
    let failure: unknown
    try {
      await batch.host.installBatch(batch.translated.map(({ definition }) => definition))
    } catch (error) {
      failure = error
    } finally {
      await batch.host.dispose()
    }
    expect(failure).toMatchObject({
      code: 'PLUGIN_INSTALL_FAILED',
      detail: { failedName: 'middleware-finalize' }
    })
    const primary = (failure as { readonly cause?: unknown }).cause
    expect(primary).toBeInstanceOf(WebRpcError)
    expect((primary as { readonly cause?: unknown }).cause).toBe(hostile)
    expect(errorChainContains(failure, hostile)).toBe(true)
    const firstDispose = batch.host.dispose()
    expect(batch.host.dispose()).toBe(firstDispose)
    await firstDispose
    expect(batch.host.dispose()).toBe(firstDispose)
  })

  it('B12b02 RED: records unified successful and rollback teardown order with stable repeated disposal', async () => {
    const successTrace: IProductionLifecycleTraceEntry[] = []
    const successResources = new Map<string, object>()
    const success = await createProductionBatch({
      transportOwnership: 'owned',
      lifecycleTrace: successTrace,
      injectInstall: (role, install) => {
        if (
          role.kind === 'middleware' &&
          (role.name === 'authentication' || role.name === 'connect')
        )
          return async (scope) => {
            const result = await install(scope)
            const resource = {}
            successResources.set(role.name, resource)
            scope.own(resource, () => {
              successTrace.push({ kind: `${role.name}.release`, instance: resource })
            })
            return result
          }
        if (role.kind === 'feature' && role.key === 'outbound') return install
        return install
      }
    })
    await success.host.installBatch(success.translated.map(({ definition }) => definition))
    const firstSuccessDispose = success.host.dispose()
    expect(success.host.dispose()).toBe(firstSuccessDispose)
    await firstSuccessDispose
    await success.host.dispose()
    expect(success.stats.closeCalls).toBe(1)

    const rollbackTrace: IProductionLifecycleTraceEntry[] = []
    const rollbackResources = new Map<string, object>()
    const primary = new Error('teardown rollback primary')
    const rollback = await createProductionBatch({
      transportOwnership: 'owned',
      lifecycleTrace: rollbackTrace,
      injectInstall: (role, install) => {
        if (
          role.kind === 'middleware' &&
          (role.name === 'authentication' || role.name === 'connect')
        )
          return async (scope) => {
            const result = await install(scope)
            const resource = {}
            rollbackResources.set(role.name, resource)
            scope.own(resource, () => {
              rollbackTrace.push({ kind: `${role.name}.release`, instance: resource })
            })
            return result
          }
        if (role.kind === 'feature' && role.key === 'outbound') return install
        if (role.kind === 'activation')
          return async (scope) => {
            await install(scope)
            throw primary
          }
        return install
      }
    })
    let failure: unknown
    try {
      await rollback.host.installBatch(rollback.translated.map(({ definition }) => definition))
    } catch (error) {
      failure = error
    } finally {
      await rollback.host.dispose()
    }
    expect(failure).toMatchObject({ code: 'PLUGIN_INSTALL_FAILED', cause: primary })
    expect(rollback.stats.closeCalls).toBe(1)

    for (const [trace, resources, batch] of [
      [successTrace, successResources, success],
      [rollbackTrace, rollbackResources, rollback]
    ] as const) {
      expect
        .soft(trace.map(({ kind }) => kind))
        .toEqual([
          'unsubscribe',
          'connect.release',
          'authentication.release',
          'transport.close',
          'kernel.completeDispose'
        ])
      expect(trace.filter(({ kind }) => kind === 'transport.close')).toHaveLength(1)
      expect(trace.find(({ kind }) => kind === 'unsubscribe')?.instance).toEqual(
        expect.any(Function)
      )
      expect(trace.find(({ kind }) => kind === 'connect.release')?.instance).toBe(
        resources.get('connect')
      )
      expect(trace.find(({ kind }) => kind === 'authentication.release')?.instance).toBe(
        resources.get('authentication')
      )
      expect(trace.find(({ kind }) => kind === 'kernel.completeDispose')?.instance).toBe(
        batch.kernel
      )
      expect(trace.find(({ kind }) => kind === 'transport.close')?.instance).toBe(
        batch.kernel.transport.close
      )
    }
  })

  it('B12b02 R7: owns provider feature disposal once on success and rollback', async () => {
    let successOwner:
      | { readonly debugSnapshot: () => { readonly providers: number; readonly events: number } }
      | undefined
    const success = await createProductionBatch({
      providers: {
        echo: (context) => context.success('ok')
      },
      injectInstall: (role, install) => {
        if (role.kind !== 'feature' || role.key !== 'first-party-provider') return install
        return async (scope) => {
          const result = (await install(scope)) as Record<PropertyKey, unknown>
          const publicSurface = result.public as object
          successOwner = {
            debugSnapshot: () => {
              const snapshot = readEndpointDebugSnapshot(publicSurface)
              return { providers: snapshot?.providers ?? 0, events: snapshot?.events ?? 0 }
            }
          }
          return result
        }
      }
    })
    await success.host.installBatch(success.translated.map(({ definition }) => definition))
    expect(successOwner?.debugSnapshot().providers).toBeGreaterThan(0)
    const successDispose = success.host.dispose()
    expect(success.host.dispose()).toBe(successDispose)
    await successDispose
    expect(successOwner?.debugSnapshot()).toMatchObject({ providers: 0, events: 0 })
    await success.host.dispose()

    let rollbackOwner:
      | { readonly debugSnapshot: () => { readonly providers: number; readonly events: number } }
      | undefined
    const primary = new Error('provider feature rollback primary')
    const rollback = await createProductionBatch({
      providers: {
        echo: (context) => context.success('ok')
      },
      injectInstall: (role, install) => {
        if (role.kind === 'feature' && role.key === 'first-party-provider')
          return async (scope) => {
            const result = (await install(scope)) as Record<PropertyKey, unknown>
            const publicSurface = result.public as object
            rollbackOwner = {
              debugSnapshot: () => {
                const snapshot = readEndpointDebugSnapshot(publicSurface)
                return { providers: snapshot?.providers ?? 0, events: snapshot?.events ?? 0 }
              }
            }
            return result
          }
        if (role.kind === 'activation')
          return async (scope) => {
            await install(scope)
            throw primary
          }
        return install
      }
    })
    await expect(
      rollback.host.installBatch(rollback.translated.map(({ definition }) => definition))
    ).rejects.toMatchObject({ code: 'PLUGIN_INSTALL_FAILED', cause: primary })
    expect(rollbackOwner?.debugSnapshot()).toMatchObject({ providers: 0, events: 0 })
    await rollback.host.dispose()
  })

  it('B12b02 RED: repeats legacy endpoint disposal without a second transport release', async () => {
    const [baseTransport] = createMemoryTransportPair()
    let closeCalls = 0
    const transport = {
      ...baseTransport,
      ownership: 'owned' as const,
      close: () => {
        closeCalls += 1
        baseTransport.close?.()
      }
    }
    const endpoint = await createEndpoint({
      id: 'b12b02-round4-endpoint',
      transport,
      middlewares: [
        authentication({ encrypt: (value) => value, decrypt: (value) => value }),
        connect({ transport })
      ]
    })
    const firstDispose = endpoint.dispose()
    expect(endpoint.dispose()).toBe(firstDispose)
    await firstDispose
    await endpoint.dispose()
    expect(closeCalls).toBe(1)
  })

  it('B12b02 RED: snapshots authentication at install and connect at factory with one read and receiver semantics', async () => {
    const authenticationReads: string[] = []
    let encrypt = (value: unknown): unknown => `auth:${String(value)}`
    let decrypt = (value: unknown): unknown => `plain:${String(value)}`
    const authenticationConfig = {
      get encrypt() {
        authenticationReads.push('encrypt')
        return encrypt
      },
      get decrypt() {
        authenticationReads.push('decrypt')
        return decrypt
      },
      get encodedType() {
        authenticationReads.push('encodedType')
        return 'string' as const
      }
    }
    const connectReads: string[] = []
    let identifier = function (this: unknown): boolean {
      connectReads.push(this === undefined ? 'identifier.undefined' : 'identifier.receiver')
      return true
    }
    const connectConfig = new Proxy(
      {
        useBaseIdVerifyOnly: false as const,
        identifier,
        receiverSelector: () => 'receiver',
        uniqueTargetId: 'snapshot-target',
        discoveryMode: 'manual' as const
      },
      {
        get(target, key, receiver) {
          connectReads.push(String(key))
          return Reflect.get(target, key, receiver)
        }
      }
    )
    const batch = await createProductionBatch({
      authenticationMiddleware: authentication(authenticationConfig),
      connectMiddleware: connect(connectConfig)
    })
    expect(connectReads).toEqual([
      'transport',
      'identifier',
      'useBaseIdVerifyOnly',
      'uniqueTargetId',
      'discoveryMode',
      'receiverSelector'
    ])
    identifier = () => false
    await batch.host.installBatch(batch.translated.map(({ definition }) => definition))
    encrypt = () => 'mutated'
    decrypt = () => 'mutated'
    expect(authenticationReads).toEqual(['encrypt', 'decrypt', 'encodedType'])
    const authenticationCapability = batch.host.getShared(WebRpcSharedKey.authentication) as
      | IWebRpcAuthenticationCapability
      | undefined
    const connectCapability = batch.host.getShared(WebRpcSharedKey.connect) as
      | IWebRpcConnectCapability
      | undefined
    expect(
      await authenticationCapability?.protect('x', {
        direction: 'outbound',
        endpointId: 'b12a-production-1',
        platform: 'Memory'
      })
    ).toBe('auth:x')
    const capturedIdentifier = connectCapability?.identifier
    expect(await capturedIdentifier?.({} as never)).toBe(true)
    expect(connectReads).toContain('identifier.undefined')
    expect(connectReads.filter((key) => key === 'identifier')).toHaveLength(1)
    await batch.host.dispose()
  })

  it.each(['authentication', 'connect'] as const)(
    'B12b02 RED: admits exactly one %s provider, rejects forged keys, and isolates removal',
    async (role) => {
      const key = WebRpcSharedKey[role]
      const first = await createProductionBatch()
      const second = await createProductionBatch()
      await first.host.installBatch(first.translated.map(({ definition }) => definition))
      await second.host.installBatch(second.translated.map(({ definition }) => definition))
      const firstPort = first.host.getShared(key)
      const secondPort = second.host.getShared(key)
      expect(firstPort).toBeDefined()
      expect(secondPort).toBeDefined()
      expect(firstPort).not.toBe(secondPort)
      expect(first.host.getShared(role)).toBeUndefined()
      expect(first.host.getShared(Symbol(`web-rpc.shared.${role}`))).toBeUndefined()
      const entry = first.inventory.find(
        (item) => item.role.kind === 'middleware' && item.role.name === role
      )
      expect(entry?.descriptor.sharedProvides).toEqual([key])
      const duplicate = entry && {
        ...entry.descriptor,
        name: `${entry.descriptor.name}-duplicate`,
        sharedProvides: [key]
      }
      if (duplicate) {
        expect(() => preflightFeatureClaims([...first.descriptors, duplicate])).toThrow()
      }
      await first.host.dispose()
      expect(second.host.getShared(key)).toBe(secondPort)
      await second.host.dispose()
    }
  )

  it.each(['authentication', 'connect'] as const)(
    'B12b02 RED: rejects admitted-but-unpublished %s runtime output before activation',
    async (missingRole) => {
      let batch!: IProductionBatch
      let activationStarted = false
      batch = await createProductionBatch({
        injectRuntimeOutput: (role, phase, output) =>
          role.kind === 'feature' && role.key === 'endpoint-capabilities' && phase === 'shared'
            ? Object.fromEntries(
                Reflect.ownKeys(output)
                  .filter((key) => key !== WebRpcSharedKey[missingRole])
                  .map((key) => [key, output[key]])
              )
            : output,
        onActivationPreflight: (_state, getShared) => {
          activationStarted = true
          expect(getShared(WebRpcSharedKey[missingRole])).toBeUndefined()
        }
      })
      const hostKeysBefore = Reflect.ownKeys(batch.host)
      const entry = batch.inventory.find(
        (item) => item.role.kind === 'middleware' && item.role.name === missingRole
      )
      expect(entry?.descriptor.sharedProvides).toEqual([WebRpcSharedKey[missingRole]])
      let failure: unknown
      try {
        await batch.host.installBatch(batch.translated.map(({ definition }) => definition))
      } catch (error) {
        failure = error
      }
      expect(failure).toMatchObject({
        code: 'PLUGIN_INSTALL_FAILED',
        detail: { failedName: 'activation' }
      })
      /** Native preflight runs, but the absent shared claim prevents ingress activation. */
      expect(activationStarted).toBe(true)
      expect(batch.stats.subscribeCalls).toBe(0)
      expect(batch.stats.activeSubscriptions).toBe(0)
      expect(batch.stats.dispatches).toBe(0)
      expect(batch.isActivated()).toBe(false)
      expect(batch.kernel.state).toBe('disposed')
      expect(batch.getRuntimeState()).toMatchObject({ activated: true })
      expect(batch.host.getShared(WebRpcSharedKey.authentication)).toBeUndefined()
      expect(batch.host.getShared(WebRpcSharedKey.connect)).toBeUndefined()
      expect(batch.host.getShared(WebRpcSharedKey.outboundAttachment)).toBeUndefined()
      expect(Reflect.ownKeys(batch.host)).toEqual(hostKeysBefore)
      await batch.host.dispose()
    }
  )

  it('B12b02 RED: closes owned success once, borrowed success zero, and repeats Host dispose Promise', async () => {
    const owned = await createProductionBatch({ transportOwnership: 'owned' })
    await owned.host.installBatch(owned.translated.map(({ definition }) => definition))
    const ownedDispose = owned.host.dispose()
    expect(owned.host.dispose()).toBe(ownedDispose)
    await ownedDispose
    expect(owned.stats.closeCalls).toBe(1)

    const borrowed = await createProductionBatch({ transportOwnership: 'borrowed' })
    await borrowed.host.installBatch(borrowed.translated.map(({ definition }) => definition))
    const borrowedDispose = borrowed.host.dispose()
    expect(borrowed.host.dispose()).toBe(borrowedDispose)
    await borrowedDispose
    expect(borrowed.stats.closeCalls).toBe(0)
  })

  it.each(['authentication', 'connect'] as const)(
    'B12b02 RED: preserves hostile %s config getter primary and cause identity',
    async (failedRole) => {
      const hostile = new Error(`${failedRole} hostile config getter`)
      const config = new Proxy(
        {},
        {
          get() {
            throw hostile
          }
        }
      )
      let primary: unknown
      const wrappedBatch = await createProductionBatch({
        authenticationMiddleware:
          failedRole === 'authentication' ? authentication(config as never) : undefined,
        connectMiddleware: failedRole === 'connect' ? connect(config as never) : undefined,
        injectInstall: (role, install) => {
          if (role.kind !== 'middleware' || role.name !== failedRole) return install
          return async (scope) => {
            try {
              return await install(scope)
            } catch (error) {
              primary = error
              throw error
            }
          }
        }
      })
      let failure: unknown
      try {
        await wrappedBatch.host.installBatch(
          wrappedBatch.translated.map(({ definition }) => definition)
        )
      } catch (error) {
        failure = error
      } finally {
        await wrappedBatch.host.dispose()
      }
      expect(failure).toMatchObject({ code: 'PLUGIN_INSTALL_FAILED', cause: primary })
      expect(primary).toBeInstanceOf(WebRpcError)
      expect((primary as { readonly cause?: unknown }).cause).toBe(hostile)
      expect(errorChainContains(failure, hostile)).toBe(true)
    }
  )

  it.each(['protect', 'unprotect'] as const)(
    'B12b02 RED: preserves authentication %s transform primary and cause identity',
    async (operation) => {
      const hostile = new Error(`authentication ${operation} hostile transform`)
      const batch = await createProductionBatch({
        authenticationMiddleware: authentication({
          encrypt:
            operation === 'protect'
              ? () => {
                  throw hostile
                }
              : (value) => value,
          decrypt:
            operation === 'unprotect'
              ? () => {
                  throw hostile
                }
              : (value) => value
        })
      })
      await batch.host.installBatch(batch.translated.map(({ definition }) => definition))
      const capability = batch.host.getShared(
        WebRpcSharedKey.authentication
      ) as IWebRpcAuthenticationCapability
      let failure: unknown
      try {
        await capability[operation]('value', {
          direction: operation === 'protect' ? 'outbound' : 'inbound',
          endpointId: `b12b02-auth-${operation}`,
          platform: 'Memory'
        })
      } catch (error) {
        failure = error
      } finally {
        await batch.host.dispose()
      }
      expect(failure).toMatchObject({ code: 'AUTHENTICATION_FAILED', cause: hostile })
      expect(errorChainContains(failure, hostile)).toBe(true)
    }
  )

  it('B12b02 RED: preserves install primary and exact AggregateError rollback identities/order', async () => {
    const primary = new Error('authentication-connect install primary')
    const authenticationCleanup = new AggregateError(
      [new Error('authentication cleanup one'), new Error('authentication cleanup two')],
      'authentication cleanup'
    )
    const connectCleanup = new AggregateError(
      [new Error('connect cleanup one'), new Error('connect cleanup two')],
      'connect cleanup'
    )
    const batch = await createProductionBatch({
      injectInstall: (role, install) => {
        if (
          role.kind === 'middleware' &&
          (role.name === 'authentication' || role.name === 'connect')
        )
          return async (scope) => {
            const result = await install(scope)
            const cleanup = role.name === 'authentication' ? authenticationCleanup : connectCleanup
            scope.own({}, () => {
              throw cleanup
            })
            return result
          }
        if (role.kind === 'activation')
          return () => {
            throw primary
          }
        return install
      }
    })
    let failure: unknown
    try {
      await batch.host.installBatch(batch.translated.map(({ definition }) => definition))
    } catch (error) {
      failure = error
    } finally {
      await batch.host.dispose()
    }
    expect(failure).toMatchObject({ code: 'PLUGIN_INSTALL_FAILED', cause: primary })
    const rollbackErrors = (
      failure as { readonly detail?: { readonly rollbackErrors?: readonly unknown[] } }
    ).detail?.rollbackErrors
    expect(rollbackErrors).toHaveLength(2)
    const rollbackEntries = rollbackErrors ?? []
    const connectErrors = (rollbackEntries[0] as AggregateError).errors
    const authenticationErrors = (rollbackEntries[1] as AggregateError).errors
    expect(connectErrors).toEqual([connectCleanup])
    expect(authenticationErrors).toEqual([authenticationCleanup])
    expect(connectErrors[0]).toBe(connectCleanup)
    expect(authenticationErrors[0]).toBe(authenticationCleanup)
  })

  it.each(['authentication', 'connect'] as const)(
    'B12b02 RED: preserves each hostile %s cleanup AggregateError children and outer order',
    async (hostileRole) => {
      const primary = new Error(`${hostileRole} aggregate primary`)
      const hostileChildren = [
        new Error(`${hostileRole} cleanup one`),
        new Error(`${hostileRole} cleanup two`)
      ]
      const otherRole = hostileRole === 'authentication' ? 'connect' : 'authentication'
      const otherChildren = [
        new Error(`${otherRole} cleanup one`),
        new Error(`${otherRole} cleanup two`)
      ]
      const hostileCleanup = new AggregateError(hostileChildren, `${hostileRole} cleanup`)
      const otherCleanup = new AggregateError(otherChildren, `${otherRole} cleanup`)
      const batch = await createProductionBatch({
        injectInstall: (role, install) => {
          if (
            role.kind === 'middleware' &&
            (role.name === 'authentication' || role.name === 'connect')
          )
            return async (scope) => {
              const result = await install(scope)
              const cleanup = role.name === hostileRole ? hostileCleanup : otherCleanup
              scope.own({}, () => {
                throw cleanup
              })
              return result
            }
          if (role.kind === 'activation')
            return () => {
              throw primary
            }
          return install
        }
      })
      let failure: unknown
      try {
        await batch.host.installBatch(batch.translated.map(({ definition }) => definition))
      } catch (error) {
        failure = error
      } finally {
        await batch.host.dispose()
      }
      expect(failure).toMatchObject({ code: 'PLUGIN_INSTALL_FAILED', cause: primary })
      const rollbackErrors = (
        failure as { readonly detail?: { readonly rollbackErrors?: readonly unknown[] } }
      ).detail?.rollbackErrors
      expect(rollbackErrors).toHaveLength(2)
      const expectedOuter =
        hostileRole === 'authentication'
          ? [otherCleanup, hostileCleanup]
          : [hostileCleanup, otherCleanup]
      expect(
        (rollbackErrors ?? []).map((error) =>
          error instanceof AggregateError ? error.errors[0] : error
        )
      ).toEqual(expectedOuter)
      const hostileOuter = rollbackErrors?.find(
        (error) => error instanceof AggregateError && error.errors[0] === hostileCleanup
      ) as AggregateError | undefined
      expect(hostileOuter).toBeDefined()
      const hostileOuterErrors = hostileOuter?.errors ?? []
      expect(hostileOuterErrors).toEqual([hostileCleanup])
      const hostileErrors = (hostileOuterErrors[0] as AggregateError).errors
      expect(hostileErrors).toEqual(hostileChildren)
      expect(hostileErrors[0]).toBe(hostileChildren[0])
      expect(hostileErrors[1]).toBe(hostileChildren[1])
    }
  )

  it('B12b02 RED: releases authentication/connect resources in exact reverse order once', async () => {
    const released: string[] = []
    const primary = new Error('activation rollback primary')
    const batch = await createProductionBatch({
      injectInstall: (role, install) => {
        if (
          role.kind === 'middleware' &&
          (role.name === 'authentication' || role.name === 'connect')
        )
          return async (scope) => {
            const result = await install(scope)
            scope.own({}, () => {
              released.push(role.name)
            })
            return result
          }
        if (role.kind === 'activation')
          return () => {
            throw primary
          }
        return install
      }
    })
    await expect(
      batch.host.installBatch(batch.translated.map(({ definition }) => definition))
    ).rejects.toMatchObject({ code: 'PLUGIN_INSTALL_FAILED', cause: primary })
    expect(released).toEqual(['connect', 'authentication'])
    expect(new Set(released).size).toBe(2)
    const firstDispose = batch.host.dispose()
    expect(batch.host.dispose()).toBe(firstDispose)
    await firstDispose
    expect(released).toEqual(['connect', 'authentication'])
    await batch.host.dispose()
    expect(released).toEqual(['connect', 'authentication'])
  })

  it.each(['authentication', 'connect'] as const)(
    'B12b02 RED: closes owned transport once and leaves borrowed %s partial failure closed',
    async (failedRole) => {
      const owned = await createProductionBatch({
        transportOwnership: 'owned',
        injectInstall: (role, install) =>
          role.kind === 'middleware' && role.name === failedRole
            ? () => {
                throw new Error(`${failedRole} partial failure`)
              }
            : install
      })
      await expect(
        owned.host.installBatch(owned.translated.map(({ definition }) => definition))
      ).rejects.toMatchObject({ code: 'PLUGIN_INSTALL_FAILED' })
      expect(owned.stats.closeCalls).toBe(1)
      const ownedDispose = owned.host.dispose()
      expect(owned.host.dispose()).toBe(ownedDispose)
      await ownedDispose
      await owned.host.dispose()
      expect(owned.stats.closeCalls).toBe(1)

      const borrowed = await createProductionBatch({
        transportOwnership: 'borrowed',
        injectInstall: (role, install) =>
          role.kind === 'middleware' && role.name === failedRole
            ? () => {
                throw new Error(`${failedRole} borrowed partial failure`)
              }
            : install
      })
      await expect(
        borrowed.host.installBatch(borrowed.translated.map(({ definition }) => definition))
      ).rejects.toMatchObject({ code: 'PLUGIN_INSTALL_FAILED' })
      expect(borrowed.stats.closeCalls).toBe(0)
      await borrowed.host.dispose()
      await borrowed.host.dispose()
      expect(borrowed.stats.closeCalls).toBe(0)
    }
  )

  it('B12b02 RED: preserves transport close failure cause and repeated Host dispose Promise identity', async () => {
    const closeFailure = new Error('transport close failure')
    const batch = await createProductionBatch({
      transportOwnership: 'owned',
      transportCloseError: closeFailure
    })
    await batch.host.installBatch(batch.translated.map(({ definition }) => definition))
    const firstDispose = batch.host.dispose()
    expect(batch.host.dispose()).toBe(firstDispose)
    let failure: unknown
    try {
      await firstDispose
    } catch (error) {
      failure = error
    }
    expect(errorChainContains(failure, closeFailure)).toBe(true)
    expect(batch.stats.closeCalls).toBe(1)
  })

  it('B12b02 RED: keeps activation primary while ordered owned close cleanup remains reachable', async () => {
    const primary = new Error('activation install primary')
    const closeFailure = new Error('owned transport close cleanup failure')
    const batch = await createProductionBatch({
      transportOwnership: 'owned',
      transportCloseError: closeFailure,
      injectInstall: (role, install) => {
        if (role.kind !== 'activation') return install
        return async (scope) => {
          await install(scope)
          throw primary
        }
      }
    })
    let failure: unknown
    try {
      await batch.host.installBatch(batch.translated.map(({ definition }) => definition))
    } catch (error) {
      failure = error
    } finally {
      try {
        await batch.host.dispose()
      } catch {
        // The close failure is asserted through the original install failure below.
      }
    }
    expect(failure).toMatchObject({ code: 'PLUGIN_INSTALL_FAILED', cause: primary })
    expect((failure as { readonly cause?: unknown }).cause).toBe(primary)
    expect(errorChainContains(failure, primary)).toBe(true)
    expect(errorChainContains(failure, closeFailure)).toBe(true)
    const rollbackErrors = (
      failure as { readonly detail?: { readonly rollbackErrors?: readonly unknown[] } }
    ).detail?.rollbackErrors
    const orderedCleanup = (rollbackErrors ?? []).flatMap((error) =>
      error instanceof AggregateError ? [...error.errors] : [error]
    )
    expect(orderedCleanup).toEqual([closeFailure])
    expect(batch.stats.closeCalls).toBe(1)
  })

  it('B12b02 RED: leaves no activation, shared, extension, registry, kernel, or projection residue', async () => {
    const primary = new Error('connect residue primary')
    const batch = await createProductionBatch({
      injectInstall: (role, install) =>
        role.kind === 'middleware' && role.name === 'connect'
          ? () => {
              throw primary
            }
          : install,
      injectConstructionGate: (role) => role.kind === 'middleware' && role.name === 'timeout'
    })
    const hostKeysBefore = Reflect.ownKeys(batch.host)
    await expect(
      batch.host.installBatch(batch.translated.map(({ definition }) => definition))
    ).rejects.toMatchObject({ code: 'PLUGIN_INSTALL_FAILED' })
    expect(batch.isActivated()).toBe(false)
    expect(batch.stats.activeSubscriptions).toBe(0)
    expect(batch.stats.subscribeCalls).toBe(0)
    expect(batch.stats.dispatches).toBe(0)
    expect(batch.kernel.state).toBe('disposed')
    expect(batch.getRuntimeState()).toBeUndefined()
    expect(Reflect.ownKeys(batch.host)).toEqual(hostKeysBefore)
    expect(batch.host.getShared(WebRpcSharedKey.authentication)).toBeUndefined()
    expect(batch.host.getShared(WebRpcSharedKey.connect)).toBeUndefined()
    await batch.host.dispose()
  })

  it('B12b02 rejects a second composed close owner after legacy cleanup deletion', () => {
    const source = (relativePath: string): string =>
      readFileSync(new URL(relativePath, import.meta.url), 'utf8')
    const bootstrapSource = source('../../src/internal/endpoint-bootstrap.ts')
    const coreSource = source('../../src/core.ts')
    const kernelSource = source('../../src/endpoint-kernel.ts')
    expect((kernelSource.match(/#resources\.add\('transport close'/g) ?? []).length).toBe(1)
    expect(coreSource).toMatch(
      /if \(host\)[\s\S]*?await host\.dispose\(\)[\s\S]*?\} else if \(kernel\)[\s\S]*?\} else \{[\s\S]*?deferred\.transport\.close/
    )
    expect(bootstrapSource).not.toContain('transport.close')
    const hostCleanupBranch = coreSource.match(/if \(host\) \{[\s\S]*?\} else if \(kernel\)/)?.[0]
    expect(hostCleanupBranch).toBeDefined()
    expect(hostCleanupBranch).not.toMatch(/transport\.close/)
  })

  it('B12b03 RED: timeout and abort factories expose native Host plugins', () => {
    const timeoutMiddleware = timeout()
    const abortMiddleware = abort()
    expect(Object.isFrozen(timeoutMiddleware)).toBe(true)
    expect(Object.isFrozen(abortMiddleware)).toBe(true)
    expect(typeof timeoutMiddleware.install).toBe('function')
    expect(typeof abortMiddleware.install).toBe('function')
  })

  it('B12b03 RED: timeout and abort publish typed shared ports in one Host batch', async () => {
    const batch = await createProductionBatch()
    const timeoutDescriptor = batch.inventory.find(
      (entry) => entry.role.kind === 'middleware' && entry.role.name === 'timeout'
    )?.descriptor
    const abortDescriptor = batch.inventory.find(
      (entry) => entry.role.kind === 'middleware' && entry.role.name === 'abort'
    )?.descriptor
    expect(timeoutDescriptor?.sharedProvides).toEqual([WebRpcSharedKey.timeout])
    expect(abortDescriptor?.sharedProvides).toEqual([plannedAbortEnablementKey])
    expect(abortDescriptor?.sharedProvides).not.toContain(abortTransportKey)
    await batch.host.installBatch(batch.translated.map(({ definition }) => definition))
    expect(batch.host.getShared(WebRpcSharedKey.timeout)).toBeDefined()
    const abortPort = batch.host.getShared(plannedAbortEnablementKey)
    expect(abortPort).toEqual({ enabled: true })
    expect(Object.isFrozen(abortPort)).toBe(true)
    expect(Reflect.ownKeys(abortPort as object)).toEqual(['enabled'])
    expect(Object.getOwnPropertyDescriptor(abortPort as object, 'enabled')).toEqual({
      configurable: false,
      enumerable: true,
      writable: false,
      value: true
    })
    expect(() => Object.defineProperty(abortPort, 'enabled', { value: false })).toThrow()
    expect((abortPort as { readonly enabled: boolean }).enabled).toBe(true)
    await batch.host.dispose()
  })

  it('B12b03 RED: finalize declares timeout and abort as explicit optional consumers', async () => {
    const observed: unknown[] = []
    const batch = await createProductionBatch({
      injectInstall: (role, install) =>
        role.kind === 'middleware-finalize'
          ? async (scope) => {
              observed.push(
                scope.getShared(WebRpcSharedKey.timeout),
                scope.getShared(plannedAbortEnablementKey)
              )
              return install(scope)
            }
          : install
    })
    const finalize = batch.inventory.find(
      (entry) => entry.role.kind === 'middleware-finalize'
    )?.descriptor
    expect(finalize?.sharedOptionalConsumes).toEqual(
      WebRpcFirstPartyRoleSchema['middleware-finalize'].sharedOptionalConsumes
    )
    await batch.host.installBatch(batch.translated.map(({ definition }) => definition))
    expect(observed).toEqual([
      batch.host.getShared(WebRpcSharedKey.timeout),
      batch.host.getShared(plannedAbortEnablementKey)
    ])
    expect(batch.getPrepared()?.options.features?.abort).toBe(true)
    await batch.host.dispose()
  })

  it('B12b03: outbound consumes the finalized prepared abort boolean, not the shared enablement port', () => {
    const source = readFileSync(
      new URL('../../src/internal/outbound-attachment.ts', import.meta.url),
      'utf8'
    )
    expect(source).not.toMatch(/WebRpcSharedKey\.abort/)
    expect(source).toMatch(/prepared\.options\.features\?\.abort/)
  })

  it('B12b03: abort reuses the authorized provider-cancellation shared key', () => {
    expect(WebRpcSharedKey.providerCancellation).toBe(abortTransportKey)
    expect(plannedAbortEnablementKey).not.toBe(abortTransportKey)
  })

  it('B12b03: composed Host installs receive the canonical construction control', async () => {
    let observedSignal: IWebRpcAbortSignal | undefined
    const batch = await createProductionBatch({
      injectInstall: (role, install) => {
        if (role.kind !== 'middleware' || role.name !== 'timeout') return install
        return async (scope) => {
          observedSignal = scope.signal
          return install(scope)
        }
      }
    })
    await batch.host.installBatch(batch.translated.map(({ definition }) => definition))
    expect(observedSignal).toBe(batch.construction.signal)
    await batch.host.dispose()
  })

  it('B12b03: legacy non-deferred construction controller remains an isolated compatibility branch', () => {
    const source = (relativePath: string): string =>
      readFileSync(new URL(relativePath, import.meta.url), 'utf8')
    const bootstrapSource = source('../../src/internal/endpoint-bootstrap.ts')
    expect(bootstrapSource).not.toContain('constructionController')
    expect(bootstrapSource).not.toContain('middlewareDisposers')
  })

  it('B12b03 RED: timeout and abort middleware do not write the legacy capability registry', () => {
    const source = (relativePath: string): string =>
      readFileSync(new URL(relativePath, import.meta.url), 'utf8')
    const timeoutSource = source('../../src/middleware/timeout.ts')
    const abortSource = source('../../src/middleware/abort.ts')
    expect(timeoutSource).not.toMatch(/capabilities\.set/)
    expect(abortSource).not.toMatch(/capabilities\.set/)
  })

  it('B12b03: timeout config getter is read once and legacy middleware remains callable', async () => {
    const [transport] = createMemoryTransportPair()
    let reads = 0
    const config = {
      get timeoutMs(): number {
        reads += 1
        return 0
      }
    }
    const middleware = timeout(config)
    expect(reads).toBe(0)
    const endpoint = await createEndpoint({
      id: 'b12b03-timeout-getter',
      transport,
      middlewares: [connect({ transport }), middleware]
    })
    expect(reads).toBe(1)
    await endpoint.dispose()
  })

  it('B12b03: native timeout install snapshots only after factory creation', async () => {
    let reads = 0
    const config = {
      get timeoutMs(): number {
        reads += 1
        return 10
      }
    }
    const middleware = timeout(config)
    expect(reads).toBe(0)
    const plugin = middleware
    const [transport] = createMemoryTransportPair()
    const result = await plugin.install({
      id: 'b12b03-native-timeout-install',
      transport,
      signal: new AbortController().signal as IWebRpcAbortSignal,
      hooks: () => undefined,
      getShared: () => undefined,
      own: <T>(resource: T) => resource
    })
    expect(reads).toBe(1)
    expect(result.shared[WebRpcSharedKey.timeout]).toBeDefined()
    transport.close?.()
  })

  it('B12b03: timeout snapshots its configuration in receiver-free order', async () => {
    const [transport] = createMemoryTransportPair()
    const reads: string[] = []
    let timeoutReceiver = false
    const config = {
      get timeoutMs(): number {
        timeoutReceiver = this === config
        reads.push('timeoutMs')
        return 25
      }
    }
    const middleware = timeout(config)
    expect(reads).toEqual([])
    const endpoint = await createEndpoint({
      id: 'b12b03-timeout-fields',
      transport,
      middlewares: [connect({ transport }), middleware]
    })
    expect(timeoutReceiver).toBe(true)
    expect(reads).toEqual(['timeoutMs'])
    await endpoint.dispose()
  })

  it('B12b03: abort no-config factory is receiver-free, frozen, and endpoint-local', () => {
    const first = abort()
    const second = abort()
    expect(Object.isFrozen(first)).toBe(true)
    expect(Object.isFrozen(second)).toBe(true)
    expect(first).not.toBe(second)
    expect(first.name).toBe('middleware:abort')
    expect(second.name).toBe('middleware:abort')
  })

  it('B12b03 RED: actual timeout publication is present and isolated per endpoint', async () => {
    const left = await createProductionBatch()
    const right = await createProductionBatch()
    try {
      await left.host.installBatch(left.translated.map(({ definition }) => definition))
      await right.host.installBatch(right.translated.map(({ definition }) => definition))
      const leftTimeout = left.host.getShared(WebRpcSharedKey.timeout)
      const rightTimeout = right.host.getShared(WebRpcSharedKey.timeout)
      expect(leftTimeout).toBeDefined()
      expect(rightTimeout).toBeDefined()
      expect(leftTimeout).not.toBe(rightTimeout)
    } finally {
      await left.host.dispose()
      await right.host.dispose()
    }
  })

  it.each(['timeout', 'abort'] as const)(
    'B12b03: injected %s native-role failure preserves PH01 identity and residue',
    async (failedName) => {
      const primary = new Error(`${failedName} install primary`)
      const batch = await createProductionBatch({
        injectInstall: (role, install) =>
          role.kind === 'middleware' && role.name === failedName
            ? () => {
                throw primary
              }
            : install
      })
      let failure: unknown
      try {
        await batch.host.installBatch(batch.translated.map(({ definition }) => definition))
      } catch (error) {
        failure = error
      }
      expect(failure).toMatchObject({
        code: 'PLUGIN_INSTALL_FAILED',
        cause: primary,
        detail: { failedName: `middleware:${failedName}` }
      })
      expect(batch.stats.activeSubscriptions).toBe(0)
      expect(batch.stats.dispatches).toBe(0)
      expect(batch.kernel.state).toBe('disposed')
      await batch.host.dispose()
    }
  )

  it('B12b03: injected timeout async rejection preserves PH01 primary and full rollback residue', async () => {
    const primary = new Error('timeout async install primary')
    const batch = await createProductionBatch({
      injectInstall: (role, install) =>
        role.kind === 'middleware' && role.name === 'timeout'
          ? async () => {
              await Promise.resolve()
              throw primary
            }
          : install
    })
    const failure = await batch.host
      .installBatch(batch.translated.map(({ definition }) => definition))
      .catch((error: unknown) => error)
    expect(failure).toMatchObject({
      code: 'PLUGIN_INSTALL_FAILED',
      cause: primary,
      detail: { failedName: 'middleware:timeout' }
    })
    expect(batch.stats.activeSubscriptions).toBe(0)
    expect(batch.stats.dispatches).toBe(0)
    expect(batch.kernel.state).toBe('disposed')
    await batch.host.dispose()
  })

  it('B12b03 RED: hostile timeout config keeps the original getter cause and native config error', async () => {
    const [transport] = createMemoryTransportPair()
    const hostile = new Error('timeout config getter')
    let reads = 0
    const config = {
      get timeoutMs(): number {
        reads += 1
        throw hostile
      }
    }
    const middleware = timeout(config)
    expect(reads).toBe(0)
    const endpointPromise = createEndpoint({
      id: 'b12b03-hostile-timeout',
      transport,
      middlewares: [connect({ transport }), middleware]
    })
    expect(reads).toBe(0)
    await expect(endpointPromise).rejects.toMatchObject({ code: 'INVALID_CONFIG', cause: hostile })
    expect(reads).toBe(1)
  })

  it('B12b03 RED: pre-aborted composed construction preserves exact reason identity', async () => {
    const preController = new AbortController()
    const preReason = new DOMException('pre-abort', 'AbortError')
    preController.abort(preReason)
    const pre = await createProductionBatch({
      construction: { signal: preController.signal as IWebRpcAbortSignal }
    })
    const failure = await pre.host
      .installBatch(pre.translated.map(({ definition }) => definition))
      .catch((error: unknown) => error)
    expect(errorChainContains(failure, preReason)).toBe(true)
    await pre.host.dispose()
  })

  it('B12b03: during-install abort is terminal and post-success abort is inert', async () => {
    const duringController = new AbortController()
    let releaseInstall!: () => void
    const during = await createProductionBatch({
      construction: { signal: duringController.signal as IWebRpcAbortSignal },
      injectInstall: (role, install) =>
        role.kind === 'middleware' && role.name === 'timeout'
          ? () =>
              new Promise((resolve) => {
                releaseInstall = () => resolve(install as unknown)
              })
          : install,
      injectConstructionGate: (role) => role.kind === 'middleware' && role.name === 'timeout'
    })
    const installing = during.host.installBatch(
      during.translated.map(({ definition }) => definition)
    )
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    duringController.abort(new DOMException('during-abort', 'AbortError'))
    await expect(installing).rejects.toBeDefined()
    releaseInstall?.()
    await during.host.dispose()

    const afterController = new AbortController()
    const after = await createProductionBatch({
      construction: { signal: afterController.signal as IWebRpcAbortSignal }
    })
    await after.host.installBatch(after.translated.map(({ definition }) => definition))
    afterController.abort(new DOMException('after-success', 'AbortError'))
    expect(after.stats.activeSubscriptions).toBe(1)
    await after.host.dispose()
  })

  it('B12b03: zero and already-expired fake deadlines create no timer and clean once', async () => {
    let timerCalls = 0
    let clearCalls = 0
    const time = {
      now: () => 500,
      setTimeout: () => {
        timerCalls += 1
        return { clear: () => (clearCalls += 1) }
      },
      clearTimeout: () => undefined,
      dispose: () => undefined
    }
    const control = createConstructionControl({
      signal: new AbortController().signal as IWebRpcAbortSignal,
      timeoutMs: 0,
      time
    })
    const [transport] = createMemoryTransportPair()
    await expect(
      runConstructionInstall(
        {
          id: 'b12b03-expired',
          transport,
          control,
          hooks: () => undefined,
          registerScope: () => undefined
        },
        () => ({})
      )
    ).rejects.toMatchObject({ name: 'TimeoutError' })
    expect(control.deadlineAt).toBe(500)
    expect(timerCalls).toBe(0)
    expect(clearCalls).toBe(0)
    control.close()
  })

  it('B12b03: same-tick zero deadline and caller abort have one terminal outcome and no residue', async () => {
    const controller = new AbortController()
    const reason = new DOMException('same-tick construction abort', 'AbortError')
    controller.abort(reason)
    const batch = await createProductionBatch({
      construction: { signal: controller.signal as IWebRpcAbortSignal, timeoutMs: 0 }
    })
    const failure = await batch.host
      .installBatch(batch.translated.map(({ definition }) => definition))
      .catch((error: unknown) => error)
    expect(failure).toMatchObject({ code: 'PLUGIN_INSTALL_FAILED' })
    expect(batch.stats.activeSubscriptions).toBe(0)
    expect(batch.stats.dispatches).toBe(0)
    await batch.host.dispose()
    batch.kernel.completeDispose()
    expect(batch.kernel.state).toBe('disposed')
  })

  it('B12b03 RED: composed operation abort preserves exact caller reason and terminal residue', async () => {
    const [clientTransport, serverTransport] = createMemoryTransportPair()
    const server = await createComposedEndpoint(
      {
        id: 'b12b03-server',
        transport: serverTransport,
        provider: {
          hang: async () => new Promise(() => undefined)
        },
        middlewares: [connect({ transport: serverTransport }), protocol(), abort(), timeout()]
      },
      createProviderFirstPartyRoots()
    )
    const client = await createComposedEndpoint(
      {
        id: 'b12b03-client',
        targetIds: ['b12b03-server'],
        transport: clientTransport,
        middlewares: [connect({ transport: clientTransport }), protocol(), abort(), timeout()]
      },
      createClientFirstPartyRoots()
    )
    const controller = new AbortController()
    const reason = new DOMException('operation abort', 'AbortError')
    const pending = readProjectedSend(client)('b12b03-server', 'hang', null, {
      signal: controller.signal as IWebRpcAbortSignal,
      timeoutMs: false
    })
    controller.abort(reason)
    const failure = await pending.catch((error: unknown) => error)
    expect(failure).toMatchObject({ name: 'AbortError', cause: reason })
    await client.dispose()
    await server.dispose()
  })

  it('B12b03: construction control keeps one absolute fake-time deadline and idempotent close', () => {
    let disposed = 0
    let now = 100
    const time = {
      now: () => now,
      setTimeout: () => ({ clear: () => undefined }),
      clearTimeout: () => undefined,
      dispose: () => {
        disposed += 1
      }
    }
    const control = createConstructionControl({
      signal: new AbortController().signal as IWebRpcAbortSignal,
      timeoutMs: 25,
      time
    })
    expect(control.deadlineAt).toBe(125)
    expect(control.remaining()).toBe(25)
    now = 125
    expect(control.remaining()).toBe(0)
    control.close()
    control.close()
    expect(disposed).toBe(0)
  })

  it('B12b03 RED: construction cancellation preserves the caller reason identity', () => {
    const controller = new AbortController()
    const control = createConstructionControl({
      signal: controller.signal as IWebRpcAbortSignal
    })
    const reason = new DOMException('hostile construction cancellation', 'AbortError')
    controller.abort(reason)
    expect((control.signal as unknown as { readonly reason?: unknown }).reason).toBe(reason)
    control.close()
  })

  it('B12b03: operation owner remains singular while late cancellation is observed', () => {
    expect(() => readFileSync(new URL('../../src/endpoint.ts', import.meta.url), 'utf8')).toThrow()
  })

  it.each([
    ['timeout', WebRpcSharedKey.timeout],
    ['abort', plannedAbortEnablementKey]
  ] as const)(
    'B12b03 RED: admitted native %s key publishes to downstream and removes exactly once',
    async (role, key) => {
      const events: string[] = []
      const observed: unknown[] = []
      const batch = await createProductionBatch({
        injectInstall: (candidate, install) => {
          if (candidate.kind === 'middleware' && candidate.name === role)
            return async (scope) => {
              events.push(`${role}:install`)
              const result = await install(scope)
              scope.own({}, async () => {
                events.push(`${role}:dispose`)
              })
              return result
            }
          if (candidate.kind === 'middleware-finalize')
            return async (scope) => {
              observed.push(scope.getShared(key))
              return install(scope)
            }
          return install
        }
      })
      await batch.host.installBatch(batch.translated.map(({ definition }) => definition))
      const published = batch.host.getShared(key)
      expect(published).toBeDefined()
      expect(observed).toContain(published)
      const first = batch.host.dispose()
      const second = batch.host.dispose()
      expect(second).toBe(first)
      await first
      expect(events).toEqual([`${role}:install`, `${role}:dispose`])
      expect(() => batch.host.getShared(key)).toThrow()
    }
  )

  it('B12b03: generic PluginHost accepts an arbitrary PropertyKey outside first-party role schema', async () => {
    const arbitraryKey = Symbol('generic-plugin-key')
    const arbitraryValue = { marker: 'generic' }
    const generic = definePlugin({
      name: 'generic-key',
      install: () => ({}),
      shared: () => ({ [arbitraryKey]: arbitraryValue })
    })
    const batch = await createProductionBatch()
    await batch.host.installBatch([
      ...batch.translated.map(({ definition }) => definition),
      generic
    ])
    expect(batch.host.getShared(arbitraryKey)).toBe(arbitraryValue)
    await batch.host.dispose()
  })

  it('B12b03: real inventory admits a non-reserved native plugin with an arbitrary shared key', async () => {
    const arbitraryKey = Symbol('custom-native-key')
    const arbitraryValue = Object.freeze({ marker: 'custom-native' })
    const custom = definePlugin({
      name: 'custom-native',
      install: () => ({}),
      shared: () => ({ [arbitraryKey]: arbitraryValue })
    })
    const batch = await createProductionBatch()
    await batch.host.installBatch([...batch.translated.map(({ definition }) => definition), custom])
    expect(batch.host.getShared(arbitraryKey)).toBe(arbitraryValue)
    await batch.host.dispose()
  })

  it.each([
    ['timeout', 'string', 'forged-timeout', WebRpcSharedKey.timeout],
    ['abort', 'symbol', Symbol('forged-abort'), plannedAbortEnablementKey]
  ] as const)(
    'B12b03: real inventory rejects reserved middleware:%s spoof before Host mutation',
    async (role, _kind, forgedKey, _admittedKey) => {
      let installCalls = 0
      const spoof = definePlugin({
        name: `middleware:${role}`,
        claims: emptyClaims,
        sharedProvides: [forgedKey],
        install: async () => {
          installCalls += 1
          return {}
        }
      } as never)
      const batch = await createProductionBatch()
      const before = {
        hostKeys: Reflect.ownKeys(batch.host),
        selectedShared: [WebRpcSharedKey.timeout, plannedAbortEnablementKey].map((key) =>
          batch.host.getShared(key)
        ),
        subscribeCalls: batch.stats.subscribeCalls,
        activeSubscriptions: batch.stats.activeSubscriptions,
        dispatches: batch.stats.dispatches
      }
      let failure: unknown
      try {
        preflightFeatureClaims([
          { name: spoof.name, claims: emptyClaims, sharedProvides: [forgedKey] }
        ])
      } catch (error) {
        failure = error
      }
      expect(failure).toBeInstanceOf(WebRpcConfigurationError)
      expect(failure).toMatchObject({
        source: WEBRPC_SOURCE,
        code: WebRpcErrorCode.invalidConfig,
        message: roleAdmissionMessage(role, 'sharedProvides', forgedKey)
      })
      expect((failure as { readonly cause?: unknown }).cause).toBeUndefined()
      expect(installCalls).toBe(0)
      expect({
        hostKeys: Reflect.ownKeys(batch.host),
        selectedShared: [WebRpcSharedKey.timeout, plannedAbortEnablementKey].map((key) =>
          batch.host.getShared(key)
        ),
        subscribeCalls: batch.stats.subscribeCalls,
        activeSubscriptions: batch.stats.activeSubscriptions,
        dispatches: batch.stats.dispatches
      }).toEqual(before)
      await batch.host.dispose()
    }
  )

  it.each([
    ['timeout', WebRpcSharedKey.timeout],
    ['abort', plannedAbortEnablementKey]
  ] as const)('B12b03: optional absent %s key stays absent without residue', async (_role, key) => {
    const batch = await createProductionBatch(
      key === WebRpcSharedKey.timeout ? { omitTimeout: true } : { omitAbort: true }
    )
    await batch.host.installBatch(batch.translated.map(({ definition }) => definition))
    expect(batch.host.getShared(key)).toBeUndefined()
    await batch.host.dispose()
  })

  it.each([
    ['timeout', WebRpcSharedKey.timeout],
    ['abort', plannedAbortEnablementKey]
  ] as const)(
    'B12b03: admitted %s publication is endpoint-local and rollback-removable',
    async (role, key) => {
      const create = (failConnect = false) =>
        createProductionBatch({
          injectInstall: (candidate, install) =>
            failConnect && candidate.kind === 'middleware' && candidate.name === 'connect'
              ? () => {
                  throw new Error(`${role} rollback primary`)
                }
              : install
        })
      const left = await create()
      const right = await create()
      await Promise.all([
        left.host.installBatch(left.translated.map(({ definition }) => definition)),
        right.host.installBatch(right.translated.map(({ definition }) => definition))
      ])
      const leftValue = left.host.getShared(key)
      const rightValue = right.host.getShared(key)
      expect(leftValue).toBeDefined()
      expect(rightValue).toBeDefined()
      expect(leftValue).not.toBe(rightValue)
      await Promise.all([left.host.dispose(), right.host.dispose()])

      const rollback = await create(true)
      await expect(
        rollback.host.installBatch(rollback.translated.map(({ definition }) => definition))
      ).rejects.toMatchObject({ code: 'PLUGIN_INSTALL_FAILED' })
      expect(rollback.host.getShared(key)).toBeUndefined()
      await rollback.host.dispose()
    }
  )

  it.each([
    ['timeout', 'string', 'web-rpc.forged-timeout', WebRpcSharedKey.timeout],
    ['abort', 'symbol', Symbol('web-rpc.forged-abort'), plannedAbortEnablementKey]
  ] as const)(
    'B12b03 RED: rejects a forged %s %s cancellation shared claim',
    async (role, _label, forgedKey, _plannedKey) => {
      let installCalls = 0
      const forged = definePlugin({
        name: `middleware:${role}`,
        claims: emptyClaims,
        sharedProvides: [forgedKey],
        install: async () => {
          installCalls += 1
        }
      } as never)
      const batch = await createProductionBatch()
      const snapshot = (): Readonly<{
        readonly hostKeys: readonly PropertyKey[]
        readonly shared: readonly unknown[]
        readonly extension: readonly (PropertyDescriptor | undefined)[]
        readonly stats: Readonly<{
          readonly activeSubscriptions: number
          readonly subscribeCalls: number
          readonly dispatches: number
        }>
      }> => ({
        hostKeys: Reflect.ownKeys(batch.host),
        shared: [WebRpcSharedKey.timeout, plannedAbortEnablementKey].map((key) =>
          batch.host.getShared(key)
        ),
        extension: batch.descriptors
          .flatMap(({ claims }) => claims.publicKeys)
          .map((key) => Object.getOwnPropertyDescriptor(batch.host, key)),
        stats: {
          activeSubscriptions: batch.stats.activeSubscriptions,
          subscribeCalls: batch.stats.subscribeCalls,
          dispatches: batch.stats.dispatches
        }
      })
      const before = snapshot()
      let failure: unknown
      try {
        preflightFeatureClaims([
          { name: forged.name, claims: emptyClaims, sharedProvides: [forgedKey] }
        ])
      } catch (error) {
        failure = error
      }
      expect(failure).toBeInstanceOf(WebRpcConfigurationError)
      expect(failure).toMatchObject({
        source: WEBRPC_SOURCE,
        code: WebRpcErrorCode.invalidConfig,
        message: roleAdmissionMessage(role, 'sharedProvides', forgedKey)
      })
      expect((failure as { readonly cause?: unknown } | undefined)?.cause).toBeUndefined()
      expect(snapshot()).toEqual(before)
      expect(installCalls).toBe(0)
      expect(batch.stats.subscribeCalls).toBe(0)
      expect(batch.stats.activeSubscriptions).toBe(0)
      expect(batch.stats.dispatches).toBe(0)
      await batch.host.dispose()
    }
  )

  it('B12b03 RED: hostile first-party metadata preserves the thrown Error as cause', async () => {
    const hostile = new Error('abort role metadata getter')
    let installCalls = 0
    const batch = await createProductionBatch({
      skipPreflight: true,
      injectInstall: (_role, install) => async (scope) => {
        installCalls += 1
        return install(scope)
      }
    })
    /** Legacy descriptors are retired; the native admission record is the pre-Host hostile input. */
    const admissions = batch.admissions.map((original) => {
      if (original.name !== 'middleware:abort') return original
      const forged = { ...original }
      Object.defineProperty(forged, 'sharedProvides', {
        configurable: true,
        enumerable: true,
        get: () => {
          throw hostile
        }
      })
      return forged as IWebRpcClaimAdmission
    })
    const snapshot = (): Readonly<{
      readonly hostKeys: readonly PropertyKey[]
      readonly shared: readonly unknown[]
      readonly extension: readonly (PropertyDescriptor | undefined)[]
      readonly stats: Readonly<{
        readonly activeSubscriptions: number
        readonly subscribeCalls: number
        readonly dispatches: number
      }>
    }> => ({
      hostKeys: Reflect.ownKeys(batch.host),
      shared: [WebRpcSharedKey.timeout, plannedAbortEnablementKey].map((key) =>
        batch.host.getShared(key)
      ),
      extension: batch.descriptors
        .flatMap(({ claims }) => claims.publicKeys)
        .map((key) => Object.getOwnPropertyDescriptor(batch.host, key)),
      stats: {
        activeSubscriptions: batch.stats.activeSubscriptions,
        subscribeCalls: batch.stats.subscribeCalls,
        dispatches: batch.stats.dispatches
      }
    })
    const before = snapshot()
    let failure: unknown
    try {
      preflightFeatureClaims(admissions)
    } catch (error) {
      failure = error
    }
    expect(failure).toBeInstanceOf(WebRpcConfigurationError)
    expect(failure).toMatchObject({
      source: WEBRPC_SOURCE,
      code: WebRpcErrorCode.invalidConfig,
      message: roleAdmissionMessage('abort', 'sharedProvides', undefined),
      cause: hostile
    })
    expect(snapshot()).toEqual(before)
    expect(installCalls).toBe(0)
    expect(batch.stats.subscribeCalls).toBe(0)
    expect(batch.stats.activeSubscriptions).toBe(0)
    expect(batch.stats.dispatches).toBe(0)
    await batch.host.dispose()
  })

  it.each([
    ['timeout', WebRpcSharedKey.timeout],
    ['abort', plannedAbortEnablementKey]
  ] as const)(
    'B12b03 RED: admitted-but-unpublished %s output fails downstream claim parity',
    async (role, key) => {
      const batch = await createProductionBatch({
        injectInstall: (candidate, install) =>
          candidate.kind === 'middleware' && candidate.name === role
            ? async (scope) => {
                const result = await install(scope)
                assertPluginInstallResult(result)
                return Object.freeze({ ...result, shared: Object.freeze({}) })
              }
            : install
      })
      const installed = await batch.host.installBatch(
        batch.translated.map(({ definition }) => definition)
      )
      expect(() =>
        assertFeatureClaimParity(batch.admissions, installed, batch.kernel, {
          activated: batch.isActivated()
        })
      ).toThrow(WebRpcConfigurationError)
      expect(installed.getShared(key)).toBeUndefined()
      await batch.host.dispose()
    }
  )

  it.each([
    ['timeout', WebRpcSharedKey.timeout],
    ['abort', plannedAbortEnablementKey]
  ] as const)(
    'B12b03 RED: duplicate %s providers are rejected before Host mutation',
    async (role, key) => {
      let installCalls = 0
      const batch = await createProductionBatch({
        injectInstall: (_role, install) => async (scope) => {
          installCalls += 1
          return install(scope)
        }
      })
      const before = productionHostSnapshot(batch)
      const duplicate: IWebRpcClaimAdmission = {
        name: `middleware:${role}-duplicate`,
        claims: emptyClaims,
        sharedProvides: [key]
      }
      expect(() => preflightFeatureClaims([...batch.admissions, duplicate])).toThrow(
        WebRpcConfigurationError
      )
      expect(productionHostSnapshot(batch)).toEqual(before)
      expect(installCalls).toBe(0)
      expect(batch.stats.subscribeCalls).toBe(0)
      expect(batch.stats.activeSubscriptions).toBe(0)
      await batch.host.dispose()
    }
  )

  it('B12b03: native timeout snapshot survives post-install mutation', async () => {
    const reads: string[] = []
    let timeoutMs = 7
    const config = {
      get timeoutMs() {
        reads.push('timeoutMs')
        return timeoutMs
      }
    }
    const batch = await createProductionBatch({ timeoutMiddleware: timeout(config) })
    timeoutMs = 99
    await batch.host.installBatch(batch.translated.map(({ definition }) => definition))
    timeoutMs = 101
    const published = batch.host.getShared(WebRpcSharedKey.timeout) as {
      readonly resolveTimeout: (requested?: number | false) => number | false | undefined
      readonly timeoutMs: number | false | undefined
    }
    expect(published.resolveTimeout()).toBe(99)
    expect(published.timeoutMs).toBe(99)
    expect(reads).toEqual(['timeoutMs'])
    await batch.host.dispose()
  })

  it('B12b03 RED: production root cleanup owns same-tick cancellation terminality', async () => {
    const controller = new AbortController()
    const reason = new DOMException('same-tick construction abort', 'AbortError')
    controller.abort(reason)
    const batch = await createProductionBatch({
      construction: { signal: controller.signal as IWebRpcAbortSignal, timeoutMs: 0 }
    })
    const failure = await batch.host
      .installBatch(batch.translated.map(({ definition }) => definition))
      .catch((error: unknown) => error)
    expect(failure).toMatchObject({ code: 'PLUGIN_INSTALL_FAILED' })
    expect(errorChainContains(failure, reason)).toBe(true)
    expect(batch.stats.activeSubscriptions).toBe(0)
    expect(batch.stats.dispatches).toBe(0)
    await batch.host.dispose()
    batch.kernel.completeDispose()
    expect(batch.kernel.state).toBe('disposed')
  })

  it.each(['timeout', 'abort'] as const)(
    'B12b03: real admitted native %s late resolve disposes its result once without diagnostic requirement',
    async (role) => {
      const controller = new AbortController()
      const reason = new DOMException(`${role} during install`, 'AbortError')
      let release!: () => void
      const events: string[] = []
      const batch = await createProductionBatch({
        construction: { signal: controller.signal as IWebRpcAbortSignal },
        injectInstall: (candidate, install) => {
          if (candidate.kind !== 'middleware' || candidate.name !== role) return install
          const key = role === 'timeout' ? WebRpcSharedKey.timeout : plannedAbortEnablementKey
          return async (_scope) => {
            events.push(`${role}:install`)
            await new Promise<void>((resolve) => {
              release = resolve
            })
            return {
              extension: Object.freeze({}),
              shared: Object.freeze({ [key]: Object.freeze({ enabled: true }) }),
              dispose: async () => events.push(`${role}:dispose`)
            }
          }
        }
      })
      const installing = batch.host.installBatch(
        batch.translated.map(({ definition }) => definition)
      )
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
      controller.abort(reason)
      release()
      const failure = await installing.catch((error: unknown) => error)
      try {
        expect(failure).toBeDefined()
        expect(events.filter((event) => event === `${role}:dispose`)).toHaveLength(1)
        expect(batch.stats.activeSubscriptions).toBe(0)
      } finally {
        await batch.host.dispose()
      }
    }
  )

  it.each(['timeout', 'abort'] as const)(
    'B12b03 RED: real admitted native %s late reject reports distinct primary while caller reason remains terminal',
    async (role) => {
      const controller = new AbortController()
      const reason = new DOMException(`${role} late-reject abort`, 'AbortError')
      const latePrimary = new Error(`${role} late-reject primary`)
      let release!: () => void
      const batch = await createProductionBatch({
        construction: { signal: controller.signal as IWebRpcAbortSignal },
        injectInstall: (candidate, install) => {
          if (candidate.kind !== 'middleware' || candidate.name !== role) return install
          return async () => {
            await new Promise<void>((resolve) => {
              release = resolve
            })
            throw latePrimary
          }
        }
      })
      const installing = batch.host.installBatch(
        batch.translated.map(({ definition }) => definition)
      )
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
      controller.abort(reason)
      release()
      const failure = await installing.catch((error: unknown) => error)
      try {
        expect(errorChainContains(failure, reason)).toBe(true)
        await vi.waitFor(() =>
          expect(
            batch.hookEvents.some(
              (event) => event.name === 'failure' && errorChainContains(event.error, latePrimary)
            )
          ).toBe(true)
        )
        expect(batch.stats.activeSubscriptions).toBe(0)
      } finally {
        await batch.host.dispose()
      }
    }
  )

  it('B12b03 RED: native abort async hostile install preserves PH01 and zero residue', async () => {
    const primary = new Error('native abort hostile install')
    const batch = await createProductionBatch({
      injectInstall: (candidate, install) =>
        candidate.kind === 'middleware' && candidate.name === 'abort'
          ? async (scope) => {
              await install(scope)
              throw primary
            }
          : install
    })
    const failure = await batch.host
      .installBatch(batch.translated.map(({ definition }) => definition))
      .catch((error: unknown) => error)
    expect(failure).toMatchObject({
      code: 'PLUGIN_INSTALL_FAILED',
      cause: primary,
      detail: { failedName: 'middleware:abort' }
    })
    expect(batch.stats.activeSubscriptions).toBe(0)
    expect(batch.stats.dispatches).toBe(0)
    expect(batch.kernel.state).toBe('disposed')
    expect(batch.host.getShared(plannedAbortEnablementKey)).toBeUndefined()
    await batch.host.dispose()
  })

  it('B12b03 RED: operation abort-first barrier chooses one terminal identity and clears late provider state', async () => {
    vi.useFakeTimers()
    const [clientTransport, serverTransport] = createMemoryTransportPair()
    let lateResolve!: () => void
    let providerStartedResolve!: () => void
    const providerStarted = new Promise<void>((resolve) => {
      providerStartedResolve = resolve
    })
    const server = await createComposedEndpoint(
      {
        id: 'b12b03-round10-server',
        transport: serverTransport,
        provider: {
          hang: async () =>
            new Promise((resolve) => {
              providerStartedResolve()
              lateResolve = () => resolve({ ok: true })
            })
        },
        middlewares: [connect({ transport: serverTransport }), protocol(), abort(), timeout()]
      },
      createProviderFirstPartyRoots()
    )
    const client = await createComposedEndpoint(
      {
        id: 'b12b03-round10-client',
        targetIds: ['b12b03-round10-server'],
        transport: clientTransport,
        middlewares: [connect({ transport: clientTransport }), protocol(), abort(), timeout()]
      },
      createClientFirstPartyRoots()
    )
    const controller = new AbortController()
    const reason = new DOMException('timeout race caller abort', 'AbortError')
    const pending = readProjectedSend(client)('b12b03-round10-server', 'hang', null, {
      signal: controller.signal as IWebRpcAbortSignal,
      timeoutMs: 1
    })
    const settled = pending.catch((error: unknown) => error)
    await providerStarted
    controller.abort(reason)
    const failure = await settled
    await vi.advanceTimersByTimeAsync(1)
    try {
      expect(failure).toMatchObject({ name: 'AbortError', cause: reason })
    } finally {
      lateResolve?.()
      await vi.runAllTimersAsync()
      await vi.waitFor(() => expect(readEndpointDebugSnapshot(server)?.activeControllers).toBe(0))
      await client.dispose()
      await server.dispose()
      vi.useRealTimers()
    }
  })

  it('B12b03 RED: operation timeout-first barrier remains terminal after a late caller abort', async () => {
    vi.useFakeTimers()
    const [clientTransport, serverTransport] = createMemoryTransportPair()
    let lateResolve!: () => void
    let providerStartedResolve!: () => void
    const providerStarted = new Promise<void>((resolve) => {
      providerStartedResolve = resolve
    })
    const server = await createComposedEndpoint(
      {
        id: 'b12b03-round11-timeout-server',
        transport: serverTransport,
        provider: {
          hang: async () =>
            new Promise((resolve) => {
              providerStartedResolve()
              lateResolve = () => resolve({ ok: true })
            })
        },
        middlewares: [connect({ transport: serverTransport }), protocol(), abort(), timeout()]
      },
      createProviderFirstPartyRoots()
    )
    const client = await createComposedEndpoint(
      {
        id: 'b12b03-round11-timeout-client',
        targetIds: ['b12b03-round11-timeout-server'],
        transport: clientTransport,
        middlewares: [connect({ transport: clientTransport }), protocol(), abort(), timeout()]
      },
      createClientFirstPartyRoots()
    )
    const controller = new AbortController()
    const reason = new DOMException('late caller abort', 'AbortError')
    const pending = readProjectedSend(client)('b12b03-round11-timeout-server', 'hang', null, {
      signal: controller.signal as IWebRpcAbortSignal,
      timeoutMs: 1
    })
    const settled = pending.catch((error: unknown) => error)
    await providerStarted
    await vi.advanceTimersByTimeAsync(1)
    const failure = await settled
    try {
      expect(failure).toMatchObject({ name: 'TimeoutError' })
      controller.abort(reason)
      expect(failure).not.toBe(reason)
    } finally {
      lateResolve?.()
      await Promise.resolve()
      await Promise.resolve()
      expect(readEndpointDebugSnapshot(server)?.activeControllers).toBe(0)
      await client.dispose()
      await server.dispose()
      vi.useRealTimers()
    }
  })

  it('B12b03 RED: real abort-first operation reports a late provider rejection and drains residue', async () => {
    const [clientTransport, serverTransport] = createMemoryTransportPair()
    const reports: unknown[] = []
    const latePrimary = new Error('late provider rejection after caller abort')
    const reason = new DOMException('operation caller abort', 'AbortError')
    let providerStartedResolve!: () => void
    const providerStarted = new Promise<void>((resolve) => {
      providerStartedResolve = resolve
    })
    let releaseReject!: () => void
    const server = await createComposedEndpoint(
      {
        id: 'b12b03-round13-late-reject-server',
        transport: serverTransport,
        provider: {
          hang: async () => {
            providerStartedResolve()
            await new Promise<void>((resolve) => {
              releaseReject = resolve
            })
            throw latePrimary
          }
        },
        middlewares: [
          connect({ transport: serverTransport }),
          protocol(),
          abort(),
          timeout(),
          hooks({ onHookError: (error) => reports.push(error) })
        ]
      },
      createProviderFirstPartyRoots()
    )
    const client = await createComposedEndpoint(
      {
        id: 'b12b03-round13-late-reject-client',
        targetIds: ['b12b03-round13-late-reject-server'],
        transport: clientTransport,
        middlewares: [connect({ transport: clientTransport }), protocol(), abort(), timeout()]
      },
      createClientFirstPartyRoots()
    )
    /** Captures the active server's idle root and operation-observer baseline before send. */
    const idleServer = readEndpointDebugSnapshot(server)
    expect(idleServer).toBeDefined()
    /** Narrows the registered package-test observer after the explicit baseline assertion. */
    const idleServerSnapshot = idleServer!
    expect(idleServerSnapshot.providers).toBe(1)
    const controller = new AbortController()
    const pending = readProjectedSend(client)('b12b03-round13-late-reject-server', 'hang', null, {
      signal: controller.signal as IWebRpcAbortSignal,
      timeoutMs: false
    })
    const settled = pending.catch((error: unknown) => error)
    try {
      await providerStarted
      controller.abort(reason)
      const failure = await settled
      expect(failure).toMatchObject({ name: 'AbortError', cause: reason })
      releaseReject()
      await vi.waitFor(() =>
        expect(reports.some((error) => errorChainContains(error, latePrimary))).toBe(true)
      )
      /** Captures the active server after late settlement but before endpoint disposal. */
      const afterLateReject = readEndpointDebugSnapshot(server)
      expect(afterLateReject).toMatchObject({
        activeControllers: 0,
        pending: 0,
        providers: idleServerSnapshot.providers,
        resources: idleServerSnapshot.resources,
        pingPending: idleServerSnapshot.pingPending,
        chunks: idleServerSnapshot.chunks,
        events: idleServerSnapshot.events,
        hooks: idleServerSnapshot.hooks,
        owners: idleServerSnapshot.owners,
        discovery: idleServerSnapshot.discovery
      })
      expect(readEndpointDebugSnapshot(client)).toMatchObject({ pending: 0 })
    } finally {
      releaseReject?.()
      const clientDispose = client.dispose()
      expect(client.dispose()).toBe(clientDispose)
      const serverDispose = server.dispose()
      expect(server.dispose()).toBe(serverDispose)
      await Promise.all([clientDispose, serverDispose])
      expect(readEndpointDebugSnapshot(client)).toMatchObject({
        phase: 'disposed',
        pending: 0,
        activeControllers: 0,
        providers: 0,
        resources: 0
      })
      expect(readEndpointDebugSnapshot(server)).toMatchObject({
        phase: 'disposed',
        pending: 0,
        activeControllers: 0,
        providers: 0,
        resources: 0
      })
    }
  })

  it('B12b03: Store Worker direct consumers retain both cancellation middleware factories', () => {
    const workerSource = readFileSync(
      new URL('../../../store-worker/src/worker-contract.ts', import.meta.url),
      'utf8'
    )
    const serializeSource = readFileSync(
      new URL('../../../store-worker/src/serialize/worker.ts', import.meta.url),
      'utf8'
    )
    expect(workerSource).toMatch(/abort\(\)/)
    expect(workerSource).toMatch(/timeout\(/)
    expect(serializeSource).toContain('createWorkerContractEndpoint')
  })

  it.each(['hooks', 'ping', 'uuid'] as const)(
    'B12b04 RED: production inventory exposes the exact %s role schema',
    async (role) => {
      const batch = await createProductionBatch()
      try {
        const entry = batch.inventory.find(
          ({ role: candidate }) => candidate.kind === 'middleware' && candidate.name === role
        )
        expect(entry).toBeDefined()
        expect(entry?.descriptor.sharedProvides).toEqual(
          WebRpcFirstPartyRoleSchema[role].sharedProvides
        )
        expect(entry?.descriptor.sharedConsumes).toEqual(
          WebRpcFirstPartyRoleSchema[role].sharedConsumes
        )
        expect(entry?.descriptor.sharedOptionalConsumes).toEqual(
          WebRpcFirstPartyRoleSchema[role].sharedOptionalConsumes
        )
      } finally {
        await batch.host.dispose()
      }
    }
  )

  it('B12b04 RED: production finalizer exposes the exact nine-key optional schema', async () => {
    const batch = await createProductionBatch()
    try {
      const finalizer = batch.inventory.find(
        ({ role }) => role.kind === 'middleware-finalize'
      )?.descriptor
      expect(finalizer).toBeDefined()
      expect(finalizer?.sharedProvides).toEqual(
        WebRpcFirstPartyRoleSchema['middleware-finalize'].sharedProvides
      )
      expect(finalizer?.sharedConsumes).toEqual(
        WebRpcFirstPartyRoleSchema['middleware-finalize'].sharedConsumes
      )
      expect(finalizer?.sharedOptionalConsumes).toEqual(
        WebRpcFirstPartyRoleSchema['middleware-finalize'].sharedOptionalConsumes
      )
    } finally {
      await batch.host.dispose()
    }
  })

  it('B12b04: package role schema and ping port shape are frozen exact contracts', () => {
    expect(Object.isFrozen(WebRpcFirstPartyRoleSchema)).toBe(true)
    for (const role of ['hooks', 'ping', 'uuid', 'middleware-finalize'] as const) {
      const schema = WebRpcFirstPartyRoleSchema[role]
      expect(Object.isFrozen(schema)).toBe(true)
      expect(Object.isFrozen(schema.sharedProvides)).toBe(true)
      expect(Object.isFrozen(schema.sharedConsumes)).toBe(true)
      expect(Object.isFrozen(schema.sharedOptionalConsumes)).toBe(true)
    }
    expect(Object.isFrozen(WebRpcPingEnablePortShape)).toBe(true)
    expect(Reflect.ownKeys(WebRpcPingEnablePortShape)).toEqual(['enabled'])
    expect(Object.getOwnPropertyDescriptor(WebRpcPingEnablePortShape, 'enabled')).toEqual({
      configurable: false,
      enumerable: true,
      writable: false,
      value: true
    })
    expect(WebRpcFirstPartyRoleSchema['middleware-finalize'].sharedOptionalConsumes).toEqual([
      WebRpcSharedKey.protocol,
      WebRpcSharedKey.contract,
      WebRpcSharedKey.authentication,
      WebRpcSharedKey.timeout,
      WebRpcSharedKey.abort,
      WebRpcSharedKey.hooks,
      WebRpcSharedKey.ping,
      WebRpcSharedKey.uuid
    ])
  })

  it.each(['hooks', 'ping', 'uuid'] as const)(
    'B12b04 RED: owning %s file has no legacy registry write and is a native plugin',
    (role) => {
      const source = readFileSync(
        new URL(`../../src/middleware/${role}.ts`, import.meta.url),
        'utf8'
      )
      expect(source).not.toMatch(/capabilities\.set/)
      expect(source).toMatch(/IWebRpcPlugin/)
    }
  )

  it('B12d: no owning middleware file retains the removed compatibility installer', () => {
    const source = readFileSync(
      new URL('../../src/internal/endpoint-bootstrap.ts', import.meta.url),
      'utf8'
    )
    expect(source).not.toMatch(/installPluginForLegacy/)
  })

  // Legacy chunk middleware assertions were removed with that API; framing belongs to rpc-contract.
  it('B12b04: real production builder snapshots hook/uuid factories at install', async () => {
    const reads: string[] = []
    let currentGenerate = () => 'initial-id'
    let currentListeners: readonly (() => void)[] = [() => undefined]
    const hooksConfig = {
      get listeners() {
        reads.push('hooks.listeners')
        return currentListeners
      },
      get onHookError() {
        reads.push('hooks.onHookError')
        return undefined
      }
    }
    const uuidConfig = {
      get generate() {
        reads.push('uuid.generate')
        return currentGenerate
      }
    }
    const batch = await createProductionBatch({
      hooksMiddleware: hooks(hooksConfig),
      uuidMiddleware: uuid(uuidConfig)
    })
    expect(reads).toEqual([])
    await batch.host.installBatch(batch.translated.map(({ definition }) => definition))
    expect(reads).toEqual(['uuid.generate', 'hooks.listeners', 'hooks.onHookError'])
    currentGenerate = () => 'mutated-id'
    currentListeners = []
    expect(batch.getPrepared()?.options.uuid?.generate).toBeDefined()
    expect(
      batch.getPrepared()?.options.uuid?.generate?.({
        variation: 'task',
        senderId: 'sender',
        targetId: 'target'
      })
    ).toBe('initial-id')
    expect(batch.getPrepared()?.options.hooks?.listeners).toHaveLength(1)
    expect(Object.isFrozen(batch.getPrepared()?.options.uuid)).toBe(true)
    expect(Object.isFrozen(batch.getPrepared()?.options.hooks)).toBe(true)
    expect(batch.getPrepared()?.options.hooks?.listeners).not.toBe(currentListeners)
    await batch.host.dispose()
  })

  // D34/D37 retire middleware chunk configuration; rpc-contract owns framer limits and cleanup.
  it('B12b04: selected framers remain endpoint-local across concurrent production batches', async () => {
    const leftFramer = createStringFramer({ chunkBytes: 4 })
    const rightFramer = createStringFramer({ chunkBytes: 8 })
    const [left, right] = await Promise.all([
      createProductionBatch({ framer: leftFramer as unknown as IWebRpcCoreConfig['framer'] }),
      createProductionBatch({ framer: rightFramer as unknown as IWebRpcCoreConfig['framer'] })
    ])
    await Promise.all([
      left.host.installBatch(left.translated.map(({ definition }) => definition)),
      right.host.installBatch(right.translated.map(({ definition }) => definition))
    ])
    const leftSelected = left.getPrepared()?.options.components
      ?.framer as unknown as typeof leftFramer
    const rightSelected = right.getPrepared()?.options.components
      ?.framer as unknown as typeof rightFramer
    const context = { source: 'atomic-framer', messageId: 'shared' }
    expect(leftSelected).not.toBe(leftFramer)
    expect(rightSelected).not.toBe(rightFramer)
    expect(leftSelected).not.toBe(rightSelected)
    const leftFrames = leftSelected.frame('A¢中😀', context)
    const rightFrames = rightSelected.frame('A¢中😀', context)
    expect(leftFrames).toHaveLength(2)
    expect(rightFrames).toHaveLength(1)
    for (const frame of leftFrames.slice(0, -1))
      expect(leftSelected.accept(frame, context)).toEqual({ status: 'pending' })
    expect(leftSelected.accept(leftFrames.at(-1)!, context)).toEqual({
      status: 'complete',
      value: 'A¢中😀'
    })
    expect(rightSelected.accept(rightFrames[0]!, context)).toEqual({
      status: 'complete',
      value: 'A¢中😀'
    })
    const leftDispose = left.host.dispose()
    const rightDispose = right.host.dispose()
    expect(left.host.dispose()).toBe(leftDispose)
    expect(right.host.dispose()).toBe(rightDispose)
    await Promise.all([leftDispose, rightDispose])
    leftFramer.close()
    rightFramer.close()
  })

  it('B12b04 RED: hooks and UUID snapshots preserve receiver, retry freshness, and async install barrier', async () => {
    const reads: string[] = []
    const receivers: unknown[] = []
    const listener = (): void => undefined
    const generate = (): string => 'retry-id'
    const hooksConfig = {
      get listeners() {
        reads.push('hooks.listeners')
        receivers.push(this)
        return [listener]
      },
      get onHookError() {
        reads.push('hooks.onHookError')
        receivers.push(this)
        return undefined
      }
    }
    const uuidConfig = {
      get generate() {
        reads.push('uuid.generate')
        receivers.push(this)
        return generate
      }
    }
    const middleware = hooks(hooksConfig)
    const uuidMiddleware = uuid(uuidConfig)
    const primary = new Error('hooks failed install retry')
    const failed = await createProductionBatch({
      hooksMiddleware: middleware,
      uuidMiddleware,
      injectInstall: (role, install) => {
        if (role.kind !== 'middleware' || role.name !== 'hooks') return install
        return async (scope) => {
          await install(scope)
          throw primary
        }
      }
    })
    await expect(
      failed.host.installBatch(failed.translated.map(({ definition }) => definition))
    ).rejects.toMatchObject({ code: 'PLUGIN_INSTALL_FAILED', cause: primary })
    expect(reads).toEqual(['uuid.generate', 'hooks.listeners', 'hooks.onHookError'])
    expect(receivers.every((receiver) => receiver === uuidConfig || receiver === hooksConfig)).toBe(
      true
    )
    const failedDispose = failed.host.dispose()
    expect(failed.host.dispose()).toBe(failedDispose)
    await failedDispose

    let release!: () => void
    const barrier = new Promise<void>((resolve) => {
      release = resolve
    })
    const retry = await createProductionBatch({
      hooksMiddleware: middleware,
      uuidMiddleware,
      injectInstall: (role, install) =>
        role.kind === 'middleware' && role.name === 'uuid'
          ? async (scope) => {
              await barrier
              return install(scope)
            }
          : install
    })
    const install = retry.host.installBatch(retry.translated.map(({ definition }) => definition))
    await Promise.resolve()
    expect(reads).toEqual(['uuid.generate', 'hooks.listeners', 'hooks.onHookError'])
    release()
    await install
    expect(reads).toEqual([
      'uuid.generate',
      'hooks.listeners',
      'hooks.onHookError',
      'uuid.generate',
      'hooks.listeners',
      'hooks.onHookError'
    ])
    expect(
      receivers.slice(3).every((receiver) => receiver === uuidConfig || receiver === hooksConfig)
    ).toBe(true)
    const retryDispose = retry.host.dispose()
    expect(retry.host.dispose()).toBe(retryDispose)
    await retryDispose
  })

  it.each(['hooks', 'uuid'] as const)(
    'B12b04 T87: independent %s trace proves failed retry, async barrier, and mutation isolation',
    async (role) => {
      const reads: string[] = []
      const receivers: unknown[] = []
      const firstListener = (): void => undefined
      const secondListener = (): void => undefined
      const firstGenerate = (): string => 'first-id'
      const secondGenerate = (): string => 'second-id'
      let currentListeners: readonly (() => void)[] = [firstListener]
      let currentGenerate = firstGenerate
      const hooksConfig = {
        get listeners() {
          reads.push('hooks.listeners')
          receivers.push(this)
          return currentListeners
        },
        get onHookError() {
          reads.push('hooks.onHookError')
          receivers.push(this)
          return undefined
        }
      }
      const uuidConfig = {
        get generate() {
          reads.push('uuid.generate')
          receivers.push(this)
          return currentGenerate
        }
      }
      const config = role === 'hooks' ? hooksConfig : uuidConfig
      const middleware = role === 'hooks' ? hooks(hooksConfig) : uuid(uuidConfig)
      const fields = role === 'hooks' ? ['hooks.listeners', 'hooks.onHookError'] : ['uuid.generate']
      let failFirst = true
      const first = await createProductionBatch({
        ...(role === 'hooks' ? { hooksMiddleware: middleware } : { uuidMiddleware: middleware }),
        injectInstall: (candidate, install) => {
          if (candidate.kind !== 'middleware' || candidate.name !== role) return install
          return async (scope) => {
            const result = await install(scope)
            if (failFirst) {
              failFirst = false
              throw new Error(`${role}-retry-primary`)
            }
            return result
          }
        }
      })
      await expect(
        first.host.installBatch(first.translated.map(({ definition }) => definition))
      ).rejects.toMatchObject({
        code: 'PLUGIN_INSTALL_FAILED',
        detail: { failedName: `middleware:${role}` }
      })
      expect(reads).toEqual(fields)
      expect(receivers.every((receiver) => receiver === config)).toBe(true)
      const firstDispose = first.host.dispose()
      expect(first.host.dispose()).toBe(firstDispose)
      await firstDispose

      let release!: () => void
      const barrier = new Promise<void>((resolve) => {
        release = resolve
      })
      const second = await createProductionBatch({
        ...(role === 'hooks' ? { hooksMiddleware: middleware } : { uuidMiddleware: middleware }),
        injectInstall: (candidate, install) => {
          if (candidate.kind !== 'middleware' || candidate.name !== role) return install
          return async (scope) => {
            await barrier
            return install(scope)
          }
        }
      })
      const install = second.host.installBatch(
        second.translated.map(({ definition }) => definition)
      )
      await Promise.resolve()
      expect(reads).toEqual(fields)
      currentListeners = [secondListener]
      currentGenerate = secondGenerate
      release()
      await install
      expect(reads).toEqual([...fields, ...fields])
      expect(receivers.every((receiver) => receiver === config)).toBe(true)
      if (role === 'hooks') {
        expect(second.getPrepared()?.options.hooks?.listeners).toEqual([secondListener])
      } else {
        expect(second.getPrepared()?.options.uuid?.generate).toBe(secondGenerate)
      }
      const secondDispose = second.host.dispose()
      expect(second.host.dispose()).toBe(secondDispose)
      await secondDispose
    }
  )

  it.each([
    ['hooks', 'listeners'],
    ['hooks', 'onHookError'],
    ['uuid', 'generate']
  ] as const)(
    'B12b04 T87: hostile %s snapshot getter %s preserves exact cutoff and residue',
    async (role, field) => {
      const primary = new Error(`${role}-${field}-getter`)
      const reads: string[] = []
      const receivers: unknown[] = []
      const values: Record<string, unknown> = {
        listeners: [],
        onHookError: undefined,
        generate: () => 'hostile-id'
      }
      let middleware!: IWebRpcPlugin
      let snapshotConfig: unknown
      if (role === 'hooks') {
        const config = {
          get listeners() {
            reads.push('hooks.listeners')
            receivers.push(this)
            if (field === 'listeners') throw primary
            return values.listeners
          },
          get onHookError() {
            reads.push('hooks.onHookError')
            receivers.push(this)
            if (field === 'onHookError') throw primary
            return values.onHookError
          }
        }
        snapshotConfig = config
        middleware = hooks(config as Parameters<typeof hooks>[0])
      } else if (role === 'uuid') {
        const config = {
          get generate() {
            reads.push('uuid.generate')
            receivers.push(this)
            if (field === 'generate') throw primary
            return values.generate
          }
        }
        snapshotConfig = config
        middleware = uuid(config as Parameters<typeof uuid>[0])
      }
      let roleInstallCalls = 0
      const batch = await createProductionBatch({
        ...(role === 'hooks' ? { hooksMiddleware: middleware } : { uuidMiddleware: middleware }),
        injectInstall: (candidate, install) => {
          if (candidate.kind !== 'middleware' || candidate.name !== role) return install
          return async (scope) => {
            roleInstallCalls += 1
            return install(scope)
          }
        }
      })
      const before = productionHostSnapshot(batch)
      let failure: unknown
      try {
        await batch.host.installBatch(batch.translated.map(({ definition }) => definition))
      } catch (error) {
        failure = error
      }
      const fieldOrder =
        role === 'hooks' ? ['hooks.listeners', 'hooks.onHookError'] : ['uuid.generate']
      const cutoff = fieldOrder.indexOf(`${role}.${field}`)
      expect(reads).toEqual(fieldOrder.slice(0, cutoff + 1))
      expect(receivers.every((receiver) => receiver === snapshotConfig)).toBe(true)
      expect(roleInstallCalls).toBe(1)
      expect(errorChainContains(failure, primary)).toBe(true)
      expect(failure).toMatchObject({
        source: '@migaia/plugin-host',
        code: 'PLUGIN_INSTALL_FAILED',
        detail: { failedName: `middleware:${role}` }
      })
      expect((failure as { readonly name?: unknown }).name).toBe('PluginHostError')
      const after = productionHostSnapshot(batch)
      expect(after.hostKeys).toEqual(before.hostKeys)
      expect(after.shared).toEqual(before.shared)
      expect(after.extensions).toEqual(before.extensions)
      expect(batch.stats.subscribeCalls).toBe(0)
      expect(after.stats.activeSubscriptions).toBe(0)
      expect(after.stats.dispatches).toBe(0)
      expect(after.activated).toBe(false)
      expect(after.kernelState).toBe('disposed')
      await batch.host.dispose()
    }
  )

  it('B12b04 RED: real ping factory has no config reads and publishes one frozen endpoint-local enablement', async () => {
    const middleware = ping()
    const left = await createProductionBatch({ pingMiddleware: middleware })
    const right = await createProductionBatch({ pingMiddleware: middleware })
    await left.host.installBatch(left.translated.map(({ definition }) => definition))
    await right.host.installBatch(right.translated.map(({ definition }) => definition))
    const leftPing = left.host.getShared(WebRpcSharedKey.ping)
    const rightPing = right.host.getShared(WebRpcSharedKey.ping)
    expect(leftPing).toEqual({ enabled: true })
    expect(Object.isFrozen(leftPing)).toBe(true)
    expect(leftPing).not.toBe(rightPing)
    expect(left.getPrepared()?.options.features?.ping).toBe(true)
    expect(left.stats.activeSubscriptions).toBe(1)
    const leftDispose = left.host.dispose()
    const rightDispose = right.host.dispose()
    expect(left.host.dispose()).toBe(leftDispose)
    expect(right.host.dispose()).toBe(rightDispose)
    await Promise.all([leftDispose, rightDispose])
  })

  it.each(['hooks', 'ping', 'uuid'] as const)(
    'B12b04 RED: native %s publication is endpoint-local and removed on rollback/dispose',
    async (role) => {
      const batch = await createProductionBatch()
      const key = plannedB12b04Keys[role]
      await batch.host.installBatch(batch.translated.map(({ definition }) => definition))
      expect(batch.host.getShared(key)).toBeDefined()
      const first = batch.host.dispose()
      expect(batch.host.dispose()).toBe(first)
      await first
      expect(() => batch.host.getShared(key)).toThrow()
    }
  )

  it('B12b04: conditional ping enablement and heartbeat cleanup remain legacy-equivalent', async () => {
    const enabled = await createProductionBatch()
    const disabled = await createProductionBatch({ omitPing: true })
    await enabled.host.installBatch(enabled.translated.map(({ definition }) => definition))
    await disabled.host.installBatch(disabled.translated.map(({ definition }) => definition))
    expect(enabled.getPrepared()?.options.features?.ping).toBe(true)
    expect(disabled.getPrepared()?.options.features?.ping).toBeUndefined()
    expect(enabled.stats.activeSubscriptions).toBe(1)
    expect(disabled.stats.activeSubscriptions).toBe(1)
    const enabledDispose = enabled.host.dispose()
    const disabledDispose = disabled.host.dispose()
    expect(enabled.host.dispose()).toBe(enabledDispose)
    expect(disabled.host.dispose()).toBe(disabledDispose)
    await Promise.all([enabledDispose, disabledDispose])
  })

  it.each(['hooks', 'ping', 'uuid'] as const)(
    'B12b04 RED: native %s publication is endpoint-local and terminal removal is exact',
    async (role) => {
      const left = await createProductionBatch()
      const right = await createProductionBatch()
      try {
        await left.host.installBatch(left.translated.map(({ definition }) => definition))
        await right.host.installBatch(right.translated.map(({ definition }) => definition))
        const leftPort = left.host.getShared(plannedB12b04Keys[role])
        const rightPort = right.host.getShared(plannedB12b04Keys[role])
        expect(leftPort).toBeDefined()
        expect(rightPort).toBeDefined()
        expect(leftPort).not.toBe(rightPort)
        const first = left.host.dispose()
        expect(left.host.dispose()).toBe(first)
        await first
        expect(() => left.host.getShared(plannedB12b04Keys[role])).toThrow()
      } finally {
        await right.host.dispose()
        await left.host.dispose()
      }
    }
  )

  it.each(['hooks', 'ping', 'uuid'] as const)(
    'B12b04 RED: native %s duplicate provider is rejected before Host mutation',
    async (role) => {
      const batch = await createProductionBatch()
      const entry = batch.inventory.find(
        ({ role: candidate }) => candidate.kind === 'middleware' && candidate.name === role
      )
      expect(entry).toBeDefined()
      if (!entry) throw new Error(`missing ${role} inventory entry`)
      const duplicate = {
        ...entry.descriptor,
        name: `middleware:${role}-duplicate`,
        sharedProvides: [plannedB12b04Keys[role]]
      }
      expect(() => preflightFeatureClaims([entry.descriptor, duplicate])).toThrow()
      await batch.host.dispose()
    }
  )

  it.each(['hooks', 'ping', 'uuid'] as const)(
    'B12b04 RED: native %s forged string key is rejected before Host mutation',
    async (role) => {
      const batch = await createProductionBatch()
      const entry = batch.inventory.find(
        ({ role: candidate }) => candidate.kind === 'middleware' && candidate.name === role
      )
      expect(entry).toBeDefined()
      if (!entry) throw new Error(`missing ${role} inventory entry`)
      const forged = {
        ...entry.descriptor,
        sharedProvides: [`web-rpc.forged.${role}`]
      }
      const before = productionHostSnapshot(batch)
      expect(() => preflightFeatureClaims([forged])).toThrow()
      expect(productionHostSnapshot(batch)).toEqual(before)
      await batch.host.dispose()
    }
  )

  it.each(['hooks', 'ping', 'uuid'] as const)(
    'B12b04 RED: native %s forged package symbol is rejected before Host mutation',
    async (role) => {
      const batch = await createProductionBatch()
      const entry = batch.inventory.find(
        ({ role: candidate }) => candidate.kind === 'middleware' && candidate.name === role
      )
      expect(entry).toBeDefined()
      if (!entry) throw new Error(`missing ${role} inventory entry`)
      const forged = {
        ...entry.descriptor,
        sharedProvides: [Symbol(`web-rpc.forged.${role}`)]
      }
      const before = productionHostSnapshot(batch)
      expect(() => preflightFeatureClaims([forged])).toThrow()
      expect(productionHostSnapshot(batch)).toEqual(before)
      await batch.host.dispose()
    }
  )

  it.each(
    (['hooks', 'ping', 'uuid'] as const).flatMap((role) =>
      (['sync', 'async'] as const).map((mode) => ({ role, mode }))
    )
  )(
    'B12b04: native $role $mode install failure preserves PH01 primary and zero residue',
    async ({ role, mode }) => {
      const primary = new Error(`${role}-${mode}-primary`)
      const batch = await createProductionBatch({
        injectInstall: (candidate, install) => {
          if (candidate.kind !== 'middleware' || candidate.name !== role) return install
          return mode === 'sync'
            ? () => {
                throw primary
              }
            : async () => {
                await Promise.resolve()
                throw primary
              }
        }
      })
      let failure: unknown
      try {
        await batch.host.installBatch(batch.translated.map(({ definition }) => definition))
      } catch (error) {
        failure = error
      }
      expect(failure).toMatchObject({
        code: 'PLUGIN_INSTALL_FAILED',
        cause: primary,
        detail: { failedName: `middleware:${role}` }
      })
      expect(batch.isActivated()).toBe(false)
      expect(batch.stats.subscribeCalls).toBe(0)
      expect(batch.stats.activeSubscriptions).toBe(0)
      const first = batch.host.dispose()
      expect(batch.host.dispose()).toBe(first)
      await first
    }
  )

  it.each(['hooks', 'ping', 'uuid'] as const)(
    'B12b04 baseline: legacy %s partial rollback is reverse-once with exact cleanup children',
    async (role) => {
      const primary = new Error(`${role}-partial-primary`)
      const firstCleanup = new Error(`${role}-cleanup-first`)
      const secondCleanup = new Error(`${role}-cleanup-second`)
      const releases: string[] = []
      const batch = await createProductionBatch({
        injectInstall: (candidate, install) => {
          if (candidate.kind !== 'middleware' || candidate.name !== role) return install
          return async (scope) => {
            await install(scope)
            scope.own({}, () => {
              releases.push('first')
              throw firstCleanup
            })
            scope.own({}, () => {
              releases.push('second')
              throw secondCleanup
            })
            throw primary
          }
        }
      })
      let failure: unknown
      try {
        await batch.host.installBatch(batch.translated.map(({ definition }) => definition))
      } catch (error) {
        failure = error
      }
      expect(failure).toBeInstanceOf(Error)
      expect(failure).toMatchObject({
        code: 'PLUGIN_INSTALL_FAILED',
        cause: primary,
        detail: { failedName: `middleware:${role}` }
      })
      const rollbackErrors =
        (failure as { readonly detail?: { readonly rollbackErrors?: readonly unknown[] } }).detail
          ?.rollbackErrors ?? []
      const cleanupChildren = rollbackErrors.flatMap((error) =>
        error instanceof AggregateError ? [...error.errors] : [error]
      )
      expect(cleanupChildren).toEqual([secondCleanup, firstCleanup])
      expect(releases).toEqual(['second', 'first'])
      expect(batch.stats.subscribeCalls).toBe(0)
      expect(batch.stats.activeSubscriptions).toBe(0)
      expect(batch.kernel.state).toBe('disposed')
      expect(batch.isActivated()).toBe(false)
      expect(
        [
          WebRpcSharedKey.hooks,
          WebRpcSharedKey.ping,
          WebRpcSharedKey.uuid,
          WebRpcSharedKey.outboundAttachment
        ].every((key) => batch.host.getShared(key) === undefined)
      ).toBe(true)
      const firstDispose = batch.host.dispose()
      expect(batch.host.dispose()).toBe(firstDispose)
      await firstDispose.catch(() => undefined)
    }
  )

  it.each(['hooks', 'ping', 'uuid'] as const)(
    'B12b04 T89: native-shaped %s publication and endpoint disposal share one composed transaction',
    async (role) => {
      const key = plannedB12b04Keys[role]
      const port =
        role === 'hooks'
          ? Object.freeze({ emit: (_event: unknown) => undefined })
          : role === 'ping'
            ? WebRpcPingEnablePortShape
            : Object.freeze({ create: () => `${role}-id` })
      const primary = new Error(`${role}-endpoint-primary`)
      const nativeCleanup = new Error(`${role}-native-cleanup`)
      const releases: string[] = []
      const observedShared: unknown[] = []
      let nativeInstallCalls = 0
      let nativeInstallation: object | undefined
      let consumerInstallation: object | undefined
      let consumerInstallCalls = 0
      const extensionKey = `t89-${role}-extension`
      const schema = WebRpcFirstPartyRoleSchema[role]
      const nativePlugin: IWebRpcPlugin = Object.freeze({
        name: `middleware:${role}`,
        metadata: Object.freeze({
          claims: emptyClaims,
          sharedProvides: schema.sharedProvides,
          sharedConsumes: schema.sharedConsumes,
          sharedOptionalConsumes: schema.sharedOptionalConsumes
        }),
        install: (scope: IWebRpcPluginInstallScope) => {
          nativeInstallCalls += 1
          const installation = Object.freeze({
            extension: Object.freeze({ [extensionKey]: role }),
            shared: Object.freeze({ [key]: port })
          })
          nativeInstallation = installation
          scope.own({}, () => {
            releases.push('native')
            throw nativeCleanup
          })
          return installation
        }
      })
      const consumerPlugin: IWebRpcPlugin = Object.freeze({
        name: `t89-consumer:${role}`,
        metadata: Object.freeze({
          claims: emptyClaims,
          sharedConsumes: Object.freeze([key])
        }),
        install: (scope: IWebRpcPluginInstallScope) => {
          consumerInstallCalls += 1
          observedShared.push(scope.getShared(key))
          const installation = Object.freeze({
            extension: Object.freeze({}),
            shared: Object.freeze({})
          }) as IWebRpcPluginInstallResult
          consumerInstallation = installation
          scope.own({}, () => {
            releases.push('consumer')
            throw primary
          })
          return installation
        }
      })
      const [baseTransport] = createMemoryTransportPair()
      const transport = { ...baseTransport, ownership: 'borrowed' as const }
      const middleware: IWebRpcPlugin[] = [
        protocol(),
        authentication({ encrypt: (value) => value, decrypt: (value) => value }),
        contract(),
        connect({ transport }),
        nativePlugin,
        consumerPlugin,
        ...(role === 'hooks' ? [] : [hooks()]),
        ...(role === 'ping' ? [] : [ping()]),
        ...(role === 'uuid' ? [] : [uuid()]),
        abort(),
        timeout()
      ]
      const endpoint = await createComposedEndpoint(
        { id: `t89-${role}`, transport, middlewares: middleware },
        createFirstPartyRoots(
          new Set<IWebRpcFirstPartyRootName>([
            'first-party-chunk',
            'first-party-outbound',
            'first-party-provider',
            'first-party-discovery',
            'first-party-control'
          ])
        )
      )
      expect(nativeInstallCalls).toBe(1)
      expect(consumerInstallCalls).toBe(1)
      expect(nativeInstallation).toBeDefined()
      expect(consumerInstallation).toBeDefined()
      expect(observedShared).toEqual([port])
      expect(
        (nativeInstallation as { readonly shared: Record<PropertyKey, unknown> }).shared[key]
      ).toBe(port)
      expect(Object.keys((nativeInstallation as { readonly extension: object }).extension)).toEqual(
        [extensionKey]
      )
      const beforeDispose = readEndpointDebugSnapshot(endpoint)
      expect(beforeDispose).toBeDefined()
      expect(beforeDispose?.phase).toBe('active')
      // 宿主由 `defineHost` 产出，没有原型可以监视；等价的观测是它对外的保证：dispose 链恰好执行
      // 一次（重复调用返回同一个 Promise 引用），且端点暴露的失败就是宿主那条链的失败。
      const endpointDispose = endpoint.dispose()
      expect(endpoint.dispose()).toBe(endpointDispose)
      const failure = await endpointDispose.catch((error: unknown) => error)
      expect(failure).toBeInstanceOf(WebRpcLifecycleError)
      expect(failure).toMatchObject({
        source: WEBRPC_SOURCE,
        code: 'ENDPOINT_DISPOSED',
        cause: primary
      })
      expect(errorChainContains(failure, primary)).toBe(true)
      expect(errorChainContains(failure, nativeCleanup)).toBe(true)
      const cleanupErrors = (failure as { readonly cleanupErrors?: readonly unknown[] })
        .cleanupErrors
      expect(cleanupErrors).toEqual([
        { resource: 'resource disposer', error: primary },
        { resource: 'resource disposer', error: nativeCleanup }
      ])
      expect(releases).toEqual(['consumer', 'native'])
      expect(releases.filter((entry) => entry === 'consumer')).toHaveLength(1)
      expect(releases.filter((entry) => entry === 'native')).toHaveLength(1)
      expect(endpoint.dispose()).toBe(endpointDispose)
      const afterDispose = readEndpointDebugSnapshot(endpoint)
      expect(afterDispose).toEqual({
        phase: 'disposed',
        pending: 0,
        pingPending: 0,
        activeControllers: 0,
        chunks: 0,
        providers: 0,
        events: 0,
        hooks: 0,
        resources: 0,
        owners: [],
        discovery: {
          local: 0,
          remote: 0,
          waiters: 0,
          tasks: 0,
          timers: 0,
          manualWaiters: 0,
          inboundQueries: 0,
          inboundTimers: 0
        }
      })
    }
  )

  it('B12b04: production framer seam retains boundary and cleanup ownership', async () => {
    const framer = createStringFramer({ chunkBytes: 4 })
    const batch = await createProductionBatch({
      framer: framer as unknown as IWebRpcCoreConfig['framer']
    })
    await batch.host.installBatch(batch.translated.map(({ definition }) => definition))
    const frames = framer.frame('A¢中😀', { source: 'atomic-framer', messageId: 'boundary' })
    expect(frames.length).toBeGreaterThan(1)
    expect(
      frames.every((frame) => (typeof frame === 'string' ? frame.length : frame.data.length) <= 4)
    ).toBe(true)
    const first = batch.host.dispose()
    expect(batch.host.dispose()).toBe(first)
    await first
    framer.close()
  })

  it.each(['hooks', 'uuid'] as const)(
    'B12b04: hostile %s configuration preserves primary/cause and leaves zero activation residue',
    async (role) => {
      const hostile = new Error(`${role} hostile getter`)
      const middleware =
        role === 'hooks'
          ? hooks({
              get listeners(): never {
                throw hostile
              }
            } as never)
          : uuid({
              get generate(): never {
                throw hostile
              }
            } as never)
      const batch = await createProductionBatch(
        role === 'hooks' ? { hooksMiddleware: middleware } : { uuidMiddleware: middleware }
      )
      let failure: unknown
      try {
        await batch.host.installBatch(batch.translated.map(({ definition }) => definition))
      } catch (error) {
        failure = error
      }
      expect(failure).toMatchObject({ code: 'PLUGIN_INSTALL_FAILED' })
      expect(errorChainContains(failure, hostile)).toBe(true)
      expect(batch.isActivated()).toBe(false)
      expect(batch.stats.subscribeCalls).toBe(0)
      expect(batch.stats.activeSubscriptions).toBe(0)
      await batch.host.dispose()
    }
  )
})

describe('B12c01 outbound feature production-seam matrix', () => {
  /** Asserts the exact frozen own-key contract for a typed shared port. */
  function expectFrozenPort(value: unknown, keys: readonly string[]): void {
    expect(value).toBeDefined()
    expect(Object.isFrozen(value)).toBe(true)
    expect(Reflect.ownKeys(value as object)).toEqual(keys)
    for (const key of keys) {
      expect(Object.getOwnPropertyDescriptor(value as object, key)).toEqual({
        configurable: false,
        enumerable: true,
        writable: false,
        value: expect.any(Function)
      })
    }
  }

  /** Returns the single Host-owned Feature that admits all first-party endpoint capabilities. */
  function findCapabilitiesEntry(batch: IProductionBatch): IProductionNativeEntry {
    const entry = batch.inventory.find(
      ({ role }) => role.kind === 'feature' && role.key === 'endpoint-capabilities'
    )
    if (!entry) throw new Error('endpoint capabilities production inventory entry missing')
    return entry
  }

  /** Builds a frozen temporary facade around the real broad owner for compatibility-only tests. */
  async function drainBatchTurns(): Promise<void> {
    for (let index = 0; index < 12; index += 1) await Promise.resolve()
  }

  it('T90 B12c01 RED: outbound inventory claims exact narrow shared ports', async () => {
    const batch = await createProductionBatch()
    try {
      const entry = findCapabilitiesEntry(batch)
      expect(entry.descriptor.name).toBe('endpoint-capabilities')
      expect(entry.descriptor.claims.routes).toEqual(
        expect.arrayContaining(['response', 'variation'])
      )
      expect(entry.descriptor.claims.publicKeys).toEqual(
        expect.arrayContaining(['send', 'sendAll', 'dispatch', 'dispatchAll'])
      )
      expect(entry.descriptor.sharedProvides).toEqual(
        expect.arrayContaining([
          WebRpcSharedKey.inboundIdentity,
          WebRpcSharedKey.variationCoordinator,
          WebRpcSharedKey.outboundOperations
        ])
      )
      expect(entry.descriptor.sharedConsumes).toBeUndefined()
    } finally {
      await batch.host.dispose()
    }
  })

  it('T91 B12c01 RED: outbound result uses Host-owned disposal without legacy blanket escape', async () => {
    const batch = await createProductionBatch()
    try {
      const entry = findCapabilitiesEntry(batch)
      expect(entry.descriptor.sharedProvides?.includes(WebRpcSharedKey.outboundAttachment)).toBe(
        false
      )
    } finally {
      await batch.host.dispose()
    }
  })

  it('T92 B12c01 RED: outbound publishes typed operations and identity ports in one Host batch', async () => {
    const batch = await createProductionBatch()
    try {
      await batch.host.installBatch(batch.translated.map(({ definition }) => definition))
      const operations = batch.host.getShared(WebRpcSharedKey.outboundOperations)
      const identity = batch.host.getShared(WebRpcSharedKey.inboundIdentity)
      const variation = batch.host.getShared(WebRpcSharedKey.variationCoordinator)
      expectFrozenPort(operations, ['send'])
      expectFrozenPort(identity, ['verify'])
      expectFrozenPort(variation, ['admit'])
      expect(batch.host.getShared(WebRpcSharedKey.outboundAttachment)).toBeUndefined()
      expect(batch.host.getShared(WebRpcSharedKey.outboundOperations)).toBe(operations)
      expect(batch.host.getShared(WebRpcSharedKey.inboundIdentity)).toBe(identity)
      expect(batch.host.getShared(WebRpcSharedKey.variationCoordinator)).toBe(variation)
    } finally {
      await batch.host.dispose()
    }
  })

  it('T93 B12c01: outbound install does not subscribe or activate before final activation', async () => {
    let release!: () => void
    let entered = false
    let settled = false
    let notifyEntered!: () => void
    const enteredBarrier = new Promise<void>((resolve) => {
      notifyEntered = resolve
    })
    const barrier = new Promise<void>((resolve) => {
      release = resolve
    })
    const batch = await createProductionBatch({
      injectInstall: (role, install) => {
        /**
         * Delay the native activation role; cloning the defined capability Feature loses its
         * factory identity.
         */
        if (role.kind !== 'activation') return install
        return async (scope) => {
          entered = true
          notifyEntered()
          await barrier
          return install(scope)
        }
      }
    })
    let installing: Promise<unknown> | undefined
    try {
      installing = batch.host
        .installBatch(batch.translated.map(({ definition }) => definition))
        .then((result) => {
          settled = true
          return result
        })
      await enteredBarrier
      expect(entered).toBe(true)
      expect(settled).toBe(false)
      expect(batch.stats.subscribeCalls).toBe(0)
      expect(batch.stats.dispatches).toBe(0)
      expect(batch.isActivated()).toBe(false)
      expect(batch.kernel.transport).toBe(batch.transport)
      release()
      await installing
      expect(batch.stats.subscribeCalls).toBe(1)
      expect(batch.isActivated()).toBe(true)
    } finally {
      release()
      await installing?.catch(() => undefined)
      await batch.host.dispose()
    }
  })

  it('T93 B12c01: the untransformed native capability Feature activates one receiver', async () => {
    const batch = await createProductionBatch()
    try {
      await batch.host.installBatch(batch.translated.map(({ definition }) => definition))
      expect(batch.isActivated()).toBe(true)
      expect(batch.stats.subscribeCalls).toBe(1)
      expect(batch.stats.activeSubscriptions).toBe(1)
    } finally {
      await batch.host.dispose()
    }
  })

  it('T94 B12c01 RED: outbound typed ports are endpoint-local and never shared by identity', async () => {
    const left = await createProductionBatch()
    const right = await createProductionBatch()
    try {
      await Promise.all([
        left.host.installBatch(left.translated.map(({ definition }) => definition)),
        right.host.installBatch(right.translated.map(({ definition }) => definition))
      ])
      const keys = [
        WebRpcSharedKey.outboundOperations,
        WebRpcSharedKey.inboundIdentity,
        WebRpcSharedKey.variationCoordinator
      ] as const
      for (const key of keys) {
        const leftPort = left.host.getShared(key)
        const rightPort = right.host.getShared(key)
        expect(leftPort).toBeDefined()
        expect(rightPort).toBeDefined()
        expect(leftPort).not.toBe(rightPort)
      }
      const leftDispose = left.host.dispose()
      expect(left.host.dispose()).toBe(leftDispose)
      await leftDispose
      for (const key of keys) expect(() => left.host.getShared(key)).toThrow()
      expect(right.host.getShared(WebRpcSharedKey.outboundOperations)).toBeDefined()
    } finally {
      await Promise.all([left.host.dispose(), right.host.dispose()])
    }
  })

  it('T95 B12c01 supporting baseline: endpoint construction owns target snapshot before outbound activation', async () => {
    const [clientTransport, serverTransport] = createMemoryTransportPair()
    const sourceTargetIds = ['snapshot-server']
    let targetReads = 0
    const server = await createProviderEndpoint({
      id: 'snapshot-server',
      transport: serverTransport,
      middlewares: [connect({ transport: serverTransport })],
      provider: { echo: (context) => context.success(context.data) }
    })
    const client = await createClientEndpoint({
      id: 'snapshot-client',
      transport: clientTransport,
      middlewares: [connect({ transport: clientTransport })],
      get targetIds(): readonly string[] {
        targetReads += 1
        return sourceTargetIds
      }
    } as never)
    try {
      sourceTargetIds[0] = 'mutated-after-endpoint-snapshot'
      expect(targetReads).toBe(1)
      const result = await client.sendAll('echo', 'snapshot')
      expect(Object.values(result.fulfilled)).toEqual(['snapshot'])
    } finally {
      await Promise.all([client.dispose(), server.dispose()])
    }
  })

  it('T96 B12c01: hostile outbound target getter fails before activation with original cause', async () => {
    const [transport] = createMemoryTransportPair()
    const hostile = new Error('outbound target getter')
    let reads = 0
    const configuration = {
      id: 'hostile-outbound',
      transport,
      middlewares: [connect({ transport })],
      get targetIds(): readonly string[] {
        reads += 1
        throw hostile
      }
    }
    const failure = await createClientEndpoint(configuration as never).catch(
      (error: unknown) => error
    )
    expect(failure).toMatchObject({
      source: WEBRPC_SOURCE,
      code: WebRpcErrorCode.invalidConfig,
      cause: hostile
    })
    expect(reads).toBe(1)
  })

  it('WP2: native framed output needs an opaque sink or concrete authentication before subscribe', async () => {
    const [baseTransport] = createMemoryTransportPair()
    let subscribeCalls = 0
    const transport = {
      ...baseTransport,
      encodedType: 'string' as const,
      subscribe: (listener: Parameters<typeof baseTransport.subscribe>[0]) => {
        subscribeCalls += 1
        return baseTransport.subscribe(listener)
      }
    }
    const nativeFramer = createStringFramer({ chunkBytes: 2 })
    const codec = defineJsonCodec({ version: 1 })
    const rejected = await createClientEndpoint({
      id: 'wp2-native-rejected',
      transport,
      framer: nativeFramer,
      codec,
      middlewares: [connect({ transport })]
    } as never).catch((error: unknown) => error)
    expect(rejected).toMatchObject({ code: WebRpcErrorCode.invalidConfig })
    expect(subscribeCalls).toBe(0)

    const client = await createClientEndpoint({
      id: 'wp2-native-authenticated',
      transport,
      framer: nativeFramer,
      codec,
      middlewares: [
        connect({ transport }),
        authentication({
          encrypt: (value) => String(value),
          decrypt: (value) => value,
          encodedType: 'string'
        })
      ]
    } as never)
    try {
      expect(subscribeCalls).toBe(1)
    } finally {
      await client.dispose()
    }
  })

  it('WP2: directed unknown producers reject concrete string sinks before subscribe', async () => {
    const [base] = createMemoryTransportPair()
    let subscriptions = 0
    const transport = {
      ...base,
      encodedType: 'string' as const,
      subscribe: (listener: Parameters<typeof base.subscribe>[0]) => {
        subscriptions += 1
        return base.subscribe(listener)
      }
    }
    const unknownCodec = {
      id: 'unknown',
      version: 1,
      encodedType: 'unknown' as const,
      encode: (value: unknown) => value,
      decode: (value: unknown) => value
    }
    const customFramer = {
      id: 'custom',
      version: 1,
      inputEncodedType: 'string' as const,
      outputEncodedType: 'unknown' as const,
      frame: (value: string) => [value],
      accept: (value: string) => ({ status: 'complete' as const, value }),
      close: () => undefined
    }
    for (const config of [
      { codec: unknownCodec, framer: createStringFramer(), middlewares: [connect({ transport })] },
      {
        codec: defineJsonCodec({ version: 1 }),
        framer: customFramer,
        middlewares: [connect({ transport })]
      },
      {
        codec: defineJsonCodec({ version: 1 }),
        framer: createStringFramer(),
        middlewares: [
          connect({ transport }),
          authentication({
            encrypt: (value) => value,
            decrypt: (value) => value,
            encodedType: 'any'
          })
        ]
      }
    ]) {
      const failure = await createClientEndpoint({
        id: `wp2-unknown-${subscriptions}`,
        transport,
        ...config
      } as never).catch((error: unknown) => error)
      expect(failure).toMatchObject({ code: WebRpcErrorCode.invalidConfig })
      expect(subscriptions).toBe(0)
    }
  })

  it('WP2: top-level transport shadows one plugin transport before subscription', async () => {
    const [winnerBase] = createMemoryTransportPair()
    const [shadowedBase] = createMemoryTransportPair()
    let winnerSubscriptions = 0
    let shadowedSubscriptions = 0
    const order: string[] = []
    const winner = {
      ...winnerBase,
      subscribe: (listener: Parameters<typeof winnerBase.subscribe>[0]) => {
        winnerSubscriptions += 1
        order.push('subscribe')
        return winnerBase.subscribe(listener)
      }
    }
    const shadowed = {
      ...shadowedBase,
      subscribe: (listener: Parameters<typeof shadowedBase.subscribe>[0]) => {
        shadowedSubscriptions += 1
        return shadowedBase.subscribe(listener)
      }
    }
    const events: IWebRpcHookEvent[] = []
    const client = await createClientEndpoint({
      id: 'wp2-transport-shadow',
      transport: winner,
      middlewares: [
        connect({ transport: shadowed }),
        hooks({
          listeners: [
            (event) => {
              events.push(event)
              order.push(event.name)
            }
          ]
        })
      ]
    } as never)
    try {
      const shadows = events.filter((value) => value.name === 'component-shadowed')
      const event = shadows[0]
      expect(winnerSubscriptions).toBe(1)
      expect(shadowedSubscriptions).toBe(0)
      expect(event).toBeDefined()
      expect(shadows).toHaveLength(1)
      expect(order.indexOf('component-shadowed')).toBeLessThan(order.indexOf('subscribe'))
      expect(Object.isFrozen(event)).toBe(true)
      expect(Object.isFrozen(event?.contract)).toBe(true)
    } finally {
      await client.dispose()
      expect(events.filter((value) => value.name === 'component-shadowed')).toHaveLength(1)
    }
  })

  it('WP2: selected descriptor getters run once without framing during construction', async () => {
    const [transport] = createMemoryTransportPair()
    const events: IWebRpcHookEvent[] = []
    const protocolReads = new Map<string, number>()
    const countedProtocol = new Proxy(
      {},
      {
        get(_target, key) {
          if (typeof key === 'string') protocolReads.set(key, (protocolReads.get(key) ?? 0) + 1)
          return Reflect.get(rpcProtocolV1, key)
        }
      }
    ) as typeof rpcProtocolV1
    const codec = defineJsonCodec({ version: 1 })
    const reads = new Map<string, number>()
    const countedCodec = new Proxy(codec, {
      get(target, key, receiver) {
        if (typeof key === 'string') reads.set(key, (reads.get(key) ?? 0) + 1)
        return Reflect.get(target, key, receiver)
      }
    })
    const framer = createStringFramer()
    const framerReads = new Map<string, number>()
    let frameCalls = 0
    let acceptCalls = 0
    const countedFramer = new Proxy(
      {},
      {
        get(_target, key) {
          if (typeof key === 'string') framerReads.set(key, (framerReads.get(key) ?? 0) + 1)
          if (key === 'frame')
            return (...args: Parameters<typeof framer.frame>) => {
              frameCalls += 1
              return framer.frame(...args)
            }
          if (key === 'accept')
            return (...args: Parameters<typeof framer.accept>) => {
              acceptCalls += 1
              return framer.accept(...args)
            }
          return Reflect.get(framer, key)
        }
      }
    ) as typeof framer
    const componentPlugin = {
      ...connect({ transport }),
      protocol: rpcProtocolV1,
      codec: defineJsonCodec({ version: 2 }),
      framer
    }
    const endpoint = await createClientEndpoint({
      id: 'wp2-getters',
      transport,
      protocol: countedProtocol,
      codec: countedCodec,
      framer: countedFramer,
      middlewares: [
        componentPlugin,
        hooks({
          listeners: [
            (event) => {
              events.push(event)
            }
          ]
        })
      ]
    } as never)
    try {
      expect(frameCalls).toBe(0)
      expect(acceptCalls).toBe(0)
      const shadows = events.filter((event) => event.name === WebRpcErrorText.componentShadowed)
      const isComponentShadow = (event: IWebRpcHookEvent, component: string): boolean =>
        typeof event.contract === 'object' &&
        event.contract !== null &&
        'component' in event.contract &&
        event.contract.component === component
      expect(shadows.filter((event) => isComponentShadow(event, 'protocol'))).toHaveLength(1)
      expect(shadows.filter((event) => isComponentShadow(event, 'codec'))).toHaveLength(1)
      expect(shadows.filter((event) => isComponentShadow(event, 'framer'))).toHaveLength(1)
      expect(shadows).toContainEqual(
        expect.objectContaining({
          contract: {
            component: 'codec',
            winner: { id: 'json', version: 1 },
            shadowed: { id: 'json', version: 2 }
          }
        })
      )
      for (const field of ['id', 'version', 'normalize']) expect(protocolReads.get(field)).toBe(1)
      for (const field of ['id', 'version', 'encodedType', 'encode', 'decode'])
        expect(reads.get(field)).toBe(1)
      for (const field of [
        'id',
        'version',
        'inputEncodedType',
        'outputEncodedType',
        'frame',
        'accept',
        'close'
      ])
        expect(framerReads.get(field)).toBe(1)
    } finally {
      await endpoint.dispose()
    }
  })

  const hostileDescriptorCause = new Error('wp2 hostile descriptor getter')
  const hostileProtocol = { ...rpcProtocolV1 }
  Object.defineProperty(hostileProtocol, 'id', {
    enumerable: true,
    get: () => {
      throw hostileDescriptorCause
    }
  })
  const descriptorCases: readonly [
    string,
    'protocol' | 'codec' | 'framer',
    object,
    Error | undefined
  ][] = [
    ['protocol empty id', 'protocol', { ...rpcProtocolV1, id: '' }, undefined],
    ['protocol zero version', 'protocol', { ...rpcProtocolV1, version: 0 }, undefined],
    [
      'protocol noncallable normalize',
      'protocol',
      { ...rpcProtocolV1, normalize: undefined },
      undefined
    ],
    ['codec empty id', 'codec', { ...defineJsonCodec({ version: 1 }), id: '' }, undefined],
    ['codec zero version', 'codec', { ...defineJsonCodec({ version: 1 }), version: 0 }, undefined],
    [
      'codec invalid encoded type',
      'codec',
      { ...defineJsonCodec({ version: 1 }), encodedType: 'opaque' },
      undefined
    ],
    [
      'codec noncallable encode',
      'codec',
      { ...defineJsonCodec({ version: 1 }), encode: undefined },
      undefined
    ],
    [
      'codec noncallable decode',
      'codec',
      { ...defineJsonCodec({ version: 1 }), decode: undefined },
      undefined
    ],
    ['framer empty id', 'framer', { ...createStringFramer(), id: '' }, undefined],
    ['framer zero version', 'framer', { ...createStringFramer(), version: 0 }, undefined],
    [
      'framer invalid input domain',
      'framer',
      { ...createStringFramer(), inputEncodedType: 'opaque' },
      undefined
    ],
    [
      'framer invalid output domain',
      'framer',
      { ...createStringFramer(), outputEncodedType: 'opaque' },
      undefined
    ],
    [
      'framer noncallable frame',
      'framer',
      { ...createStringFramer(), frame: undefined },
      undefined
    ],
    [
      'framer noncallable accept',
      'framer',
      { ...createStringFramer(), accept: undefined },
      undefined
    ],
    [
      'framer noncallable close',
      'framer',
      { ...createStringFramer(), close: undefined },
      undefined
    ],
    ['protocol throwing id getter', 'protocol', hostileProtocol, hostileDescriptorCause]
  ]

  it.each(descriptorCases)(
    'WP2: rejects invalid selected %s before subscribe',
    async (_name, component, descriptor, cause) => {
      const [baseTransport] = createMemoryTransportPair()
      let subscriptions = 0
      const transport = {
        ...baseTransport,
        subscribe: (listener: Parameters<typeof baseTransport.subscribe>[0]) => {
          subscriptions += 1
          return baseTransport.subscribe(listener)
        }
      }
      const failure = await createClientEndpoint({
        id: 'wp2-invalid-descriptor',
        transport,
        protocol: component === 'protocol' ? descriptor : rpcProtocolV1,
        codec: component === 'codec' ? descriptor : defineJsonCodec({ version: 1 }),
        framer: component === 'framer' ? descriptor : createStringFramer(),
        middlewares: [connect({ transport })]
      } as never).catch((error: unknown) => error)
      expect(failure).toMatchObject({ code: WebRpcErrorCode.invalidConfig })
      expect(subscriptions).toBe(0)
      if (cause !== undefined) expect(errorChainContains(failure, cause)).toBe(true)
    }
  )

  it('WP2: selected transport getters run once when top-level transport shadows a plugin', async () => {
    const [baseTransport] = createMemoryTransportPair()
    const reads = new Map<string, number>()
    let subscriptions = 0
    const transport = new Proxy(
      {},
      {
        get(_target, key) {
          if (typeof key === 'string') reads.set(key, (reads.get(key) ?? 0) + 1)
          if (key === 'subscribe')
            return (listener: Parameters<typeof baseTransport.subscribe>[0]) => {
              subscriptions += 1
              return baseTransport.subscribe(listener)
            }
          return Reflect.get(baseTransport, key)
        }
      }
    ) as typeof baseTransport
    const endpoint = await createClientEndpoint({
      id: 'wp2-transport-getters',
      transport,
      middlewares: [connect({ transport: baseTransport })]
    } as never)
    try {
      expect(subscriptions).toBe(1)
      for (const field of ['platform', 'encodedType', 'ownership']) expect(reads.get(field)).toBe(1)
    } finally {
      await endpoint.dispose()
    }
  })

  it('WP2: selected class transport retains its private method receiver', async () => {
    class PrivateReceiverTransport {
      #subscriptions = 0
      readonly platform = 'Memory' as const
      readonly ownership = 'borrowed' as const

      send(_message: unknown): void {}

      subscribe(
        _listener: Parameters<ReturnType<typeof createMemoryTransportPair>[0]['subscribe']>[0]
      ): () => void {
        this.#subscriptions += 1
        return () => undefined
      }

      get subscriptions(): number {
        return this.#subscriptions
      }
    }
    const [pluginTransport] = createMemoryTransportPair()
    const transport = new PrivateReceiverTransport()
    const endpoint = await createClientEndpoint({
      id: 'wp2-transport-private-receiver',
      transport,
      middlewares: [connect({ transport: pluginTransport })]
    } as never)
    try {
      expect(transport.subscriptions).toBe(1)
    } finally {
      await endpoint.dispose()
    }
  })

  it('WP2: rejects duplicate plugin transports before either transport subscribes', async () => {
    const [firstBase] = createMemoryTransportPair()
    const [secondBase] = createMemoryTransportPair()
    let firstSubscriptions = 0
    let secondSubscriptions = 0
    const first = {
      ...firstBase,
      subscribe: (listener: Parameters<typeof firstBase.subscribe>[0]) => {
        firstSubscriptions += 1
        return firstBase.subscribe(listener)
      }
    }
    const second = {
      ...secondBase,
      subscribe: (listener: Parameters<typeof secondBase.subscribe>[0]) => {
        secondSubscriptions += 1
        return secondBase.subscribe(listener)
      }
    }
    const failure = await createClientEndpoint({
      id: 'wp2-duplicate-transport',
      middlewares: [
        { ...connect({ transport: first }), name: 'wp2-connect-first' },
        { ...connect({ transport: second }), name: 'wp2-connect-second' }
      ]
    } as never).catch((error: unknown) => error)
    expect(failure).toMatchObject({ code: WebRpcErrorCode.capabilityConflict })
    expect(firstSubscriptions).toBe(0)
    expect(secondSubscriptions).toBe(0)
  })

  it('WP2: rejects a missing transport before Host construction', async () => {
    const failure = await createClientEndpoint({
      id: 'wp2-missing-transport',
      middlewares: [connect()]
    } as never).catch((error: unknown) => error)
    expect(failure).toMatchObject({ code: WebRpcErrorCode.invalidConfig })
  })

  it('T97 B12c01: real outbound send and RPC fanout preserve canonical results', async () => {
    const [clientTransport, serverTransport] = createMemoryTransportPair()
    const server = await createProviderEndpoint({
      id: 'rpc-server',
      transport: serverTransport,
      middlewares: [connect({ transport: serverTransport })],
      provider: { echo: (context) => context.success(context.data) }
    })
    const client = await createClientEndpoint({
      id: 'rpc-client',
      transport: clientTransport,
      targetIds: ['rpc-server'],
      middlewares: [connect({ transport: clientTransport })]
    })
    try {
      await expect(client.send('rpc-server', 'echo', 'value')).resolves.toBe('value')
      const fanout = await client.sendAll('echo', 'fanout')
      expect(Object.values(fanout.fulfilled)).toEqual(['fanout'])
      expect(fanout.rejected).toEqual({})
    } finally {
      await Promise.all([client.dispose(), server.dispose()])
    }
  })

  it('T98 B12c01: outbound dispose is host-owned, idempotent, and rejects later sends canonically', async () => {
    const [transport] = createMemoryTransportPair()
    const client = await createClientEndpoint({
      id: 'dispose-client',
      transport,
      middlewares: [connect({ transport })]
    })
    const first = client.dispose()
    expect(client.dispose()).toBe(first)
    await first
    await expect(client.send('target', 'method', null)).rejects.toMatchObject({
      source: WEBRPC_SOURCE,
      code: WebRpcErrorCode.endpointDisposed
    })
  })

  it('T99 B12c01: later activation failure rolls back outbound publication and leaves zero subscription residue', async () => {
    const primary = new Error('activation participant failed')
    const batch = await createProductionBatch({
      injectInstall: (role, install) => {
        if (role.kind !== 'activation') return install
        return async (scope) => {
          await install(scope)
          throw primary
        }
      }
    })
    try {
      const failure = await batch.host
        .installBatch(batch.translated.map(({ definition }) => definition))
        .catch((error: unknown) => error)
      expect(failure).toMatchObject({ code: 'PLUGIN_INSTALL_FAILED', cause: primary })
      expect(batch.stats.subscribeCalls).toBe(1)
      expect(batch.stats.activeSubscriptions).toBe(0)
      expect(batch.host.getShared(WebRpcSharedKey.outboundAttachment)).toBeUndefined()
      expect(batch.host.getShared(WebRpcSharedKey.outboundOperations)).toBeUndefined()
      expect(batch.host.getShared(WebRpcSharedKey.inboundIdentity)).toBeUndefined()
      expect(batch.host.getShared(WebRpcSharedKey.variationCoordinator)).toBeUndefined()
    } finally {
      await batch.host.dispose()
    }
  })

  it('T100 B12c01 RED: outbound cleanup proves exact order, failure identity, and terminal idempotence', async () => {
    const successTrace: IProductionLifecycleTraceEntry[] = []
    const successResources = new Map<string, object>()
    let successOutboundDisposeCalls = 0
    const success = await createProductionBatch({
      lifecycleTrace: successTrace,
      transportOwnership: 'owned',
      injectInstall: (role, install) => {
        if (role.kind === 'feature' && role.key === 'first-party-outbound')
          return async (scope) => {
            const result = await install(scope)
            scope.own(result, () => {
              successOutboundDisposeCalls += 1
              successTrace.push({ kind: 'outbound.release', instance: result as object })
            })
            return result
          }
        if (role.kind !== 'middleware' || !['authentication', 'connect'].includes(role.name))
          return install
        return async (scope) => {
          const result = await install(scope)
          const resource = {}
          successResources.set(role.name, resource)
          scope.own(resource, () => {
            successTrace.push({ kind: `${role.name}.release`, instance: resource })
          })
          return result
        }
      }
    })
    await success.host.installBatch(success.translated.map(({ definition }) => definition))
    const successDispose = success.host.dispose()
    expect(success.host.dispose()).toBe(successDispose)
    await successDispose
    expect(success.host.dispose()).toBe(successDispose)
    expect(success.stats.closeCalls).toBe(1)
    expect(success.stats.activeSubscriptions).toBe(0)
    expect(successOutboundDisposeCalls).toBe(1)
    expect(successTrace.filter(({ kind }) => kind === 'unsubscribe')).toHaveLength(1)
    expect(successTrace.filter(({ kind }) => kind === 'outbound.release')).toHaveLength(1)
    expect(successTrace.filter(({ kind }) => kind === 'connect.release')).toHaveLength(1)
    expect(successTrace.filter(({ kind }) => kind === 'authentication.release')).toHaveLength(1)
    expect(successTrace.find(({ kind }) => kind === 'connect.release')?.instance).toBe(
      successResources.get('connect')
    )
    expect(successTrace.find(({ kind }) => kind === 'authentication.release')?.instance).toBe(
      successResources.get('authentication')
    )
    const successTerminalResidue = productionResidueSnapshot(success)
    expectTerminalResidue(successTerminalResidue)

    const connectFailure = new Error('connect cleanup failure')
    const authenticationFailure = new Error('authentication cleanup failure')
    const outboundFailure = new Error('outbound cleanup failure')
    const transportFailure = new Error('transport cleanup failure')
    const failureTrace: IProductionLifecycleTraceEntry[] = []
    let failureOutboundDisposeCalls = 0
    const failing = await createProductionBatch({
      lifecycleTrace: failureTrace,
      transportOwnership: 'owned',
      transportCloseError: transportFailure,
      injectInstall: (role, install) => {
        if (role.kind === 'feature' && role.key === 'first-party-outbound')
          return async (scope) => {
            const result = await install(scope)
            scope.own(result, () => {
              failureOutboundDisposeCalls += 1
              failureTrace.push({ kind: 'outbound.release', instance: outboundFailure })
              throw outboundFailure
            })
            return result
          }
        if (role.kind !== 'middleware' || !['authentication', 'connect'].includes(role.name))
          return install
        return async (scope) => {
          const result = await install(scope)
          const failure = role.name === 'connect' ? connectFailure : authenticationFailure
          scope.own({}, () => {
            failureTrace.push({ kind: `${role.name}.release`, instance: failure })
            throw failure
          })
          return result
        }
      }
    })
    await failing.host.installBatch(failing.translated.map(({ definition }) => definition))
    const failureDispose = failing.host.dispose()
    expect(failing.host.dispose()).toBe(failureDispose)
    let disposalFailure: unknown
    try {
      await failureDispose
    } catch (error) {
      disposalFailure = error
    }
    expect(disposalFailure).toBeInstanceOf(WebRpcLifecycleError)
    expect(disposalFailure).toMatchObject({
      source: WEBRPC_SOURCE,
      code: WebRpcErrorCode.endpointDisposed,
      cause: outboundFailure
    })
    expect(errorChainContains(disposalFailure, outboundFailure)).toBe(true)
    expect(errorChainContains(disposalFailure, connectFailure)).toBe(true)
    expect(errorChainContains(disposalFailure, authenticationFailure)).toBe(true)
    expect(errorChainContains(disposalFailure, transportFailure)).toBe(true)
    expect(failing.stats.activeSubscriptions).toBe(0)
    expect(failing.stats.closeCalls).toBe(1)
    expect(failureOutboundDisposeCalls).toBe(1)
    expect(failing.host.dispose()).toBe(failureDispose)
    expect(failing.kernel.state).toBe('disposed')
    const failureTerminalResidue = productionResidueSnapshot(failing)
    expectTerminalResidue(failureTerminalResidue)

    const [endpointBaseTransport] = createMemoryTransportPair()
    const endpointOutboundFailure = new Error('endpoint outbound cleanup failure')
    const endpointCloseFailure = new Error('endpoint transport cleanup failure')
    const endpointTransport = {
      ...endpointBaseTransport,
      ownership: 'owned' as const,
      close: () => {
        throw endpointCloseFailure
      }
    }
    let endpointObservedDisposeCalls = 0
    let endpointObservedFailure: unknown
    let endpointObservedCleanupErrors: readonly unknown[] | undefined
    let endpointDisposePromiseWasStable = false
    try {
      const outboundDisposeSpy = vi
        .spyOn(WebRpcOutboundAttachment.prototype, 'dispose')
        .mockImplementation(() => {
          return Promise.reject(endpointOutboundFailure)
        })
      const endpoint = await createClientEndpoint({
        id: 'outbound-disposal-endpoint',
        transport: endpointTransport,
        middlewares: [connect({ transport: endpointTransport })]
      })
      const endpointDispose = endpoint.dispose()
      endpointDisposePromiseWasStable = endpoint.dispose() === endpointDispose
      try {
        await endpointDispose
      } catch (error) {
        endpointObservedFailure = error
      }
      endpointObservedDisposeCalls = outboundDisposeSpy.mock.calls.length
      endpointObservedCleanupErrors = (
        endpointObservedFailure as {
          readonly cleanupErrors?: readonly { readonly error: unknown }[]
        }
      ).cleanupErrors?.map(({ error }) => error)
      expect(endpointDisposePromiseWasStable).toBe(true)
      expect(endpointObservedFailure).toMatchObject({
        source: WEBRPC_SOURCE,
        code: WebRpcErrorCode.endpointDisposed,
        message: WebRpcErrorText.endpointDisposalCleanupFailed
      })
      expect(endpointObservedCleanupErrors).toBeDefined()
      expect(errorChainContains(endpointObservedFailure, endpointCloseFailure)).toBe(true)
      expect(endpoint.dispose()).toBe(endpointDispose)
      outboundDisposeSpy.mockRestore()
    } finally {
      vi.restoreAllMocks()
    }

    expect({
      successTrace: successTrace.map(({ kind }) => kind),
      failureTrace: failureTrace.map(({ kind }) => kind),
      endpointDisposeCalls: endpointObservedDisposeCalls,
      endpointOutboundFailureReachable: errorChainContains(
        endpointObservedFailure,
        endpointOutboundFailure
      ),
      endpointCleanupErrors: endpointObservedCleanupErrors
    }).toEqual({
      successTrace: [
        'unsubscribe',
        'outbound.release',
        'connect.release',
        'authentication.release',
        'transport.close',
        'kernel.completeDispose'
      ],
      failureTrace: [
        'unsubscribe',
        'outbound.release',
        'connect.release',
        'authentication.release',
        'transport.close',
        'kernel.completeDispose'
      ],
      endpointDisposeCalls: 1,
      endpointOutboundFailureReachable: true,
      endpointCleanupErrors: [endpointOutboundFailure, endpointCloseFailure]
    })
  })

  it('B12c01 supporting endpoint seam: send/RPC retains endpoint and disposal Promise identity', async () => {
    const [clientTransport, serverTransport] = createMemoryTransportPair()
    const server = await createProviderEndpoint({
      id: 'store-worker-rpc-server',
      transport: serverTransport,
      middlewares: [connect({ transport: serverTransport })],
      provider: { echo: (context) => context.success(context.data) }
    })
    const client = await createClientEndpoint({
      id: 'store-worker-rpc-client',
      transport: clientTransport,
      targetIds: ['store-worker-rpc-server'],
      middlewares: [connect({ transport: clientTransport })]
    })
    try {
      await expect(client.send('store-worker-rpc-server', 'echo', 'consumer')).resolves.toBe(
        'consumer'
      )
      const first = client.dispose()
      expect(client.dispose()).toBe(first)
      await first
    } finally {
      await server.dispose()
    }
  })

  it('T102 B12c01: caller cancellation preserves native cause and clears outbound pending state', async () => {
    const [clientTransport, serverTransport] = createMemoryTransportPair()
    const server = await createProviderEndpoint({
      id: 'cancel-rpc-server',
      transport: serverTransport,
      middlewares: [connect({ transport: serverTransport }), abort()]
    })
    server.provide(
      'hang',
      (context) =>
        new Promise((resolve) => {
          context.signal.addEventListener(
            'abort',
            () => resolve(context.failed('aborted', 'CANCELLED')),
            {
              once: true
            }
          )
        })
    )
    const client = await createClientEndpoint({
      id: 'cancel-rpc-client',
      transport: clientTransport,
      middlewares: [connect({ transport: clientTransport }), abort()]
    })
    const controller = new AbortController()
    const reason = new DOMException('outbound cancellation', 'AbortError')
    try {
      const pending = client.send('cancel-rpc-server', 'hang', null, { signal: controller.signal })
      controller.abort(reason)
      await expect(pending).rejects.toMatchObject({
        name: 'AbortError',
        cause: reason
      })
      await drainBatchTurns()
      expect(readEndpointDebugSnapshot(client)?.pending).toBe(0)
    } finally {
      await Promise.all([client.dispose(), server.dispose()])
    }
  })

  it('T103 B12c01: real outbound order is encode then encrypt then sign then transport send', async () => {
    const [baseTransport] = createMemoryTransportPair()
    const events: string[] = []
    const transport = {
      ...baseTransport,
      send: (message: unknown, options?: Parameters<typeof baseTransport.send>[1]) => {
        events.push('transport')
        return baseTransport.send(message, options)
      }
    }
    const client = await createClientEndpoint({
      id: 'order-client',
      transport,
      middlewares: [
        codec({
          ...defineJsonCodec({ version: 1 }),
          encode: (value) => {
            events.push('encode')
            return JSON.stringify(value)
          }
        }),
        protocol(),
        authentication({
          encrypt: (value) => {
            events.push('encrypt')
            return value
          },
          decrypt: (value) => value,
          sign: (value) => {
            events.push('sign')
            return value
          },
          verify: (value) => value
        }),
        connect({ transport })
      ]
    })
    try {
      client.dispatch('order-target', 'order-method', 'order-data')
      await vi.waitFor(() => expect(events).toEqual(['encode', 'encrypt', 'sign', 'transport']))
    } finally {
      await client.dispose()
    }
  })

  it('T104 B12c01: hostile outbound authentication preserves native source/code/cause identity', async () => {
    const [transport] = createMemoryTransportPair()
    const hostile = new Error('outbound encrypt failed')
    const client = await createClientEndpoint({
      id: 'hostile-auth-client',
      transport,
      middlewares: [
        authentication({
          encrypt: () => {
            throw hostile
          },
          decrypt: (value) => value
        }),
        connect({ transport })
      ]
    })
    try {
      await expect(
        client.send('target', 'method', 'data', { timeoutMs: false })
      ).rejects.toMatchObject({
        source: WEBRPC_SOURCE,
        code: WebRpcErrorCode.authenticationFailed,
        cause: hostile
      })
    } finally {
      await client.dispose()
    }
  })

  it('T105 B12c01: descriptor four-key claims remain distinct from seven-key final projection', async () => {
    const [transport] = createMemoryTransportPair()
    const client = await createClientEndpoint({
      id: 'projection-client',
      transport,
      middlewares: [connect({ transport })]
    })
    const descriptorBatch = await createProductionBatch()
    try {
      const descriptorEntry = findCapabilitiesEntry(descriptorBatch)
      expect(descriptorEntry.descriptor.claims.publicKeys).toEqual(
        expect.arrayContaining(['send', 'sendAll', 'dispatch', 'dispatchAll'])
      )
      expect(Object.keys(client)).toEqual([
        'hooks',
        'dispose',
        'send',
        'sendAll',
        'dispatch',
        'dispatchAll'
      ])
    } finally {
      await client.dispose()
      await descriptorBatch.host.dispose()
    }
  })

  /** Creates a trusted native Feature for lifecycle rows without restoring descriptor translation. */
  type INativeLifecycleCore = Readonly<{
    readonly onDispose: (release: () => void | Promise<void>) => void
  }>

  function nativeLifecycleFeature(
    name: string,
    install: (core: INativeLifecycleCore) => void
  ): IWebRpcNativeFeatureDefinition {
    const definition = definePlugin(name, (core) => ({
      install: () => {
        install(core)
        return {}
      }
    }))
    return {
      key: name,
      definition: definition as IWebRpcNativeFeatureDefinition['definition'],
      admission: { name, claims: emptyClaims }
    }
  }

  async function runNativeInstallationBranch(name: string): Promise<void> {
    const batch = await createProductionBatch({
      additionalNativeFeatures: [nativeLifecycleFeature(name, () => undefined)]
    })
    await batch.host.installBatch(batch.translated.map(({ definition }) => definition))
    const dispose = batch.host.dispose()
    expect(batch.host.dispose()).toBe(dispose)
    await expect(dispose).resolves.toMatchObject({
      logicalTerminal: true,
      cleanupComplete: true,
      cleanupErrors: []
    })
    expect(batch.host.dispose()).toBe(dispose)
  }

  it('T152 primitive native Feature installation reaches terminal cleanup', async () => {
    await runNativeInstallationBranch('native-observation-primitive')
  })

  it('T153 undefined native Feature installation reaches terminal cleanup', async () => {
    await runNativeInstallationBranch('native-observation-undefined')
  })

  it('T154 no-disposer native Feature installation has one terminal Host Promise', async () => {
    await runNativeInstallationBranch('native-observation-no-disposer')
  })

  it('T155 native Feature result disposer runs once at terminal cleanup', async () => {
    let disposeCalls = 0
    const batch = await createProductionBatch({
      additionalNativeFeatures: [
        nativeLifecycleFeature('native-observation-disposer', (core) => {
          core.onDispose(() => {
            disposeCalls += 1
          })
        })
      ]
    })
    await batch.host.installBatch(batch.translated.map(({ definition }) => definition))
    const dispose = batch.host.dispose()
    expect(batch.host.dispose()).toBe(dispose)
    await dispose
    expect(disposeCalls).toBe(1)
    expect(batch.host.dispose()).toBe(dispose)
  })

  it('T156 native Feature install failure rolls back without retaining Host residue', async () => {
    const primary = new Error('native observation install failure')
    const batch = await createProductionBatch({
      additionalNativeFeatures: [
        nativeLifecycleFeature('native-observation-install-failure', () => {
          throw primary
        })
      ]
    })
    const failure = await batch.host
      .installBatch(batch.translated.map(({ definition }) => definition))
      .catch((error: unknown) => error)
    expect(failure).toMatchObject({
      name: 'PluginHostError',
      source: '@migaia/plugin-host',
      code: 'PLUGIN_INSTALL_FAILED',
      detail: { failedName: 'native-observation-install-failure', rollbackErrors: [] },
      cause: primary
    })
    await expect(batch.host.dispose()).resolves.toMatchObject({
      logicalTerminal: true,
      cleanupComplete: true,
      cleanupErrors: []
    })
  })

  it('T157 native result cleanup failure preserves identity and terminal Promise identity', async () => {
    const cleanup = new Error('native observation result cleanup failure')
    let disposeCalls = 0
    const batch = await createProductionBatch({
      additionalNativeFeatures: [
        nativeLifecycleFeature('native-observation-result-failure', (core) => {
          core.onDispose(() => {
            disposeCalls += 1
            throw cleanup
          })
        })
      ]
    })
    await batch.host.installBatch(batch.translated.map(({ definition }) => definition))
    const dispose = batch.host.dispose()
    expect(batch.host.dispose()).toBe(dispose)
    const failure = await dispose.catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(WebRpcLifecycleError)
    expect(failure).toMatchObject({
      source: WEBRPC_SOURCE,
      code: WebRpcErrorCode.endpointDisposed,
      cause: cleanup
    })
    expect(disposeCalls).toBe(1)
    expect(batch.host.dispose()).toBe(dispose)
    await expect(dispose).rejects.toBe(failure)
  })

  it('T166 throwing cleanup observer is diagnostic-only and cannot alter disposal', async () => {
    const cleanup = new Error('native observer cleanup failure')
    const observerFailure = new Error('native observer failure')
    const runNativeBranch = async (observe: boolean, failCleanup: boolean) => {
      const reports: unknown[] = []
      let observerCalls = 0
      const batch = await createProductionBatch({
        hooksMiddleware: hooks({ onHookError: (error) => reports.push(error) })
      })
      await batch.host.installBatch(batch.translated.map(({ definition }) => definition))
      batch.propagateDiscoveryCleanupFaults({
        ...(failCleanup ? { registry: [cleanup] } : {}),
        ...(observe
          ? {
              onDispose: () => {
                observerCalls += 1
                throw observerFailure
              }
            }
          : {})
      })
      const dispose = batch.host.dispose()
      expect(batch.host.dispose()).toBe(dispose)
      const outcome = await dispose.catch((error: unknown) => error)
      expect(batch.host.dispose()).toBe(dispose)
      return { batch, dispose, outcome, reports, observerCalls }
    }

    const baselineFailure = await runNativeBranch(false, true)
    const observedFailure = await runNativeBranch(true, true)
    for (const branch of [baselineFailure, observedFailure]) {
      expect(branch.outcome).toBeInstanceOf(WebRpcLifecycleError)
      expect(branch.outcome).toMatchObject({
        source: WEBRPC_SOURCE,
        code: WebRpcErrorCode.endpointDisposed,
        cause: cleanup
      })
      expect(branch.batch.host.dispose()).toBe(branch.dispose)
      expectTerminalResidue(productionResidueSnapshot(branch.batch))
    }
    expect(baselineFailure.observerCalls).toBe(0)
    expect(baselineFailure.reports).toEqual([])
    expect(observedFailure.observerCalls).toBe(1)
    expect(observedFailure.reports).toEqual([observerFailure])

    const baselineSuccess = await runNativeBranch(false, false)
    const observedSuccess = await runNativeBranch(true, false)
    for (const branch of [baselineSuccess, observedSuccess]) {
      await expect(branch.dispose).resolves.toMatchObject({
        logicalTerminal: true,
        cleanupComplete: true,
        cleanupErrors: []
      })
      expect(branch.batch.host.dispose()).toBe(branch.dispose)
      expectTerminalResidue(productionResidueSnapshot(branch.batch))
    }
    expect(baselineSuccess.observerCalls).toBe(0)
    expect(baselineSuccess.reports).toEqual([])
    expect(observedSuccess.observerCalls).toBe(1)
    expect(observedSuccess.reports).toEqual([observerFailure])
  })

  it('T158 later native failure rolls back earlier owned resources in reverse order', async () => {
    const rollback = new Error('observation later rollback')
    const releases: string[] = []
    const firstCleanup = new Error('observation first cleanup')
    const secondCleanup = new Error('observation second cleanup')
    const batch = await createProductionBatch({
      additionalNativeFeatures: [
        nativeLifecycleFeature('native-observation-later-rollback-first', (core) => {
          core.onDispose(() => {
            releases.push('first')
            throw firstCleanup
          })
        }),
        nativeLifecycleFeature('native-observation-later-rollback-second', (core) => {
          core.onDispose(() => {
            releases.push('second')
            throw secondCleanup
          })
        }),
        nativeLifecycleFeature('native-observation-later-failure', () => {
          throw rollback
        })
      ]
    })
    const failure = await batch.host
      .installBatch(batch.translated.map(({ definition }) => definition))
      .catch((error: unknown) => error)
    expect(failure).toMatchObject({
      name: 'PluginHostError',
      source: '@migaia/plugin-host',
      code: 'PLUGIN_INSTALL_FAILED',
      detail: { failedName: 'native-observation-later-failure' },
      cause: rollback
    })
    const rollbackErrors = (
      failure as { readonly detail?: { readonly rollbackErrors?: readonly unknown[] } }
    ).detail?.rollbackErrors
    expect(rollbackErrors).toHaveLength(2)
    const rollbackList = rollbackErrors as readonly unknown[]
    expect(rollbackList).toEqual([secondCleanup, firstCleanup])
    expect(releases).toEqual(['second', 'first'])
    const dispose = batch.host.dispose()
    expect(batch.host.dispose()).toBe(dispose)
    await dispose
    expect(batch.host.dispose()).toBe(dispose)
  })
})

describe('Cycle L discovery Host transactions', () => {
  it('T248 publishes and removes the real discovery resolver in one Host transaction', async () => {
    const batch = await createProductionBatch({})
    const installed = await batch.host.installBatch(
      batch.translated.map(({ definition }) => definition)
    )
    const resolver = installed.getShared(WebRpcSharedKey.discoveryResolver) as
      | { readonly resolve: (targetId: string) => unknown }
      | undefined
    expect(resolver).toBeDefined()
    expect(typeof resolver?.resolve).toBe('function')
    expect(batch.isActivated()).toBe(true)

    const firstDispose = batch.host.dispose()
    expect(batch.host.dispose()).toBe(firstDispose)
    await firstDispose
    expect(
      productionResidueSnapshot(batch).shared.find(
        ({ key }) => key === WebRpcSharedKey.discoveryResolver
      )?.value
    ).toBeUndefined()
    expectTerminalResidue(productionResidueSnapshot(batch))
  })

  it('T249 rolls back a published discovery resolver when a later real Host participant fails', async () => {
    const primary = new Error('cycle-l later participant failed')
    const lateName = 'cycle-l-later-participant'
    let published: unknown
    const batch = await createProductionBatch({})
    const late = definePlugin({
      name: lateName,
      claims: emptyClaims,
      sharedConsumes: [WebRpcSharedKey.discoveryResolver],
      install: async (core) => {
        published = core.getShared(WebRpcSharedKey.discoveryResolver)
        throw primary
      }
    }) as IWebRpcPluginConstraint & { readonly claims: IWebRpcPluginClaims }
    let failure: unknown
    try {
      await batch.host.installBatch([...batch.translated.map(({ definition }) => definition), late])
    } catch (error) {
      failure = error
    }
    expect(published).toBeDefined()
    expect(failure).toMatchObject({
      name: 'PluginHostError',
      source: '@migaia/plugin-host',
      code: 'PLUGIN_INSTALL_FAILED',
      cause: primary,
      detail: { failedName: lateName }
    })

    const firstDispose = batch.host.dispose()
    expect(batch.host.dispose()).toBe(firstDispose)
    await firstDispose
    expect(
      productionResidueSnapshot(batch).shared.find(
        ({ key }) => key === WebRpcSharedKey.discoveryResolver
      )?.value
    ).toBeUndefined()
    expectTerminalResidue(productionResidueSnapshot(batch))
  })

  it('T249 preserves the real discovery cleanup error identity and terminal residue', async () => {
    const cleanup = new Error('cycle-l discovery attachment cleanup failed')
    const observerFailure = new Error('cycle-l discovery disposal observer failed')
    let discoveryDisposeCalls = 0
    const reports: unknown[] = []
    const batch = await createProductionBatch({
      hooksMiddleware: hooks({
        onHookError: (error) => {
          reports.push(error)
        }
      })
    })
    await batch.host.installBatch(batch.translated.map(({ definition }) => definition))
    /** This registers on the exact prepared discovery surface consumed by attachment.dispose(). */
    batch.propagateDiscoveryCleanupFaults({
      registry: [cleanup],
      onDispose: () => {
        discoveryDisposeCalls += 1
        throw observerFailure
      }
    })
    const firstDispose = batch.host.dispose()
    expect(batch.host.dispose()).toBe(firstDispose)
    const failure = await firstDispose.catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(WebRpcLifecycleError)
    expect(failure).toMatchObject({
      source: WEBRPC_SOURCE,
      code: WebRpcErrorCode.endpointDisposed,
      cause: cleanup
    })
    expect(reports).toEqual([observerFailure])
    expect(discoveryDisposeCalls).toBe(1)
    expect(batch.host.dispose()).toBe(firstDispose)
    expect(discoveryDisposeCalls).toBe(1)
    expect(
      productionResidueSnapshot(batch).shared.find(
        ({ key }) => key === WebRpcSharedKey.discoveryResolver
      )?.value
    ).toBeUndefined()
    expectTerminalResidue(productionResidueSnapshot(batch))
  })

  it('T249 preserves the shared canonical Host and endpoint disposal Promise on cleanup failure', async () => {
    const cleanup = new Error('cycle-l discovery cleanup failed')
    const middleware: IWebRpcPlugin = {
      name: 'cycle-l-cleanup-observer',
      metadata: { claims: emptyClaims },
      install: (scope) => {
        scope.own({}, () => {
          throw cleanup
        })
        return { extension: {}, shared: {} }
      }
    }
    const [transport] = createMemoryTransportPair()
    const endpoint = await createComposedEndpoint(
      {
        id: 'cycle-l-discovery-cleanup',
        transport,
        middlewares: [connect({ transport }), middleware]
      },
      createFirstPartyRoots(
        new Set<IWebRpcFirstPartyRootName>(['first-party-outbound', 'first-party-discovery'])
      )
    )
    const firstDispose = endpoint.dispose()
    expect(endpoint.dispose()).toBe(firstDispose)
    await expect(firstDispose).rejects.toMatchObject({
      source: '@migaia/web-rpc',
      code: WebRpcErrorCode.endpointDisposed,
      cause: cleanup
    })
    const promises = readComposedDisposalPromises(endpoint)
    expect(promises).toBeDefined()
    expect(promises?.endpoint).toBe(firstDispose)
    expect(promises?.host).toBe(promises?.endpoint)
    expect(promises?.host).toBe(readComposedDisposalPromises(endpoint)?.host)
    let hostFailure: unknown
    try {
      await promises?.host
    } catch (error) {
      hostFailure = error
    }
    expect(hostFailure).toBeInstanceOf(WebRpcLifecycleError)
    expect(hostFailure).toMatchObject({
      source: WEBRPC_SOURCE,
      code: WebRpcErrorCode.endpointDisposed,
      cause: cleanup
    })
    expect(readEndpointDebugSnapshot(endpoint)).toMatchObject({
      phase: 'disposed',
      pending: 0,
      pingPending: 0,
      activeControllers: 0,
      resources: 0,
      discovery: {
        local: 0,
        remote: 0,
        waiters: 0,
        tasks: 0,
        timers: 0,
        manualWaiters: 0,
        inboundQueries: 0,
        inboundTimers: 0
      }
    })
  })

  it('T249 preserves ordered route, replay, and registry cleanup leaves from one composed endpoint', async () => {
    const routeFirst = new Error('discovery route cleanup failed')
    const routeSecond = new Error('discovery response route cleanup failed')
    const replayError = new Error('discovery replay cleanup failed')
    const registryError = new Error('discovery registry cleanup failed')
    const [transport] = createMemoryTransportPair()
    const endpoint = await createComposedEndpoint(
      {
        id: 'cycle-l-discovery-leaves',
        transport,
        middlewares: [connect({ transport })]
      },
      createFirstPartyRoots(
        new Set<IWebRpcFirstPartyRootName>(['first-party-outbound', 'first-party-discovery'])
      )
    )
    const unregister = registerDiscoveryCleanupFaults(endpoint, {
      route: [routeFirst, routeSecond],
      replay: [replayError],
      registry: [registryError]
    })
    try {
      const firstDispose = endpoint.dispose()
      expect(endpoint.dispose()).toBe(firstDispose)
      let failure: unknown
      try {
        await firstDispose
      } catch (error) {
        failure = error
      }
      expect(failure).toMatchObject({
        source: '@migaia/web-rpc',
        code: WebRpcErrorCode.endpointDisposed
      })
      const cleanupErrors = (
        failure as { readonly cleanupErrors?: readonly { readonly error: unknown }[] }
      ).cleanupErrors
      expect(cleanupErrors?.map(({ error }) => error)).toEqual([
        routeFirst,
        replayError,
        registryError
      ])
      expect(cleanupErrors?.map(({ error }) => error)).not.toContain(routeSecond)
      expect(endpoint.dispose()).toBe(firstDispose)
      const promises = readComposedDisposalPromises(endpoint)
      expect(promises).toBeDefined()
      expect(promises?.endpoint).toBe(firstDispose)
      expect(promises?.host).toBe(promises?.endpoint)
      expect(promises?.host).toBe(readComposedDisposalPromises(endpoint)?.host)
      let hostFailure: unknown
      try {
        await promises?.host
      } catch (error) {
        hostFailure = error
      }
      expect(hostFailure).toBeInstanceOf(WebRpcLifecycleError)
      expect(hostFailure).toMatchObject({
        source: WEBRPC_SOURCE,
        code: WebRpcErrorCode.endpointDisposed,
        cause: routeFirst
      })
      expect(readEndpointDebugSnapshot(endpoint)).toMatchObject({
        phase: 'disposed',
        pending: 0,
        pingPending: 0,
        activeControllers: 0,
        resources: 0,
        discovery: {
          local: 0,
          remote: 0,
          waiters: 0,
          tasks: 0,
          timers: 0,
          manualWaiters: 0,
          inboundQueries: 0,
          inboundTimers: 0
        }
      })
    } finally {
      unregister()
    }
  })
})
