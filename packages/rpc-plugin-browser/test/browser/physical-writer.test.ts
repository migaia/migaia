import assert from 'node:assert/strict'
import { describe, it } from 'vitest'
import { createRpcHost } from '@migaia/rpc-host'
import { batch } from '@migaia/rpc-host/plugins/batch'
import { dedicatedWorkerPlugin } from '@migaia/rpc-plugin-browser'
import { RpcCarrierFrameKind } from '@migaia/rpc-contract/protocol'
import { RpcBatchExtension } from '../../../rpc-host/dist/features/batch/constants.js'
import { portPair } from './message-fixture.js'

describe('optimal physical writer', () => {
  it.each([
    { name: 'a malformed physical member stops later members', malformed: true },
    { name: 'a provider failure preserves concurrent valid siblings', malformed: false }
  ])('$name', async ({ malformed }) => {
    /** Native delivery alone is paused; both real hosts retain their canonical codecs and sessions. */
    const pair = portPair()
    /** Provider admissions remain observable before the held results complete. */
    const seen: string[] = []
    /** One hold keeps the business-failure concurrency control unsettled during its assertion. */
    let release!: () => void
    /** Actual provider promises remain unresolved while the original concurrency assertion runs. */
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    /** Keep original native/contract diagnostics intact without letting fixture logging alter work. */
    const reports: unknown[] = []
    /** A valid decoded call fails in the actual provider rather than the physical continuation. */
    const businessFailure = new Error('fixture provider failure')
    /** Both genuine cold batch instances negotiate the extension before any business frame is sent. */
    const hosts = await Promise.all([
      createRpcHost({
        plugins: [batch(), dedicatedWorkerPlugin({ worker: pair.left.target })],
        report: (error) => reports.push(error)
      }),
      createRpcHost({
        plugins: [batch(), dedicatedWorkerPlugin({ worker: pair.right.target })],
        provide: {
          echo: async (payload: string) => {
            if (payload === 'bad-business') throw businessFailure
            seen.push(payload)
            await held
            return payload
          }
        },
        report: (error) => reports.push(error)
      })
    ])
    try {
      pair.left.setDeliver(false)
      await hosts[0].worker.notify('echo', 'good-one')
      /** Capture this actual codec's frame without reconstructing metadata, task ids or routes. */
      const first = pair.left.sent.at(-1)
      await hosts[0].worker.notify('echo', 'bad-business')
      /** The business control uses an original valid frame produced by the same public sender. */
      const business = pair.left.sent.at(-1)
      await hosts[0].worker.notify('echo', 'good-two')
      /** A second completed native handoff contributes its own original semantic frame. */
      const second = pair.left.sent.at(-1)
      pair.right.emit('message', {
        kind: RpcCarrierFrameKind.extension,
        extension: RpcBatchExtension,
        data: {
          frames: [
            first,
            malformed
              ? { kind: RpcCarrierFrameKind.message, data: '{"kind":"call","id":"bad"}' }
              : business,
            second
          ]
        }
      })
      await new Promise<void>((resolve) => setTimeout(resolve, 10))
      assert.deepEqual(
        seen,
        malformed ? ['good-one'] : ['good-one', 'good-two'],
        malformed
          ? 'physical decode failure prevents admission of later members'
          : 'valid siblings enter before either provider completes'
      )
      assert.equal(reports.length, 1, 'the original failure has one diagnostic owner')
      if (!malformed) assert.equal(reports[0], businessFailure)
    } finally {
      release()
      await Promise.all(hosts.map((host) => host.close()))
    }
  })
})
