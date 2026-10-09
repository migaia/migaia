import { asCodecValue } from '@migaia/serialize/codec'
import { defineJsonCodec } from '@migaia/serialize/codecs/json'
import { describe, expect, it, vi } from 'vitest'
import { createManualScheduler, type IScheduler } from '@migaia/utils/scheduler'
import { createUnitBudget } from '@migaia/supervision'
import { createNodeProcessLauncher } from '../../src/process/adapters/node-child-process.js'
import { createSpawnProcessBinding } from '../../src/process/plugin/binding.js'
import type { IRemoteChannel } from '../../src/remote/types.js'
import { encodeRpcStreamFrame } from '../../src/contract/framing/stream.js'
import { bindProcessByteWire, bindProcessMessageTransport } from '../../src/process/channel.js'
import { CHILD_STDERR_REDACTED } from '../../src/process/constants.js'
import { attachIpcConnection } from '../../src/process/ipc-connection.js'
import { byteProcessPipeline, remoteProcessJsonCodec } from '../../src/process/pipeline.js'
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

/** Optional summary field lets the same semantic oracle run on the unmodified baseline. */
type IStderrRecord = Extract<IIpcLogRecord, { name: 'ipc.stderr' }> & { droppedChunks?: number }

/** Exercise the existing connection owner with a retained source callback and original scheduler. */
function stderrBudgetFixture(
  sessionId: string,
  sink?: (record: IStderrRecord) => void | Promise<void>,
  schedulerPort?: IScheduler
) {
  /** Virtual time separates interval boundaries from operating-system timing noise. */
  const scheduler = createManualScheduler()
  /** Only redacted records leave the original logging owner. */
  const records: IStderrRecord[] = []
  /** Reporter failures preserve the exact original object. */
  const reports: unknown[] = []
  /** The source deliberately retains this callback after unsubscribe to simulate late delivery. */
  let callback: ((chunk: Uint8Array) => void) | undefined
  /** Source unsubscribe remains idempotent through the original connection close. */
  let removals = 0
  /** The original physical owner closes once even if the final reporter reenters close. */
  let physicalCloses = 0
  /** Physical closure has no role in the diagnostic quota. */
  const physical: IRpcTransport = {
    platform: 'Process',
    send: () => undefined,
    subscribe: () => () => undefined,
    close: () => {
      physicalCloses += 1
    }
  }
  /** Existing connection and log Features remain the sole publication owner. */
  const attached = attachIpcConnection(
    physical,
    {
      connectionId: `connection-${sessionId}`,
      sessionId,
      processId: 'fixture-child',
      log: (record) => {
        if (record.name !== 'ipc.stderr') return
        records.push(record)
        return sink?.(record)
      },
      stderr: (listener) => {
        callback = listener
        return () => {
          removals += 1
        }
      }
    },
    (error) => reports.push(error),
    schedulerPort ?? scheduler
  )
  return {
    records,
    reports,
    scheduler,
    attached,
    /** Feed hostile-looking data without ever decoding it in the product owner. */
    emit(count: number) {
      for (let index = 0; index < count; index += 1)
        callback?.(new TextEncoder().encode('secret-token-must-never-leave-reader'))
    },
    get removals() {
      return removals
    },
    get physicalCloses() {
      return physicalCloses
    }
  }
}

describe('A32 BC6 session stderr budget prototype', () => {
  it.each([0, 32, 33, 1000])(
    'A32 preserves normal records and bounds %i chunks exactly',
    async (count) => {
      /** One first-chunk interval decides the fixed normal and summary totals. */
      const fixture = stderrBudgetFixture(`chunks-${count}`)
      fixture.emit(count)
      expect(fixture.records, 'A32 stderr normal-event budget missing').toHaveLength(
        Math.min(count, 32)
      )
      expect(fixture.scheduler.pendingCount).toBe(count > 32 ? 1 : 0)
      fixture.scheduler.advance(1000)
      expect(fixture.records).toHaveLength(Math.min(count, 32) + (count > 32 ? 1 : 0))
      expect(fixture.records.slice(0, Math.min(count, 32))).toEqual(
        Array.from({ length: Math.min(count, 32) }, () => ({
          name: 'ipc.stderr',
          connectionId: `connection-chunks-${count}`,
          sessionId: `chunks-${count}`,
          processId: 'fixture-child',
          text: CHILD_STDERR_REDACTED
        }))
      )
      expect(
        fixture.records.reduce((total, record) => total + (record.droppedChunks ?? 0), 0)
      ).toBe(Math.max(0, count - 32))
      expect(fixture.records.every((record) => record.text === CHILD_STDERR_REDACTED)).toBe(true)
      expect(JSON.stringify(fixture.records)).not.toContain('secret-token')
      await fixture.attached.close()
      expect(fixture.scheduler.pendingCount).toBe(0)
      expect(fixture.reports).toEqual([])
    }
  )

  it('A32 keeps first-chunk boundaries when the host timer runs late', async () => {
    /** A supported scheduler can run late but never invokes schedule synchronously. */
    let now = 0
    /** The fixture retains only the active callback, as the system scheduler does. */
    let callback: (() => void) | undefined
    /** Delays expose the fixed anchor even when callbacks arrive after their original due time. */
    const delays: number[] = []
    /** Vary lateness through the original scheduler contract without changing the product owner. */
    const scheduler: IScheduler = {
      now: () => now,
      schedule(next, delayMs) {
        delays.push(delayMs)
        callback = next
        return {
          cancel: () => {
            callback = undefined
          }
        }
      }
    }
    /** First overflow is scheduled for 1000 but delivered by the host at 1500. */
    const fixture = stderrBudgetFixture('late-timer', undefined, scheduler)
    fixture.emit(33)
    now = 1500
    callback?.()
    fixture.emit(33)
    expect(delays).toEqual([1000, 500])
    now = 2000
    callback?.()
    await fixture.attached.close()
    expect(
      fixture.records
        .filter((record) => record.droppedChunks !== undefined)
        .map((record) => record.droppedChunks)
    ).toEqual([1, 1])
  })

  it('A32 isolates sessions and accounts both intervals plus final close exactly', async () => {
    /** Independent session owners must never borrow each other's capacity or totals. */
    const first = stderrBudgetFixture('first')
    const second = stderrBudgetFixture('second')
    first.emit(1000)
    second.emit(33)
    first.scheduler.advance(1000)
    first.emit(33)
    await first.attached.close()
    await second.attached.close()
    expect(first.records.filter((record) => record.droppedChunks === undefined)).toHaveLength(64)
    expect(
      first.records
        .filter((record) => record.droppedChunks !== undefined)
        .map((record) => record.droppedChunks)
    ).toEqual([968, 1])
    expect(
      second.records
        .filter((record) => record.droppedChunks !== undefined)
        .map((record) => record.droppedChunks)
    ).toEqual([1])
    expect(first.removals).toBe(1)
    expect(second.removals).toBe(1)
    first.emit(1000)
    second.emit(1000)
    first.scheduler.advance(2000)
    second.scheduler.advance(2000)
    expect(first.records).toHaveLength(66)
    expect(second.records).toHaveLength(33)
    expect(first.scheduler.pendingCount + second.scheduler.pendingCount).toBe(0)
  })

  it('A32 detaches flush totals before synchronous reporter reentry and close', async () => {
    /** The summary reporter delivers one next-interval chunk synchronously. */
    let reentered = false
    /** The fixture is assigned before any record can call its reporter. */
    const fixture = stderrBudgetFixture('reentry', (record) => {
      if (record.droppedChunks === undefined || reentered) return
      reentered = true
      fixture.emit(1)
    })
    fixture.emit(33)
    fixture.scheduler.advance(1000)
    expect(fixture.records).toHaveLength(34)
    expect(
      fixture.records
        .filter((record) => record.droppedChunks !== undefined)
        .map((record) => record.droppedChunks)
    ).toEqual([1])
    fixture.emit(32)
    await fixture.attached.close()
    expect(
      fixture.records
        .filter((record) => record.droppedChunks !== undefined)
        .map((record) => record.droppedChunks)
    ).toEqual([1, 1])
    expect(fixture.records).toHaveLength(66)
    expect(fixture.scheduler.pendingCount).toBe(0)

    /** A summary can also retire its owner; late source delivery remains invisible. */
    const closing = stderrBudgetFixture('close-reentry', (record) => {
      if (record.droppedChunks !== undefined) void closing.attached.close()
    })
    closing.emit(33)
    closing.scheduler.advance(1000)
    await closing.attached.close()
    closing.emit(33)
    closing.scheduler.advance(1000)
    expect(closing.records).toHaveLength(33)
    expect(closing.removals).toBe(1)
  })

  it('A32 final summary preserves close Promise identity through synchronous reporter reentry', async () => {
    /** The summary sink may join close before the outer call has returned. */
    let reentrant: Promise<void> | undefined
    /** This session overflows once so close synchronously publishes its final summary. */
    const fixture = stderrBudgetFixture('close-summary-reentry', (record) => {
      if (record.droppedChunks !== undefined) reentrant = fixture.attached.close()
    })
    fixture.emit(33)
    /** The first caller and summary sink must receive the same original settlement Promise. */
    const closing = fixture.attached.close()
    expect(reentrant, 'A32 final-summary close Promise identity').toBe(closing)
    expect(fixture.attached.close()).toBe(closing)
    /** The original async close becomes observable after its one physical-close await. */
    let observed = false
    void closing.then(() => {
      observed = true
    })
    await Promise.resolve()
    expect(observed).toBe(false)
    await Promise.resolve()
    expect(observed).toBe(true)
    await closing
    expect(fixture.physicalCloses).toBe(1)
    expect(fixture.removals).toBe(1)
    expect(fixture.records).toHaveLength(33)
    expect(fixture.records.at(-1)?.droppedChunks).toBe(1)
    fixture.emit(33)
    fixture.scheduler.advance(1000)
    expect(fixture.records).toHaveLength(33)
  })

  it.each(['throw', 'reject'] as const)(
    'A32 keeps reporter %s failures reachable and drains subsequent chunks',
    async (mode) => {
      /** The logging Feature must report this exact object rather than rebuild it. */
      const failure = new TypeError('fixture diagnostic sink failed', {
        cause: new Error('fixture original cause')
      })
      /** Every attempted record fails through the established reporter path. */
      const fixture = stderrBudgetFixture(`report-${mode}`, () => {
        if (mode === 'throw') throw failure
        return Promise.reject(failure)
      })
      fixture.emit(1000)
      fixture.scheduler.advance(1000)
      await fixture.attached.close()
      await vi.waitFor(() => expect(fixture.reports).toHaveLength(33))
      expect(fixture.reports.every((error) => error === failure)).toBe(true)
      expect(fixture.records).toHaveLength(33)
      expect(fixture.records.at(-1)?.droppedChunks).toBe(968)
      expect(fixture.scheduler.pendingCount).toBe(0)
    }
  )

  it('A32 drains a real flooding Node child through the original binding stderr source', async () => {
    /** Virtual intervals let exact chunk accounting ignore native scheduling variability. */
    const scheduler = createManualScheduler()
    /** Binding onChunk counts the actual pipe chunks before redacted projection. */
    let receivedChunks = 0
    /** Pipe completion is proven by bytes and the real child's normal exit. */
    let receivedBytes = 0
    /** Only records emitted by the existing owner are observed here. */
    const records: IStderrRecord[] = []
    /** Failures stay on the original binding reporter, never become quota events. */
    const reports: unknown[] = []
    /** The fixture waits for a parent trigger after original source subscription. */
    const program = `const { once } = require('node:events'); let text = ''; let started = false; process.stdin.on('data', async bytes => { text += bytes.toString(); if (started || !text.includes('BC6-FLOOD')) return; started = true; for (let i = 0; i < 1000; i++) { if (!process.stderr.write(Buffer.alloc(8192, 115))) await once(process.stderr, 'drain'); await new Promise(resolve => setImmediate(resolve)); } process.stdin.destroy(); });`
    /** The original native launcher and supervisor own the stderr reader. */
    const binding = createSpawnProcessBinding(
      {
        kind: 'spawn',
        channelKind: 'byte',
        wire: 'native',
        token: 'fixture-token',
        supervision: {
          id: 'A32-native-flood',
          scheduler,
          spec: {
            command: process.execPath,
            args: ['-e', program],
            env: { inherit: [], set: {} },
            stdio: { stdin: 'channel', stdout: 'channel', stderr: 'drain' },
            bootstrap: { via: 'stdin', payload: new TextEncoder().encode('fixture-token') }
          },
          launcher: createNodeProcessLauncher(),
          budget: createUnitBudget({ kind: 'process', maxUnits: 1, scheduler }),
          isolation: 'best-effort',
          health: {
            check: async () => undefined,
            intervalMs: 100000,
            timeoutMs: 1000,
            failureThreshold: 1
          },
          report: (error) => reports.push(error),
          output: {
            onChunk(stream, chunk) {
              if (stream !== 'stderr') return
              receivedChunks += 1
              receivedBytes += chunk.byteLength
            }
          }
        },
        rawChannel: async (handle) => handle.channel!,
        establish: async (raw, options): Promise<IRemoteChannel> => {
          /** No business frames are sent; the native pipe only triggers this stderr fixture. */
          const attached = attachIpcConnection(
            {
              platform: 'Process',
              send: () => undefined,
              subscribe: () => () => undefined,
              close: () => raw.close()
            },
            {
              ...options.session,
              stderr: options.stderr,
              log: (record) => {
                if (record.name === 'ipc.stderr') records.push(record)
              }
            },
            (error) => reports.push(error),
            options.scheduler
          )
          return {
            transport: attached.transport,
            peerId: 'fixture-child',
            scheduler: options.scheduler,
            agreement: { source: 'negotiated', codec: 'json', capabilities: [] },
            pipeline: byteProcessPipeline,
            features: attached.features,
            close: attached.close
          }
        }
      },
      (error) => reports.push(error)
    )
    /** A real accepted native handle must exist before subscribing or triggering bytes. */
    const ready = await binding.supervisor.start()
    expect(ready.state).toBe('ready')
    if (ready.state !== 'ready') return
    /** The binding supplies its original stderr source to the existing projection owner. */
    const channel = await binding.openChannel(ready.unit, new AbortController().signal)
    try {
      await ready.unit.channel!.write(new TextEncoder().encode('BC6-FLOOD'))
      expect(await ready.unit.exited).toMatchObject({ code: 0, signal: null })
      await channel.close()
      expect(receivedBytes).toBe(8192 * 1000)
      expect(receivedChunks).toBeGreaterThan(32)
      expect(
        records.filter((record) => record.droppedChunks === undefined),
        'A32 native stderr budget missing'
      ).toHaveLength(32)
      expect(records.filter((record) => record.droppedChunks !== undefined)).toHaveLength(1)
      expect(records.at(-1)?.droppedChunks).toBe(receivedChunks - 32)
      expect(records.every((record) => record.text === CHILD_STDERR_REDACTED)).toBe(true)
      // Keep the complete native receipt outside the aggregate JSON reporter's stdout document.
      process.stderr.write(
        JSON.stringify({
          acceptance: 'A32',
          runtime: 'node',
          receivedChunks,
          receivedBytes,
          normalRecords: 32,
          droppedChunks: records.at(-1)?.droppedChunks,
          childExit: 0,
          failures: reports.map((error) => {
            const detail = error as {
              source?: unknown
              code?: unknown
              name?: unknown
              reason?: unknown
            }
            return {
              source: detail?.source ?? null,
              code: detail?.code ?? null,
              name: detail?.name ?? typeof error,
              reason: detail?.reason ?? null,
              message: '[fixture diagnostic redacted]'
            }
          })
        }) + '\n'
      )
    } finally {
      await channel.close()
      await binding.supervisor.dispose()
    }
  })
})
