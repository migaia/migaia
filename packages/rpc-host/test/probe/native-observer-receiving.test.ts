/** Original observer business reaches real native Session, media and collector owners. */
import { createRpcHost, type IRpcContext } from '@migaia/rpc-host'
import {
  defineProbe,
  probe,
  RpcProbeDirection,
  RpcProbeKind,
  RpcProbeStage,
  type IRpcProbeDescriptor,
  type IRpcProbeEventView
} from '@migaia/rpc-host/plugins/probe'
import {
  defineTransportPlugin,
  RpcCarrierObservation,
  RpcJsonCarrierCodec
} from '@migaia/rpc-host/sdk'
import chunk from '@migaia/rpc-host/features/chunk'
import type { IRpcTransportContext, IRpcSessionHandle } from '@migaia/rpc-contract/interfaces'
import { devtoolsPlugin } from '../../../rpc-plugin-devtools/src/index.js'
import { assert, expect, it, vi } from 'vitest'
import { MemoryCarrier } from '../fixtures/core-carrier.js'
import { coreMemoryServer } from '../host/core-fixture.js'

/** Only the genuine transport installation fills these original native control references. */
type IObservedSource = {
  context?: IRpcTransportContext
  handle?: IRpcSessionHandle
}

/** SessionTable owns physical cleanup; this native registration acquires no second resource. */
function releaseObservedSource(): void {}

/** The genuine observation receipt owns these original acquisition and release counts. */
type IObservationCleanup = {
  observed: number
  released: number
  subscribe: RpcCarrierObservation['subscribe']
}

/** Count the original native remover without replacing its infallible unsubscribe behavior. */
function observationCleanup(
  observation: RpcCarrierObservation,
  listener: Parameters<RpcCarrierObservation['subscribe']>[0],
  fixture: IObservationCleanup
): () => void {
  fixture.observed++
  /** The original subscription owns its own release; this job creates no replacement emitter. */
  const remove = Reflect.apply(fixture.subscribe, observation, [listener])
  return () => {
    fixture.released++
    remove()
  }
}

/** Attach one actual carrier without introducing another sender, decoder or Session registry. */
function observedSource(name: string, carrier: MemoryCarrier, installed: IObservedSource) {
  return defineTransportPlugin({
    name,
    namespace: 'memory',
    closingWrites: carrier.closingWrites,
    open(context) {
      installed.context = context
      installed.handle = context.attach(carrier)
      return { dispose: releaseObservedSource }
    }
  })
}

/** The original held business operation completes only after its real provider signal aborts. */
class AbortEcho {
  /** Provider entry precedes the original caller cancellation. */
  started = false
  /** This records the actual receiving provider's signal rather than a probe-derived guess. */
  aborted = false
  /** Only this provider invocation owns its pending completion callback. */
  #resolve: (() => void) | undefined

  /** Return ordinary payloads unchanged and hold only the original cancellation fixture input. */
  readonly echo = async (value: unknown, context: IRpcContext): Promise<unknown> => {
    if (value === 'held-variation') {
      this.started = true
      await new Promise<void>((resolve) => {
        this.#resolve = resolve
        context.signal.addEventListener('abort', this.#onAbort, { once: true })
      })
    }
    return value
  }

  /** The once-only native signal listener releases its original pending provider completion. */
  readonly #onAbort = (): void => {
    this.aborted = true
    this.#resolve?.()
    this.#resolve = undefined
  }
}

/** The excluded method still executes its original business response. */
function unchanged(value: unknown): unknown {
  return value
}

// RPC-TEST-D82FEFDF8439: real method filters, ping/pong/close, cancellation and record codec.
it('keeps genuine control and cancellation observations through both echo filters', async () => {
  /** This caller-owned collector is installed independently against both actual native hosts. */
  const devtools = devtoolsPlugin({ methods: ['echo'], maxEvents: 256 })
  /** The reusable production event view is copied only at the original observer boundary. */
  const coreEvents: IRpcProbeEventView[] = []
  /** One genuine handle serves both installed emitters without a forwarding callback. */
  const observer = probe(
    defineProbe({
      stages: ['message', 'envelope'],
      methods: ['echo'],
      emit: (view) => coreEvents.push(Object.freeze({ ...view }))
    })
  )
  /** Recording starts before the first real Session can publish an event. */
  const recording = devtools.collector.record({ maxEvents: 256 })
  /** These are the same original native endpoints used for all business and control operations. */
  const leftCarrier = new MemoryCarrier('observer-left', undefined, undefined, true, true)
  /** The second endpoint is independently attached by its actual transport installation. */
  const rightCarrier = new MemoryCarrier('observer-right', undefined, undefined, true, true)
  leftCarrier.link(rightCarrier)
  rightCarrier.link(leftCarrier)
  /** Native control authority stays with the actual SDK contexts that acquired these carriers. */
  const leftSource: IObservedSource = {},
    rightSource: IObservedSource = {}
  /** Each provider owns its own held operation and receives the other caller's cancellation. */
  const leftEcho = new AbortEcho(),
    rightEcho = new AbortEcho()
  /** Public native hosts install the exact same readonly probe and collector definitions. */
  const [left, right] = await Promise.all([
    createRpcHost({
      self: { name: 'observer-left', instanceId: 'observer-left' },
      plugins: [
        observer,
        devtools,
        observedSource('observer-left-source', leftCarrier, leftSource)
      ],
      provide: { echo: leftEcho.echo, other: unchanged },
      report: () => undefined
    }),
    createRpcHost({
      self: { name: 'observer-right', instanceId: 'observer-right' },
      plugins: [
        observer,
        devtools,
        observedSource('observer-right-source', rightCarrier, rightSource)
      ],
      provide: { echo: rightEcho.echo, other: unchanged },
      report: () => undefined
    })
  ])
  try {
    assert(leftSource.handle && rightSource.handle)
    await Promise.all([leftSource.handle.ready, rightSource.handle.ready])
    expect(await left.memory!.send('observer-right', 'echo', 'selected')).toBe('selected')
    expect(await left.memory!.send('observer-right', 'other', 'excluded')).toBe('excluded')
    // Exactly two native endpoints form this fixed fixture, not a growable peer traversal.
    for (const index of [0, 1] as const) {
      /** The original installation supplies the native control method for this orientation. */
      const source = index === 0 ? leftSource : rightSource
      /** Business cancellation uses the same public host as this control direction. */
      const sender = index === 0 ? left : right
      /** The destination is the other admitted host's actual identity. */
      const target = index === 0 ? 'observer-right' : 'observer-left'
      /** Only this receiving provider can prove its own original signal abort. */
      const provider = index === 0 ? rightEcho : leftEcho
      assert(source.context && source.handle)
      await expect(source.context.ping(source.handle)).resolves.toBeUndefined()
      /** Attach rejection handling before the original caller aborts its admitted request. */
      const controller = new AbortController()
      const cancellation = expect(
        sender.memory!.send(target, 'echo', 'held-variation', {
          signal: controller.signal
        })
      ).rejects.toMatchObject({ code: 'CANCELLED' })
      await vi.waitFor(() => expect(provider.started).toBe(true))
      controller.abort()
      await cancellation
      await vi.waitFor(() => expect(provider.aborted).toBe(true))
    }
    // These fixed two acquired sources preserve the original zero remaining drain budget.
    for (const source of [leftSource, rightSource]) {
      assert(source.context && source.handle)
      await source.context.drain(source.handle, 0)
    }
    for (const carrier of [leftCarrier, rightCarrier])
      expect(
        carrier.written.find(
          (message) => message.kind === 'control' && message.operation === 'drain'
        )
      ).toMatchObject({ route: { remainingMs: 0 } })
    await Promise.all([left.close(), right.close()])
    /** The original method whitelist never hides methodless native control or cancellation facts. */
    const events = devtools.query({ stages: ['message'] }).events
    expect(events.some((event) => event.method === 'echo')).toBe(true)
    expect(events.some((event) => event.method === 'other')).toBe(false)
    for (const variation of ['ping', 'pong', 'close'])
      for (const direction of ['outbound', 'inbound']) {
        /** The retained collector row comes from the real native control emission. */
        const event = events.find(
          (entry) => entry.variation === variation && entry.direction === direction
        )
        expect(event).toBeDefined()
        expect(event!.kind).toBe('control')
        for (const stage of [RpcProbeStage.message, RpcProbeStage.envelope]) {
          /** The Core sink independently receives that real stage and direction. */
          const observed = coreEvents.find(
            (entry) =>
              entry.stage === stage &&
              entry.variation === variation &&
              entry.direction ===
                (direction === 'outbound' ? RpcProbeDirection.outbound : RpcProbeDirection.inbound)
          )
          expect(observed).toBeDefined()
          if (stage === RpcProbeStage.message) expect(observed!.kind).toBe(RpcProbeKind.control)
        }
      }
    for (const direction of ['outbound', 'inbound']) {
      expect(events.some((event) => event.kind === 'cancel' && event.direction === direction)).toBe(
        true
      )
      /** Both genuine sinks retain cancellation's actual semantic kind and direction. */
      const nativeDirection =
        direction === 'outbound' ? RpcProbeDirection.outbound : RpcProbeDirection.inbound
      /** This is the message-stage event produced by the actual cancellation owner. */
      const cancelled = coreEvents.find(
        (event) =>
          event.stage === RpcProbeStage.message &&
          event.kind === RpcProbeKind.cancel &&
          event.direction === nativeDirection
      )
      expect(cancelled).toBeDefined()
      expect(
        coreEvents.some(
          (event) =>
            event.stage === RpcProbeStage.envelope &&
            event.direction === nativeDirection &&
            event.messageId === cancelled?.messageId
        )
      ).toBe(true)
    }
    expect(coreEvents.some((event) => event.method === 'echo')).toBe(true)
    expect(coreEvents.some((event) => event.method === 'other')).toBe(false)
    for (const event of events)
      if (event.kind === 'request' || event.kind === 'response')
        expect(event.variation).toBeUndefined()
    for (const event of coreEvents)
      if (event.kind === RpcProbeKind.request || event.kind === RpcProbeKind.response)
        expect(event.variation).toBeUndefined()
    /** The one real record codec preserves the actual collector sequence and event identities. */
    const decoded = devtools.collector.importRecord(
      devtools.collector.exportRecord(recording.stop())
    )
    expect(
      decoded.events
        .filter((event) => event.stage === 'message')
        .map((event) => [event.seq, event.direction, event.kind, event.method, event.variation])
    ).toEqual(
      events.map((event) => [event.seq, event.direction, event.kind, event.method, event.variation])
    )
  } finally {
    await Promise.allSettled([left.close(), right.close()])
    devtools.close()
  }
})

// RPC-TEST-B569E95AA42F-C002: actual acquisition rollback precedes descriptor publication.
it('rolls back the actual native observer before describing a failed Session', async () => {
  /** The actual acquisition failure must retain its original identity. */
  const original = new Error('endpoint construction fixture')
  /** No accepted Session exists from which to publish a descriptor. */
  const describe = vi.fn()
  /** The existing listener owns the failed native attachment and rollback. */
  const listener = coreMemoryServer('observer-failure-provider')
  /** A genuine receiving host installs observation before physical acquisition. */
  const host = await createRpcHost({
    ...listener.options,
    plugins: [
      probe({ stages: ['peer', 'carrier'], describe, emit: () => undefined }),
      listener.transport
    ]
  })
  /** Only this acquired native endpoint fails its receiver subscription. */
  const carrier = new MemoryCarrier('observer-failed-acquisition')
  /** The supported native subscription supplies the original failure stimulus. */
  const subscribe = vi.spyOn(carrier, 'subscribe').mockImplementation(() => {
    throw original
  })
  try {
    /** The original native handle owns readiness rejection and rollback completion. */
    const handle = listener.accept(carrier)
    await expect(handle.ready).rejects.toBe(original)
    await handle.closed
    expect(describe).toHaveBeenCalledTimes(0)
    expect(carrier.observation.active).toBe(false)
  } finally {
    subscribe.mockRestore()
    await host.close()
  }
})

// RPC-TEST-B569E95AA42F-C003: supported physical failure and critical-before-observer release remain.
it('keeps physical close first and preserves its original failure while releasing the observer once', async () => {
  /** Critical physical close failure remains first in the actual cleanup result. */
  const primary = new Error('primary close fixture')
  /** The public probe diagnostic sink remains independent from close settlement. */
  const failures: unknown[] = []
  /** The counters belong to the real subscription rather than a synthetic probe event. */
  const observation: IObservationCleanup = {
    observed: 0,
    released: 0,
    subscribe: RpcCarrierObservation.prototype.subscribe
  }
  const subscribe = vi
    .spyOn(RpcCarrierObservation.prototype, 'subscribe')
    .mockImplementation(function (this: RpcCarrierObservation, listener) {
      return observationCleanup(this, listener, observation)
    })
  /** The shared source fixture still acquires both actual native Sessions. */
  const listener = coreMemoryServer('observer-cleanup-provider')
  /** A genuine receiving host installs observation before physical acquisition. */
  const host = await createRpcHost({
    ...listener.options,
    plugins: [
      probe({
        stages: ['carrier'],
        emit: () => undefined,
        onError: (error) => failures.push(error)
      }),
      listener.transport
    ]
  })
  /** The opposite endpoint installs no observer and keeps ordinary native lifecycle. */
  const client = await listener.connect('observer-cleanup-caller')
  /** Physical EOF occurs through the same acquired native close operation. */
  const closeOriginal = client.pair[0].close
  /** Inject failure only after the original physical close completion. */
  const close = vi.spyOn(client.pair[0], 'close').mockImplementation(async (reason) => {
    await closeOriginal(reason)
    expect(observation.released).toBe(0)
    throw primary
  })
  try {
    /** This accepted Session owns the supported original physical release failure. */
    const handle = listener.lookup('observer-cleanup-caller')!.handle
    /** The physical release remains the exact close rejection, without an observer failure wrapper. */
    const failure: unknown = await handle.close().catch((error: unknown) => error)
    expect(failure).toBe(primary)
    expect(failures).toHaveLength(0)
    await handle.close().catch(() => undefined)
    expect(observation.observed).toBe(1)
    expect(observation.released).toBe(1)
    expect(client.pair[0].observation.active).toBe(false)
  } finally {
    close.mockRestore()
    subscribe.mockRestore()
    await Promise.allSettled([client.host.close(), host.close()])
  }
})

// RPC-TEST-552CD5F1E175-C001 and RPC-TEST-5F6EE362E07F-C002: observation adds no codec work.
it('keeps native business, exact codec traversal and released resources equal with an observer', async () => {
  /** Equal workloads retain only actual settled native media facts. */
  const snapshots: unknown[] = []
  for (const observed of [false, true]) {
    /** Only the observed arm may publish its original single descriptor. */
    const descriptors: IRpcProbeDescriptor[] = []
    /** The genuine readonly observer supplies no alternative execution path. */
    const observer = probe(
      defineProbe({
        stages: ['message', 'frame'],
        emit: () => undefined,
        describe: (descriptor) => descriptors.push(descriptor)
      })
    )
    /** Both comparison arms use the identical JSON medium and provider. */
    const listener = coreMemoryServer(
      'observer-counter-provider',
      'observer-counter-provider',
      'memory',
      [],
      [],
      {
        create: () => new RpcJsonCarrierCodec(),
        nativeBinary: false
      }
    )
    /** The provider remains unobserved and identical in both comparison arms. */
    const server = await createRpcHost({ ...listener.options, provide: { echo: unchanged } })
    /** The sole caller-side configuration difference is the installed native probe. */
    const connected = await listener.connect('observer-counter-caller', {
      plugins: observed ? [observer] : []
    })
    /** These passthrough spies observe only the four original executing codec methods and writes. */
    const spies = connected.pair.map((carrier) => ({
      prepare: vi.spyOn(carrier.codec, 'prepare'),
      encode: vi.spyOn(carrier.codec, 'encode'),
      decode: vi.spyOn(carrier.codec, 'decode'),
      restore: vi.spyOn(carrier.codec, 'restore'),
      write: vi.spyOn(carrier, 'write')
    }))
    try {
      expect(await connected.host.memory!.send('observer-counter-provider', 'echo', 'warm')).toBe(
        'warm'
      )
      for (const entry of spies) for (const spy of Object.values(entry)) spy.mockClear()
      expect(
        await connected.host.memory!.send('observer-counter-provider', 'echo', 'measured')
      ).toBe('measured')
      /** One measured roundtrip must execute each original codec operation once per endpoint. */
      const counts = { prepare: 0, encode: 0, decode: 0, restore: 0, write: 0 }
      for (const entry of spies)
        for (const name of ['prepare', 'encode', 'decode', 'restore', 'write'] as const)
          counts[name] += entry[name].mock.calls.length
      expect(counts).toEqual({ prepare: 2, encode: 2, decode: 2, restore: 2, write: 2 })
      expect(await connected.host.memory!.send('observer-counter-provider', 'echo', 42)).toBe(42)
      expect(await connected.host.memory!.send('observer-counter-provider', 'echo', 'value')).toBe(
        'value'
      )
      if (observed) {
        expect(descriptors).toHaveLength(1)
        expect(descriptors[0]!.stageMask & 16).toBe(16)
      }
      await Promise.all([connected.host.close(), server.close()])
      /** Native facts prove both original receivers and physical subscriptions were released. */
      const physical = connected.pair.map((carrier) => ({
        closed: carrier.closed,
        unsubscribed: carrier.unsubscribed,
        observing: carrier.observation.active
      }))
      expect(physical).toEqual([
        { closed: true, unsubscribed: 1, observing: false },
        { closed: true, unsubscribed: 1, observing: false }
      ])
      snapshots.push({ counts, physical })
    } finally {
      for (const entry of spies) for (const spy of Object.values(entry)) spy.mockRestore()
      await Promise.all([connected.host.close(), server.close()])
    }
  }
  expect(snapshots[1]).toEqual(snapshots[0])
})

// RPC-TEST-5F6EE362E07F-C003: native chunk execution replaces only the removed framer descriptor.
it('keeps the original large public payload fragmented on both actual native directions', async () => {
  /** The canonical chunk Feature alone produces and assembles all fragments. */
  const fragments = chunk({ chunkBytes: 64 })
  /** Actual JSON media makes physical fragmentation observable without a fixture encoder. */
  const listener = coreMemoryServer('native-copy-server', 'native-copy-server', 'memory', [], [], {
    create: () => new RpcJsonCarrierCodec(),
    nativeBinary: false
  })
  /** The provider has an independent genuine native chunk installation. */
  const server = await createRpcHost({
    ...listener.options,
    plugins: [fragments, listener.transport],
    provide: { echo: unchanged }
  })
  /** The caller installs the same cold definition with separate runtime state. */
  const connected = await listener.connect('native-copy-client', { plugins: [fragments] })
  /** Only accepted client physical writes contribute to the original count. */
  const clientFrames = vi.spyOn(connected.pair[1], 'write')
  /** Reverse physical writes remain independently observable. */
  const serverFrames = vi.spyOn(connected.pair[0], 'write')
  try {
    expect(await connected.host.memory!.send('native-copy-server', 'echo', 'warm')).toBe('warm')
    clientFrames.mockClear()
    serverFrames.mockClear()
    /** The exact original business string forces real fragments in both directions. */
    const payload = 'native-copy-'.repeat(32)
    expect(await connected.host.memory!.send('native-copy-server', 'echo', payload)).toBe(payload)
    expect(clientFrames.mock.calls.length).toBeGreaterThan(1)
    expect(serverFrames.mock.calls.length).toBeGreaterThan(1)
    for (const [frame] of clientFrames.mock.calls)
      expect(frame).toMatchObject({ kind: 'extension', extension: 'chunk@1' })
    for (const [frame] of serverFrames.mock.calls)
      expect(frame).toMatchObject({ kind: 'extension', extension: 'chunk@1' })
  } finally {
    clientFrames.mockRestore()
    serverFrames.mockRestore()
    await Promise.all([connected.host.close(), server.close()])
  }
})

// C004-A001/A002 receive only provider values/order; opaque framing and equal keys remain pending.
it('keeps original control and payload order from two actual public chunk sources', async () => {
  /** Every real native installation owns its own canonical chunk state. */
  const fragments = chunk({ chunkBytes: 64, required: true })
  /** Original provider effects distinguish the two physical sources without observing decoding. */
  const received: unknown[] = []
  /** Only the real admitted provider context supplies each sender's identity. */
  const sources: string[] = []
  /** The existing listener supplies distinct MemoryCarrier pairs and Sessions for both callers. */
  const listener = coreMemoryServer('opaque-server', 'opaque-server', 'memory', [], [], {
    create: () => new RpcJsonCarrierCodec(),
    nativeBinary: false
  })
  /** The same actual server receives both original source payloads through public chunk. */
  const server = await createRpcHost({
    ...listener.options,
    plugins: [fragments, listener.transport],
    provide: {
      echo: (value, context) => {
        received.push(value)
        sources.push(context.senderId)
        return context.success(value)
      }
    }
  })
  /** Partial acquisition cleanup borrows only the original first caller Host. */
  let first: Awaited<ReturnType<typeof listener.connect>> | undefined
  /** The second caller owns an independent actual transport and accepted Session. */
  let second: Awaited<ReturnType<typeof listener.connect>> | undefined
  try {
    first = await listener.connect('opaque-a', { plugins: [fragments] })
    second = await listener.connect('opaque-b', { plugins: [fragments] })
    expect(first.pair[0].id).not.toBe(second.pair[0].id)
    expect(listener.lookup('opaque-a')!.handle).not.toBe(listener.lookup('opaque-b')!.handle)
    await first.host.memory!.notify('echo', 'control-a', { targetId: 'opaque-server' })
    await expect.poll(() => received).toEqual(['control-a'])
    received.length = 0
    sources.length = 0
    await first.host.memory!.notify('echo', 'opaque-a', { targetId: 'opaque-server' })
    /** Actual first-provider acceptance, rather than a delay, preserves the original effect order. */
    await expect.poll(() => received).toEqual(['opaque-a'])
    await second.host.memory!.notify('echo', 'opaque-b', { targetId: 'opaque-server' })
    await expect.poll(() => received).toEqual(['opaque-a', 'opaque-b'])
    expect(sources).toEqual(['opaque-a', 'opaque-b'])
  } finally {
    await Promise.all([first?.host.close(), second?.host.close(), server.close()])
  }
})
