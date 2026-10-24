import assert from 'node:assert/strict'
import { PassThrough } from 'node:stream'
import { it, vi } from 'vitest'
import { createRpcHost } from '@migaia/rpc-host'
import { processPlugin } from '@migaia/rpc-plugin-process'
import { NativeProcessRuntimeLoader } from '../../../rpc-plugin-process/dist/process/runtime-loader.js'
import { NativeProcessRuntimeLoader as SourceProcessRuntimeLoader } from '../../../rpc-plugin-process/src/process/runtime-loader.js'
import { nodeByteStream } from '../../../rpc-plugin-process/dist/process/node-byte-stream.js'
import { prepareProcessRuntimeBootstrap } from '../../../rpc-plugin-process/dist/process/runtime-bootstrap.js'
import { createProcessTransport } from '../../../rpc-plugin-process/dist/process/handshake.js'
import { receiveAdapterBootstrap } from '../../../rpc-plugin-process/dist/process/bootstrap.js'
import { encodeRpcStreamFrame } from '@migaia/rpc-contract/framing/stream'
import { createNativeProcessOffer } from '../../../rpc-plugin-process/dist/process/offer.js'
import {
  PROCESS_RUNTIME_API_ENV,
  PROCESS_RUNTIME_API_ENV_VERSION
} from '../../../rpc-plugin-process/dist/process/constants.js'
import { createRuntimePeer } from '../../../rpc-host/dist/remote/runtime-api/peer.js'

it('automatic process authenticates its bootstrap parent and retains bidirectional business', async () => {
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
  /**
   * The actual Core receiver admits the first frame on the same held channel before automatic
   * setup.
   */
  const platform = {
    marker: PROCESS_RUNTIME_API_ENV_VERSION,
    runtime: 'node',
    open: async () => {
      opens++
      return receiveAdapterBootstrap(childChannel, 'stdin')
    }
  }
  /** The existing runtime loader lends the actual held native byte channels to processPlugin. */
  const loads = [...new Set([NativeProcessRuntimeLoader, SourceProcessRuntimeLoader])].map(
    (loader) =>
      vi.spyOn(loader.prototype, 'load').mockImplementation(() =>
        Promise.resolve({
          processRuntimeIO: {
            discover: () => ({ marker: platform.marker, runtime: platform.runtime }),
            open: platform.open
          }
        })
      )
  )
  /** Native child classification remains the real environment marker read by the cold plugin. */
  vi.stubEnv(PROCESS_RUNTIME_API_ENV, PROCESS_RUNTIME_API_ENV_VERSION)
  /** Conflicting source cardinality is rejected before the existing one-reader claim. */
  assert.throws(
    () =>
      processPlugin({
        connectToParent: true,
        connect: {
          target: async () => {
            throw new Error('explicit source must not execute')
          }
        }
      } as never),
    { code: 'INVALID_CONFIG' }
  )
  assert.equal(opens, 0)
  const [parent, child] = await Promise.all([
    createRuntimePeer({
      self: parentIdentity,
      provide: { increment: (value: number) => value + 1 },
      connect: async (context) => {
        /** Native launch writes the same canonical bootstrap frame before the ordinary hello. */
        await parentChannel.write(encodeRpcStreamFrame(bootstrap.payload))
        return createProcessTransport(parentChannel, {
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
        })
      },
      report: (error) => failures.push(error)
    }),
    createRpcHost({
      plugins: [processPlugin({ connectToParent: true })],
      provide: { double: (value: number) => value * 2 },
      report: (error) => failures.push(error)
    })
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
    for (const load of loads) load.mockRestore()
    vi.unstubAllEnvs()
  }
})
