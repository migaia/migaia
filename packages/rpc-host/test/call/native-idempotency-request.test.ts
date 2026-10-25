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
import { idempotency } from '@migaia/rpc-host/features/idempotency'
import { retry } from '@migaia/rpc-host/features/retry'
import { coreMemoryServer } from '../host/core-fixture.js'

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

// RPC-TEST-17D89AA0779A-C001: exact original result, backing length and execution count.
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

// RPC-TEST-17D89AA0779A-C007: the original overlapping reply pair remains [7, 7], effect count one.
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

// RPC-TEST-7376FBDEF575-C003: actual retry preserves the original rejected value before any send.
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
