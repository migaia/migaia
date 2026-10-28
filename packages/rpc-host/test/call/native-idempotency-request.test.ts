/**
 * Original keyed request custody, overlapping replay and retry failure retain genuine native
 * owners.
 */
import { MessageChannel, type MessagePort } from 'node:worker_threads'
import { expect, it, vi } from 'vitest'
import { deferred } from '@migaia/utils/promise'
import { createRpcHost, type IRpcHostOptions } from '@migaia/rpc-host'
import {
  createRpcBackingDigest,
  createRpcMessageCarrier,
  defineTransportPlugin,
  type IRpcMessageIO
} from '@migaia/rpc-host/sdk'
import type { IRpcCarrierWriteOptions } from '@migaia/rpc-contract/interfaces'
import type { IRpcEnvelope } from '@migaia/rpc-contract/protocol'
import { idempotency } from '@migaia/rpc-host/plugins/idempotency'
import { createRpcIdempotencyStore } from '@migaia/rpc-host/plugins/idempotency'
import { retry } from '@migaia/rpc-host/features/retry'
import { coreMemoryServer } from '../host/core-fixture.ts'
import { CallInvocation } from '../../dist/call/invocation.js'

/** Native postMessage owns transfer and subscription removal; SDK retains the only carrier. */
class KeyedMessageIO implements IRpcMessageIO {
  /** This exact real port owns detachment and every listener installed by its SDK carrier. */
  readonly #port: MessagePort

  /** Borrow the original native endpoint without constructing a parser, queue or request facade. */
  constructor(port: MessagePort) {
    this.#port = port
  }

  /** Native runtime receives the original transfer list at the real physical write boundary. */
  send(value: unknown, transfer?: readonly ArrayBuffer[], options?: IRpcCarrierWriteOptions): void {
    options?.onWriteStart?.()
    this.#port.postMessage(value, transfer)
  }

  /** The SDK receives only native messages and removes this same listener when it closes. */
  onMessage(listener: (value: unknown) => void): () => void {
    this.#port.on('message', listener)
    return () => {
      this.#port.off('message', listener)
    }
  }

  /** A native close carries no protocol reason; its exact listener has one original remover. */
  onClose(listener: (reason?: unknown) => void): () => void {
    /** Node's event argument is not an RPC error or a generated lifecycle reason. */
    const closed = () => listener()
    this.#port.on('close', closed)
    return () => {
      this.#port.off('close', closed)
    }
  }

  /** Native decoding failures remain with the same SDK error boundary. */
  onError(listener: (error: unknown) => void): () => void {
    this.#port.on('messageerror', listener)
    return () => {
      this.#port.off('messageerror', listener)
    }
  }

  /** The original port's physical close releases its native resources rather than a no-op owner. */
  close(): void {
    this.#port.close()
  }
}

/** Each public Host installs the actual feature, source, codec and original native endpoint. */
function keyedPortHost(port: MessagePort, name: string, provide?: IRpcHostOptions['provide']) {
  /** The canonical SDK alone performs binary preparation, framing, restore and physical transfer. */
  const carrier = createRpcMessageCarrier({
    id: name,
    io: new KeyedMessageIO(port),
    nativeBinary: true,
    digest: createRpcBackingDigest(),
    report: () => undefined
  })
  return createRpcHost({
    self: { name, instanceId: name },
    plugins: [
      idempotency(),
      defineTransportPlugin({
        name: `${name}-transport`,
        namespace: 'native',
        async open(context) {
          /** Session owns the attached carrier; this native source adds no second close path. */
          const session = context.attach(carrier)
          await session.ready
          return { dispose: () => undefined }
        }
      })
    ],
    provide,
    report: () => undefined
  })
}

// Exact original result, backing length and execution count.
it('retains the original keyed transfer result without detaching the provider backing', async () => {
  /** Original bytes and complete backing length are the retained public business vector. */
  const buffer = new Uint8Array([1, 2, 3])
  /** Only genuine provider execution advances the original effect count. */
  let calls = 0
  /** Real MessagePorts make an accidental transfer of provider storage observably destructive. */
  const channel = new MessageChannel()
  /** Both native endpoints must subscribe before their real asynchronous hellos can finish. */
  const opening = [
    keyedPortHost(channel.port1, 'keyed-transfer-client'),
    keyedPortHost(channel.port2, 'keyed-transfer-server', {
      bytes: (_payload, context) => {
        calls += 1
        return context.success(buffer, { transfer: [buffer.buffer] })
      }
    })
  ]
  try {
    /** These are public roots over the same two native endpoints, never legacy Peers. */
    const [client] = await Promise.all(opening)
    /** First completion and retained replay must traverse the same actual installed store. */
    const first = await client!.native.send('keyed-transfer-server', 'bytes', null, {
      idempotencyKey: 'bytes'
    })
    /** The original key reuses the provider result without transferring its retained storage. */
    const second = await client!.native.send('keyed-transfer-server', 'bytes', null, {
      idempotencyKey: 'bytes'
    })
    expect(first).toEqual(second)
    expect(buffer.buffer.byteLength).toBe(3)
    expect(calls).toBe(1)
  } finally {
    /** Join every successfully constructed real root even if its sibling construction failed. */
    const hosts = await Promise.allSettled(opening)
    await Promise.all(
      hosts.map((host) => (host.status === 'fulfilled' ? host.value.close() : undefined))
    )
    channel.port1.close()
    channel.port2.close()
  }
})

// The original overlapping reply pair remains [7, 7], effect count one.
it('makes the original overlapping keyed requests share the owner result seven exactly once', async () => {
  /** Real provider entry establishes an executing claim before the duplicate is sent. */
  const entered = deferred<void>()
  /** Only the original provider business releases its own result, without a store settlement stub. */
  const finish = deferred<number>()
  /** This original count is changed only by execution after the provider's real wait completes. */
  let count = 0
  /** The canonical memory listener lends both original native Session owners. */
  const server = coreMemoryServer('keyed-overlap-server')
  /** One genuine feature owns its sole default store and exact completion snapshots. */
  const host = await createRpcHost({
    ...server.options,
    plugins: [idempotency(), server.transport],
    provide: {
      count: async () => {
        entered.resolve()
        /** Preserve the original count-after-wait and returned seven, rather than count at claim. */
        const value = await finish.promise
        count += 1
        return value
      },
      barrier: () => true
    }
  })
  /** Only a real accepted public namespace originates either keyed request. */
  const client = await server.connect('keyed-overlap-client')
  /** The original joined terminal is observed immediately through business and cleanup failures. */
  let joined: Promise<unknown> | undefined
  try {
    /** First caller owns genuine executing work and the original retained claim. */
    const first = client.host.memory.send('keyed-overlap-server', 'count', null, {
      idempotencyKey: 'k1'
    })
    void first.catch(() => undefined)
    await entered.promise
    /** Same real source and key must wait for that existing owner's result. */
    const second = client.host.memory.send('keyed-overlap-server', 'count', null, {
      idempotencyKey: 'k1'
    })
    joined = Promise.all([first, second])
    void joined.catch(() => undefined)
    /** A later call on the same actual Session crosses ingress after the duplicate frame. */
    await client.host.memory.send('keyed-overlap-server', 'barrier')
    finish.resolve(7)
    expect(await joined).toEqual([7, 7])
    expect(count).toBe(1)
  } finally {
    finish.resolve(7)
    await joined?.catch(() => undefined)
    await Promise.all([client.host.close(), host.close()])
  }
})

// Actual retry preserves the original rejected value before any send.
it('keeps the original key factory failure as a rejected Promise without a business write', async () => {
  /** Exact identity is the original public callback failure oracle, not a coded replacement. */
  const failure = new Error('factory')
  /** Complete retry construction retains its original public callback and no generated key. */
  const strategy = retry({
    keyFactory() {
      throw failure
    }
  })
  /** Real accepted method metadata, rather than an idempotent test flag, enables key allocation. */
  const server = coreMemoryServer('key-factory-caller', 'key-factory-caller', 'memory', [strategy])
  /** The same true Host and Session used by all current public call features originate the call. */
  const host = await createRpcHost(server.options)
  /** If a business dispatch happens, this genuine provider records the forbidden effect. */
  const business = vi.fn(() => 'result')
  /** The original method's real accepted declaration alone supplies retry idempotency authority. */
  const client = await server.connect('key-factory-provider', {
    provide: { api: { request: business } },
    contract: {
      schemaVersion: 1,
      plugin: 'api',
      features: { work: { methods: { request: { mode: 'request', idempotent: true } } } }
    }
  })
  /** Subscribe after real startup; the deleted fixture's one describe frame is not fabricated. */
  const writing = vi.spyOn(client.pair[0], 'write')
  try {
    /** Factory failure remains a rejected actual namespace Promise instead of a synchronous throw. */
    const response = host.memory.request('api.request', [])
    expect(response).toBeInstanceOf(Promise)
    await expect(response).rejects.toBe(failure)
    expect(writing).not.toHaveBeenCalled()
    expect(business).not.toHaveBeenCalled()
  } finally {
    writing.mockRestore()
    await Promise.all([client.host.close(), host.close()])
  }
})

// The executing original claim owns the sole bounded store slot.
it('rejects a new key while the real bounded store owns an executing request', async () => {
  /** Only the real provider enters and increments this original execution count. */
  let count = 0
  /** Genuine provider entry proves the original store claim is executing. */
  const entered = deferred<void>()
  /** The original provider alone releases its result seven and the retained claim. */
  const finish = deferred<number>()
  /** The same supported public factory supplies the original one-entry capacity. */
  const store = createRpcIdempotencyStore({ maxEntries: 1 })
  /** Native Session admission and optional store installation remain independent real owners. */
  const server = coreMemoryServer('executing-key-server')
  /** No quota facade or replacement store can reject this second genuine call. */
  const host = await createRpcHost({
    ...server.options,
    plugins: [idempotency({ store }), server.transport],
    provide: {
      count: () => {
        count++
        entered.resolve()
        return finish.promise
      }
    }
  })
  /** The genuine caller originates both original keys on one accepted physical connection. */
  const client = await server.connect('executing-key-client')
  /** Observe the real held operation through all assertions and physical cleanup. */
  const first = client.host.memory.send('executing-key-server', 'count', null, {
    idempotencyKey: 'first'
  })
  void first.catch(() => undefined)
  try {
    await entered.promise
    await expect(
      client.host.memory.send('executing-key-server', 'count', null, {
        idempotencyKey: 'second'
      })
    ).rejects.toMatchObject({ code: 'OVERLOADED' })
    expect(count).toBe(1)
    finish.resolve(7)
    expect(await first).toBe(7)
  } finally {
    finish.resolve(7)
    await first.catch(() => undefined)
    await Promise.all([client.host.close(), host.close()])
  }
})

// Malformed store input fails construction before any provider work.
it('rejects the original malformed injected store during native construction', async () => {
  /** This cold listener owns no provider or physical Session before genuine native installation. */
  const server = coreMemoryServer('invalid-key-store-server')
  /** The original invalid value must reach the real installed Feature's configuration boundary. */
  const opening = createRpcHost({
    ...server.options,
    plugins: [idempotency({ store: 1 as never }), server.transport]
  })
  try {
    await expect(opening.then(() => undefined)).rejects.toMatchObject({ code: 'INVALID_CONFIG' })
  } finally {
    /** A regression that incorrectly constructs a Host must still release its original resources. */
    const settled = await Promise.allSettled([opening])
    for (const result of settled) if (result.status === 'fulfilled') await result.value.close()
  }
})

// And original caller key errors stay local.
it('replays original sequential keys and rejects invalid keys before any real business write', async () => {
  /** Actual execution alone supplies the original one/two count and returned values. */
  let count = 0
  /** The native listener and optional store own all genuine key admission and retained outcomes. */
  const server = coreMemoryServer('sequential-key-server')
  /** Both original repeated and independent keys use the same true provider and real store. */
  const host = await createRpcHost({
    ...server.options,
    plugins: [idempotency(), server.transport],
    provide: { count: () => ++count }
  })
  /** Accepted public namespace methods are the sole entry, without a legacy endpoint wrapper. */
  const client = await server.connect('sequential-key-client')
  try {
    expect(
      await client.host.memory.send('sequential-key-server', 'count', null, {
        idempotencyKey: 'k1'
      })
    ).toBe(1)
    expect(
      await client.host.memory.send('sequential-key-server', 'count', null, {
        idempotencyKey: 'k1'
      })
    ).toBe(1)
    expect(count).toBe(1)
    expect(
      await client.host.memory.send('sequential-key-server', 'count', null, {
        idempotencyKey: 'k2'
      })
    ).toBe(2)
    /** Startup and valid business are complete before observing each original invalid caller input. */
    const writing = vi.spyOn(client.pair[1], 'write')
    /** The canonical invocation owner must not start policy execution for an invalid caller key. */
    const dispatching = vi.spyOn(CallInvocation.prototype, 'start')
    try {
      // These are the three fixed original malformed keys from the two independent old cases.
      for (const idempotencyKey of ['', 'has space', 'bad key'])
        await expect(
          client.host.memory.send('sequential-key-server', 'count', null, { idempotencyKey })
        ).rejects.toMatchObject({ code: 'CONTRACT_INVALID' })
      expect(writing).not.toHaveBeenCalled()
      expect(dispatching).not.toHaveBeenCalled()
    } finally {
      writing.mockRestore()
      dispatching.mockRestore()
    }
  } finally {
    await Promise.all([client.host.close(), host.close()])
  }
})

// Explicit key bypasses allocation and reaches the actual native write.
it('retains the original explicit key through genuine retry and the physical request', async () => {
  /** Original explicit-key admission must never ask the complete retry feature for a new key. */
  const keyFactory = vi.fn(() => 'factory-key')
  /** This real executing feature is installed at the originating native transport scope. */
  const strategy = retry({ keyFactory })
  /** The existing bridge lends the same genuine Session and physical frame ownership. */
  const server = coreMemoryServer('explicit-key-caller', 'explicit-key-caller', 'memory', [
    strategy
  ])
  /** No legacy registration, retry controller or generation fixture originates this request. */
  const host = await createRpcHost(server.options)
  /** Real accepted metadata supplies idempotency authority independently from the caller key. */
  const client = await server.connect('explicit-key-provider', {
    plugins: [idempotency()],
    provide: { api: { request: () => 'result' } },
    contract: {
      schemaVersion: 1,
      plugin: 'api',
      features: { f: { methods: { request: { mode: 'request', idempotent: true } } } }
    }
  })
  /** Borrow only the actual accepted view; no fake numeric generation is assigned. */
  const accepted = server.lookup('explicit-key-provider')!
  /** This pass-through observation begins after startup and never parses or rewrites a frame. */
  const writing = vi.spyOn(client.pair[0], 'write')
  try {
    await expect(
      host.memory.request('api.request', ['x'], { idempotencyKey: 'explicit' })
    ).resolves.toBe('result')
    expect(keyFactory).toHaveBeenCalledTimes(0)
    /** One actual write retains the original one-dispatch effect without the deleted retry DTO. */
    expect(writing).toHaveBeenCalledTimes(1)
    /** The bridge's real identity codec exposes its original semantic frame, without another decode. */
    const envelope = writing.mock.calls[0]![0].data as Extract<IRpcEnvelope, { kind: 'call' }>
    expect(envelope.kind).toBe('call')
    expect({
      key: envelope.options.idempotencyKey,
      idempotent: accepted.view.methods.get('api.request')!.idempotent,
      targetGeneration: envelope.task.targetGeneration
    }).toEqual({
      key: 'explicit',
      idempotent: true,
      targetGeneration: accepted.view.generation
    })
    expect(envelope.options).toMatchObject({ idempotencyKey: 'explicit' })
  } finally {
    writing.mockRestore()
    await Promise.all([client.host.close(), host.close()])
  }
})
