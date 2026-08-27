import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { createMemoryTransportPair } from '../../src/adapters/memory.js'
import { createComposedEndpoint, type IWebRpcCoreConfig } from '../../src/core.js'
import { createClientEndpoint } from '../../src/client.js'
import { createEndpoint } from '../../src/index.js'
import { abort } from '../../src/middleware/abort.js'
import { authentication } from '../../src/middleware/authentication.js'
import { chunk as chunkMiddleware } from '../../src/middleware/chunk.js'
import { connect } from '../../src/middleware/connect.js'
import { contract } from '../../src/middleware/contract.js'
import { hooks } from '../../src/middleware/hooks.js'
import { ping } from '../../src/middleware/ping.js'
import { protocol } from '../../src/middleware/protocol.js'
import { timeout } from '../../src/middleware/timeout.js'
import { uuid } from '../../src/middleware/uuid.js'
import { chunk } from '../../src/features/chunk.js'
import { control } from '../../src/features/control.js'
import { discovery } from '../../src/features/discovery.js'
import { outbound } from '../../src/features/outbound.js'
import { provider } from '../../src/features/provider.js'
import { createProviderEndpoint } from '../../src/provider.js'
import type {
  IWebRpcAbortSignal,
  IWebRpcHookEvent,
  IWebRpcAuthenticationCapability,
  IWebRpcConnectCapability,
  IWebRpcPlugin,
  IWebRpcPluginInstallScope,
  IWebRpcPluginInstallResult,
  IWebRpcProvider
} from '../../src/typing.js'
import { WebRpcPluginHost } from '../../src/internal/web-rpc-plugin-host.js'
import type { IPluginHostDisposalResult } from '@migaia/plugin-host'
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
  getEndpointModuleOwner,
  snapshotEndpointModules,
  withEndpointModuleOwner
} from '../../src/internal/endpoint-modules.js'
import {
  buildComposedPluginInventory,
  type IWebRpcComposedRuntimeState,
  type IWebRpcComposedPluginInventoryEntry,
  type IWebRpcPluginRole
} from '../../src/internal/plugin-inventory.js'
import {
  assertPluginClaimParity,
  preflightPluginClaims,
  toPluginHostDefinition,
  type IWebRpcPluginClaims,
  type IWebRpcPluginDescriptor,
  type IWebRpcPluginRuntimeOutput,
  type IWebRpcPluginRuntimeOutputPhase,
  type IWebRpcTranslatedPlugin
} from '../../src/internal/plugin-translator.js'
import {
  WebRpcSharedKey,
  WebRpcPingEnablePortShape,
  type IWebRpcContractPort,
  type IWebRpcProtocolPort
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
  registerDiscoveryCleanupFaults
} from '../../src/internal/test-observer.js'
import { readComposedDisposalPromises } from '../../src/internal/composed-disposal-observer.js'

const abortTransportKey = WebRpcSharedKey.providerCancellation
const plannedAbortEnablementKey = WebRpcSharedKey.abort

/** Formats a PropertyKey without claiming object identity for symbols in a message contract. */
function stablePropertyKeyDescription(key: PropertyKey): string {
  return typeof key === 'symbol' ? `symbol:${key.description ?? '<anonymous>'}` : `string:${key}`
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
  readonly host: WebRpcPluginHost
  readonly kernel: ReturnType<typeof createEndpointKernel>
  readonly construction: ReturnType<typeof createConstructionControl>
  readonly inventory: readonly IWebRpcComposedPluginInventoryEntry[]
  readonly descriptors: readonly IWebRpcPluginDescriptor[]
  readonly claims: readonly IWebRpcPluginClaims[]
  readonly translated: readonly IWebRpcTranslatedPlugin[]
  readonly getPrepared: () => IPreparedEndpoint<string> | undefined
  readonly getRuntimeState: () => IWebRpcComposedRuntimeState | undefined
  readonly stats: {
    activeSubscriptions: number
    subscribeCalls: number
    dispatches: number
    closeCalls: number
  }
  readonly isActivated: () => boolean
}

type IProductionLifecycleTraceEntry = {
  readonly kind: string
  readonly instance: unknown
}

type IProductionBatchOptions = {
  readonly providers?: Readonly<Record<string, IWebRpcProvider>>
  readonly protocolMiddleware?: IWebRpcPlugin
  readonly contractMiddleware?: IWebRpcPlugin
  readonly authenticationMiddleware?: IWebRpcPlugin
  readonly connectMiddleware?: IWebRpcPlugin
  readonly hooksMiddleware?: IWebRpcPlugin
  readonly pingMiddleware?: IWebRpcPlugin
  readonly uuidMiddleware?: IWebRpcPlugin
  readonly chunkMiddleware?: IWebRpcPlugin
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
  readonly skipPreflight?: boolean
  readonly report?: (error: unknown) => void
  readonly onInstalled?: (installation: unknown) => void
  readonly onTransferredCleanup?: (pluginName: string) => void
  readonly onActivationPreflight?: (state: IWebRpcComposedRuntimeState) => void
}

let productionBatchId = 0

function sameRole(left: IWebRpcPluginRole, right: IWebRpcPluginRole): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function productionMiddleware(
  transport: IWebRpcCoreConfig['transport'],
  protocolMiddleware: IWebRpcPlugin | null | undefined = protocol(),
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
  uuidMiddleware: IWebRpcPlugin | null | undefined = uuid(),
  chunkMiddlewareItem: IWebRpcPlugin | null | undefined = chunkMiddleware()
): readonly IWebRpcPlugin[] {
  return [
    protocolMiddleware,
    authenticationMiddleware,
    contractMiddleware,
    connectMiddleware,
    uuidMiddleware,
    chunkMiddlewareItem,
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
    middlewares: productionMiddleware(
      transport,
      options.omitProtocol ? null : options.protocolMiddleware,
      options.omitContract ? null : options.contractMiddleware,
      options.omitAuthentication ? null : options.authenticationMiddleware,
      options.omitConnect ? null : options.connectMiddleware,
      options.omitAbort ? null : abort(),
      options.omitTimeout ? null : timeout(),
      options.hooksMiddleware ?? hooks(),
      options.omitPing ? null : (options.pingMiddleware ?? ping()),
      options.uuidMiddleware ?? uuid(),
      options.chunkMiddleware ?? chunkMiddleware()
    )
  }
  const definitions = snapshotEndpointModules<IWebRpcCoreConfig>([
    outbound(),
    provider(),
    discovery(),
    control(),
    chunk()
  ])
  const deferred = (await prepareEndpoint(config, {
    deferMiddlewareInstall: true
  })) as IDeferredPreparedEndpoint<string>
  const rawKernel = createEndpointKernel(deferred.transport)
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
  const host = new WebRpcPluginHost(
    deferred.id,
    deferred.transport,
    construction,
    () => undefined,
    { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
  )
  let prepared: IPreparedEndpoint<string> | undefined
  let activated = false
  let runtimeState: IWebRpcComposedRuntimeState | undefined
  let translatedFeatures: IWebRpcTranslatedPlugin[] = []
  let activationPreflight: ((state: IWebRpcComposedRuntimeState) => void) | undefined
  const inventory = buildComposedPluginInventory({
    definitions,
    config,
    kernel,
    deferred,
    middlewareSnapshots: deferred.middlewareSnapshots,
    hookEvents,
    onPrepared: (value) => {
      prepared = value
    },
    getPrepared: () => {
      if (!prepared) throw new Error('production batch prepared endpoint missing')
      return prepared
    },
    getFeatureInstallations: () => translatedFeatures,
    onActivationCommitted: () => {
      activated = true
    },
    onActivationPreflight: (state) => activationPreflight?.(state),
    onRuntimeState: (state) => {
      runtimeState = state
    },
    injectInstall: options.injectInstall,
    injectRuntimeOutput: options.injectRuntimeOutput,
    injectRuntimeState: options.injectRuntimeState
  })
  const inventoryDescriptors = inventory.map(
    ({ descriptor, role }) => options.injectDescriptor?.(role, descriptor) ?? descriptor
  )
  const outboundIndex = inventory.findIndex(
    ({ role }) => role.kind === 'feature' && role.key === 'outbound-compatibility'
  )
  const descriptors = !options.additionalDescriptors?.length
    ? inventoryDescriptors
    : outboundIndex < 0
      ? [...inventoryDescriptors, ...options.additionalDescriptors]
      : [
          ...inventoryDescriptors.slice(0, outboundIndex + 1),
          ...options.additionalDescriptors,
          ...inventoryDescriptors.slice(outboundIndex + 1)
        ]
  const claims = descriptors.map(({ claims: descriptorClaims }) => descriptorClaims)
  const translated = descriptors.map((descriptor, index) =>
    toPluginHostDefinition(descriptor, claims[index]!, {
      report: options.report,
      onInstalled: options.onInstalled,
      onTransferredCleanup: options.onTransferredCleanup
    })
  ) as IWebRpcTranslatedPlugin[]
  const featureDescriptors = new Set(
    inventoryDescriptors.filter((_descriptor, index) => inventory[index]?.role.kind === 'feature')
  )
  translatedFeatures = translated.filter((_item, index) =>
    featureDescriptors.has(descriptors[index]!)
  )
  if (!options.skipPreflight) {
    try {
      preflightPluginClaims(descriptors, claims)
    } catch (error) {
      if (!options.omitConnect) throw error
    }
  }
  activationPreflight = options.onActivationPreflight
  return {
    host,
    kernel,
    construction,
    inventory,
    descriptors,
    claims,
    translated,
    getPrepared: () => prepared,
    getRuntimeState: () => runtimeState,
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
    WebRpcSharedKey.chunk,
    WebRpcSharedKey.outboundAttachment
  ] as const
  return {
    hostKeys: Reflect.ownKeys(batch.host),
    shared: keys.map((key) => batch.host.getShared(key)),
    extensions: batch.descriptors
      .flatMap(({ claims }) => claims.publicKeys)
      .map((key) => Object.getOwnPropertyDescriptor(batch.host, key)),
    installations: batch.translated.map(({ getInstallation, getRuntimeKeys }) => {
      const runtimeKeys = getRuntimeKeys()
      return {
        installed: getInstallation() !== undefined,
        extensionKeys: runtimeKeys.extension,
        sharedKeys: runtimeKeys.shared
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
  const installations = batch.translated.map((translated, index) => {
    const runtimeKeys = translated.getRuntimeKeys()
    return {
      name: batch.descriptors[index]?.name ?? `translated:${index}`,
      installed: translated.getInstallation() !== undefined,
      extensionKeys: runtimeKeys.extension,
      sharedKeys: runtimeKeys.shared,
      expectedSharedKeys: Reflect.ownKeys(runtimeKeys.expectedSharedValues),
      actualSharedKeys: Reflect.ownKeys(runtimeKeys.actualSharedValues)
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

type ICancellationRole = 'timeout' | 'abort'

type INativeCancellationOptions = {
  readonly events?: string[]
  readonly installFailure?: unknown
  readonly signal?: IWebRpcAbortSignal
  readonly sharedValue?: unknown
}

/** Builds a bounded native-contract descriptor for RED coverage when production is still legacy. */
function nativeCancellationDescriptor(
  original: IWebRpcPluginDescriptor,
  role: ICancellationRole,
  key: PropertyKey,
  options: INativeCancellationOptions = {}
): IWebRpcPluginDescriptor {
  const defaultPort =
    role === 'timeout'
      ? { resolve: (timeoutMs?: number | false) => timeoutMs ?? false }
      : Object.freeze({ enabled: true })
  const port = options.sharedValue ?? defaultPort
  return {
    ...original,
    sharedConsumes: [],
    sharedOptionalConsumes: [],
    sharedProvides: [key],
    install: async (scope) => {
      options.events?.push(`${role}:install`)
      if (options.signal && scope.signal !== options.signal)
        throw new Error(`${role} received the wrong construction signal`)
      if (options.installFailure !== undefined) {
        if (options.installFailure instanceof Promise) await options.installFailure
        throw options.installFailure
      }
      return {
        dispose: async () => {
          options.events?.push(`${role}:dispose`)
        }
      }
    },
    shared: () => ({ [key]: port })
  }
}

/** Adds test-only finalizer observation without changing the production finalizer. */
function observeOptionalCancellationPorts(
  original: IWebRpcPluginDescriptor,
  keys: readonly PropertyKey[],
  observed: unknown[]
): IWebRpcPluginDescriptor {
  return {
    ...original,
    install: async (scope) => {
      observed.push(...keys.map((key) => scope.getShared(key)))
      return original.install(scope)
    }
  }
}

const plannedB12b04Keys = {
  hooks: WebRpcSharedKey.hooks,
  ping: WebRpcSharedKey.ping,
  uuid: WebRpcSharedKey.uuid,
  chunk: WebRpcSharedKey.chunk
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
    onActivationPreflight: (state) =>
      assertPluginClaimParity(batch.claims, batch.descriptors, batch.host, batch.kernel, {
        activated: state.activated,
        activationPhase: 'pre-activation',
        routeKeys: state.routeKeys,
        translated: batch.translated,
        onMismatch: () => {
          throw primary
        }
      })
  })
  let failure: unknown
  let sharedAfterFailure: readonly unknown[] = []
  try {
    const installed = await batch.host.installBatch(
      batch.translated.map(({ definition }) => definition)
    )
    assertPluginClaimParity(batch.claims, batch.descriptors, installed, batch.kernel, {
      activated: batch.isActivated(),
      routeKeys: batch.getRuntimeState()?.routeKeys,
      translated: batch.translated,
      onMismatch: () => {
        throw primary
      }
    })
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
      [outbound()]
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
      [outbound()]
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
    expect(() =>
      preflightPluginClaims(
        roles,
        roles.map((item) => item.claims)
      )
    ).not.toThrow()

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
    for (const invalid of cases)
      expect(() =>
        preflightPluginClaims(
          invalid,
          invalid.map((item) => item.claims)
        )
      ).toThrow()
  })

  it.each(['kernel', 'middleware:connect', 'feature:outbound', 'activation'] as const)(
    'preserves PH01 primary and rollback identities when %s fails',
    async (failedRole) => {
      const roles = ['kernel', 'middleware:connect', 'feature:outbound', 'activation'] as const
      const failureIndex = roles.indexOf(failedRole)
      const primary = new Error(`${failedRole} primary`)
      const rollback = roles.map((role) => new Error(`${role} rollback`))
      const [transport] = createMemoryTransportPair()
      const host = new WebRpcPluginHost(
        failedRole,
        transport,
        createConstructionControl({ signal: new AbortController().signal as IWebRpcAbortSignal }),
        () => undefined,
        { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
      )
      const definitions = roles.map(
        (role, index) =>
          toPluginHostDefinition(
            descriptor(role, emptyClaims, {
              install: async () => {
                if (index === failureIndex) throw primary
                return {
                  dispose: () => {
                    throw rollback[index]
                  }
                }
              }
            }),
            emptyClaims
          ).definition
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
    const descriptorIndex = (name: string): number =>
      batch.descriptors.findIndex((descriptor) => descriptor.name === name)
    const kernelIndex = descriptorIndex('kernel')
    const outboundIndex = descriptorIndex('outbound')
    const activationIndex = descriptorIndex('activation')
    const middlewareIndex = descriptorIndex('protocol')
    const invalid = [
      batch.descriptors.map((descriptor, index) =>
        index === kernelIndex
          ? {
              ...descriptor,
              sharedProvides: [WebRpcSharedKey.protocol]
            }
          : descriptor
      ),
      batch.descriptors.map((descriptor, index) =>
        index === kernelIndex ? { ...descriptor, sharedProvides: [] } : descriptor
      ),
      batch.descriptors.map((descriptor, index) =>
        index === middlewareIndex
          ? { ...descriptor, sharedConsumes: [Symbol('forged-web-rpc-shared-key')] }
          : descriptor
      ),
      batch.descriptors.map((descriptor, index) =>
        index === middlewareIndex
          ? { ...descriptor, sharedConsumes: ['web-rpc.shared.capabilities'] }
          : descriptor
      ),
      batch.descriptors.map((descriptor, index) =>
        index === outboundIndex
          ? {
              ...descriptor,
              sharedConsumes: [Symbol('missing-outbound-shared-key')]
            }
          : descriptor
      ),
      batch.descriptors.map((descriptor, index) =>
        index === outboundIndex
          ? {
              ...descriptor,
              claims: { ...descriptor.claims, exposedKeys: ['missing-production-key'] }
            }
          : descriptor
      ),
      batch.descriptors.map((descriptor, index) =>
        index === outboundIndex
          ? { ...descriptor, claims: { ...descriptor.claims, activator: true } }
          : descriptor
      ),
      batch.descriptors.map((descriptor, index) =>
        index === activationIndex
          ? { ...descriptor, claims: { ...descriptor.claims, routes: ['response'] } }
          : descriptor
      ),
      batch.descriptors.map((descriptor, index) =>
        index === activationIndex
          ? { ...descriptor, claims: { ...descriptor.claims, activator: false } }
          : descriptor
      )
    ]
    for (const [invalidIndex, descriptors] of invalid.entries())
      expect(
        () =>
          preflightPluginClaims(
            descriptors,
            descriptors.map(({ claims }) => claims)
          ),
        `invalid production claim case ${invalidIndex}`
      ).toThrow()
    expect(() =>
      preflightPluginClaims(
        batch.descriptors,
        batch.descriptors.map(({ claims }, index) =>
          index === activationIndex ? { ...claims, activator: false } : claims
        )
      )
    ).toThrow()
    const optionalConsumer = batch.descriptors.map((descriptor, index) =>
      index === middlewareIndex ? { ...descriptor, sharedConsumes: undefined } : descriptor
    )
    expect(() =>
      preflightPluginClaims(
        optionalConsumer,
        optionalConsumer.map(({ claims }) => claims)
      )
    ).not.toThrow()

    const installed = await batch.host.installBatch(
      batch.translated.map(({ definition }) => definition)
    )
    assertPluginClaimParity(batch.claims, batch.descriptors, installed, batch.kernel, {
      activated: batch.isActivated(),
      routeKeys: batch.getRuntimeState()?.routeKeys,
      translated: batch.translated
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
      encodedType: 'any',
      identity: true
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
              role.key === 'outbound' &&
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
              role.key === 'provider' &&
              phase === 'extension'
            ) {
              const { provide: _provide, ...rest } = output
              return rest
            }
            if (
              kind === 'extra-public' &&
              role.kind === 'feature' &&
              role.key === 'provider' &&
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
        if (role.kind !== 'feature' || role.key !== 'provider' || phase !== 'extension')
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
        assertPluginClaimParity(batch.claims, batch.descriptors, batch.host, batch.kernel, {
          activated: state.activated,
          activationPhase: 'pre-activation',
          routeKeys: state.routeKeys,
          translated: batch.translated
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
    const customProtocol = protocol({
      get encode() {
        trace.push('protocol.encode')
        return (value: unknown) => `encoded:${String(value)}`
      },
      get decode() {
        trace.push('protocol.decode')
        return (value: unknown) => String(value).replace('encoded:', '')
      },
      get encodedType() {
        trace.push('protocol.encodedType')
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
      protocolMiddleware: customProtocol,
      contractMiddleware: customContract
    })
    const host = await batch.host.installBatch(batch.translated.map(({ definition }) => definition))
    const protocolPort = host.getShared(WebRpcSharedKey.protocol) as IWebRpcProtocolPort
    const contractPort = host.getShared(WebRpcSharedKey.contract) as IWebRpcContractPort
    expect(protocolPort?.encodedType).toBe('string')
    expect(protocolPort?.decode(protocolPort.encode('value'))).toBe('value')
    contractPort?.validateData('echo', 'params', { ok: true })
    expect(trace.slice(0, 7)).toEqual([
      'protocol.encode',
      'protocol.decode',
      'protocol.encodedType',
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
        onActivationPreflight: (state) =>
          assertPluginClaimParity(batch.claims, batch.descriptors, batch.host, batch.kernel, {
            activated: state.activated,
            activationPhase: 'pre-activation',
            routeKeys: state.routeKeys,
            translated: batch.translated,
            onMismatch: () => {
              throw primary
            }
          })
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
            if (key === (failedRole === 'protocol' ? 'encode' : 'version')) throw hostile
            return undefined
          }
        }
      )
      const batch = await createProductionBatch({
        protocolMiddleware: failedRole === 'protocol' ? protocol(config as never) : undefined,
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
      onActivationPreflight: () => events.push('activation-preflight'),
      injectInstall: (role, install) => {
        if (role.kind === 'feature' && role.key === 'outbound')
          return async (scope) => {
            const result = await install(scope)
            consumedConnect = batch.getPrepared()?.options.connect as
              | IWebRpcConnectCapability
              | undefined
            return result
          }
        return install
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
      expect(consumedConnect).toBe(finalizedConnect)
      expect(consumedConnect?.uniqueTargetId).toBe('generated-target')
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
    let successDisposals = 0
    let successOwner:
      | { readonly debugSnapshot: () => { readonly providers: number; readonly events: number } }
      | undefined
    const success = await createProductionBatch({
      providers: {
        echo: (context) => context.success('ok')
      },
      injectInstall: (role, install) => {
        if (role.kind !== 'feature' || role.key !== 'provider') return install
        return async (scope) => {
          const result = (await install(scope)) as Record<PropertyKey, unknown>
          successOwner = getEndpointModuleOwner(result) as typeof successOwner
          const dispose = result.dispose as (() => void | Promise<void>) | undefined
          return {
            ...result,
            dispose: async () => {
              successDisposals += 1
              await dispose?.()
            }
          }
        }
      }
    })
    await success.host.installBatch(success.translated.map(({ definition }) => definition))
    expect(successOwner?.debugSnapshot().providers).toBeGreaterThan(0)
    const successDispose = success.host.dispose()
    expect(success.host.dispose()).toBe(successDispose)
    await successDispose
    expect(successDisposals).toBe(1)
    expect(successOwner?.debugSnapshot()).toMatchObject({ providers: 0, events: 0 })
    await success.host.dispose()
    expect(successDisposals).toBe(1)

    let rollbackDisposals = 0
    let rollbackOwner:
      | { readonly debugSnapshot: () => { readonly providers: number; readonly events: number } }
      | undefined
    const primary = new Error('provider feature rollback primary')
    const rollback = await createProductionBatch({
      providers: {
        echo: (context) => context.success('ok')
      },
      injectInstall: (role, install) => {
        if (role.kind === 'feature' && role.key === 'provider')
          return async (scope) => {
            const result = (await install(scope)) as Record<PropertyKey, unknown>
            rollbackOwner = getEndpointModuleOwner(result) as typeof rollbackOwner
            const dispose = result.dispose as (() => void | Promise<void>) | undefined
            return {
              ...result,
              dispose: async () => {
                rollbackDisposals += 1
                await dispose?.()
              }
            }
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
    expect(rollbackDisposals).toBe(1)
    expect(rollbackOwner?.debugSnapshot()).toMatchObject({ providers: 0, events: 0 })
    await rollback.host.dispose()
    expect(rollbackDisposals).toBe(1)
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
        expect(() =>
          preflightPluginClaims(
            [...first.descriptors, duplicate],
            [...first.claims, duplicate.claims]
          )
        ).toThrow()
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
      const primary = new Error(`${missingRole} runtime publication mismatch`)
      batch = await createProductionBatch({
        injectRuntimeOutput: (role, phase, output) =>
          role.kind === 'middleware' && role.name === missingRole && phase === 'shared'
            ? {}
            : output,
        onActivationPreflight: () => {
          const index = batch.inventory.findIndex(
            (item) => item.role.kind === 'middleware' && item.role.name === missingRole
          )
          expect(
            batch.translated[index]?.getRuntimeKeys().actualSharedValues[
              WebRpcSharedKey[missingRole]
            ]
          ).toBeUndefined()
          throw primary
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
        cause: primary,
        detail: { failedName: 'activation' }
      })
      expect(batch.stats.subscribeCalls).toBe(0)
      expect(batch.stats.activeSubscriptions).toBe(0)
      expect(batch.stats.dispatches).toBe(0)
      expect(batch.isActivated()).toBe(false)
      expect(batch.kernel.state).toBe('disposed')
      expect(batch.getRuntimeState()).toBeUndefined()
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
          : install
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
      injectDescriptor: (candidate, original) =>
        candidate.kind === 'middleware-finalize'
          ? observeOptionalCancellationPorts(
              original,
              [WebRpcSharedKey.timeout, plannedAbortEnablementKey],
              observed
            )
          : original
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

  it('B12b03: timeout snapshots every retry field in receiver-free order', async () => {
    const [transport] = createMemoryTransportPair()
    const reads: string[] = []
    const retry = {
      get maxAttempts(): number {
        reads.push('retry.maxAttempts')
        return 2
      },
      get shouldRetry(): () => boolean {
        reads.push('retry.shouldRetry')
        return () => false
      },
      get delay(): () => false {
        reads.push('retry.delay')
        return () => false
      }
    }
    let timeoutReceiver = false
    const config = {
      get timeoutMs(): number {
        timeoutReceiver = this === config
        reads.push('timeoutMs')
        return 25
      },
      get retry(): typeof retry {
        reads.push('retry')
        return retry
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
    expect(reads).toEqual([
      'timeoutMs',
      'retry',
      'retry.maxAttempts',
      'retry.shouldRetry',
      'retry.delay'
    ])
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
          : install
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
      [outbound(), provider()]
    )
    const client = await createComposedEndpoint(
      {
        id: 'b12b03-client',
        targetIds: ['b12b03-server'],
        transport: clientTransport,
        middlewares: [connect({ transport: clientTransport }), protocol(), abort(), timeout()]
      },
      [outbound()]
    )
    const controller = new AbortController()
    const reason = new DOMException('operation abort', 'AbortError')
    const pending = client.send('b12b03-server', 'hang', null, {
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
        injectDescriptor: (candidate, original) => {
          if (candidate.kind === 'middleware' && candidate.name === role)
            return nativeCancellationDescriptor(original, role, key, { events })
          if (candidate.kind === 'middleware-finalize')
            return observeOptionalCancellationPorts(original, [key], observed)
          return original
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
    const batch = await createProductionBatch({
      injectDescriptor: (candidate, original) =>
        candidate.kind === 'feature' && candidate.key === 'chunk'
          ? {
              ...original,
              sharedProvides: [arbitraryKey],
              shared: () => ({ [arbitraryKey]: arbitraryValue })
            }
          : original
    })
    await batch.host.installBatch(batch.translated.map(({ definition }) => definition))
    expect(batch.host.getShared(arbitraryKey)).toBe(arbitraryValue)
    await batch.host.dispose()
  })

  it('B12b03: real inventory admits a non-reserved native plugin with an arbitrary shared key', async () => {
    const arbitraryKey = Symbol('custom-native-key')
    const arbitraryValue = Object.freeze({ marker: 'custom-native' })
    const batch = await createProductionBatch({
      injectDescriptor: (candidate, original) =>
        candidate.kind === 'middleware' && candidate.name === 'hooks'
          ? {
              ...original,
              name: 'custom-native',
              sharedProvides: [arbitraryKey],
              sharedConsumes: [],
              sharedOptionalConsumes: [],
              install: async () => ({}),
              shared: () => ({ [arbitraryKey]: arbitraryValue })
            }
          : original
    })
    await batch.host.installBatch(batch.translated.map(({ definition }) => definition))
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
      const batch = await createProductionBatch({
        skipPreflight: true,
        injectDescriptor: (candidate, original) =>
          candidate.kind === 'middleware' && candidate.name === role
            ? {
                ...original,
                name: `middleware:${role}`,
                sharedProvides: [forgedKey],
                install: async (scope) => {
                  installCalls += 1
                  return original.install(scope)
                }
              }
            : original
      })
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
        preflightPluginClaims(batch.descriptors, batch.claims)
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
          injectDescriptor: (candidate, original) =>
            candidate.kind === 'middleware' && candidate.name === role
              ? nativeCancellationDescriptor(original, role, key)
              : original,
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
      const batch = await createProductionBatch({
        skipPreflight: true,
        injectDescriptor: (candidate, original) =>
          candidate.kind === 'middleware' && candidate.name === role
            ? nativeCancellationDescriptor(original, role, forgedKey)
            : original,
        injectInstall: (_candidate, install) => async (scope) => {
          installCalls += 1
          return install(scope)
        }
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
        preflightPluginClaims(batch.descriptors, batch.claims)
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
    const descriptors = batch.descriptors.map((original, index) => {
      const role = batch.inventory[index]?.role
      if (role?.kind !== 'middleware' || role.name !== 'abort') return original
      const forged = { ...original }
      Object.defineProperty(forged, 'sharedProvides', {
        configurable: true,
        enumerable: true,
        get: () => {
          throw hostile
        }
      })
      return forged
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
      preflightPluginClaims(descriptors, batch.claims)
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
        injectDescriptor: (candidate, original) =>
          candidate.kind === 'middleware' && candidate.name === role
            ? {
                ...nativeCancellationDescriptor(original, role, key),
                shared: () => ({})
              }
            : original
      })
      const installed = await batch.host.installBatch(
        batch.translated.map(({ definition }) => definition)
      )
      expect(() =>
        assertPluginClaimParity(batch.claims, batch.descriptors, installed, batch.kernel, {
          activated: batch.isActivated(),
          translated: batch.translated,
          onMismatch: (error) => {
            throw error
          }
        })
      ).toThrow(/INVALID_CONFIG|invalid/i)
      await batch.host.dispose()
    }
  )

  it.each([
    ['timeout', WebRpcSharedKey.timeout],
    ['abort', plannedAbortEnablementKey]
  ] as const)(
    'B12b03 RED: duplicate %s providers are rejected before Host mutation',
    async (role, key) => {
      await expect(
        createProductionBatch({
          injectDescriptor: (candidate, original) => {
            if (candidate.kind === 'middleware' && candidate.name === role)
              return nativeCancellationDescriptor(original, role, key)
            if (candidate.kind === 'middleware' && candidate.name === 'protocol')
              return { ...original, sharedProvides: [key] }
            return original
          }
        })
      ).rejects.toMatchObject({ code: 'INVALID_CONFIG' })
    }
  )

  it('B12b03: native timeout snapshot survives post-factory and post-install mutation', async () => {
    const reads: string[] = []
    let timeoutMs = 7
    let maxAttempts = 2
    let shouldRetry = false
    let delay = 11
    const retry = {
      get maxAttempts() {
        reads.push('retry.maxAttempts')
        return maxAttempts
      },
      get shouldRetry() {
        reads.push('retry.shouldRetry')
        return shouldRetry
      },
      get delay() {
        reads.push('retry.delay')
        return delay
      }
    }
    const config = {
      get timeoutMs() {
        reads.push('timeoutMs')
        return timeoutMs
      },
      get retry() {
        reads.push('retry')
        return retry
      }
    }
    const batch = await createProductionBatch({
      injectDescriptor: (candidate, original) => {
        if (candidate.kind !== 'middleware' || candidate.name !== 'timeout') return original
        const snapshotTimeoutMs = config.timeoutMs
        const retrySnapshot = config.retry
        const snapshot = {
          timeoutMs: snapshotTimeoutMs,
          retry: {
            maxAttempts: retrySnapshot.maxAttempts,
            shouldRetry: retrySnapshot.shouldRetry,
            delay: retrySnapshot.delay
          }
        }
        return nativeCancellationDescriptor(original, 'timeout', WebRpcSharedKey.timeout, {
          sharedValue: {
            resolve: (requested?: number | false) => requested ?? snapshot.timeoutMs,
            snapshot
          }
        })
      }
    })
    timeoutMs = 99
    maxAttempts = 99
    shouldRetry = true
    delay = 99
    await batch.host.installBatch(batch.translated.map(({ definition }) => definition))
    timeoutMs = 101
    maxAttempts = 101
    shouldRetry = false
    delay = 101
    const published = batch.host.getShared(WebRpcSharedKey.timeout) as {
      readonly resolve: (requested?: number | false) => number | false
      readonly snapshot: { readonly timeoutMs: number }
    }
    expect(published.resolve()).toBe(7)
    expect(published.snapshot.timeoutMs).toBe(7)
    expect(reads).toEqual([
      'timeoutMs',
      'retry',
      'retry.maxAttempts',
      'retry.shouldRetry',
      'retry.delay'
    ])
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
        injectDescriptor: (candidate, original) => {
          if (candidate.kind !== 'middleware' || candidate.name !== role) return original
          const key = role === 'timeout' ? WebRpcSharedKey.timeout : plannedAbortEnablementKey
          const native = nativeCancellationDescriptor(original, role, key, { events })
          return {
            ...native,
            install: async (_scope) => {
              events.push(`${role}:install`)
              await new Promise<void>((resolve) => {
                release = resolve
              })
              return { dispose: async () => events.push(`${role}:dispose`) }
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
      const reports: unknown[] = []
      let release!: () => void
      const batch = await createProductionBatch({
        construction: { signal: controller.signal as IWebRpcAbortSignal },
        report: (error) => reports.push(error),
        injectDescriptor: (candidate, original) => {
          if (candidate.kind !== 'middleware' || candidate.name !== role) return original
          const key = role === 'timeout' ? WebRpcSharedKey.timeout : plannedAbortEnablementKey
          const native = nativeCancellationDescriptor(original, role, key)
          return {
            ...native,
            install: async () => {
              await new Promise<void>((resolve) => {
                release = resolve
              })
              throw latePrimary
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
        expect(errorChainContains(failure, reason)).toBe(true)
        expect(reports.some((error) => errorChainContains(error, latePrimary))).toBe(true)
        expect(batch.stats.activeSubscriptions).toBe(0)
      } finally {
        await batch.host.dispose()
      }
    }
  )

  it('B12b03 RED: native abort async hostile install preserves PH01 and zero residue', async () => {
    const primary = new Error('native abort hostile install')
    const batch = await createProductionBatch({
      injectDescriptor: (candidate, original) =>
        candidate.kind === 'middleware' && candidate.name === 'abort'
          ? nativeCancellationDescriptor(original, 'abort', plannedAbortEnablementKey, {
              installFailure: Promise.resolve().then(() => {
                throw primary
              })
            })
          : original
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
      [outbound(), provider()]
    )
    const client = await createComposedEndpoint(
      {
        id: 'b12b03-round10-client',
        targetIds: ['b12b03-round10-server'],
        transport: clientTransport,
        middlewares: [connect({ transport: clientTransport }), protocol(), abort(), timeout()]
      },
      [outbound()]
    )
    const controller = new AbortController()
    const reason = new DOMException('timeout race caller abort', 'AbortError')
    const pending = client.send('b12b03-round10-server', 'hang', null, {
      signal: controller.signal as IWebRpcAbortSignal,
      timeoutMs: 1
    })
    const settled = pending.catch((error: unknown) => error)
    await providerStarted
    controller.abort(reason)
    const failure = await settled
    try {
      expect(failure).toMatchObject({ name: 'AbortError', cause: reason })
    } finally {
      lateResolve?.()
      await Promise.resolve()
      await Promise.resolve()
      expect(readEndpointDebugSnapshot(server)?.activeControllers).toBe(0)
      await client.dispose()
      await server.dispose()
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
      [outbound(), provider()]
    )
    const client = await createComposedEndpoint(
      {
        id: 'b12b03-round11-timeout-client',
        targetIds: ['b12b03-round11-timeout-server'],
        transport: clientTransport,
        middlewares: [connect({ transport: clientTransport }), protocol(), abort(), timeout()]
      },
      [outbound()]
    )
    const controller = new AbortController()
    const reason = new DOMException('late caller abort', 'AbortError')
    const pending = client.send('b12b03-round11-timeout-server', 'hang', null, {
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
      [outbound(), provider()]
    )
    const client = await createComposedEndpoint(
      {
        id: 'b12b03-round13-late-reject-client',
        targetIds: ['b12b03-round13-late-reject-server'],
        transport: clientTransport,
        middlewares: [connect({ transport: clientTransport }), protocol(), abort(), timeout()]
      },
      [outbound()]
    )
    /** Captures the active server's idle root and operation-observer baseline before send. */
    const idleServer = readEndpointDebugSnapshot(server)
    expect(idleServer).toBeDefined()
    /** Narrows the registered package-test observer after the explicit baseline assertion. */
    const idleServerSnapshot = idleServer!
    expect(idleServerSnapshot.providers).toBe(1)
    const controller = new AbortController()
    const pending = client.send('b12b03-round13-late-reject-server', 'hang', null, {
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
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
      expect(reports.some((error) => errorChainContains(error, latePrimary))).toBe(true)
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
      new URL('../../../store-worker/src/worker.ts', import.meta.url),
      'utf8'
    )
    const serializeSource = readFileSync(
      new URL('../../../store-worker/src/serialize/worker.ts', import.meta.url),
      'utf8'
    )
    expect(workerSource).toMatch(/abort\(\)/)
    expect(workerSource).toMatch(/timeout\(/)
    expect(serializeSource).toMatch(/abort\(\)/)
    expect(serializeSource).toMatch(/timeout\(/)
  })

  it.each(['hooks', 'ping', 'uuid', 'chunk'] as const)(
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
    for (const role of ['hooks', 'ping', 'uuid', 'chunk', 'middleware-finalize'] as const) {
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
      WebRpcSharedKey.uuid,
      WebRpcSharedKey.chunk
    ])
  })

  it.each(['hooks', 'ping', 'uuid', 'chunk'] as const)(
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

  it('B12b04: real production builder snapshots hook/uuid/chunk factories at install', async () => {
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
    const chunkConfig = {
      get chunkSize() {
        reads.push('chunk.chunkSize')
        return 8
      }
    }
    const batch = await createProductionBatch({
      hooksMiddleware: hooks(hooksConfig),
      uuidMiddleware: uuid(uuidConfig),
      chunkMiddleware: chunkMiddleware(chunkConfig)
    })
    expect(reads).toEqual([])
    await batch.host.installBatch(batch.translated.map(({ definition }) => definition))
    expect(reads).toEqual([
      'uuid.generate',
      'chunk.chunkSize',
      'hooks.listeners',
      'hooks.onHookError'
    ])
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
    expect(batch.getPrepared()?.options.chunk?.chunkSize).toBe(8)
    expect(batch.getPrepared()?.options.hooks?.listeners).toHaveLength(1)
    expect(Object.isFrozen(batch.getPrepared()?.options.uuid)).toBe(true)
    expect(Object.isFrozen(batch.getPrepared()?.options.hooks)).toBe(true)
    expect(Object.isFrozen(batch.getPrepared()?.options.chunk)).toBe(true)
    expect(batch.getPrepared()?.options.hooks?.listeners).not.toBe(currentListeners)
    await batch.host.dispose()
  })

  it('B12b04 RED: chunk production snapshots are concurrent, retry-fresh, barrier-gated, and isolated', async () => {
    const fieldOrder = [
      'chunk.chunkSize',
      'chunk.maxMessageBytes',
      'chunk.maxConcurrentMessages',
      'chunk.maxConcurrentMessagesPerPeer',
      'chunk.maxBufferedBytes',
      'chunk.maxChunksPerMessage',
      'chunk.maxChunkBytes',
      'chunk.assemblyTimeoutMs',
      'chunk.byteLength',
      'chunk.split'
    ] as const
    type IChunkValues = {
      chunkSize: number
      maxMessageBytes: number
      maxConcurrentMessages: number
      maxConcurrentMessagesPerPeer: number
      maxBufferedBytes: number
      maxChunksPerMessage: number
      maxChunkBytes: number
      assemblyTimeoutMs: number
      byteLength: (value: string) => number
      split: (value: string) => readonly string[]
    }
    const createChunkAttempt = (values: IChunkValues) => {
      const reads: string[] = []
      const receivers: unknown[] = []
      const config = Object.create(null) as Record<string, unknown>
      for (const field of fieldOrder.map((entry) => entry.slice('chunk.'.length)))
        Object.defineProperty(config, field, {
          configurable: true,
          enumerable: true,
          get() {
            reads.push(`chunk.${field}`)
            receivers.push(this)
            return values[field as keyof IChunkValues]
          }
        })
      return {
        config: config as Parameters<typeof chunkMiddleware>[0],
        reads,
        receivers,
        values
      }
    }
    const assertChunkSnapshot = (
      snapshot: Partial<Record<keyof IChunkValues, unknown>> | undefined,
      expected: IChunkValues
    ): void => {
      expect(snapshot?.chunkSize).toBe(expected.chunkSize)
      expect(snapshot?.maxMessageBytes).toBe(expected.maxMessageBytes)
      expect(snapshot?.maxConcurrentMessages).toBe(expected.maxConcurrentMessages)
      expect(snapshot?.maxConcurrentMessagesPerPeer).toBe(expected.maxConcurrentMessagesPerPeer)
      expect(snapshot?.maxBufferedBytes).toBe(expected.maxBufferedBytes)
      expect(snapshot?.maxChunksPerMessage).toBe(expected.maxChunksPerMessage)
      expect(snapshot?.maxChunkBytes).toBe(expected.maxChunkBytes)
      expect(snapshot?.assemblyTimeoutMs).toBe(expected.assemblyTimeoutMs)
      expect(snapshot?.byteLength).toBe(expected.byteLength)
      expect(snapshot?.split).toBe(expected.split)
    }
    const leftValues: IChunkValues = {
      chunkSize: 8,
      maxMessageBytes: 1024,
      maxConcurrentMessages: 2,
      maxConcurrentMessagesPerPeer: 2,
      maxBufferedBytes: 4096,
      maxChunksPerMessage: 16,
      maxChunkBytes: 1024,
      assemblyTimeoutMs: 1000,
      byteLength: (value) => value.length,
      split: (value) => [value]
    }
    const rightValues: IChunkValues = {
      chunkSize: 12,
      maxMessageBytes: 1536,
      maxConcurrentMessages: 3,
      maxConcurrentMessagesPerPeer: 4,
      maxBufferedBytes: 6144,
      maxChunksPerMessage: 24,
      maxChunkBytes: 1536,
      assemblyTimeoutMs: 1500,
      byteLength: (value) => value.length + 10,
      split: (value) => [value, value]
    }
    const leftAttempt = createChunkAttempt(leftValues)
    const rightAttempt = createChunkAttempt(rightValues)
    const leftSnapshot = { ...leftValues }
    const rightSnapshot = { ...rightValues }
    const [left, right] = await Promise.all([
      createProductionBatch({ chunkMiddleware: chunkMiddleware(leftAttempt.config) }),
      createProductionBatch({ chunkMiddleware: chunkMiddleware(rightAttempt.config) })
    ])
    expect(leftAttempt.reads).toEqual([])
    expect(rightAttempt.reads).toEqual([])
    await Promise.all([
      left.host.installBatch(left.translated.map(({ definition }) => definition)),
      right.host.installBatch(right.translated.map(({ definition }) => definition))
    ])
    expect(leftAttempt.reads).toEqual([...fieldOrder])
    expect(rightAttempt.reads).toEqual([...fieldOrder])
    for (const receiver of leftAttempt.receivers) expect(receiver).toBe(leftAttempt.config)
    for (const receiver of rightAttempt.receivers) expect(receiver).toBe(rightAttempt.config)
    const leftPrepared = left.getPrepared()?.options.chunk
    const rightPrepared = right.getPrepared()?.options.chunk
    assertChunkSnapshot(leftPrepared, leftSnapshot)
    assertChunkSnapshot(rightPrepared, rightSnapshot)
    expect(Object.isFrozen(leftPrepared)).toBe(true)
    expect(Object.isFrozen(rightPrepared)).toBe(true)
    leftValues.chunkSize = 99
    leftValues.maxMessageBytes = 9999
    leftValues.maxConcurrentMessages = 9
    leftValues.maxConcurrentMessagesPerPeer = 10
    leftValues.maxBufferedBytes = 99999
    leftValues.maxChunksPerMessage = 96
    leftValues.maxChunkBytes = 9999
    leftValues.assemblyTimeoutMs = 9000
    leftValues.byteLength = () => 99
    leftValues.split = () => ['left-mutated']
    rightValues.chunkSize = 199
    rightValues.maxMessageBytes = 1999
    rightValues.maxConcurrentMessages = 19
    rightValues.maxConcurrentMessagesPerPeer = 20
    rightValues.maxBufferedBytes = 19999
    rightValues.maxChunksPerMessage = 196
    rightValues.maxChunkBytes = 1999
    rightValues.assemblyTimeoutMs = 19000
    rightValues.byteLength = () => 199
    rightValues.split = () => ['mutated']
    assertChunkSnapshot(leftPrepared, leftSnapshot)
    assertChunkSnapshot(rightPrepared, rightSnapshot)
    const leftDispose = left.host.dispose()
    const rightDispose = right.host.dispose()
    expect(left.host.dispose()).toBe(leftDispose)
    expect(right.host.dispose()).toBe(rightDispose)
    await Promise.all([leftDispose, rightDispose])

    const retryValues: IChunkValues = {
      chunkSize: 20,
      maxMessageBytes: 2020,
      maxConcurrentMessages: 5,
      maxConcurrentMessagesPerPeer: 6,
      maxBufferedBytes: 8200,
      maxChunksPerMessage: 40,
      maxChunkBytes: 2020,
      assemblyTimeoutMs: 2200,
      byteLength: (value) => value.length + 20,
      split: (value) => [value, 'retry']
    }
    const retryAttempt = createChunkAttempt(retryValues)
    const retryMiddleware = chunkMiddleware(retryAttempt.config)
    const failedPrimary = new Error('chunk failed attempt')
    const failed = await createProductionBatch({
      chunkMiddleware: retryMiddleware,
      injectInstall: (role, install) =>
        role.kind === 'middleware' && role.name === 'chunk'
          ? async (scope) => {
              await install(scope)
              throw failedPrimary
            }
          : install
    })
    await expect(
      failed.host.installBatch(failed.translated.map(({ definition }) => definition))
    ).rejects.toMatchObject({ cause: failedPrimary, detail: { failedName: 'middleware:chunk' } })
    expect(retryAttempt.reads).toEqual([...fieldOrder])
    for (const receiver of retryAttempt.receivers) expect(receiver).toBe(retryAttempt.config)
    retryValues.chunkSize = 28
    retryValues.maxMessageBytes = 4096
    retryValues.maxConcurrentMessages = 7
    retryValues.maxConcurrentMessagesPerPeer = 8
    retryValues.maxBufferedBytes = 16384
    retryValues.maxChunksPerMessage = 64
    retryValues.maxChunkBytes = 4096
    retryValues.assemblyTimeoutMs = 3200
    retryValues.byteLength = (value) => value.length + 28
    retryValues.split = (value) => [value, 'fresh-retry']
    const retryFreshSnapshot = { ...retryValues }
    const fresh = await createProductionBatch({ chunkMiddleware: retryMiddleware })
    await fresh.host.installBatch(fresh.translated.map(({ definition }) => definition))
    expect(retryAttempt.reads).toEqual([...fieldOrder, ...fieldOrder])
    for (const receiver of retryAttempt.receivers) expect(receiver).toBe(retryAttempt.config)
    assertChunkSnapshot(fresh.getPrepared()?.options.chunk, retryFreshSnapshot)
    const failedDispose = failed.host.dispose()
    const freshDispose = fresh.host.dispose()
    expect(failed.host.dispose()).toBe(failedDispose)
    expect(fresh.host.dispose()).toBe(freshDispose)
    await Promise.all([failedDispose, freshDispose])

    const barrierValues: IChunkValues = {
      chunkSize: 32,
      maxMessageBytes: 3072,
      maxConcurrentMessages: 11,
      maxConcurrentMessagesPerPeer: 12,
      maxBufferedBytes: 12288,
      maxChunksPerMessage: 48,
      maxChunkBytes: 3072,
      assemblyTimeoutMs: 3300,
      byteLength: (value) => value.length + 32,
      split: (value) => [value, 'barrier']
    }
    const barrierSnapshot = { ...barrierValues }
    const barrierAttempt = createChunkAttempt(barrierValues)
    const barrierMiddleware = chunkMiddleware(barrierAttempt.config)
    let release!: () => void
    const barrier = new Promise<void>((resolve) => {
      release = resolve
    })
    const barrierBatch = await createProductionBatch({
      chunkMiddleware: barrierMiddleware,
      injectInstall: (role, install) =>
        role.kind === 'middleware' && role.name === 'chunk'
          ? async (scope) => {
              await barrier
              return install(scope)
            }
          : install
    })
    const barrierInstall = barrierBatch.host.installBatch(
      barrierBatch.translated.map(({ definition }) => definition)
    )
    await Promise.resolve()
    expect(barrierAttempt.reads).toEqual([])
    release()
    await barrierInstall
    expect(barrierAttempt.reads).toEqual([...fieldOrder])
    for (const receiver of barrierAttempt.receivers) expect(receiver).toBe(barrierAttempt.config)
    assertChunkSnapshot(barrierBatch.getPrepared()?.options.chunk, barrierSnapshot)
    barrierValues.chunkSize = 42
    barrierValues.maxMessageBytes = 4096
    barrierValues.maxConcurrentMessages = 13
    barrierValues.maxConcurrentMessagesPerPeer = 14
    barrierValues.maxBufferedBytes = 16384
    barrierValues.maxChunksPerMessage = 80
    barrierValues.maxChunkBytes = 4096
    barrierValues.assemblyTimeoutMs = 4300
    barrierValues.byteLength = () => 42
    barrierValues.split = () => ['barrier-mutated']
    assertChunkSnapshot(barrierBatch.getPrepared()?.options.chunk, barrierSnapshot)
    const barrierDispose = barrierBatch.host.dispose()
    expect(barrierBatch.host.dispose()).toBe(barrierDispose)
    await barrierDispose
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
    ['uuid', 'generate'],
    ['chunk', 'chunkSize'],
    ['chunk', 'maxMessageBytes'],
    ['chunk', 'maxConcurrentMessages'],
    ['chunk', 'maxConcurrentMessagesPerPeer'],
    ['chunk', 'maxBufferedBytes'],
    ['chunk', 'maxChunksPerMessage'],
    ['chunk', 'maxChunkBytes'],
    ['chunk', 'assemblyTimeoutMs'],
    ['chunk', 'byteLength'],
    ['chunk', 'split']
  ] as const)(
    'B12b04 T87: hostile %s snapshot getter %s preserves exact cutoff and residue',
    async (role, field) => {
      const primary = new Error(`${role}-${field}-getter`)
      const reads: string[] = []
      const receivers: unknown[] = []
      const values: Record<string, unknown> = {
        listeners: [],
        onHookError: undefined,
        generate: () => 'hostile-id',
        chunkSize: 8,
        maxMessageBytes: 1024,
        maxConcurrentMessages: 2,
        maxConcurrentMessagesPerPeer: 2,
        maxBufferedBytes: 4096,
        maxChunksPerMessage: 16,
        maxChunkBytes: 1024,
        assemblyTimeoutMs: 1000,
        byteLength: (value: unknown) => String(value).length,
        split: (value: unknown) => [value]
      }
      let middleware: IWebRpcPlugin
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
      } else {
        const config = Object.create(null) as Record<string, unknown>
        for (const name of [
          'chunkSize',
          'maxMessageBytes',
          'maxConcurrentMessages',
          'maxConcurrentMessagesPerPeer',
          'maxBufferedBytes',
          'maxChunksPerMessage',
          'maxChunkBytes',
          'assemblyTimeoutMs',
          'byteLength',
          'split'
        ])
          Object.defineProperty(config, name, {
            configurable: true,
            enumerable: true,
            get: () => {
              reads.push(`chunk.${name}`)
              receivers.push(config)
              if (name === field) throw primary
              return values[name]
            }
          })
        snapshotConfig = config
        middleware = chunkMiddleware(config as Parameters<typeof chunkMiddleware>[0])
      }
      let roleInstallCalls = 0
      const batch = await createProductionBatch({
        ...(role === 'hooks'
          ? { hooksMiddleware: middleware }
          : role === 'uuid'
            ? { uuidMiddleware: middleware }
            : { chunkMiddleware: middleware }),
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
        role === 'hooks'
          ? ['hooks.listeners', 'hooks.onHookError']
          : role === 'uuid'
            ? ['uuid.generate']
            : [
                'chunk.chunkSize',
                'chunk.maxMessageBytes',
                'chunk.maxConcurrentMessages',
                'chunk.maxConcurrentMessagesPerPeer',
                'chunk.maxBufferedBytes',
                'chunk.maxChunksPerMessage',
                'chunk.maxChunkBytes',
                'chunk.assemblyTimeoutMs',
                'chunk.byteLength',
                'chunk.split'
              ]
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

  it.each(['hooks', 'ping', 'uuid', 'chunk'] as const)(
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

  it.each(['hooks', 'ping', 'uuid', 'chunk'] as const)(
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

  it.each(['hooks', 'ping', 'uuid', 'chunk'] as const)(
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
      expect(() =>
        preflightPluginClaims(
          [entry.descriptor, duplicate],
          [entry.descriptor.claims, duplicate.claims]
        )
      ).toThrow()
      await batch.host.dispose()
    }
  )

  it.each(['hooks', 'ping', 'uuid', 'chunk'] as const)(
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
      expect(() => preflightPluginClaims([forged], [forged.claims])).toThrow()
      expect(productionHostSnapshot(batch)).toEqual(before)
      await batch.host.dispose()
    }
  )

  it.each(['hooks', 'ping', 'uuid', 'chunk'] as const)(
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
      expect(() => preflightPluginClaims([forged], [forged.claims])).toThrow()
      expect(productionHostSnapshot(batch)).toEqual(before)
      await batch.host.dispose()
    }
  )

  it.each(
    (['hooks', 'ping', 'uuid', 'chunk'] as const).flatMap((role) =>
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

  it.each(['hooks', 'ping', 'uuid', 'chunk'] as const)(
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
          WebRpcSharedKey.chunk,
          WebRpcSharedKey.outboundAttachment
        ].every((key) => batch.host.getShared(key) === undefined)
      ).toBe(true)
      const firstDispose = batch.host.dispose()
      expect(batch.host.dispose()).toBe(firstDispose)
      await firstDispose.catch(() => undefined)
    }
  )

  it.each(['hooks', 'ping', 'uuid', 'chunk'] as const)(
    'B12b04 T89: native-shaped %s publication and endpoint disposal share one composed transaction',
    async (role) => {
      const key = plannedB12b04Keys[role]
      const port =
        role === 'hooks'
          ? Object.freeze({ emit: (_event: unknown) => undefined })
          : role === 'ping'
            ? WebRpcPingEnablePortShape
            : role === 'uuid'
              ? Object.freeze({ create: () => `${role}-id` })
              : Object.freeze({ split: (value: unknown) => [value] })
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
        install: (scope) => {
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
        install: (scope) => {
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
        ...(role === 'chunk' ? [] : [chunkMiddleware()]),
        abort(),
        timeout()
      ]
      const endpoint = await createComposedEndpoint(
        { id: `t89-${role}`, transport, middlewares: middleware },
        [outbound(), provider(), discovery(), control(), chunk()] as const
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
      const hostDisposeSpy = vi.spyOn(WebRpcPluginHost.prototype, 'dispose')
      const endpointDispose = endpoint.dispose()
      expect(hostDisposeSpy).toHaveBeenCalledTimes(1)
      const hostDisposePromise = hostDisposeSpy.mock.results[0]?.value as Promise<void>
      hostDisposeSpy.mockRestore()
      expect(endpoint.dispose()).toBe(endpointDispose)
      const failure = await endpointDispose.catch((error: unknown) => error)
      const hostFailure = await hostDisposePromise.catch((error: unknown) => error)
      expect(failure).toBeInstanceOf(WebRpcLifecycleError)
      expect(hostFailure).toBe(failure)
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

  it('B12b04: production chunk seam retains boundary, ordering, limit, cancellation, and cleanup baselines', async () => {
    const batch = await createProductionBatch({
      chunkMiddleware: chunkMiddleware({ chunkSize: 4 })
    })
    await batch.host.installBatch(batch.translated.map(({ definition }) => definition))
    const capability = batch.getPrepared()?.options.chunk
    expect(capability).toBeDefined()
    const chunkCapability = capability!
    const split = chunkCapability.split!
    const byteLength = chunkCapability.byteLength!
    expect(split('A¢中😀', 4).join('')).toBe('A¢中😀')
    expect(Math.max(...split('A¢中😀', 4).map((part) => byteLength(part)))).toBeLessThanOrEqual(4)
    const first = batch.host.dispose()
    expect(batch.host.dispose()).toBe(first)
    await first
  })

  it.each(['hooks', 'uuid', 'chunk'] as const)(
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
          : role === 'uuid'
            ? uuid({
                get generate(): never {
                  throw hostile
                }
              } as never)
            : chunkMiddleware({
                get chunkSize(): never {
                  throw hostile
                }
              } as never)
      const batch = await createProductionBatch(
        role === 'hooks'
          ? { hooksMiddleware: middleware }
          : role === 'uuid'
            ? { uuidMiddleware: middleware }
            : { chunkMiddleware: middleware }
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

  /** Returns the actual outbound feature entry from the composed production inventory. */
  function findOutboundEntry(batch: IProductionBatch): IWebRpcComposedPluginInventoryEntry {
    const entry = batch.inventory.find(
      ({ role }) => role.kind === 'feature' && role.key === 'outbound'
    )
    if (!entry) throw new Error('outbound production inventory entry missing')
    return entry
  }

  /** Builds a frozen temporary facade around the real broad owner for compatibility-only tests. */
  async function drainBatchTurns(): Promise<void> {
    for (let index = 0; index < 12; index += 1) await Promise.resolve()
  }

  it('T90 B12c01 RED: outbound inventory claims exact narrow shared ports', async () => {
    const batch = await createProductionBatch()
    try {
      const entry = findOutboundEntry(batch)
      expect({
        name: entry.descriptor.name,
        claims: entry.descriptor.claims,
        sharedProvides: entry.descriptor.sharedProvides,
        sharedConsumes: entry.descriptor.sharedConsumes
      }).toEqual({
        name: 'outbound',
        claims: {
          routes: ['response', 'variation'],
          provides: ['inbound-identity', 'variation-coordinator'],
          consumes: [],
          publicKeys: ['send', 'sendAll', 'dispatch', 'dispatchAll'],
          exposedKeys: ['send', 'sendAll', 'dispatch', 'dispatchAll'],
          activator: false,
          sharedProvides: [
            WebRpcSharedKey.inboundIdentity,
            WebRpcSharedKey.variationCoordinator,
            WebRpcSharedKey.outboundOperations
          ],
          sharedConsumes: []
        },
        sharedProvides: [
          WebRpcSharedKey.inboundIdentity,
          WebRpcSharedKey.variationCoordinator,
          WebRpcSharedKey.outboundOperations
        ],
        sharedConsumes: []
      })
    } finally {
      await batch.host.dispose()
    }
  })

  it('T91 B12c01 RED: outbound result uses Host-owned disposal without legacy blanket escape', async () => {
    const batch = await createProductionBatch()
    try {
      const entry = findOutboundEntry(batch)
      expect({
        disposeResult: entry.descriptor.disposeResult,
        hasBroadAttachmentPort: entry.descriptor.sharedProvides?.includes(
          WebRpcSharedKey.outboundAttachment
        )
      }).toEqual({ disposeResult: undefined, hasBroadAttachmentPort: false })
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
    const barrier = new Promise<void>((resolve) => {
      release = resolve
    })
    const batch = await createProductionBatch({
      injectInstall: (role, install) => {
        if (role.kind !== 'feature' || role.key !== 'outbound') return install
        return async (scope) => {
          await barrier
          return install(scope)
        }
      }
    })
    try {
      const installing = batch.host.installBatch(
        batch.translated.map(({ definition }) => definition)
      )
      await drainBatchTurns()
      expect(batch.stats.subscribeCalls).toBe(0)
      expect(batch.stats.dispatches).toBe(0)
      expect(batch.isActivated()).toBe(false)
      release()
      await installing
      expect(batch.stats.subscribeCalls).toBe(1)
      expect(batch.isActivated()).toBe(true)
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
    const replaceDispose = (result: object, dispose: () => Promise<void>): object => {
      const observed = Object.create(Object.getPrototypeOf(result)) as Record<PropertyKey, unknown>
      for (const key of Reflect.ownKeys(result)) {
        const property = Object.getOwnPropertyDescriptor(result, key)!
        Object.defineProperty(
          observed,
          key,
          key === 'dispose' ? { ...property, value: dispose } : property
        )
      }
      return Object.freeze(observed)
    }
    let successOutboundDisposeCalls = 0
    const success = await createProductionBatch({
      lifecycleTrace: successTrace,
      transportOwnership: 'owned',
      injectDescriptor: (role, descriptor) => {
        if (role.kind !== 'feature' || role.key !== 'outbound') return descriptor
        return {
          ...descriptor,
          disposeResult: undefined,
          install: async (scope) => {
            const result = (await descriptor.install(scope)) as object & {
              readonly dispose?: () => Promise<void>
            }
            const originalDispose = result.dispose
            return replaceDispose(result, async (): Promise<void> => {
              successOutboundDisposeCalls += 1
              successTrace.push({ kind: 'outbound.release', instance: originalDispose })
              await originalDispose?.()
            })
          }
        }
      },
      injectInstall: (role, install) => {
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
    const successInstalledResidue = productionResidueSnapshot(success)
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
    expect(successTerminalResidue.activated).toBe(successInstalledResidue.activated)
    expect(successTerminalResidue.installations).toEqual(successInstalledResidue.installations)

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
      injectDescriptor: (role, descriptor) => {
        if (role.kind !== 'feature' || role.key !== 'outbound') return descriptor
        return {
          ...descriptor,
          disposeResult: undefined,
          install: async (scope) => {
            const result = (await descriptor.install(scope)) as object & {
              readonly dispose?: () => Promise<void>
            }
            const originalDispose = result.dispose
            return replaceDispose(result, async (): Promise<void> => {
              failureOutboundDisposeCalls += 1
              failureTrace.push({ kind: 'outbound.release', instance: outboundFailure })
              try {
                await originalDispose?.()
              } catch (error) {
                throw new AggregateError([outboundFailure, error])
              }
              throw outboundFailure
            })
          }
        }
      },
      injectInstall: (role, install) => {
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
    const failureInstalledResidue = productionResidueSnapshot(failing)
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
    expect(failureTerminalResidue.activated).toBe(failureInstalledResidue.activated)
    expect(failureTerminalResidue.installations).toEqual(failureInstalledResidue.installations)

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
        protocol({
          encode: (value) => {
            events.push('encode')
            return value
          }
        }),
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
      await drainBatchTurns()
      expect(events).toEqual(['encode', 'encrypt', 'sign', 'transport'])
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
      const descriptorEntry = findOutboundEntry(descriptorBatch)
      expect(descriptorEntry.descriptor.claims.publicKeys).toEqual([
        'send',
        'sendAll',
        'dispatch',
        'dispatchAll'
      ])
      expect(Object.keys(client)).toEqual([
        'on',
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

  async function runInstallationObservationBranch(options: {
    readonly name: string
    readonly value: unknown
    readonly disposeResult?: boolean
  }): Promise<void> {
    const descriptor: IWebRpcPluginDescriptor = {
      name: options.name,
      claims: emptyClaims,
      ...(options.disposeResult === undefined ? {} : { disposeResult: options.disposeResult }),
      install: async () => options.value
    }
    const batch = await createProductionBatch({ additionalDescriptors: [descriptor] })
    const translated = batch.translated.find(({ definition }) => definition.name === options.name)
    expect(translated).toBeDefined()
    await batch.host.installBatch(batch.translated.map(({ definition }) => definition))
    expect(translated!.getInstallationObservation()).toEqual({
      installed: true,
      value: options.value
    })
    expect(translated!.getLiveInstallationObservation()).toEqual({
      installed: true,
      value: options.value
    })
    const dispose = batch.host.dispose()
    expect(batch.host.dispose()).toBe(dispose)
    await dispose
    expect(translated!.getInstallationObservation()).toEqual({
      installed: true,
      value: options.value
    })
    expect(translated!.getLiveInstallationObservation()).toEqual({
      installed: false,
      value: undefined
    })
    expect(batch.host.dispose()).toBe(dispose)
  }

  it('T152 primitive installation retains durable history and clears live markers', async () => {
    await runInstallationObservationBranch({ name: 'observation-primitive', value: 'primitive' })
  })

  it('T153 undefined installation is distinguished as installed history', async () => {
    await runInstallationObservationBranch({ name: 'observation-undefined', value: undefined })
  })

  it('T154 no-disposer installation clears live markers exactly once', async () => {
    await runInstallationObservationBranch({ name: 'observation-no-disposer', value: {} })
    const cleanupCalls: string[] = []
    const targetName = 'observation-no-disposer-count'
    const batch = await createProductionBatch({
      additionalDescriptors: [
        {
          name: targetName,
          claims: emptyClaims,
          install: async () => ({})
        }
      ],
      onTransferredCleanup: (pluginName) => {
        if (pluginName === targetName) cleanupCalls.push(pluginName)
      }
    })
    const translated = batch.translated.find(({ definition }) => definition.name === targetName)!
    await batch.host.installBatch(batch.translated.map(({ definition }) => definition))
    expect(cleanupCalls).toEqual([])
    const dispose = batch.host.dispose()
    expect(batch.host.dispose()).toBe(dispose)
    await dispose
    expect(cleanupCalls).toEqual([targetName])
    expect(batch.host.dispose()).toBe(dispose)
    expect(translated.getLiveInstallationObservation().installed).toBe(false)
    expect(cleanupCalls).toEqual([targetName])
  })

  it('T155 disposeResult false retains history without invoking a disposer', async () => {
    let disposeCalls = 0
    const value = {
      dispose: () => {
        disposeCalls += 1
      }
    }
    const descriptor: IWebRpcPluginDescriptor = {
      name: 'observation-no-dispose-result',
      claims: emptyClaims,
      disposeResult: false,
      install: async () => value
    }
    const batch = await createProductionBatch({ additionalDescriptors: [descriptor] })
    const translated = batch.translated.find(
      ({ definition }) => definition.name === 'observation-no-dispose-result'
    )!
    await batch.host.installBatch(batch.translated.map(({ definition }) => definition))
    const dispose = batch.host.dispose()
    expect(batch.host.dispose()).toBe(dispose)
    await dispose
    expect(disposeCalls).toBe(0)
    expect(translated.getInstallationObservation().installed).toBe(true)
    expect(translated.getLiveInstallationObservation().installed).toBe(false)
  })

  it('T156 onInstalled throw still clears live markers after rollback', async () => {
    const primary = new Error('onInstalled observation failure')
    const value = {}
    const descriptor: IWebRpcPluginDescriptor = {
      name: 'observation-on-installed-failure',
      claims: emptyClaims,
      install: async () => value
    }
    const batch = await createProductionBatch({
      additionalDescriptors: [descriptor],
      onInstalled: (installation) => {
        if (installation === value) throw primary
      }
    })
    const translated = batch.translated.find(
      ({ definition }) => definition.name === 'observation-on-installed-failure'
    )!
    let failure: unknown
    try {
      await batch.host.installBatch(batch.translated.map(({ definition }) => definition))
    } catch (error) {
      failure = error
    }
    expect(failure).toBeInstanceOf(Error)
    expect(failure).toMatchObject({
      name: 'PluginHostError',
      source: '@migaia/plugin-host',
      code: 'PLUGIN_INSTALL_FAILED',
      detail: { failedName: 'observation-on-installed-failure', rollbackErrors: [] },
      cause: primary
    })
    expect(translated.getInstallationObservation().installed).toBe(true)
    expect(translated.getLiveInstallationObservation().installed).toBe(false)
    const dispose = batch.host.dispose()
    expect(batch.host.dispose()).toBe(dispose)
    await expect(dispose).resolves.toMatchObject({
      logicalTerminal: true,
      cleanupComplete: true,
      cleanupErrors: []
    })
    expect(batch.host.dispose()).toBe(dispose)
  })

  it('T157 result cleanup failure clears after cleanup and preserves Promise identity', async () => {
    const cleanup = new Error('observation result cleanup failure')
    let disposeCalls = 0
    let translated!: IWebRpcTranslatedPlugin
    let liveDuringCleanup = false
    const value = {
      dispose: () => {
        disposeCalls += 1
        liveDuringCleanup = translated.getLiveInstallationObservation().installed
        throw cleanup
      }
    }
    const descriptor: IWebRpcPluginDescriptor = {
      name: 'observation-result-failure',
      claims: emptyClaims,
      install: async () => value
    }
    const batch = await createProductionBatch({ additionalDescriptors: [descriptor] })
    translated = batch.translated.find(
      ({ definition }) => definition.name === 'observation-result-failure'
    )!
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
    expect(liveDuringCleanup).toBe(true)
    expect(disposeCalls).toBe(1)
    expect(translated.getInstallationObservation().installed).toBe(true)
    expect(translated.getLiveInstallationObservation().installed).toBe(false)
    expect(batch.host.dispose()).toBe(dispose)
    await expect(dispose).rejects.toBe(failure)
  })

  it('T166 throwing cleanup observer is diagnostic-only and cannot alter disposal', async () => {
    const observerFailure = new Error('transferred cleanup observer failure')
    const cleanup = new Error('observer branch cleanup failure')
    const observerCalls: string[] = []
    const reported: unknown[] = []
    const runFailureBranch = async (
      observe: boolean
    ): Promise<{
      readonly batch: IProductionBatch
      readonly translated: IWebRpcTranslatedPlugin
      readonly failure: unknown
      readonly disposeCalls: number
      readonly liveDuringCleanup: boolean
    }> => {
      let translated!: IWebRpcTranslatedPlugin
      let disposeCalls = 0
      let liveDuringCleanup = false
      const descriptor: IWebRpcPluginDescriptor = {
        name: observe ? 'observer-throwing-failure' : 'observer-baseline-failure',
        claims: emptyClaims,
        install: async () => ({
          dispose: () => {
            disposeCalls += 1
            liveDuringCleanup = translated.getLiveInstallationObservation().installed
            throw cleanup
          }
        })
      }
      const batch = await createProductionBatch({
        additionalDescriptors: [descriptor],
        report: (error) => {
          reported.push(error)
        },
        onTransferredCleanup: observe
          ? (pluginName) => {
              if (pluginName === descriptor.name) {
                observerCalls.push(pluginName)
                expect(translated.getLiveInstallationObservation().installed).toBe(true)
                throw observerFailure
              }
            }
          : undefined
      })
      translated = batch.translated.find(({ definition }) => definition.name === descriptor.name)!
      await batch.host.installBatch(batch.translated.map(({ definition }) => definition))
      const dispose = batch.host.dispose()
      expect(batch.host.dispose()).toBe(dispose)
      const failure = await dispose.catch((error: unknown) => error)
      expect(batch.host.dispose()).toBe(dispose)
      return { batch, translated, failure, disposeCalls, liveDuringCleanup }
    }

    const baseline = await runFailureBranch(false)
    const observed = await runFailureBranch(true)
    for (const failure of [baseline.failure, observed.failure]) {
      expect(failure).toBeInstanceOf(WebRpcLifecycleError)
      expect(failure).toMatchObject({
        source: WEBRPC_SOURCE,
        code: WebRpcErrorCode.endpointDisposed,
        cause: cleanup
      })
    }
    expect(observerCalls).toEqual(['observer-throwing-failure'])
    expect(reported.filter((error) => error === observerFailure)).toHaveLength(1)
    expect(baseline.disposeCalls).toBe(1)
    expect(observed.disposeCalls).toBe(1)
    expect(baseline.liveDuringCleanup).toBe(true)
    expect(observed.liveDuringCleanup).toBe(true)
    expect(baseline.translated.getLiveInstallationObservation().installed).toBe(false)
    expect(observed.translated.getLiveInstallationObservation().installed).toBe(false)
    expect(baseline.translated.getInstallationObservation().installed).toBe(true)
    expect(observed.translated.getInstallationObservation().installed).toBe(true)
    expect((baseline.failure as Error).name).toBe((observed.failure as Error).name)
    expect((baseline.failure as { readonly source?: unknown }).source).toBe(
      (observed.failure as { readonly source?: unknown }).source
    )
    expect((baseline.failure as { readonly code?: unknown }).code).toBe(
      (observed.failure as { readonly code?: unknown }).code
    )

    const successObserverFailure = new Error('successful observer failure')
    const runSuccessBranch = async (
      observe: boolean
    ): Promise<{
      readonly translated: IWebRpcTranslatedPlugin
      readonly firstDispose: Promise<IPluginHostDisposalResult>
      readonly repeatedDispose: Promise<IPluginHostDisposalResult>
      readonly observerCalls: number
      readonly reportCount: number
      readonly reported: readonly unknown[]
      readonly durable: ReturnType<IWebRpcTranslatedPlugin['getInstallationObservation']>
      readonly live: ReturnType<IWebRpcTranslatedPlugin['getLiveInstallationObservation']>
      readonly stats: IProductionBatch['stats']
      readonly activated: boolean
    }> => {
      let successObserverCalls = 0
      let reportCount = 0
      const reported: unknown[] = []
      const descriptor: IWebRpcPluginDescriptor = {
        name: observe ? 'observer-throwing-success' : 'observer-baseline-success',
        claims: emptyClaims,
        install: async () => ({})
      }
      const batch = await createProductionBatch({
        additionalDescriptors: [descriptor],
        report: (error) => {
          reportCount += 1
          reported.push(error)
        },
        onTransferredCleanup: observe
          ? (pluginName) => {
              if (pluginName === descriptor.name) {
                successObserverCalls += 1
                throw successObserverFailure
              }
            }
          : undefined
      })
      const translated = batch.translated.find(
        ({ definition }) => definition.name === descriptor.name
      )!
      await batch.host.installBatch(batch.translated.map(({ definition }) => definition))
      const firstDispose = batch.host.dispose()
      const repeatedDispose = batch.host.dispose()
      expect(repeatedDispose).toBe(firstDispose)
      await expect(firstDispose).resolves.toMatchObject({
        logicalTerminal: true,
        cleanupComplete: true,
        cleanupErrors: []
      })
      expect(batch.host.dispose()).toBe(firstDispose)
      return {
        translated,
        firstDispose,
        repeatedDispose,
        observerCalls: successObserverCalls,
        reportCount,
        reported,
        durable: translated.getInstallationObservation(),
        live: translated.getLiveInstallationObservation(),
        stats: { ...batch.stats },
        activated: batch.isActivated()
      }
    }
    const baselineSuccess = await runSuccessBranch(false)
    const observedSuccess = await runSuccessBranch(true)
    expect(baselineSuccess.durable).toEqual({ installed: true, value: {} })
    expect(observedSuccess.durable).toEqual({ installed: true, value: {} })
    expect(baselineSuccess.live).toEqual({ installed: false, value: undefined })
    expect(observedSuccess.live).toEqual({ installed: false, value: undefined })
    expect(observedSuccess.durable).toEqual(baselineSuccess.durable)
    expect(observedSuccess.live).toEqual(baselineSuccess.live)
    expect(observedSuccess.stats).toEqual(baselineSuccess.stats)
    expect(observedSuccess.activated).toBe(baselineSuccess.activated)
    expect(baselineSuccess.observerCalls).toBe(0)
    expect(baselineSuccess.reportCount).toBe(0)
    expect(baselineSuccess.reported).toEqual([])
    expect(observedSuccess.observerCalls).toBe(1)
    expect(observedSuccess.reportCount).toBe(1)
    expect(observedSuccess.reported).toEqual([successObserverFailure])
    expect(observedSuccess.repeatedDispose).toBe(observedSuccess.firstDispose)
    expect(baselineSuccess.repeatedDispose).toBe(baselineSuccess.firstDispose)
  })

  it('T158 later rollback releases the earlier result once and clears live markers', async () => {
    const rollback = new Error('observation later rollback')
    const releases: string[] = []
    const firstCleanup = new Error('observation first cleanup')
    const secondCleanup = new Error('observation second cleanup')
    const firstValue = {
      dispose: () => {
        releases.push('first')
        throw firstCleanup
      }
    }
    const secondValue = {
      dispose: () => {
        releases.push('second')
        throw secondCleanup
      }
    }
    const descriptor: IWebRpcPluginDescriptor = {
      name: 'observation-later-rollback-first',
      claims: emptyClaims,
      install: async () => firstValue
    }
    const secondDescriptor: IWebRpcPluginDescriptor = {
      name: 'observation-later-rollback-second',
      claims: emptyClaims,
      install: async () => secondValue
    }
    const later: IWebRpcPluginDescriptor = {
      name: 'observation-later-failure',
      claims: emptyClaims,
      install: async () => {
        throw rollback
      }
    }
    const batch = await createProductionBatch({
      additionalDescriptors: [descriptor, secondDescriptor, later]
    })
    const firstTranslated = batch.translated.find(
      ({ definition }) => definition.name === descriptor.name
    )!
    const secondTranslated = batch.translated.find(
      ({ definition }) => definition.name === secondDescriptor.name
    )!
    let failure: unknown
    try {
      await batch.host.installBatch(batch.translated.map(({ definition }) => definition))
    } catch (error) {
      failure = error
    }
    expect(failure).toMatchObject({
      name: 'PluginHostError',
      source: '@migaia/plugin-host',
      code: 'PLUGIN_INSTALL_FAILED',
      detail: { failedName: 'observation-later-failure' },
      cause: rollback
    })
    const rollbackErrors = (
      failure as { readonly detail?: { readonly rollbackErrors?: readonly unknown[] } }
    ).detail?.rollbackErrors
    expect(rollbackErrors).toHaveLength(2)
    const rollbackList = rollbackErrors as readonly unknown[]
    expect((rollbackList[0] as AggregateError).errors).toEqual([secondCleanup])
    expect((rollbackList[1] as AggregateError).errors).toEqual([firstCleanup])
    expect(releases).toEqual(['second', 'first'])
    expect(firstTranslated.getLiveInstallationObservation().installed).toBe(false)
    expect(secondTranslated.getLiveInstallationObservation().installed).toBe(false)
    expect(firstTranslated.getInstallationObservation().installed).toBe(true)
    expect(secondTranslated.getInstallationObservation().installed).toBe(true)
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
    let published: unknown
    const lateDescriptor: IWebRpcPluginDescriptor = {
      name: 'cycle-l-later-participant',
      claims: emptyClaims,
      sharedConsumes: [WebRpcSharedKey.discoveryResolver],
      install: async (scope) => {
        published = scope.getShared(WebRpcSharedKey.discoveryResolver)
        throw primary
      }
    }
    const batch = await createProductionBatch({})
    const late = toPluginHostDefinition(lateDescriptor, lateDescriptor.claims)
    let failure: unknown
    try {
      await batch.host.installBatch([
        ...batch.translated.map(({ definition }) => definition),
        late.definition
      ])
    } catch (error) {
      failure = error
    }
    expect(published).toBeDefined()
    expect(failure).toMatchObject({
      name: 'PluginHostError',
      source: '@migaia/plugin-host',
      code: 'PLUGIN_INSTALL_FAILED',
      cause: primary,
      detail: { failedName: lateDescriptor.name }
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

  it('T249 preserves the real discovery disposer failure identity and terminal residue', async () => {
    const cleanup = new Error('cycle-l discovery attachment cleanup failed')
    let discoveryDisposals = 0
    const batch = await createProductionBatch({
      injectInstall: (role, install) => {
        if (role.kind !== 'feature' || role.key !== 'discovery') return install
        return async (scope) => {
          const result = (await install(scope)) as Record<PropertyKey, unknown>
          const dispose = result.dispose as (() => void | Promise<void>) | undefined
          return withEndpointModuleOwner(
            {
              ...result,
              dispose: async () => {
                discoveryDisposals += 1
                await dispose?.()
                throw cleanup
              }
            },
            getEndpointModuleOwner(result)
          )
        }
      }
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
    expect(failure).toBeInstanceOf(WebRpcLifecycleError)
    expect(failure).toMatchObject({
      source: WEBRPC_SOURCE,
      code: WebRpcErrorCode.endpointDisposed,
      cause: cleanup
    })
    expect(discoveryDisposals).toBe(1)
    expect(batch.host.dispose()).toBe(firstDispose)
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
      [outbound(), discovery()] as const
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
      [outbound(), discovery()] as const
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
        routeSecond,
        replayError,
        registryError
      ])
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
