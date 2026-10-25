/** Native disposal retains C157's completion, cleanup leaf and actual RPC resource ownership. */
import { Session as InspectorSession } from 'node:inspector/promises'
import type { Runtime } from 'node:inspector'
import { LifecycleState } from '@migaia/lifecycle'
import { defineHost, definePlugin } from '@migaia/plugin-host'
import { rpcHostPipelines } from '@migaia/rpc-host/sdk'
import { walkErrorCauses } from '@migaia/utils/error'
import { assert, expect, it, vi } from 'vitest'
import { RpcHost } from '../../dist/host/rpc-host.js'
import { coreMemoryServer } from './core-fixture.js'

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
  async retain(carrierId: string): Promise<void> {
    /** Evaluate only the exact test-local reference, as in A17's existing fixed engine seam. */
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
    this.#index = await this.#entry(await this.#field(table, '#namespaces'), 'memory')
    /** The lifecycle scope is the exact resource owner installed by the SDK transport. */
    const registration = await this.#entry(await this.#field(this.#root, '#namespaces'), 'memory')
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
  async #entry(map: Runtime.RemoteObject, key: string): Promise<Runtime.RemoteObject> {
    /** This is a read of a built-in Map, never a call to a private production method. */
    const entry = await this.#inspector.post('Runtime.callFunctionOn', {
      objectId: map.objectId!,
      functionDeclaration: 'function(key){return this.get(key)}',
      arguments: [{ value: key }],
      objectGroup: inspectorRoot
    })
    if (entry.exceptionDetails || !entry.result.objectId)
      throw new Error('Native disposal owner entry is unavailable: ' + key)
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

/** Real native dispose is BC11#28's receiving boundary; public RpcRoot.close is not substituted. */
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
    (key) => host.pipeline(key),
    ['memory']
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
    /** BC11#28 removes the RPC translation shell while retaining original native error leaves. */
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

// RPC-TEST-FB075BDD690B-C157: native completion, original cleanup leaf and true current table0.
it(
  'native cleanup failure retains shared completion and empties actual RPC resource tables',
  nativeCleanupFailure
)
