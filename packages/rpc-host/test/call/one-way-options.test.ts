import assert from 'node:assert/strict'
import { it } from 'vitest'
import { connectedCoreHosts } from '../host/core-fixture.js'

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
