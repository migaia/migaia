import assert from 'node:assert/strict'
import { nativeSession } from './native-harness.mjs'

/** Both current handshake auth policies qualify through the same private process resource owner. */
const cases = [
  { mode: 'process', required: false },
  { mode: 'process', required: true },
  { mode: 'worker', required: false }
]
/** Raw native receipts distinguish provider L from any apparent public transport metadata. */
const results = []
for (const entry of cases) {
  /** All calls cross the actual launcher, handshake/channel, endpoint and provider graph. */
  const session = await nativeSession(entry.mode, { required: entry.required })
  let progress = 0
  let stage = 'echo'
  try {
    assert.equal(session.receipt?.qualified, true, '[A5] canonical parent resource qualifies')
    /**
     * Exceeding 1024 completed calls proves production release rather than an enlarged fixture
     * limit.
     */
    for (let index = 0; index < 1050; index++) {
      /**
       * A qualified physical owner must release completed entries rather than hitting the legacy
       * 1024 cap.
       */
      const value = await session.endpoint
        .send('peer', 'echo', index, { timeoutMs: 5000 })
        .catch((error) => ({ failure: error }))
      assert.equal(
        typeof value,
        'number',
        '[R14-A9] actual qualified native provider releases completed replay entries'
      )
      assert.equal(value, index)
      progress += 1
    }
    /** Stats itself is one live request; completed echo calls must contribute no tombstones. */
    stage = 'stats'
    const stats = await session.endpoint.send('peer', 'stats', null, { timeoutMs: 5000 })
    assert.equal(stats.qualified, true, '[A5] actual peer adapter qualifies separately')
    assert.equal(stats.calls, 1051, '[A2] every native call executed')
    assert.equal(stats.providerState.replay, 1, '[A2] only the active stats call remains')
    assert.deepEqual(stats.rejections, [])
    results.push({ ...entry, ...stats, parent: session.snapshot() })
  } catch (error) {
    process.stderr.write(
      JSON.stringify({
        entry,
        progress,
        stage,
        diagnostics: session.diagnostics,
        failures: session.failures,
        rejections: session.rejections,
        qualified: session.receipt?.qualified
      }) + '\n'
    )
    throw error
  } finally {
    await session.close()
    assert.equal(session.receipt.active, false, '[A7] dispose retires only this physical receipt')
    assert.equal(session.snapshot().phase, 'disposed', '[A7] native endpoint cleanup finishes')
  }
}
process.stdout.write(JSON.stringify({ cases: results, assertions: 'A2/A5/A7' }) + '\n')
