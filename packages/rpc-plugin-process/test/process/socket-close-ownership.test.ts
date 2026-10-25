import { describe, expect, it, vi } from 'vitest'
import { createConnection, createServer, type Server } from 'node:net'
import { deferred } from '@migaia/utils/promise'
import { lstat, mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { listenProcessByteChannel } from '../../dist/process/adapters/node-socket.js'
import type { IProcessPendingByteConnection } from '../../dist/process/types.js'

/** Actual pending admission holds its native raw channel until listener cancellation wins. */
type ICloseFailureOperation = Readonly<{
  entered: ReturnType<typeof deferred<void>>
  release: ReturnType<typeof deferred<void>>
  failClose(): void
}>

/** The host's actual diagnostic task remains scheduled; only its expected fixture throw is received. */
type INativeDiagnosticObservation = Readonly<{
  expected: unknown
  schedule(callback: () => void): void
  observed: ReturnType<typeof deferred<void>>
  callbacks: (() => void)[]
}>

/** Preserve native scheduling and let every unrelated diagnostic continue to its original host. */
function enqueueObservedDiagnostic(
  callback: () => void,
  operation: INativeDiagnosticObservation
): void {
  operation.schedule(() => {
    try {
      callback()
    } catch (error) {
      if (error !== operation.expected) throw error
      operation.callbacks.push(callback)
      operation.observed.resolve()
    }
  })
}

/** Install the failure on the real raw lifecycle, without replacing socket or channel operations. */
function admitWithCloseFailure(
  pending: IProcessPendingByteConnection,
  operation: ICloseFailureOperation
): Promise<void> {
  return pending.accept(async (raw) => {
    raw.onClose(operation.failClose)
    operation.entered.resolve()
    await operation.release.promise
  })
}

it('removes listener cancellation and reports its original pending native cleanup failure', async () => {
  /** The caller signal outlives a failed close, so its exact listener must be removed. */
  const controller = new AbortController()
  /** Native subscription identities are observed without replacing AbortSignal behavior. */
  const add = vi.spyOn(controller.signal, 'addEventListener')
  const remove = vi.spyOn(controller.signal, 'removeEventListener')
  /** This actual raw-close callback failure must remain the listener close rejection. */
  const cleanup = new Error('pending native cleanup')
  /** Native socket termination also reports its cached failed close through the existing host queue. */
  const diagnostic: INativeDiagnosticObservation = {
    expected: cleanup,
    schedule: globalThis.queueMicrotask,
    observed: deferred<void>(),
    callbacks: []
  }
  /** This seam receives the expected scheduled throw without replacing the production reporter. */
  const queue = vi
    .spyOn(globalThis, 'queueMicrotask')
    .mockImplementation((callback) => enqueueObservedDiagnostic(callback, diagnostic))
  /** Real admission and its business wait belong only to this finite socket case. */
  const operation: ICloseFailureOperation = {
    entered: deferred<void>(),
    release: deferred<void>(),
    failClose: () => {
      throw cleanup
    }
  }
  /** Existing listener reporting observes detached cleanup rather than a new diagnostic channel. */
  const report = vi.fn()
  /** Only the original native socket acquisition supplies the pending raw channel. */
  const listener = await listenProcessByteChannel({
    address: 'tcp://127.0.0.1:0',
    signal: controller.signal,
    report,
    onConnection: (pending) => admitWithCloseFailure(pending, operation)
  })
  /** A real loopback peer reaches the same pending admission as an ordinary process connection. */
  const socket = createConnection({
    host: '127.0.0.1',
    port: Number(new URL(listener.address).port)
  })
  /** Restore the host seam only after this original native peer has really closed. */
  const socketClosed = deferred<void>()
  socket.once('close', () => socketClosed.resolve())
  socket.on('error', () => undefined)
  try {
    await operation.entered.promise
    /** This is the listener's original registered callback, not a synthetic abort subscriber. */
    const abort = add.mock.calls.find(([type]) => type === 'abort')![1]
    controller.abort()
    /** Signal shutdown and explicit close join the same original failed cleanup transaction. */
    const closing = listener.close()
    await expect(closing).rejects.toBe(cleanup)
    expect(listener.close()).toBe(closing)
    expect(remove).toHaveBeenCalledExactlyOnceWith('abort', abort)
    expect(report.mock.calls).toContainEqual([cleanup])
    await diagnostic.observed.promise
    expect(diagnostic.callbacks).toHaveLength(1)
    /** Explicit invocation proves that the original host task still throws the exact raw failure. */
    let reported: unknown
    try {
      diagnostic.callbacks[0]!()
    } catch (error) {
      reported = error
    }
    expect(reported).toBe(cleanup)
  } finally {
    operation.release.resolve()
    socket.destroy()
    await socketClosed.promise
    await listener.close().catch(() => undefined)
    queue.mockRestore()
    add.mockRestore()
    remove.mockRestore()
  }
})

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
    'reports native removal of a successor once (managed=%s, successor=%s)',
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
          source: 'rpc.transport.process',
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
    'preserves the existing 104-byte Darwin path budget without staging',
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
