import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createContractError } from '../../contract/contract-error.js'
import { RpcContractErrorCode } from '../../contract/error-code.js'
import { createRpcStreamFrameDecoder, encodeRpcStreamFrame } from '../../contract/framing/stream.js'
import { RpcCoreErrorCode, tagRpcError } from '../../core/errors.js'
import { resolveAbortReason } from '../../core/internal/async-control.js'
import { IpcReporterContext } from '../../core/plugins/reporter-context.js'
import { hostRethrowReporter } from '@migaia/utils/promise'
import { CapabilityLevel, StandardCapability, type TerminationMode } from '@migaia/supervision'
import {
  ProcessCapability,
  type IProcessHandle,
  type IProcessLauncher
} from '@migaia/supervision/process'
import { registerProcessFrameSource } from '../channel.js'
import { RpcProcessErrorCode } from '../error-code.js'
import { createProcessError } from '../error.js'
import { RpcProcessErrorText } from '../error-text.js'
import type { IProcessByteChannel } from '../types.js'
import { nodeByteStream } from './node-byte-stream.js'

/** A Node handle exposes stdout/stdin only when the specification chose byte channels. */
export type INodeProcessHandle = IProcessHandle & Readonly<{ channel?: IProcessByteChannel }>

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
export function createNodeProcessLauncher(): IProcessLauncher<INodeProcessHandle> {
  return Object.freeze({
    capabilities: NODE_CAPABILITIES,
    async launch(spec, context) {
      /** Only explicitly inherited environment keys pass to the child. */
      const env: Record<string, string> = {}
      for (const key of spec.env.inherit) {
        const value = process.env[key]
        if (value !== undefined) env[key] = value
      }
      Object.assign(env, spec.env.set)
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
        if (context.signal.aborted) throw resolveAbortReason(context.signal)
        /** A framed bootstrap is always the first stdin write. */
        if (spec.bootstrap?.via === 'stdin') {
          if (!child.stdin) throw createProcessError(RpcProcessErrorCode.connectFailed)
          await new Promise<void>((resolve, reject) => {
            child.stdin!.write(encodeRpcStreamFrame(spec.bootstrap!.payload), (error) => {
              if (error) reject(error)
              else resolve()
            })
          })
        }
        if (spec.bootstrap?.via === 'fd')
          throw tagRpcError(
            new TypeError(RpcProcessErrorText.optionsInvalid),
            RpcCoreErrorCode.invalidConfig
          )
        /** Stdout channel is never also consumed by the output drain. */
        const channel =
          spec.stdio.stdin === 'channel' &&
          spec.stdio.stdout === 'channel' &&
          child.stdin &&
          child.stdout
            ? nodeByteStream(child.stdout, child.stdin, () => {
                child.stdout?.destroy()
                child.stdin?.destroy()
              })
            : undefined
        return Object.freeze({
          identity: Object.freeze({ fingerprint: randomUUID(), pid: child.pid }),
          exited,
          channel,
          terminate: (mode: TerminationMode) => terminateChild(child, mode)
        })
      } catch (error) {
        terminateChild(child, 'force')
        await exited
        throw createProcessError(RpcProcessErrorCode.connectFailed, error)
      }
    }
  })
}

/** A child opens one stdio byte port and receives its bootstrap before handshake. */
export async function openProcessStdioChannel(
  options: Readonly<{
    bootstrap: 'stdin' | 'fd' | 'none'
    fd?: number
  }>
): Promise<Readonly<{ channel: IProcessByteChannel; bootstrap?: Uint8Array }>> {
  if (options.bootstrap === 'fd')
    throw tagRpcError(
      new TypeError(RpcProcessErrorText.optionsInvalid),
      RpcCoreErrorCode.invalidConfig
    )
  const channel = nodeByteStream(process.stdin, process.stdout, () => {
    process.stdin.pause()
    process.stdout.end()
  })
  if (options.bootstrap === 'none') return Object.freeze({ channel })
  /** The first decoded frame is bootstrap; all later frames retain this same decoder. */
  let bootstrapped = false
  let resolveBootstrap: (payload: Uint8Array) => void = () => undefined
  let rejectBootstrap: (error: unknown) => void = () => undefined
  const bootstrap = new Promise<Uint8Array>((resolve, reject) => {
    resolveBootstrap = resolve
    rejectBootstrap = reject
  })
  /** At most one hello may arrive before the caller binds its responder handshake. */
  let queued: Uint8Array | undefined
  let queuedError: Error | undefined
  let onFrame: ((frame: Uint8Array) => void) | undefined
  let onError: ((error: Error) => void) | undefined
  const decoder = createRpcStreamFrameDecoder({
    onFrame(frame) {
      if (!bootstrapped) {
        bootstrapped = true
        resolveBootstrap(frame)
      } else if (onFrame) onFrame(frame)
      else if (queued === undefined) queued = frame
      else {
        /** A second pre-ready frame is a handshake violation, not another bootstrap. */
        const error = createContractError(RpcContractErrorCode.handshakeInvalid)
        queuedError = error
        void channel.close()
      }
    },
    onError(error) {
      if (!bootstrapped) rejectBootstrap(error)
      else if (onError) onError(error)
      else queuedError = error
      void channel.close()
    }
  })
  registerProcessFrameSource(channel, {
    decoder,
    attach(frame, error) {
      onFrame = frame
      onError = error
      if (queuedError) error(queuedError)
      else if (queued) frame(queued)
      queued = undefined
      queuedError = undefined
      return () => {
        onFrame = undefined
        onError = undefined
      }
    }
  })
  channel.onData((chunk) => decoder.push(chunk))
  channel.onClose(() => {
    decoder.finish()
    if (!bootstrapped) rejectBootstrap(createProcessError(RpcProcessErrorCode.channelClosed))
  })
  try {
    return Object.freeze({ channel, bootstrap: await bootstrap })
  } catch (error) {
    await channel.close()
    throw error
  }
}
