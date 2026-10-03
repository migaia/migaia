import assert from 'node:assert/strict'
import { readFile, writeFile, rename } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { readAuthenticationEnvelope } from '../../dist/core/middleware/authentication-envelope.js'
import { encodeRpcStreamFrame } from '../../dist/contract/framing/stream.js'
import { nativeSession } from './native-harness.mjs'
import { nativeFixtureAuthentication, verifyNativeFixture } from './native-auth-fixture.mjs'

/** Two real native endpoints exercise L-to-legacy transition with fresh signed physical counters. */
const results = []
for (const mode of ['process', 'worker']) {
  const auth = nativeFixtureAuthentication(mode === 'process' ? 'string' : 'any')
  const session = await nativeSession(mode, {
    capture: true,
    middlewares: [auth.plugin],
    entry: fileURLToPath(new URL('./native-stream-peer.mjs', import.meta.url))
  })
  const directory = dirname(session.fixturePaths.ready)
  const stateFile = join(directory, 'stream-state.json')
  const commandFile = join(directory, 'stream-command.json')
  let sequence = 0,
    pendingNext,
    returning
  /** Existing file observation awaits a concrete provider fact with a bounded assertion timeout. */
  const waitState = async (predicate) => {
    let value
    for (let attempt = 0; attempt < 200; attempt++) {
      value = JSON.parse(await readFile(stateFile, 'utf8'))
      if (predicate(value)) return value
      await delay(5)
    }
    assert.ok(predicate(value), '[A28] actual native stream reached the expected controlled state')
  }
  /** Commands never carry business envelopes and do not manufacture transport/session provenance. */
  const command = async (stage) => {
    await writeFile(commandFile + '.next', JSON.stringify({ sequence: ++sequence, stage }))
    await rename(commandFile + '.next', commandFile)
    await delay(25)
  }
  try {
    const stream = session.endpoint.stream.open('peer', 'heldStream', null, { timeoutMs: 5000 })
    pendingNext = stream.next().catch((error) => error)
    await waitState((value) => value.starts === 1 && value.nextPending)
    const frame = session.captures.find((value) => {
      const physical = mode === 'process' ? new TextDecoder().decode(value.subarray(4)) : value
      const payload = readAuthenticationEnvelope(verifyNativeFixture(physical)).payload
      const decoded = typeof payload === 'string' ? JSON.parse(payload) : payload
      return decoded.method === 'heldStream'
    })
    assert.ok(frame)
    const physical = mode === 'process' ? new TextDecoder().decode(frame.subarray(4)) : frame
    const payload = readAuthenticationEnvelope(verifyNativeFixture(physical)).payload
    /**
     * Repeated business ID is signed by the real endpoint's existing monotonic authentication
     * owner.
     */
    const duplicate = async () => {
      const protectedFrame = await auth.capability().protect(payload, {
        direction: 'outbound',
        endpointId: 'parent',
        platform: session.channel.transport.platform
      })
      await session.replay(
        mode === 'process'
          ? encodeRpcStreamFrame(new TextEncoder().encode(protectedFrame))
          : protectedFrame
      )
      await delay(25)
    }
    returning = stream.return().catch((error) => error)
    await waitState((value) => value.returnPending)
    await command('lose-and-clock')
    let value = JSON.parse(await readFile(stateFile, 'utf8'))
    assert.equal(
      value.starts,
      1,
      '[A28] physical downgrade plus TTL cannot reopen pending native next/return'
    )
    assert.equal(value.active, true)
    const another = session.endpoint.stream.open('peer', 'heldStream', null, { timeoutMs: 1000 })
    await assert.rejects(
      another.next(),
      (error) => error.code === 'OVERLOADED',
      '[A3] native stream-open shares the exact peer replay budget'
    )
    value = await waitState((state) => state.rejections.length > 0)
    assert.equal(value.qualified, false)
    assert.equal(value.rejections.at(-1).reason, 'replayLedgerFull')
    assert.equal(value.starts, 1, '[A3] rejected stream executes no provider')
    await duplicate()
    value = JSON.parse(await readFile(stateFile, 'utf8'))
    assert.equal(value.starts, 1, '[A28] fresh signed duplicate cannot reopen pending next/return')
    await command('next')
    await duplicate()
    value = JSON.parse(await readFile(stateFile, 'utf8'))
    assert.equal(value.starts, 1, '[A28] unresolved return still owns admission after next settles')
    await command('return')
    await waitState((state) => !state.returnPending && !state.nextPending)
    await delay(25)
    await duplicate()
    value = JSON.parse(await readFile(stateFile, 'utf8'))
    assert.equal(
      value.starts,
      1,
      '[A28] native downgrade starts the legacy tombstone at final settlement'
    )
    await command('clock')
    await duplicate()
    value = await waitState((state) => state.starts >= 2)
    assert.equal(value.starts, 2, '[A28] unchanged legacy TTL expires after final native cleanup')
    results.push({ mode, value })
  } finally {
    await session.close()
    await pendingNext
    await returning
  }
}
process.stdout.write(JSON.stringify({ assertions: 'A3/A8/A28', results }) + '\n')
