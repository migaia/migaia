import { describe, expect, it, vi } from 'vitest'
import { createServiceWorkerTransport } from '../../src/adapters/service-worker'
import { createSharedWorkerTransport } from '../../src/adapters/shared-worker'
import { createWebWorkerTransport } from '../../src/adapters/web-worker'

describe('shared-worker adapter lifecycle', () => {
  it('shares one underlying subscription and isolates delivery failures', () => {
    const listeners = new Map<string, (event: MessageEvent<unknown> | Event) => void>()
    const added: string[] = []
    const removed: string[] = []
    const sent: unknown[] = []
    const transferLists: Array<readonly Transferable[]> = []
    let starts = 0
    const port = {
      postMessage(message: unknown, transfer?: readonly Transferable[]) {
        sent.push(message)
        if (transfer) transferLists.push(transfer)
      },
      start() {
        starts += 1
      },
      addEventListener(type: 'message' | 'messageerror', listener: (event: Event) => void) {
        added.push(type)
        listeners.set(type, listener)
      },
      removeEventListener(type: 'message' | 'messageerror') {
        removed.push(type)
        listeners.delete(type)
      }
    }
    const transport = createSharedWorkerTransport(port)
    const listenerFailures: unknown[] = []
    const transportFailures: unknown[] = []
    transport.onListenerError?.((error) => listenerFailures.push(error))
    transport.onTransportError?.((error) => transportFailures.push(error))
    const first = transport.subscribe(() => {
      throw new Error('listener failed')
    })
    const received: unknown[] = []
    const second = transport.subscribe((message) => received.push(message))
    const token = {} as Transferable
    transport.send('outbound', { transfer: [token] })
    const source = {}
    listeners.get('message')?.({
      data: 'inbound',
      origin: 'https://peer.test',
      source
    } as unknown as Event)
    listeners.get('messageerror')?.(new Event('messageerror'))
    expect(starts).toBe(1)
    expect(added).toEqual(['message', 'messageerror'])
    expect(sent).toEqual(['outbound'])
    expect(transferLists).toEqual([[token]])
    expect(received).toEqual([{ data: 'inbound', origin: 'https://peer.test', source }])
    expect(listenerFailures).toHaveLength(1)
    expect(transportFailures).toHaveLength(1)
    first()
    expect(removed).toEqual([])
    second()
    expect(removed).toEqual(['messageerror', 'message'])
  })

  it('reports hostile events and contains throwing diagnostic listeners', () => {
    let message: ((event: Event) => void) | undefined
    let messageError: ((event: Event) => void) | undefined
    const port = {
      postMessage() {},
      addEventListener(type: 'message' | 'messageerror', listener: (event: Event) => void) {
        if (type === 'message') message = listener
        else messageError = listener
      },
      removeEventListener() {}
    }
    const transport = createSharedWorkerTransport(port)
    const failures: unknown[] = []
    transport.onTransportError?.(() => {
      throw new Error('reporter failed')
    })
    transport.onTransportError?.((error) => failures.push(error))
    transport.subscribe(() => undefined)
    expect(() =>
      message?.(
        Object.defineProperty({}, 'data', {
          get: () => {
            throw new Error('hostile data')
          }
        }) as Event
      )
    ).not.toThrow()
    expect(() => messageError?.(new Event('messageerror'))).not.toThrow()
    expect(failures).toHaveLength(2)
  })

  it('retains the final subscription when shared-worker cleanup fails', () => {
    let removals = 0
    const port = {
      postMessage() {},
      addEventListener() {},
      removeEventListener(type: string) {
        if (type !== 'message') return
        removals += 1
        if (removals === 1) throw new Error('message cleanup failed')
      }
    }
    const transport = createSharedWorkerTransport(port)
    const unsubscribe = transport.subscribe(() => undefined)

    expect(() => unsubscribe()).toThrow('message cleanup failed')
    expect(() => unsubscribe()).not.toThrow()
    expect(removals).toBe(2)
  })
})

describe('dedicated-worker adapter lifecycle', () => {
  it('forwards metadata and owns lazy message and failure subscriptions', () => {
    const listeners = new Map<string, (event: Event) => void>()
    const add = vi.fn((type: string, listener: (event: Event) => void) =>
      listeners.set(type, listener)
    )
    const remove = vi.fn((type: string) => listeners.delete(type))
    const postMessage = vi.fn()
    const port = { postMessage, addEventListener: add, removeEventListener: remove }
    const transport = createWebWorkerTransport(port, {
      peerId: 'worker-1',
      origin: 'https://worker.test'
    })
    const listenerFailures: unknown[] = []
    const transportFailures: unknown[] = []
    const stopFailures = transport.onTransportError?.((error) => transportFailures.push(error))
    transport.onListenerError?.((error) => listenerFailures.push(error))
    const stopFirst = transport.subscribe(() => {
      throw new Error('listener failed')
    })
    const received: unknown[] = []
    const stopSecond = transport.subscribe((message) => received.push(message))
    transport.send('outbound', { transfer: [{} as Transferable] })
    listeners.get('message')?.({
      data: 'inbound',
      origin: 'origin',
      source: 'source'
    } as unknown as Event)
    listeners.get('error')?.({ message: 'worker exploded' } as unknown as Event)
    listeners.get('messageerror')?.(new Event('messageerror'))
    expect(transport.peerId).toBe('worker-1')
    expect(transport.origin).toBe('https://worker.test')
    expect(received).toEqual([{ data: 'inbound', origin: 'origin', source: 'source' }])
    expect(listenerFailures).toHaveLength(1)
    expect(transportFailures).toHaveLength(2)
    expect(add).toHaveBeenCalledTimes(3)
    stopFirst()
    stopSecond()
    stopFailures?.()
    expect(remove).toHaveBeenCalledTimes(3)
    expect(postMessage).toHaveBeenCalledOnce()
  })

  it('rolls back the first failure listener when the second registration fails', () => {
    const added: string[] = []
    const removed: string[] = []
    const port = {
      postMessage() {},
      addEventListener(type: string) {
        if (type === 'messageerror') throw new Error('messageerror listener failed')
        added.push(type)
      },
      removeEventListener(type: string) {
        removed.push(type)
      }
    }
    const transport = createWebWorkerTransport(port)
    expect(() => transport.onTransportError?.(() => undefined)).toThrow(
      'messageerror listener failed'
    )
    expect(added).toEqual(['error'])
    expect(removed).toEqual(['error'])
  })

  it('retains the final failure subscription when cleanup fails', () => {
    let removals = 0
    const port = {
      postMessage() {},
      addEventListener() {},
      removeEventListener(type: string) {
        if (type !== 'error') return
        removals += 1
        if (removals === 1) throw new Error('error listener removal failed')
      }
    }
    const transport = createWebWorkerTransport(port)
    const unsubscribe = transport.onTransportError?.(() => undefined)

    expect(() => unsubscribe?.()).toThrow('error listener removal failed')
    expect(() => unsubscribe?.()).not.toThrow()
    expect(removals).toBe(2)
  })
})

describe('service-worker adapter lifecycle', () => {
  it('uses separate send and receive owners with shared listener cleanup', () => {
    let inbound: ((event: MessageEvent<unknown>) => void) | undefined
    const target = { id: 'client-1', postMessage: vi.fn() }
    const receiver = {
      addEventListener(_type: 'message', listener: (event: MessageEvent<unknown>) => void) {
        inbound = listener
      },
      removeEventListener: vi.fn()
    }
    const transport = createServiceWorkerTransport({ target, receiver })
    const listenerFailures: unknown[] = []
    transport.onListenerError?.((error) => listenerFailures.push(error))
    const stopFirst = transport.subscribe(() => {
      throw new Error('listener failed')
    })
    const received: unknown[] = []
    const stopSecond = transport.subscribe((message) => received.push(message))
    const transfer = {} as Transferable
    transport.send('outbound', { transfer: [transfer] })
    const source = { id: 'client-1' }
    inbound?.({ data: 'inbound', origin: 'origin', source } as unknown as MessageEvent)
    expect(target.postMessage).toHaveBeenCalledWith('outbound', [transfer])
    expect(received).toEqual([{ data: 'inbound', origin: 'origin', source: target }])
    expect(listenerFailures).toHaveLength(1)
    stopFirst()
    expect(receiver.removeEventListener).not.toHaveBeenCalled()
    stopSecond()
    expect(receiver.removeEventListener).toHaveBeenCalledOnce()
  })
})
