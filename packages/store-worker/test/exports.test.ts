import type { IAbortSignal } from '@migaia/utils/promise'
import { describe, expect, it } from 'vitest'
import { MessageChannel } from 'node:worker_threads'
import { RpcWireKind } from '@migaia/rpc-contract/protocol'
import { workerFrames } from './worker-frame.ts'
import type { ISerializeChunk, ISerializeParser } from '@migaia/serialize'
import { SerializeChunkKind } from '@migaia/serialize'
import { WorkerAdapter, createWorkerHandler, workerComputed } from '../src/index.ts'
import * as storeWorker from '../src/index.ts'
import * as publicStoreWorker from '@migaia/store-worker'
import * as publicWorkerParser from '@migaia/store-worker/serialize/worker'
import { toManagedRpcHandler } from '../src/managed-rpc-handler.ts'
import { createSerializeWorkerHandler, workerParser } from '../src/serialize/worker.ts'
import { createWorkerContractEndpoint } from '../src/worker-contract.ts'

function fakePort() {
  return {
    postMessage: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined
  }
}

type ILinkedWorkerPort = ReturnType<typeof createLinkedWorkerPort>

/** Connects a WorkerAdapter to a real createWorkerHandler without a browser worker. */
function createLinkedWorkerPort() {
  const listeners = new Map<
    'message' | 'error' | 'messageerror',
    Set<(event: MessageEvent<unknown>) => void>
  >()
  let handler: ((message: unknown) => unknown) | undefined
  const port = {
    postMessage(message: unknown): void {
      void handler?.(message)
    },
    addEventListener(
      type: 'message' | 'error' | 'messageerror',
      listener: (event: MessageEvent<unknown>) => void
    ): void {
      const bucket = listeners.get(type) ?? new Set()
      bucket.add(listener)
      listeners.set(type, bucket)
    },
    removeEventListener(
      type: 'message' | 'error' | 'messageerror',
      listener: (event: MessageEvent<unknown>) => void
    ): void {
      listeners.get(type)?.delete(listener)
    },
    install(next: (message: unknown) => unknown): void {
      handler = next
    },
    deliver(message: unknown): void {
      for (const listener of listeners.get('message') ?? [])
        listener({ data: message } as MessageEvent<unknown>)
    }
  }
  return port
}

/** Installs a real Worker RPC handler on the in-memory Worker-like port. */
function installLinkedWorkerHandler(
  port: ILinkedWorkerPort,
  compute: Parameters<typeof createWorkerHandler>[0]
): void {
  port.install(
    createWorkerHandler(compute, (message) => {
      port.deliver(message)
    })
  )
}

/** Installs the serializer-specific request/frame handler on the in-memory Worker port. */
function installLinkedSerializeWorkerHandler(
  port: ILinkedWorkerPort,
  parser: ISerializeParser
): ReturnType<typeof createSerializeWorkerHandler> {
  const handler = createSerializeWorkerHandler(parser, (message) => {
    port.deliver(message)
  })
  port.install(handler)
  return handler
}

/** Minimal endpoint double — `toManagedRpcHandler` only ever calls `.dispose()`. */
const mockEndpoint = (dispose: () => Promise<void>) => ({ dispose })

describe('store-worker exports', () => {
  it('omits removed byte ownership exports from both public runtime entries', () => {
    expect('WorkerByteOwnership' in publicStoreWorker).toBe(false)
    expect('WorkerByteOwnership' in publicWorkerParser).toBe(false)
    expect('Worker' + 'Ownership' in storeWorker).toBe(false)
  })

  it('request timeout rejects a real WorkerAdapter/handler seam', async () => {
    const port = createLinkedWorkerPort()
    installLinkedWorkerHandler(port, async () => new Promise(() => undefined))
    const adapter = new WorkerAdapter(port, { timeoutMs: 5 })
    await expect(adapter.request('timeout')).rejects.toMatchObject({ name: 'TimeoutError' })
    await adapter.dispose()
  })

  it('real WorkerAdapter RPC fanout preserves result order and remote error contract', async () => {
    const port = createLinkedWorkerPort()
    const providerFailure = new Error('worker provider failure')
    installLinkedWorkerHandler(port, async (payload) => {
      if (payload === 'failure') throw providerFailure
      return `reply:${String(payload)}`
    })
    const adapter = new WorkerAdapter(port)
    try {
      await expect(adapter.request<string, string>('one')).resolves.toBe('reply:one')
      await expect(
        Promise.all([
          adapter.request<string, string>('two'),
          adapter.request<string, string>('three')
        ])
      ).resolves.toEqual(['reply:two', 'reply:three'])
      const received = await adapter.request('failure').catch((error: unknown) => error)
      expect(received).toBeInstanceOf(Error)
      expect(received).toMatchObject({
        name: providerFailure.name,
        message: providerFailure.message,
        source: 'rpc.endpoint',
        code: 'INTERNAL'
      })
      expect((received as Error).stack).not.toHaveLength(0)
      expect((received as Error).stack).toBe(providerFailure.stack)
    } finally {
      await adapter.dispose()
    }
  })

  it('restores nested native provider causes without replacing native constructors or stacks', async () => {
    const port = createLinkedWorkerPort()
    const nested = new RangeError('nested worker cause')
    const primary = new TypeError('typed worker failure', { cause: nested })
    installLinkedWorkerHandler(port, () => {
      throw primary
    })
    const adapter = new WorkerAdapter(port)
    try {
      const received = await adapter.request('nested-error').catch((error: unknown) => error)
      expect(received).toBeInstanceOf(TypeError)
      expect(received).toMatchObject({
        name: primary.name,
        message: primary.message,
        source: 'rpc.endpoint',
        code: 'INTERNAL'
      })
      expect((received as Error).stack).not.toHaveLength(0)
      expect((received as Error).stack).toBe(primary.stack)
      /** Native runtime completion retains the original primary directly and its complete cause. */
      const nestedCause = (received as Error & { cause?: unknown }).cause
      expect(nestedCause).toBeInstanceOf(RangeError)
      expect(nestedCause).toMatchObject({
        name: nested.name,
        message: nested.message,
        source: 'unknown',
        code: 'UNKNOWN'
      })
      expect((nestedCause as Error).stack).toBe(nested.stack)
    } finally {
      await adapter.dispose()
    }
  })

  it('caller abort reaches a real provider context signal and late settlement is ignored', async () => {
    const port = createLinkedWorkerPort()
    let providerSignal: IAbortSignal | undefined
    let lateResolve!: () => void
    installLinkedWorkerHandler(port, async (_payload, context) => {
      providerSignal = context.signal
      await new Promise<void>((resolve) => {
        lateResolve = resolve
        context.signal.addEventListener('abort', () => resolve(), { once: true })
      })
      return 'late'
    })
    const adapter = new WorkerAdapter(port)
    const controller = new AbortController()
    const pending = adapter.request('abort', { signal: controller.signal })
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    controller.abort(new DOMException('worker caller abort', 'AbortError'))
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(providerSignal?.aborted).toBe(true)
    lateResolve()
    await adapter.dispose()
  })

  it('caller abort preserves exact reason identity through the WorkerAdapter boundary', async () => {
    const port = createLinkedWorkerPort()
    installLinkedWorkerHandler(port, async () => new Promise(() => undefined))
    const adapter = new WorkerAdapter(port)
    const controller = new AbortController()
    const reason = new DOMException('exact worker abort', 'AbortError')
    const pending = adapter.request('abort-cause', { signal: controller.signal })
    controller.abort(reason)
    await expect(pending).rejects.toMatchObject({ name: 'AbortError', cause: reason })
    await adapter.dispose()
  })

  it('copies the same exclusive bytes through request, workerComputed and the parser without detaching', async () => {
    /** Both public client paths use the same original buffer over real native MessagePorts. */
    const input = new Uint8Array([3, 5, 8])
    const channel = new MessageChannel()
    const handler = createWorkerHandler<Uint8Array, number[]>(
      (value) => [...value],
      (message) => channel.port2.postMessage(message)
    )
    channel.port2.addEventListener('message', (event) => void handler((event as MessageEvent).data))
    channel.port1.start()
    channel.port2.start()
    const adapter = new WorkerAdapter(channel.port1)
    /** JavaScript extras from the removed API must be ignored, without reading their getters. */
    const requestOptions = { transfer: [input.buffer] }
    const computedOptions = { transfer: () => [input.buffer] }
    const resource = workerComputed<Uint8Array, number[]>(adapter, () => input, {
      ...computedOptions,
      autoStart: false
    })
    const parserChannel = new MessageChannel()
    const parserHandler = createSerializeWorkerHandler(
      {
        name: 'copy-bytes',
        encode: (value) => ['value', value] as const,
        decode: (chunk) => chunk[1]
      },
      (message) => parserChannel.port2.postMessage(message)
    )
    parserChannel.port2.addEventListener(
      'message',
      (event) => void parserHandler((event as MessageEvent).data)
    )
    parserChannel.port1.start()
    parserChannel.port2.start()
    const parserOptions = { worker: parserChannel.port1, ownership: 'transfer' as const }
    const parser = workerParser(parserOptions)
    try {
      await expect(
        adapter.request(input, { ...requestOptions, signal: undefined })
      ).resolves.toEqual([3, 5, 8])
      expect(input.buffer.byteLength).toBe(3)
      await expect(resource.promise).resolves.toEqual([3, 5, 8])
      expect(input.buffer.byteLength).toBe(3)
      await expect(
        parser.decode(['bytes', input], {
          signal: new AbortController().signal,
          context: 'copy-bytes'
        })
      ).resolves.toEqual(input)
      expect(input.buffer.byteLength).toBe(3)
      expect([...input]).toEqual([3, 5, 8])
    } finally {
      resource.dispose()
      await Promise.all([
        adapter.dispose(),
        handler.dispose(),
        parser.dispose?.(),
        parserHandler.dispose()
      ])
      channel.port1.close()
      channel.port2.close()
      parserChannel.port1.close()
      parserChannel.port2.close()
    }
  })

  it('preserves native one-way completion and original physical send failure', async () => {
    /** Native ports retain real structured-clone and physical-send behavior. */
    const channel = new MessageChannel()
    /** Actual client posts distinguish rejected admission from any physical business emission. */
    const clientPosts: unknown[] = []
    /** A successful one-way provider must emit no response through its actual native port. */
    const workerPosts: unknown[] = []
    /** The original native failure must remain the direct cause of the physical send rejection. */
    let postFailure: Error | undefined
    /** Only the native post is decorated; listener and transfer ownership stay with these ports. */
    const clientPort = {
      postMessage(message: unknown, transfer?: readonly Transferable[]): void {
        if (postFailure) throw postFailure
        clientPosts.push(message)
        channel.port1.postMessage(
          message,
          transfer as Parameters<typeof channel.port1.postMessage>[1]
        )
      },
      addEventListener(type: string, listener: EventListener): void {
        channel.port1.addEventListener(type, listener)
      },
      removeEventListener(type: string, listener: EventListener): void {
        channel.port1.removeEventListener(type, listener)
      }
    }
    /** The provider uses its own real native port, rather than a synchronous message simulation. */
    const workerPort = {
      postMessage(message: unknown, transfer?: readonly Transferable[]): void {
        workerPosts.push(message)
        channel.port2.postMessage(
          message,
          transfer as Parameters<typeof channel.port2.postMessage>[1]
        )
      },
      addEventListener(type: string, listener: EventListener): void {
        channel.port2.addEventListener(type, listener)
      },
      removeEventListener(type: string, listener: EventListener): void {
        channel.port2.removeEventListener(type, listener)
      }
    }
    channel.port1.start()
    channel.port2.start()
    /** Holding business completion must not hold the notification's physical send Promise. */
    let release!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    /** Native delivery is observed independently from the caller's physical completion. */
    let entered!: () => void
    const entering = new Promise<void>((resolve) => {
      entered = resolve
    })
    /** Provider input is the observable business boundary for both rejection and actual delivery. */
    const received: unknown[] = []
    /** Both original handshake sides start together with providers registered in local setup. */
    const [client, worker] = await Promise.all([
      createWorkerContractEndpoint(clientPort),
      createWorkerContractEndpoint(workerPort, { id: 'worker', targetId: 'main' }, (endpoint) => {
        endpoint.onRequest('call', (payload) => payload)
        endpoint.onRequest('notice', async (payload) => {
          received.push(payload)
          entered()
          await held
        })
        return endpoint
      })
    ])
    try {
      /** This actual round trip completes negotiation before physical-send accounting begins. */
      await expect(client.request('ready')).resolves.toBe('ready')
      /** Directory publication is metadata traffic, not a provider completion or notify ACK. */
      const beforeNotice = await workerFrames(workerPosts)
      const workerPostsBeforeNotice = beforeNotice.filter(
        (frame) => frame.kind !== RpcWireKind.directory
      ).length
      await client.notify('sent', 'notice')
      await entering
      expect(received).toEqual(['sent'])
      /** Count every physical frame except the canonical metadata publication for this registration. */
      const delivered = await workerFrames(workerPosts)
      expect(delivered.filter((frame) => frame.kind !== RpcWireKind.directory)).toHaveLength(
        workerPostsBeforeNotice
      )
      console.info(
        '[store-worker native directory]',
        JSON.stringify(
          delivered
            .filter((frame) => frame.kind === RpcWireKind.directory)
            .map((frame) => ({
              kind: frame.kind,
              name: frame.directory.self.name,
              methods: frame.directory.methods.map((method) => method.name)
            }))
        )
      )
      release()
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
      expect(
        (await workerFrames(workerPosts)).filter((frame) => frame.kind !== RpcWireKind.directory)
      ).toHaveLength(workerPostsBeforeNotice)
      postFailure = new Error('worker post failure')
      const failure = await client.notify('fails', 'notice').catch((error: unknown) => error)
      expect(failure).toMatchObject({ cause: postFailure })
      expect((failure as { cause?: unknown }).cause).toBe(postFailure)
    } finally {
      release()
      postFailure = undefined
      await Promise.all([client.close(), worker.close()])
      channel.port1.close()
      channel.port2.close()
    }
  })

  it('rejects an invalid serialize worker handler before endpoint creation', () => {
    expect(() => createSerializeWorkerHandler(null as never, (() => undefined) as never)).toThrow(
      '[store] serialize worker handler requires encode/decode parser functions'
    )
  })

  it('streams encode frames through the existing WebRPC endpoint with bounded consumer credit', async () => {
    for (const clientId of [undefined, 'custom-client'] as const) {
      let produced = 0
      let returned = false
      const parser: ISerializeParser = {
        name: 'stream-test',
        async *encode() {
          try {
            for (let index = 0; index < 4; index++) {
              produced++
              yield [SerializeChunkKind.bytes, new Uint8Array([index])] as const
            }
          } finally {
            returned = true
          }
        },
        decode: (chunk) => chunk[1]
      }
      const port = createLinkedWorkerPort()
      const handler = installLinkedSerializeWorkerHandler(port, parser)
      const worker = workerParser({ worker: port, ...(clientId === undefined ? {} : { clientId }) })
      const output = worker.encode('input', {
        signal: new AbortController().signal,
        context: 'stream-test'
      })
      const iterator = (output as AsyncIterable<ISerializeChunk>)[Symbol.asyncIterator]()
      const first = await iterator.next()
      expect(first.value).toEqual([SerializeChunkKind.bytes, new Uint8Array([0])])
      expect(produced).toBeLessThanOrEqual(3)
      const rest: unknown[] = []
      for await (const chunk of { [Symbol.asyncIterator]: () => iterator }) rest.push(chunk)
      expect(rest).toHaveLength(3)
      expect(returned).toBe(true)
      await handler.dispose()
      await worker.dispose?.()
    }
  })

  it('cancels a pending encode iterator and invokes the parser iterator return hook', async () => {
    let returned = false
    let release!: () => void
    const parser: ISerializeParser = {
      name: 'cancel-test',
      encode: async function* () {
        try {
          yield [SerializeChunkKind.bytes, new Uint8Array([1])] as const
          await new Promise<void>((resolve) => {
            release = resolve
          })
          yield [SerializeChunkKind.bytes, new Uint8Array([2])] as const
        } finally {
          returned = true
        }
      },
      decode: (chunk) => chunk[1]
    }
    const port = createLinkedWorkerPort()
    const handler = installLinkedSerializeWorkerHandler(port, parser)
    const worker = workerParser({ worker: port })
    const output = worker.encode('input', {
      signal: new AbortController().signal,
      context: 'cancel-test'
    })
    const iterator = (output as AsyncIterable<ISerializeChunk>)[Symbol.asyncIterator]()
    await expect(iterator.next()).resolves.toMatchObject({ done: false })
    for (let attempt = 0; attempt < 10 && release === undefined; attempt++)
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
    expect(release).toEqual(expect.any(Function))
    await iterator.return?.()
    release()
    for (let attempt = 0; attempt < 10 && !returned; attempt++)
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
    expect(returned).toBe(true)
    await handler.dispose()
    await worker.dispose?.()
  })

  it('settles a close-before-ready stream without sending a worker frame', async () => {
    /** Initial negotiation is distinct from the original zero-business-send guarantee. */
    const frames: unknown[] = []
    const worker = workerParser({
      worker: {
        postMessage: (message) => {
          frames.push(message)
        },
        addEventListener: () => undefined,
        removeEventListener: () => undefined
      }
    })
    const output = worker.encode('pending', {
      signal: new AbortController().signal,
      context: 'close-before-ready'
    })
    const iterator = (output as AsyncIterable<ISerializeChunk>)[Symbol.asyncIterator]()
    const pending = iterator.next()
    const firstDispose = worker.dispose!() as Promise<void>
    expect(worker.dispose!()).toBe(firstDispose)
    await expect(pending).rejects.toMatchObject({ name: 'RpcLifecycleError' })
    await firstDispose
    /** Handshake metadata may precede close; no business call may be admitted afterward. */
    const prepared = await workerFrames(frames)
    /** Count actual admitted business frames after all original cleanup has completed. */
    const sends = prepared.filter((frame) => frame.kind === RpcWireKind.call).length
    expect(sends).toBe(0)
  })
  it('rejects null options at worker entry points with a tagged configuration error', () => {
    expect(() => new WorkerAdapter(fakePort(), null as never)).toThrow(
      '[store] worker options must be an object'
    )
    expect(() =>
      createWorkerHandler(
        () => 1,
        () => undefined,
        null as never
      )
    ).toThrow('[store] worker options must be an object')
    expect(() => workerComputed(null as never, () => 1, null as never)).toThrow(
      '[store] worker options must be an object'
    )
  })

  it('contains revoked worker options proxies as tagged errors', () => {
    const { proxy, revoke } = Proxy.revocable({}, {})
    revoke()
    try {
      new WorkerAdapter(fakePort(), proxy as never)
      throw new Error('expected worker options to fail')
    } catch (error) {
      expect(error).toMatchObject({
        source: 'store.worker',
        code: 'INVALID_OPTION',
        cause: expect.any(Error)
      })
    }
  })

  it('snapshots WorkerAdapter accessor options exactly once', () => {
    let reads = 0
    const options = {} as { readonly clientId?: string }
    Object.defineProperty(options, 'clientId', {
      get: () => {
        reads++
        if (reads > 1) throw new Error('clientId reread')
        return 'client'
      }
    })
    new WorkerAdapter(fakePort(), options)
    expect(reads).toBe(1)
  })

  it('contains revoked serialize worker options proxies as tagged errors', () => {
    const { proxy, revoke } = Proxy.revocable({ worker: fakePort() }, {})
    revoke()
    expect(() => workerParser(proxy as never)).toThrow(
      expect.objectContaining({
        source: 'store.worker',
        code: 'INVALID_OPTION',
        cause: expect.any(Error)
      })
    )
  })

  it('snapshots known serialize worker options once and ignores removed ownership', () => {
    let reads = 0
    const options = { worker: fakePort() } as {
      worker: ReturnType<typeof fakePort>
      type?: string
    }
    Object.defineProperty(options, 'type', {
      get: () => {
        reads++
        if (reads > 1) throw new Error('type reread')
        return 'snapshot-format'
      }
    })
    Object.defineProperty(options, 'ownership', {
      get: () => {
        throw new Error('removed ownership read')
      }
    })
    const parser = workerParser(options as never)
    expect(reads).toBe(1)
    void parser.dispose?.()
  })
  it('creates a managed worker handler without disposeAsync', () => {
    const handler = createWorkerHandler<number, number>(
      (value) => value + 1,
      () => {}
    )
    expect(handler.disposed).toBe(false)
    expect((handler as unknown as { disposeAsync?: unknown }).disposeAsync).toBeUndefined()
    handler.close()
    expect(handler.disposed).toBe(true)
  })

  it('rejects invalid worker handler callbacks before endpoint construction', () => {
    expect(() => createWorkerHandler(null as never, () => undefined)).toThrow(
      expect.objectContaining({
        source: 'store.worker',
        code: 'INVALID_OPTION',
        message: '[store] createWorkerHandler compute must be a function'
      })
    )
    expect(() => createWorkerHandler(() => 1, null as never)).toThrow(
      expect.objectContaining({
        source: 'store.worker',
        code: 'INVALID_OPTION',
        message: '[store] createWorkerHandler postMessage must be a function'
      })
    )
  })

  it('close() marks disposed and blocks new messages without disposing the endpoint', async () => {
    let disposeCalls = 0
    const delivered: unknown[] = []
    const handler = toManagedRpcHandler(
      Promise.resolve(
        mockEndpoint(async () => {
          disposeCalls += 1
        })
      ),
      (message) => delivered.push(message)
    )
    handler.close()
    await handler({ kind: 'ignored' })
    expect(handler.disposed).toBe(true)
    expect(delivered).toEqual([])
    expect(disposeCalls).toBe(0)
  })

  it('dispose() closes first, awaits endpoint.dispose(), and reuses the same Promise', async () => {
    let disposeCalls = 0
    const handler = toManagedRpcHandler(
      Promise.resolve(
        mockEndpoint(async () => {
          disposeCalls += 1
        })
      ),
      () => undefined
    )
    const first = handler.dispose()
    expect(handler.disposed).toBe(true)
    const second = handler.dispose()
    expect(second).toBe(first)
    await first
    expect(disposeCalls).toBe(1)
  })

  it('dispose() propagates endpoint cleanup errors instead of swallowing them', async () => {
    const cleanupError = new Error('endpoint dispose failed')
    const handler = toManagedRpcHandler(
      Promise.resolve(
        mockEndpoint(async () => {
          throw cleanupError
        })
      ),
      () => undefined
    )
    await expect(handler.dispose()).rejects.toBe(cleanupError)
    await expect(handler.dispose()).rejects.toBe(cleanupError)
  })

  it('close rejects late messages while an already-admitted dispatch drains', async () => {
    let resolveEndpoint!: (endpoint: ReturnType<typeof mockEndpoint>) => void
    const endpoint = new Promise<ReturnType<typeof mockEndpoint>>((resolve) => {
      resolveEndpoint = resolve
    })
    const delivered: unknown[] = []
    const handler = toManagedRpcHandler(endpoint, (message) => delivered.push(message))
    const admitted = handler('admitted')
    expect(handler.pendingCount).toBe(1)

    handler.close()
    await handler('late')
    expect(handler.pendingCount).toBe(1)
    resolveEndpoint(mockEndpoint(async () => undefined))
    await admitted

    expect(delivered).toEqual([])
    expect(handler.pendingCount).toBe(0)
  })

  it('dispose races an admitted dispatch without duplicate cleanup or leaked pending count', async () => {
    let resolveEndpoint!: (endpoint: ReturnType<typeof mockEndpoint>) => void
    const endpoint = new Promise<ReturnType<typeof mockEndpoint>>((resolve) => {
      resolveEndpoint = resolve
    })
    let disposeCalls = 0
    const delivered: unknown[] = []
    const handler = toManagedRpcHandler(endpoint, (message) => delivered.push(message))
    const admitted = handler('admitted')
    const firstDispose = handler.dispose()
    expect(handler.dispose()).toBe(firstDispose)
    resolveEndpoint(
      mockEndpoint(async () => {
        disposeCalls++
      })
    )

    await Promise.all([admitted, firstDispose])
    expect(delivered).toEqual([])
    expect(disposeCalls).toBe(1)
    expect(handler.pendingCount).toBe(0)
  })

  it('rejects request immediately after adapter disposal', async () => {
    const adapter = new WorkerAdapter(fakePort())
    adapter.dispose()
    await expect(adapter.request({}, {})).rejects.toThrow('worker adapter is disposed')
  })

  it('snapshots request accessors before returning the admitted Promise', async () => {
    const adapter = new WorkerAdapter(fakePort())
    let signalReads = 0
    let transferReads = 0
    const options = {} as { signal?: AbortSignal; transfer?: readonly Transferable[] }
    Object.defineProperties(options, {
      signal: {
        get: () => {
          signalReads++
          return undefined
        }
      },
      transfer: {
        get: () => {
          transferReads++
          return []
        }
      }
    })

    const pending = adapter.request({}, options)

    expect(signalReads).toBe(1)
    expect(transferReads).toBe(0)
    adapter.close()
    await expect(pending).rejects.toThrow('worker adapter is disposed')
  })

  it('rejects hostile request options with a tagged error and original cause', async () => {
    const adapter = new WorkerAdapter(fakePort())
    const { proxy, revoke } = Proxy.revocable({}, {})
    revoke()

    await expect(adapter.request({}, proxy as never)).rejects.toMatchObject({
      source: 'store.worker',
      code: 'INVALID_OPTION',
      cause: expect.any(Error)
    })
    await expect(adapter.request({}, null as never)).rejects.toMatchObject({
      source: 'store.worker',
      code: 'INVALID_OPTION'
    })
    adapter.close()
  })

  it('rejects invalid workerComputed callbacks before Resource construction', () => {
    const adapter = new WorkerAdapter(fakePort())
    expect(() => workerComputed(adapter, null as never)).toThrow(
      expect.objectContaining({
        source: 'store.worker',
        code: 'INVALID_OPTION',
        message: '[store] workerComputed selectInput must be a function'
      })
    )
    adapter.close()
  })

  it('snapshots workerComputed options once without enumerating unknown properties', () => {
    const adapter = new WorkerAdapter(fakePort())
    let runtimeReads = 0
    let transferReads = 0
    let unknownReads = 0
    const options = {} as Record<string, unknown>
    Object.defineProperties(options, {
      runtime: {
        enumerable: true,
        get: () => {
          runtimeReads++
          return undefined
        }
      },
      transfer: {
        enumerable: true,
        get: () => {
          transferReads++
          return undefined
        }
      },
      unknown: {
        enumerable: true,
        get: () => {
          unknownReads++
          throw new Error('unknown option must not be read')
        }
      },
      autoStart: {
        enumerable: true,
        value: false
      }
    })

    const resource = workerComputed(adapter, () => 1, options as never)

    expect(runtimeReads).toBe(1)
    expect(transferReads).toBe(0)
    expect(unknownReads).toBe(0)
    resource.dispose()
    adapter.close()
  })

  it('contains a throwing workerComputed option getter with its original cause', () => {
    const adapter = new WorkerAdapter(fakePort())
    const failure = new Error('workerComputed runtime getter failed')
    const options = {} as { runtime?: never }
    Object.defineProperty(options, 'runtime', {
      get: () => {
        throw failure
      }
    })

    expect(() => workerComputed(adapter, () => 1, options)).toThrow(
      expect.objectContaining({
        source: 'store.worker',
        code: 'INVALID_OPTION',
        message: '[store] worker options must be an object',
        cause: failure
      })
    )
    adapter.close()
  })
})
