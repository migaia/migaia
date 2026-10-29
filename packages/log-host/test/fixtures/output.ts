import { deferred, type IDeferred } from '@migaia/utils/promise'
import { defineOutputPlugin } from '../../src/plugin.ts'
import type {
  ILogEntry,
  ILogFailure,
  ILogFeature,
  ILogFeatureRecord,
  ILogFormat,
  ILogOutputRecord
} from '../../src/typing.ts'

/** Shared transport fixture options describe independently observable delivery behavior. */
type ICaptureOptions = {
  name?: string
  features?: ILogFeatureRecord
  defaultFormat?: 'json' | 'plain' | ILogFeature
  failures?: number
  blocked?: Promise<void>
  retryDelay?: number
  trace?: string[]
  retryable?: boolean
  batchable?: boolean
}

/** One output fixture observes the public SDK without adding any production seam. */
export class CaptureOutput {
  /** Factory options belong to this fixture; no state is borrowed from host internals. */
  #options: ICaptureOptions
  /** Number of actual transport calls distinguishes retries from duplicate entry dispatch. */
  attempts = 0
  /** Retry hint invocation count proves hints are requested only between accepted retries. */
  hints = 0
  /** Delivered records are retained after successful completion only. */
  readonly records: ILogOutputRecord[] = []
  /** Each transport call observes its batch boundary independently. */
  readonly batches: readonly ILogOutputRecord[][] = []
  /** Selected installed format implementations expose the actual rendering policy. */
  readonly formats: ILogFormat[] = []
  /** Per-attempt cancellation signals are the real transport context values. */
  readonly signals: AbortSignal[] = []
  /**
   * Capture cancellation at transport entry before later registration cleanup can change the
   * signal.
   */
  readonly signalStates: boolean[] = []
  /** The first attempt provides an API-level barrier for deterministic scheduler advancement. */
  readonly started: IDeferred<void> = deferred<void>()
  /** The first successful transport call provides a barrier without forcing host flush. */
  readonly delivered: IDeferred<void> = deferred<void>()
  /** A stable original error makes final failure identity and retry consumption observable. */
  readonly failure = new Error('fixture delivery failure')
  /** Capture explicit test behavior once before the real SDK definition is constructed. */
  constructor(options: ICaptureOptions = {}) {
    this.#options = options
  }
  /** Create a normal output plugin with actual feature and format selection. */
  plugin() {
    return defineOutputPlugin({
      name: this.#options.name ?? 'capture',
      batchable: this.#options.batchable ?? true,
      features: this.#options.features,
      defaultFormat: this.#options.defaultFormat ?? 'json',
      deliver: (records, context) => this.deliver(records, context),
      retryDelay: () => this.retryDelay(),
      retryable: () => this.#options.retryable ?? true
    })
  }
  /** Observe actual transport entry before optionally failing or waiting on a borrowed test barrier. */
  deliver(
    records: readonly ILogOutputRecord[],
    context: Readonly<{ signal: AbortSignal; format: ILogFormat }>
  ): void | Promise<void> {
    this.attempts++
    this.#options.trace?.push('deliver')
    this.formats.push(context.format)
    this.signals.push(context.signal)
    this.signalStates.push(context.signal.aborted)
    this.started.resolve()
    if (this.attempts <= (this.#options.failures ?? 0)) throw this.failure
    if (this.#options.blocked) return this.completeLater(records)
    this.complete(records)
  }
  /** Complete a deliberately held transport only when its test-owned operation settles. */
  async completeLater(records: readonly ILogOutputRecord[]): Promise<void> {
    await this.#options.blocked
    this.complete(records)
  }
  /** Records are copied at the observation boundary so later buffers cannot alter the fixture. */
  complete(records: readonly ILogOutputRecord[]): void {
    for (const record of records) this.records.push(record)
    ;(this.batches as ILogOutputRecord[][]).push([...records])
    this.delivered.resolve()
  }
  /** Count server retry hints separately from actual attempt count. */
  retryDelay(): number | undefined {
    this.hints++
    return this.#options.retryDelay
  }
}

/** One named failure observer avoids nested callback fixtures and retains exact original values. */
export class FailureCapture {
  /** Failures are read only by the test after its explicit public barrier. */
  readonly failures: ILogFailure[] = []
  /** This callback remains stable when passed to host.onFailure. */
  readonly receive = (failure: ILogFailure): void => {
    this.failures.push(failure)
  }
}

/** Advance one real event-loop turn after manual clocks so their native Promise reactions settle. */
export function nextTurn(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}
/** Stable fixture projection keeps ordering assertions independent of transport record text. */
export function messageOf(record: ILogOutputRecord): string {
  return record.entry.message
}
/** Public entry identity transformation is used by feature validity controls. */
export function keepEntry(entry: ILogEntry): ILogEntry {
  return entry
}
