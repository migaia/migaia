/**
 * Resolve complete call features once per namespace; concrete timeout/retry behavior stays outside
 * host.
 */
import {
  RpcCallFeatureKind,
  type IRpcAttempt,
  type IRpcCallFeature,
  type IRpcCallFeatures,
  type IRpcRetryFeature,
  type IRpcTimeoutFeature
} from '@migaia/rpc-contract/interfaces'
import { RpcCoreErrorCode } from '@migaia/rpc-contract/error-code'
import { tagRpcError } from '@migaia/rpc-contract/errors'
import { HostErrorText } from '../host/error-text.ts'

/** Reject unsupported policy syntax at the boundary without constructing a policy in host. */
function validateFeature(
  value: unknown,
  kind: (typeof RpcCallFeatureKind)[keyof typeof RpcCallFeatureKind]
): void {
  if (value === undefined || value === false) return
  if (
    value === null ||
    typeof value !== 'object' ||
    (value as IRpcCallFeature).kind !== kind ||
    typeof (value as IRpcCallFeature).run !== 'function'
  )
    throw tagRpcError(
      new TypeError(HostErrorText.callFeatureInvalid),
      RpcCoreErrorCode.invalidConfig
    )
}

/** Capture one plugin's two kinds in installation order and reject duplicate implementations. */
function captureFeatures(
  features: readonly unknown[],
  allowTransportFeatures = false
): IRpcCallFeatures {
  /** The result holds executing instances, never a second numeric configuration syntax. */
  const selected: { timeout?: IRpcTimeoutFeature; retry?: IRpcRetryFeature } = {}
  for (const feature of features) {
    /** Native transports may also contribute carrier and pool features owned elsewhere. */
    const kind =
      feature !== null && typeof feature === 'object'
        ? (feature as IRpcCallFeature).kind
        : undefined
    if (kind !== RpcCallFeatureKind.timeout && kind !== RpcCallFeatureKind.retry) {
      if (allowTransportFeatures) continue
      throw tagRpcError(
        new TypeError(HostErrorText.callFeatureInvalid),
        RpcCoreErrorCode.invalidConfig
      )
    }
    validateFeature(feature, kind)
    if (selected[kind] !== undefined)
      throw tagRpcError(
        new TypeError(HostErrorText.featureCombinationConflict),
        RpcCoreErrorCode.featureCombinationConflict
      )
    if (kind === RpcCallFeatureKind.timeout) selected.timeout = feature as IRpcTimeoutFeature
    else selected.retry = feature as IRpcRetryFeature
  }
  return Object.freeze(selected)
}

/** One originating execution surrounds each physical attempt with its selected timeout instance. */
class ScopedAttempt<T> {
  /** The originating owner retains payload/retry lifetime and enforces its shrinking deadline. */
  readonly #attempt: IRpcAttempt<T>
  /** This instance owns any actual timer; false/undefined means host adds no timer. */
  readonly #timeout: IRpcTimeoutFeature | false | undefined

  /** Retain only the explicit attempt port and already selected policy for this invocation. */
  constructor(attempt: IRpcAttempt<T>, timeout: IRpcTimeoutFeature | false | undefined) {
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
  run(retry: IRpcRetryFeature | false | undefined): Promise<T> {
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
  /** Link policy contributes executing instances before transport startup. */
  #defaults: IRpcCallFeatures = Object.freeze({})
  /** Native receipts withdraw failed or uninstalled policies without reviving a disposed default. */
  readonly #policies = new Map<object, IRpcCallFeatures>()
  /** Each namespace stores its resolved installation overlay for O(1) call selection. */
  readonly #namespaces = new Map<string, IRpcCallFeatures>()
  /** Raw transport selections allow defaults to be compiled once after cold registration. */
  readonly #installed = new Map<string, IRpcCallFeatures>()

  /** Capture one link-policy plugin's complete instances and refresh cold namespace caches. */
  setDefaults(features: readonly IRpcCallFeature[]): () => void {
    /** The receipt identifies only this native installation, including reuse of one definition. */
    const token = {}
    this.#policies.set(token, captureFeatures(features))
    this.#refreshDefaults()
    return () => {
      this.#policies.delete(token)
      this.#refreshDefaults()
    }
  }

  /** Cold candidate admission captures policies without changing the still-published namespace. */
  prepare(namespace: string, features: readonly unknown[] = []): () => void {
    /** One explicit commit input holds captured instances, never another policy registry. */
    const input = { namespace, installed: captureFeatures(features, true) }
    return () => this.#commit(input)
  }

  /** Direct owner installation uses the same cold parse and publication operation. */
  register(namespace: string, features: readonly IRpcCallFeature[] = []): void {
    this.prepare(namespace, features)()
  }

  /** A retiring namespace relinquishes its installation cache without retaining plugin instances. */
  unregister(namespace: string): void {
    this.#installed.delete(namespace)
    this.#namespaces.delete(namespace)
  }

  /** Merge only two fixed fields; false disables while undefined inherits the next owner. */
  resolve(namespace: string, options: IRpcCallFeatures = {}): IRpcCallFeatures {
    validateFeature(options.timeout, RpcCallFeatureKind.timeout)
    validateFeature(options.retry, RpcCallFeatureKind.retry)
    /** Cached defaults are immutable; a call overlay never changes the next call's policy. */
    const installed = this.#namespaces.get(namespace) ?? this.#defaults
    return {
      timeout: options.timeout === undefined ? installed.timeout : options.timeout,
      retry: options.retry === undefined ? installed.retry : options.retry
    }
  }

  /** Execute complete selected instances; retry encloses per-attempt timeout, only at the origin. */
  execute<T>(
    namespace: string,
    options: IRpcCallFeatures,
    attempt: IRpcAttempt<T>,
    cap: IRpcTimeoutFeature | undefined = attempt.facts?.callTimeoutCap
  ): Promise<T> {
    /** A call-only supplied feature works even when the installation has no same-kind instance. */
    const selected = this.resolve(namespace, options)
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

  /** Release installed policy references when the owning host reaches its terminal state. */
  close(): void {
    this.#policies.clear()
    this.#installed.clear()
    this.#namespaces.clear()
    this.#defaults = Object.freeze({})
  }

  /** Cold installation order selects the last live complete policy; no hot call scans policies. */
  #refreshDefaults(): void {
    this.#defaults = Object.freeze({})
    for (const features of this.#policies.values()) this.#defaults = features
    for (const [namespace, installed] of this.#installed) this.#cache(namespace, installed)
  }

  /** Compile installed precedence once; the hot path never scans plugins or feature arrays. */
  #cache(namespace: string, installed: IRpcCallFeatures): void {
    this.#namespaces.set(namespace, Object.freeze({ ...this.#defaults, ...installed }))
  }

  /** Native commit publishes only its already captured candidate policies. */
  #commit(input: Readonly<{ namespace: string; installed: IRpcCallFeatures }>): void {
    this.#installed.set(input.namespace, input.installed)
    this.#cache(input.namespace, input.installed)
  }
}
