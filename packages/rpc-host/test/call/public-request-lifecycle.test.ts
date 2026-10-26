import assert from 'node:assert/strict'
import { RpcJsonCarrierCodec } from '@migaia/rpc-host/sdk'
import { it } from 'vitest'
import { connectedCoreHosts } from '../host/core-fixture.js'

it('borrowed public request preserves getter capture, independent Promises and close identity', async () => {
  /** Caller capture and actual provider execution remain separately observable business facts. */
  const events: string[] = []
  /** Both original memory endpoints borrow the actual SDK JSON codec at cold construction. */
  const fixture = await connectedCoreHosts(
    {},
    {
      echo: (value) => {
        events.push('handler')
        return value
      }
    },
    () => undefined,
    { create: () => new RpcJsonCarrierCodec(), nativeBinary: false }
  )
  /** The public receiver-free callable belongs to the actual namespace owner. */
  const request = fixture.a.memory.request
  try {
    /** Preserve original synchronous own-key capture order before nested getters and handlers. */
    const payload = {
      get first() {
        events.push('first')
        return {
          get nested() {
            events.push('nested')
            return 1
          }
        }
      },
      get second() {
        events.push('second')
        return 2
      }
    }
    /** These are the real public operations, not spies on an inner retired endpoint projection. */
    const one = request('echo', payload, { timeout: false })
    /** Independent calls retain independent public Promise identities. */
    const two = request('echo', { value: 2 }, { timeout: false })
    void one.catch(() => undefined)
    void two.catch(() => undefined)
    assert.notEqual(one, two)
    assert.deepEqual(
      events,
      ['first', 'second', 'nested'],
      'synchronous getter capture before handlers'
    )
    assert.deepEqual(await Promise.all([one, two]), [
      { first: { nested: 1 }, second: 2 },
      { value: 2 }
    ])
    assert.deepEqual(events, ['first', 'second', 'nested', 'handler', 'handler'])
    /** Borrowed namespace shutdown retains its original idempotent completion Promise. */
    const close = fixture.a.memory.close
    /** The actual namespace owns its physical Session cleanup, without a per-session Peer. */
    const closing = close()
    assert.equal(close(), closing, 'borrowed close preserves Promise and idempotency')
    await closing
  } finally {
    await fixture.close()
  }
})
