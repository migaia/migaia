import { PassThrough, type Readable, type Writable } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'

describe('canonical child stdio replay registration', () => {
  it('binds the opened byte channel and preserves physical data and write ownership', async () => {
    /** Real isolated streams replace the host stdio pair so this test cannot close the test runner. */
    const readable = new PassThrough()
    /** Owns isolated outbound bytes instead of the test runner's stdout. */
    const writable = new PassThrough()
    /** The public write must reject with this exact native callback failure, without replacement. */
    const writeFailure = new Error('fixture native writer failed')
    /** Isolates error-driven retirement from the original channel's explicit-close assertions. */
    const failingReadable = new PassThrough()
    /** Fails through the native stream callback while retaining the original byte-channel adapter. */
    const failingWritable = new PassThrough({
      /** Deterministically exercise callback failure without relying on an operating-system race. */
      transform(_chunk, _encoding, callback) {
        callback(writeFailure)
      }
    })
    /** Observe supplied host handles while leaving the actual byte-channel implementation intact. */
    const byteStreams = await import('../../../rpc-plugin-process/dist/process/node-byte-stream.js')
    /** Substitutes isolated streams while observing the canonical stdio constructor arguments. */
    const construct = vi.fn((_readable: Readable, _writable: Writable, _destroy: () => void) =>
      byteStreams.nodeByteStream(readable, writable, () => {
        readable.destroy()
        writable.destroy()
      })
    )
    vi.doMock('../../../rpc-plugin-process/dist/process/node-byte-stream.js', () => ({
      ...byteStreams,
      nodeByteStream: construct
    }))
    try {
      const { openProcessStdioChannel } =
        await import('@migaia/rpc-plugin-process/adapters/node-child-process')
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
        await import('../../../rpc-host/dist/core/internal/native-replay.js')
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
      construct.mockImplementationOnce(() =>
        byteStreams.nodeByteStream(failingReadable, failingWritable, () => {
          failingReadable.destroy()
          failingWritable.destroy()
        })
      )
      /** A separate public channel preserves the first channel's successful close contract. */
      const { channel: failingChannel } = await openProcessStdioChannel({ bootstrap: 'none' })
      await expect(failingChannel.write(new Uint8Array([6]))).rejects.toBe(writeFailure)
      await failingChannel.close()
    } finally {
      vi.doUnmock('../../../rpc-plugin-process/dist/process/node-byte-stream.js')
      readable.destroy()
      writable.destroy()
      failingReadable.destroy()
      failingWritable.destroy()
    }
  })
})
