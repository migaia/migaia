/** Current native observation and carrier owners retain listener cleanup without endpoint hooks. */
import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { RpcCarrierObservation } from '@migaia/rpc-host/sdk'
import {
  RpcCarrierEncoding,
  RpcCarrierPlatform,
  RpcCarrierTopology
} from '@migaia/rpc-contract/interfaces'
import { createNodeThreadCarrier } from '../../../rpc-plugin-thread/dist/threads/channel.js'

it('keeps obsolete observation removers from withdrawing a newer identical callback', async () => {
  /** The current observation owner holds exact subscription records rather than legacy hook maps. */
  const observation = new RpcCarrierObservation(
    {
      platform: RpcCarrierPlatform.memory,
      topology: RpcCarrierTopology.exclusive,
      encodedType: RpcCarrierEncoding.any
    },
    () => undefined
  )
  /** The same original callback is intentionally reused across two different registrations. */
  const hook = vi.fn()
  /** Replacing a record retires this earlier remover. */
  const stale = observation.subscribe(hook)
  await stale()
  /** A later registration owns its distinct current record even with the same callback. */
  const current = observation.subscribe(hook)
  await stale()
  observation.emit(0, {})
  expect(hook).toHaveBeenCalledOnce()
  await current()
  await current()
  observation.emit(0, {})
  expect(hook).toHaveBeenCalledOnce()
})

describe('actual Node message source retirement', () => {
  it('replays the exact original native close error without reacquiring listeners', async () => {
    /** Native registrations remain observable without a transport compatibility object. */
    const port = Object.assign(new EventEmitter(), { postMessage: vi.fn() })
    /** The real platform IO and SDK carrier own their original subscription/remover chain. */
    const carrier = createNodeThreadCarrier(port, 'listener-close', () => undefined)
    /** One actual Session-style receiver observes the original terminal object. */
    const closed = vi.fn()
    carrier.subscribe({ frame: () => undefined, close: closed, error: () => undefined })
    port.emit('close')
    await carrier.close()
    /** Original native terminal text remains stable after the synthetic RPC scope disappears. */
    const terminal = closed.mock.calls[0]![0]
    expect(terminal).toMatchObject({ message: '[rpc] message port closed' })
    /** A late receiver reads the same terminal instance without native registration. */
    const late = vi.fn()
    carrier.subscribe({ frame: () => undefined, close: late, error: () => undefined })
    expect(late).toHaveBeenCalledExactlyOnceWith(terminal)
    for (const event of ['message', 'messageerror', 'close'])
      expect(port.listenerCount(event)).toBe(0)
    await expect(carrier.write({ kind: 'message', data: 'late' })).rejects.toBe(terminal)
  })

  it('keeps original native deserialization text and releases its diagnostic listener', async () => {
    /** Native event data retains the original deserialization diagnostic spelling. */
    const port = Object.assign(new EventEmitter(), { postMessage: vi.fn() })
    /** The acquisition report port observes physical diagnostics without closing delivery. */
    const reports = vi.fn()
    /** Current ThreadNativeIO is the canonical owner of the moved MessagePort behavior. */
    const carrier = createNodeThreadCarrier(port, 'listener-messageerror', reports)
    port.emit('messageerror', 'x')
    expect(reports.mock.calls[0]![0]).toMatchObject({
      message: '[rpc] message port could not deserialize a message: x'
    })
    await carrier.close()
    expect(port.listenerCount('messageerror')).toBe(0)
  })
})
