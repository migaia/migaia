import assert from 'node:assert/strict'
import { describe, it, vi } from 'vitest'
import { acceptRpcHandshake } from '../../src/contract/index.js'
import {
  BRIDGE_PEER_OFFER,
  BRIDGE_METHODS,
  bridgeFixture,
  bridgeEndpoint,
  flush
} from './fixture.js'

describe('negotiated JSON-RPC physical batching', () => {
  it('[A28] uses actual hello intersection and isolates invalid array response members', async () => {
    /** The independent peer advertises optional batching through the unchanged hello fields. */
    const fixture = bridgeFixture({
      responder(message) {
        if (message.method !== 'migaia.hello') return undefined
        const answer = acceptRpcHandshake(
          { ...BRIDGE_PEER_OFFER, capabilities: [...BRIDGE_PEER_OFFER.capabilities, 'batch@1'] },
          (message.params as { hello: string }).hello
        )
        return {
          jsonrpc: '2.0',
          id: message.id,
          result: { reply: answer.reply, methods: BRIDGE_METHODS }
        }
      }
    })
    const channel = await fixture.open({
      offer: {
        ...fixture.options.offer,
        capabilities: [...fixture.options.offer.capabilities, 'batch@1']
      }
    })
    const endpoint = await bridgeEndpoint(channel)
    /** Hold one real write after hello; following semantic calls are simultaneously ready. */
    let release!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    let hold = true
    const write = fixture.raw.write
    const heldWrite = vi.spyOn(fixture.raw, 'write').mockImplementation(async (value) => {
      await write(value)
      if (hold) {
        hold = false
        await held
      }
    })
    try {
      const anchor = endpoint.sendOneWay('peer', 'p.f.oneWay', [])
      await flush()
      assert.equal(hold, false)
      const first = endpoint.send('peer', 'p.f.request', ['one'], {
        timeoutMs: 100,
        trace: 'trace-one'
      })
      const second = endpoint.send('peer', 'p.f.plain', ['two'], { timeoutMs: 100 })
      const notify = endpoint.sendOneWay('peer', 'p.f.oneWay', ['notify'])
      await flush()
      release()
      await anchor
      await notify
      const batch = fixture.messages.at(-1) as unknown as Array<Record<string, unknown>>
      assert.ok(
        Array.isArray(batch),
        '[A28] native grouping becomes one JSON-RPC array physical write'
      )
      assert.equal(batch.length, 3)
      assert.ok(Object.hasOwn(batch[0]!, 'id'))
      assert.ok(Object.hasOwn(batch[1]!, 'id'))
      assert.ok(
        !Object.hasOwn(batch[2]!, 'id'),
        '[A28] notification retains its absent correlation id'
      )
      assert.equal((batch[0]!.params as { meta: { trace: string } }).meta.trace, 'trace-one')
      fixture.deliver([
        { jsonrpc: '2.0', id: batch[0]!.id, result: 'one' },
        { jsonrpc: 'wrong', id: 'bad', result: null },
        { jsonrpc: '2.0', id: batch[1]!.id, result: 'two' }
      ])
      assert.deepEqual(await Promise.all([first, second]), ['one', 'two'])
      assert.equal(
        fixture.reports.length,
        1,
        '[A28] malformed sibling is reported without closing valid peers'
      )
      assert.equal(fixture.closes, 0)
    } finally {
      release()
      await endpoint.dispose()
      await channel.close()
      heldWrite.mockRestore()
    }
  })
})
