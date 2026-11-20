import type { IReactiveSignal, IRuntime } from '@migaia/reactive'
import { PartHostErrorCode } from './error-code.ts'
import { PartHostErrorText } from './error-text.ts'
import { createPartHostError } from './errors.ts'
import { isThenable, type IDefaultStateStoreOptions, type IStateEquals } from './state-store.ts'

/**
 * Comparator of the longest `equalsBy` prefix matching `key` (segments split on `.`), or `equals`
 * when no prefix matches. Walks the key's own prefixes, so the cost is bounded by its segments.
 */
export function comparatorFor(
  options: IDefaultStateStoreOptions | undefined,
  key: string
): IStateEquals | undefined {
  if (options === undefined) return undefined
  /** Prefix table, if any. */
  const table = options.equalsBy
  if (table !== undefined) {
    /** Candidate prefix, shortened one segment at a time. */
    let prefix = key
    for (;;) {
      if (Object.hasOwn(table, prefix)) return table[prefix]
      /** End of the previous segment. */
      const dot = prefix.lastIndexOf('.')
      if (dot < 0) break
      prefix = prefix.slice(0, dot)
    }
  }
  return options.equals
}

/**
 * Runs a comparator after the identity check. A throw or a thenable result is reported as
 * STATE_EQUALS_FAILED (failure on `cause`) and counts as "changed"; a rejected thenable is observed
 * so it never becomes unhandled.
 */
export function compareValues(
  comparator: IStateEquals | undefined,
  previous: unknown,
  next: unknown,
  key: string,
  path: string,
  report: (error: unknown) => void
): boolean {
  if (Object.is(previous, next)) return true
  if (comparator === undefined) return false
  /** Comparator result. */
  let result: unknown
  try {
    result = comparator(previous, next, key)
  } catch (cause) {
    report(
      createPartHostError(
        PartHostErrorCode.stateEqualsFailed,
        PartHostErrorText.stateEqualsFailed(path),
        cause
      )
    )
    return false
  }
  if (isThenable(result)) {
    result.then(undefined, () => undefined)
    report(
      createPartHostError(
        PartHostErrorCode.stateEqualsFailed,
        PartHostErrorText.stateEqualsFailed(path)
      )
    )
    return false
  }
  return result === true
}

/**
 * Default store of `page`, `section` and `part`: one reactive signal per path holding the value.
 * Each signal compares through the currently registered `defaultStateStore` options, resolved at
 * comparison time, so registering, replacing or removing them applies to existing paths at once.
 */
export class DefaultStore {
  /** Runtime owning every path signal. */
  readonly #runtime: IRuntime
  /** Current default-store options, or `undefined` for plain `Object.is`; set by the router. */
  #options: IDefaultStateStoreOptions | undefined
  /** Host diagnostics for comparator failures. */
  readonly #report: (error: unknown) => void
  /** Paths written at least once, so `seed` never overwrites an authored or user value. */
  readonly #written = new Set<string>()
  /** Signals by state path. */
  readonly #signals = new Map<string, IReactiveSignal<unknown>>()

  /** Binds the store to a runtime and the host diagnostics. */
  constructor(runtime: IRuntime, report: (error: unknown) => void) {
    this.#runtime = runtime
    this.#report = report
  }

  /** Replaces the options every path compares with from now on; `undefined` means `Object.is`. */
  setOptions(options: IDefaultStateStoreOptions | undefined): void {
    this.#options = options
  }

  /** Comparison of one path through the current options; the signal already checked `Object.is`. */
  #equal(path: string, previous: unknown, next: unknown): boolean {
    /** Options at comparison time. */
    const options = this.#options
    if (options === undefined) return false
    return compareValues(comparatorFor(options, path), previous, next, path, path, this.#report)
  }

  /** Signal of a path, created on first use with `undefined`. */
  #signal(path: string): IReactiveSignal<unknown> {
    /** Existing signal. */
    let signal = this.#signals.get(path)
    if (signal === undefined) {
      signal = this.#runtime.signal<unknown>(undefined, {
        equals: (previous, next) => this.#options !== undefined && this.#equal(path, previous, next)
      })
      this.#signals.set(path, signal)
    }
    return signal
  }

  /**
   * Signal of a path this store already holds, or `undefined`. The router asks it first, so a known
   * default path costs one Map lookup and no namespace check.
   */
  known(path: string): IReactiveSignal<unknown> | undefined {
    return this.#signals.get(path)
  }

  /** Writes through a signal returned by `known`. */
  writeKnown(path: string, signal: IReactiveSignal<unknown>, value: unknown): void {
    this.#written.add(path)
    signal.value = value
  }

  /** Tracked read of a path. */
  read(path: string): unknown {
    return this.#signal(path).value
  }

  /** Writes a path and remembers that it was written; equal values keep the old one. */
  write(path: string, value: unknown): void {
    this.#written.add(path)
    this.#signal(path).value = value
  }

  /** Current value of a path without tracking. */
  peek(path: string): unknown {
    return this.#signals.get(path)?.peek()
  }

  /** Seeds a path only when it has never been written; earlier reads do not count. */
  seed(path: string, value: unknown): void {
    if (!this.#written.has(path)) this.write(path, value)
  }

  /** Releases every path signal. */
  dispose(): void {
    for (const signal of this.#signals.values()) signal.dispose()
    this.#signals.clear()
  }
}
