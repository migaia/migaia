/** Borrow one physical channel per supervised task; token custody and cleanup stay native. */
import type { INativeAbortSignal } from '@migaia/utils/promise'
import type { IRpcLaunchFacts } from '@migaia/rpc-host/sdk'
import type { ICoroutineTask } from '@migaia/supervision/coroutine'
import { hostRethrowReporter } from '@migaia/utils/promise'
import { attachErrorIdentity } from '@migaia/utils/error'
import {
  RPC_COROUTINE_ERROR_SOURCE as ERROR_SOURCE,
  RpcCoroutineErrorCode
} from '@migaia/rpc-contract/error-code'
import { CoroutineErrorText } from './error-text.js'
import { IpcReporterContext } from '@migaia/rpc-host/sdk'

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
const coroutinePorts = new WeakMap<ICoroutineConnect, ICoroutineConnection>()

/** Exact token custody retains only its original port and trusted native bootstrap facts. */
export type ICoroutineConnection = Readonly<{
  port: ICoroutineMessagePort
  facts?: IRpcLaunchFacts
}>

/** Cold task configuration is explicit input to each independent native generation. */
type ICoroutineTaskInput = Readonly<{
  task: ICoroutineUserTask
  report(error: unknown): void
  facts?: () => IRpcLaunchFacts
}>

/** A source failure changes domain and native type only at this package's admission boundary. */
export function createCoroutineSourceError(): TypeError {
  return attachErrorIdentity(new TypeError(CoroutineErrorText.sourceInvalid), {
    source: ERROR_SOURCE,
    code: RpcCoroutineErrorCode.sourceInvalid
  })
}

/** Resolve a genuine task connection before any physical resource is opened. */
export function connectionOf(connect: ICoroutineConnect): ICoroutineConnection {
  /** Ordinary caller objects cannot claim a task's original physical port. */
  const connection = coroutinePorts.get(connect)
  if (!connection) throw createCoroutineSourceError()
  return connection
}

/**
 * Supply one native channel per generation. Physical ports close only after user work settles;
 * secondary close failures are reported and never replace the task's exit outcome.
 */
export function wrapCoroutineTask(
  task: ICoroutineUserTask,
  report: (error: unknown) => void,
  facts?: () => IRpcLaunchFacts
): ICoroutineTask<ICoroutineMessagePort> {
  /** One explicit invocation input keeps the wrapper from capturing three independent owners. */
  const input = { task, report, facts }
  return (context) => runCoroutineTask(input, context)
}

/** The original native generation owns expose/heartbeat; this invocation owns channel cleanup. */
async function runCoroutineTask(
  input: ICoroutineTaskInput,
  context: Parameters<ICoroutineTask<ICoroutineMessagePort>>[0]
): Promise<void> {
  /** The supervisor owns this task generation; the wrapper owns only its physical channel. */
  const { port1, port2 } = new (
    globalThis as unknown as Readonly<{ MessageChannel: ICoroutineMessageChannelConstructor }>
  ).MessageChannel()
  /** The task receives a frozen token whose physical port stays in this lower module. */
  const connect = Object.freeze({}) as ICoroutineConnect
  coroutinePorts.set(
    connect,
    Object.freeze({ port: port2, ...(input.facts ? { facts: input.facts() } : {}) })
  )
  context.expose(port1)
  try {
    await input.task(
      Object.freeze({ signal: context.signal, heartbeat: () => context.heartbeat(), connect })
    )
  } finally {
    for (const port of [port1, port2]) {
      try {
        port.close()
      } catch (error) {
        try {
          input.report(error)
        } catch (failure) {
          hostRethrowReporter(failure, IpcReporterContext)
        }
      }
    }
  }
}
