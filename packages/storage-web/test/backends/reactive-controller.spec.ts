import type { IKeyValueStore } from '@migaia/storage-contract'
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { describe, expect, it, vi } from 'vitest'
import { cookiesHost } from '../../src/backends/cookie.js'
import { indexedDbHost } from '../../src/backends/indexed-db.js'
import { localStorageHost } from '../../src/backends/local-storage.js'
import { memoryStorageHost } from '../../src/backends/memory.js'
import { sessionStorageHost } from '../../src/backends/session-storage.js'
import {
  createBackendReactiveController,
  getBackendReactiveController
} from '../../src/backends/reactive-controller.js'
import { memoryBackendPlugin } from '../../src/plugins/memory.js'
import { createStorageHost } from '../../src/host/storage-host.js'
import { fakeCookieDocument } from '../../src/testing/fake-cookie-document.js'
import { fakeWebStorage } from '../../src/testing/fake-web-storage.js'

type IObservedBackend = {
  readonly name: string
  readonly store: IKeyValueStore
  readonly write: () => Promise<void>
}

/** Build the five canonical stores without changing their public capability declarations. */
const createObservedBackends = (): IObservedBackend[] => [
  (() => {
    const store = memoryStorageHost()
    return { name: 'memory', store, write: () => store.set('key', 'value') }
  })(),
  (() => {
    const store = localStorageHost({ namespace: 'controller-local', storage: fakeWebStorage() })
    return { name: 'local', store, write: () => store.set('key', 'value') }
  })(),
  (() => {
    const store = sessionStorageHost({ namespace: 'controller-session', storage: fakeWebStorage() })
    return { name: 'session', store, write: () => store.set('key', 'value') }
  })(),
  (() => {
    const store = cookiesHost({ namespace: 'controller-cookie', document: fakeCookieDocument() })
    return { name: 'cookie', store, write: () => store.set('key', 'value') }
  })(),
  (() => {
    const store = indexedDbHost({
      dbName: `controller-${Math.random().toString(36).slice(2)}`,
      factory: new IDBFactory(),
      keyRange: IDBKeyRange
    })
    return { name: 'indexeddb', store, write: () => store.set('key', 'value') }
  })()
]

describe('B04 R08 private backend reactive controller', () => {
  it('registers one exact controller for each canonical factory and publishes after success', async () => {
    const backends = createObservedBackends()
    try {
      for (const observed of backends) {
        const controller = getBackendReactiveController(observed.store)
        expect(controller).toBeDefined()
        expect(controller?.snapshot.backend).toBe(observed.store.backend)
        const events: unknown[] = []
        const unsubscribe = controller!.subscribe((event) => events.push(event))
        await observed.write()
        expect(events).toHaveLength(1)
        expect(events[0]).toMatchObject({ channel: 'value', kind: 'put', keys: ['key'] })
        unsubscribe()
      }
    } finally {
      await Promise.all(backends.map((observed) => observed.store.dispose()))
    }
  })

  it('keeps failed writes silent and contains listener failure without reversing the write', async () => {
    const store = memoryStorageHost()
    const controller = getBackendReactiveController(store)!
    const events: unknown[] = []
    const unsubscribeFailure = controller.subscribe(() => {
      throw new Error('listener failure')
    })
    const unsubscribeObserver = controller.subscribe((event) => events.push(event))
    const report = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      await store.set('key', 'value')
      await expect(store.set('bad', 42 as never)).rejects.toMatchObject({ code: 'INVALID_CONFIG' })
      expect(await store.get('key')).toBe('value')
      expect(events).toHaveLength(1)
      expect(report).toHaveBeenCalled()
    } finally {
      report.mockRestore()
      unsubscribeFailure()
      unsubscribeObserver()
      await store.dispose()
    }
  })

  it('retains one durable mutation lease through publish before dispose', async () => {
    const controller = createBackendReactiveController({ backend: 'memory' })
    const events: unknown[] = []
    controller.subscribe((event) => events.push(event))
    const release = controller.beginMutation()
    const firstDispose = controller.dispose()
    expect(controller.dispose()).toBe(firstDispose)
    controller.publish({ channel: 'value', kind: 'put', keys: ['key'] })
    expect(events).toHaveLength(1)
    expect(controller.dispose()).toBe(firstDispose)
    release()
    await firstDispose
    controller.publish({ channel: 'value', kind: 'put', keys: ['late'] })
    expect(events).toHaveLength(1)
  })

  it('seals admission synchronously and runs backend finalization inside the cached promise', async () => {
    let finalized = false
    const controller = createBackendReactiveController({
      backend: 'memory',
      finalize: () => {
        finalized = true
      }
    })
    const release = controller.beginMutation()
    const firstDispose = controller.dispose()
    expect(() => controller.assertLive()).toThrowError(
      expect.objectContaining({ code: 'STORE_DISPOSED' })
    )
    expect(finalized).toBe(false)
    expect(controller.dispose()).toBe(firstDispose)
    release()
    await firstDispose
    expect(finalized).toBe(true)
    expect(() => controller.beginMutation()).toThrowError(
      expect.objectContaining({ code: 'STORE_DISPOSED' })
    )
  })

  it('admits memory transactions before sealing and drains them before disposal', async () => {
    const store = memoryStorageHost()
    const controller = getBackendReactiveController(store)!
    const events: unknown[] = []
    const unsubscribe = controller.subscribe((event) => events.push(event))
    let releaseCallback: (() => void) | undefined
    const callbackStarted = new Promise<void>((resolve) => {
      releaseCallback = resolve
    })
    let releaseTransaction: (() => void) | undefined
    const transactionGate = new Promise<void>((resolve) => {
      releaseTransaction = resolve
    })
    const transaction = store.transaction(async (tx) => {
      releaseCallback!()
      await transactionGate
      await tx.put({ value: 1 }, 'late-transaction')
    })
    await callbackStarted
    const disposal = store.dispose()
    expect(store.dispose()).toBe(disposal)
    let disposalSettled = false
    void disposal.then(() => {
      disposalSettled = true
    })
    await Promise.resolve()
    expect(disposalSettled).toBe(false)
    releaseTransaction!()
    await expect(transaction).rejects.toMatchObject({ code: 'STORE_DISPOSED' })
    await disposal
    expect(events).toHaveLength(0)
    expect(() => unsubscribe()).not.toThrow()
  })

  it('publishes a completed memory transaction before a later disposal', async () => {
    const store = memoryStorageHost()
    const controller = getBackendReactiveController(store)!
    const events: unknown[] = []
    const unsubscribe = controller.subscribe((event) => events.push(event))
    await expect(
      store.transaction(async (tx) => tx.put({ value: 1 }, 'completed-transaction'))
    ).resolves.toBe('completed-transaction')
    expect(events).toHaveLength(1)
    const disposal = store.dispose()
    expect(store.dispose()).toBe(disposal)
    await disposal
    unsubscribe()
  })

  it('returns one exact disposal Promise for every canonical backend store', async () => {
    const backends = createObservedBackends()
    const disposals = backends.map((observed) => {
      const first = observed.store.dispose()
      expect(observed.store.dispose()).toBe(first)
      return first
    })
    await Promise.all(disposals)
  })

  it('uses the same private seam for a Host-materialized canonical store', async () => {
    const host = await createStorageHost({
      plugins: [memoryBackendPlugin({ id: 'host-memory' })] as const
    })
    try {
      const store = host.backend('host-memory')
      expect(getBackendReactiveController(store)).toBeDefined()
      expect(getBackendReactiveController(store)?.snapshot.backend).toBe('memory')
    } finally {
      await host.dispose()
    }
  })
})
