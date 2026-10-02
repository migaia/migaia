import { describe, expect, it, vi } from 'vitest'
import { createServer, type Server } from 'node:net'
import { lstat, mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { listenProcessByteChannel } from '../../src/process/adapters/node-socket.js'

/** A separately owned listener never shares the predecessor's JS lifetime or socket inode. */
async function replacementListener(address: string): Promise<Server> {
  const server = createServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(address, resolve)
  })
  return server
}

/** Close the independent OS listener after observing the predecessor's native unlink effect. */
async function closeReplacement(server: Server | undefined): Promise<void> {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()))
}

describe.skipIf(process.platform === 'win32')('Node Unix listener close limitation', () => {
  it.each([
    [true, 'file'],
    [false, 'file'],
    [false, 'socket']
  ] as const)(
    '[K237/K200/A10] reports native removal of a successor once (managed=%s, successor=%s)',
    async (managed, kind) => {
      /** Short private fixture paths keep platform address limits separate from the unlink oracle. */
      const directory = await mkdtemp('/tmp/rpc-inode-')
      const address = join(directory, 's')
      const moved = join(directory, 'original')
      /** Existing PROCESS_CHANNEL_LISTEN_FAILED reports this accepted native limitation. */
      const report = vi.fn()
      const listener = await listenProcessByteChannel({
        address,
        ...(managed ? { serviceId: 'close-owner' } : {}),
        auth: { mode: 'required', verify: () => 'principal' },
        onConnection: (pending) => pending.close(),
        report
      })
      /** The successor is created by an independent owner while the predecessor still listens. */
      let successor: Server | undefined
      try {
        const original = await lstat(address)
        await rename(address, moved)
        if (kind === 'socket') successor = await replacementListener(address)
        else await writeFile(address, 'successor-owned-data')
        const before = await lstat(address)
        expect(before.ino).not.toBe(original.ino)
        await listener.close()
        /** Node/libuv deletes the replacement; this acceptance documents rather than masks it. */
        await expect(lstat(address)).rejects.toMatchObject({ code: 'ENOENT' })
        expect(report).toHaveBeenCalledTimes(1)
        expect(report.mock.calls[0]![0]).toMatchObject({
          source: '@migaia/rpc/process',
          code: 'PROCESS_CHANNEL_LISTEN_FAILED',
          cause: { code: 'ENOENT' }
        })
        await listener.close()
        await listener.close()
        expect(report).toHaveBeenCalledTimes(1)
        expect((await lstat(moved)).ino).toBe(original.ino)
        if (successor) expect(successor.listening).toBe(true)
      } finally {
        await listener.close()
        await closeReplacement(successor)
        await rm(directory, { recursive: true, force: true })
      }
    }
  )

  it.skipIf(process.platform !== 'darwin')(
    '[K237/A10] preserves the existing 104-byte Darwin path budget without staging',
    async () => {
      /** Construct the previously supported byte length, rather than a shorter temporary alias. */
      const directory = await mkdtemp('/tmp/rpc-path-')
      const parent = join(directory, 'x'.repeat(104 - Buffer.byteLength(directory) - 3))
      const address = join(parent, 's')
      const report = vi.fn()
      await mkdir(parent, { mode: 0o700 })
      try {
        expect(Buffer.byteLength(address)).toBe(104)
        const listener = await listenProcessByteChannel({
          address,
          auth: { mode: 'required', verify: () => 'principal' },
          onConnection: (pending) => pending.close(),
          report
        })
        expect((await lstat(address)).isSocket()).toBe(true)
        await listener.close()
        await expect(lstat(address)).rejects.toMatchObject({ code: 'ENOENT' })
        expect(report).not.toHaveBeenCalled()
      } finally {
        await rm(directory, { recursive: true, force: true })
      }
    }
  )
})
