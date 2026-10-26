import { EventEmitter } from 'node:events'
import { systemScheduler } from '@migaia/utils/scheduler'
import { createManualScheduler } from '@migaia/utils/testing'
import type { IRpcAvailableAttempt } from '@migaia/rpc-contract/interfaces'
import { describe, expect, it } from 'vitest'
import { createWebThreadChannelFactory } from '../../src/threads/web-launcher.js'
import type { IThreadWebPort } from '../../src/threads/types.js'
import { retry } from '@migaia/rpc-host/features/retry'
import { timeout } from '@migaia/rpc-host/features/timeout'
import { RpcCallMode, RpcWireKind } from '@migaia/rpc-contract/protocol'
import { threadFrames } from './frame.js'
import { nativeFixture, workerEntry } from './fixture.js'
/** Ordinary lifecycle regressions from archived audit receipts do not restart the interrupted audit. */
describe('thread preparation and retry settlement', () => {
  it('preserves pre-aborted open priority before reading the local capability proposal', async () => {
    /** A cancelled opening must retain its original caller reason before configuration effects. */
    const controller = new AbortController()
    /** Exact identity distinguishes cancellation from any later getter or startup failure. */
    const reason = new Error('cancelled before thread opening')
    controller.abort(reason)
    /** The proposal getter must not run on an opening already rejected by its signal. */
    let reads = 0
    /** No physical event operation is needed when the original opening is already cancelled. */
    const target = new EventEmitter()
    /** The supported raw port shape would expose any premature Core reader installation. */
    const port: IThreadWebPort = {
      postMessage: () => undefined,
      addEventListener: (type, listener) => {
        target.on(type, listener)
      },
      removeEventListener: (type, listener) => {
        target.off(type, listener)
      }
    }
    /** Both readiness and native completion remain pending independently of caller cancellation. */
    const pending = new Promise<never>(() => undefined)
    await expect(
      createWebThreadChannelFactory({
        scheduler: systemScheduler,
        /** Reading configuration here would replace the original cancellation with a getter failure. */
        get report(): (error: unknown) => void {
          reads++
          throw new Error('capability getter must not run after cancellation')
        }
      }).open(
        {
          identity: { fingerprint: 'cancelled-peer' },
          port,
          exited: pending,
          terminate: () => undefined
        },
        controller.signal
      )
    ).rejects.toBe(reason)
    expect(reads).toBe(0)
    expect(target.listenerCount('message')).toBe(0)
  })
  it('settles caller cancellation while waiting for replacement readiness without replay', async () => {
    /** The existing retry clock and cancellation signal own the logical request. */
    const scheduler = createManualScheduler()
    /** Caller cancellation remains observable even after departure removes the first generation. */
    const controller = new AbortController()
    /** Drive departure independently from later readiness. */
    let leave!: (reason: unknown) => void
    /** Readiness may arrive after cancellation and must not replay the request. */
    let ready!: (attempt: IRpcAvailableAttempt) => void
    /** Deferred replacement keeps the logical request inside the vulnerable await boundary. */
    const generationReady = new Promise<IRpcAvailableAttempt>((resolve) => {
      ready = resolve
    })
    /** The first physical generation; departure and replacement readiness are driven by the test. */
    const first: IRpcAvailableAttempt = {
      carrierId: 'thread-carrier',
      generation: 1,
      onLeave: (listener) => {
        leave = listener
        return () => undefined
      },
      whenReady: () => generationReady
    }
    /** The same availability owner is supplied to each logical dispatch. */
    const availability = { current: () => first }
    /** Settlement is inspected before replacement readiness can conceal a missed abort listener. */
    let outcome: unknown
    /** Only the initial generation may receive the physical send. */
    let sends = 0
    /** Canonical retry owns cancellation and cleanup; this test adds no retry implementation. */
    const result = retry({ scheduler, report: () => undefined })
      .run({
        facts: {
          method: 'p.read',
          idempotent: true,
          idempotencyKey: 'readiness-key',
          availability
        },
        signal: controller.signal,
        invoke: (_signal, _budget, options) => {
          options?.onWriteStart?.()
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
    ready({ ...first, generation: 2 })
    await result
    expect(sends).toBe(1)
    expect(scheduler.pendingCount).toBe(0)
  })
  it('settles the wall cap before later cleanup can settle an otherwise pending request', async () => {
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
      const result = feature
        .hold([], { timeout: timeout({ ms: 200, scheduler }) })
        .catch((error: unknown) => {
          outcome = error
        })
      await expect
        .poll(async () =>
          (await threadFrames(fixture.frames)).some(
            (frame) =>
              frame.kind === RpcWireKind.call &&
              frame.task.mode === RpcCallMode.request &&
              frame.task.method === 'p.hold'
          )
        )
        .toBe(true)
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
