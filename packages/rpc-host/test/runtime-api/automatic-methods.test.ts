import assert from 'node:assert/strict'
import { it } from 'vitest'
import { connectedCoreHosts } from '../host/core-fixture.js'

it('the automatic nested doc.save route executes the explicitly provided parent method', async () => {
  /** Count actual execution independently from response settlement. */
  let calls = 0
  /** Both admitted public paths invoke this same original business method. */
  const doc = {
    save: () => {
      calls += 1
      return 'saved'
    }
  }
  /** The old redundant endpoint setup is replaced by one genuine nested provider publication. */
  const fixture = await connectedCoreHosts({ doc: { ...doc, api: doc } }, {}, () => undefined)
  try {
    /** Preserve the independent successful three-segment route before the desired logical route. */
    assert.equal(await fixture.b.memory.send('a', 'doc.api.save', []), 'saved')
    calls = 0
    /** Only the actual namespace request can supply the successful business result. */
    const [actual] = await Promise.allSettled([fixture.b.memory.request('doc.save', [])])
    assert.deepEqual(
      actual,
      { status: 'fulfilled', value: 'saved' },
      'nested automatic route must invoke the explicit parent method'
    )
    assert.equal(calls, 1, 'parent business method executes exactly once')
  } finally {
    await fixture.close()
  }
})

it('a scalar request of a generator returns PAYLOAD_INVALID with the original normalization cause', async () => {
  /** Execution evidence distinguishes result rejection from a missing provider or setup error. */
  let generatorCalls = 0
  /** Iterator results remain invalid scalar values even though stream calls support them. */
  const feature = {
    scalar: () => 'ready',
    values: () => {
      generatorCalls += 1
      return [1, 2][Symbol.iterator]()
    }
  }
  /** Both scalar control and rejection use the same actual public provider/result owner. */
  const fixture = await connectedCoreHosts({ p: { f: feature } }, {}, () => undefined)
  try {
    assert.equal(await fixture.b.memory.send('a', 'p.f.scalar', []), 'ready')
    /** Await a real provider result failure; no legacy endpoint or synthetic rejection is used. */
    const [result] = await Promise.allSettled([fixture.b.memory.request('p.f.values', [])])
    assert.equal(generatorCalls, 1, 'the existing business method actually executed')
    assert.equal(result?.status, 'rejected', 'a generator is not silently drained as a scalar')
    if (result?.status !== 'rejected') return
    assert.equal(
      result.reason.code,
      'PAYLOAD_INVALID',
      'scalar normalization alone owns the payload failure code'
    )
    assert.ok(result.reason.cause, 'the normalization error remains reachable')
  } finally {
    await fixture.close()
  }
})
