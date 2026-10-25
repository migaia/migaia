/** Acquire native Deno child streams and exit facts; Session and supervision own higher policy. */
import { RPC_PROCESS_ERROR_SOURCE } from '@migaia/rpc-contract/error-code'
import { createProcessError } from '../error.js'
import { IpcReporterContext } from '@migaia/rpc-host/sdk'
import { attachErrorIdentity } from '@migaia/utils/error'
import { hostRethrowReporter } from '@migaia/utils/promise'
import { CapabilityLevel, StandardCapability, type TerminationMode } from '@migaia/supervision'
import { sampleNativeProcess } from './native-usage.js'
import {
  ProcessCapability,
  type IProcessHandle,
  type IProcessLauncher
} from '@migaia/supervision/process'
import { encodeRpcStreamFrame } from '@migaia/rpc-host/sdk'
import { RPC_ENDPOINT_ERROR_SOURCE, RpcCoreErrorCode } from '@migaia/rpc-contract/error-code'
import { receiveAdapterBootstrap } from '../bootstrap.js'
import { RpcProcessErrorCode } from '@migaia/rpc-contract/error-code'

import { RpcProcessErrorText } from '../error-text.js'
import type { IProcessByteChannel } from '../types.js'
import type { IRpcMemberIdentity } from '@migaia/rpc-host/sdk'
import { createAdapterProcessLaunch } from '../launch.js'
import { createAdapterWebByteIO } from '../web-byte-stream.js'
import type { IProcessRuntimeBootstrapOptions } from '../runtime-bootstrap.js'
import { PROCESS_RUNTIME_API_ENV, PROCESS_RUNTIME_API_ENV_VERSION } from '../constants.js'

/** Only the Deno APIs used by this deep adapter are typed here. */
type IDenoChild = Readonly<{
  pid: number
  stdin: WritableStream<Uint8Array>
  stdout: ReadableStream<Uint8Array>
  stderr: ReadableStream<Uint8Array>
  status: Promise<Readonly<{ code: number; signal: string | null }>>
  kill(signal: string): void
}>

/** Deno Command's constructor and standard streams are runtime-owned. */
type IDenoRuntime = Readonly<{
  Command: new (
    command: string,
    options: Readonly<{
      args: string[]
      cwd?: string
      clearEnv: boolean
      env: Record<string, string>
      stdin: 'piped' | 'null'
      stdout: 'piped' | 'null'
      stderr: 'piped' | 'null'
    }>
  ) => Readonly<{ spawn(): IDenoChild }>
  env: Readonly<{ get(key: string): string | undefined }>
  stdin: Readonly<{ readable: ReadableStream<Uint8Array> }>
  stdout: Readonly<{ writable: WritableStream<Uint8Array> }>
}>

/** Deno has a real process boundary but no proven whole-tree termination here. */
const DENO_CAPABILITIES = Object.freeze({
  [StandardCapability.termination]: CapabilityLevel.unsupported,
  [StandardCapability.faultIsolation]: CapabilityLevel.enforced,
  [ProcessCapability.memoryLimit]: CapabilityLevel.unsupported,
  [ProcessCapability.cpuTimeLimit]: CapabilityLevel.unsupported,
  [ProcessCapability.permissions]: CapabilityLevel.unsupported,
  [ProcessCapability.bootstrapStdin]: CapabilityLevel.enforced,
  [ProcessCapability.bootstrapFd]: CapabilityLevel.unsupported
})

/** Resolve the native API only when this Deno deep path is actually invoked. */
function denoRuntime(): IDenoRuntime {
  const runtime: unknown = Reflect.get(globalThis, 'Deno')
  if (!runtime || typeof runtime !== 'object' || !('Command' in runtime))
    throw attachErrorIdentity(new TypeError(RpcProcessErrorText.optionsInvalid), {
      source: RPC_ENDPOINT_ERROR_SOURCE,
      code: RpcCoreErrorCode.invalidConfig
    })
  return runtime as IDenoRuntime
}

/** Drain one output stream from spawn to EOF without retaining secret bytes. */
async function drain(
  stream: ReadableStream<Uint8Array>,
  output: (chunk: Uint8Array) => void
): Promise<void> {
  const reader = stream.getReader()
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) return
      try {
        output(next.value)
      } catch (error) {
        hostRethrowReporter(error, IpcReporterContext)
      }
    }
  } finally {
    reader.releaseLock()
  }
}

/** One Deno child exposes its byte port only when both directions were piped. */
export type IDenoProcessHandle = IProcessHandle &
  Readonly<{
    /** Present only when both standard-input and standard-output directions are channels. */
    channel?: IProcessByteChannel
    /** Safe runtime identity present only when the original launch prepared runtime bootstrap. */
    runtimeApiIdentity?: IRpcMemberIdentity
  }>

/**
 * Create a lazy Deno.Command launcher with explicit environment inheritance and early output drain.
 * Invocation requires Deno's native API and applicable permissions; factory construction does not
 * spawn. Only stdin bootstrap is supported, and whole-tree termination is advertised unsupported.
 * Native spawn failures are retained as causes of PROCESS_CHANNEL_CONNECT_FAILED.
 */
/** Allocate one native generation's original launch receipts without opening a second supervisor. */
function denoProcessGenerationState(
  child: IDenoChild,
  spec: Parameters<IProcessLauncher<IDenoProcessHandle>['launch']>[0],
  context: Parameters<IProcessLauncher<IDenoProcessHandle>['launch']>[1],
  launch: ReturnType<typeof createAdapterProcessLaunch>,
  runtimeBootstrap: ReturnType<typeof createAdapterProcessLaunch>['bootstrap']
) {
  /** Stderr reads start before a potentially blocked bootstrap write. */
  const stderrDrain =
    spec.stdio.stderr === 'drain'
      ? drain(child.stderr, (chunk) => context.output('stderr', chunk))
      : Promise.resolve()
  /** Configured stdout draining must settle before the native process exit receipt is published. */
  const stdoutDrain =
    spec.stdio.stdout === 'drain'
      ? drain(child.stdout, (chunk) => context.output('stdout', chunk))
      : Promise.resolve()
  /**
   * One shared terminal Promise preserves native exit identity for every observer of this
   * generation.
   */
  const exited = child.status.then(async (status) => {
    await Promise.all([stderrDrain, stdoutDrain])
    return { code: status.code, signal: status.signal }
  })

  /** Until activation succeeds, rollback owns any newly acquired Web channel. */
  const channel = undefined as IProcessByteChannel | undefined
  return {
    stderrDrain,
    stdoutDrain,
    exited,
    channel,
    child,
    spec,
    context,
    launch,
    runtimeBootstrap
  }
}

/** Own one actual native process generation from post-spawn acquisition through supervised handoff. */
class DenoProcessGeneration {
  /** Raw process, bootstrap and cleanup observations belong only to this launched generation. */
  #state: ReturnType<typeof denoProcessGenerationState>
  /** Attach output/failure/cancellation observers in their original post-spawn order. */
  constructor(
    child: IDenoChild,
    spec: Parameters<IProcessLauncher<IDenoProcessHandle>['launch']>[0],
    context: Parameters<IProcessLauncher<IDenoProcessHandle>['launch']>[1],
    launch: ReturnType<typeof createAdapterProcessLaunch>,
    runtimeBootstrap: ReturnType<typeof createAdapterProcessLaunch>['bootstrap']
  ) {
    this.#state = denoProcessGenerationState(child, spec, context, launch, runtimeBootstrap)
    this.#state.context.signal.addEventListener('abort', this.#onAbort, { once: true })
    void this.#state.exited.then(
      () => this.#state.context.signal.removeEventListener('abort', this.#onAbort),
      () => this.#state.context.signal.removeEventListener('abort', this.#onAbort)
    )
  }
  /**
   * Finish the original startup transaction, preserving native primary failures and rollback
   * ordering.
   */
  async open(): Promise<IDenoProcessHandle> {
    try {
      if (this.#state.spec.bootstrap?.via === 'stdin') {
        const writer = this.#state.child.stdin.getWriter()
        try {
          await writer.write(
            encodeRpcStreamFrame(
              this.#state.runtimeBootstrap?.payload ?? this.#state.spec.bootstrap.payload
            )
          )
        } finally {
          writer.releaseLock()
        }
      }
      /** Each physical stream is consumed by either channel or output, never both. */
      this.#state.channel =
        this.#state.spec.stdio.stdin === 'channel' && this.#state.spec.stdio.stdout === 'channel'
          ? this.#state.launch.createWebChannel(this.#state.child.stdout, this.#state.child.stdin)
          : undefined
      this.#state.launch.assertActive()
      /** Startup cancellation must not bypass graceful retirement after the handle is adopted. */
      this.#state.context.signal.removeEventListener('abort', this.#onAbort)
      return Object.freeze({
        identity: Object.freeze({
          fingerprint: this.#state.runtimeBootstrap?.self.instanceId ?? crypto.randomUUID(),
          pid: this.#state.child.pid
        }),
        exited: this.#state.exited,
        channel: this.#state.channel,
        sampleUsage: () => sampleNativeProcess(this.#state.child.pid),
        ...(this.#state.runtimeBootstrap
          ? { runtimeApiIdentity: this.#state.runtimeBootstrap.self }
          : {}),
        terminate: this.#terminate
      })
    } catch (error) {
      this.#terminate('force')
      try {
        await this.#state.channel?.close()
      } catch (closeError) {
        /** Report cleanup failure without replacing the original launch cancellation cause. */
        hostRethrowReporter(closeError, IpcReporterContext)
      }
      await this.#state.exited
      throw ((originalCause: unknown) =>
        attachErrorIdentity(
          new Error(
            RpcProcessErrorText.connectFailed,
            originalCause === undefined ? undefined : { cause: originalCause }
          ),
          { source: RPC_PROCESS_ERROR_SOURCE, code: RpcProcessErrorCode.connectFailed }
        ))(error)
    }
  }
  /** Preserve this generation's original native callback and its cleanup identity. */
  #terminate = (mode: TerminationMode): void => {
    try {
      this.#state.child.kill(mode === 'force' ? 'SIGKILL' : 'SIGTERM')
    } catch (error) {
      hostRethrowReporter(error, IpcReporterContext)
    }
  }
  /** Preserve this generation's original native callback and its cleanup identity. */
  #onAbort = (): void => this.#terminate('force')
}

export function createDenoProcessLauncher(
  options: Readonly<{ runtimeApiBootstrap?: IProcessRuntimeBootstrapOptions }> = {}
): IProcessLauncher<IDenoProcessHandle> {
  return Object.freeze({
    capabilities: DENO_CAPABILITIES,
    async launch(spec, context) {
      /** Core prepares this actual supervised launch before any native spawn or secret write. */
      const launch = createAdapterProcessLaunch(spec, context, options)
      /** The sole prepared identity and bytes remain the exact native bootstrap material. */
      const runtimeBootstrap = launch.bootstrap
      const runtime = denoRuntime()
      /** Clearing the ambient environment precedes the caller's selected keys. */
      const env: Record<string, string> = {}
      for (const key of spec.env.inherit) {
        const value = runtime.env.get(key)
        if (value !== undefined) env[key] = value
      }
      Object.assign(env, spec.env.set)
      if (runtimeBootstrap) env[PROCESS_RUNTIME_API_ENV] = PROCESS_RUNTIME_API_ENV_VERSION
      /** Deno has no supported dedicated bootstrap fd in this adapter. */
      if (spec.bootstrap?.via === 'fd')
        throw attachErrorIdentity(new TypeError(RpcProcessErrorText.optionsInvalid), {
          source: RPC_ENDPOINT_ERROR_SOURCE,
          code: RpcCoreErrorCode.invalidConfig
        })
      let child: IDenoChild
      try {
        child = new runtime.Command(spec.command, {
          args: [...spec.args],
          cwd: spec.cwd,
          clearEnv: true,
          env,
          stdin: spec.stdio.stdin === 'channel' ? 'piped' : 'null',
          stdout: spec.stdio.stdout === 'ignore' ? 'null' : 'piped',
          stderr: spec.stdio.stderr === 'ignore' ? 'null' : 'piped'
        }).spawn()
      } catch (error) {
        throw createProcessError(RpcProcessErrorCode.connectFailed, error)
      }
      /** One generation owns all post-spawn callbacks and the exact original native exit receipt. */
      return new DenoProcessGeneration(child, spec, context, launch, runtimeBootstrap).open()
    }
  })
}

/**
 * Open Deno's current standard streams and optionally read one stdin bootstrap using the decoder
 * later handed to handshake. 'none' skips that read; 'fd' rejects INVALID_CONFIG. The caller owns
 * the returned channel and must not independently acquire readers/writers on these same streams.
 */
export function openProcessStdioChannel(
  options: Readonly<{
    /** Required bootstrap selection; fd is declared for the common shape but unsupported here. */
    bootstrap: 'stdin' | 'fd' | 'none'
    /** Reserved fd selection, currently rejected rather than opened. */
    fd?: number
    /** Optional finite nonnegative first-frame deadline; omission installs no bootstrap timer. */
    bootstrapTimeoutMs?: number
  }>
): Promise<Readonly<{ channel: IProcessByteChannel; bootstrap?: Uint8Array }>> {
  if (options.bootstrap === 'fd')
    throw attachErrorIdentity(new TypeError(RpcProcessErrorText.optionsInvalid), {
      source: RPC_ENDPOINT_ERROR_SOURCE,
      code: RpcCoreErrorCode.invalidConfig
    })
  const runtime = denoRuntime()
  /** Until activation succeeds, rollback owns any newly acquired Web channel. */
  const channel = createAdapterWebByteIO(runtime.stdin.readable, runtime.stdout.writable)
  return receiveAdapterBootstrap(channel, options.bootstrap, options)
}
