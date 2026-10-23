import { createManualScheduler } from '@migaia/utils/testing'
import { describe, expect, it, vi } from 'vitest'
import { createNativeProcessOffer } from '../../dist/process/offer.js'
import { createProcessTransport } from '../../dist/process/handshake.js'
import { type IProcessByteChannel, type IProcessCommonOptions } from '../../dist/process/types.js'

/** Real framed handshake bytes connect two public transport owners in this process. */
async function openBytePair(options: IProcessCommonOptions, close: () => void) {
  /** Each native port owns only its currently subscribed byte reader. */
  const readers: Array<((chunk: Uint8Array) => void) | undefined> = []
  /** In-process delivery preserves each writer's ordering without a second framing layer. */
  const port = (index: 0 | 1): IProcessByteChannel => ({
    kind: 'byte',
    async write(chunk) {
      await Promise.resolve()
      readers[1 - index]?.(chunk)
    },
    onData(listener) {
      readers[index] = listener
      return () => {
        readers[index] = undefined
      }
    },
    onClose: () => () => undefined,
    close: index === 0 ? close : () => undefined
  })
  /** Both public operations finish their real hello/accept before stderr ownership is installed. */
  const results = await Promise.allSettled([
    createProcessTransport(port(0), {
      ...options,
      role: 'initiator',
      offer: createNativeProcessOffer({ peer: { id: 'stderr-parent', runtime: 'node' } })
    }),
    createProcessTransport(port(1), {
      role: 'responder',
      peerId: 'stderr-parent',
      auth: { mode: 'none' },
      offer: createNativeProcessOffer({ peer: { id: 'stderr-peer', runtime: 'node' } }),
      scheduler: options.scheduler,
      report: () => undefined,
      ipc: { connectionId: 'stderr-peer', sessionId: 'stderr-peer', log: () => undefined }
    })
  ])
  for (const result of results) {
    if (result.status === 'rejected') {
      await Promise.all(
        results.map((entry) => (entry.status === 'fulfilled' ? entry.value.close() : undefined))
      )
      throw result.reason
    }
  }
  if (results[0]!.status !== 'fulfilled' || results[1]!.status !== 'fulfilled')
    throw new Error('both transport owners must be ready')
  return { channel: results[0]!.value, peer: results[1]!.value }
}

/** Open a public byte channel with caller-owned stderr delivery and diagnostics. */
async function fixture() {
  /** The connection uses its existing scheduler for both logging and fixed stderr intervals. */
  const scheduler = createManualScheduler()
  /** Diagnostic records expose only the redacted session contract. */
  const records: Parameters<IProcessCommonOptions['ipc']['log']>[0][] = []
  /** Unsubscription is observable without reaching into the channel or log queue. */
  const unsubscribe = vi.fn()
  /** A retained native callback can prove late delivery is ignored after public close. */
  let stderr!: (chunk: Uint8Array) => void
  /** The actual byte channel owns physical close separately from stderr subscription. */
  const physicalClose = vi.fn()
  /** Production construction installs its own diagnostic owner over the supplied native ports. */
  const { channel, peer } = await openBytePair(
    {
      peerId: 'stderr-peer',
      scheduler,
      report: () => undefined,
      ipc: {
        connectionId: 'stderr-connection',
        sessionId: 'stderr-session',
        processId: 'stderr-process',
        log: (record) => {
          records.push(record)
        },
        stderr: (listener) => {
          stderr = listener
          return unsubscribe
        }
      }
    },
    physicalClose
  )
  return { scheduler, records, unsubscribe, physicalClose, channel, peer, stderr }
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
      await owner.channel.close()
      await owner.peer.close()
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
    await owner.channel.close()
    await owner.peer.close()
    expect(owner.records).toHaveLength(33)
    expect(owner.records.at(-1)).toMatchObject({ droppedChunks: 2 })
    owner.stderr(chunk)
    owner.scheduler.advance(2000)
    await owner.channel.close()
    expect(owner.records).toHaveLength(33)
    expect(owner.unsubscribe).toHaveBeenCalledOnce()
    expect(owner.physicalClose).toHaveBeenCalledOnce()
    expect(owner.scheduler.pendingCount).toBe(0)
  })

  it('rolls back the acquired byte carrier if native stderr subscription fails', async () => {
    /** The original subscription error must remain the public construction failure. */
    const failure = new Error('native stderr subscription failed')
    /** Physical close proves rollback covers the carrier acquired before this extension runs. */
    const close = vi.fn()
    await expect(
      openBytePair(
        {
          peerId: 'stderr-peer',
          report: () => undefined,
          ipc: {
            connectionId: 'stderr',
            sessionId: 'stderr',
            log: () => undefined,
            stderr: () => {
              throw failure
            }
          }
        },
        close
      )
    ).rejects.toBe(failure)
    expect(close).toHaveBeenCalledOnce()
  })
})
