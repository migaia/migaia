# `@migaia/middleware-pipeline` usage guide

[中文](./USEGUIDE.md)

Start with a runnable scenario, then consult the full modes, options and failure contract. After installing the package, save any runnable example as its own .ts file and execute it with Node 24. Code matches the corresponding website scenario. See the [README](./README.en.md) for package selection.

## Find your scenario

| Your problem                                               | Building blocks                   | Read                                                                            |
| ---------------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------- |
| Pass a transformed value through reusable steps            | `sync + run`                      | [Runnable example](#pass-a-transformed-value-through-reusable-steps)            |
| Finish surrounding work after downstream completes         | `async + await next`              | [Runnable example](#finish-surrounding-work-after-downstream-completes)         |
| Reuse a sync step without changing its ordering            | `lift(sync) + async run`          | [Runnable example](#reuse-a-sync-step-without-changing-its-ordering)            |
| Use a request signal and stop before the next step         | `run + control.signal`            | [Runnable example](#use-a-request-signal-and-stop-before-the-next-step)         |
| Stop a generator pipeline before a rejected value is saved | `generator + GENERATOR_HALT`      | [Runnable example](#stop-a-generator-pipeline-before-a-rejected-value-is-saved) |
| Deliver undefined instead of accidentally halting          | `generator + GENERATOR_UNDEFINED` | [Runnable example](#deliver-undefined-instead-of-accidentally-halting)          |

## Pass a transformed value through reusable steps

Validation and formatting steps get copied between entry points, then one copy calls them in a different order. Pass the chosen steps to `run()`. Each `next(value)` hands the transformed value to the following step; the final callback receives the result. In `sync` mode, a step must return before downstream starts.

```ts doc-test=run
import { createPipeline, MiddlewarePipelineMode } from '@migaia/middleware-pipeline'

const pipeline = createPipeline<number>({ mode: MiddlewarePipelineMode.sync })
pipeline.run([(value, next) => next(value + 1), (value, next) => next(value * 2)], 2, (value) => {
  console.log('result:', value)
})
```

Output:

```text
result: 6
```

Prints `result: 6`: the input 2 becomes 3, then 6. `run()` returns `void`; a step that does not call `next()` stops before later steps and the final callback.

## Finish surrounding work after downstream completes

A request timer stops before the async work finishes because a callback chain returns before its downstream Promise. In `async` mode, `next()` starts downstream and returns its Promise. Await it inside `try/finally` so the outer cleanup follows downstream completion; this before-and-after nesting is the onion model.

```ts doc-test=run
import { createPipeline, MiddlewarePipelineMode } from '@migaia/middleware-pipeline'

const pipeline = createPipeline<number>({ mode: MiddlewarePipelineMode.async })
const trace: string[] = []
await pipeline.run(
  [
    async (value, next) => {
      trace.push('start timing')
      try {
        await next(value + 1)
      } finally {
        trace.push('finish timing')
      }
    },
    async (value, next) => {
      trace.push('validate')
      await next(value * 2)
    }
  ],
  2,
  (value) => {
    trace.push(`result ${value}`)
  }
)
console.log(trace.join(' | '))
```

Output:

```text
start timing | validate | result 6 | finish timing
```

Prints `start timing | validate | result 6 | finish timing`. The outer finalizer runs after the final callback. This establishes ordering; it does not undo side effects that already happened.

## Reuse a sync step without changing its ordering

A synchronous normalization step is rewritten as an async callback to fit another pipeline, and code after `next()` unexpectedly moves after downstream work. `lift(stage, from)` reuses the sync step with its original linear ordering: calling its `next()` records a value; downstream waits until that step returns.

```ts doc-test=run
import { createPipeline, MiddlewarePipelineMode } from '@migaia/middleware-pipeline'

const pipeline = createPipeline<string>({ mode: MiddlewarePipelineMode.async })
const trim = pipeline.lift((value, next) => {
  console.log('sync before next')
  next(value.trim())
  console.log('sync after next')
}, MiddlewarePipelineMode.sync)
await pipeline.run(
  [
    trim,
    async (value, next) => {
      console.log('async input:', value)
      await next(value.toUpperCase())
    }
  ],
  ' ready ',
  (value) => {
    console.log('result:', value)
  }
)
```

Output:

```text
sync before next
sync after next
async input: ready
result: READY
```

Prints `sync before next`, `sync after next`, `async input: ready`, then `result: READY`. Code after the sync step’s `next()` still precedes downstream. Only the documented lift directions are supported; arbitrary async onion stages cannot become generator stages.

## Use a request signal and stop before the next step

A reusable pipeline has an application signal, but one request needs its own cancellation boundary. Checking only the default signal lets cancelled work enter the next step. Pass `control.signal` to `run()` to override the default. Stages see that same signal in `context.signal`; cancellation is checked before entering downstream work.

```ts doc-test=run
import { createPipeline, MiddlewarePipelineMode } from '@migaia/middleware-pipeline'

const application = new AbortController()
application.abort(new Error('application stopped'))
const request = new AbortController()
const pipeline = createPipeline<number>({
  mode: MiddlewarePipelineMode.async,
  signal: application.signal
})
let completed = false
try {
  await pipeline.run(
    [
      async (value, next, context) => {
        console.log('request signal:', context?.signal === request.signal)
        request.abort(new Error('request cancelled'))
        await next(value + 1)
      }
    ],
    1,
    () => {
      completed = true
    },
    { signal: request.signal }
  )
} catch (error) {
  console.log('failure:', (error as Error).message)
}
console.log('final callback:', completed)
```

Output:

```text
request signal: true
failure: request cancelled
final callback: false
```

Prints `request signal: true`, `failure: request cancelled`, then `final callback: false`. The request signal overrides an already-aborted default, and its later abort prevents the final callback. Running user code is not forcibly interrupted; the caller owns both controllers.

## Stop a generator pipeline before a rejected value is saved

A generator validator detects an invalid value but accidentally returns it, so the save stage still runs. Return `GENERATOR_HALT` to stop the whole generator pipeline explicitly. Later stages and the final callback are skipped. This symbol belongs to generator modes, not sync/async `next()` callbacks.

```ts doc-test=run
import { createPipeline, MiddlewarePipelineMode, GENERATOR_HALT } from '@migaia/middleware-pipeline'

const pipeline = createPipeline<number>({ mode: MiddlewarePipelineMode.generator })
let written = false
let completed = false
pipeline.run(
  [
    function* (value) {
      return value < 0 ? GENERATOR_HALT : value
    },
    function* (value) {
      written = true
      return value
    }
  ],
  -1,
  () => {
    completed = true
  }
)
console.log('write ran:', written)
console.log('final callback:', completed)
```

Output:

```text
write ran: false
final callback: false
```

Prints `write ran: false` and `final callback: false`. Returning the halt symbol prevents both the save stage and final callback. A custom `signals` set uses its own `halt` symbol instead of this default constant.

## Deliver undefined instead of accidentally halting

Clearing a cached value needs a real `undefined` payload, but a generator’s plain `return undefined` means stop and never reaches the final callback. `GENERATOR_UNDEFINED` distinguishes an intentional empty value from stopping. The pipeline payload type must include `undefined`.

```ts doc-test=run
import {
  createPipeline,
  MiddlewarePipelineMode,
  GENERATOR_UNDEFINED
} from '@migaia/middleware-pipeline'

const pipeline = createPipeline<string | undefined>({ mode: MiddlewarePipelineMode.generator })
let ordinaryCompleted = false
pipeline.run(
  [
    function* () {
      return undefined
    }
  ],
  'cached',
  () => {
    ordinaryCompleted = true
  }
)
console.log('ordinary return completes:', ordinaryCompleted)
pipeline.run(
  [
    function* () {
      return GENERATOR_UNDEFINED
    }
  ],
  'cached',
  (value) => {
    console.log('explicit empty value delivered:', value === undefined)
  }
)
```

Output:

```text
ordinary return completes: false
explicit empty value delivered: true
```

Prints `ordinary return completes: false`, then `explicit empty value delivered: true`. The default explicit-undefined symbol delivers the payload rather than becoming the payload. It is used only by generator and async-generator modes; a custom signal set supplies its own `undefined` symbol.

## Entry point, ownership and execution model

The package has one entry, `@migaia/middleware-pipeline`, and one runtime dependency, `@migaia/utils`. It depends on neither DOM nor Node nor a lifecycle host. The root exports `createPipeline()`, mode and generator-signal constants, public stage/control/context types, and error codes. Concrete executors and adapters are internal and cannot be imported from the root.

A pipeline contains only read-only `mode`, `lift()` and `run()`. Current values, indices, cancellation contexts and next-call state belong to each individual run. One pipeline can be reused, with runs isolated from one another. Every run copies the stage list: replacing, inserting or deleting entries in the caller's array afterwards does not change that run's function sequence.

A stage receives the current value and chooses whether to continue, stop or fail. The done callback is the terminal consumer after all stages continue successfully. The package stores no application state, owns no abort controller, and creates or closes no host. Lifecycle assertions reuse the host's existing generations, leases or scopes instead of rebuilding them here.

## Construction options and every default

`createPipeline<TValue>(options)` requires an explicit mode. Its result, `IMiddlewarePipeline<TMode, TValue, TSignals>`, uses that mode to determine stages, done callbacks, run results and supported lifts. The public options type is `ICreatePipelineOptions<TMode>`.

| Field                                               | Default                              | Meaning and accepted values                                                                                                                                                                                                                                                  |
| --------------------------------------------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mode`                                              | Required; no default                 | `'sync'`, `'async'`, `'generator'` or `'async-generator'`, exposed as `MiddlewarePipelineMode.sync`, `async`, `generator` and `asyncGenerator`. Fixed after creation.                                                                                                        |
| `onViolation(kind)`                                 | A no-op function                     | Synchronously receives `'duplicate'` or `'late'`, also exposed as `MiddlewarePipelineViolation.duplicate` and `late`. Reports an invalid next call without restarting downstream.                                                                                            |
| `assertActive()`                                    | `undefined`                          | A synchronous host lifecycle assertion, checked at entry and after each stage. Async downstream entry also checks it. A throw prevents continuation; the pipeline does not change host state.                                                                                |
| `signal`                                            | `undefined`                          | Default cancellation signal for runs without their own signal. Signal shape and state are admitted when run starts, not during pipeline creation.                                                                                                                            |
| `signals`                                           | `MiddlewarePipelineGeneratorSignals` | Three distinct generator-control symbols under `undefined`, `halt` and `continue`. The default set is frozen.                                                                                                                                                                |
| `signals.undefined`                                 | `GENERATOR_UNDEFINED`                | Continues with an explicit undefined payload rather than stopping.                                                                                                                                                                                                           |
| `signals.halt`                                      | `GENERATOR_HALT`                     | Stops the entire chain without later stages or done.                                                                                                                                                                                                                         |
| `signals.continue`                                  | `GENERATOR_CONTINUE`                 | Continues with the last yielded value, or the input when nothing was yielded.                                                                                                                                                                                                |
| `combineStageAndDownstreamError(stage, downstream)` | `undefined`                          | Only for independent failures in an async stage and its started downstream. Receives the stage failure first, downstream failure second. Its return value is thrown as the combined failure. The caller must preserve both originals through cause or AggregateError.errors. |

Construction options must be an object, never null or an array. Supported option fields and the three custom signal properties are read once, then retained in a frozen internal snapshot. Later mutation of the caller's object cannot change the pipeline. The read-only mode publishes that same validated value. Invalid modes, callbacks, controls, signal shapes, signal sets and lift directions produce a native `TypeError` with `INVALID_OPTION`. Original option-getter failures remain on `cause`.

## run, next and the four modes

The common call is `pipeline.run(stages, value, done, control?)`.

| Input or member         | Meaning                                                                                                                                                                                  |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `stages`                | Read-only array of stages for this mode. An entry snapshot fixes function identities for the current run; later array edits affect later runs.                                           |
| `value`                 | Caller-supplied initial payload. Each later stage receives the previous stage's committed value.                                                                                         |
| `done(value, context?)` | Receives the final value only when no stage stopped or failed. An empty stage array reaches done directly. Sync modes require a synchronous callback; async modes also accept a Promise. |
| `control`               | Defaults to `undefined`. Currently has only optional `signal`; the object cannot be null or an array.                                                                                    |
| `control.signal`        | Defaults to `undefined`, falling back to construction signal. A supplied valid signal replaces the default rather than merging with it.                                                  |
| `context.signal`        | The signal actually selected for this run. With no signal, no additional context argument is passed.                                                                                     |
| `pipeline.mode`         | Read-only mode for inspection or selecting matching stage types.                                                                                                                         |

| Mode              | Stage shape                                        | When downstream starts                                                             | run result                                            |
| ----------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `sync`            | `(value, next, context?) => void`                  | After the stage returns normally; next only commits a value.                       | `void`, with synchronous throws.                      |
| `async`           | `(value, next, context?) => void \| Promise<void>` | The first next call starts downstream immediately, enabling before/after wrapping. | `Promise<void>`; entry and execution failures reject. |
| `generator`       | `(value, context?) => Generator`                   | After the generator finishes and its return value is interpreted.                  | `void`, with synchronous throws.                      |
| `async-generator` | `(value, context?) => AsyncGenerator`              | After the async generator finishes and its return value is interpreted.            | `Promise<void>`; done may also be async.              |

A synchronous stage commits at most one `next(value)`. Not calling next short-circuits the chain, skipping later stages and done. This is a linear transformation: synchronous code after next still runs before downstream. A throwing stage never starts downstream.

An asynchronous stage's `next(value)` immediately starts downstream and returns that downstream call's original Promise. Code after `await next(value)` wraps downstream completion. Even if the stage does not await a started next, the runner waits for downstream settlement before finishing. Normal completion without next also short-circuits.

`duplicate` means another next call before the stage completes; `late` means calling a captured next after completion. Neither overwrites the first committed value nor starts downstream again. The default handler ignores violations; use `onViolation` to report them. A callback throw inside run follows that mode's failure channel. A reporter throw triggered by calling captured next after run has ended is thrown directly from that next call.

## Generator terminal values and signals

A stage may yield several times, but intermediate values are not individually delivered downstream. Only its final return chooses the next value.

| Generator return                        | Result                                                                     |
| --------------------------------------- | -------------------------------------------------------------------------- |
| An ordinary payload value               | Continues with that value.                                                 |
| `GENERATOR_CONTINUE`                    | Continues with the last yield, or the current input if there was no yield. |
| `GENERATOR_HALT`                        | Stops the whole chain without done.                                        |
| Implicit return or ordinary `undefined` | Also stops; it is not an explicit undefined payload.                       |
| `GENERATOR_UNDEFINED`                   | Continues with undefined; `TValue` must include undefined.                 |

Custom `signals` replace all three default symbol identities. Return symbols from that same set. A sync stage lifted into a generator also uses the target pipeline's halt/continue signals; control symbols are not passed to done as ordinary payloads.

`TSignals` on `IGeneratorMiddlewareStage`, `IAsyncGeneratorMiddlewareStage`, `IMiddlewarePipeline` and `IMiddlewarePipelineStage` separates control values from `TValue`. Custom-signal overloads do not widen a numeric payload into symbols. The default set retains precise unique-symbol types.

## lift: reuse existing stages

`pipeline.lift(stage, from)` takes an existing stage and its source mode, then returns a stage for the current pipeline. Only these lossless directions are supported. A same-mode lift returns the original function with the same `===` identity.

| Target mode       | Accepted from values                   |
| ----------------- | -------------------------------------- |
| `sync`            | `sync`                                 |
| `async`           | `sync`, `async`                        |
| `generator`       | `sync`, `generator`                    |
| `async-generator` | `sync`, `generator`, `async-generator` |

Async-to-async-generator and reverse lifts are unsupported. Both TypeScript and runtime reject unsupported directions; runtime throws an `INVALID_OPTION` TypeError.

Lifts reuse the existing adapters while preserving call counts, violation reporting, errors and next-Promise semantics. In particular, a lifted sync stage still completes its synchronous tail after next before downstream starts. If that stage throws, downstream never starts. Lifting does not turn existing linear sync logic into async onion behavior.

## Cancellation and host lifecycle

Use native AbortSignal or the structural `IAbortSignal` type from `@migaia/utils/promise`. This package no longer exports `IAbortSignal` from its root. A valid signal has boolean aborted and compatible addEventListener/removeEventListener methods, with optional reason. The pipeline reads cancellation checkpoints and owns no controller.

All modes check run entry, before each stage, after each stage returns and before done. Generator modes also check after each iteration. A started stage is not forcibly interrupted, and signal cancellation does not make the runner abandon a Promise it is awaiting. Stages should cooperate through their supplied `context.signal`.

If cancellation is observed at a generator yield boundary, the runner calls iterator.return() and drains yields produced during cleanup. Cleanup values never reach downstream. Async-generator cleanup is awaited before rejection. If both abort and cleanup fail, an `ABORT_CLEANUP_FAILED` AggregateError retains abort first and cleanup failure second.

Each returning outer async stage rechecks cancellation and host activity even when done has already run. A failed check cannot undo that done callback. An ordinary user failure remains primary over a cancellation observed afterwards. A host `assertActive` control failure is not mistaken for two independent business failures and combined twice.

## Failures, original errors and codes

`MIDDLEWARE_PIPELINE_SOURCE` is `'@migaia/middleware-pipeline'`. `MiddlewarePipelineErrorCode` is the public error table.

| Member               | Code                   | What causes it                                                                                                                                                    |
| -------------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `executionFailed`    | `EXECUTION_FAILED`     | Unclassified stage, done, host assertion, violation-handler or combiner failure. Independent async stage/downstream failures become an AggregateError by default. |
| `invalidOption`      | `INVALID_OPTION`       | Invalid options, mode, callback, signal/control, signal set or lift direction; a native TypeError, with cause when there is an original failure.                  |
| `aborted`            | `ABORTED`              | Cooperative cancellation: an attachable, unclassified Error reason receives this code; other original reasons remain on cause.                                    |
| `abortCleanupFailed` | `ABORT_CLEANUP_FAILED` | Abort and generator cleanup both fail, aggregated with abort first.                                                                                               |

Native stage, done and `assertActive` Errors keep their object, type and stack when identity can be attached. Without a complete semantic source/code they receive `EXECUTION_FAILED`; complete external identities remain unchanged. Immutable errors and non-Error values remain on a wrapper's cause. Error abort reasons are likewise preserved when possible; strings, undefined and other reasons remain on an ordinary Error's cause, which need not be a native AbortError. If the reason getter throws, its thrown value is treated as the reason.

When an async stage and its started downstream fail independently, the default `EXECUTION_FAILED` AggregateError.errors retain stage then downstream. Merely awaiting next and receiving the same object failure does not create two duplicate error entries. Equal primitive values can still represent independent failures and are not deduplicated by value.

A custom combiner's returned value becomes the propagated failure. The caller must keep both original failures reachable through cause or errors. If the combiner throws, its original failure stays primary where possible, with both preexisting failures attached to the errors/cause chain.

## Public types and build commands

The root exports `ICreatePipelineOptions`, `IMiddlewarePipeline`, `IMiddlewarePipelineStage`, `IMiddlewarePipelineDone`, `IMiddlewarePipelineRunResult`, `IMiddlewarePipelineLiftSource`, the four stage types, context/control types, violation types and signal types. Applications reach executors through `createPipeline`, run and lift.

`IMiddlewarePipelineSyncMode` is only an internal conditional-type helper for Done/RunResult. It was withdrawn from the root with no compatibility alias. Use public `IMiddlewarePipelineDone` and `IMiddlewarePipelineRunResult` instead.

```bash
pnpm run fmt
pnpm run lint
pnpm run typecheck
pnpm run typecheck:test
pnpm run test
```
