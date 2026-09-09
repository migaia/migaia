import { describe, expect, expectTypeOf, it, vi } from 'vitest'
import { readFile } from 'node:fs/promises'

const { createProviderEndpointSpy } = vi.hoisted(() => ({
  createProviderEndpointSpy: vi.fn()
}))

vi.mock('@migaia/web-rpc/provider', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@migaia/web-rpc/provider')>()
  createProviderEndpointSpy.mockImplementation(actual.createProviderEndpoint)
  return {
    ...actual,
    createProviderEndpoint: createProviderEndpointSpy
  }
})

type IWorkerListener = (event: MessageEvent<unknown> | Event) => void

type ILinkedWorkerPort = {
  postMessage(message: unknown): void
  addEventListener(type: 'message' | 'error' | 'messageerror', listener: IWorkerListener): void
  removeEventListener(type: 'message' | 'error' | 'messageerror', listener: IWorkerListener): void
  install(handler: (message: unknown) => unknown): void
  deliver(message: unknown): void
}

/** Connects a WorkerAdapter and createWorkerHandler through one in-memory Worker-like port. */
function createLinkedWorkerPort(): ILinkedWorkerPort {
  const listeners = new Map<'message' | 'error' | 'messageerror', Set<IWorkerListener>>()
  let remoteHandler: ((message: unknown) => unknown) | undefined
  return {
    postMessage(message) {
      void remoteHandler?.(message)
    },
    addEventListener(type, listener) {
      const bucket = listeners.get(type) ?? new Set<IWorkerListener>()
      bucket.add(listener)
      listeners.set(type, bucket)
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener)
    },
    install(handler) {
      remoteHandler = handler
    },
    deliver(message) {
      for (const listener of listeners.get('message') ?? [])
        listener({ data: message } as MessageEvent<unknown>)
    }
  }
}

describe('Cycle H B12c02 Store Worker provider consumer RED matrix', () => {
  it('T120 constructs the real handler seam and preserves request/result/repeated disposal', async () => {
    const { WorkerAdapter, createWorkerHandler } = await import('../src/index.js')
    const listeners = new Map<
      'message' | 'error' | 'messageerror',
      Set<(event: MessageEvent<unknown> | Event) => void>
    >()
    let remoteHandler: ((message: unknown) => unknown) | undefined
    const port = {
      postMessage(message: unknown): void {
        void remoteHandler?.(message)
      },
      addEventListener(
        type: 'message' | 'error' | 'messageerror',
        listener: (event: MessageEvent<unknown> | Event) => void
      ): void {
        const bucket = listeners.get(type) ?? new Set()
        bucket.add(listener)
        listeners.set(type, bucket)
      },
      removeEventListener(
        type: 'message' | 'error' | 'messageerror',
        listener: (event: MessageEvent<unknown> | Event) => void
      ): void {
        listeners.get(type)?.delete(listener)
      },
      install(handler: (message: unknown) => unknown): void {
        remoteHandler = handler
      },
      deliver(message: unknown): void {
        for (const listener of listeners.get('message') ?? [])
          listener({ data: message } as MessageEvent<unknown>)
      }
    }
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

  it('T138 owning handler consumes WebRPC fluent provider seam without a Store export', async () => {
    type IStoreWorkerModule = typeof import('../src/worker.js')
    expectTypeOf<IStoreWorkerModule>().not.toHaveProperty('createProviderEndpoint')

    createProviderEndpointSpy.mockClear()
    const { WorkerAdapter } = await import('../src/index.js')
    const { createWorkerHandler } = await import('../src/worker.js')
    const port = createLinkedWorkerPort()
    const handler = createWorkerHandler(
      (value: unknown) => `reply:${String(value)}`,
      (message) => port.deliver(message)
    )
    port.install(handler)
    const adapter = new WorkerAdapter(port)
    await expect(adapter.request('fluent-provider')).resolves.toBe('reply:fluent-provider')
    expect(createProviderEndpointSpy).not.toHaveBeenCalled()
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
    const port = createLinkedWorkerPort()
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
