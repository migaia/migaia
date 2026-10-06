import assert from 'node:assert/strict'
import { it, vi } from 'vitest'
import { RpcCapability } from '../../src/contract/wire-constants.js'
import { RpcCoreErrorCode } from '../../src/core/errors.js'
import { createRuntimePeer, readRuntimePeerConnection } from '../../src/remote/runtime-api/peer.js'
import { runtimeSources } from './fixture.js'

for (const missing of [RpcCapability.runtimeApi, RpcCapability.batch]) {
  it(`[A31][U36] missing ${missing} rejects the actual bilateral preparation before frames or providers`, async () => {
    /** Both independently configured offers omit exactly one mandatory baseline capability. */
    const offered = [RpcCapability.runtimeApi, RpcCapability.batch].filter(
      (value) => value !== missing
    )
    const channel = runtimeSources(offered, offered)
    /** Observe original transports without replacing their private identity or dispatch semantics. */
    const writes = channel.transports.map((transport) => vi.spyOn(transport, 'send'))
    /** An unsupported source must never reach an application provider. */
    let executions = 0
    const settled = await Promise.allSettled(
      channel.sources.map((connect, index) =>
        createRuntimePeer({
          self: { name: `baseline-${index}`, instanceId: index === 0 ? 'parent-1' : 'child-1' },
          provide: { echo: () => ++executions },
          connect,
          report: () => undefined
        })
      )
    )
    try {
      for (const result of settled) {
        assert.equal(
          result.status,
          'rejected',
          '[A31] baseline absence cannot select legacy business'
        )
        if (result.status === 'rejected')
          assert.equal(result.reason.code, RpcCoreErrorCode.capabilityUnsupported)
      }
      assert.equal(
        writes.reduce((sum, write) => sum + write.mock.calls.length, 0),
        0
      )
      assert.equal(executions, 0)
    } finally {
      await Promise.allSettled(
        settled.flatMap((result) => (result.status === 'fulfilled' ? [result.value.close()] : []))
      )
      writes.forEach((write) => write.mockRestore())
      channel.close()
    }
  })
}

it('[A31][A32][U36] v2/batch baseline exchanges real directories and preserves optional capability rejection', async () => {
  const offered = [RpcCapability.runtimeApi, RpcCapability.batch]
  const channel = runtimeSources(offered, offered)
  const peers = await Promise.all(
    channel.sources.map((connect, index) =>
      createRuntimePeer({
        self: { name: `baseline-${index}`, instanceId: index === 0 ? 'parent-1' : 'child-1' },
        provide: { echo: (value: unknown) => value },
        connect,
        report: () => undefined
      })
    )
  )
  try {
    assert.deepEqual(
      await Promise.all([peers[0]!.request('echo', 1), peers[0]!.request('echo', 2)]),
      [1, 2]
    )
    assert.equal(readRuntimePeerConnection(peers[0]!).description?.schemaVersion, 2)
    assert.throws(() => peers[0]!.group([{ method: 'echo', payload: 1 }]), {
      code: RpcCoreErrorCode.capabilityUnsupported
    })
  } finally {
    await Promise.all(peers.map((peer) => peer.close()))
    channel.close()
  }
})
