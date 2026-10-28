import { expect, it, vi } from 'vitest'
import { walkErrorCauses } from '@migaia/utils/error'
import type { IScheduledTask, IScheduler } from '@migaia/utils/scheduler'
import { createManualScheduler } from '@migaia/utils/testing'
import { createLogHost } from '../../src/index.ts'
import { defineOutputPlugin } from '../../src/plugin.ts'
import { batchFeature } from '../../src/features/batch.ts'
import { filterFeature } from '../../src/features/filter.ts'
import { LogHostErrorCode, ERROR_SOURCE } from '../../src/error-code.ts'
import type { ILogOutputRecord } from '../../src/typing.ts'
import { CaptureOutput, FailureCapture } from '../fixtures/output.ts'
import { Deferred, execution, microtasks } from './fixtures.ts'

/** Expected diagnostic failures remain in explicitly observed channels. */
function ignoreReport(_error: unknown): void {}
/** Extract a business message without coercing the original entry arguments. */
function recordMessage(record: ILogOutputRecord): string {
  return record.entry.message
}
/** Ordinary logs return before their default asynchronous full-batch delivery. */
async function asynchronousFullBatch(): Promise<void> {
  /** A one-entry boundary makes each completed entry independently observable. */
  const output = new CaptureOutput({ features: [batchFeature({ maxSize: 1 })] })
  /** Only the new public output SDK owns batching. */
  const host = createLogHost({ execution, report: ignoreReport, plugins: [output.plugin()] })
  host.log('info', 'deferred-1')
  host.log('info', 'deferred-2')
  expect(output.batches).toEqual([])
  await host.flush()
  expect(output.batches.map(batchMessages)).toEqual([['deferred-1'], ['deferred-2']])
  await host.shutdown('manual')
}
/** Read one actual transport batch while retaining its item order. */
function batchMessages(records: readonly ILogOutputRecord[]): string[] {
  return records.map(recordMessage)
}

/** A named transport owner exposes actual executing concurrency and completion barriers. */
class BlockingOutput {
  /** Release belongs to the test, never to the batching implementation. */
  readonly held = new Deferred<void>()
  /** The first actual transport invocation is a deterministic concurrency barrier. */
  readonly started = new Deferred<void>()
  /** Completed calls retain their exact batch boundaries. */
  readonly delivered: string[][] = []
  /** Current executing callbacks, rather than queued entries, define transport concurrency. */
  active = 0
  /** Every observed execution level is retained for the original maximum-concurrency assertion. */
  readonly peak: number[] = []
  /** Capacity is selected by the scenario before installation. */
  #capacity: number
  /** Capture the actual bounded window under test. */
  constructor(capacity: number) {
    this.#capacity = capacity
  }
  /** The same transport callback is shared by all deliveries of this output installation. */
  plugin() {
    return defineOutputPlugin({
      name: 'blocking-batch',
      batchable: true,
      defaultFormat: 'plain',
      features: [
        batchFeature({
          maxSize: 1,
          maxConcurrentBatches: 1,
          maxPendingBatches: this.#capacity,
          maxWaitMs: 5
        })
      ],
      deliver: (records) => this.deliver(records)
    })
  }
  /** Observe only real executing callbacks before waiting for the external release. */
  async deliver(records: readonly ILogOutputRecord[]): Promise<void> {
    this.active++
    this.peak.push(this.active)
    this.started.resolve()
    try {
      await this.held.promise
      this.delivered.push(batchMessages(records))
    } finally {
      this.active--
    }
  }
}
/** A fully occupied in-flight window drops incoming data without throwing to the producer. */
async function incomingBatchOverflow(): Promise<void> {
  /** The sole admitted slot is deliberately already executing. */
  const output = new BlockingOutput(1)
  /** The original failure object remains observable after the defer boundary. */
  const failures = new FailureCapture()
  /** No other output contributes concurrency or diagnostic events. */
  const host = createLogHost({ execution, report: ignoreReport, plugins: [output.plugin()] })
  host.onFailure(failures.receive)
  host.log('info', 'first')
  await output.started.promise
  expect(() => host.log('info', 'second')).not.toThrow()
  await microtasks()
  output.held.resolve()
  await host.flush()
  expect(Math.max(...output.peak)).toBe(1)
  expect(output.delivered).toEqual([['first']])
  expect(failures.failures.map(failureError)).toEqual([
    expect.objectContaining({ code: 'BATCH_OVERFLOW', detail: { dropped: 1 } })
  ])
  await host.shutdown('manual')
}
/** Project the exact captured failure without reconstructing its error. */
function failureError(failure: { error: unknown }): unknown {
  return failure.error
}
/** Saturation replaces the oldest queued batch while preserving the already executing batch. */
async function oldestQueuedBatchOverflow(): Promise<void> {
  /** One occupied active slot permits the legacy queued replacement scenario through public ingress. */
  const output = new BlockingOutput(2)
  /** Error classification is independent of the callback result. */
  const failures = new FailureCapture()
  /** The public host supplies the asynchronous ingress that replaced direct batcher.push. */
  const host = createLogHost({ execution, report: ignoreReport, plugins: [output.plugin()] })
  host.onFailure(failures.receive)
  host.log('info', 'in-flight-control')
  await output.started.promise
  host.log('info', 'saturate')
  expect(() => host.log('info', 'overflow')).not.toThrow()
  await microtasks()
  output.held.resolve()
  await host.flush()
  expect(output.delivered[0]).toEqual(['in-flight-control'])
  expect(output.delivered.slice(1)).toEqual([['overflow']])
  expect(failures.failures).toHaveLength(1)
  expect(failures.failures[0].error).toBeInstanceOf(Error)
  expect(failures.failures[0].error).toMatchObject({
    source: ERROR_SOURCE,
    code: LogHostErrorCode.batchOverflow,
    detail: { dropped: 1 }
  })
  await host.shutdown('manual')
}

/** A never-settling transport is bounded by the existing batch/host flush budget. */
async function boundedBatchFlush(): Promise<void> {
  /** One supported injected clock drives deadline arithmetic and task execution together. */
  const scheduler = createManualScheduler()
  /** The held transport can be released after proving bounded public completion. */
  const output = new BlockingOutput(1)
  /** All output delivery still passes through the approved SDK and batch feature. */
  const host = createLogHost({
    execution,
    scheduler,
    report: ignoreReport,
    plugins: [output.plugin()]
  })
  try {
    host.log('info', 'stuck')
    await microtasks()
    /** One flush owns the deadline rather than restarting the wait per phase. */
    const pending = host.flush()
    await microtasks()
    scheduler.advance(3_000)
    await microtasks()
    await expect(pending).resolves.toBeUndefined()
    output.held.resolve()
    await microtasks()
    await host.shutdown('manual')
  } finally {
    output.held.resolve()
  }
}

/** A returned timer handle remains independently owned even when its callback fires synchronously. */
class CountedTask implements IScheduledTask {
  /** The original assertion observes the actual returned task's cancel method. */
  readonly cancel = vi.fn(cancelNothing)
}
/** Successful task cancellation has no unrelated test effect. */
function cancelNothing(): void {}
/** Synchronous scheduling exercises callback-before-handle-return ownership. */
class ImmediateScheduler implements IScheduler {
  /** Every actual task is retained with its requested delay for exact debounce selection. */
  readonly schedules: Array<{ delayMs: number; task: CountedTask }> = []
  /** A fixed clock keeps this ownership case independent of elapsed wall time. */
  now(): number {
    return 0
  }
  /** The callback fires before the owner receives the newly allocated handle. */
  schedule(callback: () => void, delayMs: number): CountedTask {
    callback()
    /** This is the independently returned handle whose cancellation must not be lost. */
    const task = new CountedTask()
    this.schedules.push({ delayMs, task })
    return task
  }
}
/**
 * A synchronous debounce callback still releases its actual subsequently returned task exactly
 * once.
 */
async function synchronousDebounceOwnership(): Promise<void> {
  /** Callback ordering comes from the real injected scheduler capability. */
  const scheduler = new ImmediateScheduler()
  /** The buffer is partial, so the timer rather than size triggers delivery. */
  const output = new CaptureOutput({ features: [batchFeature({ maxSize: 10, maxWaitMs: 5 })] })
  /** The test uses the real host scheduler admission and output installation. */
  const host = createLogHost({
    execution,
    scheduler,
    report: ignoreReport,
    plugins: [output.plugin()]
  })
  host.log('info', 'batch')
  await microtasks()
  await host.flush()
  expect(output.batches.map(batchMessages)).toEqual([['batch']])
  /** One scan selects the original five-millisecond debounce handle. */
  const task = scheduler.schedules.find(isDebounce)?.task
  expect(task?.cancel).toHaveBeenCalledOnce()
  await host.shutdown('manual')
}
/** The debounce delay is a compile-time fixture value, not a guessed task ordering. */
function isDebounce(record: { delayMs: number }): boolean {
  return record.delayMs === 5
}

/** A real transport callback may throw while producer and flush APIs remain nonthrowing. */
async function synchronousBatchCallbackFailure(): Promise<void> {
  /** Original identity must cross the batching defer failure channel unchanged. */
  const original = new Error('batch-callback-failed')
  /** This named transport fixture owns its stable original error. */
  const output = new ThrowingOutput(original)
  /** Failure events retain their original source as well as error identity. */
  const failures = new FailureCapture()
  /** The public feature replaces the removed direct synchronous batcher entry. */
  const host = createLogHost({ execution, report: ignoreReport, plugins: [output.plugin()] })
  host.onFailure(failures.receive)
  expect(() => host.log('info', 'sync-failure')).not.toThrow()
  await expect(host.flush()).resolves.toBeUndefined()
  expect(failures.failures).toContainEqual({ source: 'defer', error: original })
  await host.shutdown('manual')
}
/** Callback failure ownership is retained rather than regenerated for each delivery. */
class ThrowingOutput {
  /** The caller's exact original error is the callback result. */
  #error: Error
  /** Capture one original failure before installing the output. */
  constructor(error: Error) {
    this.#error = error
  }
  /** A one-entry batch immediately reaches the actual callback when ingress drains. */
  plugin() {
    return defineOutputPlugin({
      name: 'throws-batch',
      batchable: true,
      defaultFormat: 'plain',
      features: [batchFeature({ maxSize: 1 })],
      deliver: () => this.deliver()
    })
  }
  /** Throw the same original error on every invocation. */
  deliver(): never {
    throw this.#error
  }
}

/** A task keeps its original cancellation failure and its scheduler's callback inventory. */
class RetainedTask implements IScheduledTask {
  /** The real scheduling owner supplies cancellation accounting. */
  #scheduler: RetainedScheduler
  /** Only ten-millisecond debounce handles deliberately fail cancellation. */
  #delay: number
  /** Capture exact ownership before the handle is returned. */
  constructor(scheduler: RetainedScheduler, delay: number) {
    this.#scheduler = scheduler
    this.#delay = delay
  }
  /** Reuse the same native error so every cleanup branch must preserve its identity. */
  cancel(): void {
    if (this.#delay === 10) {
      this.#scheduler.cancelCalls++
      throw this.#scheduler.cancelError
    }
  }
}
/** Retained callbacks can be fired after uninstall to prove they no longer own live delivery. */
class RetainedScheduler implements IScheduler {
  /** Debounce callbacks remain individually callable after their original output is removed. */
  readonly scheduled: Array<() => void> = []
  /** One original error is shared across the two independent output cancellations. */
  readonly cancelError = new Error('batch-cancel-failed')
  /** Count actual cleanup attempts rather than inferred callback invocations. */
  cancelCalls = 0
  /** No elapsed time is needed to assert callback ownership. */
  now(): number {
    return 0
  }
  /** Deadline tasks remain inert; only the explicitly selected debounce callbacks are retained. */
  schedule(callback: () => void, delay: number): RetainedTask {
    if (delay === 10) this.scheduled.push(callback)
    return new RetainedTask(this, delay)
  }
}
/**
 * Find one tagged error through actual public cleanup result and cause containers without
 * recursion.
 */
function taggedError(input: unknown, code: string): Error | undefined {
  /** Each actual object is visited once even when cause and aggregate paths share identity. */
  const visited = new Set<unknown>()
  /** Public result containers and native cause chains share one linear work queue. */
  const pending: unknown[] = [input]
  for (let cursor = 0; cursor < pending.length; cursor++) {
    /** Only actual objects can expose cleanup containers. */
    const value = pending[cursor]
    if (!value || typeof value !== 'object' || visited.has(value)) continue
    visited.add(value)
    if (value instanceof Error && Object.getOwnPropertyDescriptor(value, 'code')?.value === code)
      return value
    if (Array.isArray(value)) {
      for (const item of value) pending.push(item)
      continue
    }
    // Four public cleanup/cause fields form a fixed compile-time bound.
    for (const field of ['cleanupErrors', 'errors', 'error', 'cause'] as const) {
      /** Missing containers add no work and cannot introduce a synthetic error. */
      const nested = (value as Record<string, unknown>)[field]
      if (nested !== undefined) pending.push(nested)
    }
  }
  return undefined
}
/**
 * Output-owned batches drain losslessly, attempt every cancellation, and isolate a later
 * installation.
 */
async function uninstallBatchIsolation(): Promise<void> {
  /** Two independent output registrations replace the removed shared batch-provider factory. */
  const scheduler = new RetainedScheduler()
  /** Each partial buffer must be drained exactly once during its real registration cleanup. */
  const first = new CaptureOutput({
    name: 'old-first',
    features: [
      filterFeature({ filters: [firstOutput] }),
      batchFeature({ maxSize: 3, maxWaitMs: 10 })
    ]
  })
  /** The second output owns a separate timer even though it shares the same policy shape. */
  const second = new CaptureOutput({
    name: 'old-second',
    features: [
      filterFeature({ filters: [secondOutput] }),
      batchFeature({ maxSize: 3, maxWaitMs: 10 })
    ]
  })
  /** Both outputs borrow the same canonical scheduler source. */
  const host = createLogHost({
    execution,
    scheduler,
    report: ignoreReport,
    plugins: [first.plugin(), second.plugin()]
  })
  host.log('first', 'drop-one')
  host.log('second', 'drop-two')
  await microtasks()
  expect(scheduler.scheduled).toHaveLength(2)
  /** Cleanup outcomes are observed independently at their new output registration boundaries. */
  const removals = [await host.unUse('old-first'), await host.unUse('old-second')]
  for (const result of removals) {
    expect(result).toBeDefined()
    /** Every failed cancellation must retain both host classification and the original error. */
    const tagged = taggedError(result, LogHostErrorCode.pluginUninstallCleanupFailed)
    expect(tagged).toMatchObject({
      source: ERROR_SOURCE,
      code: LogHostErrorCode.pluginUninstallCleanupFailed
    })
    expect([...walkErrorCauses(tagged)]).toContain(scheduler.cancelError)
  }
  expect(scheduler.cancelCalls).toBe(2)
  for (const callback of scheduler.scheduled) callback()
  host.log('info', 'late-old')
  await host.flush()
  expect(first.batches.map(batchMessages)).toEqual([['drop-one']])
  expect(second.batches.map(batchMessages)).toEqual([['drop-two']])
  expect(scheduler.scheduled).toHaveLength(2)
  /** The later owner has a fresh partial buffer and timer with no route to either old callback. */
  const fresh = new CaptureOutput({
    name: 'new-install',
    features: [batchFeature({ maxSize: 2, maxWaitMs: 10 })]
  })
  /** Reinstallation remains a distinct host and resource lifetime as in the original scenario. */
  const reinstalled = createLogHost({
    execution,
    scheduler,
    report: ignoreReport,
    plugins: [fresh.plugin()]
  })
  reinstalled.log('info', 'new-install')
  await microtasks()
  expect(scheduler.scheduled).toHaveLength(3)
  scheduler.scheduled[2]!()
  await reinstalled.flush()
  expect(fresh.batches.map(batchMessages)).toEqual([['new-install']])
  expect(first.batches.map(batchMessages)).toEqual([['drop-one']])
  expect(second.batches.map(batchMessages)).toEqual([['drop-two']])
  await reinstalled.shutdown('manual')
  await host.shutdown('manual')
}

/** Separate public output routes retain the two original independent partial buffers. */
function firstOutput(entry: { tag: string }): boolean {
  return entry.tag === 'first'
}
/** Only the second original buffer receives the second scenario item. */
function secondOutput(entry: { tag: string }): boolean {
  return entry.tag === 'second'
}

it('runs full batch callbacks asynchronously by default', asynchronousFullBatch)
it(
  'bounds batch concurrency and drops the incoming batch when the window is in flight',
  incomingBatchOverflow
)
it(
  'BATCH_OVERFLOW reports the dropped oldest batch on a saturated bounded batcher',
  oldestQueuedBatchOverflow
)
it('batch flush returns after deadline when onBatch never settles', boundedBatchFlush)
it(
  'cancels a synchronous BatchPlugin debounce handle after callback return',
  synchronousDebounceOwnership
)
it(
  'contains synchronous batch callback failure without throwing from push',
  synchronousBatchCallbackFailure
)
it('drains buffered items, cancels every batcher, and isolates reinstall', uninstallBatchIsolation)
