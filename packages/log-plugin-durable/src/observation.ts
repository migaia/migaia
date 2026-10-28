import { DurableErrorField } from './errors.ts'
import { defaultLogFailureReporter } from '@migaia/log-host'
import { assimilateCapturedThen, probeThenable, ThenableProbeKind } from '@migaia/utils/function'
import { createDurableTypeError, LogDurableErrorCode, ERROR_SOURCE } from './errors.ts'
import { DurableText } from './error-text.ts'
import type { ILogObservation, ILogStoreOptions } from './types.ts'

/** Terminal diagnostic failures stop here instead of recursively reporting or escaping. */
function ignoreDiagnosticFailure(): void {}

/** One selected reporter owns fallback to the host's sole terminal reporter. */
class DurableReporter {
  /** Captured callback is invoked as a plain function, preserving its original receiver. */
  readonly #selected: (error: unknown) => void
  /** Capture one reporter without introducing any mutable global runtime manager. */
  constructor(report?: (error: unknown) => void) {
    this.#selected = report ?? defaultLogFailureReporter
  }
  /** Callback identity is stable when passed to rejection observation and event delivery. */
  readonly report = (error: unknown): void => this.#report(error)
  /** Contain synchronous throws and hostile then getters, forwarding custom failures once. */
  #report(error: unknown): void {
    /** A local binding deliberately calls user code without a class receiver. */
    const selected = this.#selected
    try {
      /** Diagnostics may return thenables despite their public void callback shape. */
      const result = selected(error)
      /** The canonical utility owns the only then getter read. */
      const probe = probeThenable(result)
      if (probe.kind === ThenableProbeKind.failed) this.#fallback(probe.error)
      else if (probe.kind === ThenableProbeKind.thenable)
        void assimilateCapturedThen(probe.thenFn, result).catch(this.#fallback)
    } catch (failure) {
      this.#fallback(failure)
    }
  }
  /** The terminal reporter itself never becomes another recursive reporting target. */
  readonly #fallback = (error: unknown): void => {
    if (this.#selected === defaultLogFailureReporter) return
    try {
      /** Keep the imported host reporter as the sole default diagnostic owner. */
      const result = defaultLogFailureReporter(error)
      /** Observe a mocked or injected terminal thenable without making it a host exception. */
      const probe = probeThenable(result)
      if (probe.kind === ThenableProbeKind.thenable)
        void assimilateCapturedThen(probe.thenFn, result).catch(ignoreDiagnosticFailure)
    } catch {
      /* Terminal failure intentionally ends this diagnostic path. */
    }
  }
}

/** Capture standalone store diagnostics with the shared host default and one custom fallback. */
export function durableReporter(report?: (error: unknown) => void): (error: unknown) => void {
  return new DurableReporter(report).report
}

/** Invoke an observer synchronously, then observe only its asynchronous failure. */
export function observeResult(run: () => unknown, report: (error: unknown) => void): void {
  try {
    /** Run once; the utilities preserve thenable getter and receiver semantics. */
    const result = run()
    /** Getter failures are data so the same failure callback handles both asynchronous forms. */
    const probe = probeThenable(result)
    if (probe.kind === ThenableProbeKind.failed) report(probe.error)
    else if (probe.kind === ThenableProbeKind.thenable)
      void assimilateCapturedThen(probe.thenFn, result).catch(report)
  } catch (error) {
    report(error)
  }
}

/** One immutable optional observer needs no independent registration or listener platform. */
class DurableObservation {
  /** Store and plugin factories capture exactly one observer before any resource is created. */
  readonly #observer: ILogStoreOptions['observe']
  /** Observation failure remains separate from committing or rejecting the storage operation. */
  readonly #report: (error: unknown) => void
  /** Capture callbacks without invoking user accessors during later operations. */
  constructor(options: ILogStoreOptions, report: (error: unknown) => void) {
    this.#observer = options.observe
    this.#report = report
  }
  /** Preserve lazy metadata construction when no observer is installed. */
  readonly observe = (make: () => ILogObservation): void => this.#observe(make)
  /** Freeze one metadata event and retain plain-function observer invocation. */
  #observe(make: () => ILogObservation): void {
    if (!this.#observer) return
    /** The callback's receiver stays undefined, matching the original subscriber projection. */
    const observer = this.#observer
    /** Observation is metadata-only and never contains a mutable committed row. */
    const event = Object.freeze(make())
    observeResult(() => observer(event), this.#report)
  }
}

/** Create one immutable observation owner, reusing its stable invocation callback. */
export function createObservation(
  options: ILogStoreOptions,
  report: (error: unknown) => void
): (make: () => ILogObservation) => void {
  return new DurableObservation(options, report).observe
}

/** Capture public callbacks before resource creation; invalid accessors retain their cause. */
export function captureStoreOptions(input: ILogStoreOptions | undefined): ILogStoreOptions {
  if (input === undefined) return {}
  try {
    if (!input || typeof input !== 'object')
      throw createDurableTypeError(LogDurableErrorCode.invalidOption, DurableText.invalidOption)
    /** Store callbacks are the only accepted diagnostic capabilities. */
    const observe = input.observe
    /** The reporter is borrowed and never disposed by the store. */
    const report = input.report
    if (
      (observe !== undefined && typeof observe !== 'function') ||
      (report !== undefined && typeof report !== 'function')
    )
      throw createDurableTypeError(LogDurableErrorCode.invalidOption, DurableText.invalidOption)
    return { observe, report }
  } catch (error) {
    if (
      error instanceof Error &&
      Object.getOwnPropertyDescriptor(error, DurableErrorField.source)?.value === ERROR_SOURCE
    )
      throw error
    throw createDurableTypeError(LogDurableErrorCode.invalidOption, DurableText.invalidOption, {
      cause: error
    })
  }
}
