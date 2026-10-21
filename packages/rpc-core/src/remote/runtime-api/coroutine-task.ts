import type { INativeAbortSignal } from '@migaia/utils/promise'
import type { ICoroutineTask } from '@migaia/supervision/coroutine'
import { hostRethrowReporter } from '@migaia/utils/promise'
import { createRpcError, RpcCoreErrorCode } from '../../core/errors.js'
import { IpcReporterContext } from '../../core/plugins/reporter-context.js'
import { RuntimeApiErrorText } from './constants.js'

/** Opaque connection belongs to one task generation and reveals no physical port operation. */
export type ICoroutineConnect = Readonly<{ readonly __coroutineConnect: unique symbol }>

/** Cooperative task work shares the supervisor's original signal and heartbeat owner. */
export type ICoroutineTaskContext = Readonly<{
  /** Original cooperative task cancellation signal; user work must observe it. */
  signal: INativeAbortSignal
  /** Report liveness through the existing supervisor heartbeat owner. */
  heartbeat(): void
  /** Opaque child connection for this exact task generation. */
  connect: ICoroutineConnect
}>

/**
 * The native `MessagePort` members this family uses. Declared structurally so public types need no
 * DOM or Node declarations; every supported runtime's `MessageChannel` port satisfies it.
 */
export type ICoroutineMessagePort = {
  postMessage(message: unknown, transfer?: readonly unknown[]): void
  addEventListener(type: string, listener: (event: any) => void): void
  removeEventListener(type: string, listener: (event: any) => void): void
  start(): void
  close(): void
}

/** The global `MessageChannel` constructor, present in Node, Bun, Deno and browsers. */
type ICoroutineMessageChannelConstructor = new () => Readonly<{
  port1: ICoroutineMessagePort
  port2: ICoroutineMessagePort
}>

/** User task settlement is the native coroutine exit; a rejection keeps its original cause. */
export type ICoroutineUserTask = (context: ICoroutineTaskContext) => PromiseLike<unknown> | void

/** Replacements select a new user task while the supervisor owns generation and admission. */
export type ICoroutineReplaceSpec = Readonly<{ task: ICoroutineUserTask }>

/** Exact connection identity reveals only its original task-side port to the family recipe. */
const coroutinePorts = new WeakMap<ICoroutineConnect, ICoroutineMessagePort>()

/** Exact supervisor identity preserves the family reporter for outlet task replacement. */
const coroutineReporters = new WeakMap<object, (error: unknown) => void>()

/** Resolve a genuine task connection before any physical resource is opened. */
export function portOf(connect: ICoroutineConnect): ICoroutineMessagePort {
  /** Ordinary caller objects cannot claim a task's original physical port. */
  const port = coroutinePorts.get(connect)
  if (!port)
    throw createRpcError(RpcCoreErrorCode.invalidConfig, RuntimeApiErrorText.coroutineModeInvalid)
  return port
}

/** Register only the family-created supervisor, without adding execution or connection state. */
export function registerCoroutineReporter(
  supervisor: object,
  report: (error: unknown) => void
): void {
  coroutineReporters.set(supervisor, report)
}

/** Replacement reuses the exact registration's reporter rather than accepting caller ownership. */
export function reporterOf(supervisor: object): (error: unknown) => void {
  return coroutineReporters.get(supervisor)!
}

/**
 * Supply one native channel per generation. Physical ports close only after user work settles;
 * secondary close failures are reported and never replace the task's exit outcome.
 */
export function wrapCoroutineTask(
  task: ICoroutineUserTask,
  report: (error: unknown) => void
): ICoroutineTask<ICoroutineMessagePort> {
  return async (context) => {
    /** The supervisor owns this task generation; the wrapper owns only its physical channel. */
    const { port1, port2 } = new (
      globalThis as unknown as Readonly<{ MessageChannel: ICoroutineMessageChannelConstructor }>
    ).MessageChannel()
    /** The task receives a frozen token whose physical port stays in this lower module. */
    const connect = Object.freeze({}) as ICoroutineConnect
    coroutinePorts.set(connect, port2)
    context.expose(port1)
    try {
      await task(
        Object.freeze({ signal: context.signal, heartbeat: () => context.heartbeat(), connect })
      )
    } finally {
      for (const port of [port1, port2]) {
        try {
          port.close()
        } catch (error) {
          try {
            report(error)
          } catch (failure) {
            hostRethrowReporter(failure, IpcReporterContext)
          }
        }
      }
    }
  }
}
