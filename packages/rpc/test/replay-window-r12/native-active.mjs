import assert from 'node:assert/strict'
import { nativeSession } from './native-harness.mjs'

/** Reads the actual single physical request; framing remains the negotiated production owner. */
function envelope(frame) {
  return frame instanceof Uint8Array
    ? JSON.parse(new TextDecoder().decode(frame.subarray(4)))
    : typeof frame === 'string'
      ? JSON.parse(frame)
      : frame
}

/** One unresolved real operation must survive more than the default 1024 completed requests. */
const results = []
for (const mode of ['process', 'worker']) {
  const session = await nativeSession(mode, { capture: true })
  const controller = new AbortController()
  const pending = session.endpoint.send('peer', 'hold', null, {
    signal: controller.signal,
    timeoutMs: 10000
  })
  /**
   * Cleanup rejection stays observed while the original Promise supplies the cancellation
   * assertion.
   */
  void pending.catch((error) =>
    process.stderr.write(
      JSON.stringify({
        stage: 'owned-pending',
        source: error.source,
        code: error.code,
        name: error.name,
        message: error.message
      }) + '\n'
    )
  )
  try {
    assert.equal((await session.endpoint.send('peer', 'stats', null)).heldCalls, 1)
    const held = session.captures.find((frame) => envelope(frame).method === 'hold')
    assert.ok(held)
    assert.equal(
      envelope(held).id.split(':').at(-1).length,
      36,
      '[A4] actual wire uses the canonical allocator'
    )
    await session.replay(held)
    for (let index = 0; index < 1040; index++)
      assert.equal(await session.endpoint.send('peer', 'echo', index), index)
    controller.abort(new Error('owned fixture cancellation'))
    await assert.rejects(pending, { code: 'CANCELLED' })
    await session.replay(held)
    const active = await session.endpoint.send('peer', 'stats', null)
    assert.equal(
      active.heldCalls,
      1,
      '[A8] client cancellation cannot release unresolved provider work'
    )
    assert.equal(
      active.providerState.replay,
      2,
      '[A2] exactly held work plus the active diagnostic remain'
    )
    await session.endpoint.send('peer', 'releaseHold', null)
    await session.replay(held)
    assert.equal(
      (await session.endpoint.send('peer', 'stats', null)).heldCalls,
      2,
      '[A3] a settled unsigned native business ID follows D8 and may enter again'
    )
    await session.endpoint.send('peer', 'releaseHold', null)
    await session.endpoint.sendOneWay('peer', 'hold', null)
    assert.equal((await session.endpoint.send('peer', 'stats', null)).heldCalls, 3)
    const oneWay = session.captures.find(
      (frame) => envelope(frame).data?.route?.dispatchOnly === true
    )
    assert.ok(oneWay)
    await session.replay(oneWay)
    assert.equal(
      (await session.endpoint.send('peer', 'stats', null)).heldCalls,
      3,
      '[A8] one-way settlement retains the original provider lifetime'
    )
    await session.endpoint.send('peer', 'releaseHold', null)
    await session.replay(oneWay)
    const settled = await session.endpoint.send('peer', 'stats', null)
    assert.equal(settled.heldCalls, 4, '[A3] settled one-way D8 allows a fresh execution')
    await session.endpoint.send('peer', 'releaseHold', null)
    results.push({ mode, active, settled })
  } finally {
    await session.close()
    await pending.catch(() => undefined)
  }
}
process.stdout.write(JSON.stringify({ assertions: 'A2/A3/A4/A8', results }) + '\n')
