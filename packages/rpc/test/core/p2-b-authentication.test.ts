import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { MessageChannel } from 'node:worker_threads'
import { setImmediate as nextTurn } from 'node:timers/promises'
import { createManualScheduler, systemScheduler } from '@migaia/utils/scheduler'
import { describe, it } from 'vitest'
import { createNodeThreadChannel } from '../../src/threads/channel.js'
import { createEndpoint, authentication, connect } from '../../src/core/index.js'
import { readAuthenticationEnvelope } from '../../src/core/middleware/authentication-envelope.js'

/** A public fixture key proves whole-frame coverage without using or recording any credential. */
function signature(value: unknown): string {
  return createHmac('sha256', 'p2-b-public-fixture-key').update(JSON.stringify(value)).digest('hex')
}

describe('P2-B real physical authentication', () => {
  it.each([100, 310_001])(
    '[A27] one signed two-ID frame rejects replay at %s ms',
    async (elapsed) => {
      /** Both actual MessagePorts obtain the canonical thread factory's static agreement. */
      const { port1, port2 } = new MessageChannel()
      const scheduler = createManualScheduler()
      const clientChannel = createNodeThreadChannel(port1, 'server', { scheduler: systemScheduler })
      const serverChannel = createNodeThreadChannel(port2, 'client', { scheduler })
      /** Hold one actual write completion while two independent semantic requests become ready. */
      let hold = false
      let release!: () => void
      const held = new Promise<void>((resolve) => {
        release = resolve
      })
      let captured: unknown
      let signs = 0
      let verifies = 0
      const counts = new Map<string, number>()
      const failures: unknown[] = []
      const send = clientChannel.transport.send
      clientChannel.transport.send = (value, options) => {
        const frame = value as { value: unknown }
        if (
          (readAuthenticationEnvelope(frame.value).payload as { kind?: unknown }).kind === 'batch'
        )
          captured = value
        send(value, options)
        if (hold) {
          hold = false
          return held
        }
      }
      const signed = (server: boolean) =>
        authentication({
          sign(value) {
            if (
              !server &&
              (readAuthenticationEnvelope(value).payload as { kind?: unknown }).kind === 'batch'
            )
              signs++
            return { value, signature: signature(value) }
          },
          verify(value) {
            const frame = value as { value: unknown; signature: string }
            assert.equal(frame.signature, signature(frame.value))
            if (
              server &&
              (readAuthenticationEnvelope(frame.value).payload as { kind?: unknown }).kind ===
                'batch'
            )
              verifies++
            return frame.value
          }
        })
      const server = await createEndpoint({
        id: 'server',
        transport: serverChannel.transport,
        scheduler,
        middlewares: [connect({ transport: serverChannel.transport }), signed(true)],
        provider: {
          echo(context) {
            const key = context.data as string
            counts.set(key, (counts.get(key) ?? 0) + 1)
            return context.success(key)
          }
        }
      })
      const client = await createEndpoint({
        id: 'client',
        transport: clientChannel.transport,
        middlewares: [connect({ transport: clientChannel.transport }), signed(false)]
      })
      const remove = server.hooks.on((event) => {
        if (event.name === 'failure') failures.push(event.error)
      })
      try {
        assert.equal(await client.send('server', 'echo', 'warm'), 'warm')
        hold = true
        const anchor = client.send('server', 'echo', 'anchor')
        for (let turn = 0; turn < 30 && hold; turn++) await nextTurn()
        assert.equal(hold, false, '[A27] actual initial write is held')
        const calls = ['one', 'two'].map((value) => client.send('server', 'echo', value))
        await nextTurn()
        release()
        assert.deepEqual(await Promise.all(calls), ['one', 'two'])
        await anchor
        assert.equal(signs, 1, '[A27] two semantic IDs share one physical signature')
        assert.equal(verifies, 1, '[A27] complete physical frame is verified once')
        assert.ok(captured)
        scheduler.advance(elapsed)
        port1.postMessage(captured)
        for (let turn = 0; turn < 30 && verifies === 1; turn++) await nextTurn()
        await nextTurn()
        assert.equal(verifies, 2, '[A27] captured bytes reach actual cryptographic verification')
        assert.deepEqual(
          [counts.get('one'), counts.get('two')],
          [1, 1],
          '[A27] replay dispatches neither member'
        )
        assert.equal(
          failures.filter((error) => (error as { code: unknown }).code === 'AUTHENTICATION_FAILED')
            .length,
          1
        )
      } finally {
        release()
        remove()
        await client.dispose()
        await server.dispose()
        port1.close()
        port2.close()
      }
    }
  )
})
