import { describe, expect, it } from 'vitest'
import { createServiceWorkerTransport } from '../../src/adapters/service-worker'
import { createSharedWorkerTransport } from '../../src/adapters/shared-worker'
import { createWebWorkerTransport } from '../../src/adapters/web-worker'

describe('worker adapter source metadata', () => {
  const createServiceTransport = (target: {
    postMessage(message?: unknown): void
    readonly id?: string
    addEventListener?: (type: 'message', listener: (event: MessageEvent<unknown>) => void) => void
    removeEventListener?: (
      type: 'message',
      listener: (event: MessageEvent<unknown>) => void
    ) => void
  }) =>
    createServiceWorkerTransport({
      target,
      receiver: {
        addEventListener: target.addEventListener ?? (() => undefined),
        removeEventListener: target.removeEventListener ?? (() => undefined)
      }
    })
  it('marks each shared-worker port as an exclusive peer link', () => {
    const port = {
      postMessage() {},
      addEventListener() {},
      removeEventListener() {}
    }
    expect(createSharedWorkerTransport(port).topology).toBe('exclusive')
  })

  it('preserves service-worker origin and source', () => {
    let listener: ((event: MessageEvent<unknown>) => void) | undefined
    const client = {
      postMessage() {},
      addEventListener(_type: 'message', callback: (event: MessageEvent<unknown>) => void) {
        listener = callback
      },
      removeEventListener() {}
    }
    const transport = createServiceTransport(client)
    const received: unknown[] = []
    transport.subscribe((message) => received.push(message))
    const source = {}
    listener?.({ data: 'payload', origin: 'https://peer.test', source } as MessageEvent)
    expect(received).toEqual([{ data: 'payload', origin: 'https://peer.test', source }])
  })

  it('preserves worker source metadata', () => {
    let listener: ((event: MessageEvent<unknown> | Event) => void) | undefined
    const port = {
      postMessage() {},
      addEventListener(
        _type: 'message' | 'error' | 'messageerror',
        callback: (event: MessageEvent<unknown> | Event) => void
      ) {
        if (_type === 'message') listener = callback
      },
      removeEventListener() {}
    }
    const transport = createWebWorkerTransport(port)
    expect(transport.topology).toBe('exclusive')
    const received: unknown[] = []
    transport.subscribe((message) => received.push(message))
    const source = {}
    listener?.({ data: 'payload', origin: 'https://peer.test', source } as unknown as MessageEvent)
    expect(received).toEqual([{ data: 'payload', origin: 'https://peer.test', source }])
  })
  it('reports hostile service-worker event reads as transport failures', () => {
    let listener: ((event: MessageEvent<unknown>) => void) | undefined
    const client = {
      postMessage() {},
      addEventListener(_type: 'message', callback: (event: MessageEvent<unknown>) => void) {
        listener = callback
      },
      removeEventListener() {}
    }
    const transport = createServiceTransport(client)
    const failures: unknown[] = []
    transport.onTransportError?.((error) => failures.push(error))
    transport.subscribe(() => undefined)
    listener?.({
      get data() {
        throw new Error('hostile data')
      }
    } as MessageEvent)
    expect(failures).toHaveLength(1)
  })

  it('requires the configured service-worker client source when it has an id', () => {
    const client = {
      id: 'client-1',
      postMessage() {},
      addEventListener() {},
      removeEventListener() {}
    }
    const transport = createServiceTransport(client)
    expect(transport.sourceProof?.(client)).toBe(true)
    expect(transport.sourceProof?.({ id: 'client-2' })).toBe(false)
    expect(transport.sourceProof?.({ id: 'client-1' })).toBe(true)
  })

  it('rejects a hostile service-worker source id getter', () => {
    const client = {
      id: 'client-1',
      postMessage() {},
      addEventListener() {},
      removeEventListener() {}
    }
    const transport = createServiceTransport(client)
    const source = {
      get id() {
        throw new Error('hostile id')
      }
    }
    expect(transport.sourceProof?.(source)).toBe(false)
  })

  it('does not merge two service-worker client identities', () => {
    const clientA = {
      id: 'client-a',
      postMessage() {},
      addEventListener() {},
      removeEventListener() {}
    }
    const clientB = {
      id: 'client-b',
      postMessage() {},
      addEventListener() {},
      removeEventListener() {}
    }
    const transportA = createServiceTransport(clientA)
    const transportB = createServiceTransport(clientB)
    expect(transportA.peerId).not.toBe(transportB.peerId)
    expect(transportA.sourceProof?.(clientB)).toBe(false)
    expect(transportB.sourceProof?.(clientA)).toBe(false)
  })

  it('authenticates a cross-realm service-worker source by stable client id', () => {
    const client = {
      id: 'client-cross-realm',
      postMessage() {},
      addEventListener() {},
      removeEventListener() {}
    }
    const transport = createServiceTransport(client)
    const crossRealmSource = structuredClone({ id: client.id })
    expect(crossRealmSource).not.toBe(client)
    expect(transport.sourceProof?.(crossRealmSource)).toBe(true)
    expect(transport.sourceProof?.(structuredClone({ id: 'other-client' }))).toBe(false)
  })

  it('normalizes only a verified cross-realm client wrapper to the configured peer', () => {
    /** Captures the adapter ingress callback for distinct native-wrapper delivery. */
    let listener: ((event: MessageEvent<unknown>) => void) | undefined
    /** Represents the stable configured ServiceWorker client target. */
    const client = {
      id: 'client-stable',
      postMessage() {},
      addEventListener(_type: 'message', callback: (event: MessageEvent<unknown>) => void) {
        listener = callback
      },
      removeEventListener() {}
    }
    /** Owns the canonical source-proof and normalization boundary under test. */
    const transport = createServiceTransport(client)
    /** Records dispatched messages after the adapter has chosen their source identity. */
    const received: unknown[] = []
    transport.subscribe((message) => received.push(message))
    /** Simulates the first native WindowClient wrapper for the configured client id. */
    const firstWrapper = structuredClone({ id: client.id })
    /** Simulates a later distinct native wrapper with the same verified client id. */
    const secondWrapper = structuredClone({ id: client.id })
    /** Proves an unverified client id remains the original rejected-source identity. */
    const rejectedSource = structuredClone({ id: 'other-client' })
    listener?.({ data: 'first', source: firstWrapper } as unknown as MessageEvent)
    listener?.({ data: 'second', source: secondWrapper } as unknown as MessageEvent)
    listener?.({ data: 'rejected', source: rejectedSource } as unknown as MessageEvent)
    expect(received).toEqual([
      { data: 'first', origin: undefined, source: client },
      { data: 'second', origin: undefined, source: client },
      { data: 'rejected', origin: undefined, source: rejectedSource }
    ])
  })
})
