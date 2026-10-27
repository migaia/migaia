/** Native acquisition owners and the real ProbeEmitter receive every original observation oracle. */
import { EventEmitter } from 'node:events'
import { MessageChannel } from 'node:worker_threads'
import { describe, expect, it, vi } from 'vitest'
import { createRpcHost } from '@migaia/rpc-host'
import { defineTransportPlugin } from '@migaia/rpc-host/sdk'
import {
  createProbeEmitter,
  defineProbe,
  RpcProbeStage,
  type IRpcProbeEventView
} from '@migaia/rpc-host/plugins/probe'
import type {
  IRpcCarrier,
  IRpcCarrierFrame,
  IRpcCarrierObservationEvent,
  IRpcCarrierWriteOptions
} from '@migaia/rpc-contract/interfaces'
import { createNodeThreadCarrier } from '../../../rpc-plugin-thread/dist/threads/channel.js'
import { createSharedWorkerCarrier } from '../../../rpc-plugin-browser/dist/browser/adapters/shared-worker.js'
import { createDedicatedWorkerCarrier } from '../../../rpc-plugin-browser/dist/browser/adapters/dedicated-worker.js'
import type { IBrowserEventPort } from '../../../rpc-plugin-browser/dist/browser/native-message.js'
import { MemoryCarrier } from '../fixtures/core-carrier.js'

/** Only original native callback registrations and native structured-clone delivery live here. */
class NativeMessages {
  /** Node acquisition uses the actual EventEmitter callback form. */
  readonly node = Object.assign(new EventEmitter(), {
    postMessage: (value: unknown, transfer?: readonly unknown[]) => this.#post(value, transfer)
  })
  /** Browser acquisition uses actual EventTarget delivery rather than translated Node callbacks. */
  readonly #events = new EventTarget()
  /** The fixture records actual native callback custody without implementing a second dispatcher. */
  readonly #listeners = new Map<string, Set<EventListener>>()
  /** Late subscription checks count only actual native registration. */
  readonly add = vi.fn((type: string, listener: EventListener) => {
    this.#events.addEventListener(type, listener)
    let group = this.#listeners.get(type)
    if (!group) this.#listeners.set(type, (group = new Set()))
    group.add(listener)
  })
  /** Real browser source operations retain their original native receiver. */
  readonly web: IBrowserEventPort = {
    postMessage: (value, transfer) => this.#post(value, transfer),
    start() {},
    addEventListener: this.add,
    removeEventListener: (type, listener) => {
      this.#events.removeEventListener(type, listener)
      this.#listeners.get(type)?.delete(listener)
    }
  }
  /** Inspect native custody without granting Session or observation authority. */
  count(type: string): number {
    return this.#listeners.get(type)?.size ?? 0
  }
  /** Structured clone is the actual native transfer boundary; delivery follows its original task. */
  #post(value: unknown, transfer?: readonly unknown[]): void {
    /** The cloned physical frame, rather than captured content, feeds native delivery. */
    const data = structuredClone(value, { transfer: transfer as Transferable[] | undefined })
    queueMicrotask(() => {
      this.node.emit('message', data)
      this.#events.dispatchEvent(new MessageEvent('message', { data }))
    })
  }
}

/** One synchronous projection records original payload identity and bytes before actual detach. */
type IRecorded = Readonly<{
  direction: number
  size: number
  detail: IRpcProbeEventView['detail']
  content: unknown
  beforeTransfer?: readonly number[]
}>

/** Canonical public ProbeEmitter remains the sole filtering/capture owner. */
class ProbeCapture {
  /** Observations are never used to deliver business frames. */
  readonly events: IRecorded[] = []
  /** The actual public emitter owns mask selection, capture and callback errors. */
  readonly #emitter
  /** Construct no transport observation facade or captured-byte delivery path. */
  constructor(capturing = false) {
    this.#emitter = createProbeEmitter(
      [
        defineProbe({
          stages: ['carrier'],
          capture: capturing ? ['carrier'] : [],
          emit: this.#record
        })
      ],
      () => 0,
      'native-observe',
      () => undefined
    )
  }
  /** Native events enter the public capture implementation unchanged. */
  readonly receive = (event: IRpcCarrierObservationEvent): void => {
    this.#emitter.emit({ ...event, stage: RpcProbeStage.carrier })
  }
  /** Current frame containers are projected only at the assertion boundary. */
  readonly #record = (view: IRpcProbeEventView): void => {
    /** Original bytes are read synchronously before the native postMessage handoff. */
    const data = (view.content as IRpcCarrierFrame | undefined)?.data
    this.events.push({
      direction: view.direction,
      size: view.sizeBytes,
      detail: view.detail && { ...view.detail },
      content: data,
      beforeTransfer:
        data instanceof ArrayBuffer
          ? Array.from(new Uint8Array(data))
          : data instanceof Uint8Array
            ? Array.from(data)
            : undefined
    })
  }
  /** Release the actual emitter's stage subscriptions. */
  close(): void {
    this.#emitter.dispose()
  }
}

/** Fixed source kinds select genuine current native owners; no retired transport methods are added. */
const kinds = ['node', 'browser', 'worker'] as const

/** Each concrete source acquires its real SDK carrier and native observation capability. */
function open(
  kind: (typeof kinds)[number],
  native: NativeMessages,
  report: (error: unknown) => void
): IRpcCarrier {
  if (kind === 'node') return createNodeThreadCarrier(native.node, 'node-native', report)
  if (kind === 'browser') return createSharedWorkerCarrier(native.web, { report })
  return createDedicatedWorkerCarrier(native.web, { report })
}

describe('Core physical carrier observation', () => {
  it('memory observes each physical delivery once with original content and no detail keys', async () => {
    /** Original reference delivery uses the existing real carrier fixture. */
    const left = new MemoryCarrier('left'),
      right = new MemoryCarrier('right')
    left.link(right)
    right.link(left)
    /** One actual public capture receives both physical directions. */
    const observed = new ProbeCapture(true)
    left.observation.subscribe(observed.receive)
    right.observation.subscribe(observed.receive)
    /** Actual physical delivery is independent from observation. */
    const receive = vi.fn()
    right.subscribe({ frame: receive, close() {}, error() {} })
    /** Native payload identity remains the original caller object. */
    const payload = { value: 7 }
    /** Adds only the actual current carrier frame container. */
    const frame: IRpcCarrierFrame = { kind: 'message', data: payload }
    try {
      await left.write(frame)
      expect(receive).toHaveBeenCalledExactlyOnceWith(frame)
      expect(
        observed.events.map(({ direction, size, detail, content }) => ({
          direction,
          size,
          detail,
          content
        }))
      ).toEqual([
        { direction: 0, size: -1, detail: undefined, content: payload },
        { direction: 1, size: -1, detail: undefined, content: payload }
      ])
      expect(observed.events[0]!.content).toBe(payload)
      expect(left.observation.facts.platform).toBe('Memory')
      expect(right.observation.facts.platform).toBe('Memory')
      await left.close()
      left.observation.subscribe(observed.receive)
      await expect(left.write(frame)).rejects.toBeDefined()
      expect(observed.events).toHaveLength(2)
    } finally {
      await Promise.all([left.close(), right.close()])
      observed.close()
    }
  })

  it('memory disposes same-probe generations without changing business delivery', async () => {
    /** Both actual physical endpoints keep their original delivery and observation owner. */
    const left = new MemoryCarrier('left'),
      right = new MemoryCarrier('right')
    left.link(right)
    right.link(left)
    /** Metadata-only capture never reads business payload. */
    const observed = new ProbeCapture()
    /** Same callback replacement gives each admission an exact original remover. */
    const obsolete = left.observation.subscribe(observed.receive)
    /** The current record is independent from that older remover. */
    const current = left.observation.subscribe(observed.receive)
    await obsolete()
    /** Actual business deliveries remain counted outside capture. */
    const receive = vi.fn()
    right.subscribe({ frame: receive, close() {}, error() {} })
    try {
      await left.write({ kind: 'message', data: 1 })
      expect(observed.events).toHaveLength(1)
      expect(observed.events[0]!.content).toBeUndefined()
      await current()
      await current()
      await left.write({ kind: 'message', data: 2 })
      expect(observed.events).toHaveLength(1)
      expect(receive).toHaveBeenCalledTimes(2)
    } finally {
      await Promise.all([left.close(), right.close()])
      observed.close()
    }
  })

  it.each(kinds)('%s emits exact bytes and transfers without changing delivery', async (kind) => {
    /** The native source is the actual owner of structured-clone transfer. */
    const carrier = open(kind, new NativeMessages(), () => undefined)
    /** Public capture observes native send before detach and native receive afterwards. */
    const observed = new ProbeCapture(true)
    carrier.observation!.subscribe(observed.receive)
    /** Delivery comes only from native callbacks. */
    const receive = vi.fn()
    carrier.subscribe({ frame: receive, close() {}, error() {} })
    try {
      /** Original transferred bytes retain their exact native detachment effect. */
      const bytes = new Uint8Array([7, 8, 9])
      /** The real physical operation accepts a current frame container. */
      const pending = carrier.write({ kind: 'message', data: bytes }, { transfer: [bytes.buffer] })
      expect(bytes.byteLength).toBe(0)
      expect(observed.events[0]!.beforeTransfer).toEqual([7, 8, 9])
      await pending
      expect(receive).toHaveBeenCalledTimes(1)
      expect(observed.events).toHaveLength(2)
      expect(
        observed.events.map((event) => [event.direction, event.size, event.detail?.transfers])
      ).toEqual([
        [0, -1, 1],
        [1, -1, -1]
      ])
      expect(observed.events[1]!.content).toBe(receive.mock.calls[0]![0].data)
    } finally {
      await carrier.close()
      observed.close()
    }
  })

  it.each(kinds)('%s keeps non-transferred content by reference', async (kind) => {
    /** No transfer is requested from the actual source. */
    const carrier = open(kind, new NativeMessages(), () => undefined)
    /** The public capture policy retains original object roots by reference. */
    const observed = new ProbeCapture(true)
    carrier.observation!.subscribe(observed.receive)
    carrier.subscribe({ frame() {}, close() {}, error() {} })
    /** Original nested native storage is ordinary structured-clone data. */
    const payload = { bytes: new Uint8Array([1, 2]) }
    try {
      await carrier.write({ kind: 'message', data: payload })
      expect(observed.events[0]!.content).toBe(payload)
    } finally {
      await carrier.close()
      observed.close()
    }
  })

  it.each(kinds)('%s isolates raw observer failure and retires generations', async (kind) => {
    /** Physical reporting remains the original native acquisition report port. */
    const errors = vi.fn()
    /** The real selected owner wraps or passes its original observer error policy. */
    const carrier = open(kind, new NativeMessages(), errors)
    /** Metadata-only recording proves capture selection rather than test-side filtering. */
    const observed = new ProbeCapture()
    /** Obsolete removers cannot remove a current subscription using the same callback. */
    const obsolete = carrier.observation!.subscribe(observed.receive)
    /** Only this record owns the current native observation callback. */
    const current = carrier.observation!.subscribe(observed.receive)
    await obsolete()
    await obsolete()
    /** Business delivery count is independent from reporting. */
    const receive = vi.fn()
    carrier.subscribe({ frame: receive, close() {}, error() {} })
    try {
      await carrier.write({ kind: 'message', data: 7 })
      expect(observed.events).toHaveLength(2)
      expect(observed.events.every((event) => event.content === undefined)).toBe(true)
      await current()
      await current()
      await carrier.write({ kind: 'message', data: 8 })
      expect(observed.events).toHaveLength(2)
      /** The original native error instance must remain reachable on every report. */
      const cause = new TypeError('probe failure')
      carrier.observation!.subscribe(() => {
        throw cause
      })
      await carrier.write({ kind: 'message', data: 9 })
      expect(receive).toHaveBeenCalledTimes(3)
      expect(errors).toHaveBeenCalledTimes(2)
      for (const [error] of errors.mock.calls)
        expect.soft(error).toMatchObject({ source: 'rpc.endpoint', code: 'TRANSPORT', cause })
      /** Retired native sources cannot emit after their listeners are removed. */
      const final = new ProbeCapture()
      carrier.observation!.subscribe(final.receive)
      await carrier.close()
      carrier.observation!.subscribe(final.receive)
      await expect(carrier.write({ kind: 'message', data: 10 })).rejects.toBeDefined()
      expect(final.events).toHaveLength(0)
      final.close()
    } finally {
      await carrier.close()
      observed.close()
    }
  })

  it.each(kinds)(
    '%s reads transfer once and preserves its getter failure identity',
    async (kind) => {
      /** Only the genuine SDK/native source reads the real transfer option. */
      const reports = vi.fn()
      /** Native acquisition owns original diagnostic reporting. */
      const carrier = open(kind, new NativeMessages(), reports)
      /** Public recording preserves only actual callback evidence. */
      const observed = new ProbeCapture(true)
      carrier.observation!.subscribe(observed.receive)
      carrier.subscribe({ frame() {}, close() {}, error() {} })
      /** Original backing detaches; a second getter read would select a different retained backing. */
      const bytes = new Uint8Array([9, 1]),
        retained = new Uint8Array([2, 4])
      /** The exact original list is lent to native postMessage. */
      const transfer = [bytes.buffer]
      /** Alternating values reveal accidental duplicate acquisition of the transfer field. */
      let reads = 0
      /** SDK write remains the real asynchronous carrier boundary. */
      const options: IRpcCarrierWriteOptions = {
        get transfer() {
          reads++
          return reads === 1 ? transfer : [retained.buffer]
        }
      }
      try {
        /** Synchronous handoff happens before the returned write Promise settles. */
        const pending = carrier.write({ kind: 'message', data: bytes }, options)
        expect(reads).toBe(1)
        expect(bytes.byteLength).toBe(0)
        expect(retained.byteLength).toBe(2)
        expect(observed.events[0]!.beforeTransfer).toEqual([9, 1])
        expect(observed.events[0]!.detail?.transfers).toBe(1)
        expect(observed.events).toHaveLength(1)
        await pending
        /** Native getter exceptions retain the exact original TypeError at the new Promise boundary. */
        const cause = new TypeError('native transfer getter failure')
        await expect(
          carrier.write(
            { kind: 'message', data: retained },
            {
              get transfer(): readonly ArrayBuffer[] {
                throw cause
              }
            }
          )
        ).rejects.toBe(cause)
        expect(reports).not.toHaveBeenCalled()
      } finally {
        await carrier.close()
        observed.close()
      }
    }
  )

  it('retains nested transfer containers by reference after native detachment', async () => {
    /** Genuine Node native IO is the original structured-clone boundary. */
    const carrier = open('node', new NativeMessages(), () => undefined)
    /** Capture intentionally retains nested containers by reference. */
    const observed = new ProbeCapture(true)
    carrier.observation!.subscribe(observed.receive)
    carrier.subscribe({ frame() {}, close() {}, error() {} })
    /** The original backing and ordinary sibling must remain visible through their original aliases. */
    const bytes = new Uint8Array([2, 3, 4]),
      retained = { safe: true }
    /** Original repeated backing references all detach together. */
    const payload = { retained, bytes, nested: [bytes.buffer] }
    try {
      await carrier.write({ kind: 'message', data: payload }, { transfer: [bytes.buffer] })
      /** Assertions inspect the actual public captured payload projection. */
      const content = observed.events[0]!.content as typeof payload
      expect(content).toBe(payload)
      expect(content.retained).toBe(retained)
      expect(content.bytes).toBe(bytes)
      expect(content.nested).toBe(payload.nested)
      expect(content.bytes.buffer).toBe(content.nested[0])
      expect(content.nested[0]!.byteLength).toBe(0)
      expect(bytes.byteLength).toBe(0)
    } finally {
      await carrier.close()
      observed.close()
    }
  })

  it('retains cyclic Map and Set container identities while nested backings detach', async () => {
    /** The actual native source clones arbitrary structured-clone container graphs. */
    const carrier = open('node', new NativeMessages(), () => undefined)
    /** Public capture borrows original cyclic roots without a second graph traversal. */
    const observed = new ProbeCapture(true)
    carrier.observation!.subscribe(observed.receive)
    carrier.subscribe({ frame() {}, close() {}, error() {} })
    /** The transferred backing belongs to the original shared graph. */
    const buffer = new Uint8Array([5, 7]).buffer
    /** The sibling remains the original application object. */
    const retained = { unchanged: true }
    /** Cyclic aliases test identity without using captured output for physical delivery. */
    const payload: {
      buffer: ArrayBuffer
      self?: unknown
      map: Map<unknown, unknown>
      set: Set<unknown>
      retained: typeof retained
    } = { buffer, map: new Map(), set: new Set(), retained }
    payload.self = payload
    payload.map.set(buffer, payload)
    payload.set.add(buffer)
    payload.set.add(payload)
    try {
      await carrier.write({ kind: 'message', data: payload }, { transfer: [buffer] })
      /** The observer receives original references, including the actual detached backing. */
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
    } finally {
      await carrier.close()
      observed.close()
    }
  })

  it('throwing raw probes report native errors while a real public RPC request resolves', async () => {
    /** Real native ports provide both independent physical directions. */
    const ports = new MessageChannel()
    /** Original diagnostic identity stays with the actual native acquisition. */
    const reports = vi.fn()
    /** Each source lends its genuine raw observation capability and SDK codec. */
    const carriers = [
      createNodeThreadCarrier(ports.port1, 'left', reports),
      createNodeThreadCarrier(ports.port2, 'right', reports)
    ]
    /** Business execution is counted independently from native observation failure. */
    const provide = vi.fn(() => 14)
    /** Both actual public Hosts attach their original carriers concurrently. */
    const pending = carriers.map((carrier, index) =>
      createRpcHost({
        self: {
          name: index === 0 ? 'probe-client' : 'probe-server',
          instanceId: index === 0 ? 'probe-client' : 'probe-server'
        },
        report: reports,
        provide: index === 0 ? {} : { double: provide },
        plugins: [
          defineTransportPlugin({
            name: 'probe-native',
            namespace: 'memory',
            async open(context) {
              await context.attach(carrier).ready
              return { dispose() {} }
            }
          })
        ]
      })
    )
    /** Original native callback errors never become business failures. */
    const cause = new TypeError('endpoint probe failure')
    /** Keep real ready Hosts for deterministic cleanup on either construction branch. */
    const hosts = await Promise.all(pending)
    for (const carrier of carriers)
      carrier.observation!.subscribe(() => {
        throw cause
      })
    try {
      await expect(hosts[0]!.memory.send('probe-server', 'double', 7)).resolves.toBe(14)
      expect(provide).toHaveBeenCalledTimes(1)
      expect(reports.mock.calls.length).toBeGreaterThanOrEqual(4)
      for (const [error] of reports.mock.calls)
        expect(error).toMatchObject({ source: 'rpc.endpoint', code: 'TRANSPORT', cause })
    } finally {
      await Promise.all(hosts.map((host) => host.close()))
      ports.port1.close()
      ports.port2.close()
    }
  })

  it('Node native close retires observation and preserves terminal replay through ordinary disposers', async () => {
    /** The fixture exposes actual native callback custody. */
    const native = new NativeMessages()
    /** The real Node IO supplies native terminal error selection. */
    const carrier = open('node', native, () => undefined)
    /** Metadata observation must not escape native close. */
    const observed = new ProbeCapture()
    carrier.observation!.subscribe(observed.receive)
    /** The original terminal instance remains the late receiver's replay object. */
    const errors = vi.fn()
    /** Current receiver removal remains separately idempotent. */
    const remove = carrier.subscribe({ frame() {}, close: errors, error() {} })
    native.node.emit('close')
    await carrier.close()
    /** Only actual native close supplied this object. */
    const terminal = errors.mock.calls[0]![0]
    carrier.observation!.subscribe(observed.receive)
    native.node.emit('message', { kind: 'message', data: 7 })
    expect(observed.events).toHaveLength(0)
    await remove()
    await remove()
    /** A late receiver does not reacquire physical native listeners. */
    const late = vi.fn()
    carrier.subscribe({ frame() {}, close: late, error() {} })
    expect(late).toHaveBeenCalledExactlyOnceWith(terminal)
    for (const event of ['message', 'messageerror', 'close'])
      expect(native.node.listenerCount(event)).toBe(0)
    observed.close()
  })

  it('Worker explicit close prevents late receiver registration from attaching native hooks', async () => {
    /** The borrowed source keeps its native EventTarget registrations observable. */
    const native = new NativeMessages()
    /** The real Worker owner installs only its original message/error/messageerror listeners. */
    const carrier = open('worker', native, () => undefined)
    expect(native.count('error')).toBe(1)
    expect(native.count('messageerror')).toBe(1)
    /** Current carrier construction also acquires its sole message receiver up front. */
    const count = native.add.mock.calls.length
    await carrier.close()
    carrier.subscribe({ frame() {}, close() {}, error() {} })
    expect(native.add).toHaveBeenCalledTimes(count)
    expect(native.count('message')).toBe(0)
    expect(native.count('error')).toBe(0)
    expect(native.count('messageerror')).toBe(0)
  })

  it('observes real Node MessageChannel transfer before detachment', async () => {
    /** Physical native ports independently prove delivery and actual backing transfer. */
    const ports = new MessageChannel()
    /** Each genuine native source owns its existing observation implementation. */
    const left = createNodeThreadCarrier(ports.port1, 'left', () => undefined),
      right = createNodeThreadCarrier(ports.port2, 'right', () => undefined)
    /** The public emitter records each actual native callback in direction order. */
    const observed = new ProbeCapture(true)
    left.observation!.subscribe(observed.receive)
    right.observation!.subscribe(observed.receive)
    /** Only the real native receiver may resolve the business delivery Promise. */
    const received = new Promise<IRpcCarrierFrame>((resolve) =>
      right.subscribe({ frame: resolve, close() {}, error() {} })
    )
    try {
      /** Original bytes detach only at the real native handoff. */
      const bytes = new Uint8Array([4, 5])
      await left.write({ kind: 'message', data: bytes.buffer }, { transfer: [bytes.buffer] })
      expect(bytes.byteLength).toBe(0)
      expect(observed.events[0]!.beforeTransfer).toEqual([4, 5])
      expect(Array.from(new Uint8Array((await received).data as ArrayBuffer))).toEqual([4, 5])
      expect(observed.events.map((event) => event.direction)).toEqual([0, 1])
    } finally {
      await Promise.all([left.close(), right.close()])
      observed.close()
      ports.port1.close()
      ports.port2.close()
    }
  })
})
