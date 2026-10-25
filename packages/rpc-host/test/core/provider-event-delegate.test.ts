import { createRpcHost } from '@migaia/rpc-host'
import { deferred } from '@migaia/utils/promise'
import { expect, it } from 'vitest'
import { coreMemoryServer } from '../host/core-fixture.js'

it('delivers dispatch-only frames to the provider-owned listener registry', async () => {
  /** The original frame payload remains business data, independent from the wire protocol. */
  const frames: unknown[] = []
  /** Actual provider entry, rather than elapsed wall time, settles the delivery observation. */
  const delivered = deferred<void>()
  /** This real listener owns both the global provider catalog and accepted native Session. */
  const listener = coreMemoryServer('event-server')
  /** Public Host close owns unregistering the provider, replacing the retired event disposer. */
  const server = await createRpcHost(listener.options)
  try {
    /** The client reaches the original provider through one actual accepted native connection. */
    const client = await listener.connect('event-client')
    try {
      server.provide({
        serialize: {
          frame: (payload: unknown) => {
            frames.push(payload)
            delivered.resolve()
          }
        }
      })
      client.host.memory.dispatch('event-server', 'serialize.frame', { sequence: 4, kind: 'chunk' })
      await delivered.promise
      expect(frames).toEqual([{ sequence: 4, kind: 'chunk' }])
    } finally {
      await client.host.close()
    }
  } finally {
    await server.close()
  }
})
