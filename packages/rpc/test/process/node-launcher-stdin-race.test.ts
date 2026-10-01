import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'

/** Owns one fake spawn result so stdin event order can be exercised without OS timing. */
const spawnMock = vi.hoisted(() => vi.fn())
vi.mock('node:child_process', () => ({ spawn: spawnMock }))

/** Models the three supported positions at which a child can close bootstrap stdin. */
type IStdinFailurePhase = 'before-spawn' | 'during-write' | 'after-write-callback'

/** Creates a child whose stdin error has a deterministic position around bootstrap writing. */
function childWithStdinFailure(
  phase: IStdinFailurePhase,
  groupFailure?: 'ESRCH' | 'EPERM'
): EventEmitter {
  const failure = Object.assign(new Error('broken pipe'), { code: 'EPIPE' })
  const stdin = Object.assign(new EventEmitter(), {
    write(_frame: Uint8Array, callback: (error?: Error) => void): void {
      if (phase === 'during-write') {
        stdin.emit('error', failure)
        callback(failure)
        if (groupFailure === 'ESRCH') queueMicrotask(() => child.emit('close', null, 'SIGKILL'))
        return
      }
      callback()
      if (phase === 'after-write-callback') stdin.emit('error', failure)
    },
    destroy: () => undefined
  })
  const child = Object.assign(new EventEmitter(), {
    stdin,
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    exitCode: null,
    signalCode: null,
    pid: groupFailure ? 777 : undefined,
    kill: () => {
      queueMicrotask(() => child.emit('close', null, 'SIGKILL'))
      return true
    }
  })
  queueMicrotask(() => {
    if (phase === 'before-spawn') stdin.emit('error', failure)
    child.emit('spawn')
  })
  return child
}

describe('Node bootstrap stdin race', () => {
  it.each<IStdinFailurePhase>(['before-spawn', 'during-write', 'after-write-callback'])(
    'maps an EPIPE at %s to CONNECT_FAILED without an unhandled stream error',
    async (phase) => {
      spawnMock.mockImplementationOnce(() => childWithStdinFailure(phase))
      const { createNodeProcessLauncher } =
        await import('../../src/process/adapters/node-child-process.js')
      await expect(
        createNodeProcessLauncher().launch(
          {
            command: process.execPath,
            args: [],
            env: { inherit: [], set: {} },
            stdio: { stdin: 'channel', stdout: 'channel', stderr: 'drain' },
            bootstrap: { via: 'stdin', payload: new Uint8Array([1]) }
          },
          { signal: new AbortController().signal, output: () => undefined }
        )
      ).rejects.toMatchObject({
        code: 'PROCESS_CHANNEL_CONNECT_FAILED',
        cause: failureShape()
      })
    }
  )

  it.each(['ESRCH', 'EPERM'] as const)(
    'handles %s from process-group termination during EPIPE cleanup',
    async (code) => {
      /** Makes the OS process-group result deterministic after the fake child departs. */
      const kill = vi.spyOn(process, 'kill').mockImplementation(() => {
        throw Object.assign(new Error('process group unavailable'), { code })
      })
      try {
        spawnMock.mockImplementationOnce(() => childWithStdinFailure('during-write', code))
        const { createNodeProcessLauncher } =
          await import('../../src/process/adapters/node-child-process.js')
        await expect(
          createNodeProcessLauncher().launch(
            {
              command: process.execPath,
              args: [],
              env: { inherit: [], set: {} },
              stdio: { stdin: 'channel', stdout: 'channel', stderr: 'drain' },
              bootstrap: { via: 'stdin', payload: new Uint8Array([1]) }
            },
            { signal: new AbortController().signal, output: () => undefined }
          )
        ).rejects.toMatchObject({ code: 'PROCESS_CHANNEL_CONNECT_FAILED' })
        expect(kill).toHaveBeenCalledWith(-777, 'SIGKILL')
      } finally {
        kill.mockRestore()
      }
    }
  )
})

/** Keeps the original EPIPE identity visible through the package error wrapper. */
function failureShape(): { code: string } {
  return { code: 'EPIPE' }
}
