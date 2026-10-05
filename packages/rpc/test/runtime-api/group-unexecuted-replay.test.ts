import assert from 'node:assert/strict'
import { it, vi } from 'vitest'
import { RpcCapability } from '../../src/contract/wire-constants.js'
import { EndpointOwnerKey } from '../../src/core/endpoint-kernel.js'
import { readEndpointOwner } from '../../src/core/internal/endpoint-projection.js'
import type { ProviderAdmissionRegistry } from '../../src/core/internal/provider-admission.js'
import type { RequestReplayLedger } from '../../src/core/internal/request-replay-ledger.js'
import { readRuntimePeerConnection } from '../../src/remote/runtime-api/peer.js'
import {
  connected,
  RUNTIME_API_FIXTURE_BASE_CAPABILITIES,
  RuntimeApiFixtureText
} from './fixture.js'

it.each([0, 1, 2] as const)(
  '[A62] failed group member %i retains only the invoked prefix in the original non-L replay owner',
  async (failureIndex) => {
    /** Actual provider invocation, including the failure, determines retained replay ownership. */
    const effects: string[] = []
    /** Independent bilateral offers enable groups without a native active-replay receipt. */
    const capabilities = [
      ...RUNTIME_API_FIXTURE_BASE_CAPABILITIES,
      RpcCapability.generation,
      RpcCapability.group
    ]
    /** The fixture delegates every real frame to the canonical Peer and final executor. */
    const fixture = await connected(
      {},
      {
        value: () => {
          effects.push('value')
          return effects.length
        },
        fail: () => {
          effects.push('fail')
          throw new RangeError(RuntimeApiFixtureText.businessRange)
        }
      },
      capabilities,
      capabilities
    )
    try {
      /** Project existing owners; the test neither replaces admission nor simulates replay. */
      const endpoint = readRuntimePeerConnection(fixture.peers[1]).endpoint
      /** The supported non-L ledger must retain executed members and fully release unused ones. */
      const replay = readEndpointOwner<RequestReplayLedger>(endpoint, 'request-replay')!
      /** Actual lease settlement establishes when terminal replay occupancy can be read. */
      const admission = readEndpointOwner<ProviderAdmissionRegistry>(
        endpoint,
        EndpointOwnerKey.providerAdmission
      )!
      await vi.waitFor(() => assert.equal(admission.size, 0))
      /** Both directory requests have settled before measuring genuine retained occupancy. */
      const initial = replay.size
      /** Move the one business failure through every position of the same genuine group. */
      const steps = Array.from({ length: 3 }, (_, index) => ({
        method: index === failureIndex ? 'fail' : 'value'
      }))
      /** Observe the original fail-stop outcome before reading terminal owner state. */
      const result = await fixture.peers[0].group(steps)
      assert.deepEqual(
        result.map((step) => step.state),
        steps.map((_, index) =>
          index < failureIndex ? 'success' : index === failureIndex ? 'failure' : 'not-executed'
        )
      )
      await vi.waitFor(() => assert.equal(admission.size, 0))
      assert.deepEqual(effects, [...Array<string>(failureIndex).fill('value'), 'fail'])
      assert.equal(replay.activeSize, 0)
      assert.equal(
        replay.size,
        initial + failureIndex + 1,
        '[A62] never-invoked members release retained replay capacity'
      )
      /** A subsequent complete group preserves replay history for every executed member. */
      await fixture.peers[0].group([{ method: 'value' }, { method: 'value' }])
      await vi.waitFor(() => assert.equal(admission.size, 0))
      assert.equal(replay.size, initial + failureIndex + 3)
      assert.equal(replay.activeSize, 0)
    } finally {
      await fixture.close()
    }
  }
)

it.each(['done', 'pending'] as const)(
  '[A62][A68] cached %s group completion releases its proven unexecuted replay suffix',
  async (cached) => {
    /** Only the first genuine keyed task may invoke the failing business method. */
    let effects = 0
    /** A pending store claimant waits for the original business result, never a fixture result. */
    let releaseBusiness!: () => void
    /** Hold actual execution long enough to observe the second original pending claim. */
    const business = new Promise<void>((resolve) => {
      releaseBusiness = resolve
    })
    /** Real non-L negotiation installs the canonical group and keyed-result owners. */
    const capabilities = [
      ...RUNTIME_API_FIXTURE_BASE_CAPABILITIES,
      RpcCapability.generation,
      RpcCapability.group,
      RpcCapability.outcome
    ]
    /** Both actual Peers keep their original default store, admission and replay implementation. */
    const fixture = await connected(
      {},
      {
        fail: async () => {
          effects++
          await business
          throw new RangeError(RuntimeApiFixtureText.businessRange)
        },
        unused: () => ++effects
      },
      capabilities,
      capabilities
    )
    /** Final cleanup also observes a genuine operation if the regression assertion rejects. */
    let running: Promise<unknown> | undefined
    try {
      /** The ledger and leases are projections of the provider's original owners. */
      const endpoint = readRuntimePeerConnection(fixture.peers[1]).endpoint
      /** Original completed tombstones expose unused-member retention without a replacement map. */
      const replay = readEndpointOwner<RequestReplayLedger>(endpoint, 'request-replay')!
      /** Six occupied slots prove the second group really waits on the pending store claim. */
      const admission = readEndpointOwner<ProviderAdmissionRegistry>(
        endpoint,
        EndpointOwnerKey.providerAdmission
      )!
      await vi.waitFor(() => assert.equal(admission.size, 0))
      /** Directory traffic has settled before counting the two business task identities. */
      const initial = replay.size
      /** Both genuine tasks use the same method/payload fingerprint and original business key. */
      const steps = [{ method: 'fail' }, { method: 'unused' }, { method: 'unused' }]
      /** This original request owns the business invocation and seals its actual fail-stop report. */
      const first = fixture.peers[0].group(steps, { idempotencyKey: 'cached-failure-prefix' })
      running = first
      void first.catch(() => undefined)
      await vi.waitFor(() => assert.equal(effects, 1))
      if (cached === 'done') {
        releaseBusiness()
        await first
        await vi.waitFor(() => assert.equal(admission.size, 0))
        assert.equal(replay.size, initial + 1)
      }
      /** Repetition reaches the real store's done or pending branch without invoking any suffix. */
      const repeated = fixture.peers[0].group(steps, {
        idempotencyKey: 'cached-failure-prefix'
      })
      running = Promise.all([first, repeated])
      void running.catch(() => undefined)
      if (cached === 'pending') await vi.waitFor(() => assert.equal(admission.size, 6))
      releaseBusiness()
      /** Both original operations return the same complete fail-stop outcome. */
      const results = await Promise.all([first, repeated])
      for (const result of results)
        assert.deepEqual(
          result.map((step) => step.state),
          ['failure', 'not-executed', 'not-executed']
        )
      await vi.waitFor(() => assert.equal(admission.size, 0))
      assert.equal(effects, 1, '[A68] cached group completion never repeats business')
      assert.equal(replay.activeSize, 0)
      assert.equal(
        replay.size,
        initial + 2,
        '[A62] each cached task retains only the proven executed prefix'
      )
    } finally {
      releaseBusiness()
      await fixture.close()
      await running?.catch(() => undefined)
    }
  }
)
