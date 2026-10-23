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
  type IAdapterDeployment,
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

/** One real listener's accepted channel retains the original definition preparation receipt. */
async function governedHost(
  policy: Partial<IRuntimeProviderPolicy>,
  provide: IRuntimePeerProvide,
  scoped = false,
  providerLimits?: IRpcProviderLimits
) {
  /** The native listener acquires these operations only during real plugin installation. */
  let context!: IAdapterDeploymentContext
  let accept!: (channel: IRuntimePeerSourceResult) => Promise<unknown>
  /** This fixture records the exact raw producer receipt; it creates no endpoint or provider. */
  const preparations = new WeakMap<IRuntimePeerSourceResult, IAdapterDeploymentRecipe>()
  /** Test-owned physical ports close after the actual host's cleanup, including rejected setup. */
  const ports: MessagePort[] = []
  const clients: IRpcHost<unknown>[] = []
  /** Authenticated scope fixtures use real ordered streams through the original byte owner. */
  const byteAdapter = defineByteAdapter({
    open: (io: ReturnType<typeof createRuntimeEventByteIO>) => io,
    listen: (io: ReturnType<typeof createRuntimeEventByteIO>) => io
  })
  const scope = scoped ? byteAdapter.scope() : undefined
  const streams: PassThrough[] = []
  const transport = defineTransportPlugin({
    name: 'governed-listener',
    mode: 'listen',
    deployment: createAdapterDeployment({
      open: async () => {
        throw new Error('listener only')
      },
      listen: async (prepared, receive) => {
        context = prepared
        accept = receive
        return { close() {} }
      },
      prepareEndpoint: (channel, limits) =>
        preparations.get(channel)!.prepareEndpoint!(channel, limits)
    })
  })
  const host = await createRpcHost({
    self: { name: 'server', instanceId: 'server' },
    plugins: [transport],
    provide,
    providerLimits,
    report: () => undefined
  })
  return {
    host,
    async connect(name: string, principal = name) {
      let source: IAdapterDeploymentRecipe
      let clientDeployment: IAdapterDeployment
      if (scope) {
        /** Both raw byte ends are actual native event streams, including drain/close ownership. */
        const upstream = new PassThrough()
        const downstream = new PassThrough()
        streams.push(upstream, downstream)
        const physical = {
          close() {
            upstream.destroy()
            downstream.destroy()
          }
        }
        const diagnostic = {
          source: RPC_CORE_ERROR_SOURCE,
          code: RpcCoreErrorCode.transport,
          message: 'fixture stream closed'
        }
        const serverIO = createRuntimeEventByteIO(upstream, downstream, physical, diagnostic)
        const clientIO = createRuntimeEventByteIO(downstream, upstream, physical, diagnostic)
        source = readAdapterDeployment(
          byteAdapter.deployment({
            listen: serverIO,
            peerId: name,
            scope,
            auth: { mode: 'required', verify: (auth) => String(auth) }
          })
        )!
        clientDeployment = createAdapterDeployment({
          open: (prepared) =>
            readAdapterDeployment(
              byteAdapter.deployment({
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
      } else {
        const pair = new MessageChannel()
        ports.push(pair.port1, pair.port2)
        clientDeployment = adapter.deployment({ connect: pair.port2, peerId: 'server' })
        source = readAdapterDeployment(
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
              ...policy
            }
          })
        )!
      }
      const accepted = deferred<void>()
      void source
        .open(context)
        .then(async (channel) => {
          preparations.set(channel, source)
          await accept(channel)
        })
        .then(accepted.resolve, accepted.reject)
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
      clients.push(client)
      return client
    },
    async close() {
      try {
        for (const client of clients) await client.close()
        await host.close()
      } finally {
        for (const port of ports) port.close()
        for (const stream of streams) stream.destroy()
        scope?.close()
      }
    }
  }
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
