/** Owner-review failures use public hosts and their real physical carrier pair. */
import { deferred } from '@migaia/utils/promise'
import { RpcJsonCarrierCodec } from '@migaia/rpc-host/sdk'
import { deserializeRpcWireError } from '@migaia/rpc-contract/protocol'
import { expect, it, vi } from 'vitest'
import { connectedCoreHosts } from '../host/core-fixture.js'

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
  hosts.a.memory.onPeerClosed(peerClosed)
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
  hosts.a.memory.onPeerClosed(peerClosed)
  try {
    await hosts.pair[1].close(new Error('physical eof'))
    await vi.waitFor(() => expect(peerClosed).toHaveBeenCalledOnce())
    expect(terminalReason).toHaveBeenCalledOnce()
    expect(peerClosed.mock.calls[0]?.[0]).toMatchObject({ reason, closeFrame: false })
  } finally {
    await hosts.close()
  }
})
