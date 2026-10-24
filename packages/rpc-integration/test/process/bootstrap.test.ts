import { describe, expect, it } from 'vitest'
import { encodeRpcStreamFrame } from '@migaia/rpc-contract/framing/stream'
import { bindProcessByteWire } from '../fixtures/process-diagnostics.js'
import { receiveAdapterBootstrap as openBootstrapFrameChannel } from '../../../rpc-plugin-process/dist/process/bootstrap.js'
import type { IProcessByteChannel } from '../../../rpc-plugin-process/dist/process/types.js'

/** A controlled synchronous byte source owns the original bootstrap reader boundary. */
class SynchronousBootstrapSource {
  /** Physical data subscriptions receive the exact arbitrary chunks supplied by each test. */
  #data = new Set<(chunk: Uint8Array) => void>()
  /** EOF subscriptions remain independent from delivery of the final byte chunk. */
  #close = new Set<(reason?: unknown) => void>()
  /** Physical close count distinguishes the single original owner from repeated teardown. */
  #closes = 0
  /** The canonical decoder receives this exact physical source, with no wrapper transport. */
  readonly channel: IProcessByteChannel = {
    kind: 'byte',
    write: async () => undefined,
    onData: (listener) => {
      this.#data.add(listener)
      return () => {
        this.#data.delete(listener)
      }
    },
    onClose: (listener) => {
      this.#close.add(listener)
      return () => {
        this.#close.delete(listener)
      }
    },
    close: async () => {
      this.#closes += 1
    }
  }

  /** Deliver one original chunk to current physical readers without normalizing it. */
  push(chunk: Uint8Array): void {
    for (const listener of this.#data) listener(chunk)
  }

  /** Publish the original terminal event without replacing the source identity. */
  eof(): void {
    for (const listener of this.#close) listener()
  }

  /** Return physical teardown observations. */
  get closes(): number {
    return this.#closes
  }
}

/** Join frames to prove one physical chunk may contain bootstrap and hello. */
function frames(...payloads: string[]): Uint8Array {
  const parts = payloads.map((value) => encodeRpcStreamFrame(new TextEncoder().encode(value)))
  const joined = new Uint8Array(parts.reduce((length, part) => length + part.length, 0))
  let offset = 0
  for (const part of parts) {
    joined.set(part, offset)
    offset += part.length
  }
  return joined
}

describe('process bootstrap decoder ownership', () => {
  it('transfers a coalesced hello to the same decoder', async () => {
    const port = new SynchronousBootstrapSource()
    const opening = openBootstrapFrameChannel(port.channel, 'stdin')
    port.push(frames('secret-bootstrap', 'hello-control'))
    const opened = await opening
    expect(new TextDecoder().decode(opened.bootstrap)).toBe('secret-bootstrap')
    expect(opened.channel).toBe(port.channel)
    const wire = bindProcessByteWire(port.channel, { peerId: 'peer', report: () => undefined })
    expect(await wire.readHandshakeFrame()).toBe('hello-control')
    await wire.close()
    expect(port.closes).toBe(1)
  })

  it('leaves an unbootstrapped channel unchanged when no bootstrap is required', async () => {
    const port = new SynchronousBootstrapSource()
    expect(await openBootstrapFrameChannel(port.channel, 'none')).toEqual({ channel: port.channel })
    expect(port.closes).toBe(0)
  })

  it('rejects EOF and an invalid first frame before exposing a channel', async () => {
    const eofPort = new SynchronousBootstrapSource()
    const eof = openBootstrapFrameChannel(eofPort.channel, 'stdin')
    eofPort.eof()
    await expect(eof).rejects.toMatchObject({ code: 'PROCESS_CHANNEL_CLOSED' })
    expect(eofPort.closes).toBe(1)

    const invalidPort = new SynchronousBootstrapSource()
    const invalid = openBootstrapFrameChannel(invalidPort.channel, 'stdin')
    invalidPort.push(new Uint8Array([0, 0, 0, 0]))
    await expect(invalid).rejects.toMatchObject({ code: 'INVALID_FRAME' })
    expect(invalidPort.closes).toBe(1)

    const oversizedPort = new SynchronousBootstrapSource()
    const oversized = openBootstrapFrameChannel(oversizedPort.channel, 'stdin')
    oversizedPort.push(new Uint8Array([1, 0, 0, 0]))
    await expect(oversized).rejects.toMatchObject({ code: 'FRAME_LIMIT_EXCEEDED' })
    expect(oversizedPort.closes).toBe(1)
  })

  it('rejects two pre-ready control frames after one bootstrap', async () => {
    const port = new SynchronousBootstrapSource()
    const opened = openBootstrapFrameChannel(port.channel, 'stdin')
    port.push(frames('bootstrap', 'hello-one', 'hello-two'))
    await opened
    expect(port.closes).toBe(1)
  })

  it('caps the transferred decoder after bootstrap and before handshake', async () => {
    const port = new SynchronousBootstrapSource()
    const opening = openBootstrapFrameChannel(port.channel, 'stdin')
    port.push(frames('bootstrap'))
    await opening
    const wire = bindProcessByteWire(port.channel, { peerId: 'peer', report: () => undefined })
    const handshake = wire.readHandshakeFrame()
    port.push(new Uint8Array([1, 0, 0, 0]))
    await expect(handshake).rejects.toMatchObject({ code: 'FRAME_LIMIT_EXCEEDED' })
    expect(wire.closed).toBe(true)
    await wire.close()
  })
})
