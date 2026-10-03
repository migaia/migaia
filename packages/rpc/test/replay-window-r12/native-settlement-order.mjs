import assert from 'node:assert/strict'
import { nativeSession } from './native-harness.mjs'

/** No request is sent between the peer's actual listener addition and held provider settlement. */
const results = []
for (const mode of ['process', 'worker']) {
  const session = await nativeSession(mode, { capture: true })
  let held
  try {
    held = session.endpoint.send('peer', 'hold', null).catch((error) => error)
    assert.equal((await session.endpoint.send('peer', 'stats', null)).heldCalls, 1)
    const frame = session.captures.find((value) => {
      const decoded =
        value instanceof Uint8Array
          ? JSON.parse(new TextDecoder().decode(value.subarray(4)))
          : typeof value === 'string'
            ? JSON.parse(value)
            : value
      return decoded?.method === 'hold'
    })
    assert.ok(frame)
    assert.equal(await session.endpoint.send('peer', 'loseAndRelease', null), 'lost-and-released')
    assert.equal(await held, 'held-result')
    await session.replay(frame)
    const stats = await session.endpoint.send('peer', 'stats', null)
    assert.equal(
      stats.heldCalls,
      1,
      '[A23] loss then settlement with no new inbound retains a legacy tombstone'
    )
    assert.equal(
      stats.qualified,
      false,
      '[A23] settlement checkpoint observes physical ownership loss'
    )
    assert.equal(stats.physicalActive, true)
    results.push({ mode, stats })
  } finally {
    await session.close()
    await held
  }
}
process.stdout.write(JSON.stringify({ assertions: 'A23', results }) + '\n')
