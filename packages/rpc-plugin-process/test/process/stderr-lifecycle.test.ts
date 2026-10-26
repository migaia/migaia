import { createManualScheduler } from '@migaia/utils/testing'
import { describe, expect, it, vi } from 'vitest'
import { createRpcHost } from '@migaia/rpc-host'
import { processPlugin } from '@migaia/rpc-plugin-process'
import { ipcLog, type IIpcLogRecord } from '@migaia/rpc-plugin-process/features'
import * as nativeIO from '../../dist/process/node-io.js'
import * as carrierOwner from '../../dist/process/carrier.js'
import * as stderrOwner from '../../dist/process/stderr.js'
import type { IProcessCommonOptions } from '../../dist/process/types.js'

/** Preserve the actual native constructors before observational spies are installed. */
const createChild = nativeIO.createAdapterChildStdio
/** All carrier construction and rollback continue through the canonical production owner. */
const createCarrier = carrierOwner.createProcessCarrier
/** The original stderr owner alone counts intervals, redacts and retires its reader. */
const attachStderr = stderrOwner.attachIpcStderr
/** An unchanged genuine child completes the same Process source bootstrap as ordinary callers. */
const entry = new URL('./fixtures/core-session-child.ts', import.meta.url)

/** Observe original native lifetime and lend only its clock and stderr callback to each case. */
class NativeStderrFixture {
  /** One monotonic clock controls the original fixed stderr interval. */
  readonly scheduler = createManualScheduler()
  /** Only the actual selected log feature publishes records into this original sink. */
  readonly records: IIpcLogRecord[] = []
  /** Exact native unsubscription remains observable independently of physical close. */
  readonly unsubscribe = vi.fn()
  /** The same original raw close is invoked after its acquired stderr subscription retires. */
  readonly physicalClose = vi.fn()
  /** Actual carrier construction publishes its original receipt after feature installation. */
  channel: ReturnType<typeof createCarrier> | undefined
  /** The public Host owns its real supervisor, child and accepted Session. */
  #host: Awaited<ReturnType<typeof createRpcHost>> | undefined
  /** The original native stderr registration belongs to the actual spawned generation. */
  #subscribe: IProcessCommonOptions['ipc']['stderr']
  /** A retained original callback proves that retired stderr delivery cannot revive state. */
  #callback: ((chunk: Uint8Array) => void) | undefined
  /** An optional actual registration failure is thrown before native subscription acquisition. */
  readonly #failure: Error | undefined
  /** Only this fixture's observational spies are restored after native teardown. */
  readonly #restore: (() => void)[] = []

  /** Install observation without replacing native acquisition, framing, handshake or cleanup. */
  constructor(failure?: Error) {
    this.#failure = failure
    /** The real child factory remains responsible for its original native streams. */
    const byte = vi.spyOn(nativeIO, 'createAdapterChildStdio').mockImplementation(this.#child)
    /** The same production carrier receives the original native resource and complete feature. */
    const carrier = vi.spyOn(carrierOwner, 'createProcessCarrier').mockImplementation(this.#create)
    /** Only the supported original stderr clock/subscription inputs are lent to its same owner. */
    const stderr = vi.spyOn(stderrOwner, 'attachIpcStderr').mockImplementation(this.#attach)
    this.#restore.push(
      () => stderr.mockRestore(),
      () => carrier.mockRestore(),
      () => byte.mockRestore()
    )
  }
  /** Count original native close entry while preserving its shared Promise and native failure. */
  readonly #child = (...args: Parameters<typeof createChild>): ReturnType<typeof createChild> => {
    /** This is the real acquired native child IO, with all original methods retained. */
    const raw = createChild(...args)
    return {
      ...raw,
      close: (reason) => {
        this.physicalClose()
        return raw.close(reason)
      }
    }
  }
  /** Fixture labels remain caller-owned diagnostics, independent of native identity or secrets. */
  readonly #create = (
    ...args: Parameters<typeof createCarrier>
  ): ReturnType<typeof createCarrier> => {
    /** The same native options retain the actual generation's original stderr subscription. */
    const [raw, context, options] = args
    this.channel = createCarrier(raw, context, {
      ...options,
      ipc: {
        ...options.ipc!,
        connectionId: 'stderr-connection',
        sessionId: 'stderr-session',
        processId: 'stderr-process'
      }
    })
    return this.channel
  }
  /** Borrow the original native source while passing the existing scheduler seam to stderr. */
  readonly #attach = (
    ...args: Parameters<typeof attachStderr>
  ): ReturnType<typeof attachStderr> => {
    /** The production installation and report hook stay exactly the same original objects. */
    const [install, ipc, report] = args
    this.#subscribe = ipc.stderr
    return attachStderr(install, { ...ipc, stderr: this.#receive }, report, this.scheduler)
  }
  /** Capture the real owner callback and remove its genuine native observer exactly once. */
  readonly #receive = (listener: (chunk: Uint8Array) => void): (() => void) => {
    if (this.#failure) throw this.#failure
    this.#callback = listener
    /** The original native source acquires the actual generation's stderr observer. */
    const unsubscribe = this.#subscribe!(listener)
    return () => {
      this.unsubscribe()
      unsubscribe()
    }
  }
  /** Exercise the original retained native callback without bypassing its stderr owner. */
  readonly stderr = (chunk: Uint8Array): void => {
    this.#callback!(chunk)
  }
  /** Genuine public construction completes native bootstrap and the accepted Host Session. */
  async open(): Promise<this> {
    this.#host = await createRpcHost({
      plugins: [
        processPlugin({
          spawn: entry,
          features: [
            ipcLog({
              report: (record) => {
                this.records.push(record)
              }
            })
          ]
        })
      ],
      report: () => undefined
    })
    return this
  }
  /** Join actual native teardown before restoring the original observational methods. */
  async close(): Promise<void> {
    try {
      await this.channel?.close()
      await this.#host?.close()
    } finally {
      for (const restore of this.#restore) restore()
    }
  }
}

/** Open one real Process source with only the old case's existing diagnostic inputs observed. */
function fixture(): Promise<NativeStderrFixture> {
  return new NativeStderrFixture().open()
}

describe('public process stderr lifetime', () => {
  it('redacts bytes, bounds each fixed interval, and publishes one overflow summary', async () => {
    /** Native stderr chunks must never be copied into observable diagnostic text. */
    const owner = await fixture()
    /**
     * A distinctive payload detects accidental raw-byte disclosure in either normal or overflow
     * logs.
     */
    const chunk = new TextEncoder().encode('private stderr payload')
    try {
      for (let index = 0; index < 35; index++) owner.stderr(chunk)
      owner.scheduler.advance(0)
      expect(owner.records).toHaveLength(32)
      expect(
        owner.records.every(
          (record) => record.name === 'ipc.stderr' && record.text === '[child stderr redacted]'
        )
      ).toBe(true)
      expect(owner.records[0]).toMatchObject({
        name: 'ipc.stderr',
        connectionId: 'stderr-connection',
        sessionId: 'stderr-session',
        processId: 'stderr-process'
      })
      owner.scheduler.advance(1000)
      expect(owner.records).toHaveLength(33)
      expect(owner.records.at(-1)).toMatchObject({ droppedChunks: 3 })
      owner.stderr(chunk)
      owner.scheduler.advance(0)
      expect(owner.records).toHaveLength(34)
      expect(owner.records.at(-1)).not.toHaveProperty('droppedChunks')
      expect(JSON.stringify(owner.records)).not.toContain('private stderr payload')
    } finally {
      await owner.channel!.close()
      await owner.close()
    }
    expect(owner.unsubscribe).toHaveBeenCalledOnce()
    expect(owner.scheduler.pendingCount).toBe(0)
  })

  it('flushes pending overflow at close and ignores native callbacks retained after unsubscribe', async () => {
    /** Closing before the interval boundary must retain the pending dropped-chunk count. */
    const owner = await fixture()
    /** No raw payload is needed to exercise the public delivery quota. */
    const chunk = new Uint8Array([1])
    for (let index = 0; index < 34; index++) owner.stderr(chunk)
    owner.scheduler.advance(0)
    await owner.channel!.close()
    await owner.close()
    expect(owner.records).toHaveLength(33)
    expect(owner.records.at(-1)).toMatchObject({ droppedChunks: 2 })
    owner.stderr(chunk)
    owner.scheduler.advance(2000)
    await owner.channel!.close()
    expect(owner.records).toHaveLength(33)
    expect(owner.unsubscribe).toHaveBeenCalledOnce()
    expect(owner.physicalClose).toHaveBeenCalledOnce()
    expect(owner.scheduler.pendingCount).toBe(0)
  })

  it('rolls back the acquired byte carrier if native stderr subscription fails', async () => {
    /** The original subscription failure must retain its public construction identity. */
    const failure = new Error('native stderr subscription failed')
    /** Actual source rollback must release its original acquired child byte resource. */
    const owner = new NativeStderrFixture(failure)
    try {
      /** Supervised startup reports the failed unit with the original subscription error on cause. */
      await expect(owner.open()).rejects.toMatchObject({
        code: 'REMOTE_START_FAILED',
        cause: failure
      })
    } finally {
      expect(owner.physicalClose).toHaveBeenCalledOnce()
      await owner.close()
    }
  })
})
