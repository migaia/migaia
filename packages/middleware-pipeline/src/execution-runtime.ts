/** Owns branching traversal state; option admission and error identity remain canonical owners. */
import { MAX_NATIVE_RECURSION_DEPTH } from '@migaia/utils/function'
import { attachSecondaryErrors } from '@migaia/utils/error'
import {
  type IMiddlewarePipelineContext,
  type IMiddlewarePipelineOptions,
  type IAsyncMiddlewareStage,
  type ISyncMiddlewareStage,
  type IGeneratorMiddlewareStage,
  type IAsyncGeneratorMiddlewareStage
} from './runtime.js'
import {
  admit,
  check,
  invokeWithContext,
  cleanupSyncIterator,
  cleanupAsyncIterator,
  snapshotStages
} from './runtime-context.js'
import {
  MiddlewarePipelineNext,
  MiddlewarePipelineViolation,
  type IMiddlewarePipelineViolationHandler,
  type IGeneratorMiddlewareSignals
} from './state-constants.js'
import {
  createMiddlewarePipelineExecutionError,
  createMiddlewarePipelineMultipleDownstreamError,
  throwMiddlewarePipelineDownstreamFailures
} from './errors.js'

/** Records local sync submissions without allocating an array for a single value. */
export class PipelineSubmissions<TValue> {
  /** Public policy controls whether a second active submission is accepted. */
  readonly #policy: MiddlewarePipelineNext
  /** Canonical diagnostic sink retains late and single-duplicate semantics. */
  readonly #onViolation: IMiddlewarePipelineViolationHandler
  /** Inline first value avoids the multi-value collection on the usual path. */
  #first!: TValue
  /** Allocated only on the second accepted submission. */
  #values: TValue[] | undefined
  /** Number of accepted values includes an explicit undefined payload. */
  #count = 0
  /** Once closed, retained callbacks cannot start another traversal. */
  #closed = false

  /** Captures one stage's policy and diagnostic owner. */
  constructor(policy: MiddlewarePipelineNext, onViolation: IMiddlewarePipelineViolationHandler) {
    this.#policy = policy
    this.#onViolation = onViolation
  }
  /** Accepts a local value; downstream is deliberately not entered here. */
  readonly next = (value: TValue): void => {
    if (this.#closed) {
      this.#onViolation(MiddlewarePipelineViolation.late)
      return
    }
    if (this.#count > 0 && this.#policy === MiddlewarePipelineNext.single) {
      this.#onViolation(MiddlewarePipelineViolation.duplicate)
      return
    }
    if (this.#count === 0) this.#first = value
    else if (this.#values) this.#values.push(value)
    else this.#values = [this.#first, value]
    this.#count += 1
  }
  /** Prevents submissions once the originating stage has settled. */
  close(): void {
    this.#closed = true
  }
  /** Exposes the exact accepted count without scanning or allocating. */
  get count(): number {
    return this.#count
  }
  /** Reads one accepted submission in O(1). */
  at(index: number): TValue {
    return this.#values ? this.#values[index]! : this.#first
  }
}

/** One branch completion retains active-control provenance and original rejection identity. */
type IAsyncBranch = {
  completion?: Promise<void>
  promise?: ObservedTraversalPromise
  active: boolean
  failed: boolean
  /** Set once the branch traversal has settled; a settled branch needs no further await. */
  settled: boolean
  error?: unknown
}

/** A real Promise subclass makes native await enter the same public observation hook as then. */
class ObservedTraversalPromise extends Promise<void> {
  /** Only caller consumption, never the runner's internal rejection handler, observes this branch. */
  #observed = false

  /** Borrow the original traversal while immediately handling its native rejection. */
  constructor(pending: Promise<void>) {
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
  override then<TResult1 = void, TResult2 = never>(
    onfulfilled?: ((value: void) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    this.#observed = true
    return super.then(onfulfilled, onrejected)
  }
  /** The runner joins and consumes original rejection without pretending the caller observed it. */
  consume(onFulfilled: () => void, onRejected: (error: unknown) => void): Promise<void> {
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
  readonly resolve: () => void
  readonly reject: (error: unknown) => void
}

/** Owns the immutable stage snapshot and depth-safe dispatch for one async execution. */
class AsyncPipelineRun<TValue> {
  /** Snapshot isolates this execution from later caller mutations. */
  readonly stages: readonly IAsyncMiddlewareStage<TValue>[]
  /** Terminal callback belongs to the original caller. */
  readonly done: (value: TValue, context?: IMiddlewarePipelineContext) => void | Promise<void>
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
  dispatch(index: number, value: TValue, parent?: IAsyncBranch): Promise<void> {
    if (this.#draining || this.#depth >= MAX_NATIVE_RECURSION_DEPTH) {
      return new Promise<void>((resolve, reject) => {
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
  #step(index: number, value: TValue, parent?: IAsyncBranch): Promise<void> {
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
      return Promise.resolve(invokeWithContext(this.done, [value], this.context))
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
  readonly next = (value: TValue): Promise<void> => {
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
    const settled = (): void => {
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
  async run(value: TValue): Promise<void> {
    /** Independent stage failures remain distinct from downstream failures. */
    let stageError: unknown
    /** A boolean distinguishes throw undefined from successful completion. */
    let stageFailed = false
    try {
      await invokeWithContext(this.#run.stages[this.#index]!, [value, this.next], this.#run.context)
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
      failures.length > 1 ? createMiddlewarePipelineMultipleDownstreamError(failures) : failures[0]
    if (stageFailed && failures.length > 0) {
      if (propagatedStageFailure) throw downstream
      if (this.#run.options.combineStageAndDownstreamError) {
        throw this.#combine(stageError, downstream)
      }
      throw createMiddlewarePipelineExecutionError(stageError, downstream)
    }
    if (stageFailed) throw stageError
    if (failures.length > 0) throw downstream
    try {
      this.#run.check()
    } catch (error) {
      this.#markParent(error)
      throw error
    }
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
  return run.dispatch(0, value)
}

/** A sync branch stores only its suffix position and submitted payload. */
type ISyncBranch<TValue> = { readonly index: number; readonly value: TValue }

/** Executes multiple sync submissions with a depth-first work stack and no native recursion. */
export const runMultipleSyncPipeline = <TValue>(
  stages: readonly ISyncMiddlewareStage<TValue>[],
  value: TValue,
  done: (value: TValue, context?: IMiddlewarePipelineContext) => void,
  options: IMiddlewarePipelineOptions
): void => {
  /** Canonical admission runs before any stage or terminal. */
  const context = admit(options.signal)
  /** Caller mutations cannot change the suffix traversals already accepted by this run. */
  const snapshot = snapshotStages(stages)
  /** LIFO suffix requests preserve each stage's submission order. */
  const pending: ISyncBranch<TValue>[] = [{ index: 0, value }]
  /** Independent failures retain registration order while every accepted suffix is traversed. */
  const failures: unknown[] = []
  while (pending.length > 0) {
    const branch = pending.pop()!
    try {
      check(context)
      options.assertActive?.()
      if (branch.index === snapshot.length) {
        invokeWithContext(done, [branch.value], context)
        continue
      }
      /** This stage owns its retained callback independently of later branch entries. */
      const submissions = new PipelineSubmissions<TValue>(
        MiddlewarePipelineNext.multiple,
        options.onViolation
      )
      try {
        invokeWithContext(snapshot[branch.index]!, [branch.value, submissions.next], context)
      } finally {
        submissions.close()
      }
      check(context)
      options.assertActive?.()
      for (let index = submissions.count - 1; index >= 0; index -= 1)
        pending.push({ index: branch.index + 1, value: submissions.at(index) })
    } catch (error) {
      failures.push(error)
    }
  }
  throwMiddlewarePipelineDownstreamFailures(failures)
}

/** A suffix is entered once; an iterator resumes only after that suffix completes. */
type IGeneratorTask<TValue, TIterator> =
  | { readonly index: number; readonly value: TValue }
  | {
      readonly index: number
      readonly iterator: TIterator
      readonly failure?: { readonly error: unknown }
    }

/** The nearest suspended yield alone receives its failed suffix; no new traversal is fenced. */
function returnGeneratorFailure<TValue, TIterator>(
  pending: IGeneratorTask<TValue, TIterator>[],
  error: unknown
): void {
  /** Below a running suffix the stack contains only its suspended ancestor iterators. */
  const parent = pending.pop()
  if (!parent || !('iterator' in parent)) throw error
  pending.push({ index: parent.index, iterator: parent.iterator, failure: { error } })
}

/** Maps the explicit-undefined control to its payload without copying ordinary values. */
const yieldedValue = <TValue>(
  value: TValue | symbol,
  signals: IGeneratorMiddlewareSignals
): TValue => (value === signals.undefined ? (undefined as TValue) : (value as TValue))

/** Runs each synchronous yield before resuming its originating iterator, without native recursion. */
export const runMultipleGeneratorPipeline = <TValue>(
  stages: readonly IGeneratorMiddlewareStage<TValue>[],
  value: TValue,
  done: (value: TValue, context?: IMiddlewarePipelineContext) => void,
  signals: IGeneratorMiddlewareSignals,
  options: IMiddlewarePipelineOptions
): void => {
  /** Admission is shared with every other runner. */
  const context = admit(options.signal)
  /** One immutable snapshot serves every suffix traversal. */
  const snapshot = snapshotStages(stages)
  /** Resume tasks sit below their yielded suffix work. */
  const pending: IGeneratorTask<
    TValue,
    Generator<TValue | symbol, TValue | symbol | undefined, void>
  >[] = [{ index: 0, value }]
  while (pending.length > 0) {
    const task = pending.pop()!
    try {
      check(context)
      options.assertActive?.()
      if (!('iterator' in task)) {
        if (task.index === snapshot.length) {
          invokeWithContext(done, [task.value], context)
          continue
        }
        /** The factory and all yielded suffixes stay under this one task stack. */
        const iterator = invokeWithContext(snapshot[task.index]!, [task.value], context)
        pending.push({ index: task.index, iterator })
        continue
      }
      /** A failed suffix resumes exactly its originating yield through the native throw method. */
      const step = task.failure ? task.iterator.throw(task.failure.error) : task.iterator.next()
      check(context)
      options.assertActive?.()
      if (step.done) {
        if (
          step.value === undefined ||
          step.value === signals.continue ||
          step.value === signals.halt
        )
          continue
      } else pending.push({ index: task.index, iterator: task.iterator })
      pending.push({
        index: task.index + 1,
        value: yieldedValue<TValue>(step.value as TValue | symbol, signals)
      })
    } catch (error) {
      /** Interrupted iterators drain their original cleanup before failure reaches an ancestor. */
      let primary = error
      if ('iterator' in task) {
        try {
          cleanupSyncIterator(task.iterator, primary)
        } catch (cleanup) {
          primary = cleanup
        }
      }
      returnGeneratorFailure(pending, primary)
    }
  }
}

/** Awaits each async yield traversal and terminal I/O before resuming its originating iterator. */
export const runMultipleAsyncGeneratorPipeline = async <TValue>(
  stages: readonly IAsyncGeneratorMiddlewareStage<TValue>[],
  value: TValue,
  done: (value: TValue, context?: IMiddlewarePipelineContext) => void | Promise<void>,
  signals: IGeneratorMiddlewareSignals,
  options: IMiddlewarePipelineOptions
): Promise<void> => {
  /** Admission is shared with every other runner. */
  const context = admit(options.signal)
  /** One immutable snapshot serves every suffix traversal. */
  const snapshot = snapshotStages(stages)
  /** Resume tasks sit below their yielded suffix work. */
  const pending: IGeneratorTask<
    TValue,
    AsyncGenerator<TValue | symbol, TValue | symbol | undefined, void>
  >[] = [{ index: 0, value }]
  while (pending.length > 0) {
    const task = pending.pop()!
    try {
      check(context)
      options.assertActive?.()
      if (!('iterator' in task)) {
        if (task.index === snapshot.length) {
          await invokeWithContext(done, [task.value], context)
          continue
        }
        /** One native iterator owns this stage and each subsequent yielded suffix. */
        const iterator = invokeWithContext(snapshot[task.index]!, [task.value], context)
        pending.push({ index: task.index, iterator })
        continue
      }
      /** Await failure delivery at the original yield before the stage may submit another value. */
      const step = task.failure
        ? await task.iterator.throw(task.failure.error)
        : await task.iterator.next()
      check(context)
      options.assertActive?.()
      if (step.done) {
        if (
          step.value === undefined ||
          step.value === signals.continue ||
          step.value === signals.halt
        )
          continue
      } else pending.push({ index: task.index, iterator: task.iterator })
      pending.push({
        index: task.index + 1,
        value: yieldedValue<TValue>(step.value as TValue | symbol, signals)
      })
    } catch (error) {
      /** The stage owns thrown-back errors; actual return-cleanup failures retain this primary. */
      let primary = error
      if ('iterator' in task) {
        try {
          await cleanupAsyncIterator(task.iterator, primary)
        } catch (cleanup) {
          primary = cleanup
        }
      }
      returnGeneratorFailure(pending, primary)
    }
  }
}
