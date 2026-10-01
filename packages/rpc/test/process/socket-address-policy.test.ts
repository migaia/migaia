import { describe, expect, it } from 'vitest'
import {
  dialProcessByteChannel,
  listenProcessByteChannel
} from '../../src/process/adapters/node-socket.js'
import {
  dialProcessByteChannel as dialDenoByteChannel,
  listenProcessByteChannel as listenDenoByteChannel
} from '../../src/process/adapters/deno-socket.js'

/** Named-pipe grammar is valid only for the Node Windows adapter. */
describe('process socket address policy', () => {
  it('[D7] rejects pipe syntax on POSIX and in Deno on every platform', async () => {
    const address = '\\\\.\\pipe\\rpc-test'
    if (process.platform !== 'win32') {
      await expect(dialProcessByteChannel({ address })).rejects.toMatchObject({
        code: 'INVALID_CONFIG'
      })
      await expect(
        listenProcessByteChannel({
          address,
          auth: { mode: 'required', verify: () => 'principal' },
          onConnection: () => undefined,
          report: () => undefined
        })
      ).rejects.toMatchObject({ code: 'INVALID_CONFIG' })
    }
    expect(() => dialDenoByteChannel({ address })).toThrowError(
      expect.objectContaining({ code: 'INVALID_CONFIG' })
    )
    expect(() =>
      listenDenoByteChannel({
        address,
        auth: { mode: 'required', verify: () => 'principal' },
        onConnection: () => undefined,
        report: () => undefined
      })
    ).toThrowError(expect.objectContaining({ code: 'INVALID_CONFIG' }))
  })
})
