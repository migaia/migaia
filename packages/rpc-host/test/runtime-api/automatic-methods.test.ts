import assert from 'node:assert/strict'
import { connected, legacyEndpoint } from './fixture.js'
import { it } from 'vitest'
import { createMemoryTransportPair } from '../fixtures/memory-transport.js'
import { prepareRuntimeProviderAssembly } from '../../dist/remote/runtime-api/peer.js'
import { compileRuntimeMethods } from '../../dist/remote/runtime-api/catalog.js'

it('the automatic nested doc.save route executes the explicitly provided parent method', async () => {
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
  /** Canonical provider compilation preserves the independent three-segment wire oracle. */
  const assembly = prepareRuntimeProviderAssembly({
    methods: compileRuntimeMethods(
      { doc: { api: doc } },
      {
        schemaVersion: 1,
        plugin: 'doc',
        features: { api: { methods: { save: { mode: 'request', idempotent: false } } } }
      }
    ),
    streams: false,
    generations: false,
    supports: () => false,
    remoteNode: () => undefined,
    bindRemoteNode: () => undefined,
    describe: () => undefined
  })
  assembly.install(parent as unknown as Parameters<typeof assembly.install>[0])
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
      'nested automatic route must invoke the explicit parent method'
    )
    assert.equal(calls, 1, 'parent business method executes exactly once')
  } finally {
    await automatic.close()
    await parent.dispose()
    await child.dispose()
    parentTransport.close()
  }
})

it('a scalar request of a generator returns PAYLOAD_INVALID with the original normalization cause', async () => {
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
  /** Both baseline and automatic calls use the genuine provider/result normalizer. */
  const assembly = prepareRuntimeProviderAssembly({
    methods: compileRuntimeMethods(
      { p: { f: feature } },
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
      }
    ),
    streams: false,
    generations: false,
    supports: () => false,
    remoteNode: () => undefined,
    bindRemoteNode: () => undefined,
    describe: () => undefined
  })
  assembly.install(parent as unknown as Parameters<typeof assembly.install>[0])
  /** Only the new result wrapper may change the scalar normalization failure classification. */
  const automatic = await connected({ p: { f: feature } }, {})
  try {
    assert.equal(await child.send('parent', 'p.f.scalar', []), 'ready')
    /** Await a real provider result failure; only the business error-code assertion is RED. */
    const [result] = await Promise.allSettled([automatic.peers[1].request('p.f.values', [])])
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
    await automatic.close()
    await parent.dispose()
    await child.dispose()
    parentTransport.close()
  }
})
