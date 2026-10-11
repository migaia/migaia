import assert from 'node:assert/strict'
import { it, vi } from 'vitest'
import { identityCodecV1 } from '@migaia/serialize/codec'
import { messageFramerV1, remoteProcessStringFramer } from '@migaia/rpc-contract/framing'
import { createClientEndpoint } from '../../dist/core/client.js'
import { connect } from '../../dist/core/index.js'
import { createMemoryTransportPair } from '../../dist/core/adapters/memory.js'
import { remoteProcessJsonCodec } from '../../dist/adapter-owned/process/pipeline.js'
import { normalizeInboundRuntimeEnvelope } from '../../dist/core/internal/inbound-normalization.js'
import * as fast from '../../dist/core/internal/fast-path.js'

it.each(['json', 'json-custom-framer', 'live', 'copied-json'] as const)(
  '[H1-D5] the receive owner derives %s metadata admission from original decoder identity',
  async (source) => {
    /**
     * Memory carries live data; only the canonical JSON decoder can supply decoded-record
     * provenance.
     */
    const [transport] = createMemoryTransportPair()
    /**
     * A public descriptor copy may claim decoded data but cannot copy the factory-held operation
     * proof.
     */
    const codec =
      source === 'json' || source === 'json-custom-framer'
        ? remoteProcessJsonCodec
        : source === 'copied-json'
          ? { ...remoteProcessJsonCodec, decodedMetadata: true }
          : identityCodecV1
    /**
     * Observe actual endpoint component selection, rather than granting proof through a test
     * writer.
     */
    const selected = vi.spyOn(fast, 'hasDecodedRuntimeMetadata')
    try {
      /** Construction installs the real receive owner on the selected public transport. */
      const endpoint = await createClientEndpoint({
        id: 'decoded-owner',
        transport,
        codec,
        framer:
          source === 'live'
            ? messageFramerV1
            : source === 'json-custom-framer'
              ? { ...remoteProcessStringFramer }
              : remoteProcessStringFramer,
        middlewares: [connect()]
      })
      try {
        assert.ok(selected.mock.calls.length > 0)
        /** Re-reading proof must not extend the observer's iteration while it records the call. */
        const observed = selected.mock.calls.slice()
        for (const [snapshot, cloned] of observed) {
          assert.equal(cloned, false)
          assert.equal(
            fast.hasDecodedRuntimeMetadata(snapshot, cloned),
            source === 'json' || source === 'json-custom-framer'
          )
          if (source === 'json-custom-framer') assert.equal(fast.hasFastComponents(snapshot), false)
        }
      } finally {
        await endpoint.dispose()
      }
    } finally {
      selected.mockRestore()
    }
  }
)

it('[H1-D6] live inbound metadata rejects its getter without running it', () => {
  /** This value is intentionally live; no codec factory has established decoded-record provenance. */
  const value = { profile: 'migaia.rpc.runtime-api/1' }
  /** Executing a metadata getter would cross the unchanged strict receive boundary. */
  let reads = 0
  Object.defineProperty(value, 'id', {
    enumerable: true,
    get: () => {
      reads++
      return 'forged-id'
    }
  })
  assert.throws(() => normalizeInboundRuntimeEnvelope(value), { code: 'INVALID_ENVELOPE' })
  assert.equal(reads, 0)
})
