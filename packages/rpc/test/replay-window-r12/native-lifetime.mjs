import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'
import { nativeSession } from './native-harness.mjs'
import { createNodeMessagePortTransport } from '../../dist/core/adapters/message-port.js'
import { createEndpoint } from '../../dist/core/index.js'
import { codec } from '../../dist/core/middleware/codec.js'
import { framer } from '../../dist/core/middleware/framer.js'
import { connect } from '../../dist/core/middleware/connect.js'

/** Existing native adapters and core owners, rather than a receipt substitute, execute every case. */
const evidence = []
for (const mode of ['process', 'worker']) {
  const session = await nativeSession(mode, { capture: true })
  try {
    const held = session.endpoint.send('peer', 'hold', null, { timeoutMs: 5000 })
    /** Preserve the original assertion if cleanup rejects this still-pending owned operation. */
    void held.catch((error) =>
      process.stderr.write(
        JSON.stringify({
          stage: 'owned-held-cleanup',
          source: error.source,
          code: error.code,
          name: error.name,
          message: error.message
        }) + '\n'
      )
    )
    await delay(10)
    /** The captured physical request remains byte-for-byte identical on every repeated delivery. */
    const frame = session.captures.find((value) => {
      const decoded =
        value instanceof Uint8Array
          ? JSON.parse(new TextDecoder().decode(value.subarray(4)))
          : typeof value === 'string'
            ? JSON.parse(value)
            : value
      return decoded?.kind === 'request' && decoded.method === 'hold'
    })
    assert.notEqual(frame, undefined)
    assert.equal((await session.endpoint.send('peer', 'stats', null)).heldCalls, 1)
    await session.endpoint.send('peer', 'loseExclusivity', null)
    await session.replay(frame)
    let stats = await session.endpoint.send('peer', 'stats', null)
    assert.equal(stats.qualified, false, '[A21] the real extra listener permanently downgrades L')
    assert.equal(stats.physicalActive, true, '[A21] downgrade does not close in-flight work')
    assert.equal(stats.heldCalls, 1, '[A21] loss plus duplicate never executes a second provider')
    await session.endpoint.send('peer', 'releaseHold', null)
    assert.equal(await held, 'held-result')
    await session.replay(frame)
    stats = await session.endpoint.send('peer', 'stats', null)
    assert.equal(
      stats.heldCalls,
      1,
      '[A23] settlement observes loss before releasing to a tombstone'
    )
    evidence.push({ mode, stats })
  } finally {
    await session.close()
  }
}
/** A second canonical wrapper and endpoint cannot establish parallel L on one actual Worker. */
const session = await nativeSession('worker')
let second
try {
  assert.equal(session.receipt.qualified, true)
  const transport = createNodeMessagePortTransport(session.handle.port)
  assert.equal(
    session.receipt.qualified,
    false,
    '[A5/A21] exact resource is spent by a second wrapper'
  )
  second = await createEndpoint({
    id: 'second',
    transport,
    middlewares: [
      codec(session.channel.pipeline.codec),
      framer(session.channel.pipeline.framer),
      connect({ transport })
    ]
  })
  assert.equal(
    await session.endpoint.send('peer', 'echo', 'original-still-live'),
    'original-still-live'
  )
  assert.equal(session.receipt.active, true)
  await second.dispose()
  assert.equal(
    await session.endpoint.send('peer', 'echo', 'after-second-close'),
    'after-second-close'
  )
  assert.equal(
    session.receipt.qualified,
    false,
    '[A21] removing the second consumer does not restore L'
  )
  evidence.push({
    mode: 'worker-second-consumer',
    qualified: session.receipt.qualified,
    active: session.receipt.active
  })
} finally {
  await second?.dispose()
  await session.close()
}
process.stdout.write(JSON.stringify({ assertions: 'A5/A21/A23', evidence }) + '\n')
