import { expect, it } from 'vitest'
import { createRpcHost } from '@migaia/rpc-host'
import { probe } from '@migaia/rpc-host/plugins/probe'
import { sharedWorkerPlugin } from '../../dist/index.js'
import { portPair } from './message-fixture.js'

it('SharedWorker: throwing probes preserve a real Endpoint request and response', async () => {
  /** The original native-only port pair supplies neither a codec nor request/handshake state. */
  const pair = portPair()
  /** The exact observer exception must remain reachable while actual business results succeed. */
  const failure = new Error('endpoint probe failed')
  /** Genuine native Host reporting replaces only the removed private onListenerError channel. */
  const reported: unknown[] = []
  /** A cold readonly plugin observes the same actual port and codec as this public namespace. */
  const peers = await Promise.all([
    createRpcHost({
      plugins: [
        probe({
          stages: ['carrier'],
          emit() {
            throw failure
          }
        }),
        sharedWorkerPlugin({ namespace: 'browser', sharedWorker: { port: pair.left.target } })
      ],
      report: (error) => reported.push(error)
    }),
    createRpcHost({
      plugins: [
        sharedWorkerPlugin({ namespace: 'browser', sharedWorker: { port: pair.right.target } })
      ],
      provide: { echo: (value: string) => value },
      report: (error) => reported.push(error)
    })
  ])
  try {
    await expect(peers[0].browser.request('echo', 'business-value')).resolves.toBe('business-value')
    expect(reported.length).toBeGreaterThanOrEqual(2)
    expect(reported.every((error) => (error as Error).cause === failure)).toBe(true)
  } finally {
    await peers[0].close()
    await peers[1].close()
  }
})
