import { PassThrough, type Readable, type Writable } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'

describe('canonical child stdio replay registration', () => {
  it('[A6/A7] binds the opened byte channel and preserves physical data and write ownership', async () => {
    /** Real isolated streams replace the host stdio pair so this test cannot close the test runner. */
    const readable = new PassThrough()
    /** Owns isolated outbound bytes instead of the test runner's stdout. */
    const writable = new PassThrough()
    /** Observe supplied host handles while leaving the actual byte-channel implementation intact. */
    const byteStreams = await import('../../src/process/adapters/node-byte-stream.js')
    /** Substitutes isolated streams while observing the canonical stdio constructor arguments. */
    const construct = vi.fn((_readable: Readable, _writable: Writable, _destroy: () => void) =>
      byteStreams.nodeByteStream(readable, writable, () => {
        readable.destroy()
        writable.destroy()
      })
    )
    vi.doMock('../../src/process/adapters/node-byte-stream.js', () => ({
      ...byteStreams,
      nodeByteStream: construct
    }))
    try {
      const { openProcessStdioChannel } =
        await import('../../src/process/adapters/node-child-process.js')
      await expect(openProcessStdioChannel({ bootstrap: 'fd', fd: 3 })).rejects.toMatchObject({
        code: 'INVALID_CONFIG'
      })
      expect(construct).not.toHaveBeenCalled()
      /** Opening without bootstrap must return the exact privately registered stream channel. */
      const { channel, bootstrap } = await openProcessStdioChannel({ bootstrap: 'none' })
      expect(bootstrap).toBeUndefined()
      expect(construct).toHaveBeenCalledOnce()
      expect(construct.mock.calls[0]).toEqual([process.stdin, process.stdout, expect.any(Function)])
      const { bindNativeReplayTransport, claimNativeReplayTransport } =
        await import('../../src/core/internal/native-replay.js')
      /** The registration transfers provenance to one canonical transport identity. */
      const transport = {
        platform: 'Memory' as const,
        send: () => undefined,
        subscribe: () => () => undefined
      }
      bindNativeReplayTransport(channel, transport)
      /** Represents the one privately registered byte-channel lifetime. */
      const receipt = claimNativeReplayTransport(transport)!
      expect(receipt.qualified).toBe(true)
      /** Actual stream traffic remains intact after canonical registration. */
      const received: Uint8Array[] = []
      /** Releases the test reader before closing the physical streams. */
      const remove = channel.onData((chunk) => received.push(chunk))
      readable.write(Buffer.from([1, 2, 3]))
      await vi.waitFor(() => expect(received).toHaveLength(1))
      expect([...received[0]!]).toEqual([1, 2, 3])
      await channel.write(new Uint8Array([4, 5]))
      expect([...(writable.read() as Buffer)]).toEqual([4, 5])
      remove()
      await channel.close()
      receipt.observeOwner()
      expect(receipt.active).toBe(false)
    } finally {
      vi.doUnmock('../../src/process/adapters/node-byte-stream.js')
      readable.destroy()
      writable.destroy()
    }
  })
})
