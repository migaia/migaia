import assert from 'node:assert/strict'
import { describe, it } from 'vitest'
import { createRpcHost } from '@migaia/rpc-host'
import { batch } from '@migaia/rpc-host/plugins/batch'
import { dedicatedWorkerPlugin } from '@migaia/rpc-plugin-browser'
import { RpcCarrierFrameKind } from '@migaia/rpc-contract/protocol'
import { RpcBatchExtension } from '../../../rpc-host/dist/plugins/batch/constants.js'
import { portPair } from './message-fixture.js'

describe('optimal physical writer', () => {
  it('one bad member cannot block valid siblings or serialize provider execution', async () => {
    /** Native delivery alone is paused; both real hosts retain their canonical codecs and sessions. */
    const pair = portPair()
    /** Concurrent entries must be observable before either original provider completes. */
    const seen: string[] = []
    /** One business hold is released only after both real semantic admissions are checked. */
    let release!: () => void
    /** Actual provider promises remain unresolved while the original concurrency assertion runs. */
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    /** Keep original native/contract diagnostics intact without letting fixture logging alter work. */
    const reports: unknown[] = []
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
      await hosts[0].worker.notify('echo', 'good-two')
      /** A second completed native handoff contributes its own original semantic frame. */
      const second = pair.left.sent.at(-1)
      pair.right.emit('message', {
        kind: RpcCarrierFrameKind.extension,
        extension: RpcBatchExtension,
        data: {
          frames: [
            first,
            { kind: RpcCarrierFrameKind.message, data: '{"kind":"call","id":"bad"}' },
            second
          ]
        }
      })
      await new Promise<void>((resolve) => setTimeout(resolve, 10))
      assert.deepEqual(
        seen,
        ['good-one', 'good-two'],
        'valid siblings enter before either provider completes'
      )
    } finally {
      release()
      await Promise.all(hosts.map((host) => host.close()))
    }
  })
})
