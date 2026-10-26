import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import { client, expected, peers, wireFrames } from '../process/fixtures/conformance-business.js'

/** The independent baseline providers retain genuine process control and physical exit ownership. */
for (const peer of peers.filter((value) => ['python', 'go', 'rust'].includes(value.language))) {
  it(`${peer.language} managed close uses the original native drain once`, async () => {
    /** The fixture installs the actual new process Peer over its original supervised binding. */
    const active = await client(peer, false, randomUUID())
    try {
      assert.equal(await active.namespace.request('p.f.request', ['before-close']), 'before-close')
      /** Repeated closure must share the original generation owner's completion Promise. */
      const closing = active.close()
      assert.equal(active.close(), closing)
      await closing
      await Promise.all(active.handles.map((handle) => handle.exited))
      assert.equal(
        wireFrames(active.sent).filter(
          (frame) => frame.kind === 'control' && frame.operation === 'close'
        ).length,
        1,
        'managed process closure sends the original native close before disposing its endpoint'
      )
      /** A released caller cannot emit another physical frame or acquire a replacement. */
      const sent = active.sent.length
      await expect(active.namespace.request('p.f.request', ['after-close'])).rejects.toMatchObject({
        code: 'ENDPOINT_DISPOSED'
      })
      assert.equal(active.sent.length, sent)
    } finally {
      await active.close()
      await Promise.all(active.handles.map((handle) => handle.exited))
    }
  }, 30_000)
}

it('managed native cancellation reaches the independent provider', async () => {
  /** Python's retained pending provider gives a real cancellation observation, not a local mock. */
  const peer = peers.find((value) => value.language === 'python')!
  /** The same public source and native lifecycle are exercised by conformance. */
  const active = await client(peer, false, randomUUID())
  /** A caller signal carries its actual native reason across the already installed abort owner. */
  const controller = new AbortController()
  try {
    /** Attach rejection before cancellation so fixture timing cannot create an unhandled Promise. */
    const waiting = active.namespace.request('peer.wait', [], {
      signal: controller.signal
    })
    const rejected = expect(waiting).rejects.toMatchObject({ code: expected.cancel.expectedCode })
    // The FIFO provider barrier proves that wait arrived before the signal is aborted.
    await active.namespace.request('peer.received', [])
    controller.abort(new RangeError(expected.cancel.reason))
    await rejected
    /** The provider records the cancellation independently of the caller's rejected Promise. */
    const reasons = await active.namespace.request('peer.aborts', [])
    assert.equal(
      Array.isArray(reasons) && reasons.length,
      1,
      'installed native abort capability must deliver the caller reason to the provider'
    )
    expect(reasons).toMatchObject([expected.cancel.providerReason])
  } finally {
    await active.close()
    await Promise.all(active.handles.map((handle) => handle.exited))
  }
}, 30_000)
