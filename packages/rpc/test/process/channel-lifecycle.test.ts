import { asCodecValue } from '@migaia/serialize/codec'
import { defineJsonCodec } from '@migaia/serialize/codecs/json'
import { describe, expect, it } from 'vitest'
import { encodeRpcStreamFrame } from '../../src/contract/framing/stream.js'
import { bindProcessByteWire, bindProcessMessageTransport } from '../../src/process/channel.js'
import { CHILD_STDERR_REDACTED } from '../../src/process/constants.js'
import { attachIpcConnection } from '../../src/process/ipc-connection.js'
import { remoteProcessJsonCodec } from '../../src/process/pipeline.js'
import { remoteProcessStringFramer } from '../../src/process/string-framer.js'
import type { IProcessByteChannel, IProcessMessageChannel } from '../../src/process/types.js'
import type { IRpcTransport } from '../../src/core/transport.js'
import type { IIpcLogRecord } from '../../src/core/plugins/flow-control.js'

/** A controllable byte port makes physical drain and late rejection observable. */
function createBytePort(): Readonly<{
  channel: IProcessByteChannel
  emitText(text: string): void
  emitBytes(bytes: Uint8Array): void
  settleWrite(error?: unknown): void
  readonly writes: readonly Uint8Array[]
  readonly removals: number
  readonly closes: number
}> {
  /** The active reader receives arbitrarily segmented physical bytes. */
  let dataListener: ((chunk: Uint8Array) => void) | undefined
  /** The active close listener receives the first physical terminal event. */
  let closeListener: ((reason?: unknown) => void) | undefined
  /** The currently blocked physical write is controlled by the test. */
  let pendingWrite: Readonly<{ resolve(): void; reject(error: unknown): void }> | undefined
  /** Retained chunks let the test distinguish logical sends from physical writes. */
  const writes: Uint8Array[] = []
  let removals = 0
  let closes = 0
  const channel: IProcessByteChannel = {
    kind: 'byte',
    write(chunk) {
      writes.push(chunk)
      return new Promise<void>((resolve, reject) => {
        pendingWrite = { resolve, reject }
      })
    },
    onData(listener) {
      dataListener = listener
      return () => {
        removals += 1
        dataListener = undefined
      }
    },
    onClose(listener) {
      closeListener = listener
      return () => {
        removals += 1
        closeListener = undefined
      }
    },
    close() {
      closes += 1
      closeListener?.()
    }
  }
  return {
    channel,
    emitText(text) {
      dataListener?.(encodeRpcStreamFrame(new TextEncoder().encode(text)))
    },
    emitBytes(bytes) {
      dataListener?.(bytes)
    },
    settleWrite(error) {
      if (error === undefined) pendingWrite?.resolve()
      else pendingWrite?.reject(error)
      pendingWrite = undefined
    },
    get writes() {
      return writes
    },
    get removals() {
      return removals
    },
    get closes() {
      return closes
    }
  }
}

describe('process channel boundary', () => {
  it('[A2/C1] validates unknown values and delegates valid JSON byte-for-byte', () => {
    /** The original codec is the reference implementation, not a second serializer. */
    const original = defineJsonCodec({ version: 1 })
    /** A nontrivial portable value checks ordering and Unicode output exactly. */
    const value = { token: 'π', items: [1, false, null] }
    expect(remoteProcessJsonCodec.encode(value)).toBe(original.encode(asCodecValue(value)))
    expect(remoteProcessJsonCodec.decode(original.encode(asCodecValue(value)))).toEqual(value)
    expect(() => remoteProcessJsonCodec.encode(undefined)).toThrowError(
      expect.objectContaining({ source: '@migaia/serialize', code: 'INVALID_OPTION' })
    )
    expect(() => remoteProcessJsonCodec.encode(new Map())).toThrowError(
      expect.objectContaining({ source: '@migaia/serialize', code: 'INVALID_OPTION' })
    )
    expect(() => remoteProcessJsonCodec.decode(42)).toThrowError(
      expect.objectContaining({ source: '@migaia/rpc/core', code: 'PAYLOAD_INVALID' })
    )
    /** The framer adapter rejects non-strings before the exact source framer is called. */
    const context = { source: 'peer', messageId: 'm1' }
    expect(remoteProcessStringFramer.frame('ok', context)).toEqual(['ok'])
    expect(remoteProcessStringFramer.accept('ok', context)).toEqual({
      status: 'complete',
      value: 'ok'
    })
    expect(() => remoteProcessStringFramer.frame(7, context)).toThrowError(
      expect.objectContaining({ source: '@migaia/rpc/core', code: 'PAYLOAD_INVALID' })
    )
  })

  it('[A6] rejects an in-flight write on close and observes its late failure', async () => {
    /** A fake physical writer deliberately never settles until the test releases it. */
    const port = createBytePort()
    /** Late physical rejection must reach this report port after the caller has settled. */
    const reports: unknown[] = []
    /** This receipt resolves exactly when the injected reporter observes a late failure. */
    let reported: () => void = () => undefined
    const lateReport = new Promise<void>((resolve) => {
      reported = resolve
    })
    const wire = bindProcessByteWire(port.channel, {
      peerId: 'peer',
      report: (error) => {
        reports.push(error)
        reported()
      }
    })
    const read = wire.readHandshakeFrame()
    port.emitText('{"kind":"handshake"}')
    expect(await read).toBe('{"kind":"handshake"}')
    wire.activate()
    const sending = wire.writeText('payload')
    await Promise.resolve()
    expect(port.writes).toHaveLength(1)
    const closed = wire.close()
    await expect(sending).rejects.toMatchObject({ code: 'PROCESS_CHANNEL_CLOSED' })
    await closed
    await wire.close()
    expect(port.closes).toBe(1)
    expect(port.removals).toBe(2)
    /** A physical error arriving after close is observed without reopening the caller Promise. */
    const late = new Error('late drain failure')
    port.settleWrite(late)
    await lateReport
    expect(reports).toContain(late)
    await expect(wire.writeText('late')).rejects.toMatchObject({ code: 'PROCESS_CHANNEL_CLOSED' })
    expect(() =>
      bindProcessByteWire(port.channel, { peerId: 'peer', report: () => undefined })
    ).toThrowError(expect.objectContaining({ code: 'INVALID_CONFIG' }))
  })

  it('[A6] rejects a second pre-ready frame without delivering business data', async () => {
    const port = createBytePort()
    const wire = bindProcessByteWire(port.channel, { peerId: 'peer', report: () => undefined })
    const read = wire.readHandshakeFrame()
    port.emitText('hello')
    expect(await read).toBe('hello')
    port.emitText('business-before-ready')
    expect(wire.closed).toBe(true)
    await expect(wire.close()).resolves.toBeUndefined()
  })

  it('[D2] delivers activated frames in order to the first late subscriber', async () => {
    const port = createBytePort()
    const wire = bindProcessByteWire(port.channel, { peerId: 'peer', report: () => undefined })
    const handshake = wire.readHandshakeFrame()
    port.emitText('hello')
    await handshake
    wire.activate()
    for (let index = 0; index < 200; index += 1) port.emitText(`frame-${index}`)
    const received: unknown[] = []
    wire.transport.subscribe((message) => received.push(message.data))
    expect(received).toEqual(Array.from({ length: 200 }, (_, index) => `frame-${index}`))
    const later: unknown[] = []
    wire.transport.subscribe((message) => later.push(message.data))
    expect(later).toEqual([])
    await wire.close()
  })

  it('[D2] reports and closes instead of discarding an overflowing early queue', async () => {
    const port = createBytePort()
    const reports: unknown[] = []
    const wire = bindProcessByteWire(port.channel, {
      peerId: 'peer',
      report: (error) => reports.push(error)
    })
    const handshake = wire.readHandshakeFrame()
    port.emitText('hello')
    await handshake
    wire.activate()
    for (let index = 0; index < 257; index += 1) port.emitText(`frame-${index}`)
    expect(wire.closed).toBe(true)
    expect(reports).toEqual([expect.objectContaining({ code: 'PROCESS_CHANNEL_CLOSED' })])
    const received: unknown[] = []
    wire.transport.subscribe((message) => received.push(message.data))
    expect(received).toEqual([])
    await wire.close()
  })

  it('[D3] bounds early business bytes independently of the frame count', async () => {
    const port = createBytePort()
    const reports: unknown[] = []
    const wire = bindProcessByteWire(port.channel, {
      peerId: 'peer',
      report: (error) => reports.push(error)
    })
    const handshake = wire.readHandshakeFrame()
    port.emitText('hello')
    await handshake
    wire.activate()
    /** Three valid frames exceed 1 MiB in total while staying far below 256 frames. */
    const payload = 'x'.repeat(350_000)
    port.emitText(payload)
    port.emitText(payload)
    expect(wire.closed).toBe(false)
    port.emitText(payload)
    expect(wire.closed).toBe(true)
    expect(reports).toEqual([expect.objectContaining({ code: 'PROCESS_CHANNEL_CLOSED' })])
    await wire.close()
  })

  it('[D4] rejects a 16 MiB unauthenticated frame at its header', async () => {
    const port = createBytePort()
    const wire = bindProcessByteWire(port.channel, { peerId: 'peer', report: () => undefined })
    const handshake = wire.readHandshakeFrame()
    /** No payload bytes are sent; rejection must happen before payload allocation. */
    port.emitBytes(new Uint8Array([1, 0, 0, 0]))
    await expect(handshake).rejects.toMatchObject({ code: 'FRAME_LIMIT_EXCEEDED' })
    expect(wire.closed).toBe(true)
    await wire.close()
  })

  it('[C2] rejects malformed UTF-8 before admitting a handshake', async () => {
    const port = createBytePort()
    const wire = bindProcessByteWire(port.channel, { peerId: 'peer', report: () => undefined })
    const handshake = wire.readHandshakeFrame()
    port.emitBytes(encodeRpcStreamFrame(Uint8Array.of(0xff)))
    await expect(handshake).rejects.toMatchObject({ code: 'HANDSHAKE_INVALID' })
    expect(wire.closed).toBe(true)
    await wire.close()
  })

  it('[A2/A6] installs one IPC composition and redacts each stderr record', async () => {
    /** The physical transport is closed through the single gate wrapper. */
    let physicalCloses = 0
    const physical: IRpcTransport = {
      platform: 'Process',
      send: () => undefined,
      subscribe: () => () => undefined,
      close: () => {
        physicalCloses += 1
      }
    }
    /** The existing supervision reader supplies chunks through one subscription. */
    let stderrListener: ((chunk: Uint8Array) => void) | undefined
    let subscriptions = 0
    let removals = 0
    const records: IIpcLogRecord[] = []
    const attached = attachIpcConnection(
      physical,
      {
        connectionId: 'connection-1',
        sessionId: 'session-1',
        processId: 'process-1',
        log: (record) => {
          records.push(record)
        },
        stderr: (listener) => {
          subscriptions += 1
          stderrListener = listener
          return () => {
            removals += 1
          }
        }
      },
      () => undefined
    )
    expect(attached.features).toHaveLength(2)
    expect(subscriptions).toBe(1)
    stderrListener?.(new TextEncoder().encode('secret-token'))
    expect(records).toEqual([
      {
        name: 'ipc.stderr',
        connectionId: 'connection-1',
        sessionId: 'session-1',
        processId: 'process-1',
        text: CHILD_STDERR_REDACTED
      }
    ])
    await attached.close()
    await attached.close()
    stderrListener?.(new TextEncoder().encode('late-secret'))
    expect(records).toHaveLength(1)
    expect(removals).toBe(1)
    expect(physicalCloses).toBe(1)
  })

  it('[A6] rolls back the physical wrapper when stderr setup fails', () => {
    /** A setup failure after wrapping must not strand the physical connection. */
    let closes = 0
    const physical: IRpcTransport = {
      platform: 'Process',
      send: () => undefined,
      subscribe: () => () => undefined,
      close: () => {
        closes += 1
      }
    }
    const failure = new Error('subscription failed')
    expect(() =>
      attachIpcConnection(
        physical,
        {
          connectionId: 'connection-2',
          sessionId: 'session-2',
          log: () => undefined,
          stderr: () => {
            throw failure
          }
        },
        () => undefined
      )
    ).toThrow(failure)
    expect(closes).toBe(1)
  })

  it('[A2/A6] keeps message port identity framing and terminal replay local', async () => {
    /** A message port already carries complete values and needs no JSON conversion. */
    let inbound: ((value: unknown) => void) | undefined
    let physicalCloses = 0
    const sent: unknown[] = []
    const port: IProcessMessageChannel = {
      kind: 'message',
      send(value) {
        sent.push(value)
      },
      onMessage(listener) {
        inbound = listener
        return () => {
          inbound = undefined
        }
      },
      onClose() {
        return () => undefined
      },
      close() {
        physicalCloses += 1
      }
    }
    const transport = bindProcessMessageTransport(port, {
      peerId: 'message-peer',
      report: () => undefined
    })
    const received: unknown[] = []
    transport.subscribe((message) => received.push(message))
    const value = { kind: 'whole-message' }
    await transport.send(value)
    inbound?.(value)
    expect(sent).toEqual([value])
    expect(received).toEqual([{ data: value, peerId: 'message-peer' }])
    expect(transport.encodedType).toBe('any')
    await transport.close?.()
    await transport.close?.()
    expect(physicalCloses).toBe(1)
    const terminal: unknown[] = []
    transport.onTransportError?.((error) => terminal.push(error))
    expect(terminal).toEqual([expect.objectContaining({ code: 'PROCESS_CHANNEL_CLOSED' })])
  })
})
