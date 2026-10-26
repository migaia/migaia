/** Real native byte IO must enforce bootstrap framing before parsing semantic JSON. */
import { PassThrough } from 'node:stream'
import { createRpcByteCarrier, RpcEventByteIO, encodeRpcStreamFrame } from '@migaia/rpc-host/sdk'
import { expect, it, vi } from 'vitest'

it('A38 byte carrier rejects a length above 64 KiB before allocating or parsing its payload', async () => {
  /** Native readable delivery remains owned by Node, rather than a copied test decoder. */
  const input = new PassThrough()
  /** The independent native writer permits ordinary carrier cleanup. */
  const output = new PassThrough()
  /** Actual physical carrier failures are distinct from parse or receiver failures. */
  const errors: unknown[] = []
  /** One acquired native IO resource is lent to the public byte carrier factory. */
  const io = new RpcEventByteIO(
    input,
    output,
    () => {
      input.destroy()
      output.destroy()
    },
    {
      closedError: () => new Error('byte fixture closed'),
      report: (error) => errors.push(error)
    }
  ).value
  /** The actual SDK carrier starts with the unaccepted handshake frame budget. */
  const carrier = createRpcByteCarrier({
    id: 'byte-bootstrap-limit',
    io,
    report: (error) => errors.push(error)
  })
  carrier.subscribe({
    frame: () => expect.unreachable(),
    close: () => undefined,
    error: (error) => errors.push(error)
  })
  /** A length header alone must reject; no payload is supplied for a parser to consume. */
  const header = new Uint8Array(4)
  new DataView(header.buffer).setUint32(0, 65_537)
  /** Native JSON remains untouched when framing refuses the declared length. */
  const parse = vi.spyOn(JSON, 'parse')
  try {
    input.emit('data', header)
    expect(errors).toEqual([expect.objectContaining({ code: 'FRAME_LIMIT_EXCEEDED' })])
    expect(parse).not.toHaveBeenCalled()
  } finally {
    parse.mockRestore()
    await carrier.close()
  }
})

it('A38 byte carrier hands bounded UTF-8 text to the codec without parsing JSON itself', async () => {
  /** Original Node streams carry one complete small physical frame. */
  const input = new PassThrough()
  /** Native writer lifetime is independent from the incoming fixture bytes. */
  const output = new PassThrough()
  /** The receiver observes the physical carrier surface before codec admission. */
  const frames: unknown[] = []
  /** Background physical cleanup errors remain observable. */
  const reports: unknown[] = []
  /** One acquired resource lends the actual pause/read/write lifecycle. */
  const io = new RpcEventByteIO(
    input,
    output,
    () => {
      input.destroy()
      output.destroy()
    },
    {
      closedError: () => new Error('byte fixture closed'),
      report: (error) => reports.push(error)
    }
  ).value
  /** No Session or semantic normalizer stands in for this public physical carrier. */
  const carrier = createRpcByteCarrier({
    id: 'byte-text-handoff',
    io,
    report: (error) => reports.push(error)
  })
  carrier.subscribe({
    frame: (frame) => frames.push(frame),
    close: () => undefined,
    error: (error) => reports.push(error)
  })
  /** Semantic JSON stays an opaque string until its configured codec consumes it. */
  const text = '{"fixture":"codec owns parsing"}'
  /** The native JSON parser must remain unused at physical text handoff. */
  const parse = vi.spyOn(JSON, 'parse')
  try {
    input.emit('data', encodeRpcStreamFrame(new TextEncoder().encode(text)))
    expect(frames).toEqual([{ kind: 'message', data: text }])
    expect(parse).not.toHaveBeenCalled()
    expect(reports).toEqual([])
  } finally {
    parse.mockRestore()
    await carrier.close()
  }
})
