import assert from 'node:assert/strict'
import { it, vi } from 'vitest'
import { RpcCapability } from '../../src/contract/wire-constants.js'
import { createRpcIdempotencyStore } from '../../src/core/idempotency-store.js'
import { RpcCoreErrorCode } from '../../src/core/errors.js'
import { readEndpointOwner } from '../../src/core/internal/endpoint-projection.js'
import { EndpointOwnerKey } from '../../src/core/endpoint-kernel.js'
import type { RequestReplayLedger } from '../../src/core/internal/request-replay-ledger.js'
import type { ProviderAdmissionRegistry } from '../../src/core/internal/provider-admission.js'
import {
  createRuntimePeer,
  prepareRuntimePeerEndpoint,
  readRuntimePeerConnection
} from '../../src/remote/runtime-api/peer.js'
import { runtimeSources, RUNTIME_API_FIXTURE_BASE_CAPABILITIES } from './fixture.js'

it.each(['full', 'fingerprint'] as const)(
  '[A62][A68] real non-L group store %s refusal rolls back the original provisional replay entries',
  async (refusal) => {
    /** Both sides negotiate genuine profile support over the original non-exclusive memory owner. */
    const capabilities = [
      ...RUNTIME_API_FIXTURE_BASE_CAPABILITIES,
      RpcCapability.generation,
      RpcCapability.group,
      RpcCapability.outcome
    ]
    /** This carrier has no native replay qualification; actual completion retains legacy entries. */
    const carrier = runtimeSources(capabilities, capabilities)
    /** The existing result-store owner permits one sealed business key, then refuses new keys. */
    const store = createRpcIdempotencyStore({ maxEntries: 1 })
    /** Observe all reports, including the store's genuine admission failure. */
    const failures: unknown[] = []
    /** Original callables count invocation, rather than inferring it from returned completion. */
    let effects = 0
    /** Stable provider configuration feeds the same canonical endpoint assembly and registry. */
    const provider = {
      self: { name: 'group-store-provider', instanceId: 'group-store-provider' },
      provide: {
        value: () => ++effects,
        other: () => ++effects
      },
      report: (error: unknown) => failures.push(error)
    }
    /** Both actual peers finish their directory handshake before any business group is admitted. */
    const peers = await Promise.all([
      createRuntimePeer({
        self: { name: 'group-store-caller', instanceId: 'group-store-caller' },
        connect: carrier.sources[0],
        report: provider.report
      }),
      createRuntimePeer({
        ...provider,
        connect: carrier.sources[1],
        endpointFactory: (channel, signal) =>
          prepareRuntimePeerEndpoint(provider, channel, signal, { idempotency: { store } })
      })
    ])
    try {
      /** Project only the original canonical attachment's ledger and business lease owner. */
      const endpoint = readRuntimePeerConnection(peers[1]!).endpoint
      /** Non-L replay retention is part of the supported channel, never a test replacement. */
      const replay = readEndpointOwner<RequestReplayLedger>(endpoint, 'request-replay')!
      /** The same real owner releases all provisional business slots on refusal. */
      const admission = readEndpointOwner<ProviderAdmissionRegistry>(
        endpoint,
        EndpointOwnerKey.providerAdmission
      )!
      await vi.waitFor(() => assert.equal(admission.size, 0))
      /** The accepted key demonstrates that actual executed members retain their replay history. */
      const initial = replay.size
      await peers[0]!.group([{ method: 'value' }, { method: 'value' }], {
        idempotencyKey: 'sealed-key'
      })
      await vi.waitFor(() => assert.equal(admission.size, 0))
      assert.equal(effects, 2)
      assert.equal(replay.activeSize, 0)
      assert.equal(replay.size, initial + 2, '[A62] committed execution keeps legacy anti-replay')
      /** Capture genuine retained occupancy after the prior accepted task has completely settled. */
      const before = replay.size
      for (let index = 0; index < 2; index += 1) {
        await assert.rejects(
          peers[0]!.group([{ method: 'value' }, { method: 'other' }], {
            idempotencyKey: refusal === 'full' ? `refused-${index}` : 'sealed-key'
          }),
          {
            code:
              refusal === 'full' ? RpcCoreErrorCode.overloaded : RpcCoreErrorCode.contractInvalid
          }
        )
        await vi.waitFor(() => assert.equal(admission.size, 0))
        assert.equal(effects, 2, '[A62] refused group executes no member')
        assert.equal(replay.activeSize, 0)
        assert.equal(
          replay.size,
          before,
          '[A62] pre-start store refusal has zero replay net growth'
        )
      }
      assert.equal((await peers[0]!.outcome('sealed-key')).state, 'done')
      /** Unkeyed work remains admissible after repeated keyed refusal without another store claim. */
      const next = await peers[0]!.group([{ method: 'value' }, { method: 'other' }])
      assert.deepEqual(
        next.map((step) => step.state),
        ['success', 'success']
      )
      assert.equal(effects, 4)
      assert.ok(failures.length >= 2, '[A62] store refusal remains observable')
    } finally {
      for (const peer of peers) await peer.close()
      carrier.close()
    }
  }
)
