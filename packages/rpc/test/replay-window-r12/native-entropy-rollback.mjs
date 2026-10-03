import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { createNodeThreadLauncher } from '../../dist/threads/adapters/node.js'
import { createNodeThreadChannel } from '../../dist/threads/channel.js'
import { createNodeProcessLauncher } from '../../dist/process/adapters/node-child-process.js'
import { createProcessTransport } from '../../dist/process/handshake.js'
import { createNativeProcessOffer } from '../../dist/process/offer.js'
import { systemScheduler } from '@migaia/utils/scheduler'
import { NativeReplayReceipt, nativeReplayReceipt } from '../../dist/core/internal/native-replay.js'
import { NativeDefaultIdText } from '../../dist/core/internal/native-default-id-text.js'
import { nativeEndpoint } from './native-runtime.mjs'

/** Only the failed-construction interval skips retirement in the explicit A6 mutant. */
let failingEntropy = false
const retire = NativeReplayReceipt.prototype.retire
if (process.env.RPC_REPLAY_ENTROPY_MUTANT === 'skip-retirement') {
  NativeReplayReceipt.prototype.retire = function () {
    if (!failingEntropy) return Reflect.apply(retire, this, [])
  }
}
const results = []
for (const mode of ['process', 'worker']) {
  /** Fixture readiness belongs to an isolated host temporary directory, independent of docs. */
  const directory = await mkdtemp(join(tmpdir(), 'rpc-entropy-ready-'))
  const config = { ready: join(directory, 'peer.json') }
  const entry = fileURLToPath(new URL('./native-peer.mjs', import.meta.url))
  const signal = new AbortController().signal
  let handle, channel
  try {
    if (mode === 'worker') {
      handle = await createNodeThreadLauncher().launch({ entry, data: config }, { signal })
      channel = createNodeThreadChannel(handle.port, 'peer', { scheduler: systemScheduler })
    } else {
      handle = await createNodeProcessLauncher().launch(
        {
          command: process.execPath,
          args: [...process.execArgv, entry],
          env: { inherit: ['PATH'], set: {} },
          stdio: { stdin: 'channel', stdout: 'channel', stderr: 'drain' },
          bootstrap: { via: 'stdin', payload: new TextEncoder().encode(JSON.stringify(config)) }
        },
        { signal, output: () => undefined }
      )
      channel = await createProcessTransport(handle.channel, {
        role: 'initiator',
        peerId: 'peer',
        offer: createNativeProcessOffer({ peer: { id: 'parent', runtime: 'node' }, stream: true }),
        scheduler: systemScheduler,
        ipc: { connectionId: 'entropy', sessionId: 'entropy', log: () => undefined },
        report: () => undefined
      })
    }
    /** Wait for the independent peer's atomic ready publication before faulting parent entropy. */
    for (let attempt = 0; attempt < 500; attempt++) {
      try {
        await readFile(config.ready)
        break
      } catch (error) {
        if (error.code !== 'ENOENT' || attempt === 499) throw error
        await delay(5)
      }
    }
    const original = new RangeError(NativeDefaultIdText.nonceFailed)
    const secure = globalThis.crypto.getRandomValues
    let entropyCalls = 0,
      failure
    failingEntropy = true
    globalThis.crypto.getRandomValues = () => {
      entropyCalls++
      throw original
    }
    try {
      await nativeEndpoint(channel, 'parent')
    } catch (error) {
      failure = error
    } finally {
      globalThis.crypto.getRandomValues = secure
      failingEntropy = false
    }
    assert.ok(failure, '[A6] actual native construction fails on throwing secure entropy')
    assert.equal(failure.code, 'INVALID_CONFIG')
    assert.equal(
      failure.cause,
      original,
      '[A6] construction preserves the original native entropy error'
    )
    assert.ok(original.stack)
    assert.equal(entropyCalls, 1)
    const receipt = nativeReplayReceipt(channel.transport)
    assert.ok(receipt)
    assert.equal(
      receipt.active,
      false,
      '[A6] failed native construction retires its claimed replay resource'
    )
    assert.equal(receipt.qualified, false)
    assert.equal(
      receipt.claim(),
      false,
      '[A6] failed construction cannot revive a spent physical claim'
    )
    results.push({
      mode,
      code: failure.code,
      causeIdentity: failure.cause === original,
      entropyCalls,
      active: receipt.active,
      qualified: receipt.qualified
    })
  } finally {
    if (channel) await channel.close()
    if (handle) {
      handle.terminate(mode === 'process' ? 'force' : undefined)
      await handle.exited
    }
  }
}
process.stdout.write(JSON.stringify({ assertions: 'A6', results }) + '\n')
