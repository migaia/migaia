import { describe, expect, it } from 'vitest'
import { createServiceWorkerCarrier } from '../../../dist/browser/adapters/service-worker.js'
import { createDedicatedWorkerCarrier } from '../../../dist/browser/adapters/dedicated-worker.js'

/** Lend these existing native fixture operations to the actual production ServiceWorker carrier. */
function createServiceCarrier(
  target: {
    postMessage(message?: unknown): void
    readonly id?: string
    addEventListener?: (type: string, listener: (event: MessageEvent<unknown>) => void) => void
    removeEventListener?: (type: string, listener: (event: MessageEvent<unknown>) => void) => void
  },
  report: (error: unknown) => void = () => undefined
) {
  return createServiceWorkerCarrier(
    {
      target,
      receiver: {
        addEventListener: target.addEventListener ?? (() => undefined),
        removeEventListener: target.removeEventListener ?? (() => undefined)
      }
    },
    { report }
  )
}

describe('worker native source admission', () => {
  it('preserves service-worker origin and source', async () => {
    /** The actual receiving callback remains distinct from the borrowed outgoing Client. */
    let listener: ((event: MessageEvent<unknown>) => void) | undefined
    /** This original native target is the only accepted source when no Client id exists. */
    const client = {
      postMessage() {},
      addEventListener(_type: string, callback: (event: MessageEvent<unknown>) => void) {
        listener = callback
      },
      removeEventListener() {}
    }
    /** The real carrier performs native source filtering before shared codec admission. */
    const carrier = createServiceCarrier(client)
    /** SDK receives the same admitted payload; retired adapter origin/source DTO is not recreated. */
    const received: unknown[] = []
    carrier.subscribe({
      frame: (message) => received.push(message),
      error: () => undefined,
      close: () => undefined
    })
    listener?.({
      data: 'payload',
      origin: 'https://peer.test',
      source: client
    } as unknown as MessageEvent)
    expect(received).toEqual(['payload'])
    await carrier.close()
  })

  it('preserves worker source metadata', async () => {
    /** The actual exclusive Worker source owns its native event registration. */
    let listener: ((event: MessageEvent<unknown>) => void) | undefined
    /** No Worker launch, termination or Session replacement is fabricated by this fixture. */
    const port = {
      postMessage() {},
      addEventListener(type: string, callback: (event: MessageEvent<unknown>) => void) {
        if (type === 'message') listener = callback
      },
      removeEventListener() {}
    }
    /** This is the exact native constructor called by dedicatedWorkerPlugin.open. */
    const carrier = createDedicatedWorkerCarrier(port, { report: () => undefined })
    /** The actual exclusive source passes payload unchanged, without exposing raw event metadata. */
    const received: unknown[] = []
    carrier.subscribe({
      frame: (message) => received.push(message),
      error: () => undefined,
      close: () => undefined
    })
    /** Native event.source is not RPC identity and remains outside the semantic payload. */
    const source = {}
    listener?.({ data: 'payload', origin: 'https://peer.test', source } as unknown as MessageEvent)
    expect(received).toEqual(['payload'])
    await carrier.close()
  })

  it('reports hostile service-worker event reads as transport failures', async () => {
    /** Native delivery reaches the real source filter before the hostile data getter. */
    let listener: ((event: MessageEvent<unknown>) => void) | undefined
    /** The exact configured native target is admitted independently of its data getter. */
    const client = {
      postMessage() {},
      addEventListener(_type: string, callback: (event: MessageEvent<unknown>) => void) {
        listener = callback
      },
      removeEventListener() {}
    }
    /** Only the real SDK physical error callback observes this native reflection failure. */
    const failures: unknown[] = []
    /** No legacy diagnostic subscriber or second native event stream exists. */
    const carrier = createServiceCarrier(client)
    carrier.subscribe({
      frame: () => undefined,
      error: (error) => failures.push(error),
      close: () => undefined
    })
    listener?.({
      source: client,
      get data() {
        throw new Error('hostile data')
      }
    } as unknown as MessageEvent)
    expect(failures).toHaveLength(1)
    await carrier.close()
  })

  it('requires the configured service-worker client source when it has an id', async () => {
    /** Capture the original native callback instead of calling a removed sourceProof facade. */
    let listener: ((event: MessageEvent<unknown>) => void) | undefined
    /** Stable native Client id admits cross-realm wrappers without granting an RPC peer identity. */
    const client = {
      id: 'client-1',
      postMessage() {},
      addEventListener(_type: string, callback: (event: MessageEvent<unknown>) => void) {
        listener = callback
      },
      removeEventListener() {}
    }
    /** Actual admitted deliveries expose the three original native source decisions. */
    const received: unknown[] = []
    /** The sole production native filter accepts the original object or the same native Client id. */
    const carrier = createServiceCarrier(client)
    carrier.subscribe({
      frame: (message) => received.push(message),
      error: () => undefined,
      close: () => undefined
    })
    listener?.({ data: 'direct', source: client } as unknown as MessageEvent)
    listener?.({ data: 'wrong-id', source: { id: 'client-2' } } as unknown as MessageEvent)
    listener?.({ data: 'same-id', source: { id: 'client-1' } } as unknown as MessageEvent)
    expect(received).toEqual(['direct', 'same-id'])
    await carrier.close()
  })

  it('rejects a hostile service-worker source id getter', async () => {
    /** Original native ingress is the only entry to the actual source guard. */
    let listener: ((event: MessageEvent<unknown>) => void) | undefined
    /** The configured native Client contributes its stable id once at acquisition. */
    const client = {
      id: 'client-1',
      postMessage() {},
      addEventListener(_type: string, callback: (event: MessageEvent<unknown>) => void) {
        listener = callback
      },
      removeEventListener() {}
    }
    /** These original native failures remain directly observable at the true SDK boundary. */
    const failures: unknown[] = []
    /** No rejected-source payload may reach the actual receiver. */
    const received: unknown[] = []
    /** The original getter error must remain the same cause instance. */
    const failure = new Error('hostile id')
    /** This real source operation throws before any payload admission. */
    const source = {
      get id() {
        throw failure
      }
    }
    /** The real carrier owns native reflection and error delivery. */
    const carrier = createServiceCarrier(client)
    carrier.subscribe({
      frame: (message) => received.push(message),
      error: (error) => failures.push(error),
      close: () => undefined
    })
    listener?.({ data: 'rejected', source } as unknown as MessageEvent)
    expect(received).toEqual([])
    expect(failures).toHaveLength(1)
    expect(failures[0]).toMatchObject({ code: 'TRANSPORT', cause: failure })
    await carrier.close()
  })

  it('does not merge two service-worker client identities', async () => {
    /** Each original native target owns its own exact receiving callback. */
    let listenerA: ((event: MessageEvent<unknown>) => void) | undefined
    /** B's native delivery cannot select or mutate A's source record. */
    let listenerB: ((event: MessageEvent<unknown>) => void) | undefined
    /** These native Client ids remain independent from Host-assigned accepted peer identity. */
    const clientA = {
      id: 'client-a',
      postMessage() {},
      addEventListener(_type: string, callback: (event: MessageEvent<unknown>) => void) {
        listenerA = callback
      },
      removeEventListener() {}
    }
    /** Separate native target identity, rather than a copied RPC directory, proves isolation. */
    const clientB = {
      id: 'client-b',
      postMessage() {},
      addEventListener(_type: string, callback: (event: MessageEvent<unknown>) => void) {
        listenerB = callback
      },
      removeEventListener() {}
    }
    /** Each original SDK receiver accepts only its own native Client source. */
    const receivedA: unknown[] = []
    /** B remains empty when A is supplied to B's native filter. */
    const receivedB: unknown[] = []
    /** These are two actual native carrier acquisitions with no shared lookup registry. */
    const carrierA = createServiceCarrier(clientA)
    /** This exact carrier retains B's original native target. */
    const carrierB = createServiceCarrier(clientB)
    carrierA.subscribe({
      frame: (message) => receivedA.push(message),
      error: () => undefined,
      close: () => undefined
    })
    carrierB.subscribe({
      frame: (message) => receivedB.push(message),
      error: () => undefined,
      close: () => undefined
    })
    listenerA?.({ data: 'wrong-b', source: clientB } as unknown as MessageEvent)
    listenerB?.({ data: 'wrong-a', source: clientA } as unknown as MessageEvent)
    expect(carrierA.id).not.toBe(carrierB.id)
    expect(receivedA).toEqual([])
    expect(receivedB).toEqual([])
    await Promise.all([carrierA.close(), carrierB.close()])
  })

  it('authenticates a cross-realm service-worker source by stable client id', async () => {
    /** The native callback receives distinct Client wrappers with the same genuine Client id. */
    let listener: ((event: MessageEvent<unknown>) => void) | undefined
    /** The original native target remains borrowed and never changes to an incoming wrapper. */
    const client = {
      id: 'client-cross-realm',
      postMessage() {},
      addEventListener(_type: string, callback: (event: MessageEvent<unknown>) => void) {
        listener = callback
      },
      removeEventListener() {}
    }
    /** Only wrappers selected by the production native filter enter the actual SDK receiver. */
    const received: unknown[] = []
    /** Native source matching never reads semantic RPC metadata or directory fields. */
    const carrier = createServiceCarrier(client)
    carrier.subscribe({
      frame: (message) => received.push(message),
      error: () => undefined,
      close: () => undefined
    })
    /** Structured clone supplies a real distinct wrapper rather than an alias to the native target. */
    const crossRealmSource = structuredClone({ id: client.id })
    expect(crossRealmSource).not.toBe(client)
    listener?.({ data: 'same-id', source: crossRealmSource } as unknown as MessageEvent)
    listener?.({
      data: 'wrong-id',
      source: structuredClone({ id: 'other-client' })
    } as unknown as MessageEvent)
    expect(received).toEqual(['same-id'])
    await carrier.close()
  })

  it('normalizes only a verified cross-realm client wrapper to the configured peer', async () => {
    /** Captures the actual native callback for distinct original wrapper deliveries. */
    let listener: ((event: MessageEvent<unknown>) => void) | undefined
    /** Stable configured Client identity remains the one native source authority. */
    const client = {
      id: 'client-stable',
      postMessage() {},
      addEventListener(_type: string, callback: (event: MessageEvent<unknown>) => void) {
        listener = callback
      },
      removeEventListener() {}
    }
    /** This actual production carrier filters native sources before exposing payloads to SDK. */
    const carrier = createServiceCarrier(client)
    /** Accepted original payloads retain their order and exact value. */
    const received: unknown[] = []
    carrier.subscribe({
      frame: (message) => received.push(message),
      error: () => undefined,
      close: () => undefined
    })
    /** First distinct wrapper genuinely carries the configured native Client id. */
    const firstWrapper = structuredClone({ id: client.id })
    /** Later wrappers must not create a new native or semantic peer identity. */
    const secondWrapper = structuredClone({ id: client.id })
    /** Unverified native Client ids are dropped before shared codec admission. */
    const rejectedSource = structuredClone({ id: 'other-client' })
    listener?.({ data: 'first', source: firstWrapper } as unknown as MessageEvent)
    listener?.({ data: 'second', source: secondWrapper } as unknown as MessageEvent)
    listener?.({ data: 'rejected', source: rejectedSource } as unknown as MessageEvent)
    expect(received).toEqual(['first', 'second'])
    await carrier.close()
  })
})
