/** Acquire one native child generation; bootstrap, process streams and exit remain native-owned. */
import { IpcReporterContext } from '@migaia/rpc-host/sdk'
import { createProcessError, tagNativeProcessError } from '../error.js'
import { attachErrorIdentity } from '@migaia/utils/error'
import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { encodeRpcStreamFrame } from '@migaia/rpc-host/sdk'
import { RPC_ENDPOINT_ERROR_SOURCE, RpcCoreErrorCode } from '@migaia/rpc-contract/error-code'
import { deferred, hostRethrowReporter } from '@migaia/utils/promise'
import { CapabilityLevel, StandardCapability, type TerminationMode } from '@migaia/supervision'
import {
  ProcessCapability,
  type IProcessHandle,
  type IProcessLauncher
} from '@migaia/supervision/process'
import { receiveAdapterBootstrap } from '../bootstrap.js'
import { RpcProcessErrorCode } from '@migaia/rpc-contract/error-code'

import { RpcProcessErrorText } from '../error-text.js'
import type { IProcessByteChannel } from '../types.js'
import type { IRpcMemberIdentity } from '@migaia/rpc-host/sdk'
import { createAdapterNodeProcessLaunch } from '../node-launch.js'
import type { IProcessRuntimeBootstrapOptions } from '../runtime-bootstrap.js'
import { PROCESS_RUNTIME_API_ENV, PROCESS_RUNTIME_API_ENV_VERSION } from '../constants.js'
import { createAdapterProcessStdio, type IAdapterChildStdio } from '../node-io.js'
import { sampleNativeProcess } from './native-usage.js'

/** A Node handle exposes stdout/stdin only when the specification chose byte channels. */
export type INodeProcessHandle = IProcessHandle &
  Readonly<{
    /** Present only when stdin and stdout were both configured as channels. */
    channel?: IProcessByteChannel
    /** Safe launch identity emitted only for the opted-in runtime bootstrap. */
    runtimeApiIdentity?: IRpcMemberIdentity
  }>

/** Node does not claim tree termination until the POSIX grandchild fixture proves it. */
const NODE_CAPABILITIES = Object.freeze({
  [StandardCapability.termination]: CapabilityLevel.unsupported,
  [StandardCapability.faultIsolation]: CapabilityLevel.enforced,
  [ProcessCapability.memoryLimit]: CapabilityLevel.unsupported,
  [ProcessCapability.cpuTimeLimit]: CapabilityLevel.unsupported,
  [ProcessCapability.permissions]: CapabilityLevel.unsupported,
  [ProcessCapability.bootstrapStdin]: CapabilityLevel.enforced,
  [ProcessCapability.bootstrapFd]: CapabilityLevel.unsupported
})

/** A child output callback is host-owned; reporter failure must stay observable. */
function deliverOutput(
  output: (stream: 'stdout' | 'stderr', chunk: Uint8Array) => void,
  stream: 'stdout' | 'stderr',
  chunk: Uint8Array
): void {
  try {
    output(stream, chunk)
  } catch (error) {
    hostRethrowReporter(error, IpcReporterContext)
  }
}

/** Signal the detached POSIX process group so grandchildren share the termination boundary. */
function terminateChild(child: ChildProcess, mode: TerminationMode): void {
  if (child.exitCode !== null || child.signalCode !== null) return
  /** Windows lacks this process-group guarantee and keeps the capability unsupported. */
  const signal = mode === 'force' ? 'SIGKILL' : 'SIGTERM'
  try {
    if (process.platform === 'win32' || child.pid === undefined) child.kill(signal)
    else process.kill(-child.pid, signal)
  } catch (error) {
    /** A sandbox may forbid group signalling; this launcher advertises termination unsupported. */
    if (error && typeof error === 'object' && 'code' in error && error.code === 'EPERM') {
      child.kill(signal)
      return
    }
    if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ESRCH'))
      hostRethrowReporter(error, IpcReporterContext)
  }
}

/**
 * Create a reusable shell-free Node launcher; construction itself does not spawn. Each launch uses
 * the specification's environment allowlist and drains selected output before writing bootstrap.
 * The supervisor owns termination after adoption; advertised tree termination remains unsupported.
 * Native spawn/bootstrap failures reject with PROCESS_CHANNEL_CONNECT_FAILED and reachable cause.
 */
/** Allocate one native generation's original launch receipts without opening a second supervisor. */
function nodeProcessGenerationState(
  child: ReturnType<typeof spawn>,
  spec: Parameters<IProcessLauncher<INodeProcessHandle>['launch']>[0],
  context: Parameters<IProcessLauncher<INodeProcessHandle>['launch']>[1],
  launch: ReturnType<typeof createAdapterNodeProcessLaunch>,
  runtimeBootstrap: ReturnType<typeof createAdapterNodeProcessLaunch>['bootstrap']
) {
  /** Node emits EPIPE on stdin independently of the bootstrap write callback. */
  const stdinFailure = undefined as Error | undefined
  /** A pending bootstrap must reject when the child closes stdin early. */
  const rejectBootstrap = undefined as ((error: Error) => void) | undefined
  /** The handle settles only after Node closes all child stdio descriptors. */
  const exited = undefined as unknown as Promise<{ code: number | null; signal: string | null }>
  return { stdinFailure, rejectBootstrap, exited, child, spec, context, launch, runtimeBootstrap }
}

/** Own one actual native process generation from post-spawn acquisition through supervised handoff. */
class NodeProcessGeneration {
  /** Raw process, bootstrap and cleanup observations belong only to this launched generation. */
  #state: ReturnType<typeof nodeProcessGenerationState>
  /** Attach output/failure/cancellation observers in their original post-spawn order. */
  constructor(
    child: ReturnType<typeof spawn>,
    spec: Parameters<IProcessLauncher<INodeProcessHandle>['launch']>[0],
    context: Parameters<IProcessLauncher<INodeProcessHandle>['launch']>[1],
    launch: ReturnType<typeof createAdapterNodeProcessLaunch>,
    runtimeBootstrap: ReturnType<typeof createAdapterNodeProcessLaunch>['bootstrap']
  ) {
    this.#state = nodeProcessGenerationState(child, spec, context, launch, runtimeBootstrap)
    this.#state.child.stdin?.on('error', this.#onStdinError)
    if (this.#state.child.stderr)
      this.#state.child.stderr.on('data', (chunk: Buffer) =>
        deliverOutput(this.#state.context.output, 'stderr', chunk)
      )
    if (this.#state.spec.stdio.stdout === 'drain' && this.#state.child.stdout)
      this.#state.child.stdout.on('data', (chunk: Buffer) =>
        deliverOutput(this.#state.context.output, 'stdout', chunk)
      )
    /** The original native close event alone supplies this generation's exit receipt. */
    const exited = deferred<{ code: number | null; signal: string | null }>()
    this.#state.child.once('close', (code, signal) => exited.resolve({ code, signal }))
    this.#state.exited = exited.promise
    this.#state.context.signal.addEventListener('abort', this.#onAbort, { once: true })
    void this.#state.exited.then(() =>
      this.#state.context.signal.removeEventListener('abort', this.#onAbort)
    )
  }
  /**
   * Finish the original startup transaction, preserving native primary failures and rollback
   * ordering.
   */
  async open(): Promise<INodeProcessHandle> {
    try {
      await new Promise<void>((resolve, reject) => {
        this.#state.child.once('spawn', resolve)
        this.#state.child.once('error', reject)
      })
      this.#state.launch.assertActive()
      /** A framed bootstrap is always the first stdin write. */
      if (this.#state.spec.bootstrap?.via === 'stdin') {
        if (!this.#state.child.stdin) throw createProcessError(RpcProcessErrorCode.connectFailed)
        if (this.#state.stdinFailure) throw this.#state.stdinFailure
        await this.#writeBootstrap()
        this.#state.rejectBootstrap = undefined
      }
      if (this.#state.stdinFailure) throw this.#state.stdinFailure
      if (this.#state.spec.bootstrap?.via === 'fd')
        throw attachErrorIdentity(new TypeError(RpcProcessErrorText.optionsInvalid), {
          source: RPC_ENDPOINT_ERROR_SOURCE,
          code: RpcCoreErrorCode.invalidConfig
        })
      /** Stdout channel is never also consumed by the output drain. */
      const channel =
        this.#state.spec.stdio.stdin === 'channel' &&
        this.#state.spec.stdio.stdout === 'channel' &&
        this.#state.child.stdin &&
        this.#state.child.stdout
          ? this.#state.launch.createChildChannel(this.#state.child as IAdapterChildStdio)
          : undefined
      this.#state.child.stdin?.removeListener('error', this.#onStdinError)
      /** Successful handoff gives stop/force exclusively to the original supervisor slot. */
      this.#state.context.signal.removeEventListener('abort', this.#onAbort)
      return Object.freeze({
        identity: Object.freeze({
          fingerprint: this.#state.runtimeBootstrap?.self.instanceId ?? randomUUID(),
          pid: this.#state.child.pid
        }),
        exited: this.#state.exited,
        channel,
        /** Sampling follows this actual child; a completed child never substitutes another PID. */
        ...(this.#state.child.pid === undefined
          ? {}
          : {
              sampleUsage: () =>
                this.#state.child.exitCode !== null || this.#state.child.signalCode !== null
                  ? Promise.resolve({})
                  : sampleNativeProcess(this.#state.child.pid!)
            }),
        ...(this.#state.runtimeBootstrap
          ? { runtimeApiIdentity: this.#state.runtimeBootstrap.self }
          : {}),
        terminate: (mode: TerminationMode) => terminateChild(this.#state.child, mode)
      })
    } catch (error) {
      terminateChild(this.#state.child, 'force')
      await this.#state.exited
      this.#state.child.stdin?.removeListener('error', this.#onStdinError)
      throw createProcessError(RpcProcessErrorCode.connectFailed, error)
    }
  }
  /** Write this generation's original bootstrap once; stdin failure joins the same completion. */
  #writeBootstrap(): Promise<void> {
    /** The existing stdin error callback can reject this exact in-progress native write. */
    const completion = deferred<void>()
    this.#state.rejectBootstrap = completion.reject
    try {
      this.#state.child.stdin!.write(
        encodeRpcStreamFrame(
          this.#state.runtimeBootstrap?.payload ?? this.#state.spec.bootstrap!.payload
        ),
        (error) => {
          if (error) completion.reject(error)
          else completion.resolve()
        }
      )
    } catch (error) {
      completion.reject(error)
    }
    return completion.promise
  }

  /** Preserve this generation's original native callback and its cleanup identity. */
  #onStdinError = (error: Error): void => {
    this.#state.stdinFailure ??= error
    this.#state.rejectBootstrap?.(error)
  }
  /** Preserve this generation's original native callback and its cleanup identity. */
  #onAbort = (): void => terminateChild(this.#state.child, 'force')
}

export function createNodeProcessLauncher(
  options: Readonly<{ runtimeApiBootstrap?: IProcessRuntimeBootstrapOptions }> = {}
): IProcessLauncher<INodeProcessHandle> {
  return Object.freeze({
    capabilities: NODE_CAPABILITIES,
    async launch(spec, context) {
      /** Core prepares this actual supervised launch before any native spawn or secret write. */
      const launch = createAdapterNodeProcessLaunch(spec, context, options)
      /** The sole prepared identity and bytes remain the exact native bootstrap material. */
      const runtimeBootstrap = launch.bootstrap
      /** Only explicitly inherited environment keys pass to the child. */
      const env: Record<string, string> = {}
      for (const key of spec.env.inherit) {
        const value = process.env[key]
        if (value !== undefined) env[key] = value
      }
      Object.assign(env, spec.env.set)
      if (runtimeBootstrap) env[PROCESS_RUNTIME_API_ENV] = PROCESS_RUNTIME_API_ENV_VERSION
      /** Only the selected channel/drain streams are opened as pipes. */
      let child: ReturnType<typeof spawn>
      try {
        child = spawn(spec.command, [...spec.args], {
          cwd: spec.cwd,
          env,
          shell: false,
          detached: process.platform !== 'win32',
          stdio: [
            spec.stdio.stdin === 'channel' ? 'pipe' : 'ignore',
            spec.stdio.stdout === 'ignore' ? 'ignore' : 'pipe',
            spec.stdio.stderr === 'ignore' ? 'ignore' : 'pipe'
          ]
        })
      } catch (error) {
        throw tagNativeProcessError(error as Error, RpcProcessErrorCode.connectFailed)
      }
      /** One generation owns all post-spawn callbacks and the exact original native exit receipt. */
      return new NodeProcessGeneration(child, spec, context, launch, runtimeBootstrap).open()
    }
  })
}

/**
 * Open the current child's stdio once and optionally consume its first stdin bootstrap frame before
 * handshake. 'none' returns without reading bootstrap; 'fd' is unsupported and rejects
 * INVALID_CONFIG. Closing this channel pauses stdin and ends stdout, rather than terminating the
 * process.
 */
export async function openProcessStdioChannel(
  options: Readonly<{
    /** Required selection: consume 'stdin', consume nothing with 'none', or reject unsupported 'fd'. */
    bootstrap: 'stdin' | 'fd' | 'none'
    /** Reserved for fd bootstrap; selecting fd is currently rejected regardless of this value. */
    fd?: number
    /** Optional finite nonnegative first-frame wait; omission installs no bootstrap timer. */
    bootstrapTimeoutMs?: number
  }>
): Promise<Readonly<{ channel: IProcessByteChannel; bootstrap?: Uint8Array }>> {
  if (options.bootstrap === 'fd')
    throw attachErrorIdentity(new TypeError(RpcProcessErrorText.optionsInvalid), {
      source: RPC_ENDPOINT_ERROR_SOURCE,
      code: RpcCoreErrorCode.invalidConfig
    })
  /** Stdout channel is never also consumed by the output drain. */
  const channel = createAdapterProcessStdio(process)
  return receiveAdapterBootstrap(channel, options.bootstrap, options)
}

/** Moved former Core Node operations remain available through this owning native public entry. */
export { createAdapterNodeProcessLaunch } from '../node-launch.js'
export { createAdapterChildStdio, createAdapterProcessStdio } from '../node-io.js'
export type { IAdapterChildStdio, IAdapterProcessStdio } from '../node-io.js'
