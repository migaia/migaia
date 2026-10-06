import assert from 'node:assert/strict'
import { PassThrough } from 'node:stream'
import { it } from 'vitest'
import { createAutomaticProcessPeer } from '../../src/process/automatic-peer.js'
import { nodeByteStream } from '../../src/process/adapters/node-byte-stream.js'
import { prepareProcessRuntimeBootstrap } from '../../src/process/runtime-bootstrap.js'
import { createProcessTransport } from '../../src/process/handshake.js'
import { createNativeProcessOffer } from '../../src/process/offer.js'
import { PROCESS_RUNTIME_API_ENV_VERSION } from '../../src/process/constants.js'
import { createRuntimePeer } from '../../src/remote/runtime-api/peer.js'

it('[A1][A3][A17] automatic process authenticates its bootstrap parent and retains bidirectional business', async () => {
  /**
   * Canonical Node byte adapters own real stream backpressure and subscriptions, without a fake
   * dispatcher.
   */
  const left = new PassThrough()
  /** The opposite stream preserves the reverse direction's independent byte ordering. */
  const right = new PassThrough()
  /** One local cleanup closes both native streams without pretending to own an OS process. */
  const close = () => {
    left.destroy()
    right.destroy()
  }
  /** The parent adopts the original adapter rather than a fixture RPC implementation. */
  const parentChannel = nodeByteStream(left, right, close)
  /** The automatic side reads the same authenticated byte protocol through its original owner. */
  const childChannel = nodeByteStream(right, left, close)
  /** Non-production auth material must stay outside every safe description. */
  const token = 'automatic-process-owner-private-fixture'
  /** The hello route must match this independently supplied bootstrap parent. */
  const parentIdentity = { name: 'parent', instanceId: 'automatic-owner-parent' }
  /** The canonical bootstrap encoder supplies the exact child fingerprint and private token. */
  const bootstrap = prepareProcessRuntimeBootstrap(
    { name: 'child', parentInstanceId: parentIdentity.instanceId },
    new TextEncoder().encode(token)
  )
  /** Opening a source counts the original one-reader claim, independent of business results. */
  let opens = 0
  /** Genuine report callbacks remain visible throughout handshake and business. */
  const failures: unknown[] = []
  /** Platform opening supplies only its original channel and already decoded private first frame. */
  const platform = {
    marker: PROCESS_RUNTIME_API_ENV_VERSION,
    runtime: 'node',
    open: async () => {
      opens++
      return { channel: childChannel, bootstrap: bootstrap.payload }
    }
  }
  /** A conflicting explicit source is rejected before claiming the one process reader. */
  await assert.rejects(
    createAutomaticProcessPeer(
      {
        connect: async () => {
          throw new Error('explicit source must not execute')
        },
        report: () => undefined
      },
      platform
    ),
    { code: 'INVALID_CONFIG' }
  )
  assert.equal(opens, 0)
  const [parent, child] = await Promise.all([
    createRuntimePeer({
      self: parentIdentity,
      provide: { increment: (value: number) => value + 1 },
      connect: (context) =>
        createProcessTransport(parentChannel, {
          role: 'initiator',
          peerId: bootstrap.self.instanceId,
          offer: createNativeProcessOffer({
            peer: { id: context.self.instanceId, runtime: 'node' },
            auth: token,
            capabilities: context.capabilities
          }),
          ipc: {
            connectionId: 'automatic-owner',
            sessionId: 'automatic-owner',
            log: () => undefined
          },
          report: (error) => failures.push(error)
        }),
      report: (error) => failures.push(error)
    }),
    createAutomaticProcessPeer(
      {
        provide: { double: (value: number) => value * 2 },
        report: (error) => failures.push(error)
      },
      platform
    )
  ])
  try {
    assert.equal(await parent.request('double', 21), 42)
    assert.equal(await child.request('increment', 41), 42)
    assert.deepEqual(child.self, bootstrap.self)
    assert.equal(opens, 1)
    assert.equal(failures.length, 0)
    /** Safe local descriptions never include the private auth token or bootstrap bytes. */
    assert.equal(JSON.stringify(await child.describe()).includes(token), false)
  } finally {
    await Promise.all([parent.close(), child.close()])
    close()
  }
})
