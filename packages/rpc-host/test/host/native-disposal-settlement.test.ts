/** Native disposal retains C157's completion, cleanup leaf and actual RPC resource ownership. */
import { Session as InspectorSession } from 'node:inspector/promises'
import type { Runtime } from 'node:inspector'
import { LifecycleState } from '@migaia/lifecycle'
import { defineHost, definePlugin, type IPluginHostCore } from '@migaia/plugin-host'
import { createRpcHost } from '@migaia/rpc-host'
import { defineTransportPlugin, rpcHostPipelines } from '@migaia/rpc-host/sdk'
import type { IRpcCarrierReceiver } from '@migaia/rpc-contract/interfaces'
import { walkErrorCauses } from '@migaia/utils/error'
import { assert, expect, it, vi, type MockInstance as IMockInstance } from 'vitest'
import { RpcHost } from '../../dist/host/rpc-host.js'
import { coreMemoryServer } from './core-fixture.js'
import { MemoryCarrier } from '../fixtures/core-carrier.js'

/** Only this test temporarily retains the actual ordinary RPC owner for engine observation. */
const inspectorRoot = '__rpcNativeDisposalOwner'
/** Node returns private descriptors beyond its bundled public inspector declaration. */
type IProperties = Runtime.GetPropertiesReturnType & {
  privateProperties?: readonly { name: string; value?: Runtime.RemoteObject }[]
}

/** Read only C157's fixed current work tables and retained original Session/resource scope. */
class DisposalInspector {
  /** The in-process engine session opens no external debugging listener. */
  readonly #inspector = new InspectorSession()
  /** The real ordinary owner remains borrowed until the final resource sample. */
  #root: Runtime.RemoteObject | undefined
  /** Retaining the original Session permits checking control cleanup after its table removes it. */
  #session: Runtime.RemoteObject | undefined
  /** The original namespace index contains actual accepted names and readiness waiters. */
  #index: Runtime.RemoteObject | undefined
  /** The actual registration resource scope outlives removal of its public namespace entry. */
  #resources: Runtime.RemoteObject | undefined

  /** No private method is invoked or replaced; this reference came from genuine SDK install. */
  constructor(owner: RpcHost) {
    ;(globalThis as unknown as Record<string, unknown>)[inspectorRoot] = owner
    this.#inspector.connect()
  }

  /** Capture true owner references while their original native registration is still live. */
  async retain(carrierId: string, pending = false): Promise<void> {
    /** Evaluate only the exact test-local reference, as in existing fixed engine seam. */
    const evaluated = await this.#inspector.post('Runtime.evaluate', {
      expression: 'globalThis[' + JSON.stringify(inspectorRoot) + ']',
      objectGroup: inspectorRoot
    })
    if (evaluated.exceptionDetails || !evaluated.result.objectId)
      throw new Error('Native disposal RPC owner is unavailable to the inspector')
    this.#root = evaluated.result
    /** Real maps lend their original values through Map.get; no owner execution is synthesized. */
    const table = await this.#field(this.#root, '#sessions')
    this.#session = await this.#entry(await this.#field(table, '#sessions'), carrierId)
    /** The lifecycle scope is the exact resource owner installed by the SDK transport. */
    const registration = await this.#entry(
      await this.#field(this.#root, pending ? '#pendingNamespaces' : '#namespaces'),
      'memory'
    )
    /** A failed native batch keeps its genuine staged index private until rollback completes. */
    const scope = await this.#field(registration, 'sessionScope')
    const staged = await this.#entry(await this.#field(table, '#scopes'), scope)
    this.#index = await this.#field(staged, 'index')
    this.#resources = await this.#field(registration, 'resources')
  }

  /** Calibrate the physical resource before disposal, rather than accepting a cold fixture as0. */
  async sessions(): Promise<number> {
    return this.#size(await this.#field(this.#root!, '#sessions'), '#sessions')
  }

  /** Every count comes from an actual current Map/Set; missing fields fail instead of becoming0. */
  async residue(): Promise<Record<string, number | boolean | string>> {
    /** These are the canonical work owners used by real calls and provider dispatch. */
    const calls = await this.#field(this.#root!, '#calls')
    const streams = await this.#field(this.#root!, '#streams')
    const providers = await this.#field(this.#root!, '#providers')
    const sessions = await this.#field(this.#root!, '#sessions')
    /** A public lifecycle getter observes the borrowed scope; it cannot release resources. */
    const lifecycle = await this.#inspector.post('Runtime.callFunctionOn', {
      objectId: this.#resources!.objectId!,
      functionDeclaration: 'function(){return this.lifecycle}',
      returnByValue: true
    })
    if (lifecycle.exceptionDetails || typeof lifecycle.result.value !== 'string')
      throw new Error('Native disposal resource lifecycle is unavailable')
    return {
      pending: await this.#size(calls, '#records'),
      callSources: await this.#size(calls, '#bySource'),
      callInvocations: await this.#size(calls, '#invocations'),
      incoming: await this.#size(providers, '#incoming'),
      ordered: await this.#size(await this.#field(providers, '#ordering'), '#ordered'),
      nativeCatalogs: await this.#size(providers, '#native'),
      localMethods: await this.#size(await this.#field(providers, '#global'), 'methods'),
      consumers: await this.#size(streams, '#consumers'),
      producers: await this.#size(streams, '#producers'),
      activeConsumers: await this.#size(streams, '#activeConsumers'),
      activeProducers: await this.#size(streams, '#activeProducers'),
      sessions: await this.#size(sessions, '#sessions'),
      accepted: await this.#size(sessions, '#accepted'),
      reserved: await this.#size(sessions, '#reserved'),
      nativeGenerations: await this.#size(sessions, '#nativeGenerations'),
      globalNames: await this.#size(sessions, '#globalNames'),
      draining: await this.#size(await this.#field(sessions, '#draining'), '#records'),
      peers: await this.#size(this.#index!, 'peers'),
      names: await this.#size(this.#index!, 'names'),
      probing: await this.#size(this.#index!, 'probing'),
      pendingPeers: await this.#size(this.#index!, 'pendingPeers'),
      waiters: await this.#size(this.#index!, 'waiting'),
      pingPending: await this.#size(this.#session!, '#controls'),
      namespaceRegistrations: await this.#size(this.#root!, '#namespaces'),
      pendingNamespaces: await this.#size(this.#root!, '#pendingNamespaces'),
      subscribed: (await this.#field(this.#session!, '#unsubscribe')).type !== 'undefined',
      handshakeTimer: (await this.#field(this.#session!, '#handshakeTimer')).type !== 'undefined',
      resourcesLifecycle: lifecycle.result.value
    }
  }

  /** Only Map.get reads the already selected registration, namespace index or physical Session. */
  async #entry(
    map: Runtime.RemoteObject,
    key: string | Runtime.RemoteObject
  ): Promise<Runtime.RemoteObject> {
    /** This is a read of a built-in Map, never a call to a private production method. */
    const entry = await this.#inspector.post('Runtime.callFunctionOn', {
      objectId: map.objectId!,
      functionDeclaration: 'function(key){return this.get(key)}',
      arguments: [typeof key === 'string' ? { value: key } : { objectId: key.objectId! }],
      objectGroup: inspectorRoot
    })
    if (entry.exceptionDetails || !entry.result.objectId)
      throw new Error('Native disposal owner entry is unavailable')
    return entry.result
  }

  /** Read an existing private or own-data descriptor without running an owning class method. */
  async #field(object: Runtime.RemoteObject, name: string): Promise<Runtime.RemoteObject> {
    /** Fixed field names above belong to current canonical owners, not legacy debug projections. */
    const properties: IProperties = await this.#inspector.post('Runtime.getProperties', {
      objectId: object.objectId!,
      ownProperties: true
    })
    /** Public records and native-private fields are both returned as genuine engine descriptors. */
    const field =
      properties.privateProperties?.find((property) => property.name === name) ??
      properties.result.find((property) => property.name === name)
    if (!field?.value) throw new Error('Native disposal owner field is unavailable: ' + name)
    return field.value
  }

  /** Read Node's actual collection size, accepting only a true Map or Set descriptor. */
  async #size(object: Runtime.RemoteObject, name: string): Promise<number> {
    /** The description is supplied by V8 for this exact retained native collection. */
    const collection = await this.#field(object, name)
    const match = /^(?:Map|Set)\((\d+)\)$/u.exec(collection.description ?? '')
    if (!match || (collection.subtype !== 'map' && collection.subtype !== 'set'))
      throw new Error('Native disposal owner collection is unavailable: ' + name)
    return Number(match[1])
  }

  /** Release all engine handles and the temporary Root reference even when an assertion fails. */
  async close(): Promise<void> {
    try {
      await this.#inspector.post('Runtime.releaseObjectGroup', { objectGroup: inspectorRoot })
    } finally {
      delete (globalThis as unknown as Record<string, unknown>)[inspectorRoot]
      this.#inspector.disconnect()
    }
  }
}

/** Real native dispose is #28's receiving boundary; public RpcRoot.close is not substituted. */
async function nativeCleanupFailure(): Promise<void> {
  /** The original sole cleanup leaf is neither reconstructed nor annotated by this receiver. */
  const cleanup = new Error('cycle-l discovery cleanup failed')
  /** Only the original registration's actual disposer records execution and throws the leaf. */
  const release = vi.fn(() => {
    throw cleanup
  })
  /** The real cold namespace reuses the existing physical memory carrier and handshake. */
  const server = coreMemoryServer('cycle-l-discovery-cleanup')
  /** The helper lends pipeline authority lazily from this exact native receiving Host. */
  const rpc = rpcHostPipelines(
    () => host,
    (key, request) => host.pipeline(key, request)
  )
  /** Native lifecycle and transaction owners remain unmodified, including disposal completion. */
  const host = defineHost({
    ...rpc,
    host: {
      identity: { name: 'cycle-l-discovery-cleanup' },
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
    }
  })
  /** A passthrough spy borrows the actual ordinary RPC Root, not a fake kernel or debug facade. */
  const installation = vi.spyOn(RpcHost.prototype, 'install')
  /** This actual native resource replaces only the deleted configuration middleware spelling. */
  const plugin = definePlugin({
    name: 'cycle-l-cleanup-observer',
    install(core) {
      core.onDispose(release)
      return {}
    }
  })
  /** Acquisition and inspector cleanup remain safe even if the real native installation rejects. */
  let inspector: DisposalInspector | undefined
  /** The public remote Root only owns its independent original physical endpoint. */
  let connected: Awaited<ReturnType<typeof server.connect>> | undefined
  try {
    await host.use(server.transport, plugin)
    expect(installation.mock.contexts).toHaveLength(1)
    /** Actual SDK installation supplied this genuine owner through its original method receiver. */
    const owner = installation.mock.contexts[0]
    assert(owner instanceof RpcHost)
    installation.mockRestore()
    connected = await server.connect('cycle-l-peer')
    inspector = new DisposalInspector(owner)
    await inspector.retain(connected.pair[0].id)
    expect(await inspector.sessions()).toBe(1)
    /** The canonical native promise is observed before, during and after the failed cleanup. */
    const firstDispose = host.dispose()
    expect(host.dispose()).toBe(firstDispose)
    /** #28 removes the RPC translation shell while retaining original native error leaves. */
    const result = await firstDispose
    expect(result.logicalTerminal).toBe(true)
    expect(result.cleanupComplete).toBe(true)
    expect(result.cleanupErrors).toHaveLength(1)
    expect(Array.from(walkErrorCauses(result.cleanupErrors[0]))).toContain(cleanup)
    expect(release).toHaveBeenCalledTimes(1)
    expect(host.dispose()).toBe(firstDispose)
    await expect(firstDispose).resolves.toBe(result)
    expect(connected.pair[0].closed).toBe(true)
    expect(connected.pair[0].unsubscribed).toBe(1)
    expect(await inspector.residue()).toEqual({
      pending: 0,
      callSources: 0,
      callInvocations: 0,
      incoming: 0,
      ordered: 0,
      nativeCatalogs: 0,
      localMethods: 0,
      consumers: 0,
      producers: 0,
      activeConsumers: 0,
      activeProducers: 0,
      sessions: 0,
      accepted: 0,
      reserved: 0,
      nativeGenerations: 0,
      globalNames: 0,
      draining: 0,
      peers: 0,
      names: 0,
      probing: 0,
      pendingPeers: 0,
      waiters: 0,
      pingPending: 0,
      namespaceRegistrations: 0,
      pendingNamespaces: 0,
      subscribed: false,
      handshakeTimer: false,
      resourcesLifecycle: LifecycleState.terminal
    })
  } finally {
    installation.mockRestore()
    try {
      await host.dispose()
      await connected?.host.close()
    } finally {
      await inspector?.close()
    }
  }
}

// Native completion, original cleanup leaf and true current table0.
it(
  'native cleanup failure retains shared completion and empties actual RPC resource tables',
  nativeCleanupFailure
)

/** Original fixture resources were native scope.own markers, not auth/connect algorithms. */
type ICleanupEntry = Readonly<{ kind: string; instance: unknown }>
/** One original application resource has exactly one native-owned release callback. */
type IOwnedResource = Readonly<{
  resource: object
  release: ReturnType<typeof vi.fn>
}>

/** Keep original resource callback identity/order without recreating deleted RPC role plugins. */
class NativeResources {
  /** The actual native core owns these callbacks; this array records no lifecycle state. */
  readonly records: readonly IOwnedResource[]
  /** A real native registration supplies the same ownership API used by the old injected scope. */
  readonly plugin

  /** Retain the two/three original marker vectors, or the endpoint branch's sole cleanup marker. */
  constructor(trace: ICleanupEntry[], count: 1 | 2 | 3, failures: readonly Error[] = []) {
    /** This fixed bound is the original case vector, not a growable resource manager. */
    const records: IOwnedResource[] = []
    for (let index = 0; index < count; index++)
      records.push(this.#record(trace, `resource.${index + 1}`, failures[index]))
    this.records = records
    this.plugin = definePlugin({ name: 'original-native-owned-resources', install: this.#install })
  }

  /** Register original callbacks directly; the canonical native scope alone disposes them. */
  readonly #install = (core: IPluginHostCore) => {
    for (const record of this.records) core.onDispose(record.release)
    return {}
  }

  /** The original marker resource and optional original error remain exact callback inputs. */
  #record(trace: ICleanupEntry[], kind: string, failure?: Error): IOwnedResource {
    /** One explicit observation context avoids a synthetic scope or replacement cleanup engine. */
    const operation = { trace, kind, resource: {}, failure }
    return {
      resource: operation.resource,
      release: vi.fn(() => {
        operation.trace.push({ kind: operation.kind, instance: operation.resource })
        if (operation.failure) throw operation.failure
      })
    }
  }
}

/** Passthrough observations keep actual subscription cleanup and real native physical close. */
class PhysicalCleanup {
  /** The existing medium retains all handshake, delivery, close and subscription behavior. */
  readonly carrier: MemoryCarrier
  /** The actual subscription remains independently countable before and after disposal. */
  readonly subscribed: IMockInstance<MemoryCarrier['subscribe']>
  /** Native close runs before an injected physical error, so no resource release is faked. */
  readonly closed: IMockInstance<MemoryCarrier['close']>
  /** The exact remover is the one returned to the actual Session subscription. */
  unsubscribe: (() => void) | undefined
  /** The original native method needs its actual private-field receiver. */
  readonly #subscribe: MemoryCarrier['subscribe']
  /** This bound arrow is the original physical close, not a replacement no-op. */
  readonly #close: MemoryCarrier['close']
  /** Only actual physical operations append to this shared case observation. */
  readonly #trace: ICleanupEntry[]
  /** A selected native physical release can fail after completing its actual close. */
  readonly #failure: Error | undefined

  /** Install passive observations before either original Session can acquire the carrier. */
  constructor(name: string, trace: ICleanupEntry[], failure?: Error) {
    this.carrier = new MemoryCarrier(name)
    this.#subscribe = this.carrier.subscribe
    this.#close = this.carrier.close
    this.#trace = trace
    this.#failure = failure
    this.subscribed = vi.spyOn(this.carrier, 'subscribe').mockImplementation(this.#observeSubscribe)
    this.closed = vi.spyOn(this.carrier, 'close').mockImplementation(this.#observeClose)
  }

  /** Preserve the real native receiver and lend its exact observed remover to Session. */
  readonly #observeSubscribe = (receiver: IRpcCarrierReceiver): (() => void) => {
    /** Reflect.apply retains the original method's native #private receiver without binding it. */
    const remove = Reflect.apply(this.#subscribe, this.carrier, [receiver])
    /** Only this observation context is retained by the actual subscription remover. */
    const operation = { trace: this.#trace, remove }
    /** Session receives this exact callback; invoking it delegates to the genuine native remover. */
    const unsubscribe = () => {
      operation.trace.push({ kind: 'unsubscribe', instance: unsubscribe })
      operation.remove()
    }
    this.unsubscribe = unsubscribe
    return unsubscribe
  }

  /** Record the genuine close callback identity and keep any original failure reachable. */
  readonly #observeClose = async (reason?: unknown): Promise<void> => {
    this.#trace.push({ kind: 'physical.close', instance: this.carrier.close })
    await this.#close(reason)
    if (this.#failure) throw this.#failure
  }

  /** Observation teardown never closes a borrowed owner or mutates the actual cleanup outcome. */
  restore(): void {
    this.subscribed.mockRestore()
    this.closed.mockRestore()
  }
}

/** Construct the one genuine native host and its declared namespace pipelines. */
function nativeResourceHost(name: string) {
  /** The lazy authority and all pipeline reads belong to this exact native owner. */
  const rpc = rpcHostPipelines(
    () => host,
    (key, request) => host.pipeline(key, request)
  )
  /** Native scopes, rollback and terminal completion remain the actual implementation. */
  const host = defineHost({
    ...rpc,
    host: {
      identity: { name },
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
    }
  })
  return host
}

/** A direct attached Session has no independently acquired listener to release. */
function noSeparateListener(): void {}

/** One bounded original vector borrows native lifecycle, existing memory media and fixed inspection. */
class NativeOrderCase {
  /** Original cleanup callbacks and real physical operations share one observation sequence. */
  readonly trace: ICleanupEntry[] = []
  /** Only the native registration owns these original marker resource releases. */
  readonly resources: NativeResources
  /** The actual carrier, unsubscribe receipt and native close remain separate ownership facts. */
  readonly physical: PhysicalCleanup
  /** A genuine listener lends its existing public native attach port. */
  readonly server
  /** One actual receiving host owns the original SDK/native batch and stable dispose completion. */
  readonly host
  /** The independently created remote Root owns only its original opposite physical endpoint. */
  #remote: Readonly<{ close(reason?: unknown): Promise<void> }> | undefined
  /** The existing local inspector retains the genuine Root and actual pre-close resources. */
  #inspector: DisposalInspector | undefined

  /** No test-side lifecycle scope, error translator, role registry or runner is created here. */
  constructor(
    name: string,
    count: 1 | 2 | 3,
    failures: readonly Error[] = [],
    physicalFailure?: Error
  ) {
    this.resources = new NativeResources(this.trace, count, failures)
    this.physical = new PhysicalCleanup(name + '-physical', this.trace, physicalFailure)
    this.server = coreMemoryServer(name)
    this.host = nativeResourceHost(name)
  }

  /** Open genuine accepted Sessions; known actual carriers let observers retain exact identities. */
  async open(): Promise<void> {
    /** The SDK invokes this method unchanged and lends its actual ordinary Root receiver. */
    const installation = vi.spyOn(RpcHost.prototype, 'install')
    try {
      await this.host.use(this.resources.plugin, this.server.transport)
      expect(installation.mock.contexts).toHaveLength(1)
      /** A genuine native receiver is required before any inspector is created. */
      const owner = installation.mock.contexts[0]
      assert(owner instanceof RpcHost)
      this.#inspector = new DisposalInspector(owner)
    } finally {
      installation.mockRestore()
    }
    /** This opposite endpoint is the existing MemoryCarrier, not a replacement medium. */
    const remote = new MemoryCarrier(this.physical.carrier.id + '-remote')
    this.physical.carrier.link(remote)
    remote.link(this.physical.carrier)
    /** One context object lends the already installed listener and original physical endpoints. */
    const connection = { server: this.server, local: this.physical.carrier, remote }
    /** Both original subscriptions happen synchronously before either asynchronous hello writes. */
    const transport = defineTransportPlugin({
      name: 'resource-order-remote',
      namespace: 'memory',
      async open(context) {
        const accepted = connection.server.accept(connection.local)
        const connected = context.attach(connection.remote)
        await Promise.all([accepted.ready, connected.ready])
        return { dispose: noSeparateListener }
      }
    })
    this.#remote = await createRpcHost({
      self: {
        name: this.physical.carrier.id + '-remote',
        instanceId: this.physical.carrier.id + '-remote'
      },
      plugins: [transport],
      report: () => undefined
    })
    await this.#inspector!.retain(this.physical.carrier.id)
    expect(await this.#inspector!.sessions()).toBe(1)
  }

  /** A later real native participant rejects the same batch after actual Session acquisition. */
  async rollback(primary: Error): Promise<unknown> {
    /** The spy is passive and only borrows the genuine actual install receiver. */
    const installation = vi.spyOn(RpcHost.prototype, 'install')
    /** The source retains only this original observation context during its real open callback. */
    const operation = { test: this, installation }
    /** Pending real media must still unsubscribe/close when the actual batch rolls back. */
    const transport = defineTransportPlugin({
      name: 'rollback-resource-source',
      namespace: 'memory',
      async open(context) {
        context.attach(operation.test.physical.carrier)
        /** The Root registered its actual pending namespace before invoking this original open. */
        const owner = operation.installation.mock.contexts[0]
        assert(owner instanceof RpcHost)
        operation.test.#inspector = new DisposalInspector(owner)
        await operation.test.#inspector.retain(operation.test.physical.carrier.id, true)
        expect(await operation.test.#inspector.sessions()).toBe(1)
        return { dispose: noSeparateListener }
      }
    })
    /** This is a real native install primary, independent from all cleanup callbacks. */
    const activation = definePlugin({
      name: 'later-native-participant',
      install: () => {
        throw primary
      }
    })
    try {
      return await this.host
        .use(this.resources.plugin, transport, activation)
        .catch((error: unknown) => error)
    } finally {
      installation.mockRestore()
      await this.host.dispose()
    }
  }

  /** Preserve actual callback/resource identity, exactly-once native release and the new full order. */
  expectReleases(): void {
    expect(this.physical.subscribed).toHaveBeenCalledTimes(1)
    expect(this.physical.closed).toHaveBeenCalledTimes(1)
    expect(this.physical.carrier.unsubscribed).toBe(1)
    expect(this.physical.carrier.closed).toBe(true)
    expect(this.trace.find((entry) => entry.kind === 'unsubscribe')?.instance).toBe(
      this.physical.unsubscribe
    )
    expect(this.physical.unsubscribe).toEqual(expect.any(Function))
    expect(this.trace.find((entry) => entry.kind === 'physical.close')?.instance).toBe(
      this.physical.carrier.close
    )
    /** At most three original callbacks exist; their real native scope releases them in reverse. */
    const kinds = ['unsubscribe', 'physical.close']
    for (let index = this.resources.records.length - 1; index >= 0; index--) {
      const record = this.resources.records[index]!
      expect(record.release).toHaveBeenCalledTimes(1)
      expect(this.trace.find((entry) => entry.kind === `resource.${index + 1}`)?.instance).toBe(
        record.resource
      )
      kinds.push(`resource.${index + 1}`)
    }
    expect(this.trace.map((entry) => entry.kind)).toEqual(kinds)
  }

  /** Count the original current owners, including retained scope and Session after table removal. */
  async expectResidue(): Promise<void> {
    assert(this.#inspector)
    expect(Reflect.get(this.host, 'memory')).toBeUndefined()
    /** Every fixed field must exist; the inspector cannot manufacture absent counters as0. */
    const residue = await this.#inspector.residue()
    for (const [name, value] of Object.entries(residue))
      expect(value, name).toBe(
        name === 'resourcesLifecycle'
          ? LifecycleState.terminal
          : typeof value === 'number'
            ? 0
            : false
      )
  }

  /** Final cleanup joins genuine owners and then removes only this case's passive observations. */
  async close(): Promise<void> {
    try {
      await this.host.dispose()
      await this.#remote?.close()
    } finally {
      try {
        await this.#inspector?.close()
      } finally {
        this.physical.restore()
      }
    }
  }
}

/** Select only exact original leaf instances from real native error graphs, preserving their order. */
function cleanupLeaves(errors: readonly unknown[], expected: readonly Error[]): unknown[] {
  /** This set selects identities only; no error is reconstructed, rewritten or re-ordered. */
  const identities = new Set(expected)
  /** Preserve the native summary's observed graph order without rebuilding any error container. */
  const leaves: unknown[] = []
  for (const error of errors)
    for (const value of walkErrorCauses(error))
      if (identities.has(value as Error)) leaves.push(value)
  return leaves
}

// C038 success: native callback identity/reverse order and actual physical release stay observable.
it('C038 native success preserves callback identities and stable final completion', async () => {
  /** The original two marker callbacks remain distinct resources under the actual native scope. */
  const test = new NativeOrderCase('native-two-resource-success', 2)
  try {
    await test.open()
    const firstDispose = test.host.dispose()
    expect(test.host.dispose()).toBe(firstDispose)
    const result = await firstDispose
    expect(result.cleanupErrors).toEqual([])
    expect(result.logicalTerminal).toBe(true)
    expect(test.host.dispose()).toBe(firstDispose)
    test.expectReleases()
    await test.expectResidue()
  } finally {
    await test.close()
  }
})

// C038 rollback: a real native batch failure releases its actual acquired media and original callbacks.
it('C038 later native failure preserves primary and releases the original callbacks once', async () => {
  /** The exact install primary cannot be replaced by rollback's source cleanup. */
  const primary = new Error('teardown rollback primary')
  /** Both original marker callbacks belong to the same actual failing native transaction. */
  const test = new NativeOrderCase('native-two-resource-rollback', 2)
  try {
    const failure = await test.rollback(primary)
    expect(failure).toMatchObject({ code: 'PLUGIN_INSTALL_FAILED', cause: primary })
    expect((failure as Error).cause).toBe(primary)
    test.expectReleases()
    await test.expectResidue()
  } finally {
    await test.close()
  }
})

// C140 branch1: the third owned callback is an application resource, never a fake outbound owner.
it('C140 native success releases all three original resources and empties actual owners', async () => {
  /** The original three resource callbacks remain independently identifiable and counted. */
  const test = new NativeOrderCase('native-three-resource-success', 3)
  try {
    await test.open()
    const firstDispose = test.host.dispose()
    expect(test.host.dispose()).toBe(firstDispose)
    await firstDispose
    expect(test.host.dispose()).toBe(firstDispose)
    test.expectReleases()
    await test.expectResidue()
  } finally {
    await test.close()
  }
})

// C140 branch2: physical release and all three original callback failures remain distinct real leaves.
it('C140 native cleanup retains all four original leaves in the actual close order', async () => {
  /** The original first marker's error remains distinct from the second, third and physical leaf. */
  const first = new Error('authentication cleanup failure')
  /** The original second marker was registered after the first and still releases before it. */
  const second = new Error('connect cleanup failure')
  /** The removed outbound role is not recreated; its owned callback's original leaf is retained. */
  const third = new Error('outbound cleanup failure')
  /** The actual physical owner throws this original native error after completing native close. */
  const physical = new Error('transport cleanup failure')
  /** True Session cleanup precedes application resource callbacks under the new native lifecycle. */
  const test = new NativeOrderCase('native-four-leaf-cleanup', 3, [first, second, third], physical)
  try {
    await test.open()
    const firstDispose = test.host.dispose()
    expect(test.host.dispose()).toBe(firstDispose)
    const result = await firstDispose
    expect(result.logicalTerminal).toBe(true)
    expect(cleanupLeaves(result.cleanupErrors, [physical, third, second, first])).toEqual([
      physical,
      third,
      second,
      first
    ])
    expect(test.host.dispose()).toBe(firstDispose)
    test.expectReleases()
    await test.expectResidue()
  } finally {
    await test.close()
  }
})

// C140 branch3 used the same deleted composed/native-dispose translator as C157, not Root.close.
it('C140 composed native boundary preserves both cleanup leaves and one completion', async () => {
  /** The original application-owned callback failure remains reachable by its exact identity. */
  const callback = new Error('endpoint outbound cleanup failure')
  /** The physical native owner independently closes and then exposes its original cleanup error. */
  const physical = new Error('endpoint transport cleanup failure')
  /** No RpcOutboundAttachment or dual endpoint/host Promise facade is recreated. */
  const test = new NativeOrderCase('native-two-leaf-completion', 1, [callback], physical)
  try {
    await test.open()
    const firstDispose = test.host.dispose()
    expect(test.host.dispose()).toBe(firstDispose)
    const result = await firstDispose
    expect(result.logicalTerminal).toBe(true)
    expect(cleanupLeaves(result.cleanupErrors, [physical, callback])).toEqual([physical, callback])
    expect(test.host.dispose()).toBe(firstDispose)
    await expect(firstDispose).resolves.toBe(result)
    test.expectReleases()
    await test.expectResidue()
  } finally {
    await test.close()
  }
})
