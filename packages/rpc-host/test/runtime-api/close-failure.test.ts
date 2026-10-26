import assert from 'node:assert/strict'
import { it, vi } from 'vitest'
import { tagRpcError } from '@migaia/rpc-contract/errors'
import { RpcCoreErrorCode } from '@migaia/rpc-contract/error-code'
import { walkErrorCauses } from '@migaia/utils/error'
import { connectedCoreHosts } from '../host/core-fixture.js'

it('[L2] a failed physical close keeps the original error and repeated close Promise', async () => {
  /** The same cleanup failure must have one background diagnostic owner. */
  const reports: unknown[] = []
  /** Real hosts complete the same original successful business call before cleanup fails. */
  const fixture = await connectedCoreHosts({}, { echo: (value) => value }, (error) =>
    reports.push(error)
  )
  /** The original single-source RuntimePeer close belongs to this public namespace owner. */
  const namespace = fixture.a.memory
  /** A caller may retain the same public peer projection after physical shutdown fails. */
  const peers = namespace.peers
  /** The external physical owner supplies one coded native failure without replacing its identity. */
  const original = tagRpcError(
    new RangeError('physical close fixture failure'),
    RpcCoreErrorCode.transport
  )
  /** Count the real carrier's release, independent from provider execution or public Promise count. */
  let closes = 0
  /** This is the already installed physical carrier, not a second source or lifecycle wrapper. */
  const close = vi.spyOn(fixture.pair[0], 'close').mockImplementation(async () => {
    closes++
    throw original
  })
  try {
    assert.equal(await fixture.a.memory.request('echo', 42), 42)
    assert.equal(Object.keys(peers).length, 1)
    /** Concurrent callers must observe this exact public close completion. */
    const first = namespace.close()
    assert.equal(namespace.close(), first)
    try {
      await assert.rejects(first, (error) => error === original)
    } finally {
      assert.equal(
        Object.keys(peers).length,
        0,
        'closed namespace releases its public peer entries'
      )
    }
    assert.equal(closes, 1, 'failed close cannot repeat physical ownership release')
    assert.equal(reports.filter((error) => walkErrorCauses(error).includes(original)).length, 1)
    await assert.rejects(async () => fixture.a.memory.request('echo', 43), {
      code: 'ENDPOINT_DISPOSED'
    })
  } finally {
    try {
      /** Global cleanup still owns native disposal; its separate lifecycle boundary keeps the cause. */
      await assert.rejects(fixture.a.close(), (error) => walkErrorCauses(error).includes(original))
    } finally {
      await fixture.b.close()
      close.mockRestore()
    }
  }
})
