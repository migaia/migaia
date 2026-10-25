import assert from 'node:assert/strict'
import { setImmediate as nextTurn } from 'node:timers/promises'
import { describe, it } from 'vitest'
import { createRpcHost } from '@migaia/rpc-host'
import { auth } from '@migaia/rpc-host/plugins/auth'
import { sharedWorkerPlugin } from '../../dist/index.js'

describe('replay-window r12 absent browser message source', () => {
  it('accepts null source and still rejects captured signed replay', async () => {
    /** Native MessagePorts deliver null MessageEvent.source without a transport DTO wrapper. */
    const { port1, port2 } = new MessageChannel()
    /** Retain the real protected request after both genuine installations are ready. */
    let captured: unknown
    /** Observe the native source once without supplying authentication authority. */
    let nativeSource: unknown
    /** Count actual business effects independently from physical delivery. */
    let providers = 0
    /** Original failures stay observable through the actual receiving Host reporter. */
    const failures: unknown[] = []
    const peers = await Promise.all([
      createRpcHost({
        self: { name: 'null-source-client', instanceId: 'null-source-client' },
        plugins: [
          auth({ sign: (value) => value, verify: (value) => value }),
          sharedWorkerPlugin({ sharedWorker: { port: port1 } })
        ],
        report: () => undefined
      }),
      createRpcHost({
        self: { name: 'null-source-server', instanceId: 'null-source-server' },
        plugins: [
          auth({ sign: (value) => value, verify: (value) => value }),
          sharedWorkerPlugin({ sharedWorker: { port: port2 } })
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
    /** This observer starts after readiness and never changes native acquisition. */
    const observe = (event: MessageEvent<unknown>) => {
      captured = event.data
      nativeSource = event.source
    }
    port2.addEventListener('message', observe)
    try {
      const outcome = await peers[0].sharedWorker
        .send('null-source-server', 'echo', 'source-null')
        .catch((error: unknown) => error)
      assert.equal(outcome, 'source-null', 'null means an absent physical source')
      assert.equal(nativeSource, null)
      assert.equal(providers, 1)
      assert.equal(failures.length, 0)
      port1.postMessage(captured)
      for (let turn = 0; turn < 20 && failures.length === 0; turn++) await nextTurn()
      assert.equal(failures.length, 1, 'captured signed replay is still rejected')
      assert.equal((failures[0] as { code: string }).code, 'AUTHENTICATION_FAILED')
      assert.equal(providers, 1, 'replay never repeats the business effect')
    } finally {
      port2.removeEventListener('message', observe)
      await peers[0].close()
      await peers[1].close()
      port1.close()
      port2.close()
    }
  })
})
