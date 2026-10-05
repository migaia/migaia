import { EventEmitter } from 'node:events'
import { Readable } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import { createElectronUtilityProcessLauncher } from '../../src/process/adapters/electron-utility-process.js'

/** Mock only Electron's runtime boundary; the adapter code remains real. */
const runtime = vi.hoisted(() => ({
  ready: true,
  fork: undefined as undefined | ((path: string, args: string[], options: unknown) => unknown)
}))

vi.mock('electron', () => ({
  app: { isReady: () => runtime.ready },
  utilityProcess: {
    fork(path: string, args: string[], options: unknown) {
      if (!runtime.fork) throw new Error('fixture fork was not set')
      return runtime.fork(path, args, options)
    }
  }
}))

/** A whole-message child preserves the optional runtime's event ordering. */
function child() {
  /** The event emitter is the minimal utilityProcess process contract. */
  const events = new EventEmitter()
  /** Sent messages must reach the same channel without byte framing. */
  const sent: unknown[] = []
  /** A child exit is idempotent and settles the adapter's exited promise. */
  let killed = 0
  const process = Object.assign(events, {
    pid: 4242,
    stdout: Readable.from([Buffer.from('out')]),
    stderr: Readable.from([Buffer.from('err')]),
    postMessage(value: unknown) {
      sent.push(value)
    },
    kill() {
      killed++
      queueMicrotask(() => events.emit('exit', 0))
      return true
    }
  })
  return {
    process,
    sent,
    get killed() {
      return killed
    }
  }
}

/** The fixture never puts a bootstrap secret in process arguments or environment. */
function spec() {
  return {
    command: 'child.js',
    args: ['arg'],
    env: { inherit: [], set: { SAFE: 'yes' } },
    stdio: { stdin: 'ignore' as const, stdout: 'drain' as const, stderr: 'drain' as const }
  }
}

describe('Electron utility process boundary without a platform fixture', () => {
  it('[A9] routes message and output events while keeping tree termination unsupported', async () => {
    const fake = child()
    /** Observes only the explicit allowlisted fork inputs. */
    const forks: unknown[][] = []
    runtime.ready = true
    runtime.fork = (...args) => {
      forks.push(args)
      queueMicrotask(() => fake.process.emit('spawn'))
      return fake.process
    }
    /** Output stays on the supervisor callback, not an IPC log. */
    const output: string[] = []
    const handle = await createElectronUtilityProcessLauncher().launch(spec(), {
      signal: new AbortController().signal,
      output(stream, chunk) {
        output.push(`${stream}:${new TextDecoder().decode(chunk)}`)
      }
    })
    expect(forks).toEqual([
      ['child.js', ['arg'], expect.objectContaining({ env: { SAFE: 'yes' } })]
    ])
    const messages: unknown[] = []
    const leaveMessage = handle.channel.onMessage((value) => {
      messages.push(value)
    })
    fake.process.emit('message', { inbound: true })
    await handle.channel.send({ outbound: true })
    expect(messages).toEqual([{ inbound: true }])
    expect(fake.sent).toEqual([{ outbound: true }])
    leaveMessage()
    fake.process.emit('message', 'late')
    expect(messages).toHaveLength(1)
    const closed = new Promise<unknown>((resolve) => handle.channel.onClose(resolve))
    handle.terminate('force')
    expect(await closed).toMatchObject({ code: 'PROCESS_CHANNEL_CLOSED' })
    expect(await handle.exited).toEqual({ code: 0, signal: null })
    expect(output.sort()).toEqual(['stderr:err', 'stdout:out'])
    expect(fake.killed).toBe(1)
    await handle.channel.close()
    expect(() => handle.channel.send('late')).toThrowError(
      expect.objectContaining({
        code: 'PROCESS_CHANNEL_CLOSED'
      })
    )
  })

  it('[A9] rejects unsupported bootstrap and an unready app before fork', async () => {
    const launcher = createElectronUtilityProcessLauncher()
    const context = { signal: new AbortController().signal, output: () => undefined }
    runtime.fork = () => {
      throw new Error('must not fork')
    }
    await expect(
      launcher.launch(
        { ...spec(), bootstrap: { via: 'stdin', payload: new Uint8Array([1]) } },
        context
      )
    ).rejects.toMatchObject({ code: 'INVALID_CONFIG' })
    runtime.ready = false
    await expect(launcher.launch(spec(), context)).rejects.toMatchObject({ code: 'INVALID_CONFIG' })
    runtime.ready = true
  })

  it('[A9] keeps a native fork failure reachable through PROCESS_CHANNEL_CONNECT_FAILED', async () => {
    const failure = new Error('fork failed')
    runtime.ready = true
    runtime.fork = () => {
      throw failure
    }
    await expect(
      createElectronUtilityProcessLauncher().launch(spec(), {
        signal: new AbortController().signal,
        output: () => undefined
      })
    ).rejects.toMatchObject({ code: 'PROCESS_CHANNEL_CONNECT_FAILED', cause: failure })
  })

  it('[A9][A51] preserves a native message error after launch ownership is handed off', async () => {
    const fake = child()
    const failure = new Error('post failed')
    fake.process.postMessage = () => {
      throw failure
    }
    runtime.ready = true
    runtime.fork = () => {
      queueMicrotask(() => fake.process.emit('spawn'))
      return fake.process
    }
    const controller = new AbortController()
    const handle = await createElectronUtilityProcessLauncher().launch(spec(), {
      signal: controller.signal,
      output: () => undefined
    })
    expect(() => handle.channel.send('message')).toThrowError(
      expect.objectContaining({
        code: 'PROCESS_CHANNEL_CLOSED'
      })
    )
    expect(failure).toMatchObject({ code: 'PROCESS_CHANNEL_CLOSED' })
    controller.abort()
    expect(fake.killed).toBe(0)
    await handle.terminate('force')
    await handle.exited
    expect(fake.killed).toBe(1)
  })

  it('[A9] closes a child that exits or errors before spawn', async () => {
    const launcher = createElectronUtilityProcessLauncher()
    const context = { signal: new AbortController().signal, output: () => undefined }
    const earlyExit = child()
    runtime.fork = () => {
      queueMicrotask(() => earlyExit.process.emit('exit', 1))
      return earlyExit.process
    }
    await expect(launcher.launch(spec(), context)).rejects.toMatchObject({
      code: 'PROCESS_CHANNEL_CONNECT_FAILED'
    })
    expect(earlyExit.killed).toBe(1)
    const earlyError = child()
    const failure = new Error('spawn failed')
    runtime.fork = () => {
      queueMicrotask(() => earlyError.process.emit('error', failure))
      return earlyError.process
    }
    await expect(launcher.launch(spec(), context)).rejects.toMatchObject({
      code: 'PROCESS_CHANNEL_CONNECT_FAILED',
      cause: failure
    })
    expect(earlyError.killed).toBe(1)
  })
})
