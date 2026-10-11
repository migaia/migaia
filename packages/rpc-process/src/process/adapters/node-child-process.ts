import { RPC_PROCESS_ERROR_SOURCE, IpcReporterContext } from '@migaia/rpc-core/adapter/diagnostics'
import { attachErrorIdentity } from '@migaia/utils/error'
import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { encodeRpcStreamFrame } from '@migaia/rpc-contract/framing/stream'
import { RPC_CORE_ERROR_SOURCE, RpcCoreErrorCode } from '@migaia/rpc-core'
import { hostRethrowReporter } from '@migaia/utils/promise'
import { CapabilityLevel, StandardCapability, type TerminationMode } from '@migaia/supervision'
import {
  ProcessCapability,
  type IProcessHandle,
  type IProcessLauncher
} from '@migaia/supervision/process'
import { receiveAdapterBootstrap } from '@migaia/rpc-core/adapter'
import { RpcProcessErrorCode } from '../error-code.js'

import { RpcProcessErrorText } from '../error-text.js'
import type { IProcessByteChannel } from '../types.js'
import type { IRuntimePeerIdentity } from '@migaia/rpc-core/remote'
import { createAdapterNodeProcessLaunch } from '@migaia/rpc-core/adapter/process/node'
import type { IProcessRuntimeBootstrapOptions } from '@migaia/rpc-core/adapter/process'
import { PROCESS_RUNTIME_API_ENV, PROCESS_RUNTIME_API_ENV_VERSION } from '../constants.js'
import { createAdapterProcessStdio, type IAdapterChildStdio } from '@migaia/rpc-core/adapter/node'
import { sampleNativeProcess } from './native-usage.js'

/** A Node handle exposes stdout/stdin only when the specification chose byte channels. */
export type INodeProcessHandle = IProcessHandle &
  Readonly<{ channel?: IProcessByteChannel; runtimeApiIdentity?: IRuntimePeerIdentity }>

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

/** Spawn without a shell and drain diagnostics before writing a secret bootstrap frame. */
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
      const child = spawn(spec.command, [...spec.args], {
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
      /** Node emits EPIPE on stdin independently of the bootstrap write callback. */
      let stdinFailure: Error | undefined
      /** A pending bootstrap must reject when the child closes stdin early. */
      let rejectBootstrap: ((error: Error) => void) | undefined
      /** Hold the error listener until nodeByteStream takes ownership of stdin. */
      const onStdinError = (error: Error): void => {
        stdinFailure ??= error
        rejectBootstrap?.(error)
      }
      child.stdin?.on('error', onStdinError)
      /** Stderr must drain from spawn, including while the child waits for bootstrap. */
      if (child.stderr)
        child.stderr.on('data', (chunk: Buffer) => deliverOutput(context.output, 'stderr', chunk))
      if (spec.stdio.stdout === 'drain' && child.stdout)
        child.stdout.on('data', (chunk: Buffer) => deliverOutput(context.output, 'stdout', chunk))
      /** The handle settles only after Node closes all child stdio descriptors. */
      const exited = new Promise<{ code: number | null; signal: string | null }>((resolve) => {
        child.once('close', (code, signal) => resolve({ code, signal }))
      })
      const onAbort = (): void => terminateChild(child, 'force')
      context.signal.addEventListener('abort', onAbort, { once: true })
      void exited.then(() => context.signal.removeEventListener('abort', onAbort))
      try {
        await new Promise<void>((resolve, reject) => {
          child.once('spawn', resolve)
          child.once('error', reject)
        })
        launch.assertActive()
        /** A framed bootstrap is always the first stdin write. */
        if (spec.bootstrap?.via === 'stdin') {
          if (!child.stdin)
            throw attachErrorIdentity(new Error(RpcProcessErrorText.connectFailed), {
              source: RPC_PROCESS_ERROR_SOURCE,
              code: RpcProcessErrorCode.connectFailed
            })
          if (stdinFailure) throw stdinFailure
          await new Promise<void>((resolve, reject) => {
            rejectBootstrap = reject
            child.stdin!.write(
              encodeRpcStreamFrame(runtimeBootstrap?.payload ?? spec.bootstrap!.payload),
              (error) => {
                if (error) reject(error)
                else resolve()
              }
            )
          })
          rejectBootstrap = undefined
        }
        if (stdinFailure) throw stdinFailure
        if (spec.bootstrap?.via === 'fd')
          throw attachErrorIdentity(new TypeError(RpcProcessErrorText.optionsInvalid), {
            source: RPC_CORE_ERROR_SOURCE,
            code: RpcCoreErrorCode.invalidConfig
          })
        /** Stdout channel is never also consumed by the output drain. */
        const channel =
          spec.stdio.stdin === 'channel' &&
          spec.stdio.stdout === 'channel' &&
          child.stdin &&
          child.stdout
            ? launch.createChildChannel(child as IAdapterChildStdio)
            : undefined
        child.stdin?.removeListener('error', onStdinError)
        /** Successful handoff gives stop/force exclusively to the original supervisor slot. */
        context.signal.removeEventListener('abort', onAbort)
        return Object.freeze({
          identity: Object.freeze({
            fingerprint: runtimeBootstrap?.self.instanceId ?? randomUUID(),
            pid: child.pid
          }),
          exited,
          channel,
          /** Sampling follows this actual child; a completed child never substitutes another PID. */
          ...(child.pid === undefined
            ? {}
            : {
                sampleUsage: () =>
                  child.exitCode !== null || child.signalCode !== null
                    ? Promise.resolve({})
                    : sampleNativeProcess(child.pid!)
              }),
          ...(runtimeBootstrap ? { runtimeApiIdentity: runtimeBootstrap.self } : {}),
          terminate: (mode: TerminationMode) => terminateChild(child, mode)
        })
      } catch (error) {
        terminateChild(child, 'force')
        await exited
        child.stdin?.removeListener('error', onStdinError)
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
  })
}

/** A child opens one stdio byte port and receives its bootstrap before handshake. */
export async function openProcessStdioChannel(
  options: Readonly<{
    bootstrap: 'stdin' | 'fd' | 'none'
    fd?: number
    bootstrapTimeoutMs?: number
  }>
): Promise<Readonly<{ channel: IProcessByteChannel; bootstrap?: Uint8Array }>> {
  if (options.bootstrap === 'fd')
    throw attachErrorIdentity(new TypeError(RpcProcessErrorText.optionsInvalid), {
      source: RPC_CORE_ERROR_SOURCE,
      code: RpcCoreErrorCode.invalidConfig
    })
  const channel = createAdapterProcessStdio(process)
  return receiveAdapterBootstrap(channel, options.bootstrap, options)
}
