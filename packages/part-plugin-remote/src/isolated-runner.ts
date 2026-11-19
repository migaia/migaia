import type { IEffectEvent, IIsolatedEffectContext } from '@migaia/part-host'
import { createRpcHost } from '@migaia/rpc-host'
import { dedicatedWorkerPlugin } from '@migaia/rpc-plugin-browser'
import type { IIsolatedModule } from './modules.ts'
import { IsolatedMethod, IsolatedOp } from './text.ts'

/** Creates the Worker running isolated modules; the application's bundler emits its script. */
export type IIsolatedWorkerFactory = () => Worker

/** Request of one isolated run sent to the Worker. */
export type IIsolatedRunRequest = {
  readonly token: number
  readonly effectId: string
  readonly event: IEffectEvent
}

/**
 * One ctx operation the Worker forwards back to the page for a running effect. `args` maps argument
 * positions to values; `undefined` arguments are left out because rpc payloads cannot nest it.
 */
export type IIsolatedCtxCall = {
  readonly token: number
  readonly op: (typeof IsolatedOp)[keyof typeof IsolatedOp]
  readonly args: Readonly<Record<string, unknown>>
}

/** Encodes positional arguments for an rpc payload, leaving out `undefined` ones. */
export function encodeArgs(args: readonly unknown[]): Record<string, unknown> {
  /** Encoded arguments by position. */
  const encoded: Record<string, unknown> = {}
  args.forEach((value, index) => {
    if (value !== undefined) encoded[index] = value
  })
  return encoded
}

/** The part of an rpc host the channel uses. */
type IRpcConnection = {
  readonly worker: { request(method: string, payload?: unknown): Promise<unknown> }
  close(): Promise<unknown>
}

/** Live Worker plus the rpc host talking to it. */
type IWorkerLink = { readonly worker: Worker; readonly rpc: IRpcConnection }

/** Default Worker: the package's isolated Worker script as emitted next to this module. */
export function defaultIsolatedWorker(): Worker {
  return new Worker(new URL('./browser/isolated-worker.js', import.meta.url), { type: 'module' })
}

/** Event fields that cross to the Worker; a detail that cannot be cloned is dropped. */
function cloneableEvent(event: IEffectEvent): IEffectEvent {
  /** Detail when structured clone accepts it. */
  let detail: unknown
  try {
    detail = structuredClone(event.detail)
  } catch {
    detail = undefined
  }
  return {
    address: event.address,
    name: event.name,
    key: event.key,
    ...(detail === undefined ? {} : { detail }),
    ...(event.rowKey === undefined ? {} : { rowKey: event.rowKey })
  } as IEffectEvent
}

/**
 * Page side of the isolated tier: owns one Worker (created on first need) and the rpc host to it.
 * `load` hands a version's isolated modules to the Worker as one set; `run` is the host's isolated
 * runner. Ctx operations of a run come back over rpc and execute on the page through the ctx the
 * host gave that run, so grants are still checked by the host.
 */
export class IsolatedChannel {
  /** Worker factory. */
  readonly #factory: IIsolatedWorkerFactory
  /** Pending or live link; undefined before first need and after close. */
  #link: Promise<IWorkerLink> | undefined
  /** Ctx of each running effect by token. */
  readonly #runs = new Map<number, IIsolatedEffectContext>()
  /** Last token handed out. */
  #token = 0

  /** Binds the channel to a Worker factory; nothing starts until the first load. */
  constructor(factory: IIsolatedWorkerFactory) {
    this.#factory = factory
  }

  /** True when a Worker exists or is starting. */
  get active(): boolean {
    return this.#link !== undefined
  }

  /** Replaces the Worker's effect table with `modules`; starts the Worker when needed. */
  async load(modules: readonly IIsolatedModule[]): Promise<void> {
    if (modules.length === 0 && this.#link === undefined) return
    /** Live link. */
    const link = await this.#connect()
    await link.rpc.worker.request(
      IsolatedMethod.load,
      modules.map((module) => ({ name: module.name, bytes: module.bytes }))
    )
  }

  /** Isolated runner registered with the host: forwards the run and serves its ctx calls. */
  async run(effectId: string, event: IEffectEvent, ctx: IIsolatedEffectContext): Promise<void> {
    /** Live link. */
    const link = await this.#connect()
    /** Token of this run. */
    const token = ++this.#token
    this.#runs.set(token, ctx)
    try {
      await link.rpc.worker.request(IsolatedMethod.run, {
        token,
        effectId,
        event: cloneableEvent(event)
      } satisfies IIsolatedRunRequest)
    } finally {
      this.#runs.delete(token)
    }
  }

  /**
   * Closes the rpc host and terminates the Worker; running effects reject, and the host ends them
   * with EFFECT_FAILED. Idempotent. Callers clear the runner first, so nothing starts a new link.
   */
  async close(): Promise<void> {
    /** Link to release. */
    const link = this.#link
    this.#link = undefined
    if (link === undefined) return
    /** Settled link; a failed start has nothing to release. */
    const live = await link.catch(() => undefined)
    if (live === undefined) return
    try {
      await live.rpc.close()
    } finally {
      live.worker.terminate()
    }
  }

  /** Existing link, or a new Worker and rpc host. */
  #connect(): Promise<IWorkerLink> {
    this.#link ??= this.#start()
    return this.#link
  }

  /** Creates the Worker and the rpc host serving ctx calls. */
  async #start(): Promise<IWorkerLink> {
    /** New Worker. */
    const worker = this.#factory()
    try {
      /** Rpc host over the Worker. */
      const rpc = (await createRpcHost({
        plugins: [dedicatedWorkerPlugin({ worker })],
        provide: { [IsolatedMethod.ctx]: (call: IIsolatedCtxCall) => this.#ctx(call) }
      })) as unknown as IRpcConnection
      return { worker, rpc }
    } catch (error) {
      worker.terminate()
      throw error
    }
  }

  /** Executes one forwarded ctx operation through the run's host-given ctx. */
  #ctx(call: IIsolatedCtxCall): unknown {
    /** Ctx of the run; a call after the run ended has none. */
    const ctx = this.#runs.get(call.token) as IIsolatedEffectContext
    /** Arguments of the operation; left-out positions were `undefined`. */
    const { 0: first, 1: second, 2: third } = call.args
    switch (call.op) {
      case IsolatedOp.resourcesRun:
        return ctx.resources.run(String(first), String(second), third)
      case IsolatedOp.stateRead:
        return ctx.state.read(String(first))
      case IsolatedOp.stateWrite:
        return ctx.state.write(String(first), second)
      case IsolatedOp.dispatch:
        return ctx.dispatch(String(first), String(second), third)
    }
  }
}
