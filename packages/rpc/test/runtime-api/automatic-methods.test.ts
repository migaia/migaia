import assert from 'node:assert/strict'
import { connected, legacyEndpoint } from './fixture.js'
import { it } from 'vitest'
import { createMemoryTransportPair } from '../../src/core/adapters/memory.js'
import { registerRemoteMethods } from '../../src/remote/serve-methods.js'
import type { IRpcEndpoint } from '../../src/core/typing.js'

it('[A4][A8] the automatic nested doc.save route executes the explicitly provided parent method', async () => {
  /** Both physical sides and all imported owners are real, successfully constructed baseline code. */
  const [parentTransport, childTransport] = createMemoryTransportPair()
  /** Count actual execution independently from response settlement. */
  let calls = 0
  /** The parent business object uses its captured receiver, as the new automatic provide will. */
  const doc = {
    save: () => {
      calls += 1
      return 'saved'
    }
  }
  /** The baseline's fixed contract exposes a three-segment wire name instead of the desired route. */
  const [parent, child] = await Promise.all([
    legacyEndpoint('parent', parentTransport),
    legacyEndpoint('child', childTransport)
  ])
  registerRemoteMethods(
    {
      schemaVersion: 1,
      plugin: 'doc',
      features: { api: { methods: { save: { mode: 'request', idempotent: false } } } }
    },
    { endpoint: parent as unknown as IRpcEndpoint },
    () => doc,
    () => false,
    (error) => {
      throw error
    }
  )
  /** The GREEN fixture selects the new shared owner; the executed legacy RED snapshot is archived. */
  const automatic = await connected({ doc }, {})
  try {
    /** A successful legacy call proves setup and the provider business are functional. */
    assert.equal(await child.send('parent', 'doc.api.save', []), 'saved')
    calls = 0
    /** The desired automatic logical route must succeed; a real provider rejection is business RED. */
    const [actual] = await Promise.allSettled([automatic.peers[1].request('doc.save', [])])
    assert.deepEqual(
      actual,
      { status: 'fulfilled', value: 'saved' },
      '[A4][A8] nested automatic route must invoke the explicit parent method'
    )
    assert.equal(calls, 1, '[A8] parent business method executes exactly once')
  } finally {
    await automatic.close()
    await parent.dispose()
    await child.dispose()
    parentTransport.close()
  }
})

it('[A6] a scalar request of a generator returns PAYLOAD_INVALID with the original normalization cause', async () => {
  /** The old scalar provider is deliberately exercised through its real request/result owner. */
  const [parentTransport, childTransport] = createMemoryTransportPair()
  /** Execution evidence distinguishes result rejection from a missing provider or setup error. */
  let generatorCalls = 0
  /**
   * A function returning an iterator is legal application code, but its scalar result is not
   * portable.
   */
  const feature = {
    scalar: () => 'ready',
    values: () => {
      generatorCalls += 1
      return [1, 2][Symbol.iterator]()
    }
  }
  /** All original baseline imports and both endpoints must finish construction first. */
  const [parent, child] = await Promise.all([
    legacyEndpoint('parent', parentTransport),
    legacyEndpoint('child', childTransport)
  ])
  registerRemoteMethods(
    {
      schemaVersion: 1,
      plugin: 'p',
      features: {
        f: {
          methods: {
            scalar: { mode: 'request', idempotent: false },
            values: { mode: 'request', idempotent: false }
          }
        }
      }
    },
    { endpoint: parent as unknown as IRpcEndpoint },
    () => feature,
    () => false,
    (error) => {
      throw error
    }
  )
  /** Only the new result wrapper may change the scalar normalization failure classification. */
  const automatic = await connected({ p: { f: feature } }, {})
  try {
    assert.equal(await child.send('parent', 'p.f.scalar', []), 'ready')
    /** Await a real provider result failure; only the business error-code assertion is RED. */
    const [result] = await Promise.allSettled([automatic.peers[1].request('p.f.values', [])])
    assert.equal(generatorCalls, 1, '[A6] the existing business method actually executed')
    assert.equal(result?.status, 'rejected', '[A6] a generator is not silently drained as a scalar')
    if (result?.status !== 'rejected') return
    assert.equal(
      result.reason.code,
      'PAYLOAD_INVALID',
      '[A6] scalar normalization alone owns the payload failure code'
    )
    assert.ok(result.reason.cause, '[A6] the normalization error remains reachable')
  } finally {
    await automatic.close()
    await parent.dispose()
    await child.dispose()
    parentTransport.close()
  }
})
