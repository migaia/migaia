import { PassThrough } from 'node:stream'
import { RpcCodecId, RpcProtocol } from '@migaia/rpc-contract'
import { MessageChannel, type MessagePort } from 'node:worker_threads'
import { deferred } from '@migaia/utils/promise'
import { describe, expect, it, vi } from 'vitest'
import { createRpcHost } from '../../dist/index.js'
import { defineMessageAdapter, defineByteAdapter } from '../../dist/runtime-adapter/definition.js'
import { defineTransportPlugin } from '../../dist/plugin/define.js'
import {
  createAdapterDeployment,
  readAdapterDeployment,
  type IAdapterDeploymentContext,
  type IAdapterDeploymentRecipe
} from '../../dist/runtime-adapter/deployment.js'
import { createRuntimeEventByteIO } from '../../dist/runtime-adapter/byte/event-byte-io.js'
import { RPC_CORE_ERROR_SOURCE, RpcCoreErrorCode } from '../../dist/core/errors.js'
import type { IRuntimeProviderPolicy } from '../../dist/runtime-adapter/provider/governor.js'
import type { IRuntimePeerSourceResult } from '../../dist/remote/runtime-api/peer.js'
import type { IRuntimePeerProvide } from '../../dist/remote/runtime-api/catalog.js'
import type { IRpcHost } from '../../dist/host/types.js'
import type { IRpcProviderLimits } from '../../dist/core/typing.js'

/** Actual message ports feed the definition's canonical raw handshake and governor producer. */
const adapter = defineMessageAdapter({
  open: (port: MessagePort) => ({
    postMessage: (message: unknown) => port.postMessage(message),
    on: (event: string, listener: (...args: any[]) => void) => port.on(event, listener),
    off: (event: string, listener: (...args: any[]) => void) => port.off(event, listener)
  })
})

/** One real governed listener owns native ports, acceptance context and original session scope. */
class GovernedHost {
  /** The actual listener receives native session authority only during installation. */
  #context!: IAdapterDeploymentContext
  /** Each accepted raw channel enters the same original Host operation. */
  #accept!: (channel: IRuntimePeerSourceResult) => Promise<unknown>
  /** Original definition preparation receipts remain attached to their exact raw source results. */
  readonly #preparations = new WeakMap<IRuntimePeerSourceResult, IAdapterDeploymentRecipe>()
  /** Test-owned native message ports retire only after Host cleanup. */
  readonly #ports: MessagePort[] = []
  /** Actual accepted client Hosts retain their original close order and Promise behavior. */
  readonly #clients: IRpcHost<unknown>[] = []
  /** Real scoped byte sessions use the original canonical native event-stream owner. */
  readonly #byteAdapter = defineByteAdapter({
    open: (io: ReturnType<typeof createRuntimeEventByteIO>) => io,
    listen: (io: ReturnType<typeof createRuntimeEventByteIO>) => io
  })
  /** Authenticated reconnects share the same original principal quota/replay scope. */
  readonly #scope: ReturnType<ReturnType<typeof defineByteAdapter>['scope']> | undefined
  /** Native byte streams retire after their actual client/server Hosts close. */
  readonly #streams: PassThrough[] = []
  /** Message-governor policy keeps the original case-selected values and overrides. */
  readonly #policy: Partial<IRuntimeProviderPolicy>
  /** Original local providers are installed only by the canonical Host. */
  readonly #provide: IRuntimePeerProvide
  /** Global provider limits remain owned by the existing shared admission scope. */
  readonly #providerLimits: IRpcProviderLimits | undefined
  /** The sole real server Host is created during the original asynchronous fixture opening. */
  #host!: IRpcHost<unknown>
  /** Capture inputs and allocate only the original optional scope before native Host installation. */
  constructor(
    policy: Partial<IRuntimeProviderPolicy>,
    provide: IRuntimePeerProvide,
    scoped: boolean,
    providerLimits?: IRpcProviderLimits
  ) {
    this.#policy = policy
    this.#provide = provide
    this.#providerLimits = providerLimits
    this.#scope = scoped ? this.#byteAdapter.scope() : undefined
  }
  /** Install the real native listener and return the original own-method fixture shape. */
  async open() {
    /** Cold transport captures no private endpoint or alternate provider implementation. */
    const transport = defineTransportPlugin({
      name: 'governed-listener',
      mode: 'listen',
      deployment: createAdapterDeployment({
        open: async () => {
          throw new Error('listener only')
        },
        listen: this.#listen,
        prepareEndpoint: this.#prepareEndpoint
      })
    })
    this.#host = await createRpcHost({
      self: { name: 'server', instanceId: 'server' },
      plugins: [transport],
      provide: this.#provide,
      providerLimits: this.#providerLimits,
      report: () => undefined
    })
    return { host: this.#host, connect: this.#connect, close: this.#close }
  }
  /** Actual listener installation publishes only its original native inputs and close receipt. */
  readonly #listen: NonNullable<IAdapterDeploymentRecipe['listen']> = async (prepared, receive) => {
    this.#context = prepared
    this.#accept = receive
    return { close() {} }
  }
  /** Reuse the exact original raw definition's preparation authority for this accepted channel. */
  readonly #prepareEndpoint: NonNullable<IAdapterDeploymentRecipe['prepareEndpoint']> = (
    channel,
    limits
  ) => this.#preparations.get(channel)!.prepareEndpoint!(channel, limits)

  /** Open both original native sides concurrently, then retain the exact accepted client Host. */
  readonly #connect = async (name: string, principal = name) => {
    /** Physical source selection changes only the original case's message or scoped-byte profile. */
    const { source, clientDeployment } = this.#scope
      ? this.#byteConnection(name, principal)
      : this.#messageConnection(name)
    /** Join actual native acceptance without creating another endpoint or Peer readiness facade. */
    const accepted = deferred<void>()
    void source
      .open(this.#context)
      .then(async (channel) => {
        this.#preparations.set(channel, source)
        await this.#accept(channel)
      })
      .then(accepted.resolve, accepted.reject)
    /** Client Host startup remains concurrent with this same source's server handshake. */
    const opening = createRpcHost({
      self: { name, instanceId: name },
      plugins: [
        defineTransportPlugin({
          name: `${name}-transport`,
          mode: 'connect',
          connect: { timeoutMs: 1000 },
          deployment: clientDeployment
        })
      ],
      report: () => undefined
    })
    const [client] = await Promise.all([opening, accepted.promise])
    this.#clients.push(client)
    return client
  }
  /**
   * Create only the original two ordered native byte streams and their authenticated source
   * recipes.
   */
  #byteConnection(name: string, principal: string) {
    /** The two physical stream directions retain their original drain and destruction semantics. */
    const upstream = new PassThrough()
    /** Replies use the opposite original physical stream, never a synthetic frame transport. */
    const downstream = new PassThrough()
    this.#streams.push(upstream, downstream)
    /** This actual shared carrier close destroys both original physical byte directions. */
    const physical = {
      close() {
        upstream.destroy()
        downstream.destroy()
      }
    }
    /** Native EOF keeps the original package-owned error classification used by this fixture. */
    const diagnostic = {
      source: RPC_CORE_ERROR_SOURCE,
      code: RpcCoreErrorCode.transport,
      message: 'fixture stream closed'
    }
    /** Server and client each own one original canonical event-byte reader. */
    const serverIO = createRuntimeEventByteIO(upstream, downstream, physical, diagnostic)
    /** The opposite canonical reader consumes only the original reply stream. */
    const clientIO = createRuntimeEventByteIO(downstream, upstream, physical, diagnostic)
    /** The exact server definition alone grants preparation and authenticated scope provenance. */
    const source = readAdapterDeployment(
      this.#byteAdapter.deployment({
        listen: serverIO,
        peerId: name,
        scope: this.#scope,
        auth: { mode: 'required', verify: (auth) => String(auth) }
      })
    )!
    /** The real client offer retains this case's original authenticated principal. */
    const clientDeployment = createAdapterDeployment({
      open: (prepared) =>
        readAdapterDeployment(
          this.#byteAdapter.deployment({
            connect: clientIO,
            peerId: 'server',
            offer: {
              versions: [{ major: RpcProtocol.major, minor: RpcProtocol.minor }],
              codecs: [RpcCodecId.json],
              capabilities: prepared.capabilities,
              peer: { id: name, runtime: 'fixture' },
              auth: principal
            }
          })
        )!.open(prepared)
    })
    return { source, clientDeployment }
  }
  /** Create one actual native MessageChannel and the same original per-session governor policy. */
  #messageConnection(name: string) {
    /** Existing native ports keep independent physical send and close identity. */
    const pair = new MessageChannel()
    this.#ports.push(pair.port1, pair.port2)
    /** The original adapter creates both source recipes without constructing a complete Peer. */
    const clientDeployment = adapter.deployment({ connect: pair.port2, peerId: 'server' })
    /** Only this original server definition supplies its package-owned quota preparation. */
    const source = readAdapterDeployment(
      adapter.deployment({
        listen: pair.port1,
        peerId: name,
        governor: {
          maxCallsPerMinute: 1000,
          maxPayloadBytes: 4096,
          maxConsecutiveTimeouts: 10,
          idleTimeoutMs: 60_000,
          violationLimit: 10,
          overflow: {
            source: RPC_CORE_ERROR_SOURCE,
            code: RpcCoreErrorCode.overloaded,
            message: 'fixture quota exhausted'
          },
          ...this.#policy
        }
      })
    )!
    return { source, clientDeployment }
  }
  /**
   * Preserve original sequential client, server, native-port, byte-stream and scope retirement
   * order.
   */
  readonly #close = async (): Promise<void> => {
    try {
      for (const client of this.#clients) await client.close()
      await this.#host.close()
    } finally {
      for (const port of this.#ports) port.close()
      for (const stream of this.#streams) stream.destroy()
      this.#scope?.close()
    }
  }
}

/** Open the original real listener fixture with explicit native session ownership. */
async function governedHost(
  policy: Partial<IRuntimeProviderPolicy>,
  provide: IRuntimePeerProvide,
  scoped = false,
  providerLimits?: IRpcProviderLimits
) {
  return new GovernedHost(policy, provide, scoped, providerLimits).open()
}

describe('accepted host session provider policy', () => {
  it('shares the original global admission scope across two actual authenticated sessions', async () => {
    const started = deferred<void>()
    const release = deferred<void>()
    const onRejected = vi.fn()
    const business = vi.fn(async (value: unknown) => {
      if (value === 1) {
        started.resolve()
        await release.promise
      }
      return value
    })
    const fixture = await governedHost({}, { business }, true, {
      maxGlobal: 1,
      maxPerPeer: 1,
      onRejected
    })
    try {
      const first = await fixture.connect('first', 'principal-a')
      const second = await fixture.connect('second', 'principal-b')
      /** Native terminal writes finish after directory publication; retain their original lease. */
      await new Promise<void>((resolve) => setImmediate(resolve))
      const pending = first.request('business', 1)
      await Promise.race([started.promise, pending])
      await expect(second.request('business', 2)).rejects.toMatchObject({
        code: RpcCoreErrorCode.overloaded
      })
      expect(business).toHaveBeenCalledTimes(1)
      expect(onRejected).toHaveBeenCalledWith(expect.objectContaining({ reason: 'concurrency' }))
      release.resolve()
      expect(await pending).toBe(1)
      /** The actual writer's completion retires the original lease after terminal delivery. */
      await new Promise<void>((resolve) => setImmediate(resolve))
      expect(await second.request('business', 2)).toBe(2)
      expect(business).toHaveBeenCalledTimes(2)
    } finally {
      release.resolve()
      await fixture.close()
    }
  })

  it('reuses the original authenticated principal scope after reconnect and isolates a different principal', async () => {
    let effects = 0
    const business = vi.fn(() => ++effects)
    const fixture = await governedHost({}, { business }, true)
    try {
      const first = await fixture.connect('first', 'principal-a')
      expect(await first.request('business', 42, { idempotencyKey: 'one-effect' })).toBe(1)
      await first.close()
      const replacement = await fixture.connect('replacement', 'principal-a')
      expect(await replacement.request('business', 42, { idempotencyKey: 'one-effect' })).toBe(1)
      expect(business).toHaveBeenCalledTimes(1)
      const other = await fixture.connect('other', 'principal-b')
      expect(await other.request('business', 42, { idempotencyKey: 'one-effect' })).toBe(2)
      expect(business).toHaveBeenCalledTimes(2)
    } finally {
      await fixture.close()
    }
  })

  it('rejects oversized scalar and stream inputs before business starts while another session stays usable', async () => {
    const scalar = vi.fn((value: unknown) => value)
    const stream = vi.fn(async function* (value: unknown) {
      yield value
    })
    const fixture = await governedHost({}, { scalar, stream })
    try {
      const first = await fixture.connect('first')
      const second = await fixture.connect('second')
      await expect(first.request('scalar', 'x'.repeat(5000))).rejects.toMatchObject({
        code: RpcCoreErrorCode.overloaded
      })
      await expect(
        (first.stream('stream', 'x'.repeat(5000)) as AsyncIterableIterator<unknown>).next()
      ).rejects.toMatchObject({ code: RpcCoreErrorCode.overloaded })
      expect(scalar).not.toHaveBeenCalled()
      expect(stream).not.toHaveBeenCalled()
      expect(await second.request('scalar', 42)).toBe(42)
      const iterator = second.stream('stream', 7) as AsyncIterableIterator<unknown>
      expect(await iterator.next()).toMatchObject({ done: false, value: 7 })
      expect(await iterator.next()).toMatchObject({ done: true })
    } finally {
      await fixture.close()
    }
  })

  it('reserves an entire group in the original rate bucket and does not charge prepaid members twice', async () => {
    const business = vi.fn((value: unknown) => value)
    const fixture = await governedHost({ maxCallsPerMinute: 3 }, { business })
    try {
      const client = await fixture.connect('client')
      // Initial describe is the same registered provider call charged by the original governor.
      await expect(
        client.group([
          { method: 'business', payload: 1 },
          { method: 'business', payload: 2 },
          { method: 'business', payload: 3 }
        ])
      ).rejects.toMatchObject({ code: RpcCoreErrorCode.overloaded })
      expect(business).not.toHaveBeenCalled()
      expect(
        await client.group([
          { method: 'business', payload: 1 },
          { method: 'business', payload: 2 }
        ])
      ).toMatchObject([
        { state: 'success', result: 1 },
        { state: 'success', result: 2 }
      ])
      expect(business).toHaveBeenCalledTimes(2)
      await expect(client.request('business', 3)).rejects.toMatchObject({
        code: RpcCoreErrorCode.overloaded
      })
      expect(business).toHaveBeenCalledTimes(2)
    } finally {
      await fixture.close()
    }
  })
})
