import assert from 'node:assert/strict'
import { getEventListeners } from 'node:events'
import { expect, it, vi } from 'vitest'
import { deferred } from '@migaia/utils/promise'
import { connectedCoreHosts } from '../host/core-fixture.js'
import { CallRecord } from '../../dist/call/record.js'

it('ordinary notifications release their records and caller listeners when physical sending completes', async () => {
  /** Hold provider work beyond each notification's physical completion. */
  const release = deferred<void>()
  const entered = deferred<void>()
  const finished = deferred<void>()
  /** The long-lived caller signal must not retain completed notification cancellation routes. */
  const caller = new AbortController()
  /** Inspect the canonical table at native insertion instead of adding a production counter. */
  let records: Map<unknown, unknown> | undefined
  const mapSet = Map.prototype.set
  const stored = vi
    .spyOn(Map.prototype, 'set')
    .mockImplementation(function (this: Map<unknown, unknown>, key, value) {
      /** Native set returns the same table whose membership this oracle observes. */
      const map = Reflect.apply(mapSet, this, [key, value])
      if (value instanceof CallRecord && value.task.mode === 'notify') records = map
      return map
    })
  /** Provider signals prove that aborting after send no longer cancels remote business. */
  const signals: AbortSignal[] = []
  let completed = 0
  const fixture = await connectedCoreHosts(
    {},
    {
      hold: async (_payload, context) => {
        signals.push(context.signal)
        if (signals.length === 8) entered.resolve()
        try {
          await release.promise
          return null
        } finally {
          completed += 1
          if (completed === 8) finished.resolve()
        }
      }
    },
    () => undefined
  )
  try {
    for (let index = 0; index < 8; index++)
      await fixture.a.memory.notify('hold', null, { signal: caller.signal })
    await entered.promise
    expect(records).toBeInstanceOf(Map)
    expect(records!.size).toBe(0)
    expect(getEventListeners(caller.signal, 'abort')).toHaveLength(0)
    caller.abort(new Error('caller has moved on'))
    expect(fixture.pair[0].written.filter((frame) => frame.kind === 'cancel')).toHaveLength(0)
    expect(signals.every((signal) => !signal.aborted)).toBe(true)
    release.resolve()
    await finished.promise
    expect(completed).toBe(8)
  } finally {
    stored.mockRestore()
    release.resolve()
    await fixture.close()
  }
})

it('a pre-aborted one-way send keeps its reason and produces no physical frame', async () => {
  /** Public hosts and their original carriers execute the canonical notification path. */
  const fixture = await connectedCoreHosts({}, { ready: () => 'ready' }, () => undefined)
  try {
    assert.equal(await fixture.a.memory.send('b', 'ready', null), 'ready')
    /** Handshake and baseline writes precede the actual notification handoff observation. */
    const sent = fixture.pair[0].written.length
    /** The native reason instance must remain reachable through the canonical local abort error. */
    const reason = new Error('public notify pre-abort reason')
    /** Native cancellation is applied before the existing one-way entry point is called. */
    const controller = new AbortController()
    controller.abort(reason)
    /** The production option retains the supported signal and its original reason. */
    const [result] = await Promise.allSettled([
      Promise.resolve().then(() =>
        fixture.a.memory.notify('ready', null, { signal: controller.signal })
      )
    ])
    assert.equal(
      fixture.pair[0].written.length - sent,
      0,
      'pre-aborted notify must not reach the physical transport'
    )
    assert.equal(result?.status, 'rejected', 'cancellation is observable to the sender')
    if (result?.status !== 'rejected') return
    assert.equal(result.reason.code, 'CANCELLED', 'the original abort code is preserved')
    assert.equal(result.reason.cause, reason, 'the caller reason keeps local identity')
  } finally {
    await fixture.close()
  }
})
