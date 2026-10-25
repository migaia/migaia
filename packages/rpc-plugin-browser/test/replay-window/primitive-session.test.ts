import assert from 'node:assert/strict'
import { setImmediate as nextTurn } from 'node:timers/promises'
import { describe, it, vi } from 'vitest'
import { createRpcHost } from '@migaia/rpc-host'
import { auth } from '@migaia/rpc-host/plugins/auth'
import { windowPlugin } from '../../dist/index.js'
import { windowPair } from '../browser/message-fixture.js'

describe('replay-window r12 physical session authority', () => {
  it('refuses primitive source before provider admission on the native Window boundary', async () => {
    /** The deleted transport DTO source field is replaced only by an actual native source event. */
    const pair = windowPair()
    /** Counts only verification of the primitive-source delivery, never a prior successful request. */
    let verifies = 0
    /** No native source filter failure may cause business entry. */
    let providers = 0
    /**
     * Keep the original observable authentication failure expectations pending their recorded
     * ruling.
     */
    const failures: unknown[] = []
    const peers = await Promise.all([
      createRpcHost({
        self: { name: 'client', instanceId: 'client' },
        plugins: [
          auth({ sign: (value) => value, verify: (value) => value }),
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
          auth({
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
    pair.right.setDeliver(false)
    const pending = peers[0].window
      .send('server', 'echo', 'primitive')
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
      // CORE-C2-AUTH-SOURCELESS-FRESHNESS: native filtering now precedes verification. Preserve RED.
      assert.ok(verifies > 0, 'actual physical delivery reached the verifier')
      assert.equal(
        providers,
        0,
        'primitive source cannot establish authenticated session authority'
      )
      assert.equal(failures.length, 1)
      assert.equal((failures[0] as { code: string }).code, 'AUTHENTICATION_FAILED')
    } finally {
      await peers[0].close()
      await peers[1].close()
      await pending
    }
  })
})
