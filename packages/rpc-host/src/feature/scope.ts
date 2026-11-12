import { FeatureOverlay, type IFeatureOverlayEntry } from '@migaia/plugin-host/feature-overlay'
/**
 * Resolve complete call features once per namespace; concrete timeout/retry behavior stays outside
 * host.
 */
import type {
  IRpcAttempt,
  IRpcCallFeatures,
  IRpcRetryExecution,
  IRpcTimeoutExecution
} from '@migaia/rpc-contract/interfaces'
import type { IFeatureRecord, IPluginHostCore } from '@migaia/plugin-host'
import { RpcCoreErrorCode } from '@migaia/rpc-contract/error-code'
import { tagRpcError } from '@migaia/rpc-contract/errors'
import { HostErrorText } from '../host/error-text.ts'
import {
  readRpcFeature,
  RpcCallFeatureRole,
  callFeatureRole,
  RpcFeatureCategory
} from '../sdk/metadata.ts'
import { createRpcTimeoutExecution } from '../features/timeout.ts'
import { createRpcRetryExecution } from '../features/retry.ts'

/** Compiled installations retain execution owners; calls never hold a native Feature token. */
export type ISelectedCallFeatures = Readonly<{
  timeout?: IRpcTimeoutExecution | false
  retry?: IRpcRetryExecution | false
}>

/** Reject malformed call data or an inconsistent native installation with the established error. */
function invalidCallFeature(): never {
  throw tagRpcError(new TypeError(HostErrorText.callFeatureInvalid), RpcCoreErrorCode.invalidConfig)
}

/** Keep malformed role containers on the original native TypeError admission boundary. */
function validateCallParameters(value: unknown): void {
  if (value === undefined || value === false) return
  if (value === null || typeof value !== 'object' || Array.isArray(value)) invalidCallFeature()
}

/** Domain payload keeps execution ownership and fixed call-role meaning out of plugin-host. */
type IInstalledCallFeature = Readonly<{
  role: 'timeout' | 'retry'
  execution: IRpcTimeoutExecution | IRpcRetryExecution
}>
/** Resolve role metadata once while consuming actual native-installed outputs. */
function captureFeatures(
  features: IFeatureRecord,
  outputs: Readonly<Record<string, unknown>>
): readonly IFeatureOverlayEntry<IInstalledCallFeature>[] {
  /** Original aliases remain addressing data; role meaning stays in the domain payload. */
  const selected: IFeatureOverlayEntry<IInstalledCallFeature>[] = []
  for (const [name, feature] of Object.entries(features)) {
    /** Native admission has authenticated tokens before role projection. */
    const metadata = readRpcFeature(feature)
    if (metadata?.category !== RpcFeatureCategory.call) continue
    /** Only the established two call roles join this composition owner. */
    const role = metadata.role
    if (role !== RpcCallFeatureRole.timeout && role !== RpcCallFeatureRole.retry) continue
    /** Executing objects come from native installation, never copied token fields. */
    const execution = outputs[name] as IRpcTimeoutExecution | IRpcRetryExecution | undefined
    if (!execution || typeof execution.run !== 'function') invalidCallFeature()
    selected.push({ alias: name, value: { role, execution } })
  }
  // Frozen, so the overlay can reuse its normalization on every later compile.
  return Object.freeze(selected)
}
/** Materialize the fixed domain cache once per cold notification. */
function compileFeatures(
  entries: readonly IFeatureOverlayEntry<IInstalledCallFeature>[]
): ISelectedCallFeatures {
  /** Runtime meanings remain separated by their original role discriminant. */
  const selected: { timeout?: IRpcTimeoutExecution; retry?: IRpcRetryExecution } = {}
  for (const { value } of entries) {
    if (value.role === RpcCallFeatureRole.timeout)
      selected.timeout = value.execution as IRpcTimeoutExecution
    else selected.retry = value.execution as IRpcRetryExecution
  }
  return Object.freeze(selected)
}

/** One originating execution surrounds each physical attempt with its selected timeout instance. */
class ScopedAttempt<T> {
  /** The originating owner retains payload/retry lifetime and enforces its shrinking deadline. */
  readonly #attempt: IRpcAttempt<T>
  /** This instance owns any actual timer; false/undefined means host adds no timer. */
  readonly #timeout: IRpcTimeoutExecution | false | undefined

  /** Retain only the explicit attempt port and already selected policy for this invocation. */
  constructor(attempt: IRpcAttempt<T>, timeout: IRpcTimeoutExecution | false | undefined) {
    this.#attempt = attempt
    this.#timeout = timeout
  }

  /** A retry supplies one attempt's signal/budget; the CallTable intersects inherited elapsed time. */
  readonly invoke: IRpcAttempt<T>['invoke'] = (signal, remainingMs, options) => {
    if (!this.#timeout) return this.#attempt.invoke(signal, remainingMs, options)
    return this.#timeout.run({
      signal,
      remainingMs,
      facts: this.#attempt.facts,
      invoke: (selectedSignal, budget, selectedOptions) =>
        this.#attempt.invoke(selectedSignal, budget, selectedOptions ?? options)
    })
  }

  /** Retry owns repeated attempts and backoff; a host without it executes exactly once. */
  run(retry: IRpcRetryExecution | false | undefined): Promise<T> {
    if (retry)
      return retry.run({
        signal: this.#attempt.signal,
        remainingMs: this.#attempt.remainingMs,
        facts: this.#attempt.facts,
        invoke: this.invoke
      })
    return this.invoke(this.#attempt.signal, this.#attempt.remainingMs)
  }
}

/** Own installation caches and the sole call > transport > link-policy precedence rule. */
export class FeatureScope {
  /** Original namespace cache is the only object selected by calls without overrides. */
  readonly #namespaces = new Map<
    string,
    Readonly<{
      local: readonly IFeatureOverlayEntry<IInstalledCallFeature>[]
      selected: ISelectedCallFeatures
    }>
  >()
  /** Shared composition owns roles and native publication; RPC owns execution/cache meaning. */
  readonly #overlay = new FeatureOverlay<IInstalledCallFeature>(callFeatureRole)
  /** Inherited-only selection for unregistered namespaces; reset whenever defaults change. */
  #defaults: ISelectedCallFeatures | undefined

  /** Startup-only policies enter the rule owner before any transport cache is published. */
  setDefaults(
    core: IPluginHostCore,
    features: IFeatureRecord,
    outputs: Readonly<Record<string, unknown>>
  ): void {
    /** Empty policies own no call role and require no composition receipt. */
    const captured = captureFeatures(features, outputs)
    if (captured.length === 0) return
    /** Existing native lifetime remains the only contribution identity. */
    const owner = core.lifecycle.signal
    this.#overlay.prepare(owner, captured)
    try {
      core.onDispose(() => this.#releaseDefaults(owner))
    } catch (error) {
      // Without a cleanup receipt nothing would release the reservation, so drop it now.
      this.#overlay.remove(owner)
      throw error
    }
    this.#overlay.commit(owner)
    this.#defaults = undefined
  }

  /**
   * Original namespace publication commits one precompiled cache; no notification owner is
   * imported.
   */
  prepare(
    namespace: string,
    features: IFeatureRecord = {},
    outputs: Readonly<Record<string, unknown>> = {}
  ): () => void {
    /** Inputs are retained only for supported native policy withdrawal during cleanup. */
    const local = captureFeatures(features, outputs)
    /** Compilation precedes transport startup; the native namespace receipt publishes it once. */
    const cache = { local, selected: compileFeatures(this.#overlay.compile(local)) }
    return () => this.#namespaces.set(namespace, cache)
  }

  /** Retiring namespace releases its domain cache; native cleanup removes the overlay receipt. */
  unregister(namespace: string): void {
    this.#namespaces.delete(namespace)
  }

  /** Merge only two fixed fields; false disables while undefined inherits the next owner. */
  resolve(namespace: string, options?: IRpcCallFeatures): ISelectedCallFeatures {
    if (
      options !== undefined &&
      (!options || typeof options !== 'object' || Array.isArray(options))
    )
      invalidCallFeature()
    /** Admission captures each caller choice before reading any execution policy parameters. */
    const timeout = options?.timeout
    /** Retry uses the same data-container rule while retaining its existing option fields. */
    const retry = options?.retry
    validateCallParameters(timeout)
    validateCallParameters(retry)
    /**
     * Registered namespaces borrow their precompiled domain projection; cold fallback uses the sole
     * rule owner.
     */
    const installed =
      this.#namespaces.get(namespace)?.selected ??
      (this.#defaults ??= compileFeatures(this.#overlay.compile()))
    /** Without call overrides the frozen installed selection is reused, allocating nothing. */
    if (timeout === undefined && retry === undefined) return installed
    return {
      timeout:
        timeout === undefined
          ? installed.timeout
          : timeout === false
            ? false
            : createRpcTimeoutExecution(timeout),
      retry:
        retry === undefined
          ? installed.retry
          : retry === false
            ? false
            : createRpcRetryExecution(retry)
    }
  }

  /** Execute complete selected instances; retry encloses per-attempt timeout, only at the origin. */
  execute<T>(
    namespace: string,
    options: IRpcCallFeatures,
    attempt: IRpcAttempt<T>,
    cap: IRpcTimeoutExecution | undefined = attempt.facts?.callTimeoutCap
  ): Promise<T> {
    return this.executeSelected(this.resolve(namespace, options), attempt, cap)
  }

  /** Execute one admission's captured owners without resolving plain parameters a second time. */
  executeSelected<T>(
    selected: ISelectedCallFeatures,
    attempt: IRpcAttempt<T>,
    cap: IRpcTimeoutExecution | undefined = attempt.facts?.callTimeoutCap
  ): Promise<T> {
    /** Native execution limits surround the entire origin, independently of optional call policies. */
    if (!cap) return new ScopedAttempt(attempt, selected.timeout).run(selected.retry)
    return cap.run({
      signal: attempt.signal,
      remainingMs: attempt.remainingMs,
      facts: attempt.facts,
      invoke: (signal, remainingMs) =>
        new ScopedAttempt(
          { signal, remainingMs, facts: attempt.facts, invoke: attempt.invoke },
          selected.timeout
        ).run(selected.retry)
    })
  }

  /** Native registration cleanup owns overlay withdrawal; the closing domain forgets its caches. */
  close(): void {
    this.#namespaces.clear()
  }

  /**
   * Native withdrawal preserves supported unUse semantics without a generic notifier or second
   * registry.
   */
  #releaseDefaults(owner: object): void {
    if (!this.#overlay.remove(owner)) return
    this.#defaults = undefined
    // RpcCallFeatureRole fixes two singular global roles; each namespace compiles at most two values.
    for (const [namespace, cache] of this.#namespaces)
      this.#namespaces.set(namespace, {
        local: cache.local,
        selected: compileFeatures(this.#overlay.compile(cache.local))
      })
  }
}
