/** Owner-review failures use public hosts and their real physical carrier pair. */
import { deferred } from '@migaia/utils/promise'
import {
  defineFlowFeature,
  defineTransportPlugin,
  RpcFlowPoint,
  RpcJsonCarrierCodec,
  type IRpcFlowStage
} from '@migaia/rpc-host/sdk'
import { createRpcHost } from '@migaia/rpc-host'
import type {
  IRpcFlowContext,
  IRpcTransportContext,
  IRpcSessionHandle
} from '@migaia/rpc-contract/interfaces'
import { deserializeRpcWireError, RpcWireHandshakeStep } from '@migaia/rpc-contract/protocol'
import { assert, expect, it, vi } from 'vitest'
import { connectedCoreHosts, coreMemoryServer } from '../host/core-fixture.js'
import { MemoryCarrier } from '../fixtures/core-carrier.js'

/** A real accept hook lends its actual connection signal and can hold only its own continuation. */
class ClosingAcceptGate {
  /** Cold recipes may observe the same stage without suspending an ordinary ready handshake. */
  hold = true
  /** This is the real handshake context received from the installed native group. */
  readonly entered = deferred<IRpcFlowContext>()
  /** Fixture cleanup always releases the original stage continuation. */
  readonly resume = deferred<void>()
  /** An optional business failure remains distinct from a normal closing acknowledgment. */
  readonly #failure: Error | undefined
  /** The actual public feature installs the same hook under the native transport lifetime. */
  readonly feature = defineFlowFeature({
    name: 'closing-accept-gate',
    setup: () => ({ stages: { [RpcFlowPoint.handshakeOutbound]: this.#wait } })
  })

  /** Capture the original late failure without replacing the real handshake or Session. */
  constructor(failure?: Error) {
    this.#failure = failure
  }

  /** The accepted handshake remains original work; closing cannot turn a late failure into success. */
  readonly #wait: IRpcFlowStage<typeof RpcFlowPoint.handshakeOutbound> = async (payload, next) => {
    if (payload.handshake.step === RpcWireHandshakeStep.accept) {
      this.entered.resolve(payload.context)
      if (this.hold) {
        await this.resume.promise
        if (this.#failure) throw this.#failure
      }
    }
    await next(payload)
  }
}

/** A suspended original hello can reject after native close has selected a different final reason. */
class LateHelloFailure {
  /** Native Session construction reaches this real handshake hook before the test sends EOF. */
  readonly entered = deferred<void>()
  /** Release with the exact earlier lifecycle error obtained from this Session's public control. */
  readonly failure = deferred<unknown>()
  /** The actual transport installs the held work under its ordinary flow lifetime. */
  readonly feature = defineFlowFeature({
    name: 'late-hello-failure',
    setup: () => ({ stages: { [RpcFlowPoint.handshakeOutbound]: this.#wait } })
  })

  /** Keep the genuine initial hello pending, then reject it with the independently captured error. */
  readonly #wait: IRpcFlowStage<typeof RpcFlowPoint.handshakeOutbound> = async (payload, next) => {
    if (payload.handshake.step === RpcWireHandshakeStep.hello) {
      this.entered.resolve()
      throw await this.failure.promise
    }
    await next(payload)
  }
}

it('does not report an earlier closing acknowledgment after its native reason is refined', async () => {
  /** Native completion remains the sole owner of terminal reason selection. */
  const terminal = deferred<unknown>()
  /** Observe the actual closing phase before issuing the control that captures its first reason. */
  const selecting = deferred<void>()
  /** The real startup hook remains pending independently from the physical EOF path. */
  const gate = new LateHelloFailure()
  /** This endpoint emits only a native close; it does not implement a fake peer protocol. */
  const left = new MemoryCarrier('late-close-left')
  /** The acquired closing-capable carrier lends the unchanged Session lifecycle and codec. */
  const right = new MemoryCarrier('late-close-right', undefined, undefined, false, true)
  left.link(right)
  right.link(left)
  /** Earlier errors must retain this initial native cause even after terminal refinement. */
  const eof = new Error('initial physical close')
  /** Final native completion chooses a different reason without mutating delivered wrappers. */
  const final = new Error('later native close')
  /** Only real diagnostics from the original Session and native plugin are recorded. */
  const reports: unknown[] = []
  /** Capture supported native controls rather than reaching into private Session methods. */
  let context!: IRpcTransportContext
  /** This is the exact stable handle returned by native attachment. */
  let handle!: IRpcSessionHandle
  Object.assign(right, {
    terminalReason: () => {
      selecting.resolve()
      return terminal.promise
    }
  })
  /** Failed public construction remains observed while the test controls only native completion. */
  const opening = createRpcHost({
    self: { name: 'late-close', instanceId: 'late-close' },
    plugins: [
      defineTransportPlugin({
        name: 'late-close-native',
        namespace: 'memory',
        closingWrites: true,
        features: [gate.feature],
        open: async (native) => {
          context = native
          handle = native.attach(right)
          await handle.ready
          return { dispose: () => undefined }
        }
      })
    ],
    report: (error) => reports.push(error)
  }).catch((error: unknown) => error)
  try {
    await gate.entered.promise
    await left.close(eof)
    await selecting.promise
    /** The original Session creates this lifecycle wrapper during its initial closing window. */
    const failure = await context.ping(handle).catch((error: unknown) => error)
    expect(failure).toMatchObject({ code: 'ENDPOINT_DISPOSED', cause: eof })
    terminal.resolve(final)
    await handle.closed
    gate.failure.resolve(failure)
    await opening
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(failure).toMatchObject({ cause: eof })
    expect(reports).toEqual([])
  } finally {
    terminal.resolve(final)
    gate.failure.resolve(final)
    await opening
  }
})

/** The fixture erases optional native capabilities; inspect its real public namespace method. */
function observePeerClose(namespace: object, listener: (event: unknown) => void): void {
  /** Closing-capable construction installs this original namespace callback at runtime. */
  const subscribe = Reflect.get(namespace, 'onPeerClosed') as (
    handler: (event: unknown) => void
  ) => () => void
  expect(typeof subscribe).toBe('function')
  subscribe(listener)
}

it('A36 local bad-frame failure keeps its own reason, sends close and does not await native exit', async () => {
  /** The provider proves the outgoing request was written before local decoding fails. */
  const entered = deferred<void>()
  /** Application work is released independently during fixture cleanup. */
  const release = deferred<void>()
  /** Only local diagnostics are inspected; the peer owns its separate reporter. */
  const reports: unknown[] = []
  /** Real closing-capable physical endpoints retain the ordinary handshake and codecs. */
  const hosts = await connectedCoreHosts(
    {},
    {
      wait: async () => {
        entered.resolve()
        await release.promise
      }
    },
    (error) => reports.push(error),
    { create: () => new RpcJsonCarrierCodec(), nativeBinary: false, closingWrites: true },
    () => undefined
  )
  /** This unrelated native exit reason must not replace a local protocol failure. */
  const nativeExit = new Error('native exit is a different failure')
  /** The actual optional native port remains observable without replacing the Session. */
  const terminalReason = vi.fn(async () => nativeExit)
  Object.assign(hosts.pair[0], { terminalReason })
  /** The spy observes the unchanged physical frame format at its real handoff. */
  const writes = vi.spyOn(hosts.pair[0], 'write')
  /** The namespace event distinguishes local rejection from a physical peer departure. */
  const peerClosed = vi.fn()
  observePeerClose(hosts.a.memory, peerClosed)
  /** Observe rejection before deliberately delivering malformed received JSON. */
  const pending = hosts.a.memory.send('b', 'wait').catch((error: unknown) => error)
  try {
    await entered.promise
    await hosts.pair[1].write({ kind: 'message', data: '{"kind":"invalid"}' })
    /** Retirement is driven by the original receive tail, not a fabricated native EOF. */
    const failure = await pending
    expect(terminalReason).not.toHaveBeenCalled()
    expect(reports).toHaveLength(1)
    expect(failure).toMatchObject({ code: 'ENDPOINT_DISPOSED', cause: reports[0] })
    expect(peerClosed).not.toHaveBeenCalled()
    /** A local failure gives the peer its coded cause through the existing close frame. */
    const close = writes.mock.calls
      .map(([frame]) => JSON.parse(frame.data as string))
      .find((frame) => frame.kind === 'control' && frame.operation === 'close')
    expect(deserializeRpcWireError(close?.reason)).toMatchObject({
      code: (reports[0] as { code: string }).code
    })
    expect(hosts.pair[0].closed).toBe(true)
  } finally {
    release.resolve()
    await hosts.close()
    await pending
  }
})

it('A36 physical EOF still uses its native terminal reason and publishes peer closure', async () => {
  /** The public native stage observes the actual connection signal without replacing its owner. */
  const gate = new ClosingAcceptGate()
  gate.hold = false
  /** The actual optional native close capability remains present on both endpoints. */
  const hosts = await connectedCoreHosts(
    {},
    {},
    () => undefined,
    { create: () => new RpcJsonCarrierCodec(), nativeBinary: false, closingWrites: true },
    () => undefined,
    [gate.feature]
  )
  const connectionSignal = (await gate.entered.promise).signal
  assert(connectionSignal)
  /** Native completion may refine its earlier EOF reason. */
  const reason = new Error('physical terminal reason')
  /** The provisional native Error remains caller-owned when the final reason replaces it. */
  const eof = new Error('physical eof')
  /** Only the physical path is allowed to consult this native completion port. */
  const terminalReason = vi.fn(async () => reason)
  Object.assign(hosts.pair[1], { terminalReason })
  /** A physical peer event remains distinct from local protocol failure. */
  const peerClosed = vi.fn()
  observePeerClose(hosts.b.memory, peerClosed)
  try {
    await hosts.pair[0].close(eof)
    await vi.waitFor(() => expect(peerClosed).toHaveBeenCalledOnce())
    expect(terminalReason).toHaveBeenCalledOnce()
    expect(peerClosed.mock.calls[0]?.[0]).toMatchObject({ reason, closeFrame: false })
    expect(connectionSignal.aborted).toBe(true)
    /** The one closing wrapper must carry the selected native reason, not the provisional EOF. */
    const cancellation = connectionSignal.reason
    assert(cancellation instanceof Error)
    expect(cancellation.cause).toBe(reason)
    expect(eof).not.toHaveProperty('cause')
    expect(reason).not.toHaveProperty('cause')
  } finally {
    await hosts.close()
  }
})

it('A45 public transport controls preserve closing-window errors after native reason selection', async () => {
  /** Both public Hosts acquire native carriers through the existing SDK transport hook. */
  const gate = new ClosingAcceptGate()
  gate.hold = false
  /** Existing listener-style construction owns the server's canonical native installation. */
  const server = coreMemoryServer('a', 'public-close-a', 'memory', [], [], {
    create: () => new RpcJsonCarrierCodec(),
    nativeBinary: false,
    closingWrites: true
  })
  /** Public root construction preserves the same plugin-host and Session ownership as production. */
  const a = await createRpcHost(server.options)
  /** The physical server endpoint retains its ordinary JSON codec and close capability. */
  const left = new MemoryCarrier(
    'public-close-left',
    undefined,
    new RpcJsonCarrierCodec(),
    false,
    true
  )
  /** The physical client endpoint supplies the delayed terminal reason through its actual port. */
  const right = new MemoryCarrier(
    'public-close-right',
    undefined,
    new RpcJsonCarrierCodec(),
    false,
    true
  )
  left.link(right)
  right.link(left)
  /** Only native completion chooses the final reason after physical EOF has started closing. */
  const terminal = deferred<unknown>()
  /** Signal the point where the actual Session awaits native completion. */
  const selecting = deferred<void>()
  /** Provisional native EOF remains the immutable cause of closing-window errors. */
  const eof = new Error('public provisional EOF')
  /** The final native Error becomes the connection abort reason's cause. */
  const final = new Error('public native terminal reason')
  /** Only client diagnostics are relevant to closing-window acknowledgments. */
  const reports: unknown[] = []
  /** The public SDK provides the native transport's existing control port. */
  let context!: IRpcTransportContext
  /** The attached resource lends its original stable lifecycle handle to that control port. */
  let handle!: IRpcSessionHandle
  Object.assign(right, {
    terminalReason: () => {
      selecting.resolve()
      return terminal.promise
    }
  })
  /** This supported transport attaches the native endpoints without a test-only Session seam. */
  const transport = defineTransportPlugin({
    name: 'public-close-native',
    namespace: 'memory',
    closingWrites: true,
    features: [gate.feature],
    open: async (native) => {
      context = native
      /** Server readiness remains owned by its original accepted Session. */
      const remote = server.accept(left)
      handle = native.attach(right)
      await Promise.all([remote.ready, handle.ready])
      return { dispose: () => undefined }
    }
  })
  /** The independent public client installs the real transport and its observation feature. */
  const b = await createRpcHost({
    self: { name: 'b', instanceId: 'public-close-b' },
    plugins: [transport],
    report: (error) => reports.push(error)
  })
  /** Installed handshake hooks expose the genuine connection signal, never a copied controller. */
  const signal = (await gate.entered.promise).signal
  assert(signal)
  try {
    await left.close(eof)
    await selecting.promise
    /** This native control enters after EOF, before terminal selection completes. */
    const first = await context.ping(handle).catch((error: unknown) => error)
    expect(first).toMatchObject({ code: 'ENDPOINT_DISPOSED', cause: eof })
    terminal.resolve(final)
    await handle.closed
    expect(first).toMatchObject({ cause: eof })
    expect(signal.reason).not.toBe(first)
    expect(signal.reason).toMatchObject({ cause: final })
    expect(reports).toEqual([])
  } finally {
    terminal.resolve(final)
    await Promise.all([a.close(), b.close()])
  }
})

it.each(['acknowledgment', 'genuine failure'] as const)(
  'A40 suspended handshake accept preserves closing %s diagnostics',
  async (mode) => {
    /** Only the optional genuine business error may be reported after ordinary close. */
    const lateError = new Error('late handshake business failure')
    const gate = new ClosingAcceptGate(mode === 'genuine failure' ? lateError : undefined)
    /** This window belongs only to the real server's Session and native lifetime. */
    const reports: unknown[] = []
    /** The existing listener creates both physical endpoints and the original accept handshake. */
    const server = coreMemoryServer('a', 'closing-accept-a', 'memory', [gate.feature], [], {
      create: () => new RpcJsonCarrierCodec(),
      nativeBinary: false,
      closingWrites: true
    })
    const host = await createRpcHost({ ...server.options, report: (error) => reports.push(error) })
    /** Client construction may fail normally when its original peer closes during admission. */
    const connected = server
      .connect('b', { report: () => undefined }, 'closing-accept-b')
      .catch((error: unknown) => error)
    try {
      const context = await gate.entered.promise
      const aborted = deferred<void>()
      context.signal.addEventListener('abort', () => aborted.resolve(), { once: true })
      /** Closing starts before the real accepted handshake continuation resumes. */
      const closing = host.close(new Error('close during handshake accept'))
      await aborted.promise
      gate.resume.resolve()
      await closing
      await connected
      if (mode === 'acknowledgment') expect(reports).toEqual([])
      else {
        expect(reports).toContain(lateError)
        expect(reports.every((error) => error === lateError)).toBe(true)
      }
    } finally {
      gate.resume.resolve()
      await host.close()
      await connected
    }
  }
)

it.each(['caller', 'session'] as const)(
  'A40 %s cancellation while encoding does not report a late failure',
  async (cancelledBy) => {
    /** Actual codec suspension makes cancellation happen before physical handoff. */
    const entered = deferred<void>()
    /** The application codec ignores cancellation until its real late continuation resumes. */
    const release = deferred<void>()
    /** Only the caller's real Session diagnostics are relevant to this assertion. */
    const reports: unknown[] = []
    /** Closing support exercises the retained lifecycle conversion used by native transports. */
    const hosts = await connectedCoreHosts(
      {},
      { echo: (value) => value },
      (error) => reports.push(error),
      {
        create: () => new RpcJsonCarrierCodec(),
        nativeBinary: false,
        closingWrites: true
      },
      () => undefined
    )
    /** Capture the original implementation before holding only the next business encode. */
    const encode = hosts.pair[0].codec.encode
    /** One suspended business encode leaves close-control encoding able to finish normally. */
    let held = false
    vi.spyOn(hosts.pair[0].codec, 'encode').mockImplementation(async (value, context) => {
      if (
        !held &&
        value.message &&
        typeof value.message === 'object' &&
        Object.getOwnPropertyDescriptor(value.message, 'kind')?.value === 'call'
      ) {
        held = true
        entered.resolve()
        await release.promise
      }
      /** Reflect.apply preserves this component method's receiver while its spy remains installed. */
      return Reflect.apply(encode, hosts.pair[0].codec, [value, context])
    })
    /** The real CallRecord and Session share this original caller cancellation input. */
    const controller = new AbortController()
    /** The original reason must be acknowledged without an additional diagnostic wrapper. */
    const reason = new Error(`${cancelledBy} cancelled encoding`)
    /** Observe the actual call rejection before causing either supported cancellation. */
    const pending = hosts.a.memory
      .send('b', 'echo', 'held', { signal: controller.signal })
      .catch((error: unknown) => error)
    try {
      await entered.promise
      if (cancelledBy === 'caller') controller.abort(reason)
      else await hosts.a.close(reason)
      expect(await pending).toBeInstanceOf(Error)
      release.resolve()
      /** Drain the ignored codec's original late handlers without a polling timeout. */
      await new Promise<void>((resolve) => setImmediate(resolve))
      expect(reports).toEqual([])
    } finally {
      release.resolve()
      await hosts.close()
      await pending
    }
  }
)
