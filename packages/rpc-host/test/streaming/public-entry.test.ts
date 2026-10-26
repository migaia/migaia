/** The original public stream delivery uses the sole Host namespace instead of deleted roots. */
import { expect, it, vi } from 'vitest'
import { connectedCoreHosts } from '../host/core-fixture.js'
import { RpcJsonCarrierCodec } from '@migaia/rpc-host/sdk'
import {
  RpcCallMode,
  RpcStreamEvent,
  RpcWireKind,
  type IRpcEnvelope,
  type IRpcSemanticFrame
} from '@migaia/rpc-contract/protocol'
import { StreamChannel } from '../../dist/stream/channel.js'

/** Borrow only the actual channel created by public stream(), keeping its original open call. */
function observePublicStreamOwner(owners: StreamChannel[]) {
  /** The production method remains the sole iterator constructor and original receiver. */
  const open = StreamChannel.prototype.open
  return vi.spyOn(StreamChannel.prototype, 'open').mockImplementation(function (
    this: StreamChannel,
    ...args: Parameters<StreamChannel['open']>
  ) {
    owners.push(this)
    return Reflect.apply(open, this, args) as ReturnType<StreamChannel['open']>
  })
}

/** Select an already-written terminal without parsing, restoring or executing another stream. */
function isNativeStreamTerminal(frame: IRpcSemanticFrame): boolean {
  return frame.kind === RpcWireKind.stream && frame.stream.event !== RpcStreamEvent.open
}

it('delivers the original stream items through the complete public Host entry', async () => {
  /** Both real Hosts install their original raw memory carriers and complete actual handshakes. */
  const fixture = await connectedCoreHosts({
    one: function* () {
      yield 'value'
    }
  })
  try {
    /** Exactly one accepted provider selects the ordinary iterator rather than broadcast output. */
    const values = fixture.b.memory.stream('one', null) as AsyncIterableIterator<unknown>
    expect(await values.next()).toEqual({ done: false, value: 'value' })
    expect(await values.next()).toEqual({ done: true, value: undefined })
  } finally {
    await fixture.b.close()
    await fixture.a.close()
  }
})

it.each([false, true])(
  'unopened stream termination performs no physical work (throw=%s)',
  async (thrown) => {
    /** Actual provider entry must remain absent when its public lazy iterator terminates unopened. */
    const provider = vi.fn(function* () {
      yield 'unreachable'
    })
    /** Both hosts and the original raw pair remain available to observe physical write count. */
    const fixture = await connectedCoreHosts({ cold: provider })
    /** Observe only post-construction native writes, without replacing the physical operation. */
    const write = vi.spyOn(fixture.pair[1], 'write')
    try {
      /** The terminated iterator previously retained this original input even though no IO occurred. */
      const iterator = fixture.b.memory.stream(
        'cold',
        'x'.repeat(64 * 1024)
      ) as AsyncIterableIterator<unknown>
      expect(iterator[Symbol.asyncIterator]()).toBe(iterator)
      /** A thrown primary remains exactly the caller's object on the unopened path. */
      const reason = new Error('unopened stream throw')
      if (thrown) await expect(iterator.throw!(reason)).rejects.toBe(reason)
      else expect(await iterator.return!('closed')).toEqual({ done: true, value: 'closed' })
      expect(await iterator.next()).toEqual({ done: true, value: undefined })
      expect(provider).not.toHaveBeenCalled()
      expect(write).not.toHaveBeenCalled()
    } finally {
      write.mockRestore()
      await fixture.close()
    }
  }
)

it.each(['item', 'end'] as const)(
  'R18 public sender rejects an oversized %s without hanging',
  async (event) => {
    /** Actual JSON media owns the sole sender measurement before native write. */
    const fixture = await connectedCoreHosts(
      {
        oversized: function* () {
          if (event === 'item') yield 'x'.repeat(16383)
          else return 'x'.repeat(16383)
        }
      },
      {},
      () => undefined,
      { create: () => new RpcJsonCarrierCodec(), nativeBinary: false }
    )
    try {
      const values = fixture.b.memory.stream('oversized', null) as AsyncIterableIterator<unknown>
      await expect(values.next()).rejects.toMatchObject({
        source: 'rpc.endpoint',
        code: 'PAYLOAD_INVALID'
      })
    } finally {
      await fixture.close()
    }
  }
)

// RPC-TEST-28443200104E-C001-A001: preserve the original unknown-cancelled diagnostic code.
it('reports INVALID_STREAM for an unknown cancelled frame on the actual accepted source', async () => {
  /** No genuine stream provider may execute for a terminal whose original id was never opened. */
  const count = vi.fn(function* () {
    yield 'unused'
  })
  /** Only the real provider Host's configured reporter contributes diagnostic observations. */
  const reports: unknown[] = []
  /** Third argument reports provider a; fifth argument keeps independent caller b diagnostics apart. */
  const fixture = await connectedCoreHosts(
    { count, calibrate: () => 42 },
    {},
    (error) => reports.push(error),
    undefined,
    () => undefined
  )
  try {
    expect(await fixture.b.memory.send('a', 'calibrate')).toBe(42)
    /** Actual caller writes lend the admitted profile, task generations and exact physical route. */
    const calibration = fixture.pair[1].written.find(
      (frame) => frame.kind === RpcWireKind.call && frame.task.method === 'calibrate'
    )
    if (calibration?.kind !== RpcWireKind.call)
      expect.unreachable('actual calibration call was not written')
    expect(calibration.id).not.toBe('stream-1')
    /** Only the unknown id and stream mode/method differ from this genuine admitted task tuple. */
    const message: IRpcEnvelope = {
      profile: calibration.profile,
      kind: RpcWireKind.stream,
      id: 'stream-1',
      task: { ...calibration.task, mode: RpcCallMode.stream, method: 'count' },
      route: calibration.route,
      stream: { event: RpcStreamEvent.cancelled, seq: 0 }
    }
    /** The existing identity medium delivers this raw current-profile frame to its actual Session. */
    await fixture.pair[1].write({ kind: 'message', data: message })
    await vi.waitFor(() => expect(reports).toHaveLength(1))
    expect(count).not.toHaveBeenCalled()
    expect(reports.map((error) => (error as { readonly code?: unknown }).code)).toContain(
      'INVALID_STREAM'
    )
  } finally {
    await fixture.close()
  }
})

// RPC-TEST-28443200104E-C004: original native open uncertainty and cleanup failure stay distinct.
it('C004 sends fail after an uncertain native open and reports the original cleanup Error', async () => {
  /** A failed actual iterator return must be counted once and reported by its original identity. */
  const cleanupError = new Error('cleanup failed')
  /** This exact native writer refusal occurs after real physical handoff has already happened. */
  const sendError = new Error('open send failed')
  /** Only the actual producer invokes the original iterator cleanup callback. */
  const returned = { value: 0 }
  /** The provider supplies one genuine iterable; this test never pulls its first item. */
  const producer = {
    next: () => ({ done: false, value: 'unused' }),
    return() {
      returned.value += 1
      throw cleanupError
    }
  }
  /** Iterator construction stays under the real provider/StreamProducer boundary. */
  const iterable = { [Symbol.iterator]: () => producer }
  /** Only provider a contributes these actual configured diagnostics. */
  const reports: unknown[] = []
  /** Both endpoints retain their genuine Host, accepted Session and codec owners. */
  const fixture = await connectedCoreHosts(
    { count: () => iterable },
    {},
    (error) => reports.push(error),
    undefined,
    () => undefined
  )
  /** Existing relay preparation borrows the real channel behind the public lazy iterator. */
  const owners: StreamChannel[] = []
  /** The passthrough records actual owner identity without constructing a replacement channel. */
  const opened = observePublicStreamOwner(owners)
  /** Keep the original physical method so onWriteStart and delivery still execute in production. */
  const nativeWrite = fixture.pair[0].write
  /** A late native refusal makes this real delivered open uncertain without closing the medium. */
  const write = vi.spyOn(fixture.pair[0], 'write').mockImplementation(async (frame, options) => {
    await nativeWrite(frame, options)
    /** The identity medium already holds this current semantic message; no decoder runs here. */
    const message = frame.data as IRpcSemanticFrame
    if (message.kind === RpcWireKind.stream && message.stream.event === RpcStreamEvent.open)
      throw sendError
  })
  try {
    /** This public iterator belongs to caller b and the exact admitted provider a. */
    const iterator = fixture.b.memory.streamTo('a', 'count', null)
    expect(owners).toHaveLength(1)
    /** The original relay seam starts open without granting a pull credit. */
    const preparing = owners[0]!.prepare(iterator).catch((error: unknown) => error)
    await vi.waitFor(() => expect(fixture.pair[0].written.some(isNativeStreamTerminal)).toBe(true))
    await preparing
    /** Read the actual terminal's flat error root, never deserialize a second diagnostic graph. */
    const terminal = fixture.pair[0].written.find(isNativeStreamTerminal)
    /** The current flat wire-error root carries the same required terminal code as the old profile. */
    const error = terminal?.kind === RpcWireKind.stream ? terminal.stream.error : undefined
    expect(returned.value).toBe(1)
    expect
      .soft({
        event: terminal?.kind === RpcWireKind.stream ? terminal.stream.event : undefined,
        code: error?.nodes[error.root]?.code
      })
      .toEqual({ event: RpcStreamEvent.fail, code: 'STREAM_RESULT_UNKNOWN' })
    expect(reports.some((error) => error === cleanupError)).toBe(true)
  } finally {
    write.mockRestore()
    opened.mockRestore()
    await fixture.close()
  }
})

// RPC-TEST-28443200104E-C005: one invalid real credit must fail without advancing the generator.
it('C005 rejects an out-of-sequence native pull without advancing the original provider', async () => {
  /** Generator advancement is observed only inside the original business generator body. */
  const advanced = { value: 0 }
  /** Only provider a's actual configured reporter contributes diagnostic codes. */
  const reports: unknown[] = []
  /** Public construction owns the genuine provider, stream state, actual Session and native pair. */
  const fixture = await connectedCoreHosts(
    {
      count: function* () {
        advanced.value += 1
        yield 'unused'
      }
    },
    {},
    (error) => reports.push(error),
    undefined,
    () => undefined
  )
  /** The actual public open method supplies the relay seam's original channel identity. */
  const owners: StreamChannel[] = []
  /** The original open still creates exactly one genuine public iterator. */
  const opened = observePublicStreamOwner(owners)
  try {
    /** The public directed overload selects the exact accepted provider without pulling it. */
    const iterator = fixture.b.memory.streamTo('a', 'count', null)
    expect(owners).toHaveLength(1)
    await owners[0]!.prepare(iterator)
    /** Actual wire open retains the only id, task generations and native route for this stream. */
    const request = fixture.pair[1].written.find(
      (frame) => frame.kind === RpcWireKind.call && frame.task.mode === RpcCallMode.stream
    )
    if (request?.kind !== RpcWireKind.call)
      expect.unreachable('actual public stream open was not written')
    /** Sequence one is invalid because the real producer has never received its first pull. */
    const pull: IRpcEnvelope = {
      profile: request.profile,
      kind: RpcWireKind.stream,
      id: request.id,
      task: request.task,
      route: request.route,
      stream: { event: RpcStreamEvent.pull, seq: 1 }
    }
    await fixture.pair[1].write({ kind: 'message', data: pull })
    await vi.waitFor(() => {
      expect(reports).toHaveLength(1)
      expect(fixture.pair[0].written.some(isNativeStreamTerminal)).toBe(true)
    })
    /** Observe the actual native terminal using its existing flat error metadata only. */
    const terminal = fixture.pair[0].written.find(isNativeStreamTerminal)
    /** The error root is already a public wire record, not a reconstructed diagnostic Error. */
    const error = terminal?.kind === RpcWireKind.stream ? terminal.stream.error : undefined
    expect(advanced.value).toBe(0)
    expect
      .soft({
        event: terminal?.kind === RpcWireKind.stream ? terminal.stream.event : undefined,
        code: error?.nodes[error.root]?.code
      })
      .toEqual({ event: RpcStreamEvent.fail, code: 'INVALID_STREAM' })
    expect(reports.map((error) => (error as { readonly code?: unknown }).code)).toContain(
      'INVALID_STREAM'
    )
  } finally {
    opened.mockRestore()
    await fixture.close()
  }
})
