/** Owner-review failures use public hosts and their real physical carrier pair. */
import { deferred } from '@migaia/utils/promise'
import { RpcJsonCarrierCodec } from '@migaia/rpc-host/sdk'
import { deserializeRpcWireError } from '@migaia/rpc-contract/protocol'
import { expect, it, vi } from 'vitest'
import { connectedCoreHosts } from '../host/core-fixture.js'

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
  /** The actual optional native close capability remains present on both endpoints. */
  const hosts = await connectedCoreHosts({}, {}, () => undefined, {
    create: () => new RpcJsonCarrierCodec(),
    nativeBinary: false,
    closingWrites: true
  })
  /** Native completion may refine its earlier EOF reason. */
  const reason = new Error('physical terminal reason')
  /** Only the physical path is allowed to consult this native completion port. */
  const terminalReason = vi.fn(async () => reason)
  Object.assign(hosts.pair[0], { terminalReason })
  /** A physical peer event remains distinct from local protocol failure. */
  const peerClosed = vi.fn()
  observePeerClose(hosts.a.memory, peerClosed)
  try {
    await hosts.pair[1].close(new Error('physical eof'))
    await vi.waitFor(() => expect(peerClosed).toHaveBeenCalledOnce())
    expect(terminalReason).toHaveBeenCalledOnce()
    expect(peerClosed.mock.calls[0]?.[0]).toMatchObject({ reason, closeFrame: false })
  } finally {
    await hosts.close()
  }
})

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
