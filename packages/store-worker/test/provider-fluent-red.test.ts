import { describe, expect, expectTypeOf, it, vi } from 'vitest'
import { readFile } from 'node:fs/promises'
import type { createProviderEndpoint } from '@migaia/web-rpc/provider'

const { createProviderEndpointSpy } = vi.hoisted(() => ({
  createProviderEndpointSpy: vi.fn()
}))

type IProviderEndpointFactory = typeof import('@migaia/web-rpc/provider').createProviderEndpoint

let actualCreateProviderEndpoint: IProviderEndpointFactory

vi.mock('@migaia/web-rpc/provider', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@migaia/web-rpc/provider')>()
  actualCreateProviderEndpoint = actual.createProviderEndpoint
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
    type IFluentProviderEndpoint = Awaited<ReturnType<typeof createProviderEndpoint>>
    type IStoreWorkerModule = typeof import('../src/worker.js')
    expectTypeOf<IFluentProviderEndpoint>().toHaveProperty('provide').toBeFunction()
    expectTypeOf<IStoreWorkerModule>().not.toHaveProperty('createProviderEndpoint')

    createProviderEndpointSpy.mockClear()
    let returnedEndpoint: IFluentProviderEndpoint | undefined
    createProviderEndpointSpy.mockImplementation((config) => {
      const endpointPromise = actualCreateProviderEndpoint(config)
      void endpointPromise.then((endpoint) => {
        returnedEndpoint = endpoint
      })
      return endpointPromise
    })
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
    expect(createProviderEndpointSpy).toHaveBeenCalledTimes(1)
    expect(returnedEndpoint).toBeDefined()
    const workerSource = await readFile(new URL('../src/worker.ts', import.meta.url), 'utf8')
    expect(workerSource).toContain("providerEndpoint.provide('call'")
    const handlerDispose = handler.dispose()
    expect(handler.dispose()).toBe(handlerDispose)
    await handlerDispose
    const adapterDispose = adapter.dispose()
    expect(adapter.dispose()).toBe(adapterDispose)
    await adapterDispose
  })
})
