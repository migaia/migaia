import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { nativeSession } from './native-harness.mjs'
import { executionCounters } from './native-counters.mjs'
import { loadedModules } from './native-loaded.mjs'
import { assertClosureFresh } from '../../../../scripts/dist-stamp.mjs'

/** Artifact destination is fixture data; each execution saves independent diagnostic evidence. */
const [mode, output] = process.argv.slice(2)
assertClosureFresh(resolve('packages/rpc'))
const session = await nativeSession(mode, { diagnostic: true, capture: true })
try {
  session.endpoint.provide('reverse', (context) => context.success(context.data))
  for (let index = 0; index < 10; index++)
    assert.equal(await session.endpoint.send('peer', 'echo', index), index)
  assert.equal(
    await session.endpoint.send('peer', 'reverseRequest', 'both-directions'),
    'both-directions'
  )
  const stats = await session.endpoint.send('peer', 'stats', null)
  const parent = executionCounters()
  for (const value of [parent, stats.counters]) {
    assert.equal(value.positiveControlUuid, 1, '[E2] old UUID observation has a positive control')
    assert.equal(
      value.legacyUuid,
      0,
      '[E2] native endpoints did not execute legacy UUID generation'
    )
    assert.ok(value.activeAdmit > 0, '[E2] the actual L active admission branch executed')
    assert.equal(
      value.completedAdmit,
      0,
      '[E2] native requests created no legacy admission tombstones'
    )
    assert.ok(value.ledgerSettle > 0)
    assert.equal(value.completedOnSettlement, 0)
    assert.ok(value.outboundReserve > 0)
    assert.ok(value.outboundRelease > 0)
    assert.equal(value.outboundTombstone, 0)
  }
  const loaded = { parent: loadedModules(), peer: session.peerReady.loaded }
  for (const side of Object.values(loaded)) {
    assert.ok(
      side.modules.some((value) => value.path.endsWith('/core/internal/native-default-id.js')),
      '[E3] actual native allocator module loaded on each endpoint'
    )
    assert.ok(side.modules.every((value) => value.matches))
  }
  await writeFile(
    output,
    JSON.stringify({ mode, purpose: 'diagnostic-only', parent, peer: stats, loaded }, null, 2),
    { flag: 'wx' }
  )
  process.stdout.write(
    JSON.stringify({
      mode,
      parent,
      peer: stats.counters,
      loadedCounts: { parent: loaded.parent.modules.length, peer: loaded.peer.modules.length }
    }) + '\n'
  )
} finally {
  await session.close()
}
