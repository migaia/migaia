/** Borrow one physical channel per supervised task; token custody and cleanup stay native. */
import type { INativeAbortSignal } from '@migaia/utils/promise'
import type { IRpcLaunchFacts } from '@migaia/rpc-host/sdk'
import type { IRpcSessionHandle } from '@migaia/rpc-contract/interfaces'
import type { ICoroutineTask } from '@migaia/supervision/coroutine'
import { hostRethrowReporter } from '@migaia/utils/promise'
import { attachErrorIdentity } from '@migaia/utils/error'
import {
  RPC_COROUTINE_ERROR_SOURCE as ERROR_SOURCE,
  RpcCoroutineErrorCode
} from '@migaia/rpc-contract/error-code'
import { CoroutineErrorText } from './error-text.ts'
import { defaultRpcId, IpcReporterContext } from '@migaia/rpc-host/sdk'

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

/** The task token and its original exposed port alias the same private generation receipt. */
const coroutinePorts = new WeakMap<object, CoroutineConnection>()

/** Internal recipes borrow the same original connection; the package entry exposes no new API. */
export type ICoroutineConnection = CoroutineConnection

/** One task generation joins its actual Session shutdown before publishing native completion. */
class CoroutineConnection {
  /** The exact opaque token alone authorizes child-side native connection acquisition. */
  readonly #token: ICoroutineConnect
  /** Task-side media and bootstrap facts retain their original borrowed ownership. */
  readonly port: ICoroutineMessagePort
  /** Immutable launch identity remains available to the original child recipe. */
  readonly facts: IRpcLaunchFacts | undefined
  /** This parent-created task receipt assigns one child instance address per real generation. */
  readonly instanceId = defaultRpcId()
  /** The accepted parent Session supplies its own existing completion, not a delivery ACK. */
  #parentClosed: Promise<void> | undefined
  /** The borrowed child recipe lends its original Session/source close path. */
  #closeChild: (() => Promise<void>) | undefined

  /** Capture one generation's actual token and task-side native resource. */
  constructor(connect: ICoroutineConnect, port: ICoroutineMessagePort, facts?: IRpcLaunchFacts) {
    this.#token = connect
    this.port = port
    this.facts = facts
    Object.freeze(this)
  }

  /** Parent-port aliases never grant the child-token authority used by connectToParent. */
  owns(connect: ICoroutineConnect): boolean {
    return this.#token === connect
  }

  /** Accepted parent ownership stays on its original Session completion. */
  bindParent(session: IRpcSessionHandle): void {
    this.#parentClosed = session.closed
  }

  /** Natural task completion invokes the existing child Session/source cleanup exactly as disposal. */
  bindChild(close: () => Promise<void>): void {
    this.#closeChild = close
  }

  /** Preserve task primary failure while joining both original close owners before ports retire. */
  async finish(report: (error: unknown) => void): Promise<void> {
    if (!this.#closeChild && !this.#parentClosed) return
    /** Clear borrowed callbacks before they can reenter the original source cleanup. */
    const closeChild = this.#closeChild,
      parentClosed = this.#parentClosed
    this.#closeChild = undefined
    this.#parentClosed = undefined
    try {
      await closeChild?.()
    } catch (error) {
      reportCoroutineCleanup(report, error)
    }
    try {
      await parentClosed
    } catch (error) {
      reportCoroutineCleanup(report, error)
    }
  }
}

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
  if (!connection || !connection.owns(connect)) throw createCoroutineSourceError()
  return connection
}

/** Only the original exposed parent port can lend this generation's accepted Session receipt. */
export function parentConnectionOf(port: ICoroutineMessagePort): ICoroutineConnection {
  return coroutinePorts.get(port)!
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
  /** Both private keys refer to one receipt; no second source or generation index is created. */
  const connection = new CoroutineConnection(connect, port2, (0, input.facts)?.())
  coroutinePorts.set(connect, connection)
  coroutinePorts.set(port1, connection)
  context.expose(port1)
  try {
    await (0, input.task)(
      Object.freeze({ signal: context.signal, heartbeat: () => context.heartbeat(), connect })
    )
  } finally {
    await connection.finish(input.report)
    coroutinePorts.delete(port1)
    for (const port of [port1, port2]) {
      try {
        port.close()
      } catch (error) {
        reportCoroutineCleanup(input.report, error)
      }
    }
  }
}

/** Cleanup diagnostics retain the original task outcome and the existing host exception queue. */
function reportCoroutineCleanup(report: (error: unknown) => void, error: unknown): void {
  try {
    report(error)
  } catch (failure) {
    hostRethrowReporter(failure, IpcReporterContext)
  }
}
