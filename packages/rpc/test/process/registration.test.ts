import type { IAbortSignal } from '@migaia/lifecycle'
import { createManualScheduler } from '@migaia/utils/scheduler'
import { describe, expect, it } from 'vitest'
import {
  dialProcessByteChannel,
  listenProcessByteChannel
} from '../../src/process/adapters/node-socket.js'
import { createProcessTransport } from '../../src/process/handshake.js'
import { createNativeProcessOffer } from '../../src/process/offer.js'
import { listenProcessRegistrations } from '../../src/process/resilience/rendezvous.js'
import { createProcessSessionManager } from '../../src/process/resilience/session.js'
import type { IProcessSessionLease } from '../../src/process/resilience/types.js'

/** Each transport carries a distinct physical-session identity. */
function ipc(id: string) {
  return { connectionId: id, sessionId: id, log: () => undefined }
}

/** A native proposal makes authentication the only admission difference. */
const responderOffer = createNativeProcessOffer({ peer: { id: 'server', runtime: 'node' } })
const initiatorOffer = createNativeProcessOffer({
  peer: { id: 'client', runtime: 'node' },
  auth: 'registration-secret'
})

describe('process reverse registration', () => {
  it('[A4] rejects over-capacity before accept and ignores a late adoption', async () => {
    const reports: unknown[] = []
    let reportLimit: (error: unknown) => void = () => undefined
    const limitReported = new Promise<unknown>((resolve) => {
      reportLimit = resolve
    })
    const manager = createProcessSessionManager({
      scheduler: createManualScheduler(),
      report: () => undefined,
      maxConnections: 1
    })
    let settleReady: (candidate: IProcessSessionLease & { signal: IAbortSignal }) => void = () =>
      undefined
    const ready = new Promise<IProcessSessionLease & { signal: IAbortSignal }>((resolve) => {
      settleReady = resolve
    })
    let finishAdopt: () => void = () => undefined
    const delayedAdopt = new Promise<'adopt'>((resolve) => {
      finishAdopt = () => resolve('adopt')
    })
    let verifyCalls = 0
    let candidateCalls = 0
    const listener = await listenProcessRegistrations(
      manager,
      {
        wire: 'native',
        listen: listenProcessByteChannel,
        address: 'tcp://127.0.0.1:0',
        offer: responderOffer,
        verifyToken: () => {
          verifyCalls += 1
          return 'principal'
        },
        createConnectionContext: () => ({ peerId: 'client-route', ipc: ipc('server-cap') }),
        onCandidate(candidate) {
          candidateCalls += 1
          settleReady(candidate)
          return delayedAdopt
        }
      },
      (error) => {
        reports.push(error)
        if (reports.length === 1) reportLimit(error)
      }
    )
    const firstRaw = await dialProcessByteChannel({ address: listener.address })
    const first = await createProcessTransport(firstRaw, {
      role: 'initiator',
      peerId: 'server-route',
      offer: initiatorOffer,
      report: () => undefined,
      ipc: ipc('client-cap')
    })
    let secondRaw: Awaited<ReturnType<typeof dialProcessByteChannel>> | undefined
    try {
      const pending = await ready
      secondRaw = await dialProcessByteChannel({ address: listener.address })
      expect(await limitReported).toMatchObject({ code: 'PROCESS_CONNECTION_LIMIT' })
      expect(verifyCalls).toBe(1)
      expect(candidateCalls).toBe(1)
      await listener.close()
      expect(pending.signal.aborted).toBe(true)
      finishAdopt()
      const lease = manager.claimConnection()
      lease.release()
    } finally {
      finishAdopt()
      await secondRaw?.close()
      await first.close()
      await listener.close()
    }
  })

  it('[A4] cancels an in-flight handshake on listener close without publishing a candidate', async () => {
    const reports: unknown[] = []
    let reportOne: (error: unknown) => void = () => undefined
    const reported = new Promise<unknown>((resolve) => {
      reportOne = resolve
    })
    const manager = createProcessSessionManager({
      scheduler: createManualScheduler(),
      report: () => undefined,
      maxConnections: 1
    })
    let contextStarted: () => void = () => undefined
    const started = new Promise<void>((resolve) => {
      contextStarted = resolve
    })
    let candidateCalls = 0
    const listener = await listenProcessRegistrations(
      manager,
      {
        wire: 'native',
        listen: listenProcessByteChannel,
        address: 'tcp://127.0.0.1:0',
        offer: responderOffer,
        verifyToken: () => 'principal',
        createConnectionContext: () => {
          contextStarted()
          return { peerId: 'client-route', ipc: ipc('server-pending') }
        },
        onCandidate: () => {
          candidateCalls += 1
          return 'adopt'
        }
      },
      (error) => {
        reports.push(error)
        reportOne(error)
      }
    )
    const raw = await dialProcessByteChannel({ address: listener.address })
    try {
      await started
      await listener.close()
      expect(await reported).toMatchObject({ code: 'PROCESS_CHANNEL_CLOSED' })
      expect(reports).toHaveLength(1)
      expect(candidateCalls).toBe(0)
      const lease = manager.claimConnection()
      lease.release()
    } finally {
      await raw.close()
      await listener.close()
    }
  })

  it('[A4] adopts one authenticated channel without closing it with the listener', async () => {
    const report: unknown[] = []
    const manager = createProcessSessionManager({
      scheduler: createManualScheduler(),
      report: (error) => report.push(error),
      maxConnections: 1
    })
    let adopted: IProcessSessionLease | undefined
    let settle: (lease: IProcessSessionLease) => void = () => undefined
    const ready = new Promise<IProcessSessionLease>((resolve) => {
      settle = resolve
    })
    let verifyCalls = 0
    const listener = await listenProcessRegistrations(
      manager,
      {
        wire: 'native',
        listen: listenProcessByteChannel,
        address: 'tcp://127.0.0.1:0',
        offer: responderOffer,
        verifyToken(auth) {
          verifyCalls += 1
          expect(auth).toBe('registration-secret')
          return 'principal-1'
        },
        createConnectionContext: () => ({ peerId: 'client-route', ipc: ipc('server-1') }),
        onCandidate(candidate) {
          adopted = candidate
          settle(candidate)
          return 'adopt'
        }
      },
      (error) => report.push(error)
    )
    const raw = await dialProcessByteChannel({ address: listener.address })
    const client = await createProcessTransport(raw, {
      role: 'initiator',
      peerId: 'server-route',
      offer: initiatorOffer,
      report: (error) => report.push(error),
      ipc: ipc('client-1')
    })
    try {
      const session = await ready
      expect(session.identity).toMatchObject({
        connectionId: 'server-1',
        sessionId: 'server-1',
        principalId: 'principal-1'
      })
      expect(verifyCalls).toBe(1)
      expect(() => manager.claimConnection()).toThrowError(
        expect.objectContaining({ code: 'PROCESS_CONNECTION_LIMIT' })
      )
      await listener.close()
      const message = new Promise<string>((resolve) => {
        session.channel.transport.subscribe(({ data }) => resolve(String(data)))
      })
      await client.transport.send('after-listener-close')
      expect(await message).toBe('after-listener-close')
      expect(report).toEqual([])
    } finally {
      await adopted?.close()
      await client.close()
      await listener.close()
    }
    const released = manager.claimConnection()
    released.release()
  })
})
