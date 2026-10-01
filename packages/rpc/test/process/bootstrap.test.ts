import { describe, expect, it } from 'vitest'
import { encodeRpcStreamFrame } from '../../src/contract/framing/stream.js'
import { bindProcessByteWire } from '../../src/process/channel.js'
import { openBootstrapFrameChannel } from '../../src/process/bootstrap.js'
import type { IProcessByteChannel } from '../../src/process/types.js'

/** A synchronous byte source exposes the exact bootstrap and handshake reader boundary. */
function source() {
  /** Physical data arrives in arbitrary chunks. */
  const data = new Set<(chunk: Uint8Array) => void>()
  /** EOF is observed independently of the last byte chunk. */
  const close = new Set<(reason?: unknown) => void>()
  /** Teardown count distinguishes one owner from repeated close attempts. */
  let closes = 0
  const channel: IProcessByteChannel = {
    kind: 'byte',
    write: async () => undefined,
    onData(listener) {
      data.add(listener)
      return () => {
        data.delete(listener)
      }
    },
    onClose(listener) {
      close.add(listener)
      return () => {
        close.delete(listener)
      }
    },
    async close() {
      closes++
    }
  }
  return {
    channel,
    push(chunk: Uint8Array) {
      for (const listener of data) listener(chunk)
    },
    eof() {
      for (const listener of close) listener()
    },
    get closes() {
      return closes
    }
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
  it('[A7] transfers a coalesced hello to the same decoder', async () => {
    const port = source()
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

  it('[A7] leaves an unbootstrapped channel unchanged when no bootstrap is required', async () => {
    const port = source()
    expect(await openBootstrapFrameChannel(port.channel, 'none')).toEqual({ channel: port.channel })
    expect(port.closes).toBe(0)
  })

  it('[A7] rejects EOF and an invalid first frame before exposing a channel', async () => {
    const eofPort = source()
    const eof = openBootstrapFrameChannel(eofPort.channel, 'stdin')
    eofPort.eof()
    await expect(eof).rejects.toMatchObject({ code: 'PROCESS_CHANNEL_CLOSED' })
    expect(eofPort.closes).toBe(1)

    const invalidPort = source()
    const invalid = openBootstrapFrameChannel(invalidPort.channel, 'stdin')
    invalidPort.push(new Uint8Array([0, 0, 0, 0]))
    await expect(invalid).rejects.toMatchObject({ code: 'INVALID_FRAME' })
    expect(invalidPort.closes).toBe(1)

    const oversizedPort = source()
    const oversized = openBootstrapFrameChannel(oversizedPort.channel, 'stdin')
    oversizedPort.push(new Uint8Array([1, 0, 0, 0]))
    await expect(oversized).rejects.toMatchObject({ code: 'FRAME_LIMIT_EXCEEDED' })
    expect(oversizedPort.closes).toBe(1)
  })

  it('[A7] rejects two pre-ready control frames after one bootstrap', async () => {
    const port = source()
    const opened = openBootstrapFrameChannel(port.channel, 'stdin')
    port.push(frames('bootstrap', 'hello-one', 'hello-two'))
    await opened
    expect(port.closes).toBe(1)
  })

  it('[D4] caps the transferred decoder after bootstrap and before handshake', async () => {
    const port = source()
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
