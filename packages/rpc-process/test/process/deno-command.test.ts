import { afterEach, describe, expect, it, vi } from 'vitest'
import { RpcWireLimit } from '@migaia/rpc-contract'
import type { IRpcRuntimeGeneration } from '@migaia/rpc-contract'
import { encodeRpcStreamFrame } from '@migaia/rpc-contract/framing/stream'
import { RPC_CORE_ERROR_SOURCE, RpcCoreErrorCode } from '@migaia/rpc-core'
import { RpcProcessErrorCode, RPC_PROCESS_ERROR_SOURCE } from '@migaia/rpc-process'
import type { IProcessSpec } from '@migaia/supervision/process'
import {
  createDenoProcessLauncher,
  openProcessStdioChannel
} from '@migaia/rpc-process/adapters/deno-command'
import {
  PROCESS_RUNTIME_API_ENV,
  PROCESS_RUNTIME_API_ENV_VERSION
} from '../../src/process/constants.js'
import { decodeProcessRuntimeBootstrap } from '../../dist/process/runtime-bootstrap.js'

/** Only the native constructor inputs observed by this adapter fixture are retained. */
type ICommandOptions = {
  args: string[]
  cwd?: string
  clearEnv: boolean
  env: Record<string, string>
  stdin: string
  stdout: string
  stderr: string
}

/** Native exit settlement is controlled separately from bootstrap writing. */
type IExit = { code: number; signal: string | null }

/**
 * Model the Deno boundary with real Web Streams, not native Deno execution. Optional write and
 * spawn failures exercise acquisition; held exit and EOF let one case control cleanup ordering.
 * Returned observations and settlement functions belong only to that case.
 */
function denoFixture(
  options: {
    write?: (chunk: Uint8Array) => void | Promise<void>
    spawnFailure?: Error
    exitOnKill?: boolean
    stdout?: Uint8Array
    keepStdoutOpen?: boolean
    abort?: (reason: unknown) => void
    cancel?: () => void
  } = {}
) {
  /** Constructor observations prove environment and stdio policy before spawn. */
  const commands: { command: string; options: ICommandOptions }[] = []
  /** Writes retain their byte identity so bootstrap framing can be checked independently. */
  const writes: Uint8Array[] = []
  /** Native signals remain observable without sending any signal to a real process. */
  const signals: string[] = []
  /** Resolve native exit only when the fixture observes its intended lifecycle event. */
  let finish!: (exit: IExit) => void
  /** A failed startup must await this promise before rejecting its launch. */
  const status = new Promise<IExit>((resolve) => {
    finish = resolve
  })
  /** Cancellation observations do not depend on sleeps or repeated polling. */
  let announceKill!: () => void
  /** Waiting for kill identifies the exact point where cleanup has begun. */
  const killed = new Promise<void>((resolve) => {
    announceKill = resolve
  })
  /** The writable's real lock and rejected write exercise the native bootstrap owner. */
  const stdin = new WritableStream<Uint8Array>({
    /** Retain the exact bytes before applying caller-selected backpressure or write rejection. */
    write(chunk) {
      writes.push(chunk)
      return options.write?.(chunk)
    },
    /** Observe physical channel retirement without replacing its real writer. */
    abort(reason) {
      options.abort?.(reason)
    }
  })
  /** Queue one physical chunk; optionally hold EOF until the channel's own cleanup cancels it. */
  const readable = (bytes: Uint8Array, finish = true) =>
    new ReadableStream<Uint8Array>({
      /** Closed output drains settle independently; bootstrap input may remain open for business. */
      start(controller) {
        controller.enqueue(bytes)
        if (finish) controller.close()
      },
      /** Retain cancellation of an open channel independently from native process exit. */
      cancel() {
        options.cancel?.()
      }
    })
  /** Channel mode does not start this reader before a business receiver subscribes. */
  const stdout = readable(
    options.stdout ?? new TextEncoder().encode('out'),
    !options.keepStdoutOpen
  )
  /** Stderr is drained independently before a potentially blocked bootstrap write. */
  const stderr = readable(new TextEncoder().encode('err'))
  /** The fake child supplies exactly the native streams and exit promise the launcher owns. */
  const child = {
    pid: 4242,
    stdin,
    stdout,
    stderr,
    status,
    /** Record native termination and settle exit unless this case explicitly owns that boundary. */
    kill(signal: string) {
      signals.push(signal)
      announceKill()
      if (options.exitOnKill !== false) finish({ code: 0, signal })
    }
  }
  /** Ambient keys distinguish explicit inheritance, absence, and a caller override. */
  const ambient: Record<string, string> = { INHERITED: 'ambient', OVERRIDDEN: 'ambient' }
  vi.stubGlobal('Deno', {
    Command: class {
      /** Record native constructor arguments without running a command. */
      constructor(command: string, options: ICommandOptions) {
        commands.push({ command, options })
      }
      /** Native acquisition may fail with the original error before a child exists. */
      spawn() {
        if (options.spawnFailure) throw options.spawnFailure
        return child
      }
    },
    env: { get: (key: string) => ambient[key] },
    stdin: { readable: stdout },
    stdout: { writable: stdin }
  })
  return { commands, writes, signals, child, finish, killed }
}

/** Piped defaults are valid for both plain and opt-in runtime bootstrap launches. */
function spec(): IProcessSpec {
  return {
    command: 'fixture-child',
    args: ['fixture-argument'],
    cwd: '/fixture',
    env: { inherit: ['INHERITED', 'MISSING', 'OVERRIDDEN'], set: { OVERRIDDEN: 'selected' } },
    stdio: { stdin: 'channel', stdout: 'channel', stderr: 'drain' }
  }
}

/** Restore the host runtime and signal spies after each native-boundary case. */
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('Deno command native boundary', () => {
  /** Optional generation metadata must preserve the one bootstrap identity through native launch. */
  it.each<IRpcRuntimeGeneration | undefined>([
    undefined,
    { kind: 'restart', value: 3, providerId: 'fixture-provider' }
  ])('writes the exact bootstrap identity and optional generation %j', async (generation) => {
    /** One genuine native-boundary fixture retains the original first-frame bytes. */
    const fixture = denoFixture()
    /** Output stays separate from the secret-bearing protocol stream. */
    const output: string[] = []
    /** Opt-in bootstrap is the same secret used by the original supervised stdin path. */
    const token = 'fixture-bootstrap-token'
    /** The caller's argument array must not become native mutable state. */
    const request = {
      ...spec(),
      bootstrap: { via: 'stdin' as const, payload: new TextEncoder().encode(token) }
    }
    /** The sole bootstrap owner supplies identity before the native constructor executes. */
    const handle = await createDenoProcessLauncher({
      runtimeApiBootstrap: { name: 'fixture-child', parentInstanceId: 'fixture-parent', generation }
    }).launch(request, {
      signal: new AbortController().signal,
      output: (stream, chunk) => output.push(`${stream}:${new TextDecoder().decode(chunk)}`)
    })
    /** Strip only the native length header to inspect the canonical metadata payload. */
    const bootstrap = decodeProcessRuntimeBootstrap(fixture.writes[0]!.subarray(4))
    expect(fixture.writes[0]).toEqual(encodeRpcStreamFrame(fixture.writes[0]!.subarray(4)))
    expect(bootstrap).toMatchObject({ token, parentInstanceId: 'fixture-parent' })
    expect(bootstrap.self).toEqual(handle.runtimeApiIdentity)
    expect(bootstrap.generation).toEqual(generation)
    expect(handle.identity).toEqual({ fingerprint: bootstrap.self.instanceId, pid: 4242 })
    expect(fixture.commands).toEqual([
      {
        command: request.command,
        options: {
          args: request.args,
          cwd: request.cwd,
          clearEnv: true,
          env: {
            INHERITED: 'ambient',
            OVERRIDDEN: 'selected',
            [PROCESS_RUNTIME_API_ENV]: PROCESS_RUNTIME_API_ENV_VERSION
          },
          stdin: 'piped',
          stdout: 'piped',
          stderr: 'piped'
        }
      }
    ])
    expect(fixture.commands[0]!.options.args).not.toBe(request.args)
    expect(JSON.stringify(fixture.commands)).not.toContain(token)
    /** Successful launch transfers cancellation ownership away from this original request. */
    expect(handle.channel?.kind).toBe('byte')
    handle.terminate('graceful')
    expect(await handle.exited).toEqual({ code: 0, signal: 'SIGTERM' })
    expect(output).toEqual(['stderr:err'])
    expect(fixture.child.stderr.locked).toBe(false)
    expect(fixture.signals).toEqual(['SIGTERM'])
    await handle.channel!.close()
  })

  /** Plain nonduplex launch drains output before exit and releases startup cancellation ownership. */
  it('drains stdout and omits a channel when stdin is ignored', async () => {
    /** An ignored stdin cannot accidentally expose a duplex port. */
    const fixture = denoFixture()
    /** Native output is observed before exited resolves. */
    const output: string[] = []
    /** This signal belongs only to startup after native ownership is handed off. */
    const controller = new AbortController()
    /** Plain launches keep their native UUID fingerprint and carry no runtime identity. */
    const handle = await createDenoProcessLauncher().launch(
      { ...spec(), stdio: { stdin: 'ignore', stdout: 'drain', stderr: 'ignore' } },
      {
        signal: controller.signal,
        output: (stream, chunk) => output.push(`${stream}:${new TextDecoder().decode(chunk)}`)
      }
    )
    controller.abort()
    expect(fixture.signals).toEqual([])
    expect(handle.channel).toBeUndefined()
    expect(handle.runtimeApiIdentity).toBeUndefined()
    expect(handle.identity.fingerprint).toMatch(/^[0-9a-f-]{36}$/)
    expect(fixture.commands[0]!.options).toMatchObject({
      stdin: 'null',
      stdout: 'piped',
      stderr: 'null',
      env: { INHERITED: 'ambient', OVERRIDDEN: 'selected' }
    })
    expect(fixture.writes).toEqual([])
    fixture.finish({ code: 7, signal: null })
    expect(await handle.exited).toEqual({ code: 7, signal: null })
    expect(output).toEqual(['stdout:out'])
    expect(fixture.child.stdout.locked).toBe(false)
  })

  /** Legacy explicit bytes retain framing while ignored stdout prevents channel construction. */
  it('writes plain stdin bootstrap while ignored stdout remains unowned', async () => {
    /** A legacy explicit payload remains byte-for-byte framed without runtime metadata. */
    const fixture = denoFixture()
    /** Bootstrap bytes are one-off fixture data, not public protocol values. */
    const payload = new Uint8Array([1, 2, 3])
    /** Ignored stdout exercises the independent channel-admission check. */
    const handle = await createDenoProcessLauncher().launch(
      {
        ...spec(),
        stdio: { stdin: 'channel', stdout: 'ignore', stderr: 'ignore' },
        bootstrap: { via: 'stdin', payload }
      },
      { signal: new AbortController().signal, output: () => undefined }
    )
    expect(fixture.writes).toEqual([encodeRpcStreamFrame(payload)])
    expect(fixture.child.stdin.locked).toBe(false)
    expect(handle.channel).toBeUndefined()
    expect(fixture.commands[0]!.options.stdout).toBe('null')
    handle.terminate('force')
    expect(await handle.exited).toEqual({ code: 0, signal: 'SIGKILL' })
    expect(fixture.signals).toEqual(['SIGKILL'])
  })

  /** Native acquisition failure must remain the same reachable primary without child cleanup. */
  it('retains native spawn error identity on CONNECT_FAILED', async () => {
    /** The constructor boundary supplies a real native error without replacing the launcher. */
    const failure = new TypeError('fixture command acquisition failed')
    /** No physical child is acquired when spawn fails. */
    const fixture = denoFixture({ spawnFailure: failure })
    /** Observe rejection immediately; no later cleanup can hide the primary cause. */
    const rejected = createDenoProcessLauncher().launch(spec(), {
      signal: new AbortController().signal,
      output: () => undefined
    })
    await expect(rejected).rejects.toMatchObject({
      source: RPC_PROCESS_ERROR_SOURCE,
      code: RpcProcessErrorCode.connectFailed,
      cause: failure
    })
    /** Successful acquisition would make this failure contract false. */
    const error = await rejected.then(
      () => undefined,
      (error: Error) => error
    )
    expect(error?.cause).toBe(failure)
    expect(fixture.signals).toEqual([])
    expect(fixture.writes).toEqual([])
  })

  /** Bootstrap rejection starts force cleanup but cannot settle before native exit completes. */
  it('releases a failed bootstrap writer and awaits native exit before rejecting', async () => {
    /** A real WritableStream write rejection retains its exact native error. */
    const failure = new Error('fixture stdin write failed')
    /** Exit remains held so cleanup ordering is observable. */
    const fixture = denoFixture({ write: () => Promise.reject(failure), exitOnKill: false })
    /** Settlement is watched independently from the kill event. */
    let settled = false
    /** Awaiting the handled rejection avoids an unhandled native write failure. */
    const outcome = createDenoProcessLauncher()
      .launch(
        { ...spec(), bootstrap: { via: 'stdin', payload: new Uint8Array([1]) } },
        { signal: new AbortController().signal, output: () => undefined }
      )
      .then(
        /** A fulfilled native launch contradicts this case's injected stream failure. */
        () => {
          throw new Error('fixture bootstrap write unexpectedly succeeded')
        },
        /** Observe settlement only after the launcher's original native-exit cleanup has finished. */
        (error: Error) => {
          settled = true
          return error
        }
      )
    await fixture.killed
    expect(fixture.signals).toEqual(['SIGKILL'])
    expect(fixture.child.stdin.locked).toBe(false)
    expect(settled).toBe(false)
    fixture.finish({ code: 1, signal: 'SIGKILL' })
    /** Cleanup completion does not replace the original write error. */
    const error = await outcome
    expect(error).toMatchObject({
      source: RPC_PROCESS_ERROR_SOURCE,
      code: RpcProcessErrorCode.connectFailed
    })
    expect(error.cause).toBe(failure)
  })

  /** Cancellation while the physical writer is held preserves reason identity and observer cleanup. */
  it('kills a cancelled startup and detaches its observer after native exit', async () => {
    /** Hold the native writer until cancellation has happened. */
    let releaseWrite!: () => void
    /** The real stream supplies backpressure rather than a fabricated launch promise. */
    const writing = new Promise<void>((resolve) => {
      releaseWrite = resolve
    })
    /** A write event makes the cancellation point deterministic. */
    let announceWrite!: () => void
    /** No wall clock is involved in observing the in-progress bootstrap. */
    const started = new Promise<void>((resolve) => {
      announceWrite = resolve
    })
    /** This native child is still owned by the launch request. */
    const fixture = denoFixture({
      /** Signal the actual stream write, then keep native backpressure until the case releases it. */
      write: () => {
        announceWrite()
        return writing
      }
    })
    /** Abort reason identity must survive failed startup rollback. */
    const reason = new Error('fixture startup cancelled')
    /** The signal observer is tracked on the actual native AbortSignal. */
    const controller = new AbortController()
    /** Restored after this case; only this signal's removal operations are observed. */
    const remove = vi.spyOn(controller.signal, 'removeEventListener')
    /** This rejected launch stays handled while the write is held. */
    const outcome = createDenoProcessLauncher()
      .launch(
        {
          ...spec(),
          stdio: { stdin: 'channel', stdout: 'ignore', stderr: 'ignore' },
          bootstrap: { via: 'stdin', payload: new Uint8Array([1]) }
        },
        { signal: controller.signal, output: () => undefined }
      )
      .then(
        /** A fulfilled launch would violate cancellation after native acquisition began. */
        () => {
          throw new Error('fixture cancelled startup unexpectedly succeeded')
        },
        (error: Error) => error
      )
    await started
    controller.abort(reason)
    await fixture.killed
    releaseWrite()
    /** The abort reason survives the native launcher error wrapper. */
    const error = await outcome
    expect(error).toMatchObject({ code: RpcProcessErrorCode.connectFailed })
    expect(error.cause).toBe(reason)
    expect(fixture.signals).toEqual(['SIGKILL', 'SIGKILL'])
    expect(fixture.child.stdin.locked).toBe(false)
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function))
  })

  /** Post-bootstrap cancellation must retire the constructed channel before rejecting launch. */
  it('closes the channel once when cancellation follows bootstrap writer release', async () => {
    /** Physical stream cleanup proves the real constructed channel retires exactly once. */
    const abort = vi.fn()
    /** An open stdout makes its cancellation observable rather than conflating it with EOF. */
    const cancel = vi.fn()
    /** Channel construction still uses the native stream locks and the existing byte adapter. */
    const fixture = denoFixture({ keepStdoutOpen: true, abort, cancel })
    /** The original native cancellation type and instance must survive CONNECT_FAILED. */
    const reason = new DOMException('fixture post-bootstrap cancellation', 'AbortError')
    /** Cancellation belongs to this startup request until activation transfers ownership. */
    const controller = new AbortController()
    /** The first real writer is the bootstrap writer; the channel acquires its own next writer. */
    const bootstrapWriter = fixture.child.stdin.getWriter()
    vi.spyOn(fixture.child.stdin, 'getWriter').mockReturnValueOnce(bootstrapWriter)
    vi.spyOn(bootstrapWriter, 'releaseLock').mockImplementation(() => {
      /** Release the native bootstrap lock before aborting at the precise activation boundary. */
      Reflect.apply(WritableStreamDefaultWriter.prototype.releaseLock, bootstrapWriter, [])
      controller.abort(reason)
    })
    /** Constructing the stdout reader distinguishes this case from cancellation before spawn. */
    const getReader = vi.spyOn(fixture.child.stdout, 'getReader')
    /** Handle rejection immediately while native rollback awaits its exit and stream cleanup. */
    const error = await createDenoProcessLauncher()
      .launch(
        { ...spec(), bootstrap: { via: 'stdin', payload: new Uint8Array([1]) } },
        { signal: controller.signal, output: () => undefined }
      )
      .then(
        () => undefined,
        (error: Error) => error
      )
    expect(error).toMatchObject({
      source: RPC_PROCESS_ERROR_SOURCE,
      code: RpcProcessErrorCode.connectFailed
    })
    expect(error?.cause).toBe(reason)
    expect(error?.cause).toBeInstanceOf(DOMException)
    expect(error?.cause).toMatchObject({ name: 'AbortError' })
    expect(fixture.writes).toEqual([encodeRpcStreamFrame(new Uint8Array([1]))])
    expect(getReader).toHaveBeenCalledOnce()
    expect(cancel).toHaveBeenCalledOnce()
    expect(abort).toHaveBeenCalledOnce()
    expect(fixture.signals).toEqual(['SIGKILL', 'SIGKILL'])
  })

  /** Canonical metadata rejection must happen before acquiring any native child or writer. */
  it.each([
    { name: '', parentInstanceId: 'parent', token: new Uint8Array([1]) },
    { name: 'child', parentInstanceId: '', token: new Uint8Array([1]) },
    {
      name: 'child'.repeat(RpcWireLimit.maxIdentifierChars),
      parentInstanceId: 'parent',
      token: new Uint8Array([1])
    },
    { name: 'child', parentInstanceId: 'parent', token: new Uint8Array([0xc0]) },
    { name: 'child', parentInstanceId: 'parent', token: new Uint8Array() }
  ])(
    'rejects invalid bootstrap metadata before native spawn: %j',
    async ({ name, parentInstanceId, token }) => {
      /** Invalid input must not acquire a native child or retain its secret-bearing bytes. */
      const fixture = denoFixture()
      /** The public launcher admits bootstrap through the same canonical metadata grammar. */
      const rejected = createDenoProcessLauncher({
        runtimeApiBootstrap: { name, parentInstanceId }
      }).launch(
        { ...spec(), bootstrap: { via: 'stdin', payload: token } },
        { signal: new AbortController().signal, output: () => undefined }
      )
      await expect(rejected).rejects.toMatchObject({
        source: RPC_CORE_ERROR_SOURCE,
        code: RpcCoreErrorCode.invalidConfig
      })
      expect(fixture.commands).toEqual([])
      expect(fixture.writes).toEqual([])
    }
  )

  /** Unsupported runtime and fd inputs keep native configuration errors without spawn effects. */
  it('rejects absent Deno and unsupported bootstrap fd before native acquisition', async () => {
    /** Deno absence is a supported invocation failure from an ordinary Node host. */
    vi.stubGlobal('Deno', undefined)
    await expect(
      createDenoProcessLauncher().launch(spec(), {
        signal: new AbortController().signal,
        output: () => undefined
      })
    ).rejects.toBeInstanceOf(TypeError)
    /** A present runtime still cannot turn its unsupported fd capability into a native spawn. */
    const fixture = denoFixture()
    await expect(
      createDenoProcessLauncher().launch(
        { ...spec(), bootstrap: { via: 'fd', fd: 3, payload: new Uint8Array([1]) } },
        { signal: new AbortController().signal, output: () => undefined }
      )
    ).rejects.toMatchObject({ code: RpcCoreErrorCode.invalidConfig })
    expect(() => openProcessStdioChannel({ bootstrap: 'fd', fd: 3 })).toThrowError(
      expect.objectContaining({ code: RpcCoreErrorCode.invalidConfig })
    )
    expect(fixture.commands).toEqual([])
  })

  /** The optional first-frame read hands off the same byte channel for subsequent writes. */
  it.each(['none', 'stdin'] as const)('opens child stdio with bootstrap %s', async (bootstrap) => {
    /** A child reads the original first frame only when bootstrap is explicitly enabled. */
    const payload = new Uint8Array([4, 5, 6])
    /** The runtime stdin is a real framed readable on this native-boundary fixture. */
    const fixture = denoFixture({ stdout: encodeRpcStreamFrame(payload), keepStdoutOpen: true })
    /** Bootstrap acquisition returns one physical byte channel, not a second reader. */
    const opened = await openProcessStdioChannel({ bootstrap })
    expect(opened.bootstrap).toEqual(bootstrap === 'stdin' ? payload : undefined)
    expect(opened.channel.kind).toBe('byte')
    /** Outbound bytes are unmodified after the bootstrap reader is handed off. */
    const outgoing = new Uint8Array([7, 8])
    await opened.channel.write(outgoing)
    expect(fixture.writes).toEqual([outgoing])
    await opened.channel.close()
  })
})
