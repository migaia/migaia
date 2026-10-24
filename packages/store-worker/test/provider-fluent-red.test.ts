import { describe, expect, expectTypeOf, it } from 'vitest'
import { readFile } from 'node:fs/promises'

type IWorkerListener = (event: MessageEvent<unknown> | Event) => void

type ILinkedWorkerPort = {
  postMessage(message: unknown): void
  addEventListener(type: 'message' | 'error' | 'messageerror', listener: IWorkerListener): void
  removeEventListener(type: 'message' | 'error' | 'messageerror', listener: IWorkerListener): void
  install(handler: (message: unknown) => unknown): void
  deliver(message: unknown): void
}

/** One linked port owns native listener registration and the current remote handler. */
class LinkedWorkerPort implements ILinkedWorkerPort {
  /** Native event names partition the exact original observer sets. */
  #listeners = new Map<'message' | 'error' | 'messageerror', Set<IWorkerListener>>()
  /** Only install replaces the borrowed remote handler; sending preserves its plain receiver. */
  #remoteHandler: ((message: unknown) => unknown) | undefined

  /** Deliver the caller's original message directly to the currently installed handler. */
  postMessage = (message: unknown): void => {
    /** The original callback is invoked without binding the port as its receiver. */
    const handler = this.#remoteHandler
    void handler?.(message)
  }

  /** Listener identity and insertion order remain native Map/Set semantics. */
  addEventListener = (
    type: 'message' | 'error' | 'messageerror',
    listener: IWorkerListener
  ): void => {
    /** Each native event type owns one shared insertion-ordered bucket. */
    const bucket = this.#listeners.get(type) ?? new Set<IWorkerListener>()
    bucket.add(listener)
    this.#listeners.set(type, bucket)
  }

  /** Removing an absent listener keeps the original no-op behavior. */
  removeEventListener = (
    type: 'message' | 'error' | 'messageerror',
    listener: IWorkerListener
  ): void => {
    this.#listeners.get(type)?.delete(listener)
  }

  /** Replace only the borrowed remote operation, without acquiring another resource. */
  install = (handler: (message: unknown) => unknown): void => {
    this.#remoteHandler = handler
  }

  /** Dispatch the original message synchronously to each currently registered observer. */
  deliver = (message: unknown): void => {
    for (const listener of this.#listeners.get('message') ?? [])
      listener({ data: message } as MessageEvent<unknown>)
  }
}

describe('Store Worker provider consumer RED matrix', () => {
  it('constructs the real handler seam and preserves request/result/repeated disposal', async () => {
    const { WorkerAdapter, createWorkerHandler } = await import('../src/index.js')
    /** One named fixture owns the real worker message boundary. */
    const port = new LinkedWorkerPort()
    const handler = createWorkerHandler(
      (value: unknown, context) => (context.signal.aborted ? undefined : `reply:${String(value)}`),
      (message) => port.deliver(message)
    )
    port.install(handler)
    const adapter = new WorkerAdapter(port)
    await expect(adapter.request('real-provider')).resolves.toBe('reply:real-provider')
    const firstDispose = adapter.dispose()
    expect(adapter.dispose()).toBe(firstDispose)
    await firstDispose
  })

  it('owning handler consumes WebRPC fluent provider seam without a Store export', async () => {
    type IStoreWorkerModule = typeof import('../src/worker.js')
    expectTypeOf<IStoreWorkerModule>().not.toHaveProperty('createProviderEndpoint')

    const { WorkerAdapter } = await import('../src/index.js')
    const { createWorkerHandler } = await import('../src/worker.js')
    const port = new LinkedWorkerPort()
    const handler = createWorkerHandler(
      (value: unknown) => `reply:${String(value)}`,
      (message) => port.deliver(message)
    )
    port.install(handler)
    const adapter = new WorkerAdapter(port)
    await expect(adapter.request('fluent-provider')).resolves.toBe('reply:fluent-provider')
    const workerSource = await readFile(new URL('../src/worker.ts', import.meta.url), 'utf8')
    expect(workerSource).toContain('createWorkerContractEndpoint')
    expect(workerSource).not.toContain('createProviderEndpoint')
    const handlerDispose = handler.dispose()
    expect(handler.dispose()).toBe(handlerDispose)
    await handlerDispose
    const adapterDispose = adapter.dispose()
    expect(adapter.dispose()).toBe(adapterDispose)
    await adapterDispose
  })

  it('routes a custom clientId through the canonical provider response path', async () => {
    const { WorkerAdapter, createWorkerHandler } = await import('../src/index.js')
    const port = new LinkedWorkerPort()
    const handler = createWorkerHandler(
      (value: unknown) => `custom:${String(value)}`,
      (message) => port.deliver(message)
    )
    port.install(handler)
    const adapter = new WorkerAdapter(port, { clientId: 'custom-client' })
    await expect(adapter.request('id')).resolves.toBe('custom:id')
    await Promise.all([adapter.dispose(), handler.dispose()])
  })
})
