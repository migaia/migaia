/**
 * Worker script of the isolated tier. It brings its own `@migaia/part-host` and
 * `@migaia/part-contract`, places them on the shared global, and serves `load` (replace the effect
 * table with one version's modules) and `run` (run one effect) over rpc. An isolated effect's ctx
 * holds only `resources.run`, `state.read`, `state.write` and `dispatch`; each forwards to the
 * page. In the Worker `state.read` returns a promise.
 */
import * as partContract from '@migaia/part-contract'
import * as partHost from '@migaia/part-host'
import type { IEffectDefinition, IEffectEvent } from '@migaia/part-host'
import { createRpcHost } from '@migaia/rpc-host'
import { dedicatedWorkerPlugin } from '@migaia/rpc-plugin-browser'
import { PartRemoteErrorCode } from '../error-code.ts'
import { createPartRemoteError } from '../errors.ts'
import { encodeArgs, type IIsolatedCtxCall, type IIsolatedRunRequest } from '../isolated-runner.ts'
import { IsolatedMethod, IsolatedOp, PartRemoteText } from '../text.ts'
import { importModuleBytes } from './blob-import.ts'

/** Shared runtime available to isolated modules; `react` is absent, so modules importing it fail. */
const SHARED = { '@migaia/part-host': partHost, '@migaia/part-contract': partContract }

/** The part of the Worker's rpc host the table uses to reach the page. */
type IPageLink = {
  readonly worker: { request(method: string, payload?: unknown): Promise<unknown> }
}

/** Ctx of one isolated run inside the Worker; every operation forwards to the page. */
class WorkerEffectContext {
  /** Link to the page. */
  readonly #page: IPageLink
  /** Token of the run on the page. */
  readonly #token: number
  /** Fire-and-forget operations still in flight; the run waits for them before it ends. */
  readonly #pending: Promise<unknown>[] = []
  /** Resource commands, checked against the effect's grants on the page. */
  readonly resources = {
    run: (resource: string, command: string, args: unknown): Promise<unknown> =>
      this.#call(IsolatedOp.resourcesRun, [resource, command, args])
  }
  /** State access; reads return promises in the Worker. */
  readonly state = {
    read: (path: string): Promise<unknown> => this.#call(IsolatedOp.stateRead, [path]),
    write: (path: string, value: unknown): void => this.#queue(IsolatedOp.stateWrite, [path, value])
  }

  /** Binds the ctx to the page link and the run's token. */
  constructor(page: IPageLink, token: number) {
    this.#page = page
    this.#token = token
  }

  /** Queues an event dispatch on the page. */
  dispatch(address: string, event: string, detail?: unknown): void {
    this.#queue(IsolatedOp.dispatch, [address, event, detail])
  }

  /** Waits for every queued operation; the first failure rejects the run. */
  async settle(): Promise<void> {
    await Promise.all(this.#pending)
  }

  /** Forwards one operation and returns its result. */
  #call(op: IIsolatedCtxCall['op'], args: readonly unknown[]): Promise<unknown> {
    return this.#page.worker.request(IsolatedMethod.ctx, {
      token: this.#token,
      op,
      args: encodeArgs(args)
    } satisfies IIsolatedCtxCall)
  }

  /** Forwards one operation without waiting; `settle` waits for it. */
  #queue(op: IIsolatedCtxCall['op'], args: readonly unknown[]): void {
    this.#pending.push(this.#call(op, args))
  }
}

/** Effect table of the current version; replaced as a whole by each `load`. */
class IsolatedTable {
  /** Effects by id; old module objects are dropped when replaced. */
  #effects: ReadonlyMap<string, IEffectDefinition> = new Map()
  /** Link to the page, set once the rpc host exists. */
  #page: IPageLink | undefined

  /** Sets the page link. */
  attach(page: IPageLink): void {
    this.#page = page
  }

  /**
   * Imports every module of a version and replaces the table. Runs already started keep their
   * effect.
   */
  async load(
    modules: readonly { readonly name: string; readonly bytes: Uint8Array }[]
  ): Promise<void> {
    /** New table. */
    const next = new Map<string, IEffectDefinition>()
    for (const module of modules) {
      /** Imported namespace. */
      const namespace = await importModuleBytes(module.bytes, SHARED)
      /** Default export as a list. */
      const list = Array.isArray(namespace.default) ? namespace.default : [namespace.default]
      for (const definition of list as IEffectDefinition[])
        next.set(definition.descriptor.id, definition)
    }
    this.#effects = next
  }

  /**
   * Runs one effect from the current table; a missing effect rejects (the host reports
   * EFFECT_FAILED).
   */
  async run(request: IIsolatedRunRequest): Promise<void> {
    /** Effect of the current table. */
    const effect = this.#effects.get(request.effectId)
    if (effect === undefined)
      throw createPartRemoteError(
        PartRemoteErrorCode.isolatedEffectMissing,
        PartRemoteText.isolatedMissing(request.effectId)
      )
    /** Ctx of this run. */
    const ctx = new WorkerEffectContext(this.#page as IPageLink, request.token)
    await effect.run(request.event as IEffectEvent, ctx as never)
    await ctx.settle()
  }
}

/** The Worker's effect table. */
const table = new IsolatedTable()

table.attach(
  (await createRpcHost({
    plugins: [dedicatedWorkerPlugin({ worker: self as never })],
    provide: {
      [IsolatedMethod.load]: (modules: Parameters<IsolatedTable['load']>[0]) => table.load(modules),
      [IsolatedMethod.run]: (request: IIsolatedRunRequest) => table.run(request)
    }
  })) as unknown as IPageLink
)
