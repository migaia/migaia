import { MiddlewarePipelineErrorText } from '../error-text.ts'
import { MiddlewarePipelineErrorCode } from '../error-code.ts'
import { MIDDLEWARE_PIPELINE_SOURCE } from '../error-code.ts'
import { attachErrorIdentity } from '@migaia/utils/error'
import type {
  IMiddlewarePipelineContext,
  IMiddlewarePipelineOptions,
  IAsyncMiddlewareStage
} from '../runtime-types.ts'
import {
  admit,
  check,
  invokeWithContext,
  invokeStageWithContext,
  snapshotStages
} from '../runtime-context.ts'
import { MiddlewarePipelineNext, MiddlewarePipelineViolation } from '../state-constants.ts'

import { MAX_NATIVE_RECURSION_DEPTH } from '@migaia/utils/function'
import { attachSecondaryErrors } from '@migaia/utils/error'
type IAsyncBranch = {
  completion?: Promise<void>
  promise?: ObservedTraversalPromise
  active: boolean
  failed: boolean
  /** Set once the branch traversal has settled; a settled branch needs no further await. */
  settled: boolean
  error?: unknown
  /** A fulfilled suffix result remains visible to its upstream next caller. */
  value?: unknown
}

/** A real Promise subclass makes native await enter the same public observation hook as then. */
class ObservedTraversalPromise extends Promise<unknown> {
  /** Only caller consumption, never the runner's internal rejection handler, observes this branch. */
  #observed = false

  /** Borrow the original traversal while immediately handling its native rejection. */
  constructor(pending: Promise<unknown>) {
    super((resolve, reject) => {
      void pending.then(resolve, reject)
    })
  }
  /** Chained results are ordinary promises, so their ownership belongs entirely to their caller. */
  static get [Symbol.species](): PromiseConstructor {
    return Promise
  }
  /** Native await and explicit then both transfer failure handling to the submitting stage. */
  // oxlint-disable-next-line unicorn/no-thenable -- This genuine Promise subclass must observe native await through then.
  override then<TResult1 = unknown, TResult2 = never>(
    onfulfilled?: ((value: unknown) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    this.#observed = true
    return super.then(onfulfilled, onrejected)
  }
  /** The runner joins and consumes original rejection without pretending the caller observed it. */
  consume(
    onFulfilled: (value: unknown) => void,
    onRejected: (error: unknown) => void
  ): Promise<void> {
    return super.then(onFulfilled, onRejected)
  }
  /** Observation is sampled only after the stage and all its started traversals settle. */
  get observed(): boolean {
    return this.#observed
  }
}
/** One deep request waits for the run-owned synchronous spill cursor. */
type IAsyncRequest<TValue> = {
  readonly index: number
  readonly value: TValue
  readonly parent?: IAsyncBranch
  readonly resolve: (value: unknown) => void
  readonly reject: (error: unknown) => void
}

/** Owns the immutable stage snapshot and depth-safe dispatch for one async execution. */
class AsyncPipelineRun<TValue> {
  /** Snapshot isolates this execution from later caller mutations. */
  readonly stages: readonly IAsyncMiddlewareStage<TValue, any>[]
  /** Terminal callback belongs to the original caller. */
  readonly done: (value: TValue, context?: IMiddlewarePipelineContext) => unknown
  /** Construction policy is immutable across frames. */
  readonly options: IMiddlewarePipelineOptions
  /** One admitted cooperative context is reused by every branch. */
  readonly context: IMiddlewarePipelineContext | undefined
  /** Synchronous native depth is bounded while preserving immediate stage entry. */
  #depth = 0
  /** Deep requests are drained by a cursor without recursive array shifts. */
  #spill: IAsyncRequest<TValue>[] = []
  /** Prevents nested drains while newly started frames append deep work. */
  #draining = false

  /** Captures an execution snapshot after canonical signal admission. */
  constructor(
    stages: readonly IAsyncMiddlewareStage<TValue>[],
    done: AsyncPipelineRun<TValue>['done'],
    options: IMiddlewarePipelineOptions
  ) {
    this.context = admit(options.signal)
    this.stages = snapshotStages(stages)
    this.done = done
    this.options = options
  }
  /** Checks both cooperative cancellation and host liveness at each traversal boundary. */
  check(): void {
    check(this.context)
    this.options.assertActive?.()
  }
  /** Enters one independent suffix traversal at its own stage index. */
  dispatch(index: number, value: TValue, parent?: IAsyncBranch): Promise<unknown> {
    if (this.#draining || this.#depth >= MAX_NATIVE_RECURSION_DEPTH) {
      return new Promise<unknown>((resolve, reject) => {
        this.#spill.push({ index, value, parent, resolve, reject })
        this.#drain()
      })
    }
    this.#depth += 1
    try {
      return this.#step(index, value, parent)
    } finally {
      this.#depth -= 1
    }
  }
  /**
   * Executes a suffix and marks only runner-owned control failures on its parent branch. It is not
   * an async function: the frame and the terminal already return their own Promise, so wrapping
   * them again would only add an allocation and extra microtask turns on every stage. Synchronous
   * failures are returned as rejections, exactly as an async function would.
   */
  #step(index: number, value: TValue, parent?: IAsyncBranch): Promise<unknown> {
    try {
      this.check()
    } catch (error) {
      if (parent) {
        parent.active = true
        parent.error = error
      }
      return Promise.reject(error)
    }
    if (index < this.stages.length) return new AsyncPipelineFrame(this, index, parent).run(value)
    try {
      check(this.context)
      return Promise.resolve(invokeWithContext(this.done, value, this.context))
    } catch (error) {
      return Promise.reject(error)
    }
  }
  /** Drains all currently queued deep entries in their submission order. */
  #drain(): void {
    if (this.#draining) return
    this.#draining = true
    for (let cursor = 0; cursor < this.#spill.length; cursor += 1) {
      const request = this.#spill[cursor]!
      void this.#step(request.index, request.value, request.parent).then(
        request.resolve,
        request.reject
      )
    }
    this.#spill.length = 0
    this.#draining = false
  }
}

/** Owns next admission and complete downstream settlement for one async onion frame. */
class AsyncPipelineFrame<TValue> {
  /** Shared execution context and immutable stages belong to this run. */
  readonly #run: AsyncPipelineRun<TValue>
  /** Every submission starts at this frame's successor, rather than a shared cursor. */
  readonly #index: number
  /** Receives control provenance only if this frame propagates that exact control failure. */
  readonly #parent: IAsyncBranch | undefined
  /** Original branch records remain in submission order until the frame settles. */
  readonly #branches: IAsyncBranch[] = []
  /** Stops retained callbacks once the stage settles. */
  #returned = false
  /** Captures one frame's continuation position and parent provenance channel. */
  constructor(run: AsyncPipelineRun<TValue>, index: number, parent?: IAsyncBranch) {
    this.#run = run
    this.#index = index
    this.#parent = parent
  }
  /** Starts one suffix immediately, observing its failure before stage settlement. */
  readonly next = (value: TValue): Promise<unknown> => {
    if (this.#returned) {
      this.#run.options.onViolation(MiddlewarePipelineViolation.late)
      return Promise.resolve()
    }
    if (this.#branches.length > 0 && this.#run.options.next !== MiddlewarePipelineNext.multiple) {
      this.#run.options.onViolation(MiddlewarePipelineViolation.duplicate)
      return Promise.resolve()
    }
    /** Placeholder keeps the control record stable while synchronous downstream entry begins. */
    const branch: IAsyncBranch = { active: false, failed: false, settled: false }
    // Publish admission before dispatch: downstream may reenter this captured next synchronously.
    this.#branches.push(branch)
    /** Caller receives the exact started branch promise; the observer never rejects. */
    const pending = this.#run.dispatch(this.#index + 1, value, branch)
    /** The original single path retains its native Promise and existing failure composition. */
    const observed =
      this.#run.options.next === MiddlewarePipelineNext.multiple
        ? new ObservedTraversalPromise(pending)
        : undefined
    branch.promise = observed
    /** Marks a fulfilled traversal so the frame can skip awaiting it again. */
    const settled = (value: unknown): void => {
      branch.value = value
      branch.settled = true
    }
    /** This exact record consumes rejection without calling the public observation hook. */
    const failed = (error: unknown): void => {
      branch.failed = true
      branch.error = error
      branch.settled = true
    }
    branch.completion = observed ? observed.consume(settled, failed) : pending.then(settled, failed)
    return observed ?? pending
  }
  /** Awaits stage and started branches, preserving active control and original failure order. */
  async run(value: TValue): Promise<unknown> {
    /** Independent stage failures remain distinct from downstream failures. */
    let stageError: unknown
    /** A boolean distinguishes throw undefined from successful completion. */
    let stageFailed = false
    try {
      await invokeStageWithContext(
        this.#run.stages[this.#index]!,
        value,
        this.next,
        this.#run.context
      )
    } catch (error) {
      stageFailed = true
      stageError = error
    }
    this.#returned = true
    // A settled branch's completion has already resolved; awaiting it would only add a turn.
    for (const branch of this.#branches) if (!branch.settled) await branch.completion
    /** Original rejections are collected once in submission order. */
    const failures: unknown[] = []
    /** Object identity proves a stage only propagated one of its started branch failures. */
    let propagatedStageFailure = false
    for (const branch of this.#branches) {
      if (branch.active && this.#run.options.next !== MiddlewarePipelineNext.multiple) {
        if (stageFailed) {
          if (stageError === branch.error) this.#markParent(stageError)
          throw stageError
        }
        this.#markParent(branch.error)
        throw branch.error
      }
      if (branch.failed && !branch.promise?.observed) {
        failures.push(branch.error)
        if (
          stageFailed &&
          stageError !== null &&
          (typeof stageError === 'object' || typeof stageError === 'function') &&
          stageError === branch.error
        )
          propagatedStageFailure = true
      }
    }
    /** Several independently started failures use the dedicated public aggregate contract. */
    const downstream =
      failures.length > 1
        ? attachErrorIdentity(
            new AggregateError(failures, MiddlewarePipelineErrorText.multipleDownstreamFailed),
            {
              source: MIDDLEWARE_PIPELINE_SOURCE,
              code: MiddlewarePipelineErrorCode.multipleDownstreamFailed
            }
          )
        : failures[0]
    if (stageFailed && failures.length > 0) {
      if (propagatedStageFailure) throw downstream
      if (this.#run.options.combineStageAndDownstreamError) {
        throw this.#combine(stageError, downstream)
      }
      throw attachErrorIdentity(
        new AggregateError([stageError, downstream], MiddlewarePipelineErrorText.executionFailed),
        { source: MIDDLEWARE_PIPELINE_SOURCE, code: MiddlewarePipelineErrorCode.executionFailed }
      )
    }
    if (stageFailed) throw stageError
    if (failures.length > 0) throw downstream
    try {
      this.#run.check()
    } catch (error) {
      this.#markParent(error)
      throw error
    }
    return this.#branches[this.#branches.length - 1]?.value
  }
  /** Combines independent failures without losing either if the custom combiner throws. */
  #combine(stage: unknown, downstream: unknown): unknown {
    try {
      return this.#run.options.combineStageAndDownstreamError!(stage, downstream)
    } catch (error) {
      throw attachSecondaryErrors(error, [stage, downstream])
    }
  }
  /** Marks only the exact runner control error propagated to the parent frame. */
  #markParent(error: unknown): void {
    if (this.#parent) {
      this.#parent.active = true
      this.#parent.error = error
    }
  }
}

/**
 * Runs both async next policies through one canonical, depth-safe onion owner. Signal admission
 * failures during construction become a rejected Promise, without an extra async wrapper around the
 * dispatch Promise.
 */
export const runAsyncPipeline = <TValue>(
  stages: readonly IAsyncMiddlewareStage<TValue>[],
  value: TValue,
  done: AsyncPipelineRun<TValue>['done'],
  options: IMiddlewarePipelineOptions
): Promise<void> => {
  /** Construction admits the signal; its failure must reject rather than throw. */
  let run: AsyncPipelineRun<TValue>
  try {
    run = new AsyncPipelineRun(stages, done, options)
  } catch (error) {
    return Promise.reject(error)
  }
  return run.dispatch(0, value).then(() => undefined)
}

/** A sync branch stores only its suffix position and submitted payload. */
