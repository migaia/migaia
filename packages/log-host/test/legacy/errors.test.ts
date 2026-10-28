import { expect, it } from 'vitest'
import {
  createLogHost,
  forwardPlugin,
  LogHostErrorCode,
  LOG_HOST_ERROR_SOURCE,
  type ILogEntry
} from '../../src/index.ts'
import { LogHostErrorText } from '../../src/error-text.ts'
import type { IAsyncMiddlewareStage } from '@migaia/middleware-pipeline'
import { CapturePlugin, execution, messages } from './fixtures.ts'
import type { IScheduler } from '@migaia/utils/scheduler'

/**
 * The new owner retains exactly its declared codes; moved codes are checked by their target
 * packages.
 */
function codeTable(): void {
  /** Values are the externally consumed semantic identity, independent of object property names. */
  const codes = Object.values(LogHostErrorCode)
  expect(codes).toHaveLength(14)
  expect(new Set(codes).size).toBe(14)
  expect(LOG_HOST_ERROR_SOURCE).toBe('logging')
}

/** Deliberate malformed replacement proves fallback delivery and native error type together. */
const invalidDateStage: IAsyncMiddlewareStage<ILogEntry> = (entry, next) =>
  next({ ...entry, message: 'replacement', time: 'serialized' as unknown as Date })
/** Pipeline replacement errors retain the old diagnostic shape and keep the original message. */
async function invalidPipelineReplacement(): Promise<void> {
  /** Sink observations are independent of the error channel. */
  const capture = new CapturePlugin()
  /** The original error event remains visible without default console side effects. */
  const failures: unknown[] = []
  /** The host provides the real asynchronous pipeline entry. */
  const host = createLogHost({ execution, plugins: [capture] })
  host.onFailure((failure) => {
    failures.push(failure)
  })
  host.usePipeline(invalidDateStage)
  host.log('info', 'original')
  await host.flush()
  expect(messages(capture.entries)).toEqual(['original'])
  expect(failures).toHaveLength(1)
  expect(failures[0]).toMatchObject({
    source: 'pipeline',
    error: {
      source: LOG_HOST_ERROR_SOURCE,
      code: LogHostErrorCode.pipelineEntryInvalid,
      name: 'TypeError',
      message: LogHostErrorText.pipelineEntryInvalid,
      stack: expect.any(String)
    }
  })
  await host.shutdown('manual')
}

/** Scheduler accessor admission preserves the original cause directly rather than a foreign wrapper. */
function invalidSchedulerAccessor(): void {
  /** One native cause makes exact identity observable across admission. */
  const cause = new Error('scheduler-accessor')
  /** The complete thrown value is retained for native type and package identity assertions. */
  let failure: unknown
  try {
    createLogHost({
      execution,
      scheduler: {
        get now(): never {
          throw cause
        },
        schedule: ignoredTask
      }
    })
  } catch (error) {
    failure = error
  }
  expect(failure).toBeInstanceOf(TypeError)
  expect(failure).toMatchObject({
    source: LOG_HOST_ERROR_SOURCE,
    code: LogHostErrorCode.invalidOption
  })
  expect((failure as Error).cause).toBe(cause)
}
/** No task side effect is needed for an admission-time getter failure fixture. */
function ignoredTask() {
  return { cancel: ignore }
}
/** An inert cleanup callback cannot mask admission assertions. */
function ignore(): void {}

/** Terminal reporter observations retain original listener failure reachability. */
class DiagnosticCapture {
  /** Exact reported error objects are retained independently of original failure events. */
  readonly diagnostics: unknown[] = []
  /** Reporter callback itself is stable and cannot throw. */
  readonly report = (error: unknown): void => {
    this.diagnostics.push(error)
  }
}
/** Supported failure observers still emit the retained hook diagnostic code after hook removal. */
async function observerFailureCode(): Promise<void> {
  /** One original listener error must remain the exact wrapper cause. */
  const reporterFailure = new Error('failure-hook')
  /** Reporter observations are independent of delivery failure collection. */
  const diagnostic = new DiagnosticCapture()
  /** This original sink rejects asynchronously through the actual core. */
  const capture = new CapturePlugin({ sinks: [rejectSink] })
  /** Explicit reporter injection replaces the removed global runtime manager. */
  const host = createLogHost({ execution, report: diagnostic.report, plugins: [capture] })
  host.onFailure(() => {
    throw reporterFailure
  })
  host.log('error', 'hook')
  await host.flush()
  /** Find only the semantic diagnostic under test, preserving the old complete value assertions. */
  const observed = diagnostic.diagnostics.find(isHookDiagnostic)
  expect(observed).toBeInstanceOf(Error)
  expect(observed).toMatchObject({
    source: LOG_HOST_ERROR_SOURCE,
    code: LogHostErrorCode.hookFailed
  })
  expect((observed as Error).cause).toBe(reporterFailure)
  await host.shutdown('manual')
}
/** The sink error itself is intentionally different from its observer's failure. */
function rejectSink(): Promise<void> {
  return Promise.reject(new Error('sink-for-hook'))
}
/** Semantic lookup keeps original diagnostics intact rather than reconstructing expected errors. */
function isHookDiagnostic(error: unknown): boolean {
  return (error as { code?: unknown })?.code === LogHostErrorCode.hookFailed
}

/** Renamed self-forwarding configuration retains native Error, source and absence of cause. */
async function selfForwardingCode(): Promise<void> {
  /** Dynamic configuration is the replacement for the deleted fluent forwarding entry. */
  const host = createLogHost({ execution })
  /** The complete configuration failure is needed to prove error shape rather than only rejection. */
  let failure: unknown
  try {
    await host.use(forwardPlugin({ targets: [host] }))
  } catch (error) {
    failure = error
  }
  expect(failure).toBeInstanceOf(Error)
  expect(failure).toMatchObject({
    source: LOG_HOST_ERROR_SOURCE,
    code: LogHostErrorCode.forwardSelf
  })
  expect((failure as Error).cause).toBeUndefined()
  await host.shutdown('manual')
}
/** Renamed cycle admission retains old complete error assertions through the real owner graph. */
async function cycleForwardingCode(): Promise<void> {
  /** Two distinct owners make a direct reverse edge observable. */
  const first = createLogHost({ execution, topic: 'first' })
  /** Topic is display state; ownership supplies actual cycle identity. */
  const second = createLogHost({ execution, topic: 'second' })
  await first.use(forwardPlugin({ targets: [second] }))
  /** Configuration failure remains the logging-owned cycle error rather than peer wrapping. */
  let failure: unknown
  try {
    await second.use(forwardPlugin({ targets: [first] }))
  } catch (error) {
    failure = error
  }
  expect(failure).toBeInstanceOf(Error)
  expect(failure).toMatchObject({
    source: LOG_HOST_ERROR_SOURCE,
    code: LogHostErrorCode.forwardCycle
  })
  expect((failure as Error).cause).toBeUndefined()
  await first.shutdown('manual')
  await second.shutdown('manual')
}

it('declares unique retained host codes under the package source', codeTable)
it(
  'PIPELINE_ENTRY_INVALID reports a replacement while preserving original delivery',
  invalidPipelineReplacement
)
it('INVALID_OPTION preserves TypeError and scheduler accessor cause', invalidSchedulerAccessor)
it('HOOK_FAILED emits a tagged diagnostic with the reporter failure as cause', observerFailureCode)
it('FORWARD_SELF rejects self forwarding with logging identity', selfForwardingCode)
it('FORWARD_CYCLE rejects a cycle in the real forwarding graph', cycleForwardingCode)

/** A hostile top-level scheduler accessor is admitted before any plugin side effect. */
function schedulerOptionGetter(): void {
  /** The exact original getter reason must remain directly reachable. */
  const getterError = new Error('scheduler-option-getter')
  /** This getter is the actual public constructor input, without a test-only entry point. */
  const options = {
    get scheduler(): never {
      throw getterError
    }
  }
  /** Preserve the full native thrown value rather than only matching a rejection string. */
  let failure: unknown
  try {
    createLogHost(options)
  } catch (error) {
    failure = error
  }
  expect(failure).toBeInstanceOf(TypeError)
  expect(failure).toMatchObject({
    source: LOG_HOST_ERROR_SOURCE,
    code: LogHostErrorCode.invalidOption,
    message: LogHostErrorText.schedulerGetterFailed
  })
  expect((failure as Error).cause).toBe(getterError)
  expect((failure as { source?: string }).source).not.toBe('plugin.host')
}

/** Invalid runtime scheduler shapes retain the logging owner rather than leaking a foundation error. */
function invalidSchedulerShape(): void {
  /** This deliberate unsupported shape models JavaScript callers at the actual public boundary. */
  const scheduler = { now: fixedTime } as unknown as IScheduler
  /** Error absence of cause is part of the original non-accessor admission contract. */
  let failure: unknown
  try {
    createLogHost({ execution, scheduler })
  } catch (error) {
    failure = error
  }
  expect(failure).toBeInstanceOf(TypeError)
  expect(failure).toMatchObject({
    source: LOG_HOST_ERROR_SOURCE,
    code: LogHostErrorCode.invalidOption,
    message: LogHostErrorText.invalidScheduler
  })
  expect((failure as Error).cause).toBeUndefined()
  expect((failure as { source?: string }).source).not.toBe('plugin.host')
}
/** The malformed fixture omits only schedule, keeping its ordinary clock capability callable. */
function fixedTime(): number {
  return 0
}

/** Capability accessor failure keeps its original identity through canonical scheduler admission. */
function schedulerCapabilityGetter(): void {
  /**
   * A distinct reason proves wrappers are not inserted between this error and the logging
   * TypeError.
   */
  const accessorError = new Error('scheduler-now-getter')
  /** The runtime scheduler's actual now accessor supplies the failure. */
  const scheduler = {
    get now(): never {
      throw accessorError
    },
    schedule: ignoredTask
  }
  /** Capture the actual package boundary error for all original assertions. */
  let failure: unknown
  try {
    createLogHost({ execution, scheduler })
  } catch (error) {
    failure = error
  }
  expect(failure).toBeInstanceOf(TypeError)
  expect(failure).toMatchObject({
    source: LOG_HOST_ERROR_SOURCE,
    code: LogHostErrorCode.invalidOption,
    message: LogHostErrorText.schedulerGetterFailed
  })
  expect((failure as Error).cause).toBe(accessorError)
}

it(
  'wraps an options.scheduler getter failure as logging TypeError with the original cause',
  schedulerOptionGetter
)
it(
  'rejects an invalid scheduler shape with logging TypeError and no foreign error owner',
  invalidSchedulerShape
)
it(
  'preserves a scheduler capability getter failure directly as the logging TypeError cause',
  schedulerCapabilityGetter
)
