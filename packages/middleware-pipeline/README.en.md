# `@migaia/middleware-pipeline`

[中文](./README.md)

`@migaia/middleware-pipeline` runs reusable validation, transformation and surrounding work with explicit continuation, short-circuit and cancellation rules.

## Sound familiar?

- **Timing and cleanup finish before asynchronous work does.** A callback chain fails to return the downstream Promise to its caller.
- **A reused sync step changes order after next.** Adapting it to async code confuses committing a value with immediately entering downstream.
- **A cancelled request still starts the next step.** A reusable pipeline checks only its application signal, rather than that request’s signal.
- **Validation rejects a value, yet saving still runs.** A generator returns an ordinary value instead of explicitly stopping the chain.
- **Clearing a cache skips the final callback.** A generator’s ordinary undefined return means halt, rather than an empty value to deliver.

## Why choose it

- **Outer work can await and wrap the whole downstream chain.** Hand-written callbacks can clean up too early; async next returns the downstream Promise, and the [timing example](./USEGUIDE.en.md#finish-surrounding-work-after-downstream-completes) finalizes after the terminal callback.
- **Lifting preserves a sync step’s original order.** Rewriting it as an async callback can move code after next; lift keeps downstream after the sync step returns, as the [reuse example](./USEGUIDE.en.md#reuse-a-sync-step-without-changing-its-ordering) demonstrates.
- **Each run can use its own cancellation boundary.** An application default alone misses request cancellation; run-level `control.signal` overrides it and reaches the stage. The [cancellation example](./USEGUIDE.en.md#use-a-request-signal-and-stop-before-the-next-step) prevents the final callback.
- **Generators can explicitly stop the entire chain.** Returning a rejected business value can still trigger saving; `GENERATOR_HALT` is a separate control signal. The [short-circuit example](./USEGUIDE.en.md#stop-a-generator-pipeline-before-a-rejected-value-is-saved) runs neither saving nor done.
- **An empty value differs from ending the chain.** Ordinary return undefined halts a generator; `GENERATOR_UNDEFINED` intentionally delivers undefined. The [empty-value example](./USEGUIDE.en.md#deliver-undefined-instead-of-accidentally-halting) still reaches the final callback.

## Start here

Run directly with Node 24. Input 2 is incremented, then doubled, and the final callback receives 6. A stage uses next to commit a value for the following stages.

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

For asynchronous surrounding work, read [wrapping downstream](./USEGUIDE.en.md#finish-surrounding-work-after-downstream-completes); to keep an existing sync step, read [lifting](./USEGUIDE.en.md#reuse-a-sync-step-without-changing-its-ordering).

## What hand-written code gets wrong

For illustration only; do not run. This hand-written chain performs the same numeric transformations without enforcing sync continuation timing or a single next call.

```ts doc-test=check
type IManualStage = (value: number, next: (value: number) => void) => void
const stages: IManualStage[] = [
  (value, next) => {
    next(value + 1) // Pitfall 1: recursion enters downstream before this sync stage returns.
    console.log('current stage tail')
    next(value + 100) // Pitfall 2: repeated calls run downstream and done again.
  },
  (value, next) => next(value * 2)
]
const run = (index: number, value: number): void => {
  const stage = stages[index]
  if (stage) stage(value, (nextValue) => run(index + 1, nextValue))
  else console.log('result:', value)
}
run(0, 2)
```

The sync runner commits only the first next value and starts downstream after the stage returns normally. Duplicate or late next calls go to `onViolation` without rerunning downstream; provide that callback when you need diagnostics.

## The model in three minutes

| Your question                                      | Choice                                                    |
| -------------------------------------------------- | --------------------------------------------------------- |
| Transform values in order without awaiting?        | sync; next only commits a value.                          |
| Await downstream before surrounding cleanup?       | async; continue cleanup after await next.                 |
| Yield several times before choosing a final value? | generator, or async-generator for asynchronous iteration. |
| Reuse a step written for another mode?             | lift, after checking the supported direction.             |
| Prevent the next step after request cancellation?  | Run-level `control.signal` and cooperative stages.        |

| Term        | Meaning                                                                 |
| ----------- | ----------------------------------------------------------------------- |
| pipeline    | A reusable runner with fixed execution rules.                           |
| stage       | One step that continues, stops or fails the current value.              |
| next        | Commits the next input; async mode also returns the downstream Promise. |
| done        | Terminal callback receiving the value when every stage continues.       |
| onion model | Enter outer work first, then finish it after downstream completes.      |
| sentinel    | A dedicated symbol for continue, halt or explicit undefined.            |

## Typical scenarios

| Scenario                                                   | Building blocks                   | Details                                                                                         |
| ---------------------------------------------------------- | --------------------------------- | ----------------------------------------------------------------------------------------------- |
| Pass a transformed value through reusable steps            | `sync + run`                      | [Runnable example](./USEGUIDE.en.md#pass-a-transformed-value-through-reusable-steps)            |
| Finish surrounding work after downstream completes         | `async + await next`              | [Runnable example](./USEGUIDE.en.md#finish-surrounding-work-after-downstream-completes)         |
| Reuse a sync step without changing its ordering            | `lift(sync) + async run`          | [Runnable example](./USEGUIDE.en.md#reuse-a-sync-step-without-changing-its-ordering)            |
| Use a request signal and stop before the next step         | `run + control.signal`            | [Runnable example](./USEGUIDE.en.md#use-a-request-signal-and-stop-before-the-next-step)         |
| Stop a generator pipeline before a rejected value is saved | `generator + GENERATOR_HALT`      | [Runnable example](./USEGUIDE.en.md#stop-a-generator-pipeline-before-a-rejected-value-is-saved) |
| Deliver undefined instead of accidentally halting          | `generator + GENERATOR_UNDEFINED` | [Runnable example](./USEGUIDE.en.md#deliver-undefined-instead-of-accidentally-halting)          |

## Install

```bash
pnpm add @migaia/middleware-pipeline
```

There is one root entry. Its only runtime dependency is `@migaia/utils`; it needs neither DOM nor Node and declares `sideEffects: false`.

## Essential API

| API                                           | Purpose                                                                         |
| --------------------------------------------- | ------------------------------------------------------------------------------- |
| `createPipeline(options)`                     | Fixes mode, cancellation defaults and error handling in a reusable runner.      |
| `pipeline.run(stages, value, done, control?)` | Executes a stage-list snapshot for one input.                                   |
| `pipeline.lift(stage, from)`                  | Reuses an existing stage along a supported direction, preserving its semantics. |

## Contract details

A pipeline contains only read-only mode, lift and run, with no mutable execution state. Values, indices and cancellation contexts are isolated per run. Stage arrays are copied at entry. Construction options and custom signal fields are read once and frozen; getter failures retain their original cause under `INVALID_OPTION`.

The four modes are sync, async, generator and async-generator. Sync next only commits a value; downstream begins after the stage returns, and no next means short-circuit. Async next immediately starts downstream and returns its original Promise; the runner waits even when the stage does not await it. Sync and generator throw synchronously; async and async-generator run return Promises.

Lifts allow the same mode, sync to async/generator/async-generator, and generator to async-generator. Async-to-async-generator is unsupported. Same-mode lifts preserve function identity. A lifted sync step finishes synchronous code after next before entering downstream, and a throwing step never starts downstream.

Generator return values continue; `GENERATOR_CONTINUE` selects the last yield or input when there was no yield. `GENERATOR_HALT` and implicit undefined halt. `GENERATOR_UNDEFINED` explicitly continues with undefined and requires `TValue` to include undefined. Three custom symbols must be distinct, are snapshotted on construction, and also control sync lifts. Control symbols do not reach done as payloads. Public `TSignals` stays separate from `TValue`; default signals retain unique-symbol types.

Run-level `control.signal` overrides construction signal, falling back when omitted. Context is appended to stage/done only when a valid signal exists. All modes check cancellation at entry, before/after stages and before done; generators also check after iterations. Started user code is not forcibly interrupted. Host `assertActive` runs at entry and after stages; returning async outer stages still recheck after done, without undoing done. Controllers and hosts belong to the caller.

Duplicate or post-completion next calls report duplicate and late, with a no-op default handler. Native Errors keep type, identity and stack when possible; unclassified execution failures receive `EXECUTION_FAILED` and complete external source/code identities stay unchanged. Cancellation uses `ABORTED`; other reason values remain on cause and need not produce a native AbortError. Later cancellation never replaces an ordinary user failure.

Independent stage/downstream failures are aggregated by default or passed to `combineStageAndDownstreamError`. The same object propagated through await next appears only once; equal primitives can be independent failures. A throwing combiner retains itself and both originals. A successfully returned custom combination must keep both originals reachable. Generator cancellation drives finally cleanup; a second cleanup failure uses `ABORT_CLEANUP_FAILED` with abort first.

The root exports the factory, modes, generator signals, public stage/control/context types, error codes and source. Executors and adapters remain internal. Import `IAbortSignal` from `@migaia/utils/promise`. `IMiddlewarePipelineSyncMode` is an internal helper withdrawn from the root without an alias; use `IMiddlewarePipelineDone`/`IMiddlewarePipelineRunResult`. See the [usage guide](./USEGUIDE.en.md#construction-options-and-every-default) for every option, mode and lift table, and all four error codes.
