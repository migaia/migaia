import { EventEmitter } from 'node:events'
import { Readable } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
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

/** Restore only the case-owned Electron boundary, environment keys, and native observer spies. */
afterEach(() => {
  runtime.ready = true
  runtime.fork = undefined
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('Electron utility process boundary without a platform fixture', () => {
  it('routes message and output events while keeping tree termination unsupported', async () => {
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

  it('rejects unsupported bootstrap and an unready app before fork', async () => {
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

  it('keeps a native fork failure reachable through PROCESS_CHANNEL_CONNECT_FAILED', async () => {
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

  it('preserves a native message error after launch ownership is handed off', async () => {
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

  it('closes a child that exits or errors before spawn', async () => {
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

  /** Ignored streams and an unsubscribed observer must have no output or late close effects. */
  it('preserves ignored streams, environment selection, and close-observer ownership', async () => {
    /** Only explicit inherited keys may enter the native constructor. */
    vi.stubEnv('MIGAIA_FIXTURE_PRESENT', 'ambient')
    vi.stubEnv('MIGAIA_FIXTURE_MISSING', undefined)
    /** Ignored native streams are absent rather than fake drained outputs. */
    const fake = child()
    Object.assign(fake.process, { stdout: null, stderr: null })
    /** Capture exact native stdio and environment selection before acquisition. */
    const forks: unknown[][] = []
    /** Publish spawn only after the real launcher has installed its startup event observers. */
    runtime.fork = (...args) => {
      forks.push(args)
      queueMicrotask(() => fake.process.emit('spawn'))
      return fake.process
    }
    /** An ignored stream must never dispatch an output callback. */
    const output = vi.fn()
    /** The actual native handle owns one exit observer independently from channel observers. */
    const handle = await createElectronUtilityProcessLauncher().launch(
      {
        ...spec(),
        env: {
          inherit: ['MIGAIA_FIXTURE_PRESENT', 'MIGAIA_FIXTURE_MISSING'],
          set: { MIGAIA_FIXTURE_PRESENT: 'selected' }
        },
        stdio: { stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' }
      },
      { signal: new AbortController().signal, output }
    )
    expect(forks).toEqual([
      [
        'child.js',
        ['arg'],
        {
          cwd: undefined,
          env: { MIGAIA_FIXTURE_PRESENT: 'selected' },
          stdio: ['ignore', 'ignore', 'ignore']
        }
      ]
    ])
    /** Removing a channel observer must leave the native exit promise observer intact. */
    const nativeObservers = fake.process.listenerCount('exit')
    /** No channel event is allowed after its exact unsubscribe operation. */
    const closed = vi.fn()
    /** This disposer removes only the observer registered by this subscription. */
    const leave = handle.channel.onClose(closed)
    expect(fake.process.listenerCount('exit')).toBe(nativeObservers + 1)
    leave()
    expect(fake.process.listenerCount('exit')).toBe(nativeObservers)
    handle.terminate('graceful')
    expect(await handle.exited).toEqual({ code: 0, signal: null })
    expect(closed).not.toHaveBeenCalled()
    expect(output).not.toHaveBeenCalled()
    expect(fake.killed).toBe(1)
    await handle.channel.close()
  })

  /** Unsupported stdin policy rejects before the optional native fork boundary is invoked. */
  it('rejects unsupported channel stdin before optional runtime acquisition', async () => {
    /** Native fork is unreachable when this adapter's declared stdin capability is violated. */
    const fork = vi.fn()
    runtime.fork = fork
    /** This invalid input is independent from the separately forbidden bootstrap field. */
    const rejected = createElectronUtilityProcessLauncher().launch(
      { ...spec(), stdio: { stdin: 'channel', stdout: 'ignore', stderr: 'ignore' } },
      { signal: new AbortController().signal, output: () => undefined }
    )
    await expect(rejected).rejects.toBeInstanceOf(TypeError)
    await expect(rejected).rejects.toMatchObject({ code: 'INVALID_CONFIG' })
    expect(fork).not.toHaveBeenCalled()
  })
})
