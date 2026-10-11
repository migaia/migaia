import { ERROR_SOURCE as RPC_PROCESS_ERROR_SOURCE } from '../error-code.js'
import { IpcReporterContext } from '@migaia/rpc-core/adapter'
import { attachErrorIdentity } from '@migaia/utils/error'
import { hostRethrowReporter } from '@migaia/utils/promise'
import { CapabilityLevel, StandardCapability, type TerminationMode } from '@migaia/supervision'
import { sampleNativeProcess } from './native-usage.js'
import {
  ProcessCapability,
  type IProcessHandle,
  type IProcessLauncher
} from '@migaia/supervision/process'
import { encodeRpcStreamFrame } from '@migaia/rpc-contract/framing/stream'
import { RPC_CORE_ERROR_SOURCE, RpcCoreErrorCode } from '@migaia/rpc-core'
import { receiveAdapterBootstrap } from '../bootstrap.js'
import { RpcProcessErrorCode } from '../error-code.js'

import { RpcProcessErrorText } from '../error-text.js'
import type { IProcessByteChannel } from '../types.js'
import type { IRuntimePeerIdentity } from '@migaia/rpc-core/remote'
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
      source: RPC_CORE_ERROR_SOURCE,
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
  Readonly<{ channel?: IProcessByteChannel; runtimeApiIdentity?: IRuntimePeerIdentity }>

/** Spawn a Deno.Command with an explicit environment allowlist and early stderr drain. */
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
          source: RPC_CORE_ERROR_SOURCE,
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
        throw ((originalCause: unknown) =>
          attachErrorIdentity(
            new Error(
              RpcProcessErrorText.connectFailed,
              originalCause === undefined ? undefined : { cause: originalCause }
            ),
            { source: RPC_PROCESS_ERROR_SOURCE, code: RpcProcessErrorCode.connectFailed }
          ))(error)
      }
      /** Stderr reads start before a potentially blocked bootstrap write. */
      const stderrDrain =
        spec.stdio.stderr === 'drain'
          ? drain(child.stderr, (chunk) => context.output('stderr', chunk))
          : Promise.resolve()
      const stdoutDrain =
        spec.stdio.stdout === 'drain'
          ? drain(child.stdout, (chunk) => context.output('stdout', chunk))
          : Promise.resolve()
      const exited = child.status.then(async (status) => {
        await Promise.all([stderrDrain, stdoutDrain])
        return { code: status.code, signal: status.signal }
      })
      const terminate = (mode: TerminationMode): void => {
        try {
          child.kill(mode === 'force' ? 'SIGKILL' : 'SIGTERM')
        } catch (error) {
          hostRethrowReporter(error, IpcReporterContext)
        }
      }
      const onAbort = (): void => terminate('force')
      context.signal.addEventListener('abort', onAbort, { once: true })
      void exited.then(
        () => context.signal.removeEventListener('abort', onAbort),
        () => context.signal.removeEventListener('abort', onAbort)
      )
      try {
        if (spec.bootstrap?.via === 'stdin') {
          const writer = child.stdin.getWriter()
          try {
            await writer.write(
              encodeRpcStreamFrame(runtimeBootstrap?.payload ?? spec.bootstrap.payload)
            )
          } finally {
            writer.releaseLock()
          }
        }
        /** Each physical stream is consumed by either channel or output, never both. */
        const channel =
          spec.stdio.stdin === 'channel' && spec.stdio.stdout === 'channel'
            ? launch.createWebChannel(child.stdout, child.stdin)
            : undefined
        launch.assertActive()
        /** Startup cancellation must not bypass graceful retirement after the handle is adopted. */
        context.signal.removeEventListener('abort', onAbort)
        return Object.freeze({
          identity: Object.freeze({
            fingerprint: runtimeBootstrap?.self.instanceId ?? crypto.randomUUID(),
            pid: child.pid
          }),
          exited,
          channel,
          sampleUsage: () => sampleNativeProcess(child.pid),
          ...(runtimeBootstrap ? { runtimeApiIdentity: runtimeBootstrap.self } : {}),
          terminate
        })
      } catch (error) {
        terminate('force')
        await exited
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

/** Read the child's stdin bootstrap with the same decoder used for its hello. */
export function openProcessStdioChannel(
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
  const runtime = denoRuntime()
  const channel = createAdapterWebByteIO(runtime.stdin.readable, runtime.stdout.writable)
  return receiveAdapterBootstrap(channel, options.bootstrap, options)
}
