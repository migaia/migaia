import { randomUUID } from 'node:crypto'
import type { Readable } from 'node:stream'
import { attachErrorIdentity } from '@migaia/utils/error'
import { hostRethrowReporter } from '@migaia/utils/promise'
import { CapabilityLevel, StandardCapability, type TerminationMode } from '@migaia/supervision'
import {
  ProcessCapability,
  type IProcessHandle,
  type IProcessLauncher
} from '@migaia/supervision/process'
import { RpcCoreErrorCode } from '../../core/index.js'
import { tagRpcError } from '../../core/transport-kit.js'
import { IpcReporterContext } from '../../core/plugins/reporter-context.js'
import { ERROR_SOURCE, RpcProcessErrorCode } from '../error-code.js'
import { createProcessError } from '../error.js'
import { RpcProcessErrorText } from '../error-text.js'
import type { IProcessMessageChannel } from '../types.js'

/** Minimal main-process surface; Electron stays an optional peer until invocation. */
type IElectronChild = Readonly<{
  pid?: number
  stdout: Readable | null
  stderr: Readable | null
  postMessage(value: unknown): void
  kill(): boolean
  on(event: 'message', listener: (value: unknown) => void): void
  on(event: 'exit', listener: (code: number) => void): void
  once(event: 'spawn', listener: () => void): void
  once(event: 'exit', listener: (code: number) => void): void
  once(event: 'error', listener: (error: Error) => void): void
  off(event: 'message', listener: (value: unknown) => void): void
  off(event: 'exit', listener: (code: number) => void): void
  off(event: 'spawn', listener: () => void): void
  off(event: 'error', listener: (error: Error) => void): void
}>

/** The optional peer has no import edge from the package root. */
type IElectronRuntime = Readonly<{
  app: Readonly<{ isReady(): boolean }>
  utilityProcess: Readonly<{
    fork(
      path: string,
      args: string[],
      options: Readonly<{
        cwd?: string
        env: Record<string, string>
        stdio: readonly ['ignore', 'pipe' | 'ignore', 'pipe' | 'ignore']
      }>
    ): IElectronChild
  }>
}>

/** Electron cannot bootstrap through stdin or guarantee whole-tree termination. */
const ELECTRON_CAPABILITIES = Object.freeze({
  [StandardCapability.termination]: CapabilityLevel.unsupported,
  [StandardCapability.faultIsolation]: CapabilityLevel.enforced,
  [ProcessCapability.memoryLimit]: CapabilityLevel.unsupported,
  [ProcessCapability.cpuTimeLimit]: CapabilityLevel.unsupported,
  [ProcessCapability.permissions]: CapabilityLevel.unsupported,
  [ProcessCapability.bootstrapStdin]: CapabilityLevel.unsupported,
  [ProcessCapability.bootstrapFd]: CapabilityLevel.unsupported
})

/** One optional dependency name is resolved only inside its owning adapter. */
const ELECTRON_PEER = 'electron'

/** Preserve a native posting error while adding this package's semantic code. */
function taggedNative(error: unknown): Error {
  if (error instanceof Error)
    return attachErrorIdentity(error, {
      source: ERROR_SOURCE,
      code: RpcProcessErrorCode.channelClosed
    })
  return createProcessError(RpcProcessErrorCode.channelClosed, error)
}

/** Wrap utilityProcess's whole-message port without adding a byte handshake. */
function messageChannel(child: IElectronChild): IProcessMessageChannel {
  let closed = false
  return Object.freeze({
    kind: 'message' as const,
    send(value: unknown) {
      if (closed) throw createProcessError(RpcProcessErrorCode.channelClosed)
      try {
        child.postMessage(value)
      } catch (error) {
        throw taggedNative(error)
      }
    },
    onMessage(listener: (value: unknown) => void) {
      child.on('message', listener)
      return () => child.off('message', listener)
    },
    onClose(listener: (reason?: unknown) => void) {
      const onExit = (): void => listener(createProcessError(RpcProcessErrorCode.channelClosed))
      child.on('exit', onExit)
      return () => child.off('exit', onExit)
    },
    close() {
      closed = true
    }
  })
}

/** Electron's handle exposes a message carrier and keeps termination on the supervisor. */
export type IElectronProcessHandle = IProcessHandle & Readonly<{ channel: IProcessMessageChannel }>

/** Construct a launcher whose unsupported capabilities are visible before any fork. */
export function createElectronUtilityProcessLauncher(): IProcessLauncher<IElectronProcessHandle> {
  return Object.freeze({
    capabilities: ELECTRON_CAPABILITIES,
    async launch(spec, context) {
      if (spec.bootstrap || spec.stdio.stdin !== 'ignore')
        throw tagRpcError(
          new TypeError(RpcProcessErrorText.optionsInvalid),
          RpcCoreErrorCode.invalidConfig
        )
      /** A variable specifier avoids resolving the optional peer in ordinary imports. */
      let loaded: unknown
      try {
        loaded = await import(ELECTRON_PEER)
      } catch (error) {
        throw createProcessError(RpcProcessErrorCode.connectFailed, error)
      }
      const runtime = loaded as IElectronRuntime
      if (!runtime.app?.isReady())
        throw tagRpcError(
          new TypeError(RpcProcessErrorText.optionsInvalid),
          RpcCoreErrorCode.invalidConfig
        )
      /** Utility process receives only explicitly inherited or set environment keys. */
      const env: Record<string, string> = {}
      for (const key of spec.env.inherit) {
        const value = process.env[key]
        if (value !== undefined) env[key] = value
      }
      Object.assign(env, spec.env.set)
      let child: IElectronChild
      try {
        child = runtime.utilityProcess.fork(spec.command, [...spec.args], {
          cwd: spec.cwd,
          env,
          stdio: [
            'ignore',
            spec.stdio.stdout === 'ignore' ? 'ignore' : 'pipe',
            spec.stdio.stderr === 'ignore' ? 'ignore' : 'pipe'
          ]
        })
      } catch (error) {
        throw createProcessError(RpcProcessErrorCode.connectFailed, error)
      }
      /** Output drains are installed immediately after fork and never logged here. */
      const drains: Promise<void>[] = []
      const attachDrain = (stream: Readable | null, name: 'stdout' | 'stderr'): void => {
        if (!stream) return
        stream.on('data', (chunk: Buffer) => {
          try {
            context.output(name, chunk)
          } catch (error) {
            hostRethrowReporter(error, IpcReporterContext)
          }
        })
        drains.push(
          new Promise<void>((resolve) => {
            stream.once('end', resolve)
            stream.once('close', resolve)
          })
        )
      }
      attachDrain(child.stdout, 'stdout')
      attachDrain(child.stderr, 'stderr')
      const exited = new Promise<{ code: number | null; signal: string | null }>((resolve) => {
        child.once('exit', (code) => {
          void Promise.all(drains).then(() => resolve({ code, signal: null }))
        })
      })
      const onAbort = (): void => {
        child.kill()
      }
      context.signal.addEventListener('abort', onAbort, { once: true })
      void exited.then(() => context.signal.removeEventListener('abort', onAbort))
      try {
        await new Promise<void>((resolve, reject) => {
          const onSpawn = (): void => {
            child.off('exit', onExit)
            child.off('error', onError)
            resolve()
          }
          const onExit = (): void => {
            child.off('spawn', onSpawn)
            child.off('error', onError)
            reject(createProcessError(RpcProcessErrorCode.connectFailed))
          }
          const onError = (error: Error): void => {
            child.off('spawn', onSpawn)
            child.off('exit', onExit)
            reject(error)
          }
          child.once('spawn', onSpawn)
          child.once('exit', onExit)
          child.once('error', onError)
        })
      } catch (error) {
        child.kill()
        await exited
        throw createProcessError(RpcProcessErrorCode.connectFailed, error)
      }
      /** The supervisor now owns termination; launch cancellation no longer owns this child. */
      context.signal.removeEventListener('abort', onAbort)
      return Object.freeze({
        identity: Object.freeze({ fingerprint: randomUUID(), pid: child.pid }),
        exited,
        channel: messageChannel(child),
        terminate(_mode: TerminationMode) {
          child.kill()
        }
      })
    }
  })
}
