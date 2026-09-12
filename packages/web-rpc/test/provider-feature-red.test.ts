import { readFile } from 'node:fs/promises'
import { describe, expect, it, vi } from 'vitest'
import { createMemoryTransportPair } from '../src/adapters/memory.js'
import { normalizeRpcEnvelope } from '@migaia/rpc-contract'
import { createStringFramer } from '@migaia/rpc-contract/framing'
import { defineJsonCodec } from '@migaia/serialize/codecs/json'
import { WebRpcErrorCode } from '../src/errors.js'
import { createClientEndpoint } from '../src/client.js'
import { createComposedEndpoint } from '../src/core.js'
import { createFullEndpoint } from '../src/full.js'
import { createProviderEndpoint } from '../src/provider.js'
import { type IWebRpcPluginDescriptor } from '../src/internal/plugin-descriptor.js'
import {
  WebRpcControlRole,
  WebRpcControlRoleSchema,
  WebRpcProviderCancellationPortMetadata,
  WebRpcProviderRole,
  WebRpcProviderRoleSchema
} from '../src/internal/plugin-contract.js'
import {
  WebRpcSharedKey,
  type IWebRpcProviderCancellationPort,
  type IWebRpcOutboundCommand,
  type IWebRpcOutboundOperationsPort
} from '../src/internal/plugin-shared-keys.js'
import { type IOutboundAttachmentHost } from '../src/internal/outbound-attachment.js'
import {
  readEndpointDebugSnapshot,
  registerEndpointTimePortObserver,
  readInboundIdentityReleaseObservation,
  readProviderRegistrationObservation,
  registerInboundIdentityReleaseObservation,
  registerProviderRegistrationObservation,
  type IWebRpcTimePortEvent
} from '../src/internal/test-observer.js'
import { readComposedDisposalPromises } from '../src/internal/composed-disposal-observer.js'
import { createConstructionControl } from '../src/internal/construction-install.js'
import { createEndpointCapabilitiesBatchFeature } from '../src/internal/endpoint-capabilities-plugin.js'
import {
  createFirstPartyRoots,
  type IWebRpcFirstPartyRootName
} from '../src/internal/first-party-roots.js'
import {
  assertFeatureClaimParity,
  preflightFeatureClaims,
  readFeaturePolicy
} from '../src/internal/feature-policy.js'
import { WebRpcPluginHost } from '../src/internal/web-rpc-plugin-host.js'
import { createEndpointKernel } from '../src/endpoint-kernel.js'
import { prepareEndpoint, type IPreparedEndpoint } from '../src/internal/endpoint-bootstrap.js'
import { buildNativePluginBatch } from '../src/internal/plugin-inventory.js'
import type { IWebRpcOutboundCommandObservation } from '../src/internal/feature-contract.js'
import { WebRpcError, WebRpcLifecycleError, WebRpcSchemaValidationError } from '../src/errors.js'
import { authentication } from '../src/middleware/authentication.js'
import { abort } from '../src/middleware/abort.js'
import { connect } from '../src/middleware/connect.js'
import { contract } from '../src/middleware/contract.js'
import { hooks } from '../src/middleware/hooks.js'
import { ping } from '../src/middleware/ping.js'
import { canonicalProtocol as protocol } from '../src/middleware/canonical-protocol.js'
import { timeout } from '../src/middleware/timeout.js'

import { uuid } from '../src/middleware/uuid.js'
import type { IWebRpcCoreConfig } from '../src/core.js'
import type { IWebRpcPlugin, IWebRpcProvider } from '../src/typing.js'
import type { IWebRpcTransport } from '../src/transport.js'

/** Builds one raw provider request for the real Host-installed transport seam. */
function createProviderRequest(
  taskId: string,
  overrides: Readonly<Record<string, unknown>> = {}
): Readonly<Record<string, unknown>> {
  /** Retains every legacy override as raw fixture input before canonical projection. */
  const raw: Readonly<Record<string, unknown>> = {
    kind: 'request',
    version: '1.0',
    taskId,
    senderId: 'r70-client',
    receiverId: 'provider-admission-fixture',
    targetId: 'provider-admission-fixture',
    method: 'echo',
    data: 'r70-data',
    sentAt: Date.now(),
    ...overrides
  }
  /** Projects raw values without filtering hostile route or payload overrides. */
  const routing: Readonly<Record<string, unknown>> = {
    profile: 'web-rpc.route.v1',
    type: 'request',
    applicationVersion: raw.version,
    senderId: raw.senderId,
    targetId: raw.targetId,
    receiverId: raw.receiverId,
    sentAt: raw.sentAt,
    ...(raw.dispatchOnly === undefined ? {} : { dispatchOnly: raw.dispatchOnly })
  }
  return {
    kind: raw.kind,
    id: raw.taskId,
    method: raw.method,
    data: { webRpc: routing, ...(raw.data === undefined ? {} : { payload: raw.data }) }
  }
}

/** Lets one real memory transport delivery and its provider cleanup settle. */
async function settleProviderDelivery(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
}

/** Builds a native root record for direct composition readers without reviving module arrays. */
function createNativeRoots<const TName extends IWebRpcFirstPartyRootName>(
  ...names: readonly TName[]
) {
  return createFirstPartyRoots(new Set(names))
}

/** Narrows only the attachment shape registered by native outbound preparation. */
function isOutboundAttachmentHost(value: unknown): value is IOutboundAttachmentHost {
  return (
    typeof value === 'object' &&
    value !== null &&
    'inboundIdentity' in value &&
    'sendFrame' in value &&
    typeof value.sendFrame === 'function'
  )
}

/** Wraps a provider envelope with the source metadata consumed by real identity admission. */
function createInboundProviderFrame(
  request: Readonly<Record<string, unknown>>,
  source: unknown,
  peerId?: string
): Readonly<Record<string, unknown>> {
  return {
    data: request,
    source,
    ...(peerId === undefined ? {} : { peerId })
  }
}

/** Creates the unchanged production provider endpoint used by every matrix row. */
function createRealProvider(
  id: string,
  transport: IWebRpcTransport,
  providerMap: Readonly<Record<string, IWebRpcProvider>>,
  withAbort = false
) {
  return createProviderEndpoint({
    id,
    transport,
    middlewares: [connect({ transport }), ...(withAbort ? [abort()] : [])],
    provider: providerMap
  })
}

/** Builds a throwing transport configuration to prove pre-install config cutoff. */
function createThrowingProviderConfig(
  transport: IWebRpcTransport,
  cause: Error
): IWebRpcCoreConfig {
  const config = {
    id: 'provider-config-host',
    transport,
    middlewares: [connect({ transport })],
    get provider(): Readonly<Record<string, IWebRpcProvider>> {
      throw cause
    }
  }
  return config as IWebRpcCoreConfig
}

type IActualAdmissionFixture = {
  readonly id: string
  readonly descriptors: readonly IWebRpcPluginDescriptor[]
  readonly claims: readonly IWebRpcPluginDescriptor['claims'][]
  readonly providerIndex: number
  readonly clientTransport: IWebRpcTransport
  readonly host: WebRpcPluginHost
  readonly kernel: ReturnType<typeof createEndpointKernel>
  /** Reads immutable native root policy; it never creates a legacy descriptor or lifecycle owner. */
  readonly getNativeRootSharedConsumes: (
    name: IWebRpcFirstPartyRootName
  ) => readonly PropertyKey[] | undefined
  readonly stats: {
    activeSubscriptions: number
    subscribeCalls: number
    dispatches: number
  }
  readonly install: () => Promise<void>
  readonly installDescriptors: (
    descriptors: readonly IWebRpcPluginDescriptor[],
    options?: { readonly parity?: boolean }
  ) => Promise<void>
  readonly getTranslatedInstallation: (name: string) => unknown
  readonly getProviderInstallation: () => unknown
  readonly getIdentityOwner: () => object | undefined
  readonly getOutboundOwner: () => IOutboundAttachmentHost | undefined
  readonly unregisterProviderRegistrationObservation: () => void
  readonly snapshot: () => Readonly<{
    readonly hostKeys: readonly PropertyKey[]
    readonly shared: readonly unknown[]
    readonly extensions: readonly (PropertyDescriptor | undefined)[]
    readonly installations: readonly {
      readonly installed: boolean
      readonly extensionKeys: readonly PropertyKey[]
      readonly sharedKeys: readonly PropertyKey[]
    }[]
    readonly activeSubscriptions: number
    readonly providerState: {
      readonly admission: number
      readonly replay: number
      readonly activeControllers: number
    }
    readonly subscribeCalls: number
    readonly dispatches: number
    readonly activated: boolean
    readonly kernelState: string
    readonly kernelOwners: readonly string[]
    readonly kernelRoutes: readonly string[]
    readonly resources: number
  }>
  readonly dispose: () => Promise<void>
}

type IAdmissionFixtureOptions = {
  /** Selects package-owned native roots without evaluating retired module factories. */
  readonly rootNames?: readonly IWebRpcFirstPartyRootName[]
  readonly endpointId?: string
  readonly transportPeerId?: string
  readonly sourceProof?: IWebRpcTransport['sourceProof']
  readonly connectConfig?: import('../src/typing.js').IWebRpcConnectConfig
  readonly transportSend?: (message: unknown) => void | Promise<void>
  readonly hookErrorReporter?: (error: unknown, event: unknown) => void
  readonly contractConfig?: import('../src/typing.js').IWebRpcContractConfig
  readonly observeOutboundCommand?: (observation: IWebRpcOutboundCommandObservation) => void
  readonly observeTransferredCleanup?: (pluginName: string) => void
  readonly providerMap?: Readonly<Record<string, IWebRpcProvider>>
  readonly observeProviderRegistration?: boolean
  /** Alters only the capability Feature shared output before the production parity gate. */
  readonly transformShared?: (
    output: Readonly<Record<PropertyKey, unknown>>
  ) => Readonly<Record<PropertyKey, unknown>>
}

/** Builds one real composed Host transaction through the canonical production inventory seam. */
async function createActualAdmissionFixture(
  options: IAdmissionFixtureOptions = {}
): Promise<IActualAdmissionFixture> {
  const endpointId = options.endpointId ?? 'provider-admission-fixture'
  const [clientTransport, transport] = createMemoryTransportPair()
  const stats = { activeSubscriptions: 0, subscribeCalls: 0, dispatches: 0 }
  const baseTransport = transport
  const composedTransport = {
    ...baseTransport,
    ...(options.transportPeerId ? { peerId: options.transportPeerId } : {}),
    ...(options.sourceProof ? { sourceProof: options.sourceProof } : {}),
    send(message: unknown): void | Promise<void> {
      stats.dispatches += 1
      const result = options.transportSend?.(message)
      if (result !== undefined) return result
      return baseTransport.send(message)
    },
    subscribe(listener: Parameters<IWebRpcTransport['subscribe']>[0]): () => void {
      stats.subscribeCalls += 1
      stats.activeSubscriptions += 1
      const unsubscribe = baseTransport.subscribe(listener)
      return () => {
        stats.activeSubscriptions -= 1
        unsubscribe()
      }
    }
  }
  const providerMap =
    options.providerMap ??
    ({
      echo: (context: Parameters<IWebRpcProvider>[0]) => context.success('fixture')
    } as Readonly<Record<string, IWebRpcProvider>>)
  const config: IWebRpcCoreConfig = {
    id: endpointId,
    transport: composedTransport,
    middlewares: [
      protocol(),
      authentication({
        encrypt: (value) => value,
        decrypt: (value) => value
      }),
      contract(options.contractConfig),
      connect({ ...options.connectConfig, transport: composedTransport }),
      uuid(),
      ping(),
      abort(),
      timeout(),
      hooks({ onHookError: options.hookErrorReporter })
    ],
    provider: providerMap
  }
  const deferred = await prepareEndpoint(config, { deferMiddlewareInstall: true })
  const kernel = createEndpointKernel(deferred.transport, deferred.transportSnapshot)
  const unregisterProviderRegistrationObservation = options.observeProviderRegistration
    ? registerProviderRegistrationObservation(kernel)
    : () => undefined
  const construction = createConstructionControl({
    signal: new AbortController().signal
  })
  const host = new WebRpcPluginHost(
    deferred.id,
    deferred.transport,
    construction,
    () => undefined,
    { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
  )
  let prepared: IPreparedEndpoint<string> | undefined
  let activated = false
  /** Observes the actual attachment registered by native outbound preparation; it owns cleanup. */
  let outboundOwner: IOutboundAttachmentHost | undefined
  /** Retains the identity coordinator reached through that actual outbound attachment only. */
  let identityOwner: object | undefined
  const rootNames = options.rootNames ?? (['first-party-provider'] as const)
  const roots = createNativeRoots(...rootNames)
  const capabilityBatch = createEndpointCapabilitiesBatchFeature(
    roots,
    Object.freeze({
      getKernel: () => kernel,
      getPrepared: () => {
        if (!prepared) throw new Error('native provider fixture prepared endpoint missing')
        return prepared
      },
      observeOutboundCommand: options.observeOutboundCommand,
      transformOutput: (phase, output) =>
        phase === 'shared' && options.transformShared ? options.transformShared(output) : output,
      transformFeaturePrepare: (name, prepare) =>
        name === 'first-party-outbound'
          ? (scope) =>
              prepare({
                ...scope,
                own<T>(resource: T, release: () => void | Promise<void>): T {
                  if (isOutboundAttachmentHost(resource)) {
                    outboundOwner = resource
                    identityOwner = outboundOwner.inboundIdentity
                  }
                  return scope.own(resource, release)
                }
              })
          : prepare
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
    new Set([
      ...rootNames,
      ...(rootNames.includes('first-party-provider') ? ['first-party-outbound'] : [])
    ])
  )
  const capabilityAdmission = capabilityBatch.admission
  if (capabilityAdmission === undefined)
    throw new Error('native provider fixture requires a capability admission')
  const batch = buildNativePluginBatch({
    kernel,
    deferred: deferred as never,
    middlewareSnapshots: deferred.middlewareSnapshots,
    hookEvents: [],
    featureDefinitions: [
      {
        key: capabilityBatch.plugin.definition.name,
        definition: capabilityBatch.plugin.definition as never,
        admission: capabilityAdmission
      }
    ],
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
    onActivationPreflight: (state, getShared) =>
      assertFeatureClaimParity(admissions, { getShared }, kernel, {
        activated: state.activated,
        activationPhase: 'pre-activation',
        routeKeys: state.routeKeys
      })
  })
  const admissions = batch.map(({ admission }) => admission)
  preflightFeatureClaims(admissions)
  /** Metadata-only compatibility observation for legacy assertions during reader migration. */
  const finalDescriptors = batch.map(
    ({ admission }) =>
      Object.freeze({
        name: admission.name,
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
      }) as IWebRpcPluginDescriptor
  )
  const providerIndex = finalDescriptors.findIndex(
    (descriptor) => descriptor.name === 'endpoint-capabilities'
  )
  const claims = finalDescriptors.map((descriptor) => descriptor.claims)
  let activeDescriptors: readonly IWebRpcPluginDescriptor[] = finalDescriptors
  const snapshot = () => ({
    providerState: (() => {
      const debug = capabilityBatch.plugin.getSnapshotReader()?.()
      return {
        admission: debug?.providerState?.admission ?? 0,
        replay: debug?.providerState?.replay ?? 0,
        activeControllers: debug?.activeControllers ?? 0
      }
    })(),
    hostKeys: Reflect.ownKeys(host),
    shared: Object.values(WebRpcSharedKey).map((key) => {
      try {
        return host.getShared(key)
      } catch {
        return undefined
      }
    }),
    extensions: [...new Set(activeDescriptors.flatMap(({ claims: item }) => item.publicKeys))].map(
      (key) => Object.getOwnPropertyDescriptor(host, key)
    ),
    installations: [],
    activeSubscriptions: stats.activeSubscriptions,
    subscribeCalls: stats.subscribeCalls,
    dispatches: stats.dispatches,
    activated,
    kernelState: kernel.state,
    kernelOwners: kernel.ownerKeys,
    kernelRoutes: kernel.routeKeys,
    resources: capabilityBatch.plugin.getSnapshotReader()?.().resources ?? kernel.resources.size
  })
  const installDescriptors = async (
    nextDescriptors: readonly IWebRpcPluginDescriptor[],
    installOptions: { readonly parity?: boolean } = {}
  ): Promise<void> => {
    activeDescriptors = nextDescriptors
    if (installOptions.parity === false) return
    const hostView = await host.installBatch(batch.map(({ definition }) => definition))
    assertFeatureClaimParity(admissions, hostView, kernel, { activated })
  }
  return {
    id: endpointId,
    descriptors: finalDescriptors,
    claims,
    providerIndex,
    clientTransport,
    host,
    kernel,
    getNativeRootSharedConsumes: (name) =>
      name in roots ? readFeaturePolicy(roots[name]!).sharedConsumes : undefined,
    stats,
    install: async () => {
      await installDescriptors(finalDescriptors, { parity: true })
    },
    installDescriptors,
    getTranslatedInstallation: () => undefined,
    getProviderInstallation: () => undefined,
    getIdentityOwner: () => identityOwner,
    getOutboundOwner: () => outboundOwner,
    unregisterProviderRegistrationObservation,
    snapshot,
    dispose: async () => {
      unregisterProviderRegistrationObservation()
      construction.close()
      const hostDispose = host.dispose()
      expect(host.dispose()).toBe(hostDispose)
      await hostDispose
      if (kernel.state !== 'disposed') kernel.completeDispose()
    }
  }
}

/** Rejects the removed D95 key in every surviving package-owned key collection. */
function assertNoRemovedD95Key(keys: readonly PropertyKey[]): void {
  expect(keys).not.toContain('outboundCompatibility')
  expect(
    keys.some(
      (key) => typeof key === 'symbol' && key.description?.includes('outbound-compatibility')
    )
  ).toBe(false)
}

/** Reads the source and built artifacts that formerly implemented D95 normalization. */
async function readFinalD95BoundaryTexts(): Promise<readonly string[]> {
  const paths = [
    '../src/internal/plugin-descriptor.ts',
    '../src/internal/plugin-shared-keys.ts',
    '../src/internal/outbound-attachment.ts',
    '../dist/internal/plugin-descriptor.js',
    '../dist/internal/plugin-shared-keys.js',
    '../dist/internal/outbound-attachment.js',
    '../dist/internal/plugin-shared-keys.d.ts'
  ] as const
  return Promise.all(paths.map((path) => readFile(new URL(path, import.meta.url), 'utf8')))
}

/** Projects the observable terminal state required by the D95 disposal contract. */
function projectD95TerminalSnapshot(snapshot: ReturnType<IActualAdmissionFixture['snapshot']>) {
  return {
    hostKeys: snapshot.hostKeys,
    sharedEmpty: snapshot.shared.every((value) => value === undefined),
    extensionsEmpty: snapshot.extensions.every((value) => value === undefined),
    installationsClear: snapshot.installations.every(({ installed }) => !installed),
    activated: snapshot.activated,
    activeSubscriptions: snapshot.activeSubscriptions,
    providerState: snapshot.providerState,
    kernelState: snapshot.kernelState,
    kernelOwners: snapshot.kernelOwners,
    kernelRoutes: snapshot.kernelRoutes,
    resources: snapshot.resources
  }
}

/** Proves migrated control behavior is independent of a hostile legacy D95 publication. */
async function assertMigratedControlIgnoresD95(fixture: IActualAdmissionFixture): Promise<void> {
  expect(fixture.getTranslatedInstallation('outbound-compatibility')).toBeUndefined()
  await fixture.install()
  expect(fixture.getTranslatedInstallation('outbound-compatibility')).toBeUndefined()
  expect((fixture.host as unknown as { readonly ping?: unknown }).ping).toBeUndefined()
  const hostDispose = fixture.host.dispose()
  expect(fixture.host.dispose()).toBe(hostDispose)
  await hostDispose
  expect(fixture.getTranslatedInstallation('outbound-compatibility')).toBeUndefined()
  expect(projectD95TerminalSnapshot(fixture.snapshot())).toMatchObject({
    hostKeys: [],
    sharedEmpty: true,
    extensionsEmpty: true,
    installationsClear: true,
    activated: false,
    activeSubscriptions: 0,
    kernelState: 'disposed',
    kernelOwners: [],
    kernelRoutes: [],
    resources: 0
  })
}

/** Registers a read-only identity-release counter against the fixture's real outbound owner. */
function registerFixtureIdentityReleaseObservation(fixture: IActualAdmissionFixture): {
  readonly read: () => number | undefined
  readonly unregister: () => void
} {
  const identity = fixture.getIdentityOwner()
  if (!identity) throw new Error('outbound identity owner missing from installed fixture')
  const unregister = registerInboundIdentityReleaseObservation(identity)
  return {
    read: () => readInboundIdentityReleaseObservation(identity),
    unregister
  }
}

describe('Cycle H B12c02 provider production-seam RED matrix', () => {
  it('T110 real transaction baseline: provider RPC and public boundary execute before projection RED', async () => {
    const [clientTransport, serverTransport] = createMemoryTransportPair()
    const server = await createRealProvider('provider-exposure-host', serverTransport, {
      echo: (context) => context.success(context.data)
    })
    const client = await createClientEndpoint({
      id: 'provider-exposure-client',
      transport: clientTransport,
      targetIds: ['provider-exposure-host'],
      middlewares: [connect({ transport: clientTransport })]
    })
    try {
      expect(Object.keys(server)).toEqual([
        'on',
        'hooks',
        'dispose',
        'send',
        'sendAll',
        'dispatch',
        'dispatchAll',
        'provide'
      ])
      expect(server).not.toHaveProperty('getShared')
      expect(server).not.toHaveProperty('use')
      await expect(client.send('provider-exposure-host', 'echo', 'ok')).resolves.toBe('ok')
    } finally {
      await client.dispose()
      await server.dispose()
    }
  })

  it('T111 real transaction: provider success and endpoint-local disposal remain stable', async () => {
    const [firstClientTransport, firstServerTransport] = createMemoryTransportPair()
    const [secondClientTransport, secondServerTransport] = createMemoryTransportPair()
    const first = await createRealProvider('provider-first', firstServerTransport, {
      echo: (context) => context.success('first')
    })
    const second = await createRealProvider('provider-second', secondServerTransport, {
      echo: (context) => context.success('second')
    })
    const firstClient = await createClientEndpoint({
      id: 'provider-first-client',
      transport: firstClientTransport,
      targetIds: ['provider-first'],
      middlewares: [connect({ transport: firstClientTransport })]
    })
    const secondClient = await createClientEndpoint({
      id: 'provider-second-client',
      transport: secondClientTransport,
      targetIds: ['provider-second'],
      middlewares: [connect({ transport: secondClientTransport })]
    })
    try {
      await expect(firstClient.send('provider-first', 'echo', null)).resolves.toBe('first')
      await expect(secondClient.send('provider-second', 'echo', null)).resolves.toBe('second')
      const firstDispose = first.dispose()
      expect(first.dispose()).toBe(firstDispose)
      await firstDispose
      await expect(secondClient.send('provider-second', 'echo', null)).resolves.toBe('second')
      expect(readEndpointDebugSnapshot(second)?.providers).toBe(1)
    } finally {
      await firstClient.dispose()
      await secondClient.dispose()
      await second.dispose()
    }
  })

  it('T112 real provider security baseline rejects a forged receiver without execution', async () => {
    const [clientTransport, serverTransport] = createMemoryTransportPair()
    let executions = 0
    const server = await createRealProvider('provider-security-host', serverTransport, {
      echo: (context) => {
        executions += 1
        return context.success(context.data)
      }
    })
    try {
      clientTransport.send({
        kind: 'request',
        version: '1.0',
        taskId: 'forged-task',
        senderId: 'forged-sender',
        receiverId: 'wrong-receiver',
        targetId: 'provider-security-host',
        method: 'echo',
        data: 'forged',
        sentAt: Date.now()
      })
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(executions).toBe(0)
    } finally {
      await server.dispose()
    }
  })

  it('T113 real provider response baseline preserves native provider error code and residue', async () => {
    const [clientTransport, serverTransport] = createMemoryTransportPair()
    const cause = new TypeError('provider failure cause')
    const primary = new Error('provider failure', { cause })
    const server = await createRealProvider('provider-error-host', serverTransport, {
      fail: () => {
        throw primary
      }
    })
    const client = await createClientEndpoint({
      id: 'provider-error-client',
      transport: clientTransport,
      targetIds: ['provider-error-host'],
      middlewares: [connect({ transport: clientTransport })]
    })
    try {
      await expect(client.send('provider-error-host', 'fail', null)).rejects.toMatchObject({
        code: WebRpcErrorCode.internal,
        cause: expect.objectContaining({
          message: primary.message,
          stack: primary.stack,
          cause: expect.objectContaining({
            name: 'TypeError',
            message: cause.message,
            stack: cause.stack
          })
        })
      })
      expect(readEndpointDebugSnapshot(server)?.activeControllers).toBe(0)
      expect(readEndpointDebugSnapshot(server)?.providers).toBe(1)
    } finally {
      await client.dispose()
      await server.dispose()
    }
  })

  it('T114 real provider abort baseline preserves caller terminal reason and releases controller', async () => {
    const [clientTransport, serverTransport] = createMemoryTransportPair()
    let started!: () => void
    let release!: () => void
    const startedPromise = new Promise<void>((resolve) => {
      started = resolve
    })
    const server = await createRealProvider(
      'provider-abort-host',
      serverTransport,
      {
        wait: async (context) => {
          started()
          await new Promise<void>((resolve) => {
            release = resolve
            context.signal.addEventListener('abort', resolve, { once: true })
          })
          return context.success('late')
        }
      },
      true
    )
    const client = await createClientEndpoint({
      id: 'provider-abort-client',
      transport: clientTransport,
      targetIds: ['provider-abort-host'],
      middlewares: [connect({ transport: clientTransport }), abort()]
    })
    try {
      const reason = new DOMException('provider caller abort', 'AbortError')
      const controller = new AbortController()
      const pending = client.send('provider-abort-host', 'wait', null, {
        signal: controller.signal,
        timeoutMs: false
      })
      await startedPromise
      controller.abort(reason)
      await expect(pending).rejects.toMatchObject({ cause: reason })
      release()
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(readEndpointDebugSnapshot(server)?.activeControllers).toBe(0)
    } finally {
      await client.dispose()
      await server.dispose()
    }
  })

  it('T115 config snapshot baseline reads the provider object once before installation', async () => {
    const [, serverTransport] = createMemoryTransportPair()
    let reads = 0
    const providerMap = {
      echo: (context: Parameters<IWebRpcProvider>[0]) => context.success('snapshot')
    }
    const config = {
      id: 'provider-snapshot-host',
      transport: serverTransport,
      middlewares: [connect({ transport: serverTransport })],
      get provider(): Readonly<Record<string, IWebRpcProvider>> {
        reads += 1
        return providerMap
      }
    } as IWebRpcCoreConfig
    const server = await createProviderEndpoint(config)
    try {
      expect(reads).toBe(1)
      providerMap.echo = () => ({ ok: false, message: 'mutated', code: 'MUTATED' })
      expect(readEndpointDebugSnapshot(server)?.providers).toBe(1)
    } finally {
      await server.dispose()
    }
  })

  it('T116 hostile provider getter fails before transport subscription with original cause', async () => {
    const [, serverTransport] = createMemoryTransportPair()
    const cause = new Error('provider getter hostile')
    await expect(
      createProviderEndpoint(createThrowingProviderConfig(serverTransport, cause))
    ).rejects.toMatchObject({
      code: WebRpcErrorCode.invalidConfig,
      cause
    })
  })

  it('T117 later invalid provider entry preserves primary failure and terminal residue', async () => {
    const [, serverTransport] = createMemoryTransportPair()
    const invalidProvider = {
      valid: (context: Parameters<IWebRpcProvider>[0]) => context.success('valid'),
      invalid: undefined
    } as unknown as Record<string, IWebRpcProvider>
    let failure: unknown
    try {
      await createProviderEndpoint({
        id: 'provider-partial-host',
        transport: serverTransport,
        middlewares: [connect({ transport: serverTransport })],
        provider: invalidProvider
      })
    } catch (error) {
      failure = error
    }
    expect(failure).toMatchObject({
      name: 'WebRpcError',
      source: '@migaia/web-rpc',
      code: WebRpcErrorCode.invalidConfig
    })

    const fixture = await createActualAdmissionFixture({
      providerMap: invalidProvider,
      observeProviderRegistration: true
    })
    try {
      expect(readProviderRegistrationObservation(fixture.kernel)).toEqual([])
      expect(readProviderRegistrationObservation({ ...fixture.kernel })).toBeUndefined()
      expect(readProviderRegistrationObservation(new Proxy(fixture.kernel, {}))).toBeUndefined()
      let hostFailure: unknown
      try {
        await fixture.install()
      } catch (error) {
        hostFailure = error
      }
      expect(hostFailure).toMatchObject({
        source: '@migaia/plugin-host',
        code: 'PLUGIN_INSTALL_FAILED',
        detail: { failedName: 'endpoint-capabilities' },
        cause: expect.objectContaining({
          name: 'WebRpcError',
          source: '@migaia/web-rpc',
          code: WebRpcErrorCode.invalidConfig
        })
      })
      const observations = readProviderRegistrationObservation(fixture.kernel)
      expect(observations?.map(({ method }) => method)).toEqual(['valid'])
      expect(observations?.[0]?.provider).toBe(invalidProvider.valid)
      expect(Object.isFrozen(observations)).toBe(true)
      expect(Object.isFrozen(observations?.[0])).toBe(true)
      const after = fixture.snapshot()
      expect({
        shared: after.shared.every((value) => value === undefined),
        extensions: after.extensions.every((descriptor) => descriptor === undefined),
        installations: after.installations.every(
          ({ installed, extensionKeys, sharedKeys }) =>
            !installed && extensionKeys.length === 0 && sharedKeys.length === 0
        ),
        activeSubscriptions: after.activeSubscriptions,
        subscribeCalls: after.subscribeCalls,
        dispatches: after.dispatches,
        activated: after.activated,
        kernelState: after.kernelState,
        kernelOwners: after.kernelOwners,
        kernelRoutes: after.kernelRoutes,
        resources: after.resources
      }).toEqual({
        shared: true,
        extensions: true,
        installations: true,
        activeSubscriptions: 0,
        subscribeCalls: 0,
        dispatches: 0,
        activated: false,
        kernelState: 'disposed',
        kernelOwners: [],
        kernelRoutes: [],
        resources: 0
      })
      const hostDispose = fixture.host.dispose()
      expect(fixture.host.dispose()).toBe(hostDispose)
      await expect(hostDispose).resolves.toMatchObject({
        logicalTerminal: true,
        cleanupComplete: true,
        cleanupErrors: []
      })
      const terminal = fixture.snapshot()
      expect({
        shared: terminal.shared.every((value) => value === undefined),
        extensions: terminal.extensions.every((descriptor) => descriptor === undefined),
        installations: terminal.installations.every(
          ({ installed, extensionKeys, sharedKeys }) =>
            !installed && extensionKeys.length === 0 && sharedKeys.length === 0
        ),
        activeSubscriptions: terminal.activeSubscriptions,
        subscribeCalls: terminal.subscribeCalls,
        dispatches: terminal.dispatches,
        activated: terminal.activated,
        kernelState: terminal.kernelState,
        kernelOwners: terminal.kernelOwners,
        kernelRoutes: terminal.kernelRoutes,
        resources: terminal.resources
      }).toEqual({
        shared: true,
        extensions: true,
        installations: true,
        activeSubscriptions: 0,
        subscribeCalls: 0,
        dispatches: 0,
        activated: false,
        kernelState: 'disposed',
        kernelOwners: [],
        kernelRoutes: [],
        resources: 0
      })
      expect(terminal).toEqual(after)
    } finally {
      await fixture.dispose()
    }
    expect(readProviderRegistrationObservation(fixture.kernel)).toBeUndefined()
  })

  it('T121 source ownership scan rejects provider attachment broad-bridge imports', async () => {
    const providerSource = await readFile(
      new URL('../src/features/provider.ts', import.meta.url),
      'utf8'
    )
    const attachmentSource = await readFile(
      new URL('../src/internal/provider-attachment.ts', import.meta.url),
      'utf8'
    )
    expect(providerSource).not.toContain('outboundCompatibility')
    expect(attachmentSource).not.toContain('IOutboundAttachmentHost')
  })

  it('T122 contract: provider schema and cancellation metadata are frozen and candidate-independent', () => {
    const schema = WebRpcProviderRoleSchema.provider
    expect(schema).toEqual({
      sharedProvides: [WebRpcSharedKey.providerCancellation],
      sharedConsumes: [
        WebRpcSharedKey.outboundOperations,
        WebRpcSharedKey.inboundIdentity,
        WebRpcSharedKey.variationCoordinator
      ],
      publicKeys: ['provide'],
      exposedKeys: ['provide'],
      installOrder: ['outbound', 'provider']
    })
    expect(Object.isFrozen(WebRpcProviderRole)).toBe(true)
    expect(Reflect.ownKeys(WebRpcProviderRole)).toEqual(['provider'])
    expect(Object.getOwnPropertyDescriptor(WebRpcProviderRole, 'provider')).toEqual({
      value: 'provider',
      enumerable: true,
      configurable: false,
      writable: false
    })
    expect(Object.isFrozen(WebRpcProviderRoleSchema)).toBe(true)
    expect(Object.isFrozen(schema)).toBe(true)
    expect(Object.isFrozen(schema.sharedProvides)).toBe(true)
    expect(Object.isFrozen(schema.sharedConsumes)).toBe(true)
    expect(Object.isFrozen(schema.publicKeys)).toBe(true)
    expect(Object.isFrozen(schema.exposedKeys)).toBe(true)
    expect(Object.isFrozen(schema.installOrder)).toBe(true)
    expect(Object.isFrozen(WebRpcProviderCancellationPortMetadata)).toBe(true)
    expect(Reflect.ownKeys(WebRpcProviderRoleSchema)).toEqual(['provider'])
    expect(Reflect.ownKeys(schema)).toEqual([
      'sharedProvides',
      'sharedConsumes',
      'publicKeys',
      'exposedKeys',
      'installOrder'
    ])
    const assertFrozenArray = (value: readonly unknown[], expected: readonly unknown[]): void => {
      expect(Reflect.ownKeys(value)).toEqual([
        ...expected.map((_item, index) => String(index)),
        'length'
      ])
      expected.forEach((item, index) => {
        expect(Object.getOwnPropertyDescriptor(value, String(index))).toEqual({
          value: item,
          enumerable: true,
          configurable: false,
          writable: false
        })
      })
      expect(Object.getOwnPropertyDescriptor(value, 'length')).toEqual({
        value: expected.length,
        enumerable: false,
        configurable: false,
        writable: false
      })
    }
    assertFrozenArray(schema.sharedProvides, [WebRpcSharedKey.providerCancellation])
    assertFrozenArray(schema.sharedConsumes, [
      WebRpcSharedKey.outboundOperations,
      WebRpcSharedKey.inboundIdentity,
      WebRpcSharedKey.variationCoordinator
    ])
    assertFrozenArray(schema.publicKeys, ['provide'])
    assertFrozenArray(schema.exposedKeys, ['provide'])
    assertFrozenArray(schema.installOrder, ['outbound', 'provider'])
    expect(Reflect.ownKeys(WebRpcProviderCancellationPortMetadata)).toEqual([
      'ownKeys',
      'propertyDescriptor',
      'signature'
    ])
    expect(WebRpcProviderCancellationPortMetadata).not.toHaveProperty('abort')
    expect(WebRpcProviderCancellationPortMetadata.ownKeys).toEqual(['abort'])
    expect(WebRpcProviderCancellationPortMetadata.signature).toEqual({
      kind: 'function',
      parameters: ['id'],
      returns: 'void'
    })
    expect(WebRpcProviderCancellationPortMetadata.propertyDescriptor).toEqual({
      enumerable: true,
      configurable: false,
      writable: false
    })
    expect(Object.isFrozen(WebRpcProviderCancellationPortMetadata.ownKeys)).toBe(true)
    expect(Object.isFrozen(WebRpcProviderCancellationPortMetadata.propertyDescriptor)).toBe(true)
    expect(Object.isFrozen(WebRpcProviderCancellationPortMetadata.signature)).toBe(true)
    expect(Object.isFrozen(WebRpcProviderCancellationPortMetadata.signature.parameters)).toBe(true)

    const attack = (target: object, key: PropertyKey): void => {
      expect(() => {
        ;(target as Record<PropertyKey, unknown>)[key] = 'forged'
      }).toThrow()
      expect(Reflect.defineProperty(target, key, { value: 'forged' })).toBe(false)
      expect(() => {
        delete (target as Record<PropertyKey, unknown>)[key]
      }).toThrow()
      expect(() => Object.setPrototypeOf(target, null)).toThrow()
    }
    attack(WebRpcProviderRole, 'provider')
    attack(WebRpcProviderRoleSchema, 'provider')
    attack(schema, 'sharedProvides')
    attack(WebRpcProviderCancellationPortMetadata, 'ownKeys')
    attack(WebRpcProviderCancellationPortMetadata.ownKeys, 0)
    attack(WebRpcProviderCancellationPortMetadata.propertyDescriptor, 'enumerable')
    attack(WebRpcProviderCancellationPortMetadata.signature, 'kind')
    attack(WebRpcProviderCancellationPortMetadata.signature.parameters, 0)
    attack(schema.sharedProvides, 0)
    attack(schema.sharedConsumes, 0)
    attack(schema.publicKeys, 0)
    attack(schema.exposedKeys, 0)
    attack(schema.installOrder, 0)
    expect(WebRpcProviderRole.provider).toBe('provider')
    expect(WebRpcProviderCancellationPortMetadata).not.toHaveProperty('abort')
  })

  it('T124 real provider snapshot reads outer config and every provider entry once', async () => {
    const [, serverTransport] = createMemoryTransportPair()
    const reads: string[] = []
    const providerMap = {} as Record<string, IWebRpcProvider>
    for (const method of ['alpha', 'beta', 'gamma']) {
      Object.defineProperty(providerMap, method, {
        enumerable: true,
        configurable: true,
        get() {
          reads.push(method)
          return (context: Parameters<IWebRpcProvider>[0]) => context.success(method)
        }
      })
    }
    const config = {
      id: 'provider-entry-snapshot-host',
      transport: serverTransport,
      middlewares: [connect({ transport: serverTransport })],
      get provider() {
        reads.push('provider')
        return providerMap
      }
    } as IWebRpcCoreConfig
    const server = await createProviderEndpoint(config)
    try {
      expect(reads).toEqual(['provider', 'alpha', 'beta', 'gamma'])
      Object.defineProperty(providerMap, 'alpha', {
        configurable: true,
        enumerable: true,
        value: () => ({ mutated: true })
      })
      expect(readEndpointDebugSnapshot(server)?.providers).toBe(3)
    } finally {
      await server.dispose()
    }
  })

  it('P2-026 production seam preserves canonical owner timing and identities', async () => {
    const reporterInput = new Error('report input')
    const reporterCalls: unknown[] = []
    const validateCause = new Error('schema rejected')
    const responsePrimary = new Error('hostile response transport')
    const framePrimary = new Error('hostile frame transport')
    const observerFailure = new Error('observer failure is contained')
    let transportCalls = 0
    const observations: IWebRpcOutboundCommandObservation[] = []
    const fixture = await createActualAdmissionFixture({
      contractConfig: {
        schemas: {
          echo: {
            params: {
              parse: () => {
                throw validateCause
              }
            },
            result: { parse: (value: unknown) => value }
          }
        }
      },
      transportSend: () => {
        transportCalls += 1
        throw transportCalls === 1 ? responsePrimary : framePrimary
      },
      hookErrorReporter: (error) => {
        reporterCalls.push(error)
        throw new Error('reporter failure is contained')
      },
      observeOutboundCommand: (observation) => {
        observations.push(observation)
        throw observerFailure
      }
    })
    const unhandled: unknown[] = []
    const onUnhandledRejection = (reason: unknown): void => {
      unhandled.push(reason)
    }
    process.on('unhandledRejection', onUnhandledRejection)
    try {
      await fixture.install()
      const operations = fixture.host.getShared(
        WebRpcSharedKey.outboundOperations
      ) as IWebRpcOutboundOperationsPort
      const commandKinds: string[] = []
      commandKinds.push('dispatch')
      let dispatchFailure: unknown
      try {
        operations.send({ kind: 'dispatch', targetId: '', method: 'echo', data: null })
      } catch (error) {
        dispatchFailure = error
      }
      expect(dispatchFailure).toMatchObject({
        name: 'WebRpcError',
        source: '@migaia/web-rpc',
        code: WebRpcErrorCode.invalidConfig
      })
      commandKinds.push('validate')
      let validateFailure: unknown
      try {
        operations.send({ kind: 'validate', method: 'echo', side: 'params', data: null })
      } catch (error) {
        validateFailure = error
      }
      expect(validateFailure).toBeInstanceOf(WebRpcSchemaValidationError)
      expect(validateFailure).toMatchObject({
        name: 'WebRpcSchemaValidationError',
        source: '@migaia/web-rpc',
        code: WebRpcErrorCode.schemaInvalid,
        cause: validateCause
      })
      commandKinds.push('report')
      const reportResult = operations.send({
        kind: 'report',
        error: reporterInput,
        code: WebRpcErrorCode.internal
      })
      expect(reportResult).toBeUndefined()
      expect(reporterCalls.filter((error) => error === reporterInput)).toHaveLength(1)
      commandKinds.push('response')
      const responseResult = operations.send({
        kind: 'response',
        message: normalizeRpcEnvelope({ kind: 'response', ok: true, id: 'response', data: null })
      })
      expect(responseResult).toBeInstanceOf(Promise)
      await expect(responseResult).rejects.toMatchObject({
        name: 'WebRpcTransportError',
        source: '@migaia/web-rpc',
        code: WebRpcErrorCode.transport,
        cause: responsePrimary
      })
      expect(responseResult).toBe(observations[3]?.result)
      commandKinds.push('frame')
      const frameResult = operations.send({
        kind: 'frame',
        message: normalizeRpcEnvelope({ kind: 'response', ok: true, id: 'frame', data: null })
      })
      expect(frameResult).toBeInstanceOf(Promise)
      await expect(frameResult).rejects.toMatchObject({
        name: 'WebRpcTransportError',
        source: '@migaia/web-rpc',
        code: WebRpcErrorCode.transport,
        cause: framePrimary
      })
      expect(frameResult).toBe(observations[4]?.result)
      expect(transportCalls).toBe(2)
      expect(reporterCalls.filter((error) => error === observerFailure)).toHaveLength(5)
      expect(commandKinds).toEqual(['dispatch', 'validate', 'report', 'response', 'frame'])
      expect(observations.map(({ command }) => command.kind)).toEqual(commandKinds)
      expect(observations.every((observation) => Object.isFrozen(observation))).toBe(true)
      expect(observations[0]?.error).toBe(dispatchFailure)
      expect(observations[1]?.error).toBe(validateFailure)
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
      expect(unhandled).toEqual([])
      const hostDispose = fixture.host.dispose()
      expect(fixture.host.dispose()).toBe(hostDispose)
      await expect(hostDispose).resolves.toMatchObject({
        logicalTerminal: true,
        cleanupComplete: true,
        cleanupErrors: []
      })
      expect(fixture.host.dispose()).toBe(hostDispose)
      const terminal = fixture.snapshot()
      expect({
        shared: terminal.shared.every((value) => value === undefined),
        extensions: terminal.extensions.every((descriptor) => descriptor === undefined),
        installations: terminal.installations.every(
          ({ installed, extensionKeys, sharedKeys }) =>
            !installed && extensionKeys.length === 0 && sharedKeys.length === 0
        ),
        activeSubscriptions: terminal.activeSubscriptions,
        kernelState: terminal.kernelState,
        kernelOwners: terminal.kernelOwners,
        kernelRoutes: terminal.kernelRoutes,
        resources: terminal.resources
      }).toEqual({
        shared: true,
        extensions: true,
        installations: true,
        activeSubscriptions: 0,
        kernelState: 'disposed',
        kernelOwners: [],
        kernelRoutes: [],
        resources: 0
      })
    } finally {
      process.off('unhandledRejection', onUnhandledRejection)
      await fixture.dispose()
    }
  })

  it('T148 composed disposal observer fails closed for forged and separate endpoint instances', async () => {
    const transport: IWebRpcTransport = {
      platform: 'Memory',
      ownership: 'borrowed',
      send() {},
      subscribe() {
        return () => undefined
      }
    }
    const createEndpoint = (id: string) =>
      createFullEndpoint({ id, transport, middlewares: [connect({ transport })] })
    const first = await createEndpoint('round-eight-first-endpoint')
    const second = await createEndpoint('round-eight-second-endpoint')
    expect(readComposedDisposalPromises(first)).toBeUndefined()
    expect(readComposedDisposalPromises(second)).toBeUndefined()
    expect(readComposedDisposalPromises({})).toBeUndefined()
    expect(readComposedDisposalPromises({ __webRpcComposedDisposal: {} })).toBeUndefined()
    expect(readComposedDisposalPromises({ [Symbol('composed-disposal')]: {} })).toBeUndefined()
    expect(readComposedDisposalPromises({ ...first })).toBeUndefined()
    expect(
      readComposedDisposalPromises(
        new Proxy(first, {
          get() {
            throw new Error('forged observer proxy must not be probed')
          }
        })
      )
    ).toBeUndefined()

    const firstDispose = first.dispose()
    const firstObserved = readComposedDisposalPromises(first)
    expect(firstObserved?.endpoint).toBe(firstDispose)
    expect(readComposedDisposalPromises(second)).toBeUndefined()
    expect(readComposedDisposalPromises(first)).toBe(firstObserved)
    const frozenSnapshot = Object.freeze(readEndpointDebugSnapshot(first)!)
    expect(() => readComposedDisposalPromises(frozenSnapshot)).not.toThrow()
    expect(readComposedDisposalPromises(frozenSnapshot)).toBeUndefined()
    await firstDispose

    const secondDispose = second.dispose()
    const secondObserved = readComposedDisposalPromises(second)
    expect(secondObserved?.endpoint).toBe(secondDispose)
    expect(secondObserved).not.toBe(firstObserved)
    expect(secondObserved?.host).not.toBe(firstObserved?.host)
    await secondDispose
  })

  it('T129 actual provider endpoint isolation and terminal removal preserve independent identity', async () => {
    const [, firstTransport] = createMemoryTransportPair()
    const [, secondTransport] = createMemoryTransportPair()
    const first = await createRealProvider('provider-isolation-first', firstTransport, {
      echo: (context) => context.success('first')
    })
    const second = await createRealProvider('provider-isolation-second', secondTransport, {
      echo: (context) => context.success('second')
    })
    const firstDispose = first.dispose()
    expect(first.dispose()).toBe(firstDispose)
    await firstDispose
    expect(readEndpointDebugSnapshot(first)?.providers).toBe(0)
    expect(readEndpointDebugSnapshot(second)?.providers).toBe(1)
    const secondDispose = second.dispose()
    expect(second.dispose()).toBe(secondDispose)
    await secondDispose
    expect(readEndpointDebugSnapshot(second)?.providers).toBe(0)
  })

  it('T130 provider source boundary excludes D95 from all migrated feature consumers', async () => {
    const sources = await Promise.all(
      ['discovery.ts', 'control.ts', 'provider.ts', 'canonical-chunk.ts'].map((name) =>
        readFile(new URL(`../src/features/${name}`, import.meta.url), 'utf8')
      )
    )
    expect(sources[0]).not.toContain('outboundCompatibility')
    expect(sources[1]).not.toContain('outboundCompatibility')
    expect(sources[2]).not.toContain('outboundCompatibility')
    expect(sources[3]).not.toContain('outboundCompatibility')
  })

  it('T250 discovery ownership scan finds only the canonical attachment state owner', async () => {
    await expect(readFile(new URL('../src/endpoint.ts', import.meta.url), 'utf8')).rejects.toThrow()
    const attachmentSource = await readFile(
      new URL('../src/internal/discovery-attachment.ts', import.meta.url),
      'utf8'
    )
    expect(attachmentSource).not.toContain('legacy-discovery-owner')
    expect(attachmentSource).not.toContain('#legacyOptions')
    expect(attachmentSource).not.toContain('getLegacyControls')
    expect(attachmentSource).toContain("kernel.registerRoute('discovery'")
    expect(attachmentSource).not.toContain('kernel.registerRoute(WebRpcMessageKind.discovery')
  })

  it('T246 real composed discovery consumes narrow ports and publishes only its resolver', async () => {
    const discoveryFixture = await createActualAdmissionFixture({
      endpointId: 'cycle-m-discovery-contract',
      rootNames: ['first-party-discovery']
    })
    const [baseClientTransport, baseServerTransport] = createMemoryTransportPair()
    const clientTransport = {
      ...baseClientTransport,
      topology: 'multiplexed' as const,
      peerId: 'cycle-m-composed-discovery-server'
    }
    const serverTransport = {
      ...baseServerTransport,
      topology: 'multiplexed' as const,
      peerId: 'cycle-m-composed-discovery-client'
    }
    const client = await createComposedEndpoint(
      {
        id: 'cycle-m-composed-discovery-client',
        transport: clientTransport,
        middlewares: [connect({ transport: clientTransport }), ping()]
      },
      createNativeRoots('first-party-outbound', 'first-party-discovery', 'first-party-control')
    )
    const server = await createComposedEndpoint(
      {
        id: 'cycle-m-composed-discovery-server',
        transport: serverTransport,
        middlewares: [connect({ transport: serverTransport }), ping()]
      },
      createNativeRoots('first-party-outbound', 'first-party-discovery', 'first-party-control')
    )
    try {
      await discoveryFixture.install()
      // Native capability assembly exposes real ports through the Host, not a descriptor copy.
      expect(discoveryFixture.host.getShared(WebRpcSharedKey.discoveryResolver)).toBeDefined()
      expect(discoveryFixture.host.getShared(WebRpcSharedKey.inboundIdentity)).toBeDefined()
      expect(discoveryFixture.host.getShared(WebRpcSharedKey.outboundOperations)).toBeDefined()
      expect(discoveryFixture.host.getShared(WebRpcSharedKey.time)).toBeDefined()
      expect(Object.keys(client)).toEqual([
        'hooks',
        'dispose',
        'send',
        'sendAll',
        'dispatch',
        'dispatchAll',
        'connect',
        'discovery',
        'ping',
        'pingAll'
      ])
      expect(client).not.toHaveProperty('discoveryResolver')
      expect(client).not.toHaveProperty('inboundIdentity')
      expect(client).not.toHaveProperty('outboundOperations')
      expect(client).not.toHaveProperty('time')

      await expect(
        client.ping!('cycle-m-composed-discovery-server', undefined, { timeoutMs: 100 })
      ).resolves.toBe(true)
      expect(client.discovery.getServerList('cycle-m-composed-discovery-server')).toMatchObject([
        {
          targetId: 'cycle-m-composed-discovery-server',
          receiverId: 'cycle-m-composed-discovery-server',
          status: 'active'
        }
      ])
      expect(readEndpointDebugSnapshot(client)).toMatchObject({
        phase: 'active'
      })
      const owners = readEndpointDebugSnapshot(client)?.owners ?? []
      expect(owners.filter((owner) => owner === 'discovery-registry')).toHaveLength(1)
      expect(owners.filter((owner) => owner === 'discovery-replay')).toHaveLength(1)
      expect(owners.filter((owner) => owner === 'time-port')).toHaveLength(1)
    } finally {
      await discoveryFixture.dispose()
      await client.dispose()
      await server.dispose()
    }
  })

  it('T247 composed discovery schedules and clears its exact timer through the endpoint time port', async () => {
    vi.useFakeTimers()
    const [baseTransport] = createMemoryTransportPair()
    const transport = { ...baseTransport, topology: 'multiplexed' as const }
    const endpoint = await createFullEndpoint({
      id: 'cycle-m-composed-discovery-time',
      transport,
      middlewares: [connect({ transport }), ping()]
    })
    const timeEvents: IWebRpcTimePortEvent[] = []
    const unregisterTimeObserver = registerEndpointTimePortObserver(endpoint, (event) => {
      timeEvents.push(event)
    })
    try {
      const pending = endpoint.ping!('cycle-m-missing', undefined, {
        timeoutMs: 5000
      })
      await vi.advanceTimersByTimeAsync(0)
      const setEvents = timeEvents.filter(
        (event): event is Extract<IWebRpcTimePortEvent, { readonly kind: 'setTimeout' }> =>
          event.kind === 'setTimeout'
      )
      expect(setEvents).toHaveLength(2)
      const discoverySetEvent = setEvents.find((event) => event.delayMs === 1000)
      const controlSetEvent = setEvents.find((event) => event.delayMs === 5000)
      expect(discoverySetEvent).toBeDefined()
      expect(controlSetEvent).toBeDefined()
      expect(readEndpointDebugSnapshot(endpoint)).toMatchObject({
        discovery: { waiters: 1, tasks: 1, timers: 1, manualWaiters: 0, inboundTimers: 0 }
      })
      const liveOwners = readEndpointDebugSnapshot(endpoint)?.owners ?? []
      expect(liveOwners.filter((owner) => owner === 'time-port')).toHaveLength(1)
      expect(liveOwners.some((owner) => owner.includes('timer'))).toBe(false)
      const disposePromise = endpoint.dispose()
      expect(endpoint.dispose()).toBe(disposePromise)
      await expect(pending).resolves.toBe(false)
      await disposePromise
      const clearEvents = timeEvents.filter(
        (event): event is Extract<IWebRpcTimePortEvent, { readonly kind: 'clearTimeout' }> =>
          event.kind === 'clearTimeout'
      )
      expect(clearEvents).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ timer: discoverySetEvent?.timer }),
          expect.objectContaining({ timer: controlSetEvent?.timer })
        ])
      )
      expect(readEndpointDebugSnapshot(endpoint)).toMatchObject({
        discovery: {
          waiters: 0,
          tasks: 0,
          timers: 0,
          manualWaiters: 0,
          inboundQueries: 0,
          inboundTimers: 0
        },
        resources: expect.any(Number)
      })
      expect(readEndpointDebugSnapshot(endpoint)).toMatchObject({
        phase: 'disposed',
        resources: 0,
        discovery: { waiters: 0, tasks: 0, timers: 0, manualWaiters: 0, inboundTimers: 0 }
      })
    } finally {
      unregisterTimeObserver()
      await endpoint.dispose()
      vi.useRealTimers()
    }
  })

  it('T252 control inventory exposes only its planned narrow shared ports', async () => {
    const fixture = await createActualAdmissionFixture({
      endpointId: 'b12c04-control-inventory',
      rootNames: ['first-party-control']
    })
    try {
      const schema = WebRpcControlRoleSchema[WebRpcControlRole.control]
      expect(fixture.getNativeRootSharedConsumes('first-party-control')).toEqual(
        schema.sharedConsumes
      )
      await fixture.install()
      expect(fixture.host.getShared(WebRpcSharedKey.outboundOperations)).toBeDefined()
      expect(fixture.host.getShared(WebRpcSharedKey.discoveryResolver)).toBeDefined()
      expect(fixture.host.getShared(WebRpcSharedKey.candidatePing)).toBeDefined()
    } finally {
      await fixture.dispose()
    }
  })

  it('T253 actual control candidate matches the narrow contract through real inventory', async () => {
    const fixture = await createActualAdmissionFixture({
      endpointId: 'b12c04-control-candidate',
      rootNames: ['first-party-control']
    })
    try {
      await fixture.install()
      const candidatePing = fixture.host.getShared(WebRpcSharedKey.candidatePing) as {
        readonly ping?: unknown
      }
      expect(typeof candidatePing.ping).toBe('function')
    } finally {
      await fixture.dispose()
    }
  })

  it('T261 admitted-unpublished control publication fails with the same Host transaction evidence', async () => {
    const fixture = await createActualAdmissionFixture({
      endpointId: 'b12c04-control-unpublished',
      rootNames: ['first-party-outbound', 'first-party-control'],
      transformShared: (published) => {
        const omitted = { ...published }
        delete omitted[WebRpcSharedKey.variationCoordinator]
        return omitted
      }
    })
    let failure: unknown
    try {
      await fixture.install()
    } catch (error) {
      failure = error
    }
    const hostDispose = fixture.host.dispose()
    expect(fixture.host.dispose()).toBe(hostDispose)
    await hostDispose
    const terminal = projectD95TerminalSnapshot(fixture.snapshot())
    try {
      expect({
        name: (failure as { readonly name?: unknown } | undefined)?.name,
        source: (failure as { readonly source?: unknown } | undefined)?.source,
        code: (failure as { readonly code?: unknown } | undefined)?.code,
        failedName: (failure as { readonly detail?: { readonly failedName?: unknown } } | undefined)
          ?.detail?.failedName,
        cause: (failure as { readonly cause?: unknown } | undefined)?.cause,
        terminal
      }).toEqual({
        name: 'PluginHostError',
        source: '@migaia/plugin-host',
        code: 'PLUGIN_INSTALL_FAILED',
        failedName: 'activation',
        cause: expect.objectContaining({
          name: 'WebRpcConfigurationError',
          source: '@migaia/web-rpc',
          code: WebRpcErrorCode.invalidConfig
        }),
        terminal: {
          hostKeys: [],
          sharedEmpty: true,
          extensionsEmpty: true,
          installationsClear: true,
          activated: false,
          activeSubscriptions: 0,
          providerState: { admission: 0, replay: 0, activeControllers: 0 },
          kernelState: 'disposed',
          kernelOwners: [],
          kernelRoutes: [],
          resources: 0
        }
      })
    } finally {
      await fixture.dispose()
    }
  })

  it('T262 control narrow publication is endpoint-local across two real Host transactions', async () => {
    const first = await createActualAdmissionFixture({
      endpointId: 'b12c04-control-isolation-a'
    })
    const second = await createActualAdmissionFixture({
      endpointId: 'b12c04-control-isolation-b'
    })
    try {
      await first.install()
      await second.install()
      const firstPort = first.host.getShared(WebRpcSharedKey.outboundOperations)
      const secondPort = second.host.getShared(WebRpcSharedKey.outboundOperations)
      expect(firstPort).not.toBe(secondPort)
      expect(first.host.getShared(WebRpcSharedKey.outboundOperations)).toBe(firstPort)
      expect(second.host.getShared(WebRpcSharedKey.outboundOperations)).toBe(secondPort)
    } finally {
      await first.dispose()
      await second.dispose()
    }
  })

  it('T263 terminal control disposal removes narrow shared state exactly once', async () => {
    const fixture = await createActualAdmissionFixture({
      endpointId: 'b12c04-control-terminal-removal'
    })
    await fixture.install()
    const firstDispose = fixture.host.dispose()
    expect(fixture.host.dispose()).toBe(firstDispose)
    await firstDispose
    const terminal = fixture.snapshot()
    expect(terminal.shared.every((value) => value === undefined)).toBe(true)
    expect(terminal.activeSubscriptions).toBe(0)
    await fixture.dispose()
  })

  it('T264 successful control transaction preserves canonical cleanup and repeated Host Promise identity', async () => {
    const fixture = await createActualAdmissionFixture({
      endpointId: 'b12c04-control-success-lifecycle'
    })
    await fixture.install()
    const firstDispose = fixture.host.dispose()
    expect(fixture.host.dispose()).toBe(firstDispose)
    await expect(firstDispose).resolves.toMatchObject({
      logicalTerminal: true,
      cleanupComplete: true,
      cleanupErrors: []
    })
    const terminal = fixture.snapshot()
    expect(terminal.activeSubscriptions).toBe(0)
    expect(terminal.resources).toBe(0)
    await fixture.dispose()
  })

  it('T266 superseded intermediate deletion leaves both migrated consumers free of D95', async () => {
    const [controlSource, chunkSource] = await Promise.all([
      readFile(new URL('../src/features/control.ts', import.meta.url), 'utf8'),
      readFile(new URL('../src/features/canonical-chunk.ts', import.meta.url), 'utf8')
    ])
    expect(controlSource).not.toContain('outboundCompatibility')
    expect(chunkSource).not.toContain('outboundCompatibility')
  })

  it('T267 final deletion boundary removes D95 from control and chunk after both narrow migrations', async () => {
    const [controlSource, chunkSource] = await Promise.all([
      readFile(new URL('../src/features/control.ts', import.meta.url), 'utf8'),
      readFile(new URL('../src/features/canonical-chunk.ts', import.meta.url), 'utf8')
    ])
    expect(controlSource).not.toContain('outboundCompatibility')
    expect(chunkSource).not.toContain('outboundCompatibility')
  })

  it('T268 control role authority is deeply frozen with the exact contract shape', () => {
    const role = WebRpcControlRoleSchema[WebRpcControlRole.control]
    expect(Object.isFrozen(WebRpcControlRole)).toBe(true)
    expect(Object.keys(WebRpcControlRole)).toEqual(['control'])
    expect(Object.keys(role)).toEqual([
      'sharedProvides',
      'sharedConsumes',
      'sharedOptionalConsumes',
      'publicKeys',
      'exposedKeys'
    ])
    expect(role.sharedProvides).toEqual([WebRpcSharedKey.candidatePing])
    expect(role.sharedConsumes).toEqual([
      WebRpcSharedKey.outboundOperations,
      WebRpcSharedKey.discoveryResolver,
      WebRpcSharedKey.time,
      WebRpcSharedKey.variationCoordinator
    ])
    expect(role.sharedOptionalConsumes).toEqual([])
    expect(role.publicKeys).toEqual(['ping', 'pingAll'])
    expect(role.exposedKeys).toEqual(['ping', 'pingAll'])
    expect(Object.isFrozen(role)).toBe(true)
    expect(Object.isFrozen(role.sharedProvides)).toBe(true)
    expect(Object.isFrozen(role.sharedConsumes)).toBe(true)
    expect(Object.isFrozen(role.sharedOptionalConsumes)).toBe(true)
    expect(Object.isFrozen(role.publicKeys)).toBe(true)
    expect(Object.isFrozen(role.exposedKeys)).toBe(true)
    const roleDescriptors = Object.getOwnPropertyDescriptors(role)
    const consumesDescriptors = Object.getOwnPropertyDescriptors(role.sharedConsumes)
    const publicDescriptors = Object.getOwnPropertyDescriptors(role.publicKeys)
    const exposedDescriptors = Object.getOwnPropertyDescriptors(role.exposedKeys)
    expect(Reflect.defineProperty(role, 'forged', { value: true })).toBe(false)
    expect(Reflect.deleteProperty(role, 'sharedConsumes')).toBe(false)
    expect(() => Object.setPrototypeOf(role, {})).toThrow()
    expect(Reflect.defineProperty(role.sharedConsumes, '0', { value: WebRpcSharedKey.time })).toBe(
      false
    )
    expect(Reflect.deleteProperty(role.publicKeys, '0')).toBe(false)
    expect(() => Object.setPrototypeOf(role.exposedKeys, {})).toThrow()
    expect(Object.getOwnPropertyDescriptors(role)).toEqual(roleDescriptors)
    expect(Object.getOwnPropertyDescriptors(role.sharedConsumes)).toEqual(consumesDescriptors)
    expect(Object.getOwnPropertyDescriptors(role.publicKeys)).toEqual(publicDescriptors)
    expect(Object.getOwnPropertyDescriptors(role.exposedKeys)).toEqual(exposedDescriptors)
  })

  it('T271 canonical control endpoint disposal exposes the same stable Host and endpoint Promises', async () => {
    const [clientTransport, serverTransport] = createMemoryTransportPair()
    const endpoint = await createFullEndpoint({
      id: 'b12c04-control-endpoint-disposal',
      transport: clientTransport,
      middlewares: [connect({ transport: clientTransport }), ping()]
    })
    try {
      const endpointDispose = endpoint.dispose()
      expect(endpoint.dispose()).toBe(endpointDispose)
      const promises = readComposedDisposalPromises(endpoint)
      expect(promises?.endpoint).toBe(endpointDispose)
      expect(promises?.host).toBeInstanceOf(Promise)
      expect(promises?.host).toBe(endpointDispose)
      await endpointDispose
    } finally {
      await endpoint.dispose()
      await serverTransport.close?.()
    }
  })

  it('T272 selected control roots keep dependencies private and disposal endpoint-local', async () => {
    const [, firstTransport] = createMemoryTransportPair()
    const [, secondTransport] = createMemoryTransportPair()
    const first = await createComposedEndpoint(
      {
        id: 'round-seventeen-control-root-first',
        transport: firstTransport,
        middlewares: [connect({ transport: firstTransport }), ping()]
      },
      createNativeRoots('first-party-outbound', 'first-party-control')
    )
    const second = await createComposedEndpoint(
      {
        id: 'round-seventeen-control-root-second',
        transport: secondTransport,
        middlewares: [connect({ transport: secondTransport }), ping()]
      },
      createNativeRoots('first-party-outbound', 'first-party-control')
    )
    try {
      expect(Object.keys(first)).toEqual([
        'hooks',
        'dispose',
        'send',
        'sendAll',
        'dispatch',
        'dispatchAll',
        'ping',
        'pingAll'
      ])
      expect(first).not.toHaveProperty('connect')
      expect(first).not.toHaveProperty('discovery')
      expect(first).not.toHaveProperty('outboundCompatibility')
      expect(readEndpointDebugSnapshot(first)).toMatchObject({
        phase: 'active',
        pending: 0,
        pingPending: 0
      })
      expect(readEndpointDebugSnapshot(second)).toMatchObject({
        phase: 'active',
        pending: 0,
        pingPending: 0
      })
      const firstDispose = first.dispose()
      expect(first.dispose()).toBe(firstDispose)
      await firstDispose
      expect(readEndpointDebugSnapshot(first)).toMatchObject({ phase: 'disposed', resources: 0 })
      expect(readEndpointDebugSnapshot(second)).toMatchObject({ phase: 'active' })
      const secondDispose = second.dispose()
      expect(second.dispose()).toBe(secondDispose)
      await secondDispose
    } finally {
      await first.dispose()
      await second.dispose()
    }
  })

  it('T273 canonical control ping abort and timeout preserve peer and terminal isolation', async () => {
    const [clientTransport, serverTransport] = createMemoryTransportPair()
    const server = await createFullEndpoint({
      id: 'round-seventeen-control-peer',
      transport: serverTransport,
      middlewares: [connect({ transport: serverTransport }), ping()]
    })
    const client = await createFullEndpoint({
      id: 'round-seventeen-control-client',
      transport: clientTransport,
      targetIds: ['round-seventeen-control-peer'],
      middlewares: [connect({ transport: clientTransport }), ping()]
    })
    try {
      await expect(client.ping!('round-seventeen-control-peer')).resolves.toBe(true)
      const controller = new AbortController()
      const aborted = client.ping!('round-seventeen-control-missing', undefined, {
        timeoutMs: 1000,
        signal: controller.signal
      })
      controller.abort()
      await expect(aborted).resolves.toBe(false)
      await expect(
        client.ping!('round-seventeen-control-missing', undefined, { timeoutMs: 25 })
      ).resolves.toBe(false)
      const clientDispose = client.dispose()
      expect(client.dispose()).toBe(clientDispose)
      await clientDispose
      expect(readEndpointDebugSnapshot(client)).toMatchObject({
        phase: 'disposed',
        pending: 0,
        pingPending: 0,
        activeControllers: 0,
        resources: 0
      })
      expect(readEndpointDebugSnapshot(server)).toMatchObject({ phase: 'active' })
    } finally {
      await client.dispose()
      await server.dispose()
    }
  })

  it('T274 canonical control endpoint translates two cleanup leaves on one transaction', async () => {
    const cleanupOrder: string[] = []
    const firstCleanup = new Error('round-seventeen-first-control-cleanup')
    const secondCleanup = new Error('round-seventeen-second-control-cleanup')
    const firstMiddleware: IWebRpcPlugin = {
      name: 'round-seventeen-first-control-cleanup',
      metadata: {
        claims: {
          routes: [],
          provides: [],
          consumes: [],
          publicKeys: [],
          exposedKeys: [],
          activator: false
        }
      },
      install: (scope) => {
        scope.own({}, () => {
          cleanupOrder.push('first')
          throw firstCleanup
        })
        return { extension: {}, shared: {} }
      }
    }
    const secondMiddleware: IWebRpcPlugin = {
      name: 'round-seventeen-second-control-cleanup',
      metadata: {
        claims: {
          routes: [],
          provides: [],
          consumes: [],
          publicKeys: [],
          exposedKeys: [],
          activator: false
        }
      },
      install: (scope) => {
        scope.own({}, () => {
          cleanupOrder.push('second')
          throw secondCleanup
        })
        return { extension: {}, shared: {} }
      }
    }
    const [transport] = createMemoryTransportPair()
    const endpoint = await createFullEndpoint({
      id: 'round-seventeen-control-cleanup',
      transport,
      middlewares: [connect({ transport }), ping(), firstMiddleware, secondMiddleware]
    })
    const endpointDispose = endpoint.dispose()
    expect(endpoint.dispose()).toBe(endpointDispose)
    const promises = readComposedDisposalPromises(endpoint)
    expect(promises?.endpoint).toBe(endpointDispose)
    expect(promises?.host).toBeInstanceOf(Promise)
    expect(promises?.host).toBe(endpointDispose)
    expect(promises?.host).toBe(readComposedDisposalPromises(endpoint)?.host)
    let failure: unknown
    try {
      await endpointDispose
    } catch (error) {
      failure = error
    }
    expect(failure).toMatchObject({
      name: 'WebRpcLifecycleError',
      source: '@migaia/web-rpc',
      code: WebRpcErrorCode.endpointDisposed,
      cause: secondCleanup
    })
    const cleanupErrors = (failure as { readonly cleanupErrors?: readonly { error: unknown }[] })
      .cleanupErrors
    expect(cleanupErrors?.map(({ error }) => error)).toEqual([secondCleanup, firstCleanup])
    expect(cleanupOrder).toEqual(['second', 'first'])
    let hostFailure: unknown
    try {
      await promises?.host
    } catch (error) {
      hostFailure = error
    }
    expect(hostFailure).toBe(failure)
    expect(readEndpointDebugSnapshot(endpoint)).toMatchObject({
      phase: 'disposed',
      pending: 0,
      pingPending: 0,
      activeControllers: 0,
      resources: 0
    })
    expect(endpoint.dispose()).toBe(endpointDispose)
  })

  it('T275 final source boundary excludes D95 from control and chunk', async () => {
    const [controlSource, chunkSource] = await Promise.all([
      readFile(new URL('../src/features/control.ts', import.meta.url), 'utf8'),
      readFile(new URL('../src/features/canonical-chunk.ts', import.meta.url), 'utf8')
    ])
    await expect(readFile(new URL('../src/endpoint.ts', import.meta.url), 'utf8')).rejects.toThrow()
    await expect(
      readFile(new URL('../src/internal/endpoint-resource-manager.ts', import.meta.url), 'utf8')
    ).rejects.toThrow()
    expect(controlSource).not.toContain('outboundCompatibility')
    expect(chunkSource).not.toContain('outboundCompatibility')
    expect(chunkSource).toContain('WebRpcCanonicalChunkAttachment')
    expect(chunkSource).not.toContain('WebRpcSharedKey.inboundIdentity')
    expect(chunkSource).not.toContain('WebRpcSharedKey.time')
  })

  it('T276 concurrent reused control modules preserve independent endpoint snapshots', async () => {
    const [, firstTransport] = createMemoryTransportPair()
    const [, secondTransport] = createMemoryTransportPair()
    const reusedPing = ping()
    const reusedRoots = createNativeRoots('first-party-outbound', 'first-party-control')
    const [first, second] = await Promise.all([
      createComposedEndpoint(
        {
          id: 'round-eighteen-control-reuse-first',
          transport: firstTransport,
          middlewares: [connect({ transport: firstTransport }), reusedPing]
        },
        reusedRoots
      ),
      createComposedEndpoint(
        {
          id: 'round-eighteen-control-reuse-second',
          transport: secondTransport,
          middlewares: [connect({ transport: secondTransport }), reusedPing]
        },
        reusedRoots
      )
    ])
    try {
      expect(first.ping).toBeTypeOf('function')
      expect(second.ping).toBeTypeOf('function')
      expect(readEndpointDebugSnapshot(first)).toMatchObject({ phase: 'active', pending: 0 })
      expect(readEndpointDebugSnapshot(second)).toMatchObject({ phase: 'active', pending: 0 })
      const firstDispose = first.dispose()
      const secondDispose = second.dispose()
      expect(first.dispose()).toBe(firstDispose)
      expect(second.dispose()).toBe(secondDispose)
      await Promise.all([firstDispose, secondDispose])
      expect(readEndpointDebugSnapshot(first)).toMatchObject({ phase: 'disposed', resources: 0 })
      expect(readEndpointDebugSnapshot(second)).toMatchObject({ phase: 'disposed', resources: 0 })
    } finally {
      await first.dispose()
      await second.dispose()
    }
  })

  it('T277 real control fanout keeps tagged peer results endpoint-local', async () => {
    const [clientTransport, serverTransport] = createMemoryTransportPair()
    const server = await createFullEndpoint({
      id: 'round-eighteen-control-fanout-server',
      transport: serverTransport,
      middlewares: [connect({ transport: serverTransport }), ping()]
    })
    const client = await createFullEndpoint({
      id: 'round-eighteen-control-fanout-client',
      transport: clientTransport,
      targetIds: ['round-eighteen-control-fanout-server', 'round-eighteen-control-missing'],
      middlewares: [connect({ transport: clientTransport }), ping()]
    })
    try {
      const result = await client.pingAll!()
      const serverKey = JSON.stringify(['target', 'round-eighteen-control-fanout-server'])
      const missingKey = JSON.stringify(['target', 'round-eighteen-control-missing'])
      expect(result.fulfilled[serverKey]).toBe(true)
      expect(result.fulfilled[missingKey]).toBe(false)
      expect(Object.keys(result.fulfilled)).toEqual([serverKey, missingKey])
      expect(Object.keys(result.rejected)).toEqual([])
    } finally {
      await client.dispose()
      await server.dispose()
    }
  })

  it('T278 disposed control endpoint rejects a later operation without reviving state', async () => {
    const [transport] = createMemoryTransportPair()
    const endpoint = await createFullEndpoint({
      id: 'round-eighteen-control-terminal-removal',
      transport,
      middlewares: [connect({ transport }), ping()]
    })
    const disposePromise = endpoint.dispose()
    await disposePromise
    let failure: unknown
    try {
      endpoint.ping!('round-eighteen-control-missing')
    } catch (error) {
      failure = error
    }
    expect(failure).toBeInstanceOf(WebRpcLifecycleError)
    expect(readEndpointDebugSnapshot(endpoint)).toMatchObject({
      phase: 'disposed',
      pending: 0,
      pingPending: 0,
      activeControllers: 0,
      resources: 0
    })
    expect(endpoint.dispose()).toBe(disposePromise)
  })

  it('T279 control abort and disposal race leaves no late pending state', async () => {
    const [baseTransport] = createMemoryTransportPair()
    let transportErrorCount = 0
    const transport: IWebRpcTransport = {
      ...baseTransport,
      onTransportError: (listener) =>
        baseTransport.onTransportError?.((error) => {
          transportErrorCount += 1
          listener(error)
        }) ?? (() => undefined)
    }
    const endpoint = await createFullEndpoint({
      id: 'round-eighteen-control-dispose-race',
      transport,
      middlewares: [connect({ transport }), ping()]
    })
    const controller = new AbortController()
    let settlementCount = 0
    const pending = endpoint.ping!('round-eighteen-control-missing', undefined, {
      timeoutMs: 1000,
      signal: controller.signal
    }).then((value) => {
      settlementCount += 1
      return value
    })
    controller.abort()
    const disposePromise = endpoint.dispose()
    await expect(pending).resolves.toBe(false)
    await disposePromise
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    expect(settlementCount).toBe(1)
    expect(transportErrorCount).toBe(0)
    expect(readEndpointDebugSnapshot(endpoint)).toMatchObject({
      phase: 'disposed',
      pending: 0,
      pingPending: 0,
      activeControllers: 0,
      resources: 0
    })
    expect(endpoint.dispose()).toBe(disposePromise)
  })

  it('T280 runtime and declaration control D95 boundary remains fail-closed before artifact migration', async () => {
    const runtimeUrl = new URL('../dist/features/control.js', import.meta.url)
    const declarationUrl = new URL('../dist/features/control.d.ts', import.meta.url)
    const [runtimeSource, declarationSource] = await Promise.all([
      readFile(runtimeUrl, 'utf8').catch(() => ''),
      readFile(declarationUrl, 'utf8').catch(() => '')
    ])
    expect(runtimeSource).not.toBe('')
    expect(declarationSource).not.toBe('')
    expect(runtimeSource).not.toContain('outboundCompatibility')
    expect(declarationSource).not.toContain('outboundCompatibility')
  })

  it('T282 control construction snapshots config getters once before later source mutation', async () => {
    const [transport] = createMemoryTransportPair()
    const reads: string[] = []
    const targetIds = ['round-twenty-snapshot-target']
    const config = {
      get id(): string {
        reads.push('id')
        return 'round-twenty-snapshot'
      },
      get middlewares(): readonly IWebRpcPlugin[] {
        reads.push('middlewares')
        return [connect({ transport }), ping()]
      },
      get targetIds(): readonly string[] {
        reads.push('targetIds')
        return targetIds
      },
      get transport(): IWebRpcTransport {
        reads.push('transport')
        return transport
      },
      get provider(): undefined {
        reads.push('provider')
        return undefined
      },
      get replay(): undefined {
        reads.push('replay')
        return undefined
      },
      get construction(): undefined {
        reads.push('construction')
        return undefined
      }
    } as unknown as IWebRpcCoreConfig
    const endpoint = await createComposedEndpoint(
      config,
      createNativeRoots('first-party-outbound', 'first-party-control')
    )
    const snapshotReads = [...reads]
    targetIds[0] = 'round-twenty-mutated-target'
    try {
      const fanout = await endpoint.pingAll!()
      expect(Object.keys(fanout.fulfilled)).toEqual([
        JSON.stringify(['target', 'round-twenty-snapshot-target'])
      ])
      expect(fanout.fulfilled[JSON.stringify(['target', 'round-twenty-snapshot-target'])]).toBe(
        false
      )
      expect(reads).toEqual(snapshotReads)
      expect(
        Object.fromEntries(reads.map((key) => [key, reads.filter((value) => value === key).length]))
      ).toEqual({
        id: 1,
        middlewares: 1,
        targetIds: 1,
        transport: 1,
        provider: 1,
        replay: 1,
        construction: 1
      })
    } finally {
      await endpoint.dispose()
    }
  })

  it('T286 late control delivery after timeout cannot resettle or revive terminal state', async () => {
    vi.useFakeTimers()
    const [baseClientTransport, serverTransport] = createMemoryTransportPair()
    const delayedFrames: unknown[] = []
    const clientTransport: IWebRpcTransport = {
      ...baseClientTransport,
      send(message: unknown): void {
        delayedFrames.push(message)
      }
    }
    const server = await createFullEndpoint({
      id: 'round-twenty-late-server',
      transport: serverTransport,
      middlewares: [connect({ transport: serverTransport }), ping()]
    })
    const client = await createFullEndpoint({
      id: 'round-twenty-late-client',
      transport: clientTransport,
      targetIds: ['round-twenty-late-server'],
      middlewares: [connect({ transport: clientTransport }), ping()]
    })
    let settlementCount = 0
    try {
      const pending = client.ping!('round-twenty-late-server', undefined, { timeoutMs: 5 }).then(
        (value) => {
          settlementCount += 1
          return value
        }
      )
      await vi.advanceTimersByTimeAsync(5)
      await expect(pending).resolves.toBe(false)
      for (const frame of delayedFrames) baseClientTransport.send(frame)
      await vi.advanceTimersByTimeAsync(0)
      expect(settlementCount).toBe(1)
      expect(readEndpointDebugSnapshot(client)).toMatchObject({
        phase: 'active',
        pending: 0,
        pingPending: 0,
        activeControllers: 0,
        resources: expect.any(Number)
      })
      const disposePromise = client.dispose()
      expect(client.dispose()).toBe(disposePromise)
      await disposePromise
      expect(readEndpointDebugSnapshot(client)).toMatchObject({
        phase: 'disposed',
        pending: 0,
        pingPending: 0,
        activeControllers: 0,
        resources: 0
      })
    } finally {
      await client.dispose()
      await server.dispose()
      vi.useRealTimers()
    }
  })

  it('T290 concurrent reused control tokens preserve independent post-snapshot target state', async () => {
    const reusedRoots = createNativeRoots('first-party-outbound', 'first-party-control')
    const firstTargets = ['cycle-m-concurrent-first-target']
    const secondTargets = ['cycle-m-concurrent-second-target']
    const [firstBaseTransport] = createMemoryTransportPair()
    const [secondBaseTransport] = createMemoryTransportPair()
    const firstMessages: unknown[] = []
    const secondMessages: unknown[] = []
    const firstTransport = {
      ...firstBaseTransport,
      send(message: unknown): void {
        firstMessages.push(message)
        firstBaseTransport.send(message)
      }
    }
    const secondTransport = {
      ...secondBaseTransport,
      send(message: unknown): void {
        secondMessages.push(message)
        secondBaseTransport.send(message)
      }
    }
    const [first, second] = await Promise.all([
      createComposedEndpoint(
        {
          id: 'cycle-m-concurrent-first',
          transport: firstTransport,
          targetIds: firstTargets,
          middlewares: [connect({ transport: firstTransport }), ping()]
        },
        reusedRoots
      ),
      createComposedEndpoint(
        {
          id: 'cycle-m-concurrent-second',
          transport: secondTransport,
          targetIds: secondTargets,
          middlewares: [connect({ transport: secondTransport }), ping()]
        },
        reusedRoots
      )
    ])
    firstTargets[0] = 'cycle-m-mutated-first-target'
    secondTargets[0] = 'cycle-m-mutated-second-target'
    try {
      await Promise.all([first.pingAll!(), second.pingAll!()])
      expect(
        firstMessages.some((message) =>
          JSON.stringify(message).includes('cycle-m-concurrent-first-target')
        )
      ).toBe(true)
      expect(
        firstMessages.some((message) =>
          JSON.stringify(message).includes('cycle-m-mutated-first-target')
        )
      ).toBe(false)
      expect(
        secondMessages.some((message) =>
          JSON.stringify(message).includes('cycle-m-concurrent-second-target')
        )
      ).toBe(true)
      expect(
        secondMessages.some((message) =>
          JSON.stringify(message).includes('cycle-m-mutated-second-target')
        )
      ).toBe(false)
    } finally {
      await first.dispose()
      await second.dispose()
    }
  })

  it('T291 duplicate control delivery is rejected by canonical replay admission', async () => {
    const [baseClientTransport, baseServerTransport] = createMemoryTransportPair()
    const pingFrames: unknown[] = []
    const pongFrames: unknown[] = []
    const clientTransport = {
      ...baseClientTransport,
      send(message: unknown): void {
        if (
          typeof message === 'object' &&
          message !== null &&
          (message as { readonly data?: { readonly webRpc?: { readonly variation?: unknown } } })
            .data?.webRpc?.variation === 'ping'
        ) {
          pingFrames.push(message)
          return
        }
        baseClientTransport.send(message)
      }
    }
    const serverTransport = {
      ...baseServerTransport,
      send(message: unknown): void {
        if (JSON.stringify(message).includes('pong')) pongFrames.push(message)
        else baseServerTransport.send(message)
      }
    }
    const server = await createFullEndpoint({
      id: 'cycle-m-replay-server',
      transport: serverTransport,
      middlewares: [connect({ transport: serverTransport }), ping()]
    })
    const client = await createComposedEndpoint(
      {
        id: 'cycle-m-replay-client',
        transport: clientTransport,
        middlewares: [connect({ transport: clientTransport }), ping()]
      },
      createNativeRoots('first-party-outbound', 'first-party-control')
    )
    try {
      let settlementCount = 0
      const pending = client.ping!('cycle-m-replay-server', 'cycle-m-replay-server').then(
        (value) => {
          settlementCount += 1
          return value
        }
      )
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
      expect(pingFrames).toHaveLength(1)
      const firstPing = pingFrames[0]
      baseClientTransport.send(firstPing)
      baseClientTransport.send(firstPing)
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
      expect(pongFrames).toHaveLength(1)
      const firstPong = pongFrames[0]
      baseServerTransport.send(firstPong)
      await expect(pending).resolves.toBe(true)
      expect(settlementCount).toBe(1)
      expect(readEndpointDebugSnapshot(client)).toMatchObject({
        pending: 0,
        pingPending: 0,
        activeControllers: 0
      })
    } finally {
      await client.dispose()
      await server.dispose()
    }
  })

  it('T292 forged cross-peer control delivery cannot settle a trusted pending ping', async () => {
    const [baseClientTransport, baseServerTransport] = createMemoryTransportPair()
    const trustedSource = {}
    let inboundSource: unknown = trustedSource
    const clientTransport = {
      ...baseClientTransport,
      sourceProof: (source: unknown) => source === trustedSource,
      subscribe(listener: Parameters<IWebRpcTransport['subscribe']>[0]): () => void {
        return baseClientTransport.subscribe((message) =>
          listener({ ...message, source: inboundSource })
        )
      }
    }
    const sentFrames: unknown[] = []
    const serverTransport = {
      ...baseServerTransport,
      send(message: unknown): void {
        if (JSON.stringify(message).includes('pong')) sentFrames.push(message)
        else baseServerTransport.send(message)
      }
    }
    const server = await createFullEndpoint({
      id: 'cycle-m-cross-peer-server',
      transport: serverTransport,
      middlewares: [connect({ transport: serverTransport }), ping()]
    })
    const client = await createFullEndpoint({
      id: 'cycle-m-cross-peer-client',
      transport: clientTransport,
      middlewares: [connect({ transport: clientTransport }), ping()]
    })
    try {
      let settlementCount = 0
      const pending = client.ping!('cycle-m-cross-peer-server', 'cycle-m-cross-peer-server', {
        timeoutMs: 100
      }).then((value) => {
        settlementCount += 1
        return value
      })
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
      const heldPong = [...sentFrames]
        .reverse()
        .find((message) => JSON.stringify(message).includes('pong'))
      expect(heldPong).toBeDefined()
      inboundSource = {}
      baseServerTransport.send(heldPong)
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
      expect(settlementCount).toBe(0)
      inboundSource = trustedSource
      baseServerTransport.send(heldPong)
      await expect(pending).resolves.toBe(true)
      expect(settlementCount).toBe(1)
    } finally {
      await client.dispose()
      await server.dispose()
    }
  })

  it('T293 late control send rejection reports once after timeout', async () => {
    vi.useFakeTimers()
    const [baseClientTransport] = createMemoryTransportPair()
    let rejectSend!: (error: unknown) => void
    const lateSend = new Promise<void>((_resolve, reject) => {
      rejectSend = reject
    })
    const clientTransport = {
      ...baseClientTransport,
      send(message: unknown): Promise<void> | void {
        if (
          typeof message === 'object' &&
          message !== null &&
          (message as { readonly data?: { readonly webRpc?: { readonly variation?: unknown } } })
            .data?.webRpc?.variation === 'ping'
        )
          return lateSend
        return baseClientTransport.send(message)
      }
    }
    const reports: unknown[] = []
    const client = await createFullEndpoint({
      id: 'cycle-m-late-reject-client',
      transport: clientTransport,
      middlewares: [
        connect({ transport: clientTransport }),
        ping(),
        hooks({ onHookError: (error) => reports.push(error) })
      ]
    })
    try {
      const pending = client.ping!('cycle-m-late-reject-server', 'cycle-m-late-reject-server', {
        timeoutMs: 5
      })
      await vi.advanceTimersByTimeAsync(5)
      await expect(pending).resolves.toBe(false)
      const lateCause = new Error('cycle-m-late-control-send')
      rejectSend(lateCause)
      await vi.advanceTimersByTimeAsync(0)
      expect(reports).toEqual([lateCause])
    } finally {
      await client.dispose()
      vi.useRealTimers()
    }
  })

  it('T294 endpoint time owner advances control timeout and clears its exact timer', async () => {
    vi.useFakeTimers()
    const [transport] = createMemoryTransportPair()
    const endpoint = await createFullEndpoint({
      id: 'cycle-m-time-owner',
      transport,
      middlewares: [connect({ transport }), ping()]
    })
    const timeEvents: IWebRpcTimePortEvent[] = []
    const unregisterTimeObserver = registerEndpointTimePortObserver(endpoint, (event) => {
      timeEvents.push(event)
    })
    try {
      const pending = endpoint.ping!('cycle-m-time-missing', 'cycle-m-time-missing', {
        timeoutMs: 25
      })
      const registeredTimerEvent = timeEvents.find((event) => event.kind === 'setTimeout')
      expect(registeredTimerEvent).toMatchObject({
        kind: 'setTimeout',
        delayMs: 25
      })
      await vi.advanceTimersByTimeAsync(0)
      await vi.advanceTimersByTimeAsync(25)
      await expect(pending).resolves.toBe(false)
      const clearedTimerEvents = timeEvents.filter((event) => event.kind === 'clearTimeout')
      expect(clearedTimerEvents).toEqual([
        expect.objectContaining({ timer: registeredTimerEvent?.timer })
      ])
      expect(readEndpointDebugSnapshot(endpoint)).toMatchObject({
        phase: 'active',
        pending: 0,
        pingPending: 0,
        resources: expect.any(Number)
      })
      const disposePromise = endpoint.dispose()
      expect(endpoint.dispose()).toBe(disposePromise)
      await disposePromise
      expect(readEndpointDebugSnapshot(endpoint)).toMatchObject({
        phase: 'disposed',
        pending: 0,
        pingPending: 0,
        activeControllers: 0,
        resources: 0
      })
    } finally {
      unregisterTimeObserver()
      await endpoint.dispose()
      vi.useRealTimers()
    }
  })

  it('T219 unchanged discovery/control consumers run through the ordered D95 bridge transaction', async () => {
    const [, firstTransport] = createMemoryTransportPair()
    const [, secondTransport] = createMemoryTransportPair()
    const first = await createFullEndpoint({
      id: 'r73-d95-first',
      transport: firstTransport,
      middlewares: [connect({ transport: firstTransport }), ping()]
    })
    const second = await createFullEndpoint({
      id: 'r73-d95-second',
      transport: secondTransport,
      middlewares: [connect({ transport: secondTransport }), ping()]
    })
    try {
      expect(first.connect).toBeDefined()
      expect(first.discovery).toBeDefined()
      expect(first.ping).toBeTypeOf('function')
      expect(second.connect).toBeDefined()
      expect(second.discovery).toBeDefined()
      await expect(first.ping!('r73-d95-second', undefined, { timeoutMs: 200 })).resolves.toBe(
        false
      )
      const firstDispose = first.dispose()
      expect(first.dispose()).toBe(firstDispose)
      await firstDispose
      const secondDispose = second.dispose()
      expect(second.dispose()).toBe(secondDispose)
      await secondDispose
    } finally {
      await first.dispose()
      await second.dispose()
    }
  })

  it('T220 final D95 deletion removes bridge producers from source and dist', async () => {
    const source = await readFile(
      new URL('../src/internal/outbound-attachment.ts', import.meta.url),
      'utf8'
    )
    const runtime = await readFile(
      new URL('../dist/internal/outbound-attachment.js', import.meta.url),
      'utf8'
    )
    for (const text of [source, runtime]) {
      expect(text).not.toContain('createOutboundCompatibilityPort')
      expect(text).not.toContain('normalizeOutboundCompatibilityPort')
      expect(text).not.toContain('IWebRpcOutboundCompatibilityPort')
    }
  })

  it('T221 provider and adjacent-consumer artifacts expose the final removed D95 boundary', async () => {
    const featureNames = ['provider', 'discovery', 'control', 'canonical-chunk'] as const
    const sourceTexts = await Promise.all(
      featureNames.map((name) =>
        readFile(new URL(`../src/features/${name}.ts`, import.meta.url), 'utf8')
      )
    )
    const runtimeTexts = await Promise.all(
      featureNames.map((name) =>
        readFile(new URL(`../dist/features/${name}.js`, import.meta.url), 'utf8')
      )
    )
    const declarationTexts = await Promise.all(
      featureNames.map((name) =>
        readFile(new URL(`../dist/features/${name}.d.ts`, import.meta.url), 'utf8')
      )
    )
    const packageJson = JSON.parse(
      await readFile(new URL('../package.json', import.meta.url), 'utf8')
    ) as { readonly exports: Readonly<Record<string, unknown>> }
    for (const text of [
      ...sourceTexts.slice(0, 3),
      ...runtimeTexts.slice(0, 3),
      ...declarationTexts.slice(0, 3)
    ])
      expect(text).not.toContain('outboundCompatibility')
    expect(sourceTexts[3]).not.toContain('outboundCompatibility')
    expect(runtimeTexts[3]).not.toContain('outboundCompatibility')
    expect(packageJson.exports['./internal/outbound-attachment']).toBeUndefined()
    expect(packageJson.exports['./internal/plugin-shared-keys']).toBeUndefined()
  })

  it('T223 chunk is an explicitly inventoried D95 consumer with canonical assembly ownership', async () => {
    const [clientTransport, serverTransport] = createMemoryTransportPair()
    const server = await createFullEndpoint({
      id: 'r73-chunk-server',
      transport: serverTransport,
      codec: defineJsonCodec({ version: 1 }),
      framer: createStringFramer({ chunkBytes: 4 }),
      middlewares: [connect({ transport: serverTransport })],
      provider: { echo: (context) => context.success(context.data) }
    })
    const client = await createFullEndpoint({
      id: 'r73-chunk-client',
      targetIds: ['r73-chunk-server'],
      transport: clientTransport,
      codec: defineJsonCodec({ version: 1 }),
      framer: createStringFramer({ chunkBytes: 4 }),
      middlewares: [connect({ transport: clientTransport })]
    })
    try {
      expect(client.send).toBeTypeOf('function')
      await expect(
        client.send('r73-chunk-server', 'echo', 'r73-non-empty-framed-payload-😀')
      ).resolves.toBe('r73-non-empty-framed-payload-😀')
      expect(readEndpointDebugSnapshot(client)).toMatchObject({
        resources: expect.any(Number),
        phase: 'active'
      })
      expect(readEndpointDebugSnapshot(server)).toMatchObject({ phase: 'active' })
      const dispose = client.dispose()
      expect(client.dispose()).toBe(dispose)
      await dispose
      expect(readEndpointDebugSnapshot(client)).toMatchObject({
        resources: 0,
        phase: 'disposed'
      })
      const serverDispose = server.dispose()
      expect(server.dispose()).toBe(serverDispose)
      await serverDispose
      expect(readEndpointDebugSnapshot(server)).toMatchObject({
        resources: 0,
        phase: 'disposed'
      })
    } finally {
      await client.dispose()
      await server.dispose()
    }
  })

  it('T224 superseded copied bridge injection has no surviving shared-key seam', () => {
    assertNoRemovedD95Key(Reflect.ownKeys(WebRpcSharedKey))
  })

  it('T225 superseded hostile bridge injection has no surviving publisher descriptor seam', async () => {
    const fixture = await createActualAdmissionFixture({
      endpointId: 'r73-final-publisher'
    })
    try {
      for (const descriptor of fixture.descriptors) {
        assertNoRemovedD95Key([
          ...(descriptor.sharedProvides ?? []),
          ...(descriptor.sharedConsumes ?? []),
          ...(descriptor.sharedOptionalConsumes ?? [])
        ])
        assertNoRemovedD95Key(Reflect.ownKeys(descriptor.claims))
      }
    } finally {
      await fixture.dispose().catch(() => undefined)
    }
  })

  it('T226 terminal disposal leaves no D95 compatibility installation', async () => {
    const fixture = await createActualAdmissionFixture({
      endpointId: 'r73-final-terminal'
    })
    try {
      await fixture.install()
      expect(fixture.getTranslatedInstallation('outbound-compatibility')).toBeUndefined()
      const firstDispose = fixture.host.dispose()
      expect(fixture.host.dispose()).toBe(firstDispose)
      await firstDispose
      expect(fixture.getTranslatedInstallation('outbound-compatibility')).toBeUndefined()
    } finally {
      await fixture.dispose().catch(() => undefined)
    }
  })

  it('T232 Host disposal removes all final outbound compatibility residue', async () => {
    const fixture = await createActualAdmissionFixture({
      endpointId: 'r73-result-disposal'
    })
    try {
      await fixture.install()
      expect(fixture.getTranslatedInstallation('outbound-compatibility')).toBeUndefined()
      const firstDispose = fixture.host.dispose()
      expect(fixture.host.dispose()).toBe(firstDispose)
      await firstDispose
      const terminal = fixture.snapshot()
      expect({
        sharedEmpty: terminal.shared.every((value) => value === undefined),
        extensionsEmpty: terminal.extensions.every((value) => value === undefined),
        installationsClear: terminal.installations.every(({ installed }) => !installed),
        activeSubscriptions: terminal.activeSubscriptions,
        kernelState: terminal.kernelState,
        kernelOwners: terminal.kernelOwners,
        kernelRoutes: terminal.kernelRoutes,
        resources: terminal.resources
      }).toEqual({
        sharedEmpty: true,
        extensionsEmpty: true,
        installationsClear: true,
        activeSubscriptions: 0,
        kernelState: 'disposed',
        kernelOwners: [],
        kernelRoutes: [],
        resources: 0
      })
    } finally {
      await fixture.dispose().catch(() => undefined)
    }
  })

  it('T227 superseded replacement injection has no translator normalization seam', async () => {
    const texts = await readFinalD95BoundaryTexts()
    for (const text of texts) {
      expect(text).not.toContain('createOutboundCompatibilityPort')
      expect(text).not.toContain('normalizeOutboundCompatibilityPort')
      expect(text).not.toContain('IWebRpcOutboundCompatibilityPort')
    }
  })

  it('T228 superseded missing-member injection has no internal export seam', async () => {
    const packageJson = JSON.parse(
      await readFile(new URL('../package.json', import.meta.url), 'utf8')
    ) as { readonly exports: Readonly<Record<string, unknown>> }
    expect(Object.keys(packageJson.exports).filter((key) => key.startsWith('./internal/'))).toEqual(
      []
    )
  })

  it('T229 superseded reordered injection has no runtime or declaration seam', async () => {
    const texts = await readFinalD95BoundaryTexts()
    for (const text of texts) {
      expect(text).not.toContain('outboundCompatibility')
    }
  })

  it('T230 superseded prototype injection has no packed deep-import seam', async () => {
    const packageJson = JSON.parse(
      await readFile(new URL('../package.json', import.meta.url), 'utf8')
    ) as { readonly exports: Readonly<Record<string, unknown>> }
    expect(Object.keys(packageJson.exports)).not.toContain('./internal/outbound-attachment')
    expect(Object.keys(packageJson.exports)).not.toContain('./internal/plugin-shared-keys')
  })

  it('T231 cross-endpoint final composition has no compatibility publication', async () => {
    const owner = await createActualAdmissionFixture({
      endpointId: 'r73-cross-owner'
    })
    let fixture: IActualAdmissionFixture | undefined
    try {
      await owner.install()
      expect(owner.getTranslatedInstallation('outbound-compatibility')).toBeUndefined()
      fixture = await createActualAdmissionFixture({
        endpointId: 'r73-cross-consumer'
      })
      await assertMigratedControlIgnoresD95(fixture)
      const ownerDispose = owner.host.dispose()
      const repeatedOwnerDispose = owner.host.dispose()
      let ownerDisposalFailure: unknown
      try {
        await ownerDispose
      } catch (error) {
        ownerDisposalFailure = error
      }
      expect({
        ownerDisposeStable: repeatedOwnerDispose === ownerDispose,
        ownerDisposalFailure,
        ownerTerminal: projectD95TerminalSnapshot(owner.snapshot())
      }).toEqual({
        ownerDisposeStable: true,
        ownerDisposalFailure: undefined,
        ownerTerminal: {
          hostKeys: [],
          sharedEmpty: true,
          extensionsEmpty: true,
          installationsClear: true,
          activeSubscriptions: 0,
          activated: false,
          providerState: { admission: 0, replay: 0, activeControllers: 0 },
          kernelState: 'disposed',
          kernelOwners: [],
          kernelRoutes: [],
          resources: 0
        }
      })
    } finally {
      await fixture?.dispose().catch(() => undefined)
      await owner.dispose().catch(() => undefined)
    }
  })

  it('T295 final D95 mapping audit rejects stale bridge-injection claims', async () => {
    const document = await readFile(
      new URL(
        '../../../docs/web-rpc/endpoint-feature-composition-continuation.sdd.md',
        import.meta.url
      ),
      'utf8'
    )
    for (const testId of [
      'T219',
      'T220',
      'T222',
      'T223',
      'T224',
      'T225',
      'T227',
      'T228',
      'T229',
      'T230'
    ]) {
      const row = document.split('\n').find((line) => line.includes(`WRC-C-${testId} |`))
      expect(row).toBeDefined()
      expect(row).toContain('superseded')
      expect(row).toContain('final deletion')
      expect(row).not.toContain('intentional RED')
    }
    const requirementRow = document.split('\n').find((line) => line.startsWith('| R73 |'))
    expect(requirementRow).toContain('T295')
    expect(requirementRow).toContain('historical')
    expect(requirementRow).toContain('superseded')
    for (const evidenceId of ['T220', 'T221', 'T267', 'T275'])
      expect(requirementRow).toContain(evidenceId)
  })

  it('T131 provider cancellation reuses the existing verified abort path and releases terminal state', async () => {
    const [clientTransport, serverTransport] = createMemoryTransportPair()
    let started!: () => void
    let release!: () => void
    const startedPromise = new Promise<void>((resolve) => {
      started = resolve
    })
    const server = await createRealProvider(
      'provider-cancellation-owner',
      serverTransport,
      {
        wait: async (context) => {
          started()
          await new Promise<void>((resolve) => {
            release = resolve
            context.signal.addEventListener('abort', resolve, { once: true })
          })
          return context.success('late')
        }
      },
      true
    )
    const client = await createClientEndpoint({
      id: 'provider-cancellation-client',
      transport: clientTransport,
      targetIds: ['provider-cancellation-owner'],
      middlewares: [connect({ transport: clientTransport }), abort()]
    })
    try {
      const controller = new AbortController()
      const pending = client.send('provider-cancellation-owner', 'wait', null, {
        signal: controller.signal,
        timeoutMs: false
      })
      await startedPromise
      const reason = new Error('cancelled')
      controller.abort(reason)
      controller.abort(reason)
      await expect(pending).rejects.toMatchObject({ cause: reason })
      release()
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(readEndpointDebugSnapshot(server)?.activeControllers).toBe(0)
      expect(readEndpointDebugSnapshot(server)?.providers).toBe(1)
    } finally {
      await client.dispose()
      await server.dispose()
    }
  })

  it('T195 providerCancellation publishes one frozen endpoint-local abort port', async () => {
    const first = await createActualAdmissionFixture({ endpointId: 'r71-port-first' })
    const second = await createActualAdmissionFixture({ endpointId: 'r71-port-second' })
    try {
      await Promise.all([first.install(), second.install()])
      const firstPort = first.host.getShared(WebRpcSharedKey.providerCancellation) as
        | IWebRpcProviderCancellationPort
        | undefined
      const secondPort = second.host.getShared(WebRpcSharedKey.providerCancellation) as
        | IWebRpcProviderCancellationPort
        | undefined
      expect(firstPort).toBeDefined()
      expect(secondPort).toBeDefined()
      expect(firstPort).not.toBe(secondPort)
      expect(Object.isFrozen(firstPort)).toBe(true)
      expect(Reflect.ownKeys(firstPort!)).toEqual(['abort'])
      expect(Object.getOwnPropertyDescriptor(firstPort, 'abort')).toEqual({
        value: firstPort?.abort,
        enumerable: true,
        configurable: false,
        writable: false
      })
      expect(firstPort?.abort).toBeTypeOf('function')
      expect(firstPort?.abort('unknown-r71-task')).toBeUndefined()
      expect(first.snapshot().providerState).toEqual({
        admission: 0,
        replay: 0,
        activeControllers: 0
      })
      expect(second.snapshot().providerState).toEqual({
        admission: 0,
        replay: 0,
        activeControllers: 0
      })
    } finally {
      await Promise.all([first.dispose(), second.dispose()])
    }
  })

  it('T196 providerCancellation aborts an active Host-installed task by task id', async () => {
    let started!: () => void
    let observedAbort!: () => void
    let observedAborts = 0
    const startedPromise = new Promise<void>((resolve) => {
      started = resolve
    })
    const abortedPromise = new Promise<void>((resolve) => {
      observedAbort = resolve
    })
    const fixture = await createActualAdmissionFixture({
      endpointId: 'r71-active-task',
      providerMap: {
        wait: async (context) => {
          started()
          await new Promise<void>((resolve) => {
            context.signal.addEventListener(
              'abort',
              () => {
                observedAborts += 1
                observedAbort()
                resolve()
              },
              { once: true }
            )
          })
          return context.success('late')
        }
      }
    })
    try {
      await fixture.install()
      const cancellation = fixture.host.getShared(WebRpcSharedKey.providerCancellation) as
        | IWebRpcProviderCancellationPort
        | undefined
      expect(cancellation).toBeDefined()
      const taskId = 'r71-active-task-id'
      void fixture.clientTransport.send(
        createProviderRequest(taskId, {
          receiverId: 'r71-active-task',
          targetId: 'r71-active-task',
          method: 'wait'
        })
      )
      await startedPromise
      expect(fixture.snapshot().providerState.activeControllers).toBe(1)
      expect(cancellation?.abort(taskId)).toBeUndefined()
      expect(cancellation?.abort(taskId)).toBeUndefined()
      await abortedPromise
      await settleProviderDelivery()
      expect(observedAborts).toBe(1)
      expect(fixture.snapshot().providerState).toEqual({
        admission: 0,
        replay: 1,
        activeControllers: 0
      })
      const hostDispose = fixture.host.dispose()
      expect(fixture.host.dispose()).toBe(hostDispose)
      await hostDispose
      const terminal = fixture.snapshot()
      expect(terminal).toMatchObject({
        activeSubscriptions: 0,
        providerState: { admission: 0, replay: 0, activeControllers: 0 },
        kernelState: 'disposed',
        kernelOwners: [],
        kernelRoutes: [],
        resources: 0
      })
      expect(terminal.shared.every((value) => value === undefined)).toBe(true)
      expect(terminal.extensions.every((value) => value === undefined)).toBe(true)
      expect(
        terminal.installations.every(
          ({ installed, extensionKeys, sharedKeys }) =>
            !installed && extensionKeys.length === 0 && sharedKeys.length === 0
        )
      ).toBe(true)
    } finally {
      await fixture.dispose()
    }
  })

  it('T197 providerCancellation rejects cross-endpoint task control and isolates release', async () => {
    const makeFixture = async (endpointId: string, started: () => void, aborted: () => void) =>
      createActualAdmissionFixture({
        endpointId,
        providerMap: {
          wait: async (context) => {
            started()
            await new Promise<void>((resolve) => {
              context.signal.addEventListener(
                'abort',
                () => {
                  aborted()
                  resolve()
                },
                { once: true }
              )
            })
            return context.success(endpointId)
          }
        }
      })
    let firstStarted!: () => void
    let secondStarted!: () => void
    let firstAborted!: () => void
    let secondAborted!: () => void
    const firstStartedPromise = new Promise<void>((resolve) => {
      firstStarted = resolve
    })
    const secondStartedPromise = new Promise<void>((resolve) => {
      secondStarted = resolve
    })
    const firstAbortedPromise = new Promise<void>((resolve) => {
      firstAborted = resolve
    })
    const secondAbortedPromise = new Promise<void>((resolve) => {
      secondAborted = resolve
    })
    const [first, second] = await Promise.all([
      makeFixture('r71-isolation-first', firstStarted, firstAborted),
      makeFixture('r71-isolation-second', secondStarted, secondAborted)
    ])
    try {
      await Promise.all([first.install(), second.install()])
      const firstPort = first.host.getShared(WebRpcSharedKey.providerCancellation) as
        | IWebRpcProviderCancellationPort
        | undefined
      const secondPort = second.host.getShared(WebRpcSharedKey.providerCancellation) as
        | IWebRpcProviderCancellationPort
        | undefined
      expect(firstPort).toBeDefined()
      expect(secondPort).toBeDefined()
      const taskId = 'same-r71-task'
      void first.clientTransport.send(
        createProviderRequest(taskId, {
          receiverId: 'r71-isolation-first',
          targetId: 'r71-isolation-first',
          method: 'wait'
        })
      )
      void second.clientTransport.send(
        createProviderRequest(taskId, {
          receiverId: 'r71-isolation-second',
          targetId: 'r71-isolation-second',
          method: 'wait'
        })
      )
      await Promise.all([firstStartedPromise, secondStartedPromise])
      firstPort?.abort(taskId)
      await firstAbortedPromise
      expect(second.snapshot().providerState.activeControllers).toBe(1)
      secondPort?.abort(taskId)
      await secondAbortedPromise
      await settleProviderDelivery()
      expect(first.snapshot().providerState.activeControllers).toBe(0)
      expect(second.snapshot().providerState.activeControllers).toBe(0)
    } finally {
      await Promise.all([first.dispose(), second.dispose()])
    }
  })

  it('T199 providerCancellation before registration is a no-op with no owner-state allocation', async () => {
    let executions = 0
    const fixture = await createActualAdmissionFixture({
      endpointId: 'r71-before-registration',
      providerMap: {
        echo: (context) => {
          executions += 1
          return context.success('registered-after-cancel')
        }
      }
    })
    try {
      await fixture.install()
      const cancellation = fixture.host.getShared(WebRpcSharedKey.providerCancellation) as
        | IWebRpcProviderCancellationPort
        | undefined
      cancellation?.abort('r71-before-registration-task')
      await fixture.clientTransport.send(
        createProviderRequest('r71-before-registration-task', {
          receiverId: 'r71-before-registration',
          targetId: 'r71-before-registration'
        })
      )
      await settleProviderDelivery()
      expect(executions).toBe(1)
      expect(fixture.snapshot().providerState).toEqual({
        admission: 0,
        replay: 1,
        activeControllers: 0
      })
    } finally {
      await fixture.dispose()
    }
  })

  it('T200 providerCancellation after completion is idempotent and preserves Host disposal identity', async () => {
    const fixture = await createActualAdmissionFixture({ endpointId: 'r71-after-completion' })
    try {
      await fixture.install()
      const cancellation = fixture.host.getShared(WebRpcSharedKey.providerCancellation) as
        | IWebRpcProviderCancellationPort
        | undefined
      const taskId = 'r71-after-completion-task'
      await fixture.clientTransport.send(
        createProviderRequest(taskId, {
          receiverId: 'r71-after-completion',
          targetId: 'r71-after-completion'
        })
      )
      await settleProviderDelivery()
      cancellation?.abort(taskId)
      cancellation?.abort(taskId)
      expect(fixture.snapshot().providerState).toEqual({
        admission: 0,
        replay: 1,
        activeControllers: 0
      })
      const hostDispose = fixture.host.dispose()
      expect(fixture.host.dispose()).toBe(hostDispose)
      await hostDispose
      const terminal = fixture.snapshot()
      expect(terminal).toMatchObject({
        activeSubscriptions: 0,
        providerState: { admission: 0, replay: 0, activeControllers: 0 },
        kernelState: 'disposed',
        kernelOwners: [],
        kernelRoutes: [],
        resources: 0
      })
      expect(terminal.shared.every((value) => value === undefined)).toBe(true)
      expect(terminal.extensions.every((value) => value === undefined)).toBe(true)
      expect(
        terminal.installations.every(
          ({ installed, extensionKeys, sharedKeys }) =>
            !installed && extensionKeys.length === 0 && sharedKeys.length === 0
        )
      ).toBe(true)
    } finally {
      await fixture.dispose()
    }
  })

  it('T201 repeated same-tick providerCancellation aborts one controller exactly once', async () => {
    let started!: () => void
    let notifyAbort!: () => void
    let observedAborts = 0
    const startedPromise = new Promise<void>((resolve) => {
      started = resolve
    })
    const abortedPromise = new Promise<void>((resolve) => {
      notifyAbort = (): void => {
        observedAborts += 1
        resolve()
      }
    })
    const fixture = await createActualAdmissionFixture({
      endpointId: 'r71-same-tick',
      providerMap: {
        wait: async (context) => {
          started()
          await new Promise<void>((resolve) => {
            context.signal.addEventListener(
              'abort',
              () => {
                notifyAbort()
                resolve()
              },
              { once: true }
            )
          })
          return context.success('expired')
        }
      }
    })
    try {
      await fixture.install()
      const cancellation = fixture.host.getShared(WebRpcSharedKey.providerCancellation) as
        | IWebRpcProviderCancellationPort
        | undefined
      const taskId = 'r71-same-tick-task'
      void fixture.clientTransport.send(
        createProviderRequest(taskId, {
          receiverId: 'r71-same-tick',
          targetId: 'r71-same-tick',
          method: 'wait'
        })
      )
      await startedPromise
      cancellation?.abort(taskId)
      cancellation?.abort(taskId)
      await abortedPromise
      await settleProviderDelivery()
      expect(observedAborts).toBe(1)
      expect(fixture.snapshot().providerState).toEqual({
        admission: 0,
        replay: 1,
        activeControllers: 0
      })
      const hostDispose = fixture.host.dispose()
      expect(fixture.host.dispose()).toBe(hostDispose)
      await hostDispose
      const terminal = fixture.snapshot()
      expect(terminal).toMatchObject({
        activeSubscriptions: 0,
        providerState: { admission: 0, replay: 0, activeControllers: 0 },
        kernelState: 'disposed',
        kernelOwners: [],
        kernelRoutes: [],
        resources: 0
      })
      expect(terminal.shared.every((value) => value === undefined)).toBe(true)
      expect(terminal.extensions.every((value) => value === undefined)).toBe(true)
      expect(
        terminal.installations.every(
          ({ installed, extensionKeys, sharedKeys }) =>
            !installed && extensionKeys.length === 0 && sharedKeys.length === 0
        )
      ).toBe(true)
    } finally {
      await fixture.dispose()
    }
  })

  it('T202 providerCancellation late resolve emits no response and releases canonical state', async () => {
    let started!: () => void
    let release!: () => void
    const startedPromise = new Promise<void>((resolve) => {
      started = resolve
    })
    const releasePromise = new Promise<void>((resolve) => {
      release = resolve
    })
    const observations: IWebRpcOutboundCommandObservation[] = []
    const fixture = await createActualAdmissionFixture({
      endpointId: 'r71-late-resolve',
      observeOutboundCommand: (observation) => observations.push(observation),
      providerMap: {
        wait: async (context) => {
          started()
          await new Promise<void>((resolve) => {
            context.signal.addEventListener('abort', resolve, { once: true })
          })
          await releasePromise
          return context.success('late-success')
        }
      }
    })
    const messages: unknown[] = []
    const unsubscribe = fixture.clientTransport.subscribe(({ data }) => messages.push(data))
    try {
      await fixture.install()
      const cancellation = fixture.host.getShared(WebRpcSharedKey.providerCancellation) as
        | IWebRpcProviderCancellationPort
        | undefined
      const taskId = 'r71-late-resolve-task'
      void fixture.clientTransport.send(
        createProviderRequest(taskId, {
          receiverId: 'r71-late-resolve',
          targetId: 'r71-late-resolve',
          method: 'wait'
        })
      )
      await startedPromise
      cancellation?.abort(taskId)
      release()
      await settleProviderDelivery()
      await settleProviderDelivery()
      expect(
        messages.filter(
          (message) =>
            (message as { readonly kind?: unknown }).kind === 'response' &&
            (message as { readonly taskId?: unknown }).taskId === taskId
        )
      ).toHaveLength(0)
      expect(observations.filter(({ command }) => command.kind === 'report')).toHaveLength(0)
      expect(fixture.snapshot().providerState).toEqual({
        admission: 0,
        replay: 1,
        activeControllers: 0
      })
      const hostDispose = fixture.host.dispose()
      expect(fixture.host.dispose()).toBe(hostDispose)
      await hostDispose
      const terminal = fixture.snapshot()
      expect(terminal).toMatchObject({
        activeSubscriptions: 0,
        providerState: { admission: 0, replay: 0, activeControllers: 0 },
        kernelState: 'disposed',
        kernelOwners: [],
        kernelRoutes: [],
        resources: 0
      })
      expect(terminal.shared.every((value) => value === undefined)).toBe(true)
      expect(terminal.extensions.every((value) => value === undefined)).toBe(true)
      expect(
        terminal.installations.every(
          ({ installed, extensionKeys, sharedKeys }) =>
            !installed && extensionKeys.length === 0 && sharedKeys.length === 0
        )
      ).toBe(true)
    } finally {
      unsubscribe()
      await fixture.dispose()
    }
  })

  it('T203 providerCancellation late reject reports the raw error without a second response', async () => {
    const latePrimary = new Error('r71 late rejection')
    let started!: () => void
    let rejectLate!: (error: unknown) => void
    const startedPromise = new Promise<void>((resolve) => {
      started = resolve
    })
    const lateResult = new Promise<never>((_resolve, reject) => {
      rejectLate = reject
    })
    const observations: IWebRpcOutboundCommandObservation[] = []
    const fixture = await createActualAdmissionFixture({
      endpointId: 'r71-late-reject',
      observeOutboundCommand: (observation) => observations.push(observation),
      providerMap: {
        wait: async (context) => {
          started()
          await new Promise<void>((resolve) => {
            context.signal.addEventListener('abort', resolve, { once: true })
          })
          await lateResult
          return context.success('unreachable')
        }
      }
    })
    const messages: unknown[] = []
    const unsubscribe = fixture.clientTransport.subscribe(({ data }) => messages.push(data))
    try {
      await fixture.install()
      const cancellation = fixture.host.getShared(WebRpcSharedKey.providerCancellation) as
        | IWebRpcProviderCancellationPort
        | undefined
      const taskId = 'r71-late-reject-task'
      void fixture.clientTransport.send(
        createProviderRequest(taskId, {
          receiverId: 'r71-late-reject',
          targetId: 'r71-late-reject',
          method: 'wait'
        })
      )
      await startedPromise
      cancellation?.abort(taskId)
      rejectLate(latePrimary)
      await settleProviderDelivery()
      await settleProviderDelivery()
      const reports = observations.filter(({ command }) => command.kind === 'report')
      expect(reports).toHaveLength(1)
      expect(reports[0]?.command).toEqual({
        error: latePrimary,
        kind: 'report',
        code: WebRpcErrorCode.internal
      })
      expect(
        messages.filter(
          (message) =>
            (message as { readonly kind?: unknown }).kind === 'response' &&
            (message as { readonly taskId?: unknown }).taskId === taskId
        )
      ).toHaveLength(0)
      expect(fixture.snapshot().providerState).toEqual({
        admission: 0,
        replay: 1,
        activeControllers: 0
      })
      const hostDispose = fixture.host.dispose()
      expect(fixture.host.dispose()).toBe(hostDispose)
      await hostDispose
      const terminal = fixture.snapshot()
      expect(terminal).toMatchObject({
        activeSubscriptions: 0,
        providerState: { admission: 0, replay: 0, activeControllers: 0 },
        kernelState: 'disposed',
        kernelOwners: [],
        kernelRoutes: [],
        resources: 0
      })
      expect(terminal.shared.every((value) => value === undefined)).toBe(true)
      expect(terminal.extensions.every((value) => value === undefined)).toBe(true)
      expect(
        terminal.installations.every(
          ({ installed, extensionKeys, sharedKeys }) =>
            !installed && extensionKeys.length === 0 && sharedKeys.length === 0
        )
      ).toBe(true)
    } finally {
      unsubscribe()
      await fixture.dispose()
    }
  })

  it('T204 caller primitive abort reason remains exact on the endpoint-owned path', async () => {
    const [clientTransport, serverTransport] = createMemoryTransportPair()
    let started!: () => void
    const startedPromise = new Promise<void>((resolve) => {
      started = resolve
    })
    const server = await createRealProvider(
      'r71-primitive-reason-host',
      serverTransport,
      {
        wait: async (context) => {
          started()
          await new Promise<void>((resolve) => {
            context.signal.addEventListener('abort', resolve, { once: true })
          })
          return context.success('late')
        }
      },
      true
    )
    const client = await createClientEndpoint({
      id: 'r71-primitive-reason-client',
      transport: clientTransport,
      targetIds: ['r71-primitive-reason-host'],
      middlewares: [connect({ transport: clientTransport }), abort()]
    })
    try {
      const controller = new AbortController()
      const reason = 'primitive-r71-reason'
      const pending = client.send('r71-primitive-reason-host', 'wait', null, {
        signal: controller.signal,
        timeoutMs: false
      })
      await startedPromise
      controller.abort(reason)
      await expect(pending).rejects.toMatchObject({ cause: reason })
      await settleProviderDelivery()
      expect(readEndpointDebugSnapshot(server)?.activeControllers).toBe(0)
    } finally {
      const clientDispose = client.dispose()
      expect(client.dispose()).toBe(clientDispose)
      await clientDispose
      const serverDispose = server.dispose()
      expect(server.dispose()).toBe(serverDispose)
      await serverDispose
    }
  })

  it('T205 forged non-string providerCancellation ids are fail-closed', async () => {
    const fixture = await createActualAdmissionFixture({ endpointId: 'r71-forged-id' })
    try {
      await fixture.install()
      const cancellation = fixture.host.getShared(WebRpcSharedKey.providerCancellation) as
        | IWebRpcProviderCancellationPort
        | undefined
      const before = fixture.snapshot().providerState
      const invoke = cancellation?.abort as unknown as (id: unknown) => void
      invoke(Symbol('forged-r71-id'))
      invoke({ forged: true })
      expect(fixture.snapshot().providerState).toEqual(before)
    } finally {
      await fixture.dispose()
    }
  })

  it('T206 real provider completion releases one identity admission lease before terminal disposal', async () => {
    const fixture = await createActualAdmissionFixture({ endpointId: 'r71-identity-complete' })
    try {
      await fixture.install()
      const observation = registerFixtureIdentityReleaseObservation(fixture)
      try {
        expect(observation.read()).toBe(0)
        void fixture.clientTransport.send(
          createProviderRequest('r71-identity-complete-task', {
            receiverId: 'r71-identity-complete',
            targetId: 'r71-identity-complete'
          })
        )
        await settleProviderDelivery()
        await settleProviderDelivery()
        expect(observation.read()).toBe(1)
        expect(fixture.snapshot().providerState).toEqual({
          admission: 0,
          replay: 1,
          activeControllers: 0
        })
        expect(fixture.snapshot().kernelState).toBe('active')
        const hostDispose = fixture.host.dispose()
        expect(fixture.host.dispose()).toBe(hostDispose)
        await hostDispose
        expect(observation.read()).toBe(1)
        const terminal = fixture.snapshot()
        expect(terminal).toMatchObject({
          activeSubscriptions: 0,
          providerState: { admission: 0, replay: 0, activeControllers: 0 },
          kernelState: 'disposed',
          kernelOwners: [],
          kernelRoutes: [],
          resources: 0
        })
        expect(terminal.shared.every((value) => value === undefined)).toBe(true)
        expect(terminal.extensions.every((value) => value === undefined)).toBe(true)
        expect(
          terminal.installations.every(
            ({ installed, extensionKeys, sharedKeys }) =>
              !installed && extensionKeys.length === 0 && sharedKeys.length === 0
          )
        ).toBe(true)
      } finally {
        observation.unregister()
      }
    } finally {
      await fixture.dispose()
    }
  })

  it('T207 repeated shared-port cancellation and late settlement release one identity lease', async () => {
    let started!: () => void
    let release!: () => void
    const startedPromise = new Promise<void>((resolve) => {
      started = resolve
    })
    const releasePromise = new Promise<void>((resolve) => {
      release = resolve
    })
    const fixture = await createActualAdmissionFixture({
      endpointId: 'r71-identity-late',
      providerMap: {
        wait: async (context) => {
          started()
          await new Promise<void>((resolve) => {
            context.signal.addEventListener('abort', resolve, { once: true })
          })
          await releasePromise
          return context.success('late-identity')
        }
      }
    })
    try {
      await fixture.install()
      const observation = registerFixtureIdentityReleaseObservation(fixture)
      try {
        const cancellation = fixture.host.getShared(WebRpcSharedKey.providerCancellation) as
          | IWebRpcProviderCancellationPort
          | undefined
        const taskId = 'r71-identity-late-task'
        void fixture.clientTransport.send(
          createProviderRequest(taskId, {
            receiverId: 'r71-identity-late',
            targetId: 'r71-identity-late',
            method: 'wait'
          })
        )
        await startedPromise
        expect(observation.read()).toBe(0)
        cancellation?.abort(taskId)
        cancellation?.abort(taskId)
        release()
        await settleProviderDelivery()
        await settleProviderDelivery()
        expect(observation.read()).toBe(1)
        expect(fixture.snapshot().providerState).toEqual({
          admission: 0,
          replay: 1,
          activeControllers: 0
        })
        const hostDispose = fixture.host.dispose()
        expect(fixture.host.dispose()).toBe(hostDispose)
        await hostDispose
        expect(observation.read()).toBe(1)
        expect(fixture.snapshot()).toMatchObject({
          activeSubscriptions: 0,
          providerState: { admission: 0, replay: 0, activeControllers: 0 },
          kernelState: 'disposed',
          kernelOwners: [],
          kernelRoutes: [],
          resources: 0
        })
        const terminal = fixture.snapshot()
        expect(terminal.shared.every((value) => value === undefined)).toBe(true)
        expect(terminal.extensions.every((value) => value === undefined)).toBe(true)
        expect(
          terminal.installations.every(
            ({ installed, extensionKeys, sharedKeys }) =>
              !installed && extensionKeys.length === 0 && sharedKeys.length === 0
          )
        ).toBe(true)
      } finally {
        observation.unregister()
      }
    } finally {
      await fixture.dispose()
    }
  })

  it('T208 provider failure releases one identity admission lease and preserves the raw report', async () => {
    const failure = new Error('r71 identity failure')
    const observations: IWebRpcOutboundCommandObservation[] = []
    const fixture = await createActualAdmissionFixture({
      endpointId: 'r71-identity-failure',
      observeOutboundCommand: (observation) => observations.push(observation),
      providerMap: {
        fail: () => {
          throw failure
        }
      }
    })
    try {
      await fixture.install()
      const observation = registerFixtureIdentityReleaseObservation(fixture)
      try {
        expect(observation.read()).toBe(0)
        void fixture.clientTransport.send(
          createProviderRequest('r71-identity-failure-task', {
            receiverId: 'r71-identity-failure',
            targetId: 'r71-identity-failure',
            method: 'fail'
          })
        )
        await settleProviderDelivery()
        await settleProviderDelivery()
        expect(observation.read()).toBe(1)
        expect(observations.filter(({ command }) => command.kind === 'report')).toHaveLength(1)
        expect(observations.find(({ command }) => command.kind === 'report')?.command).toEqual({
          error: failure,
          kind: 'report',
          code: WebRpcErrorCode.internal
        })
        expect(fixture.snapshot().providerState).toEqual({
          admission: 0,
          replay: 1,
          activeControllers: 0
        })
        const hostDispose = fixture.host.dispose()
        expect(fixture.host.dispose()).toBe(hostDispose)
        await hostDispose
        expect(observation.read()).toBe(1)
        expect(fixture.snapshot()).toMatchObject({
          activeSubscriptions: 0,
          providerState: { admission: 0, replay: 0, activeControllers: 0 },
          kernelState: 'disposed',
          kernelOwners: [],
          kernelRoutes: [],
          resources: 0
        })
        const terminal = fixture.snapshot()
        expect(terminal.shared.every((value) => value === undefined)).toBe(true)
        expect(terminal.extensions.every((value) => value === undefined)).toBe(true)
        expect(
          terminal.installations.every(
            ({ installed, extensionKeys, sharedKeys }) =>
              !installed && extensionKeys.length === 0 && sharedKeys.length === 0
          )
        ).toBe(true)
      } finally {
        observation.unregister()
      }
    } finally {
      await fixture.dispose()
    }
  })

  it('T209 identity-release observation is isolated, non-forgeable, and non-interfering', async () => {
    const [first, second] = await Promise.all([
      createActualAdmissionFixture({ endpointId: 'r71-identity-first' }),
      createActualAdmissionFixture({ endpointId: 'r71-identity-second' })
    ])
    try {
      await Promise.all([first.install(), second.install()])
      const firstIdentity = first.getIdentityOwner()
      const secondIdentity = second.getIdentityOwner()
      expect(firstIdentity).toBeDefined()
      expect(secondIdentity).toBeDefined()
      const before = first.snapshot()
      const unregister = registerInboundIdentityReleaseObservation(firstIdentity!)
      try {
        expect(readInboundIdentityReleaseObservation(firstIdentity)).toBe(0)
        expect(readInboundIdentityReleaseObservation(secondIdentity)).toBeUndefined()
        expect(readInboundIdentityReleaseObservation({})).toBeUndefined()
        expect(
          readInboundIdentityReleaseObservation(Object.assign({}, firstIdentity))
        ).toBeUndefined()
        expect(readInboundIdentityReleaseObservation(new Proxy(firstIdentity!, {}))).toBeUndefined()
        expect(readInboundIdentityReleaseObservation(Object.create(firstIdentity!))).toBeUndefined()
        expect(first.snapshot()).toEqual(before)
        expect(first.snapshot().kernelState).toBe('active')
      } finally {
        unregister()
      }
      expect(readInboundIdentityReleaseObservation(firstIdentity)).toBeUndefined()
      expect(first.snapshot()).toEqual(before)
    } finally {
      await Promise.all([first.dispose(), second.dispose()])
    }
  })

  it('T210 duplicate identity observation registration uses tokens and unregisters fail-closed', async () => {
    const fixture = await createActualAdmissionFixture({ endpointId: 'r71-identity-token' })
    try {
      await fixture.install()
      const identity = fixture.getIdentityOwner()
      expect(identity).toBeDefined()
      const firstUnregister = registerInboundIdentityReleaseObservation(identity!)
      const secondUnregister = registerInboundIdentityReleaseObservation(identity!)
      try {
        firstUnregister()
        expect(readInboundIdentityReleaseObservation(identity)).toBe(0)
        void fixture.clientTransport.send(
          createProviderRequest('r71-identity-token-task', {
            receiverId: 'r71-identity-token',
            targetId: 'r71-identity-token'
          })
        )
        await settleProviderDelivery()
        await settleProviderDelivery()
        expect(readInboundIdentityReleaseObservation(identity)).toBe(1)
      } finally {
        secondUnregister()
      }
      expect(readInboundIdentityReleaseObservation(identity)).toBeUndefined()
      const hostDispose = fixture.host.dispose()
      expect(fixture.host.dispose()).toBe(hostDispose)
      await hostDispose
    } finally {
      await fixture.dispose()
    }
  })

  it('T211 built declarations and package exports hide the identity observer callables', async () => {
    const declaration = await readFile(
      new URL('../dist/internal/test-observer.d.ts', import.meta.url),
      'utf8'
    )
    const rootDeclaration = await readFile(new URL('../dist/index.d.ts', import.meta.url), 'utf8')
    const fullDeclaration = await readFile(new URL('../dist/full.d.ts', import.meta.url), 'utf8')
    const packageJson = JSON.parse(
      await readFile(new URL('../package.json', import.meta.url), 'utf8')
    ) as { readonly exports: Readonly<Record<string, unknown>> }
    for (const text of [declaration, rootDeclaration, fullDeclaration]) {
      expect(text).not.toContain('registerInboundIdentityReleaseObservation')
      expect(text).not.toContain('recordInboundIdentityRelease')
      expect(text).not.toContain('readInboundIdentityReleaseObservation')
    }
    expect(packageJson.exports['./internal/test-observer']).toBeUndefined()
  })

  it('T132 source scan keeps provider ownership on registry/executor/replay and forbids a second lifecycle owner', async () => {
    const source = await readFile(
      new URL('../src/internal/provider-attachment.ts', import.meta.url),
      'utf8'
    )
    expect(source).toContain('ProviderRegistry')
    expect(source).toContain('ProviderAdmissionRegistry')
    expect(source).toContain('ProviderExecutor')
    expect(source).toContain('RequestReplayLedger')
    expect(source).not.toContain('new WebRpcPluginHost')
    expect(source).not.toContain('new PluginHost')
  })

  it('T133 failed provider installation can retry with a fresh candidate snapshot', async () => {
    const [, failedTransport] = createMemoryTransportPair()
    const failedCause = new Error('failed provider candidate')
    const failedProvider = {} as Record<string, IWebRpcProvider>
    Object.defineProperty(failedProvider, 'failed', {
      enumerable: true,
      get: () => {
        throw failedCause
      }
    })
    await expect(
      createProviderEndpoint({
        id: 'provider-retry-failed',
        transport: failedTransport,
        middlewares: [connect({ transport: failedTransport })],
        provider: failedProvider
      })
    ).rejects.toMatchObject({
      name: 'WebRpcConfigurationError',
      source: '@migaia/web-rpc',
      code: WebRpcErrorCode.invalidConfig,
      cause: failedCause
    })

    const [, retryTransport] = createMemoryTransportPair()
    const retry = await createRealProvider('provider-retry-fresh', retryTransport, {
      fresh: (context) => context.success('fresh')
    })
    try {
      expect(readEndpointDebugSnapshot(retry)?.providers).toBe(1)
    } finally {
      await retry.dispose()
    }
  })

  it('T134 hostile provider-map getter at first position preserves failedName and original cause', async () => {
    const cause = new Error('hostile alpha getter')
    const reads: string[] = []
    const providerMap = {} as Record<string, IWebRpcProvider>
    Object.defineProperty(providerMap, 'alpha', {
      enumerable: true,
      get: () => {
        reads.push('alpha')
        throw cause
      }
    })
    const fixture = await createActualAdmissionFixture({ providerMap })
    try {
      const before = fixture.snapshot()
      let failure: unknown
      try {
        await fixture.install()
      } catch (error) {
        failure = error
      }
      expect(failure).toMatchObject({
        source: '@migaia/plugin-host',
        code: 'PLUGIN_INSTALL_FAILED',
        detail: { failedName: 'endpoint-capabilities' },
        cause: expect.objectContaining({
          name: 'WebRpcConfigurationError',
          source: '@migaia/web-rpc',
          code: WebRpcErrorCode.invalidConfig,
          cause
        })
      })
      expect(reads).toEqual(['alpha'])
      const after = fixture.snapshot()
      expect(before.activeSubscriptions).toBe(0)
      expect(after.activeSubscriptions).toBe(0)
      expect(after.activated).toBe(false)
      expect(after.subscribeCalls).toBe(0)
      expect(after.dispatches).toBe(0)
      expect(after.shared.every((value) => value === undefined)).toBe(true)
      expect(after.extensions.every((descriptor) => descriptor === undefined)).toBe(true)
      expect(
        after.installations.every(
          ({ installed, extensionKeys, sharedKeys }) =>
            !installed && extensionKeys.length === 0 && sharedKeys.length === 0
        )
      ).toBe(true)
      expect(after.kernelState).toBe('disposed')
      expect(after.kernelOwners).toEqual([])
      expect(after.kernelRoutes).toEqual([])
      expect(after.resources).toBe(0)
      const disposePromise = fixture.host.dispose()
      expect(fixture.host.dispose()).toBe(disposePromise)
      await expect(disposePromise).resolves.toMatchObject({
        logicalTerminal: true,
        cleanupComplete: true,
        cleanupErrors: []
      })
      expect(fixture.snapshot()).toEqual(after)
    } finally {
      await fixture.dispose()
    }
  })

  it('T135 hostile provider-map getter at middle position preserves failedName and original cause', async () => {
    const cause = new Error('hostile beta getter')
    const reads: string[] = []
    const providerMap = {} as Record<string, IWebRpcProvider>
    Object.defineProperty(providerMap, 'alpha', {
      enumerable: true,
      get: () => {
        reads.push('alpha')
        return (context: Parameters<IWebRpcProvider>[0]) => context.success('alpha')
      }
    })
    Object.defineProperty(providerMap, 'beta', {
      enumerable: true,
      get: () => {
        reads.push('beta')
        throw cause
      }
    })
    const fixture = await createActualAdmissionFixture({ providerMap })
    try {
      const before = fixture.snapshot()
      let failure: unknown
      try {
        await fixture.install()
      } catch (error) {
        failure = error
      }
      expect(failure).toMatchObject({
        source: '@migaia/plugin-host',
        code: 'PLUGIN_INSTALL_FAILED',
        detail: { failedName: 'endpoint-capabilities' },
        cause: expect.objectContaining({
          name: 'WebRpcConfigurationError',
          source: '@migaia/web-rpc',
          code: WebRpcErrorCode.invalidConfig,
          cause
        })
      })
      expect(reads).toEqual(['alpha', 'beta'])
      const after = fixture.snapshot()
      expect(before.activeSubscriptions).toBe(0)
      expect(after.activeSubscriptions).toBe(0)
      expect(after.activated).toBe(false)
      expect(after.subscribeCalls).toBe(0)
      expect(after.dispatches).toBe(0)
      expect(after.shared.every((value) => value === undefined)).toBe(true)
      expect(after.extensions.every((descriptor) => descriptor === undefined)).toBe(true)
      expect(
        after.installations.every(
          ({ installed, extensionKeys, sharedKeys }) =>
            !installed && extensionKeys.length === 0 && sharedKeys.length === 0
        )
      ).toBe(true)
      expect(after.kernelState).toBe('disposed')
      expect(after.kernelOwners).toEqual([])
      expect(after.kernelRoutes).toEqual([])
      expect(after.resources).toBe(0)
      const disposePromise = fixture.host.dispose()
      expect(fixture.host.dispose()).toBe(disposePromise)
      await expect(disposePromise).resolves.toMatchObject({
        logicalTerminal: true,
        cleanupComplete: true,
        cleanupErrors: []
      })
      expect(fixture.snapshot()).toEqual(after)
    } finally {
      await fixture.dispose()
    }
  })

  it('T136 hostile provider-map getter at last position preserves failedName and original cause', async () => {
    const cause = new Error('hostile gamma getter')
    const reads: string[] = []
    const providerMap = {} as Record<string, IWebRpcProvider>
    Object.defineProperty(providerMap, 'alpha', {
      enumerable: true,
      get: () => {
        reads.push('alpha')
        return (context: Parameters<IWebRpcProvider>[0]) => context.success('alpha')
      }
    })
    Object.defineProperty(providerMap, 'beta', {
      enumerable: true,
      get: () => {
        reads.push('beta')
        return (context: Parameters<IWebRpcProvider>[0]) => context.success('beta')
      }
    })
    Object.defineProperty(providerMap, 'gamma', {
      enumerable: true,
      get: () => {
        reads.push('gamma')
        throw cause
      }
    })
    const fixture = await createActualAdmissionFixture({ providerMap })
    try {
      const before = fixture.snapshot()
      let failure: unknown
      try {
        await fixture.install()
      } catch (error) {
        failure = error
      }
      expect(failure).toMatchObject({
        source: '@migaia/plugin-host',
        code: 'PLUGIN_INSTALL_FAILED',
        detail: { failedName: 'endpoint-capabilities' },
        cause: expect.objectContaining({
          name: 'WebRpcConfigurationError',
          source: '@migaia/web-rpc',
          code: WebRpcErrorCode.invalidConfig,
          cause
        })
      })
      expect(reads).toEqual(['alpha', 'beta', 'gamma'])
      const after = fixture.snapshot()
      expect(before.activeSubscriptions).toBe(0)
      expect(after.activeSubscriptions).toBe(0)
      expect(after.activated).toBe(false)
      expect(after.subscribeCalls).toBe(0)
      expect(after.dispatches).toBe(0)
      expect(after.shared.every((value) => value === undefined)).toBe(true)
      expect(after.extensions.every((descriptor) => descriptor === undefined)).toBe(true)
      expect(
        after.installations.every(
          ({ installed, extensionKeys, sharedKeys }) =>
            !installed && extensionKeys.length === 0 && sharedKeys.length === 0
        )
      ).toBe(true)
      expect(after.kernelState).toBe('disposed')
      expect(after.kernelOwners).toEqual([])
      expect(after.kernelRoutes).toEqual([])
      expect(after.resources).toBe(0)
      const disposePromise = fixture.host.dispose()
      expect(fixture.host.dispose()).toBe(disposePromise)
      await expect(disposePromise).resolves.toMatchObject({
        logicalTerminal: true,
        cleanupComplete: true,
        cleanupErrors: []
      })
      expect(fixture.snapshot()).toEqual(after)
    } finally {
      await fixture.dispose()
    }
  })

  it('T137 concurrent same-map transactions isolate passive observation cleanup', async () => {
    const providerMap = {
      echo: (context: Parameters<IWebRpcProvider>[0]) => context.success('shared-candidate')
    }
    const [first, second] = await Promise.all([
      createActualAdmissionFixture({ providerMap, observeProviderRegistration: true }),
      createActualAdmissionFixture({ providerMap, observeProviderRegistration: true })
    ])
    try {
      await Promise.all([first.install(), second.install()])
      expect(
        readProviderRegistrationObservation(first.kernel)?.map(({ method }) => method)
      ).toEqual(['echo'])
      expect(
        readProviderRegistrationObservation(second.kernel)?.map(({ method }) => method)
      ).toEqual(['echo'])
      expect(first.kernel).not.toBe(second.kernel)

      const replacementUnregister = registerProviderRegistrationObservation(first.kernel)
      expect(readProviderRegistrationObservation(first.kernel)).toEqual([])
      await first.dispose()
      expect(readProviderRegistrationObservation(first.kernel)).toEqual([])
      replacementUnregister()
      replacementUnregister()
      expect(readProviderRegistrationObservation(first.kernel)).toBeUndefined()
      expect(
        readProviderRegistrationObservation(second.kernel)?.map(({ method }) => method)
      ).toEqual(['echo'])
    } finally {
      await Promise.all([first.dispose(), second.dispose()])
    }
  })

  it('T167 Host-installed provider verifies receiver admission before execution', async () => {
    let executions = 0
    const fixture = await createActualAdmissionFixture({
      providerMap: {
        echo: (context) => {
          executions += 1
          return context.success(context.data)
        }
      }
    })
    const messages: unknown[] = []
    const unsubscribe = fixture.clientTransport.subscribe(({ data }) => messages.push(data))
    try {
      await fixture.install()
      await fixture.clientTransport.send(createProviderRequest('verified'))
      await settleProviderDelivery()
      expect(executions).toBe(1)
      expect(messages).toContainEqual(
        expect.objectContaining({
          kind: 'response',
          id: 'verified',
          ok: true,
          data: expect.objectContaining({
            webRpc: expect.objectContaining({ type: 'response', targetId: 'r70-client' }),
            payload: 'r70-data'
          })
        })
      )
      await fixture.clientTransport.send(
        createProviderRequest('forged-receiver', { receiverId: 'wrong-receiver' })
      )
      await settleProviderDelivery()
      expect(executions).toBe(1)
    } finally {
      unsubscribe()
      await fixture.dispose()
    }
  })

  it('T168 Host-installed replay ledger suppresses duplicate task execution', async () => {
    let executions = 0
    const fixture = await createActualAdmissionFixture({
      providerMap: {
        echo: (context) => {
          executions += 1
          return context.success('once')
        }
      }
    })
    try {
      await fixture.install()
      const request = createProviderRequest('duplicate-task')
      await fixture.clientTransport.send(request)
      await settleProviderDelivery()
      await fixture.clientTransport.send(request)
      await settleProviderDelivery()
      expect(executions).toBe(1)
    } finally {
      await fixture.dispose()
    }
  })

  it('T169 Host-installed dispatch-only execution sends no response', async () => {
    let executions = 0
    const fixture = await createActualAdmissionFixture({
      providerMap: {
        echo: (context) => {
          executions += 1
          return context.success('dispatch')
        }
      }
    })
    const messages: unknown[] = []
    const unsubscribe = fixture.clientTransport.subscribe(({ data }) => messages.push(data))
    try {
      await fixture.install()
      await fixture.clientTransport.send(
        createProviderRequest('dispatch-only', { dispatchOnly: true })
      )
      await settleProviderDelivery()
      expect(executions).toBe(1)
      expect(messages).toEqual([])
    } finally {
      unsubscribe()
      await fixture.dispose()
    }
  })

  it('T170 Host-installed missing provider returns the canonical not-found response', async () => {
    const fixture = await createActualAdmissionFixture({
      providerMap: {
        echo: (context) => context.success('present')
      }
    })
    const messages: unknown[] = []
    const unsubscribe = fixture.clientTransport.subscribe(({ data }) => messages.push(data))
    try {
      await fixture.install()
      await fixture.clientTransport.send(createProviderRequest('not-found', { method: 'missing' }))
      await settleProviderDelivery()
      expect(messages).toContainEqual(
        expect.objectContaining({
          kind: 'response',
          id: 'not-found',
          ok: false,
          code: WebRpcErrorCode.providerNotFound
        })
      )
    } finally {
      unsubscribe()
      await fixture.dispose()
    }
  })

  it('T171 Host-installed unbranded provider result reports not-settled', async () => {
    const fixture = await createActualAdmissionFixture({
      providerMap: {
        echo: () => ({ ok: true, data: 'unbranded' }) as never
      }
    })
    const messages: unknown[] = []
    const unsubscribe = fixture.clientTransport.subscribe(({ data }) => messages.push(data))
    try {
      await fixture.install()
      await fixture.clientTransport.send(createProviderRequest('not-settled'))
      await settleProviderDelivery()
      expect(messages).toContainEqual(
        expect.objectContaining({
          kind: 'response',
          id: 'not-settled',
          ok: false,
          code: WebRpcErrorCode.providerNotSettled
        })
      )
    } finally {
      unsubscribe()
      await fixture.dispose()
    }
  })

  it('T172 Host-installed reentrant duplicate request remains idempotent', async () => {
    let executions = 0
    let clientTransport: IWebRpcTransport | undefined
    const request = createProviderRequest('reentrant')
    const fixture = await createActualAdmissionFixture({
      providerMap: {
        echo: (context) => {
          executions += 1
          if (executions === 1) void clientTransport?.send(request)
          return context.success('reentrant')
        }
      }
    })
    clientTransport = fixture.clientTransport
    try {
      await fixture.install()
      await fixture.clientTransport.send(request)
      await settleProviderDelivery()
      await settleProviderDelivery()
      expect(executions).toBe(1)
    } finally {
      await fixture.dispose()
    }
  })

  it('T173 concurrent Host endpoints preserve endpoint-local provider identity', async () => {
    const firstExecutions: string[] = []
    const secondExecutions: string[] = []
    const [first, second] = await Promise.all([
      createActualAdmissionFixture({
        providerMap: {
          echo: (context) => {
            firstExecutions.push(String(context.data))
            return context.success('first')
          }
        }
      }),
      createActualAdmissionFixture({
        providerMap: {
          echo: (context) => {
            secondExecutions.push(String(context.data))
            return context.success('second')
          }
        }
      })
    ])
    try {
      await Promise.all([first.install(), second.install()])
      await first.clientTransport.send(createProviderRequest('first-task', { data: 'first' }))
      await second.clientTransport.send(createProviderRequest('second-task', { data: 'second' }))
      await settleProviderDelivery()
      expect(firstExecutions).toEqual(['first'])
      expect(secondExecutions).toEqual(['second'])
    } finally {
      await Promise.all([first.dispose(), second.dispose()])
    }
  })

  it('T174 Host-installed async provider rejection preserves terminal controller residue', async () => {
    const fixture = await createActualAdmissionFixture({
      providerMap: {
        echo: async () => {
          await Promise.resolve()
          throw new Error('host async provider failure')
        }
      }
    })
    const messages: unknown[] = []
    const unsubscribe = fixture.clientTransport.subscribe(({ data }) => messages.push(data))
    try {
      await fixture.install()
      await fixture.clientTransport.send(createProviderRequest('async-failure'))
      await settleProviderDelivery()
      expect(messages).toContainEqual(
        expect.objectContaining({
          kind: 'response',
          id: 'async-failure',
          ok: false,
          code: WebRpcErrorCode.internal
        })
      )
      expect(fixture.snapshot().activeSubscriptions).toBe(1)
    } finally {
      unsubscribe()
      await fixture.dispose()
    }
  })

  it('T175 Host-installed transfer overflow preserves the native provider failure code', async () => {
    const fixture = await createActualAdmissionFixture({
      providerMap: {
        echo: (context) =>
          context.success('oversized', {
            transfer: Array.from({ length: 65 }, () => ({}))
          })
      }
    })
    const messages: unknown[] = []
    const unsubscribe = fixture.clientTransport.subscribe(({ data }) => messages.push(data))
    try {
      await fixture.install()
      await fixture.clientTransport.send(createProviderRequest('transfer-overflow'))
      await settleProviderDelivery()
      expect(messages).toContainEqual(
        expect.objectContaining({
          kind: 'response',
          id: 'transfer-overflow',
          ok: false,
          code: WebRpcErrorCode.internal
        })
      )
    } finally {
      unsubscribe()
      await fixture.dispose()
    }
  })

  it('T176 real Host admission rejects forged source, sender, receiver, and cross-endpoint frames', async () => {
    const acceptedPeerId = 'r70-peer'
    let executions = 0
    const fixture = await createActualAdmissionFixture({
      endpointId: 'r70-authority-host',
      transportPeerId: acceptedPeerId,
      sourceProof: (source) => source === undefined,
      connectConfig: {
        useBaseIdVerifyOnly: false,
        identifier: async (context) =>
          context.senderId === acceptedPeerId && context.source === undefined
      },
      providerMap: {
        echo: (context) => {
          executions += 1
          return context.success(context.data)
        }
      }
    })
    const messages: unknown[] = []
    const unsubscribe = fixture.clientTransport.subscribe(({ data }) => messages.push(data))
    try {
      await fixture.install()
      const valid = createProviderRequest('authority-valid', {
        senderId: acceptedPeerId,
        receiverId: fixture.id,
        targetId: fixture.id
      })
      await fixture.clientTransport.send(valid)
      await settleProviderDelivery()
      expect(executions).toBe(1)
      const stable = fixture.snapshot()
      const forgedFrames = [
        createInboundProviderFrame(
          { ...valid, taskId: 'forged-sender', senderId: 'forged-peer' },
          undefined,
          acceptedPeerId
        ),
        createInboundProviderFrame({ ...valid, taskId: 'forged-source' }, {}, acceptedPeerId),
        createInboundProviderFrame(
          { ...valid, taskId: 'forged-receiver', receiverId: 'wrong-receiver' },
          undefined,
          acceptedPeerId
        ),
        createInboundProviderFrame(
          { ...valid, taskId: 'cross-endpoint', targetId: 'other-r70-host' },
          undefined,
          acceptedPeerId
        )
      ]
      for (const frame of forgedFrames) await fixture.clientTransport.send(frame)
      await settleProviderDelivery()
      expect(executions).toBe(1)
      expect(
        messages.filter((message) => (message as { readonly kind?: unknown }).kind === 'response')
      ).toHaveLength(1)
      expect(fixture.snapshot()).toEqual(stable)
    } finally {
      unsubscribe()
      await fixture.dispose()
    }
  })

  it('T177 concurrent duplicate requests preserve replay response uniqueness and controller release', async () => {
    let executions = 0
    let started!: () => void
    let release!: () => void
    const startedPromise = new Promise<void>((resolve) => {
      started = resolve
    })
    const barrier = new Promise<void>((resolve) => {
      release = resolve
    })
    const fixture = await createActualAdmissionFixture({
      providerMap: {
        echo: async (context) => {
          executions += 1
          started()
          await barrier
          return context.success('concurrent-once')
        }
      }
    })
    const messages: unknown[] = []
    const unsubscribe = fixture.clientTransport.subscribe(({ data }) => messages.push(data))
    try {
      await fixture.install()
      const request = createProviderRequest('concurrent-duplicate')
      void fixture.clientTransport.send(request)
      void fixture.clientTransport.send(request)
      await startedPromise
      await settleProviderDelivery()
      expect(fixture.snapshot().providerState).toEqual({
        admission: 1,
        replay: 1,
        activeControllers: 1
      })
      release()
      await settleProviderDelivery()
      await settleProviderDelivery()
      expect(executions).toBe(1)
      expect(
        messages.filter(
          (message) =>
            (message as { readonly kind?: unknown }).kind === 'response' &&
            (message as { readonly id?: unknown }).id === 'concurrent-duplicate'
        )
      ).toHaveLength(1)
      expect(fixture.snapshot().activeSubscriptions).toBe(1)
      expect(fixture.snapshot().providerState).toEqual({
        admission: 0,
        replay: 1,
        activeControllers: 0
      })
    } finally {
      unsubscribe()
      await fixture.dispose()
    }
  })

  it('T178 real Host admission capacity rejects one of 65 concurrent unique tasks and releases all', async () => {
    let active = 0
    let maximumActive = 0
    let reachedCapacity!: () => void
    let release!: () => void
    const reachedCapacityPromise = new Promise<void>((resolve) => {
      reachedCapacity = resolve
    })
    const barrier = new Promise<void>((resolve) => {
      release = resolve
    })
    const fixture = await createActualAdmissionFixture({
      providerMap: {
        echo: async (context) => {
          active += 1
          maximumActive = Math.max(maximumActive, active)
          if (maximumActive === 64) reachedCapacity()
          await barrier
          active -= 1
          return context.success('capacity')
        }
      }
    })
    const messages: unknown[] = []
    const unsubscribe = fixture.clientTransport.subscribe(({ data }) => messages.push(data))
    try {
      await fixture.install()
      for (let index = 0; index < 65; index += 1)
        void fixture.clientTransport.send(createProviderRequest(`capacity-${index}`))
      await reachedCapacityPromise
      await settleProviderDelivery()
      release()
      await settleProviderDelivery()
      await settleProviderDelivery()
      expect(maximumActive).toBe(64)
      expect(active).toBe(0)
      expect(
        messages.filter(
          (message) =>
            (message as { readonly kind?: unknown }).kind === 'response' &&
            (message as { readonly code?: unknown }).code === WebRpcErrorCode.overloaded
        )
      ).toHaveLength(1)
      expect(fixture.snapshot().activeSubscriptions).toBe(1)
      expect(fixture.snapshot().providerState).toEqual({
        admission: 0,
        replay: 65,
        activeControllers: 0
      })
    } finally {
      unsubscribe()
      await fixture.dispose()
    }
  })

  it('T179 real Host schema failure preserves serialized native identity and residue', async () => {
    const schemaCause = new Error('R70 schema cause')
    let executions = 0
    const fixture = await createActualAdmissionFixture({
      contractConfig: {
        schemas: {
          echo: {
            params: {
              parse: () => {
                throw schemaCause
              }
            },
            result: { parse: (value: unknown) => value }
          }
        }
      },
      providerMap: {
        echo: (context) => {
          executions += 1
          return context.success('unreachable')
        }
      }
    })
    const messages: unknown[] = []
    const unsubscribe = fixture.clientTransport.subscribe(({ data }) => messages.push(data))
    try {
      await fixture.install()
      await fixture.clientTransport.send(createProviderRequest('schema-failure'))
      await settleProviderDelivery()
      const response = messages.find(
        (message) =>
          (message as { readonly kind?: unknown }).kind === 'response' &&
          (message as { readonly id?: unknown }).id === 'schema-failure'
      ) as { readonly code?: unknown; readonly error?: Record<string, unknown> } | undefined
      expect(executions).toBe(0)
      expect(response).toMatchObject({ code: WebRpcErrorCode.schemaInvalid })
      expect(response?.error).toMatchObject({
        name: 'WebRpcSchemaValidationError',
        source: '@migaia/web-rpc',
        code: WebRpcErrorCode.schemaInvalid,
        stack: expect.any(String)
      })
      expect(fixture.snapshot().activeSubscriptions).toBe(1)
      expect(fixture.snapshot().providerState).toEqual({
        admission: 0,
        replay: 1,
        activeControllers: 0
      })
    } finally {
      unsubscribe()
      await fixture.dispose()
    }
  })

  it('T180 late provider rejection reports the original error and releases operation state', async () => {
    const latePrimary = new Error('R70 late provider rejection')
    let started!: () => void
    let rejectLate!: (error: unknown) => void
    const startedPromise = new Promise<void>((resolve) => {
      started = resolve
    })
    const lateResult = new Promise<never>((_resolve, reject) => {
      rejectLate = reject
    })
    const reports: unknown[] = []
    const fixture = await createActualAdmissionFixture({
      hookErrorReporter: (error) => reports.push(error),
      providerMap: {
        echo: async () => {
          started()
          await lateResult
          throw new Error('unreachable')
        }
      }
    })
    const messages: unknown[] = []
    const unsubscribe = fixture.clientTransport.subscribe(({ data }) => messages.push(data))
    try {
      await fixture.install()
      void fixture.clientTransport.send(createProviderRequest('late-rejection'))
      await startedPromise
      rejectLate(latePrimary)
      await settleProviderDelivery()
      await settleProviderDelivery()
      expect(reports).toEqual([latePrimary])
      expect(latePrimary.stack).toEqual(expect.any(String))
      expect(messages).toContainEqual(
        expect.objectContaining({
          kind: 'response',
          id: 'late-rejection',
          code: WebRpcErrorCode.internal
        })
      )
      expect(fixture.snapshot().activeSubscriptions).toBe(1)
      expect(fixture.snapshot().providerState).toEqual({
        admission: 0,
        replay: 1,
        activeControllers: 0
      })
    } finally {
      unsubscribe()
      await fixture.dispose()
    }
  })

  it('T182 two real Host transactions isolate cross-endpoint and post-removal requests', async () => {
    let firstExecutions = 0
    let secondExecutions = 0
    const firstPeer = 'r70-peer-first'
    const secondPeer = 'r70-peer-second'
    const first = await createActualAdmissionFixture({
      endpointId: 'r70-isolation-first',
      transportPeerId: firstPeer,
      sourceProof: (source) => source === undefined,
      connectConfig: {
        useBaseIdVerifyOnly: false,
        identifier: async (context) =>
          context.senderId === firstPeer && context.source === undefined
      },
      providerMap: {
        echo: (context) => {
          firstExecutions += 1
          return context.success('first')
        }
      }
    })
    const second = await createActualAdmissionFixture({
      endpointId: 'r70-isolation-second',
      transportPeerId: secondPeer,
      sourceProof: (source) => source === undefined,
      connectConfig: {
        useBaseIdVerifyOnly: false,
        identifier: async (context) =>
          context.senderId === secondPeer && context.source === undefined
      },
      providerMap: {
        echo: (context) => {
          secondExecutions += 1
          return context.success('second')
        }
      }
    })
    const firstMessages: unknown[] = []
    const secondMessages: unknown[] = []
    const unsubscribeFirst = first.clientTransport.subscribe(({ data }) => firstMessages.push(data))
    const unsubscribeSecond = second.clientTransport.subscribe(({ data }) =>
      secondMessages.push(data)
    )
    try {
      await first.install()
      await second.install()
      const firstRequest = createProviderRequest('r70-first-valid', {
        senderId: firstPeer,
        receiverId: first.id,
        targetId: first.id
      })
      const secondRequest = createProviderRequest('r70-second-valid', {
        senderId: secondPeer,
        receiverId: second.id,
        targetId: second.id
      })
      await first.clientTransport.send(firstRequest)
      await second.clientTransport.send(secondRequest)
      await settleProviderDelivery()
      expect(firstExecutions).toBe(1)
      expect(secondExecutions).toBe(1)
      const secondBeforeCrossEndpoint = second.snapshot()
      await second.clientTransport.send(
        createInboundProviderFrame(
          { ...firstRequest, taskId: 'r70-cross-endpoint' },
          undefined,
          firstPeer
        )
      )
      await settleProviderDelivery()
      expect(secondExecutions).toBe(1)
      expect(second.snapshot()).toEqual(secondBeforeCrossEndpoint)

      const firstDispose = first.host.dispose()
      expect(first.host.dispose()).toBe(firstDispose)
      await firstDispose
      const firstTerminal = first.snapshot()
      expect(firstTerminal).toMatchObject({
        activeSubscriptions: 0,
        providerState: { admission: 0, replay: 0, activeControllers: 0 },
        activated: false,
        kernelState: 'disposed',
        kernelOwners: [],
        kernelRoutes: [],
        resources: 0
      })
      await first.clientTransport.send({ ...firstRequest, taskId: 'r70-post-removal' })
      await settleProviderDelivery()
      expect(firstExecutions).toBe(1)
      expect(firstMessages).not.toContainEqual(
        expect.objectContaining({ taskId: 'r70-post-removal' })
      )
      expect(second.snapshot()).toEqual(secondBeforeCrossEndpoint)
    } finally {
      unsubscribeFirst()
      unsubscribeSecond()
      await first.dispose()
      await second.dispose()
    }
  })

  it('T183 synchronous provider failure preserves raw report identity and terminal release', async () => {
    const primary = new Error('R70 synchronous provider failure')
    const reports: unknown[] = []
    const fixture = await createActualAdmissionFixture({
      hookErrorReporter: (error) => reports.push(error),
      providerMap: {
        echo: () => {
          throw primary
        }
      }
    })
    const messages: unknown[] = []
    const unsubscribe = fixture.clientTransport.subscribe(({ data }) => messages.push(data))
    try {
      await fixture.install()
      await fixture.clientTransport.send(createProviderRequest('r70-sync-failure'))
      await settleProviderDelivery()
      expect(reports).toEqual([primary])
      expect(primary.stack).toEqual(expect.any(String))
      expect(messages).toContainEqual(
        expect.objectContaining({
          kind: 'response',
          id: 'r70-sync-failure',
          code: WebRpcErrorCode.internal,
          message: 'Provider failed'
        })
      )
      expect(fixture.snapshot().providerState).toEqual({
        admission: 0,
        replay: 1,
        activeControllers: 0
      })
      await fixture.dispose()
      expect(fixture.snapshot()).toMatchObject({
        activeSubscriptions: 0,
        providerState: { admission: 0, replay: 0, activeControllers: 0 },
        kernelState: 'disposed',
        kernelOwners: [],
        kernelRoutes: [],
        resources: 0
      })
    } finally {
      unsubscribe()
      await fixture.dispose()
    }
  })

  it('T184 post-terminal late resolve has no response and leaves no provider state', async () => {
    let started!: () => void
    let resolveLate!: () => void
    const startedPromise = new Promise<void>((resolve) => {
      started = resolve
    })
    const lateResult = new Promise<void>((resolve) => {
      resolveLate = resolve
    })
    const fixture = await createActualAdmissionFixture({
      providerMap: {
        echo: async (context) => {
          started()
          await lateResult
          return context.success('late-resolve')
        }
      }
    })
    const messages: unknown[] = []
    const unsubscribe = fixture.clientTransport.subscribe(({ data }) => messages.push(data))
    try {
      await fixture.install()
      void fixture.clientTransport.send(createProviderRequest('r70-late-resolve'))
      await startedPromise
      const dispose = fixture.host.dispose()
      expect(fixture.host.dispose()).toBe(dispose)
      await dispose
      resolveLate()
      await settleProviderDelivery()
      await settleProviderDelivery()
      expect(messages).not.toContainEqual(expect.objectContaining({ taskId: 'r70-late-resolve' }))
      expect(fixture.snapshot()).toMatchObject({
        activeSubscriptions: 0,
        providerState: { admission: 0, replay: 0, activeControllers: 0 },
        kernelState: 'disposed',
        kernelOwners: [],
        kernelRoutes: [],
        resources: 0
      })
    } finally {
      unsubscribe()
      await fixture.dispose()
    }
  })

  it('T185 post-terminal late reject reports the distinct raw primary without a response', async () => {
    const latePrimary = new Error('R70 post-terminal late rejection')
    let started!: () => void
    let rejectLate!: (error: unknown) => void
    const startedPromise = new Promise<void>((resolve) => {
      started = resolve
    })
    const lateResult = new Promise<never>((_resolve, reject) => {
      rejectLate = reject
    })
    const reports: unknown[] = []
    const fixture = await createActualAdmissionFixture({
      hookErrorReporter: (error) => reports.push(error),
      providerMap: {
        echo: async () => {
          started()
          await lateResult
          throw new Error('unreachable')
        }
      }
    })
    const messages: unknown[] = []
    const unsubscribe = fixture.clientTransport.subscribe(({ data }) => messages.push(data))
    try {
      await fixture.install()
      void fixture.clientTransport.send(createProviderRequest('r70-late-reject'))
      await startedPromise
      const dispose = fixture.host.dispose()
      expect(fixture.host.dispose()).toBe(dispose)
      await dispose
      rejectLate(latePrimary)
      await settleProviderDelivery()
      await settleProviderDelivery()
      expect(reports).toEqual([latePrimary])
      expect(messages).not.toContainEqual(expect.objectContaining({ taskId: 'r70-late-reject' }))
      expect(fixture.snapshot()).toMatchObject({
        activeSubscriptions: 0,
        providerState: { admission: 0, replay: 0, activeControllers: 0 },
        kernelState: 'disposed',
        kernelOwners: [],
        kernelRoutes: [],
        resources: 0
      })
    } finally {
      unsubscribe()
      await fixture.dispose()
    }
  })

  it('T186 result schema failure retains raw cause in serialized error graph', async () => {
    const resultCause = new Error('R70 result schema cause')
    const fixture = await createActualAdmissionFixture({
      contractConfig: {
        schemas: {
          echo: {
            params: { parse: (value: unknown) => value },
            result: {
              parse: () => {
                throw resultCause
              }
            }
          }
        }
      },
      providerMap: {
        echo: (context) => context.success('schema-result')
      }
    })
    const messages: unknown[] = []
    const unsubscribe = fixture.clientTransport.subscribe(({ data }) => messages.push(data))
    try {
      await fixture.install()
      await fixture.clientTransport.send(createProviderRequest('r70-result-schema'))
      await settleProviderDelivery()
      const response = messages.find(
        (message) =>
          (message as { readonly kind?: unknown }).kind === 'response' &&
          (message as { readonly id?: unknown }).id === 'r70-result-schema'
      ) as { readonly error?: { readonly cause?: Record<string, unknown> } } | undefined
      expect(response).toMatchObject({
        error: {
          name: 'WebRpcSchemaValidationError',
          source: '@migaia/web-rpc',
          code: WebRpcErrorCode.schemaInvalid,
          stack: expect.any(String)
        }
      })
      expect(response?.error?.cause).toMatchObject({
        name: 'Error',
        message: resultCause.message,
        stack: expect.any(String)
      })
      expect(fixture.snapshot().providerState).toEqual({
        admission: 0,
        replay: 1,
        activeControllers: 0
      })
    } finally {
      unsubscribe()
      await fixture.dispose()
    }
  })

  it('T187 synchronous provider WebRPC error serializes primary and cause across the real seam', async () => {
    const cause = new Error('R70 serialized sync cause')
    const primary = new WebRpcError(WebRpcErrorCode.internal, 'R70 serialized sync primary', cause)
    const observations: IWebRpcOutboundCommandObservation[] = []
    const fixture = await createActualAdmissionFixture({
      observeOutboundCommand: (observation) => observations.push(observation),
      providerMap: {
        echo: () => {
          throw primary
        }
      }
    })
    const messages: unknown[] = []
    const unsubscribe = fixture.clientTransport.subscribe(({ data }) => messages.push(data))
    let report: Extract<IWebRpcOutboundCommand, { readonly kind: 'report' }> | undefined
    let response: { readonly error?: { readonly cause?: Record<string, unknown> } } | undefined
    let terminal: ReturnType<IActualAdmissionFixture['snapshot']> | undefined
    let hostPromiseStable = false
    try {
      await fixture.install()
      await fixture.clientTransport.send(createProviderRequest('r70-sync-serialized'))
      await settleProviderDelivery()
      report = observations.find(({ command }) => command.kind === 'report')?.command as
        | Extract<IWebRpcOutboundCommand, { readonly kind: 'report' }>
        | undefined
      response = messages.find(
        (message) =>
          (message as { readonly kind?: unknown }).kind === 'response' &&
          (message as { readonly id?: unknown }).id === 'r70-sync-serialized'
      ) as { readonly error?: { readonly cause?: Record<string, unknown> } } | undefined
      const dispose = fixture.host.dispose()
      hostPromiseStable = fixture.host.dispose() === dispose
      await dispose
      terminal = fixture.snapshot()
      expect({ report, response, terminal, hostPromiseStable }).toMatchObject({
        report: { code: WebRpcErrorCode.internal, error: primary, kind: 'report' },
        response: {
          error: {
            name: 'WebRpcError',
            source: '@migaia/web-rpc',
            code: WebRpcErrorCode.internal,
            message: primary.message,
            stack: primary.stack,
            cause: expect.objectContaining({
              name: 'Error',
              message: cause.message,
              stack: cause.stack
            })
          }
        },
        hostPromiseStable: true,
        terminal: {
          activeSubscriptions: 0,
          providerState: { admission: 0, replay: 0, activeControllers: 0 },
          kernelState: 'disposed',
          kernelOwners: [],
          kernelRoutes: [],
          resources: 0
        }
      })
    } finally {
      unsubscribe()
      await fixture.dispose()
    }
  })

  it('T188 asynchronous provider WebRPC error serializes primary and cause across the real seam', async () => {
    const cause = new Error('R70 serialized async cause')
    const primary = new WebRpcError(WebRpcErrorCode.internal, 'R70 serialized async primary', cause)
    const observations: IWebRpcOutboundCommandObservation[] = []
    const fixture = await createActualAdmissionFixture({
      observeOutboundCommand: (observation) => observations.push(observation),
      providerMap: {
        echo: async () => {
          await Promise.resolve()
          throw primary
        }
      }
    })
    const messages: unknown[] = []
    const unsubscribe = fixture.clientTransport.subscribe(({ data }) => messages.push(data))
    let report: IWebRpcOutboundCommandObservation['command'] | undefined
    let response: { readonly error?: Record<string, unknown> } | undefined
    let terminal: ReturnType<IActualAdmissionFixture['snapshot']> | undefined
    let hostPromiseStable = false
    try {
      await fixture.install()
      await fixture.clientTransport.send(createProviderRequest('r70-async-serialized'))
      await settleProviderDelivery()
      report = observations.find(({ command }) => command.kind === 'report')?.command
      response = messages.find(
        (message) =>
          (message as { readonly kind?: unknown }).kind === 'response' &&
          (message as { readonly id?: unknown }).id === 'r70-async-serialized'
      ) as { readonly error?: Record<string, unknown> } | undefined
      const dispose = fixture.host.dispose()
      hostPromiseStable = fixture.host.dispose() === dispose
      await dispose
      terminal = fixture.snapshot()
      expect({ report, response, terminal, hostPromiseStable }).toMatchObject({
        report: { code: WebRpcErrorCode.internal, error: primary, kind: 'report' },
        response: {
          error: {
            name: 'WebRpcError',
            source: '@migaia/web-rpc',
            code: WebRpcErrorCode.internal,
            message: primary.message,
            stack: primary.stack,
            cause: expect.objectContaining({
              name: 'Error',
              message: cause.message,
              stack: cause.stack
            })
          }
        },
        hostPromiseStable: true,
        terminal: {
          activeSubscriptions: 0,
          providerState: { admission: 0, replay: 0, activeControllers: 0 },
          kernelState: 'disposed',
          kernelOwners: [],
          kernelRoutes: [],
          resources: 0
        }
      })
    } finally {
      unsubscribe()
      await fixture.dispose()
    }
  })

  it('T189 post-terminal late WebRPC rejection reports native cause identity without response', async () => {
    const cause = new Error('R70 late native cause')
    const primary = new WebRpcError(WebRpcErrorCode.internal, 'R70 late native primary', cause)
    let started!: () => void
    let rejectLate!: (error: unknown) => void
    const startedPromise = new Promise<void>((resolve) => {
      started = resolve
    })
    const lateResult = new Promise<never>((_resolve, reject) => {
      rejectLate = reject
    })
    const reports: unknown[] = []
    const fixture = await createActualAdmissionFixture({
      hookErrorReporter: (error) => reports.push(error),
      providerMap: {
        echo: async () => {
          started()
          await lateResult
          throw new Error('unreachable')
        }
      }
    })
    const messages: unknown[] = []
    const unsubscribe = fixture.clientTransport.subscribe(({ data }) => messages.push(data))
    try {
      await fixture.install()
      void fixture.clientTransport.send(createProviderRequest('r70-late-native-reject'))
      await startedPromise
      const dispose = fixture.host.dispose()
      expect(fixture.host.dispose()).toBe(dispose)
      await dispose
      rejectLate(primary)
      await settleProviderDelivery()
      await settleProviderDelivery()
      expect(reports).toEqual([primary])
      expect(primary.cause).toBe(cause)
      expect(messages).not.toContainEqual(
        expect.objectContaining({ taskId: 'r70-late-native-reject' })
      )
      expect(fixture.snapshot()).toMatchObject({
        activeSubscriptions: 0,
        providerState: { admission: 0, replay: 0, activeControllers: 0 },
        kernelState: 'disposed',
        kernelOwners: [],
        kernelRoutes: [],
        resources: 0
      })
    } finally {
      unsubscribe()
      await fixture.dispose()
    }
  })

  it('T190 invalid provider transfer shape preserves native contract failure and release', async () => {
    const observations: IWebRpcOutboundCommandObservation[] = []
    const fixture = await createActualAdmissionFixture({
      observeOutboundCommand: (observation) => observations.push(observation),
      providerMap: {
        echo: (context) =>
          context.success('invalid-transfer', {
            transfer: 'not-an-array' as unknown as readonly unknown[]
          })
      }
    })
    const messages: unknown[] = []
    const unsubscribe = fixture.clientTransport.subscribe(({ data }) => messages.push(data))
    let report: Extract<IWebRpcOutboundCommand, { readonly kind: 'report' }> | undefined
    let response: Record<string, unknown> | undefined
    let terminal: ReturnType<IActualAdmissionFixture['snapshot']> | undefined
    try {
      await fixture.install()
      await fixture.clientTransport.send(createProviderRequest('r70-invalid-transfer'))
      await settleProviderDelivery()
      report = observations.find(({ command }) => command.kind === 'report')?.command as
        | Extract<IWebRpcOutboundCommand, { readonly kind: 'report' }>
        | undefined
      response = messages.find(
        (message) =>
          (message as { readonly kind?: unknown }).kind === 'response' &&
          (message as { readonly id?: unknown }).id === 'r70-invalid-transfer'
      ) as Record<string, unknown> | undefined
      const reportError = report?.error as
        | {
            readonly name: string
            readonly source: string
            readonly code: string
            readonly message: string
            readonly stack?: string
          }
        | undefined
      const dispose = fixture.host.dispose()
      expect(fixture.host.dispose()).toBe(dispose)
      await dispose
      terminal = fixture.snapshot()
      expect({ report, response, terminal }).toMatchObject({
        report: {
          kind: 'report',
          code: WebRpcErrorCode.internal,
          error: {
            name: 'WebRpcContractError',
            source: '@migaia/web-rpc',
            code: WebRpcErrorCode.contractInvalid,
            message: expect.any(String),
            stack: expect.any(String)
          }
        },
        response: {
          kind: 'response',
          id: 'r70-invalid-transfer',
          code: WebRpcErrorCode.internal,
          error: {
            name: reportError?.name,
            source: reportError?.source,
            code: reportError?.code,
            message: reportError?.message,
            stack: reportError?.stack
          }
        },
        terminal: {
          activeSubscriptions: 0,
          providerState: { admission: 0, replay: 0, activeControllers: 0 },
          kernelState: 'disposed',
          kernelOwners: [],
          kernelRoutes: [],
          resources: 0
        }
      })
    } finally {
      unsubscribe()
      await fixture.dispose()
    }
  })

  it('T191 params schema failure preserves exact parser cause in serialized graph', async () => {
    const paramsCause = new Error('R70 params schema cause')
    const fixture = await createActualAdmissionFixture({
      contractConfig: {
        schemas: {
          echo: {
            params: {
              parse: () => {
                throw paramsCause
              }
            },
            result: { parse: (value: unknown) => value }
          }
        }
      },
      providerMap: {
        echo: (context) => context.success('unreachable')
      }
    })
    const messages: unknown[] = []
    const unsubscribe = fixture.clientTransport.subscribe(({ data }) => messages.push(data))
    try {
      await fixture.install()
      await fixture.clientTransport.send(createProviderRequest('r70-params-schema'))
      await settleProviderDelivery()
      const response = messages.find(
        (message) =>
          (message as { readonly kind?: unknown }).kind === 'response' &&
          (message as { readonly id?: unknown }).id === 'r70-params-schema'
      ) as { readonly error?: { readonly cause?: Record<string, unknown> } } | undefined
      expect(response?.error).toMatchObject({
        name: 'WebRpcSchemaValidationError',
        source: '@migaia/web-rpc',
        code: WebRpcErrorCode.schemaInvalid,
        stack: expect.any(String)
      })
      expect(response?.error?.cause).toMatchObject({
        name: 'Error',
        message: paramsCause.message,
        stack: expect.any(String)
      })
    } finally {
      unsubscribe()
      await fixture.dispose()
    }
  })

  it('T194 transfer overflow preserves native failure identity and requires serialized error graph', async () => {
    const observations: IWebRpcOutboundCommandObservation[] = []
    const fixture = await createActualAdmissionFixture({
      observeOutboundCommand: (observation) => observations.push(observation),
      providerMap: {
        echo: (context) =>
          context.success('oversized', {
            transfer: Array.from({ length: 65 }, () => ({}))
          })
      }
    })
    const messages: unknown[] = []
    const unsubscribe = fixture.clientTransport.subscribe(({ data }) => messages.push(data))
    let report: Extract<IWebRpcOutboundCommand, { readonly kind: 'report' }> | undefined
    let response: Record<string, unknown> | undefined
    let terminal: ReturnType<IActualAdmissionFixture['snapshot']> | undefined
    try {
      await fixture.install()
      await fixture.clientTransport.send(createProviderRequest('r70-transfer-overflow'))
      await settleProviderDelivery()
      report = observations.find(({ command }) => command.kind === 'report')?.command as
        | Extract<IWebRpcOutboundCommand, { readonly kind: 'report' }>
        | undefined
      response = messages.find(
        (message) =>
          (message as { readonly kind?: unknown }).kind === 'response' &&
          (message as { readonly id?: unknown }).id === 'r70-transfer-overflow'
      ) as Record<string, unknown> | undefined
      const reportError = report?.error as
        | {
            readonly name: string
            readonly source: string
            readonly code: string
            readonly message: string
            readonly stack?: string
          }
        | undefined
      const dispose = fixture.host.dispose()
      expect(fixture.host.dispose()).toBe(dispose)
      await dispose
      terminal = fixture.snapshot()
      expect({ report, response, terminal }).toMatchObject({
        report: {
          kind: 'report',
          code: WebRpcErrorCode.internal,
          error: {
            name: 'WebRpcContractError',
            source: '@migaia/web-rpc',
            code: WebRpcErrorCode.contractInvalid,
            message: expect.any(String),
            stack: expect.any(String)
          }
        },
        response: {
          kind: 'response',
          id: 'r70-transfer-overflow',
          code: WebRpcErrorCode.internal,
          error: {
            name: reportError?.name,
            source: reportError?.source,
            code: reportError?.code,
            message: reportError?.message,
            stack: reportError?.stack
          }
        },
        terminal: {
          activeSubscriptions: 0,
          providerState: { admission: 0, replay: 0, activeControllers: 0 },
          kernelState: 'disposed',
          kernelOwners: [],
          kernelRoutes: [],
          resources: 0
        }
      })
    } finally {
      unsubscribe()
      await fixture.dispose()
    }
  })

  it('T181 canonical endpoint disposal preserves Promise identity and terminal provider residue', async () => {
    const [clientTransport, serverTransport] = createMemoryTransportPair()
    const primary = new Error('R70 canonical provider failure')
    const server = await createProviderEndpoint({
      id: 'r70-canonical-provider',
      transport: serverTransport,
      middlewares: [connect({ transport: serverTransport })],
      provider: {
        fail: () => {
          throw primary
        }
      }
    })
    const client = await createClientEndpoint({
      id: 'r70-canonical-client',
      transport: clientTransport,
      targetIds: ['r70-canonical-provider'],
      middlewares: [connect({ transport: clientTransport })]
    })
    try {
      await expect(client.send('r70-canonical-provider', 'fail', null)).rejects.toMatchObject({
        code: WebRpcErrorCode.internal
      })
      const endpointDispose = server.dispose()
      expect(server.dispose()).toBe(endpointDispose)
      await expect(endpointDispose).resolves.toBeUndefined()
      const observed = readComposedDisposalPromises(server)
      expect(observed?.endpoint).toBe(endpointDispose)
      expect(observed?.host).toBeInstanceOf(Promise)
      expect(readComposedDisposalPromises(server)?.host).toBe(observed?.host)
      expect(readEndpointDebugSnapshot(server)).toMatchObject({
        phase: 'disposed',
        activeControllers: 0,
        providerState: { admission: 0, replay: 0 },
        providers: 0,
        events: 0,
        resources: 0
      })
    } finally {
      await client.dispose()
      await server.dispose()
    }
  })

  it('T214 owned provider transport closes once after successful canonical disposal', async () => {
    const [, baseTransport] = createMemoryTransportPair()
    let closeCalls = 0
    const transport: IWebRpcTransport = {
      ...baseTransport,
      ownership: 'owned',
      close: () => {
        closeCalls += 1
      }
    }
    const endpoint = await createProviderEndpoint({
      id: 'r72-owned-transport',
      transport,
      middlewares: [connect({ transport })],
      provider: { echo: (context) => context.success('owned') }
    })
    const dispose = endpoint.dispose()
    expect(endpoint.dispose()).toBe(dispose)
    await dispose
    expect(closeCalls).toBe(1)
    const observed = readComposedDisposalPromises(endpoint)
    expect(observed?.endpoint).toBe(dispose)
    expect(observed?.host).toBeInstanceOf(Promise)
    expect(observed?.host).toBe(observed?.endpoint)
    expect(readComposedDisposalPromises(endpoint)).toBe(observed)
    const terminal = readEndpointDebugSnapshot(endpoint)
    expect(terminal).toMatchObject({
      phase: 'disposed',
      pending: 0,
      pingPending: 0,
      providers: 0,
      providerState: { admission: 0, replay: 0 },
      activeControllers: 0,
      chunks: 0,
      events: 0,
      hooks: 0,
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
      },
      resources: 0
    })
    expect(endpoint.dispose()).toBe(dispose)
    expect(closeCalls).toBe(1)
    expect(readComposedDisposalPromises(endpoint)).toBe(observed)
    expect(readEndpointDebugSnapshot(endpoint)).toEqual(terminal)
  })

  it('T215 borrowed provider transport remains open after repeated canonical disposal', async () => {
    const [, baseTransport] = createMemoryTransportPair()
    let closeCalls = 0
    const transport: IWebRpcTransport = {
      ...baseTransport,
      ownership: 'borrowed',
      close: () => {
        closeCalls += 1
      }
    }
    const endpoint = await createProviderEndpoint({
      id: 'r72-borrowed-transport',
      transport,
      middlewares: [connect({ transport })],
      provider: { echo: (context) => context.success('borrowed') }
    })
    const dispose = endpoint.dispose()
    expect(endpoint.dispose()).toBe(dispose)
    await dispose
    expect(closeCalls).toBe(0)
    const observed = readComposedDisposalPromises(endpoint)
    expect(observed?.endpoint).toBe(dispose)
    expect(observed?.host).toBeInstanceOf(Promise)
    expect(observed?.host).toBe(observed?.endpoint)
    expect(readComposedDisposalPromises(endpoint)).toBe(observed)
    const terminal = readEndpointDebugSnapshot(endpoint)
    expect(terminal).toMatchObject({
      phase: 'disposed',
      pending: 0,
      pingPending: 0,
      providers: 0,
      providerState: { admission: 0, replay: 0 },
      activeControllers: 0,
      chunks: 0,
      events: 0,
      hooks: 0,
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
      },
      resources: 0
    })
    expect(endpoint.dispose()).toBe(dispose)
    expect(closeCalls).toBe(0)
    expect(readComposedDisposalPromises(endpoint)).toBe(observed)
    expect(readEndpointDebugSnapshot(endpoint)).toEqual(terminal)
  })

  it('keeps one-way sender pending empty and releases receiver admission after physical delivery', async () => {
    const [clientTransport, baseServerTransport] = createMemoryTransportPair()
    /** Captures server-to-client physical sends; dispatch-only delivery must not emit responses. */
    const responseFrames: unknown[] = []
    const serverTransport: IWebRpcTransport = {
      ...baseServerTransport,
      send(message, options) {
        responseFrames.push(message)
        return baseServerTransport.send(message, options)
      }
    }
    /** Captures real provider invocation instead of treating a dropped frame as delivery. */
    const deliveries: unknown[] = []
    /** Holds receiver work long enough to observe its legitimate controller and admission lease. */
    let release!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    /** Signals that provider execution began through the canonical request route. */
    let started!: () => void
    const invoked = new Promise<void>((resolve) => {
      started = resolve
    })
    const server = await createProviderEndpoint({
      id: 'one-way-server',
      transport: serverTransport,
      middlewares: [connect({ transport: serverTransport })],
      provider: {
        notify: async (context) => {
          deliveries.push(context.data)
          started()
          await held
          return context.success(null)
        }
      }
    })
    const client = await createComposedEndpoint(
      {
        id: 'one-way-client',
        transport: clientTransport,
        targetIds: ['one-way-server'],
        middlewares: [connect({ transport: clientTransport })]
      },
      createNativeRoots('first-party-one-way')
    )
    try {
      const sent = client.sendOneWay('one-way-server', 'notify', 'payload')
      await invoked
      expect(deliveries).toEqual(['payload'])
      await vi.waitFor(() => expect(readEndpointDebugSnapshot(client)?.pending).toBe(0))
      expect(readEndpointDebugSnapshot(server)?.providerState?.admission).toBeGreaterThan(0)
      expect(readEndpointDebugSnapshot(server)?.activeControllers).toBeGreaterThan(0)
      expect(responseFrames).toEqual([])
      release()
      await expect(sent).resolves.toBeUndefined()
      await vi.waitFor(() =>
        expect(readEndpointDebugSnapshot(server)?.providerState?.admission).toBe(0)
      )
      expect(readEndpointDebugSnapshot(server)?.activeControllers).toBe(0)
      expect(responseFrames).toEqual([])
    } finally {
      release()
      await Promise.all([client.dispose(), server.dispose()])
    }
  })

  it('preserves a physical one-way rejection before a later delivery', async () => {
    /** Supplies the underlying delivery pair while permitting one controlled client send failure. */
    const [baseClientTransport, serverTransport] = createMemoryTransportPair()
    /** Is the exact physical transport failure that must remain reachable through the rejection. */
    const physicalFailure = new Error('one-way physical send failed')
    /** Controls whether the next client physical send fails before memory transport delivery. */
    let rejectPhysicalSend = true
    /** Injects the controlled rejection without changing the canonical memory peer setup. */
    const clientTransport: IWebRpcTransport = {
      ...baseClientTransport,
      send(message, options) {
        if (rejectPhysicalSend) return Promise.reject(physicalFailure)
        return baseClientTransport.send(message, options)
      }
    }
    /** Records provider execution to prove the Good retry delivered a real request. */
    const deliveries: unknown[] = []
    const server = await createProviderEndpoint({
      id: 'one-way-rejection-server',
      transport: serverTransport,
      middlewares: [connect({ transport: serverTransport })],
      provider: {
        notify: (context) => {
          deliveries.push(context.data)
          return context.success(null)
        }
      }
    })
    const client = await createComposedEndpoint(
      {
        id: 'one-way-rejection-client',
        transport: clientTransport,
        targetIds: ['one-way-rejection-server'],
        middlewares: [connect({ transport: clientTransport })]
      },
      createNativeRoots('first-party-one-way')
    )
    try {
      /** Captures the rejected one-way result for precise wrapper/cause identity assertions. */
      const failure = await client.sendOneWay('one-way-rejection-server', 'notify', 'failed').then(
        () => undefined,
        (error: unknown) => error
      )
      expect(failure).toMatchObject({ code: WebRpcErrorCode.transport })
      expect((failure as { cause?: unknown }).cause).toBe(physicalFailure)
      expect(readEndpointDebugSnapshot(client)?.pending).toBe(0)

      rejectPhysicalSend = false
      await expect(
        client.sendOneWay('one-way-rejection-server', 'notify', 'delivered')
      ).resolves.toBeUndefined()
      await vi.waitFor(() => expect(deliveries).toEqual(['delivered']))
      expect(readEndpointDebugSnapshot(client)?.pending).toBe(0)
    } finally {
      await Promise.all([client.dispose(), server.dispose()])
    }
  })
})
