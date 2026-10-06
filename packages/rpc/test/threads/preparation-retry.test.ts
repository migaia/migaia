import { EventEmitter } from 'node:events'
import { createManualScheduler, systemScheduler } from '@migaia/utils/scheduler'
import { describe, expect, it } from 'vitest'
import { createWebThreadChannelFactory } from '../../src/threads/adapters/web.js'
import type { IThreadWebPort } from '../../src/threads/types.js'
import { createRemoteRetryPort } from '../../src/remote/retry.js'
import { nativeFixture, workerEntry } from './fixture.js'

/** Ordinary lifecycle regressions from archived audit receipts do not restart the interrupted audit. */
describe('thread preparation and retry settlement', () => {
  it('[A9] withholds transport until private bootstrap preparation acknowledges', async () => {
    /** Event subscriptions prove the factory has not installed transport before readiness. */
    const target = new EventEmitter()
    /** Structural Web port tests supported ownership without claiming browser actual-exit support. */
    const port: IThreadWebPort = {
      postMessage: () => undefined,
      addEventListener: (type, listener) => {
        target.on(type, listener)
      },
      removeEventListener: (type, listener) => {
        target.off(type, listener)
      }
    }
    /** Only explicit acknowledgement resolves the prepared candidate. */
    let acknowledge!: () => void
    /** Pending preparation models the existing public handle promise. */
    const prepared = new Promise<void>((resolve) => {
      acknowledge = resolve
    })
    /** Publication must remain false for every continuation before acknowledgement. */
    let published = false
    /** The production factory owns the eventual core channel and abort subscription. */
    const opening = createWebThreadChannelFactory({ scheduler: systemScheduler })
      .open(
        {
          identity: { fingerprint: 'prepared-peer' },
          port,
          prepared,
          exited: new Promise(() => undefined),
          terminate: () => undefined
        },
        new AbortController().signal
      )
      .then((channel) => {
        published = true
        return channel
      })
    for (let turn = 0; turn < 10; turn++) await Promise.resolve()
    expect(published).toBe(false)
    expect(target.listenerCount('message')).toBe(0)
    acknowledge()
    await (await opening).close()
    expect(target.listenerCount('message')).toBe(0)
  })
  it('[A5/A10] settles caller cancellation while waiting for replacement readiness without replay', async () => {
    /** The existing retry clock and cancellation signal own the logical request. */
    const scheduler = createManualScheduler()
    /** Caller cancellation remains observable even after departure removes the first generation. */
    const controller = new AbortController()
    /** Drive departure independently from later readiness. */
    let leave!: (reason: unknown) => void
    /** Readiness may arrive after cancellation and must not replay the request. */
    let ready!: (generation: number) => void
    /** Deferred replacement keeps the logical request inside the vulnerable await boundary. */
    const generationReady = new Promise<number>((resolve) => {
      ready = resolve
    })
    /** The same event owner is supplied to construction and each logical dispatch. */
    const events = {
      current: () => ({ generation: 1, active: true }),
      onLeave: (_generation: number, listener: (reason: unknown) => void) => {
        leave = listener
        return () => undefined
      },
      whenReady: () => generationReady
    }
    /** Settlement is inspected before replacement readiness can conceal a missed abort listener. */
    let outcome: unknown
    /** Only the initial generation may receive the physical send. */
    let sends = 0
    /** Canonical retry owns cancellation and cleanup; this test adds no retry implementation. */
    const result = createRemoteRetryPort({ events, scheduler, report: () => undefined })
      .dispatch({
        events,
        generation: 1,
        method: 'p.read',
        mode: 'request',
        idempotent: true,
        key: 'readiness-key',
        signal: controller.signal,
        sendOnce: () => {
          sends++
          return new Promise(() => undefined)
        }
      })
      .catch((error: unknown) => {
        outcome = error
      })
    leave(new Error('generation left'))
    controller.abort(new Error('caller cancelled'))
    for (let turn = 0; turn < 10; turn++) await Promise.resolve()
    expect(outcome).toMatchObject({ code: 'CANCELLED' })
    ready(2)
    await result
    expect(sends).toBe(1)
    expect(scheduler.pendingCount).toBe(0)
  })
  it('[A5] settles the wall cap before later cleanup can settle an otherwise pending request', async () => {
    /** A real Worker and manual deadline isolate logical settlement from cleanup cancellation. */
    const scheduler = createManualScheduler()
    /** Production fixture composes the actual thread facade and canonical endpoint. */
    const fixture = nativeFixture({
      scheduler,
      spec: { entry: workerEntry, limits: { callWallTimeMs: 100 } }
    })
    /** Settlement is checked before joining the request or closing the fixture. */
    let outcome: unknown
    try {
      /** The only installed feature belongs to the real Worker. */
      const feature = await fixture.install()
      /** A held request remains physically pending so only its logical deadline may settle it. */
      const result = feature.hold([], { timeoutMs: 200 }).catch((error: unknown) => {
        outcome = error
      })
      for (
        let turn = 0;
        turn < 100 && !fixture.frames.some(({ message }) => message.method === 'p.hold');
        turn++
      )
        await new Promise((resolve) => setTimeout(resolve, 2))
      expect(fixture.frames.some(({ message }) => message.method === 'p.hold')).toBe(true)
      scheduler.advance(100)
      for (let turn = 0; turn < 40; turn++) await Promise.resolve()
      expect(outcome).toMatchObject({ code: 'DEADLINE_EXCEEDED' })
      await result
    } finally {
      await fixture.close()
    }
    expect(scheduler.pendingCount).toBe(0)
  })
})
