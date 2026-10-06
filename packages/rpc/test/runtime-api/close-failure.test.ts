import assert from 'node:assert/strict'
import { it } from 'vitest'
import { runtimeSources } from './fixture.js'
import { createRuntimePeer } from '../../src/remote/runtime-api/peer.js'
import { tagRpcError, RpcCoreErrorCode } from '../../src/core/errors.js'

it('[A34][L2] a failed physical close keeps the original error and repeated close Promise', async () => {
  /** Both callable owners complete genuine agreement and business before cleanup failure. */
  const channel = runtimeSources()
  /** The external physical owner supplies one coded native failure without rebuilding its identity. */
  const original = tagRpcError(
    new RangeError('physical close fixture failure'),
    RpcCoreErrorCode.transport
  )
  /** This is the real source's release call, independent of endpoint/provider execution. */
  let closes = 0
  const peers = await Promise.all([
    createRuntimePeer({
      self: { name: 'parent', instanceId: 'close-parent' },
      connect: async (context) => ({
        ...(await channel.sources[0](context)),
        close: async () => {
          closes++
          throw original
        }
      }),
      report: () => undefined
    }),
    createRuntimePeer({
      self: { name: 'child', instanceId: 'close-child' },
      connect: channel.sources[1],
      provide: { echo: (value) => value },
      report: () => undefined
    })
  ])
  try {
    assert.equal(await peers[0].request('echo', 42), 42)
    const first = peers[0].close()
    assert.equal(peers[0].close(), first)
    await assert.rejects(first, (error) => error === original)
    assert.equal(closes, 1, '[A34] failed close cannot repeat physical ownership release')
    await assert.rejects(async () => peers[0].request('echo', 43), { code: 'ENDPOINT_DISPOSED' })
  } finally {
    await peers[1].close()
    channel.close()
  }
})
