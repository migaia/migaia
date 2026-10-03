import assert from 'node:assert/strict'
import { MessageChannel } from 'node:worker_threads'
import { setImmediate as nextTurn } from 'node:timers/promises'
import { describe, it } from 'vitest'
import { createEndpoint } from '../../src/core/index.js'
import { createNodeMessagePortTransport } from '../../src/core/adapters/message-port.js'
import { authentication } from '../../src/core/middleware/authentication.js'
import { connect } from '../../src/core/middleware/connect.js'
import type { IRpcTransport } from '../../src/core/transport.js'

/** Frozen owner-only baseline retains exactly the old authentication acceptance path. */
const owner = process.env.RPC_REPLAY_BASE
  ? (
      (await import(/* @vite-ignore */ process.env.RPC_REPLAY_BASE)) as {
        authentication: typeof authentication
      }
    ).authentication
  : authentication

describe('replay-window r12 physical session authority', () => {
  it('[A29] refuses primitive source before provider admission on an actual MessagePort', async () => {
    /** Both resources are real; only the received source is the intentionally unsupported input. */
    const { port1, port2 } = new MessageChannel()
    const clientTransport = createNodeMessagePortTransport(port1)
    const physical = createNodeMessagePortTransport(port2)
    const serverTransport: IRpcTransport = {
      ...physical,
      subscribe: (listener) =>
        physical.subscribe((message) => listener({ ...message, source: 'primitive-r12-source' }))
    }
    /** Completion is recorded at cryptographic verification, not an arbitrary elapsed timeout. */
    let verifies = 0
    let providers = 0
    /** The configured verifier is trusted; it cannot grant physical session authority itself. */
    const plugin = () =>
      owner({
        sign: (value) => value,
        verify: (value) => {
          verifies++
          return value
        }
      })
    const server = await createEndpoint({
      id: 'server',
      transport: serverTransport,
      middlewares: [connect({ transport: serverTransport }), plugin()],
      provider: {
        echo: (context) => {
          providers++
          return context.success(context.data)
        }
      }
    })
    const client = await createEndpoint({
      id: 'client',
      transport: clientTransport,
      middlewares: [connect({ transport: clientTransport }), plugin()]
    })
    /** Keep original hook classifications and pending cleanup failure observable. */
    const failures: unknown[] = []
    const release = server.hooks.on((event) => {
      if (event.name === 'failure') failures.push(event.error)
    })
    let pending: Promise<unknown> | undefined
    try {
      pending = client.send('server', 'echo', 'primitive').catch((error: unknown) => error)
      for (let turn = 0; turn < 20 && verifies === 0; turn++) await nextTurn()
      await nextTurn()
      await nextTurn()
      assert.ok(verifies > 0, '[A29] actual physical delivery reached the verifier')
      assert.equal(
        providers,
        0,
        '[A29] primitive source cannot establish authenticated session authority'
      )
      assert.equal(failures.length, 1)
      assert.equal((failures[0] as { code: string }).code, 'AUTHENTICATION_FAILED')
    } finally {
      release()
      await client.dispose()
      await server.dispose()
      await pending
      port1.close()
      port2.close()
    }
  })
})
