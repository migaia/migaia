import { createClientEndpoint } from '../../src/core/client.js'
import { createProviderEndpoint } from '../../src/core/provider.js'
import { connect } from '../../src/core/middleware/connect.js'
import { EventEmitter } from 'node:events'
import { MessageChannel } from 'node:worker_threads'
import { describe, expect, it, vi } from 'vitest'
import type { IRpcCarrierProbe } from '../../src/core/probe/index.js'
import type { IRpcTransport } from '../../src/core/transport.js'
import type { IRpcProvider } from '../../src/core/typing.js'
import { createMemoryTransportPair } from '../../src/core/adapters/memory.js'
import {
  createNodeMessagePortTransport,
  createBrowserMessagePortTransport
} from '../../src/core/adapters/message-port.js'
import { createWebWorkerTransport } from '../../src/core/adapters/web-worker.js'

/** Snapshot only the reusable detail map; captured payload identity remains observable. */
function recorder(capturing = false) {
  /** Retain synchronous probe output while captured content keeps its original identity. */
  const events: {
    direction: number
    size: number
    carrier: string
    detail: unknown
    content: unknown
  }[] = []
  /** Install the direct carrier contract so assertions do not depend on probe-core instrumentation. */
  const probe: IRpcCarrierProbe = {
    capturing,
    emit(direction, size, carrier, detail, content) {
      events.push({ direction, size, carrier, detail: detail && { ...detail }, content })
    }
  }
  return { events, probe }
}

/** Controlled native delivery preserves structured-clone transfer detachment. */
function fixture(kind: 'node' | 'browser' | 'worker') {
  /**
   * EventTarget delivery keeps browser and Worker adapter behavior aligned with native message
   * events.
   */
  const messages = new EventTarget()
  /** EventEmitter I/O retains Node message shape and exposes the actual physical transfer operation. */
  const native = Object.assign(new EventEmitter(), {
    postMessage(message: unknown, transfer?: readonly unknown[]) {
      /**
       * Native clone output preserves physical postMessage delivery and transfer detachment in the
       * fixture.
       */
      const data = structuredClone(message, { transfer: transfer as Transferable[] | undefined })
      queueMicrotask(() => {
        native.emit('message', data)
        messages.dispatchEvent(new MessageEvent('message', { data }))
      })
    }
  })
  /** The held port exposes physical messaging and native hook ownership without a runtime launcher. */
  const port = {
    postMessage: native.postMessage,
    start: () => undefined,
    close: () => undefined,
    addEventListener: (event: string, listener: EventListener) =>
      messages.addEventListener(event, listener),
    removeEventListener: (event: string, listener: EventListener) =>
      messages.removeEventListener(event, listener)
  }
  /** Exercise the final carrier boundary so observation assertions cover actual native I/O. */
  const transport: IRpcTransport =
    kind === 'node'
      ? createNodeMessagePortTransport(native)
      : kind === 'browser'
        ? createBrowserMessagePortTransport(port)
        : createWebWorkerTransport(port)
  return transport
}

describe('Core physical carrier observation', () => {
  it('memory observes each physical delivery once with original content and no detail keys', async () => {
    const [left, right] = createMemoryTransportPair()
    /**
     * Keep emitted observations so direction, capture identity and disposal can be asserted
     * independently.
     */
    const observed = recorder(true)
    left.observe!(observed.probe)
    right.observe!(observed.probe)
    /**
     * Count business message delivery independently of observation callbacks and reporting
     * failures.
     */
    const receive = vi.fn()
    right.subscribe(receive)
    /** Native payload anchors content-reference assertions across physical send and receive. */
    const payload = { value: 7 }
    left.send(payload)
    await Promise.resolve()
    expect(receive).toHaveBeenCalledExactlyOnceWith({ data: payload })
    expect(observed.events).toEqual([
      { direction: 0, size: -1, carrier: 'Memory', detail: undefined, content: payload },
      { direction: 1, size: -1, carrier: 'Memory', detail: undefined, content: payload }
    ])
    expect(observed.events[0]!.content).toBe(payload)
    left.close()
    left.observe!(observed.probe)
    expect(() => left.send(payload)).toThrow()
    expect(observed.events).toHaveLength(2)
  })
  it('memory isolates both probe failures and disposes same-probe generations', async () => {
    const [left, right] = createMemoryTransportPair()
    /**
     * Keep emitted observations so direction, capture identity and disposal can be asserted
     * independently.
     */
    const observed = recorder()
    /** This older disposer must not retire a newer installation of the same probe object. */
    const obsolete = left.observe!(observed.probe)
    /** The latest installation owns disposal even when the same probe object is installed again. */
    const current = left.observe!(observed.probe)
    obsolete()
    /**
     * Count business message delivery independently of observation callbacks and reporting
     * failures.
     */
    const receive = vi.fn()
    right.subscribe(receive)
    left.send(1)
    await Promise.resolve()
    expect(observed.events).toHaveLength(1)
    expect(observed.events[0]!.content).toBeUndefined()
    current()
    current()
    left.send(2)
    await Promise.resolve()
    expect(observed.events).toHaveLength(1)
    /**
     * Original failure identity must remain reachable through reporting without failing message
     * delivery.
     */
    const cause = new Error('memory probe failure')
    /** Record failure delivery so reporting count and original error identity can be asserted. */
    const errors = vi.fn()
    /**
     * Release the sender diagnostic registration before pair shutdown emits its ordinary terminal
     * error.
     */
    const removeLeft = left.onListenerError!(errors)
    /**
     * Release the receiver diagnostic registration before pair shutdown emits its ordinary terminal
     * error.
     */
    const removeRight = right.onListenerError!(errors)
    /**
     * Install the direct carrier contract so assertions do not depend on probe-core
     * instrumentation.
     */
    const probe = {
      capturing: false,
      emit() {
        throw cause
      }
    }
    left.observe!(probe)
    right.observe!(probe)
    left.send(3)
    await Promise.resolve()
    expect(receive).toHaveBeenCalledTimes(3)
    expect(errors).toHaveBeenCalledTimes(2)
    for (const [error] of errors.mock.calls)
      expect(error).toMatchObject({ source: '@migaia/rpc/core', code: 'TRANSPORT', cause })
    removeLeft()
    removeRight()
    left.close()
  })
  it.each(['node', 'browser', 'worker'] as const)(
    '%s emits exact bytes and transfers without changing delivery',
    async (kind) => {
      /** Exercise the final carrier boundary so observation assertions cover actual native I/O. */
      const transport = fixture(kind)
      /**
       * Keep emitted observations so direction, capture identity and disposal can be asserted
       * independently.
       */
      const observed = recorder(true)
      transport.observe!(observed.probe)
      /**
       * Count business message delivery independently of observation callbacks and reporting
       * failures.
       */
      const receive = vi.fn()
      /**
       * Release message delivery independently of the observation disposer and native port
       * ownership.
       */
      const unsubscribe = transport.subscribe(receive)
      /** Native byte payload proves transfer detachment and captured byte preservation together. */
      const bytes = new Uint8Array([7, 8, 9])
      transport.send(bytes, { transfer: [bytes.buffer] })
      expect(bytes.byteLength).toBe(0)
      await Promise.resolve()
      expect(receive).toHaveBeenCalledTimes(1)
      expect(observed.events).toHaveLength(2)
      expect(observed.events.map((event) => [event.direction, event.size, event.detail])).toEqual([
        [0, 3, { transfers: 1 }],
        [1, 3, { transfers: -1 }]
      ])
      expect(Array.from(observed.events[0]!.content as Uint8Array)).toEqual([7, 8, 9])
      expect(observed.events[1]!.content).toBe(receive.mock.calls[0]![0].data)
      unsubscribe()
      await transport.close?.()
    }
  )
  it.each(['node', 'browser', 'worker'] as const)(
    '%s keeps non-transferred content by reference',
    async (kind) => {
      /** Exercise the final carrier boundary so observation assertions cover actual native I/O. */
      const transport = fixture(kind)
      /**
       * Keep emitted observations so direction, capture identity and disposal can be asserted
       * independently.
       */
      const observed = recorder(true)
      transport.observe!(observed.probe)
      /**
       * Release the existing message or diagnostic registration without claiming physical port
       * closure.
       */
      const remove = transport.subscribe(() => undefined)
      /** Native payload anchors content-reference assertions across physical send and receive. */
      const payload = { bytes: new Uint8Array([1, 2]) }
      transport.send(payload)
      expect(observed.events[0]!.content).toBe(payload)
      await Promise.resolve()
      remove()
      await transport.close?.()
    }
  )
  it.each(['node', 'browser', 'worker'] as const)(
    '%s isolates probe emit/capturing failures and retires generations',
    async (kind) => {
      /** Exercise the final carrier boundary so observation assertions cover actual native I/O. */
      const transport = fixture(kind)
      /**
       * Keep emitted observations so direction, capture identity and disposal can be asserted
       * independently.
       */
      const observed = recorder()
      /** This older disposer must not retire a newer installation of the same probe object. */
      const obsolete = transport.observe!(observed.probe)
      /** The latest installation owns disposal even when the same probe object is installed again. */
      const current = transport.observe!(observed.probe)
      obsolete()
      obsolete()
      /**
       * Count business message delivery independently of observation callbacks and reporting
       * failures.
       */
      const receive = vi.fn()
      /**
       * Release the existing message or diagnostic registration without claiming physical port
       * closure.
       */
      const remove = transport.subscribe(receive)
      transport.send(7)
      await Promise.resolve()
      expect(observed.events).toHaveLength(2)
      expect(observed.events.every((event) => event.content === undefined)).toBe(true)
      current()
      current()
      transport.send(8)
      await Promise.resolve()
      expect(observed.events).toHaveLength(2)
      /**
       * Original failure identity must remain reachable through reporting without failing message
       * delivery.
       */
      const cause = new TypeError('probe failure')
      /** Record failure delivery so reporting count and original error identity can be asserted. */
      const errors = vi.fn()
      /** Release this diagnostic registration after its reporting or retirement assertions finish. */
      const removeError = transport.onListenerError!(errors)
      for (const probe of [
        {
          capturing: false,
          emit() {
            throw cause
          }
        },
        {
          get capturing(): boolean {
            throw cause
          },
          emit() {}
        }
      ]) {
        transport.observe!(probe)
        transport.send(9)
        await Promise.resolve()
      }
      expect(receive).toHaveBeenCalledTimes(4)
      expect(errors).toHaveBeenCalledTimes(4)
      for (const [error] of errors.mock.calls)
        expect(error).toMatchObject({ source: '@migaia/rpc/core', code: 'TRANSPORT', cause })
      /** A fresh recorder detects any observation that escapes adapter retirement. */
      const final = recorder()
      transport.observe!(final.probe)
      await transport.close?.()
      transport.observe!(final.probe)
      remove()
      removeError()
      expect(final.events).toHaveLength(0)
    }
  )
  it.each(['node', 'browser', 'worker'] as const)(
    '%s reads transfer once and preserves its getter failure identity',
    async (kind) => {
      /** Exercise the final carrier boundary so observation assertions cover actual native I/O. */
      const transport = fixture(kind)
      /**
       * Keep emitted observations so direction, capture identity and disposal can be asserted
       * independently.
       */
      const observed = recorder(true)
      transport.observe!(observed.probe)
      /**
       * Retain listener-error reports while the real Client and Provider request continues to
       * resolve.
       */
      const reports = vi.fn()
      /**
       * Release the observation-error reporter after proving native getter failures bypass that
       * sink.
       */
      const removeReport = transport.onListenerError!(reports)
      /**
       * Release the existing message or diagnostic registration without claiming physical port
       * closure.
       */
      const remove = transport.subscribe(() => undefined)
      /** Native byte payload proves transfer detachment and captured byte preservation together. */
      const bytes = new Uint8Array([9, 1])
      /** The decoy backing detects whether observation reads the transfer getter a second time. */
      const retained = new Uint8Array([2, 4])
      /**
       * Keep the intended native list so an extra getter read cannot silently select the decoy
       * backing.
       */
      const transfer = [bytes.buffer]
      /** Count transfer getter evaluation across observation and the native send boundary. */
      let reads = 0
      /** An alternating transfer getter reveals any extra read that changes native detachment. */
      const options = {
        get transfer() {
          reads += 1
          return reads === 1 ? transfer : [retained.buffer]
        }
      }
      transport.send(bytes, options)
      expect(reads).toBe(1)
      expect(bytes.byteLength).toBe(0)
      expect(retained.byteLength).toBe(2)
      expect(Array.from(observed.events[0]!.content as Uint8Array)).toEqual([9, 1])
      expect(observed.events[0]!.detail).toEqual({ transfers: 1 })
      /**
       * Original failure identity must remain reachable through reporting without failing message
       * delivery.
       */
      const cause = new TypeError('native transfer getter failure')
      /** Retain the exact transfer getter failure to distinguish it from a probe-reporting wrapper. */
      let caught: unknown
      try {
        transport.send(retained, {
          get transfer(): readonly ArrayBuffer[] {
            throw cause
          }
        })
      } catch (error) {
        caught = error
      }
      expect(caught).toBe(cause)
      expect(reports).not.toHaveBeenCalled()
      expect(observed.events).toHaveLength(1)
      await Promise.resolve()
      remove()
      removeReport()
      await transport.close?.()
    }
  )
  it('retains nested transfer containers by reference after native detachment', async () => {
    /** Exercise the final carrier boundary so observation assertions cover actual native I/O. */
    const transport = fixture('node')
    /**
     * Keep emitted observations so direction, capture identity and disposal can be asserted
     * independently.
     */
    const observed = recorder(true)
    transport.observe!(observed.probe)
    /**
     * Release the existing message or diagnostic registration without claiming physical port
     * closure.
     */
    const remove = transport.subscribe(() => undefined)
    /** Nested native bytes detach without requiring a scan or copy of their captured container. */
    const bytes = new Uint8Array([2, 3, 4])
    /** Capture retains this sibling and its enclosing container under the nested-transfer ruling. */
    const retained = { safe: true }
    /** Native payload anchors content-reference assertions across physical send and receive. */
    const payload = { retained, bytes, nested: [bytes.buffer] }
    transport.send(payload, { transfer: [bytes.buffer] })
    /** The captured original container exposes native detachment through its unchanged aliases. */
    const content = observed.events[0]!.content as typeof payload
    expect(content).toBe(payload)
    expect(content.retained).toBe(retained)
    expect(content.bytes).toBe(bytes)
    expect(content.nested).toBe(payload.nested)
    expect(content.bytes.buffer).toBe(content.nested[0])
    expect(content.nested[0]!.byteLength).toBe(0)
    expect(bytes.byteLength).toBe(0)
    await Promise.resolve()
    remove()
    await transport.close?.()
  })
  it('retains cyclic Map and Set container identities while nested backings detach', async () => {
    /** Exercise the final carrier boundary so observation assertions cover actual native I/O. */
    const transport = fixture('node')
    /**
     * Keep emitted observations so direction, capture identity and disposal can be asserted
     * independently.
     */
    const observed = recorder(true)
    transport.observe!(observed.probe)
    /**
     * Release the existing message or diagnostic registration without claiming physical port
     * closure.
     */
    const remove = transport.subscribe(() => undefined)
    /** The nested backing detaches natively while its captured cyclic container remains original. */
    const buffer = new Uint8Array([5, 7]).buffer
    /** No captured sibling is copied when a nested transferable detaches at the native boundary. */
    const retained = { unchanged: true }
    /** Native payload anchors content-reference assertions across physical send and receive. */
    const payload: {
      buffer: ArrayBuffer
      self?: unknown
      map: Map<unknown, unknown>
      set: Set<unknown>
      retained: typeof retained
    } = {
      buffer,
      map: new Map(),
      set: new Set(),
      retained
    }
    payload.self = payload
    payload.map.set(buffer, payload)
    payload.set.add(buffer)
    payload.set.add(payload)
    transport.send(payload, { transfer: [buffer] })
    /** Cycles and collection members retain their exact original references, including detachment. */
    const content = observed.events[0]!.content as typeof payload
    expect(buffer.byteLength).toBe(0)
    expect(content).toBe(payload)
    expect(content.buffer).toBe(buffer)
    expect(content.map).toBe(payload.map)
    expect(content.set).toBe(payload.set)
    expect(content.self === content).toBe(true)
    expect(content.map.get(content.buffer)).toBe(content)
    expect(content.set.has(content.buffer)).toBe(true)
    expect(content.set.has(content)).toBe(true)
    expect(content.retained).toBe(retained)
    expect(content.buffer.byteLength).toBe(0)
    await Promise.resolve()
    remove()
    await transport.close?.()
  })
  it('throwing probes report listener errors while a real endpoint request resolves', async () => {
    const [clientWire, serverWire] = createMemoryTransportPair()
    /**
     * Original failure identity must remain reachable through reporting without failing message
     * delivery.
     */
    const cause = new TypeError('endpoint probe failure')
    /**
     * Retain listener-error reports while the real Client and Provider request continues to
     * resolve.
     */
    const reports = vi.fn()
    clientWire.onListenerError!(reports)
    serverWire.onListenerError!(reports)
    /** Count real provider execution to prove probe failures leave the business request intact. */
    const provide = vi.fn<IRpcProvider>((context) => context.success(14))
    /** A real Provider Endpoint proves throwing carrier probes cannot suppress business execution. */
    const server = await createProviderEndpoint({
      id: 'probe-server',
      transport: serverWire,
      middlewares: [connect({ transport: serverWire })],
      provider: { double: provide }
    })
    /** A real outbound Endpoint proves observation failures do not reject the business RPC. */
    const client = await createClientEndpoint({
      id: 'probe-client',
      transport: clientWire,
      middlewares: [connect({ transport: clientWire })]
    })
    /**
     * Install the direct carrier contract so assertions do not depend on probe-core
     * instrumentation.
     */
    const probe = {
      capturing: false,
      emit() {
        throw cause
      }
    }
    clientWire.observe!(probe)
    serverWire.observe!(probe)
    try {
      await expect(client.send('probe-server', 'double', 7)).resolves.toBe(14)
      expect(provide).toHaveBeenCalledTimes(1)
      expect(reports.mock.calls.length).toBeGreaterThanOrEqual(4)
      for (const [error] of reports.mock.calls)
        expect(error).toMatchObject({ source: '@migaia/rpc/core', code: 'TRANSPORT', cause })
    } finally {
      await client.dispose()
      await server.dispose()
    }
  })
  it('Node native close retires observation and preserves terminal replay through ordinary disposers', () => {
    /**
     * The held port exposes physical messaging and native hook ownership without a runtime
     * launcher.
     */
    const port = Object.assign(new EventEmitter(), { postMessage: vi.fn() })
    /** Exercise the final carrier boundary so observation assertions cover actual native I/O. */
    const transport = createNodeMessagePortTransport(port)
    /**
     * Keep emitted observations so direction, capture identity and disposal can be asserted
     * independently.
     */
    const observed = recorder()
    transport.observe!(observed.probe)
    /** Release the original message registration through its supported idempotent disposer. */
    const removeMessage = transport.subscribe(() => undefined)
    /** Record failure delivery so reporting count and original error identity can be asserted. */
    const errors = vi.fn()
    /**
     * Release the existing message or diagnostic registration without claiming physical port
     * closure.
     */
    const remove = transport.onTransportError!(errors)
    port.emit('close')
    expect(transport.closed).toBe(true)
    /** Keep the original native terminal error instance for exact late-listener replay assertions. */
    const terminal = errors.mock.calls[0]![0]
    transport.observe!(observed.probe)
    port.emit('message', 7)
    expect(observed.events).toHaveLength(0)
    removeMessage()
    removeMessage()
    remove()
    /**
     * A listener registered after native retirement must receive the retained terminal error
     * instance.
     */
    const late = vi.fn()
    /** Release the replay-only listener after verifying it acquired no new native hooks. */
    const removeLate = transport.onTransportError!(late)
    expect(late).toHaveBeenCalledExactlyOnceWith(terminal)
    for (const event of ['message', 'messageerror', 'close'])
      expect(port.listenerCount(event)).toBe(0)
    removeLate()
  })
  it('Worker explicit close prevents late error registration from attaching native hooks', async () => {
    /** The fixture owns native EventTarget dispatch without a platform-specific Worker. */
    const events = new EventTarget()
    /** Count native hook acquisition so late error registration cannot reacquire a retired Worker. */
    const add = vi.fn((type: string, listener: EventListener) =>
      events.addEventListener(type, listener)
    )
    /**
     * The held port exposes physical messaging and native hook ownership without a runtime
     * launcher.
     */
    const port = {
      postMessage: vi.fn(),
      addEventListener: add,
      removeEventListener: (type: string, listener: EventListener) =>
        events.removeEventListener(type, listener)
    }
    /** Exercise the final carrier boundary so observation assertions cover actual native I/O. */
    const transport = createWebWorkerTransport(port)
    /**
     * Release the existing message or diagnostic registration without claiming physical port
     * closure.
     */
    const remove = transport.onTransportError!(() => undefined)
    expect(add).toHaveBeenCalledTimes(2)
    await transport.close!()
    remove()
    /**
     * A listener registered after native retirement must receive the retained terminal error
     * instance.
     */
    const late = transport.onTransportError!(() => undefined)
    expect(add).toHaveBeenCalledTimes(2)
    late()
  })
  it('observes real Node MessageChannel transfer before detachment', async () => {
    /** A real MessageChannel proves the adapter preserves native ArrayBuffer transfer detachment. */
    const ports = new MessageChannel()
    /**
     * The sending channel supplies the final public transport used by the native transfer
     * assertion.
     */
    const left = createNodeMessagePortTransport(ports.port1)
    /** The receiving channel proves physical delivery through the final public transport. */
    const right = createNodeMessagePortTransport(ports.port2)
    /**
     * Keep emitted observations so direction, capture identity and disposal can be asserted
     * independently.
     */
    const observed = recorder(true)
    left.observe!(observed.probe)
    right.observe!(observed.probe)
    /**
     * Resolve only from the actual native receiver so preserved capture bytes cannot stand in for
     * delivery.
     */
    const received = new Promise<unknown>((resolve) =>
      right.subscribe((message) => resolve(message.data))
    )
    try {
      /** Native byte payload proves transfer detachment and captured byte preservation together. */
      const bytes = new Uint8Array([4, 5])
      left.send(bytes.buffer, { transfer: [bytes.buffer] })
      expect(bytes.byteLength).toBe(0)
      expect(Array.from(new Uint8Array(observed.events[0]!.content as ArrayBuffer))).toEqual([4, 5])
      expect(Array.from(new Uint8Array((await received) as ArrayBuffer))).toEqual([4, 5])
      expect(observed.events.map((event) => event.direction)).toEqual([0, 1])
    } finally {
      await left.close?.()
      await right.close?.()
      ports.port1.close()
      ports.port2.close()
    }
  })
})
