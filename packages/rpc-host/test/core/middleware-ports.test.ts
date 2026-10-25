import {
  createRuntimeEndpointComposition,
  createRuntimeFeatureRoots
} from '../../dist/core/runtime-api-endpoint.js'
import { RpcCapability } from '@migaia/rpc-contract'
import type { IAbortSignal } from '@migaia/utils/promise'
import { systemScheduler } from '@migaia/utils/scheduler'
import { createEndpointTimePort } from '../../dist/core/internal/time-port.js'
import { describe, expect, it, vi } from 'vitest'
import { createMemoryTransportPair } from '../fixtures/memory-transport.js'
import { createStringFramer } from '@migaia/rpc-contract/framing'
import { defineJsonCodec } from '@migaia/serialize/codecs/json'
import { type IRpcCoreConfig } from '../../dist/core/composed.js'

import { abort } from '../../dist/core/middleware/abort.js'
import { authentication } from '../../dist/core/middleware/authentication.js'
import { codec } from '../../dist/core/middleware/codec.js'
import { connect } from '../../dist/core/middleware/connect.js'
import { contract } from '../fixtures/core-role/contract.js'
import { hooks } from '../../dist/core/middleware/hooks.js'
import { ping } from '../../dist/core/middleware/ping.js'
import { canonicalProtocol as protocol } from '../fixtures/core-role/canonical-protocol.js'
import { timeout } from '../../dist/core/middleware/timeout.js'
import { uuid } from '../fixtures/core-role/uuid.js'

import type { IRpcPluginConstraint } from '../../dist/core/internal/plugin-contract.js'
import type {
  IRpcHookEvent,
  IRpcPlugin,
  IRpcPluginInstallScope,
  IRpcProvider
} from '../../dist/core/typing.js'
import {
  createWebRpcPluginHost,
  type IRpcPluginHost
} from '../../dist/core/internal/web-rpc-plugin-host.js'
import {
  createConstructionControl,
  runConstructionInstall
} from '../../dist/core/internal/construction-install.js'
import { createEndpointKernel } from '../../dist/core/endpoint-kernel.js'
import {
  prepareEndpoint,
  type IDeferredPreparedEndpoint,
  type IPreparedEndpoint
} from '../../dist/core/internal/endpoint-bootstrap.js'
import {
  buildNativePluginBatch,
  type IRpcNativeFeatureDefinition,
  type IRpcComposedRuntimeState,
  type IRpcPluginRole
} from '../../dist/core/internal/plugin-inventory.js'
import { createEndpointCapabilitiesBatchFeature } from '../../dist/core/internal/endpoint-capabilities-plugin.js'
import type { IRpcPluginDescriptor } from '../../dist/core/internal/plugin-descriptor.js'
import {
  preflightFeatureClaims,
  type IRpcClaimAdmission
} from '../../dist/core/internal/feature-policy.js'
import type { IRpcPluginClaims } from '../../dist/core/typing.js'
import { RpcPortName } from '../../dist/core/internal/plugin-shared-keys.js'
import { RpcOutboundAttachment } from '../../dist/core/internal/outbound-attachment.js'
import { RPC_CORE_ERROR_SOURCE, RpcError, RpcLifecycleError } from '@migaia/rpc-contract/errors'
import { RpcCoreErrorCode } from '@migaia/rpc-contract/error-code'
import { RpcCoreErrorText } from '@migaia/rpc-contract/errors'
import {
  readEndpointDebugSnapshot,
  type IRpcDiscoveryCleanupFaults
} from '../../dist/core/internal/test-observer.js'
import { readComposedDisposalPromises } from '../../dist/core/internal/composed-disposal-observer.js'

const emptyClaims: IRpcPluginClaims = {
  routes: [],
  provides: [],
  consumes: [],
  publicKeys: [],
  exposedKeys: [],
  activator: false
}

type IProductionBatch = {
  readonly host: IRpcPluginHost
  readonly kernel: ReturnType<typeof createEndpointKernel>
  /** Fixture transport used to verify the kernel retains the production transport owner. */
  readonly transport: IRpcCoreConfig['transport']
  readonly construction: ReturnType<typeof createConstructionControl>
  /** Host-owned early-construction diagnostics, replayed only after middleware finalization. */
  readonly hookEvents: readonly IRpcHookEvent[]
  readonly inventory: readonly IProductionNativeEntry[]
  readonly descriptors: readonly IRpcPluginDescriptor[]
  /** Native admission records are the sole pre-install policy input. */
  readonly admissions: readonly IRpcClaimAdmission[]
  readonly claims: readonly IRpcPluginClaims[]
  readonly translated: readonly IRpcTranslatedPlugin[]
  readonly getPrepared: () => IPreparedEndpoint<string> | undefined
  readonly getRuntimeState: () => IRpcComposedRuntimeState | undefined
  /** Reaches the prepared discovery surface's owned cleanup fault observer. */
  readonly propagateDiscoveryCleanupFaults: (faults: IRpcDiscoveryCleanupFaults) => void
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
  readonly role: IRpcPluginRole
  /** Test metadata preserves prior assertions while runtime always originates from native entries. */
  readonly descriptor: IRpcPluginDescriptor
}>

/** Test-only output observation; native production definitions never expose translator output. */
type IRpcPluginRuntimeOutput = Readonly<Record<PropertyKey, unknown>>
type IRpcPluginRuntimeOutputPhase = 'extension' | 'ports'
type IRpcTranslatedPlugin = Readonly<{ readonly definition: IRpcPluginConstraint }>

type IProductionLifecycleTraceEntry = {
  readonly kind: string
  readonly instance: unknown
}

type IProductionBatchOptions = {
  readonly providers?: Readonly<Record<string, IRpcProvider>>
  readonly protocolMiddleware?: IRpcPlugin
  readonly codecMiddleware?: IRpcPlugin
  readonly contractMiddleware?: IRpcPlugin
  readonly authenticationMiddleware?: IRpcPlugin
  readonly connectMiddleware?: IRpcPlugin
  readonly abortMiddleware?: IRpcPlugin
  readonly timeoutMiddleware?: IRpcPlugin
  readonly hooksMiddleware?: IRpcPlugin
  readonly pingMiddleware?: IRpcPlugin
  readonly uuidMiddleware?: IRpcPlugin
  readonly framer?: IRpcCoreConfig['framer']
  readonly omitProtocol?: boolean
  readonly omitContract?: boolean
  readonly omitAuthentication?: boolean
  readonly omitConnect?: boolean
  readonly omitPing?: boolean
  readonly omitAbort?: boolean
  readonly omitTimeout?: boolean
  readonly transportOwnership?: 'owned' | 'borrowed'
  readonly transportCloseError?: Error
  readonly construction?: IRpcCoreConfig['construction']
  readonly lifecycleTrace?: IProductionLifecycleTraceEntry[]
  readonly injectInstall?: (
    role: IRpcPluginRole,
    install: IRpcPluginDescriptor['install']
  ) => IRpcPluginDescriptor['install']
  /** Only intentionally pending fault bodies opt into the existing construction gate. */
  readonly injectConstructionGate?: (role: IRpcPluginRole) => boolean
  readonly injectRuntimeOutput?: (
    role: IRpcPluginRole,
    phase: IRpcPluginRuntimeOutputPhase,
    output: IRpcPluginRuntimeOutput
  ) => IRpcPluginRuntimeOutput
  readonly injectRuntimeState?: (
    role: IRpcPluginRole,
    state: IRpcComposedRuntimeState
  ) => IRpcComposedRuntimeState | Promise<IRpcComposedRuntimeState>
  readonly injectDescriptor?: (
    role: IRpcPluginRole,
    descriptor: IRpcPluginDescriptor
  ) => IRpcPluginDescriptor
  readonly additionalDescriptors?: readonly IRpcPluginDescriptor[]
  /** Extra definitions join the production Host transaction for native lifecycle fault rows. */
  readonly additionalNativeFeatures?: readonly IRpcNativeFeatureDefinition[]
  readonly skipPreflight?: boolean
  readonly report?: (error: unknown) => void
  readonly onInstalled?: (installation: unknown) => void
  readonly onTransferredCleanup?: (pluginName: string) => void
  /** Observes the actual native activation port after finalization and before ingress commits. */
  readonly onActivationPreflight?: (
    state: IRpcComposedRuntimeState,
    getPort: (key: PropertyKey) => unknown
  ) => void
}

let productionBatchId = 0

function productionMiddleware(
  transport: IRpcCoreConfig['transport'],
  protocolMiddleware: IRpcPlugin | null | undefined = protocol(),
  codecMiddleware: IRpcPlugin | null | undefined = codec(defineJsonCodec({ version: 1 })),
  contractMiddleware: IRpcPlugin | null | undefined = contract(),
  authenticationMiddleware: IRpcPlugin | null | undefined = authentication({
    encrypt: (value) => value,
    decrypt: (value) => value,
    sign: (value) => value,
    verify: (value) => value
  }),
  connectMiddleware: IRpcPlugin | null | undefined = connect({ transport }),
  abortMiddleware: IRpcPlugin | null | undefined = abort(),
  timeoutMiddleware: IRpcPlugin | null | undefined = timeout(),
  hooksMiddleware: IRpcPlugin | null | undefined = hooks(),
  pingMiddleware: IRpcPlugin | null | undefined = ping(),
  uuidMiddleware: IRpcPlugin | null | undefined = uuid()
): readonly IRpcPlugin[] {
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
  ].filter((middleware): middleware is IRpcPlugin => middleware != null)
}

/** The exact canonical batch callback carries its admitted claims into fault injection. */
type IInjectedNativeDefinition = Parameters<
  NonNullable<Parameters<typeof buildNativePluginBatch>[0]['transformDefinition']>
>[1]

/** Own the native core temporarily lent to one actual definition fault injection. */
class InjectedProductionDefinition {
  /** Original fixture choices decide only the existing injected failure path. */
  #options: IProductionBatchOptions
  /** The canonical definition stays the only source of real install behavior. */
  #definition: IInjectedNativeDefinition
  /** The native role retains the original injection dispatch key. */
  #role: IRpcPluginRole
  /** Each injected invocation lends the original active native core to its legacy observation. */
  #activeCore: Parameters<IRpcPluginConstraint['install']>[0] | undefined
  /** The selected injected installer is retained without calling it during definition preparation. */
  #install: IRpcPluginDescriptor['install'] | undefined
  /** A pass-through keeps the exact original opaque native definition identity. */
  readonly value: IInjectedNativeDefinition
  /** Evaluate the original injection once at native batch construction time. */
  constructor(
    options: IProductionBatchOptions,
    role: IRpcPluginRole,
    definition: IInjectedNativeDefinition
  ) {
    this.#options = options
    this.#role = role
    this.#definition = definition
    if (role.kind === 'middleware') {
      this.value = definition
      return
    }
    this.#install = options.injectInstall?.(role, this.#originalInstall)
    this.value =
      this.#install === undefined || this.#install === this.#originalInstall
        ? definition
        : Object.freeze({ ...definition, install: this.#installDefinition })
  }
  /** Execute the original native install on the currently lent real core. */
  #originalInstall: IRpcPluginDescriptor['install'] = async () => {
    if (!this.#activeCore) throw new Error('native injection core unavailable')
    return this.#definition.install(this.#activeCore)
  }
  /** Run the original injected scope and construction gate, then transfer its exact cleanup. */
  #installDefinition = async (
    core: Parameters<IRpcPluginConstraint['install']>[0]
  ): Promise<Record<string, unknown>> => {
    this.#activeCore = core
    const scope: IRpcPluginInstallScope = {
      id: core.id,
      transport: core.transport,
      signal: core.signal,
      hooks: core.hooks,
      getPort: core.getPort,
      own: (resource, release) => {
        core.onDispose(release)
        return resource
      }
    }
    /** Preserve the original injected callback's plain receiver. */
    const install = this.#install!
    const result = this.#options.injectConstructionGate?.(this.#role)
      ? await runConstructionInstall(
          {
            id: core.id,
            transport: core.transport,
            control: core.construction,
            hooks: core.hooks,
            getPort: core.getPort,
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
      throw new RpcError(RpcCoreErrorCode.invalidConfig, RpcCoreErrorText.endpointModuleInvalid)
    const disposer =
      result !== null && typeof result === 'object'
        ? Object.getOwnPropertyDescriptor(result, 'dispose')?.value
        : undefined
    if (typeof disposer === 'function') core.onDispose(() => disposer())
    const output: Record<string, unknown> = { ...result }
    delete output.dispose
    return output
  }
}

/** Allocate the explicit state used by every production batch fixture phase. */
function productionBatchContext(
  optionsOrInject?: IProductionBatchOptions | IProductionBatchOptions['injectInstall']
) {
  const options: IProductionBatchOptions =
    typeof optionsOrInject === 'function'
      ? { injectInstall: optionsOrInject }
      : (optionsOrInject ?? {})
  const [baseTransport] = createMemoryTransportPair()
  const stats = { activeSubscriptions: 0, subscribeCalls: 0, dispatches: 0, closeCalls: 0 }
  const trace = options.lifecycleTrace
  /** Native activation facts stay mutable behind one explicitly passed transaction context. */
  const state = {
    prepared: undefined as IPreparedEndpoint<string> | undefined,
    activated: false,
    runtimeState: undefined as IRpcComposedRuntimeState | undefined,
    activationPreflight: undefined as IProductionBatchOptions['onActivationPreflight']
  }
  return { options, baseTransport, stats, trace, state }
}

/** Create the original physical carrier and middleware configuration without opening a second owner. */
function configureProductionBatch(context: ReturnType<typeof productionBatchContext>) {
  const close = (): void => {
    context.stats.closeCalls += 1
    context.trace?.push({ kind: 'transport.close', instance: close })
    if (context.options.transportCloseError) throw context.options.transportCloseError
    context.baseTransport.close?.()
  }
  const transport = {
    ...context.baseTransport,
    ownership: context.options.transportOwnership,
    send: (message: unknown) => {
      context.stats.dispatches += 1
      context.baseTransport.send(message)
    },
    close,
    subscribe: (listener: Parameters<typeof context.baseTransport.subscribe>[0]) => {
      context.stats.subscribeCalls += 1
      context.stats.activeSubscriptions += 1
      const unsubscribe = context.baseTransport.subscribe(listener)
      const tracedUnsubscribe = () => {
        context.trace?.push({ kind: 'unsubscribe', instance: tracedUnsubscribe })
        context.stats.activeSubscriptions -= 1
        unsubscribe()
      }
      return tracedUnsubscribe
    }
  }
  const config: IRpcCoreConfig = {
    id: `production-${productionBatchId++}`,
    transport,
    provider: context.options.providers,
    construction: context.options.construction,
    framer: context.options.framer ?? (createStringFramer() as unknown as IRpcCoreConfig['framer']),
    middlewares: productionMiddleware(
      transport,
      context.options.omitProtocol ? null : context.options.protocolMiddleware,
      context.options.codecMiddleware ?? codec(defineJsonCodec({ version: 1 })),
      context.options.omitContract ? null : context.options.contractMiddleware,
      context.options.omitAuthentication ? null : context.options.authenticationMiddleware,
      context.options.omitConnect ? null : context.options.connectMiddleware,
      context.options.omitAbort ? null : (context.options.abortMiddleware ?? abort()),
      context.options.omitTimeout ? null : (context.options.timeoutMiddleware ?? timeout()),
      context.options.hooksMiddleware ?? hooks(),
      context.options.omitPing ? null : (context.options.pingMiddleware ?? ping()),
      context.options.uuidMiddleware ?? uuid()
    )
  }
  const { roots } = createRuntimeFeatureRoots(config, {
    agreement: { capabilities: [RpcCapability.ping] },
    peerId: ''
  })
  return { ...context, close, transport, config, roots }
}

/** Prepare the actual endpoint bootstrap, kernel and native construction lifetime. */
async function prepareProductionBatch(context: ReturnType<typeof configureProductionBatch>) {
  const deferred = (await prepareEndpoint(context.config, {
    deferMiddlewareInstall: true
  })) as IDeferredPreparedEndpoint<string>
  const rawKernel = createEndpointKernel(deferred.transport, deferred.transportSnapshot)
  let kernel = rawKernel
  if (context.trace) {
    const observedKernel = new Proxy(rawKernel, {
      get: (target, key) => {
        if (key === 'completeDispose')
          return () => {
            context.trace!.push({ kind: 'kernel.completeDispose', instance: observedKernel })
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
    time: createEndpointTimePort(systemScheduler),
    signal: (context.options.construction?.signal ?? new AbortController().signal) as IAbortSignal,
    timeoutMs: context.options.construction?.timeoutMs
  })
  const hookEvents: IRpcHookEvent[] = []
  const host = createWebRpcPluginHost(
    deferred.id,
    deferred.transport,
    construction,
    (event: IRpcHookEvent) => hookEvents.push(event),
    { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
  )
  return { ...context, deferred, rawKernel, kernel, construction, hookEvents, host }
}

/** Build one canonical native capability batch with the original fault-injection observations. */
function buildProductionBatch(context: Awaited<ReturnType<typeof prepareProductionBatch>>) {
  const capabilityBatch = createEndpointCapabilitiesBatchFeature(
    context.roots,
    Object.freeze({
      getKernel: () => context.kernel,
      getPrepared: () => {
        if (!context.state.prepared) throw new Error('production batch prepared endpoint missing')
        return context.state.prepared
      },
      transformOutput: context.options.injectRuntimeOutput
        ? (phase, output) =>
            context.options.injectRuntimeOutput!(
              { kind: 'feature', index: 0, key: 'endpoint-capabilities' },
              phase,
              output as IRpcPluginRuntimeOutput
            )
        : undefined,
      transformFeaturePrepare: (name, prepare) =>
        context.options.injectInstall?.({ kind: 'feature', index: 0, key: name }, prepare) ??
        prepare
    }),
    Object.keys(context.roots).filter((name) => name.startsWith('first-party-')),
    'first-party-outbound' in context.roots ? ['first-party-outbound'] : [],
    Object.keys(context.roots).filter((name) =>
      [
        'first-party-outbound',
        'first-party-discovery',
        'first-party-control',
        'first-party-provider'
      ].includes(name)
    ),
    new Set(Object.keys(context.roots))
  )
  const featureDefinitions: readonly IRpcNativeFeatureDefinition[] = capabilityBatch.admission
    ? [
        {
          key: capabilityBatch.plugin.definition.name,
          definition: capabilityBatch.plugin.definition,
          admission: capabilityBatch.admission
        },
        ...(context.options.additionalNativeFeatures ?? [])
      ]
    : []
  const nativeBatch = buildNativePluginBatch({
    kernel: context.kernel,
    deferred: context.deferred,
    middlewareSnapshots: context.deferred.middlewareSnapshots,
    hookEvents: context.hookEvents,
    onPrepared: (value) => {
      context.state.prepared = value
    },
    onActivationCommitted: () => {
      context.state.activated = true
    },
    onActivationRolledBack: () => {
      context.state.activated = false
    },
    onNativeFeatureActivate: () => capabilityBatch.plugin.activate(),
    onActivationPreflight: async (state, getPort) => {
      const observed = context.options.injectRuntimeState
        ? await context.options.injectRuntimeState({ kind: 'activation' }, state)
        : state
      context.state.runtimeState = observed
      return context.state.activationPreflight?.(observed, getPort)
    },
    transformMiddlewareInstall: (role, install) =>
      context.options.injectInstall?.(role, install) ?? install,
    /**
     * Fault injection replaces the real native definition install directly; it never rebuilds a
     * descriptor.
     */
    transformDefinition: (role, definition) =>
      new InjectedProductionDefinition(context.options, role, definition).value,
    featureDefinitions
  })
  return { ...context, capabilityBatch, featureDefinitions, nativeBatch }
}

/** All projection helpers receive the exact completed native transaction context explicitly. */
type IProductionBatchContext = ReturnType<typeof buildProductionBatch>

/** Project existing native definitions and activation facts for the unchanged test assertions. */
function projectProductionBatch(context: IProductionBatchContext): IProductionBatch {
  const inventory = context.nativeBatch.map(({ role, definition, admission }) => ({
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
  const descriptors = context.nativeBatch.map(({ definition, admission }) =>
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
  ) as unknown as IRpcPluginDescriptor[]
  const claims = context.nativeBatch.map(({ admission }) => admission.claims)
  const translated = context.nativeBatch.map(({ definition }) => ({
    definition
  })) as IRpcTranslatedPlugin[]
  if (!context.options.skipPreflight) {
    try {
      preflightFeatureClaims(context.nativeBatch.map(({ admission }) => admission))
    } catch (error) {
      if (!context.options.omitConnect) throw error
    }
  }
  context.state.activationPreflight = context.options.onActivationPreflight
  return {
    host: context.host,
    kernel: context.kernel,
    transport: context.transport,
    construction: context.construction,
    hookEvents: context.hookEvents,
    inventory,
    descriptors,
    admissions: context.nativeBatch.map(({ admission }) => admission),
    claims,
    translated,
    getPrepared: () => context.state.prepared,
    getRuntimeState: () => context.state.runtimeState,
    propagateDiscoveryCleanupFaults: context.capabilityBatch.plugin.propagateDiscoveryCleanupFaults,
    stats: context.stats,
    isActivated: () => context.state.activated
  }
}

/** Run the fixture's actual construction phases with one explicit state owner. */
async function createProductionBatch(
  optionsOrInject?: IProductionBatchOptions | IProductionBatchOptions['injectInstall']
): Promise<IProductionBatch> {
  return projectProductionBatch(
    buildProductionBatch(
      await prepareProductionBatch(
        configureProductionBatch(productionBatchContext(optionsOrInject))
      )
    )
  )
}

type IProductionResidueSnapshot = Readonly<{
  readonly ports: readonly { readonly key: PropertyKey; readonly value: unknown }[]
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
      return batch.host.getPort(key)
    } catch {
      return undefined
    }
  }
  const ports = Object.values(RpcPortName).map((key) => ({
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
    ports,
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
  expect(snapshot.ports.every(({ value }) => value === undefined)).toBe(true)
  expect(snapshot.extensions.every(({ descriptor }) => descriptor === undefined)).toBe(true)
  expect(snapshot.activeSubscriptions).toBe(0)
  expect(snapshot.kernelState).toBe('disposed')
  expect(snapshot.kernelOwners).toEqual([])
  expect(snapshot.kernelRoutes).toEqual([])
  expect(snapshot.ownedResources).toBe(0)
}

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

describe('atomic middleware and claim contracts', () => {
  it('records unified successful and rollback teardown order with stable repeated disposal', async () => {
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

  // Legacy chunk middleware assertions were removed with that API; framing belongs to rpc-contract.

  // Retire middleware chunk configuration; rpc-contract owns framer limits and cleanup.
})

describe('outbound feature production-seam matrix', () => {
  /** Builds a frozen temporary facade around the real broad owner for compatibility-only tests. */

  it('outbound cleanup proves exact order, failure identity, and terminal idempotence', async () => {
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
    expect(disposalFailure).toBeInstanceOf(RpcLifecycleError)
    expect(disposalFailure).toMatchObject({
      source: RPC_CORE_ERROR_SOURCE,
      code: RpcCoreErrorCode.endpointDisposed,
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
        .spyOn(RpcOutboundAttachment.prototype, 'dispose')
        .mockImplementation(() => {
          return Promise.reject(endpointOutboundFailure)
        })
      const endpoint = await createRuntimeEndpointComposition(
        {
          id: 'outbound-disposal-endpoint',
          transport: endpointTransport,
          middlewares: [connect({ transport: endpointTransport })]
        },
        { agreement: { capabilities: [] }, peerId: '' }
      ).installing
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
        source: RPC_CORE_ERROR_SOURCE,
        code: RpcCoreErrorCode.endpointDisposed,
        message: RpcCoreErrorText.endpointDisposalCleanupFailed
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

  /** Frozen title retained; the approved group/outcome operations expand the asserted current keys. */
})

describe('discovery Host transactions', () => {
  it('preserves the shared canonical Host and endpoint disposal Promise on cleanup failure', async () => {
    const cleanup = new Error('cycle-l discovery cleanup failed')
    const middleware: IRpcPlugin = {
      name: 'cycle-l-cleanup-observer',
      metadata: { claims: emptyClaims },
      install: (scope) => {
        scope.own({}, () => {
          throw cleanup
        })
        return { extension: {}, ports: {} }
      }
    }
    const [transport] = createMemoryTransportPair()
    const endpoint = await createRuntimeEndpointComposition(
      {
        id: 'cycle-l-discovery-cleanup',
        transport,
        middlewares: [connect({ transport }), middleware]
      },
      { agreement: { capabilities: [RpcCapability.ping] }, peerId: '' }
    ).installing
    const firstDispose = endpoint.dispose()
    expect(endpoint.dispose()).toBe(firstDispose)
    await expect(firstDispose).rejects.toMatchObject({
      source: 'rpc.endpoint',
      code: RpcCoreErrorCode.endpointDisposed,
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
    expect(hostFailure).toBeInstanceOf(RpcLifecycleError)
    expect(hostFailure).toMatchObject({
      source: RPC_CORE_ERROR_SOURCE,
      code: RpcCoreErrorCode.endpointDisposed,
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
})
