import assert from 'node:assert/strict'
import { setImmediate as nextTurn } from 'node:timers/promises'
import { describe, it, vi } from 'vitest'
import { createRpcHost } from '@migaia/rpc-host'
import { authFeature } from '@migaia/rpc-host/plugins/auth'
import { windowPlugin } from '../../dist/index.js'
import { windowPair } from '../browser/message-fixture.ts'

describe('replay-window r12 physical session authority', () => {
  it('refuses primitive source before provider admission on the native Window boundary', async () => {
    /** The deleted transport DTO source field is replaced only by an actual native source event. */
    const pair = windowPair()
    /** Counts only verification of the primitive-source delivery, never a prior successful request. */
    let verifies = 0
    /** No native source filter failure may cause business entry. */
    let providers = 0
    /** Native source filtering owns this rejection before authentication reads its payload. */
    const failures: unknown[] = []
    const peers = await Promise.all([
      createRpcHost({
        self: { name: 'client', instanceId: 'client' },
        plugins: [
          authFeature({ sign: (value) => value, verify: (value) => value }),
          windowPlugin({
            window: pair.right.target,
            receiver: pair.left.target,
            origin: 'https://right.test'
          })
        ],
        report: () => undefined
      }),
      createRpcHost({
        self: { name: 'server', instanceId: 'server' },
        plugins: [
          authFeature({
            sign: (value) => value,
            verify: (value) => {
              verifies++
              return value
            }
          }),
          windowPlugin({
            window: pair.left.target,
            receiver: pair.right.target,
            origin: 'https://left.test'
          })
        ],
        provide: {
          echo: (value: unknown) => {
            providers++
            return value
          }
        },
        report: (error) => failures.push(error)
      })
    ])
    /** Hold genuine native delivery, retaining the original signed call for the source event. */
    const before = pair.right.sent.length
    /** Public cancellation later settles the held call without granting forged-source authority. */
    const cancellation = new AbortController()
    /** The original local reason must remain reachable through the real cancellation result. */
    const reason = new Error('cancel rejected native source fixture call')
    pair.right.setDeliver(false)
    const pending = peers[0].window
      .send('server', 'echo', 'primitive', { signal: cancellation.signal })
      .catch((error: unknown) => error)
    try {
      await vi.waitFor(() => assert.equal(pair.right.sent.length, before + 1))
      /** Exclude the real installation's asynchronous directory verification from this delivery. */
      verifies = 0
      pair.right.emit(
        'message',
        pair.right.sent.at(-1),
        'primitive-r12-source',
        'https://left.test'
      )
      await nextTurn()
      await nextTurn()
      assert.equal(verifies, 0, 'native source filtering precedes authentication verification')
      assert.equal(
        providers,
        0,
        'primitive source cannot establish authenticated session authority'
      )
      assert.equal(failures.length, 0, 'a filtered native source never enters authentication')
      pair.right.setDeliver(true)
      cancellation.abort(reason)
      /** Real public cancellation settles the original held call with its unchanged reason. */
      const cancelled = await pending
      assert.equal((cancelled as { code?: unknown }).code, 'CANCELLED')
      assert.strictEqual((cancelled as Error).cause, reason)
      assert.equal(await peers[0].window.send('server', 'echo', 'valid'), 'valid')
      assert.equal(providers, 1, 'the genuine native source remains accepted')
      assert.ok(verifies > 0, 'the genuine native delivery reaches authentication')
      assert.equal(failures.length, 0)
    } finally {
      pair.right.setDeliver(true)
      cancellation.abort(reason)
      await peers[0].close()
      await peers[1].close()
      await pending
    }
  })
})
