import { MessageChannel } from 'node:worker_threads'
import { createManualScheduler } from '@migaia/utils/testing'
import { describe, expect, it, vi } from 'vitest'

describe('Node child-port lazy replay ownership', () => {
  it('observes the exact parent port only when its canonical channel opens', async () => {
    /**
     * A real Node port supplies message and close events; only the child-module binding is
     * injected.
     */
    const { port1, port2 } = new MessageChannel()
    vi.doMock('node:worker_threads', async () => ({
      ...(await vi.importActual<typeof import('node:worker_threads')>('node:worker_threads')),
      parentPort: port1
    }))
    try {
      await import('@migaia/rpc-plugin-thread/adapters/node')
      expect(port1.listenerCount('close')).toBe(0)
      expect(port1.listenerCount('message')).toBe(0)
      /** The real canonical channel consumes the adapter's private lazy registration. */
      const { createNodeThreadChannel } =
        await import('../../../rpc-plugin-thread/dist/threads/channel.js')
      const { claimNativeReplayTransport } =
        await import('../../../rpc-host/dist/core/internal/native-replay.js')
      /** Opens the canonical child channel and consumes lazy provenance exactly once. */
      const channel = createNodeThreadChannel(port1, 'custody-parent', {
        scheduler: createManualScheduler()
      })
      /** Retains the original physical lifetime through downgrade and retirement. */
      const receipt = claimNativeReplayTransport(channel.transport)!
      expect(receipt).toBeDefined()
      expect(receipt.qualified).toBe(true)
      expect(port1.listenerCount('close')).toBe(1)
      /** A competing reader permanently downgrades provenance while the physical port remains live. */
      const release = channel.transport.subscribe(() => undefined)
      /** Adds a real second reader to trigger the supported exclusivity-loss path. */
      const competing = () => undefined
      port1.on('message', competing)
      receipt.observeOwner()
      expect(receipt.qualified).toBe(false)
      expect(receipt.active).toBe(true)
      port1.off('message', competing)
      receipt.observeOwner()
      expect(receipt.qualified).toBe(false)
      release()
      /** Actual close observation retires the existing receipt instead of creating a new lifetime. */
      let closed = false
      port1.once('close', () => {
        closed = true
      })
      port1.close()
      await vi.waitFor(() => expect(closed).toBe(true))
      receipt.observeOwner()
      expect(receipt.active).toBe(false)
      expect(claimNativeReplayTransport(channel.transport)).toBeUndefined()
      await channel.close()
    } finally {
      vi.doUnmock('node:worker_threads')
      port1.close()
      port2.close()
    }
  })
})
