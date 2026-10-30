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
import type { IFeatureRecord } from '@migaia/plugin-host'
import { RpcCoreErrorCode } from '@migaia/rpc-contract/error-code'
import { tagRpcError } from '@migaia/rpc-contract/errors'
import { HostErrorText } from '../host/error-text.ts'
import { readRpcFeature, RpcCallFeatureRole } from '../sdk/metadata.ts'
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

/** Resolve role metadata once while consuming outputs from the original native registration. */
function captureFeatures(
  features: IFeatureRecord,
  outputs: Readonly<Record<string, unknown>>
): ISelectedCallFeatures {
  /** Only the two fixed call roles survive cold compilation into the namespace cache. */
  const selected: { timeout?: IRpcTimeoutExecution; retry?: IRpcRetryExecution } = {}
  for (const [name, feature] of Object.entries(features)) {
    /** Native admission has already authenticated every token; this metadata only selects its role. */
    const metadata = readRpcFeature(feature)
    if (metadata?.category !== 'call') continue
    /** Role keys never derive from caller aliases, which remain free for addressing and inference. */
    const role = metadata.role
    if (role !== RpcCallFeatureRole.timeout && role !== RpcCallFeatureRole.retry) continue
    if (selected[role] !== undefined)
      throw tagRpcError(
        new TypeError(HostErrorText.featureCombinationConflict),
        RpcCoreErrorCode.featureCombinationConflict
      )
    /** The executing object comes from the real registration, never from public token fields. */
    const output = outputs[name] as IRpcTimeoutExecution | IRpcRetryExecution | undefined
    if (!output || typeof output.run !== 'function') invalidCallFeature()
    selected[role] = output
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
  /** Link policy contributes executing instances before transport startup. */
  #defaults: ISelectedCallFeatures = Object.freeze({})
  /** Native receipts withdraw failed or uninstalled policies without reviving a disposed default. */
  readonly #policies = new Map<object, ISelectedCallFeatures>()
  /** Each namespace stores its resolved installation overlay for O(1) call selection. */
  readonly #namespaces = new Map<string, ISelectedCallFeatures>()
  /** Raw transport selections allow defaults to be compiled once after cold registration. */
  readonly #installed = new Map<string, ISelectedCallFeatures>()

  /** Capture one link-policy plugin's complete instances and refresh cold namespace caches. */
  setDefaults(features: IFeatureRecord, outputs: Readonly<Record<string, unknown>>): () => void {
    /** The receipt identifies only this native installation, including reuse of one definition. */
    const token = {}
    /** Policies from link-policy and feature carriers share one host-wide default layer. */
    const captured = captureFeatures(features, outputs)
    for (const policy of this.#policies.values())
      if (
        (captured.timeout !== undefined && policy.timeout !== undefined) ||
        (captured.retry !== undefined && policy.retry !== undefined)
      )
        throw tagRpcError(
          new TypeError(HostErrorText.featureCombinationConflict),
          RpcCoreErrorCode.featureCombinationConflict
        )
    this.#policies.set(token, captured)
    this.#refreshDefaults()
    return () => {
      this.#policies.delete(token)
      this.#refreshDefaults()
    }
  }

  /** Cold candidate admission captures policies without changing the still-published namespace. */
  prepare(
    namespace: string,
    features: IFeatureRecord = {},
    outputs: Readonly<Record<string, unknown>> = {}
  ): () => void {
    /** One explicit commit input holds captured instances, never another policy registry. */
    const input = { namespace, installed: captureFeatures(features, outputs) }
    return () => this.#commit(input)
  }

  /** Direct owner installation uses the same cold parse and publication operation. */
  register(
    namespace: string,
    features: IFeatureRecord = {},
    outputs: Readonly<Record<string, unknown>> = {}
  ): void {
    this.prepare(namespace, features, outputs)()
  }

  /** A retiring namespace relinquishes its installation cache without retaining plugin instances. */
  unregister(namespace: string): void {
    this.#installed.delete(namespace)
    this.#namespaces.delete(namespace)
  }

  /** Merge only two fixed fields; false disables while undefined inherits the next owner. */
  resolve(namespace: string, options: IRpcCallFeatures = {}): ISelectedCallFeatures {
    if (!options || typeof options !== 'object' || Array.isArray(options)) invalidCallFeature()
    /** Admission captures each caller choice before reading any execution policy parameters. */
    const timeout = options.timeout
    /** Retry uses the same data-container rule while retaining its existing option fields. */
    const retry = options.retry
    validateCallParameters(timeout)
    validateCallParameters(retry)
    /** Cached defaults are immutable; a call overlay never changes the next call's policy. */
    const installed = this.#namespaces.get(namespace) ?? this.#defaults
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

  /** Release installed policy references when the owning host reaches its terminal state. */
  close(): void {
    this.#policies.clear()
    this.#installed.clear()
    this.#namespaces.clear()
    this.#defaults = Object.freeze({})
  }

  /** Merge every live policy's disjoint roles cold; no hot call scans policies. */
  #refreshDefaults(): void {
    /** SetDefaults keeps roles disjoint across policies, so merging never drops a role. */
    const defaults: { timeout?: IRpcTimeoutExecution; retry?: IRpcRetryExecution } = {}
    for (const features of this.#policies.values()) Object.assign(defaults, features)
    this.#defaults = Object.freeze(defaults)
    for (const [namespace, installed] of this.#installed) this.#cache(namespace, installed)
  }

  /** Compile installed precedence once; the hot path never scans plugins or feature arrays. */
  #cache(namespace: string, installed: ISelectedCallFeatures): void {
    this.#namespaces.set(namespace, Object.freeze({ ...this.#defaults, ...installed }))
  }

  /** Native commit publishes only its already captured candidate policies. */
  #commit(input: Readonly<{ namespace: string; installed: ISelectedCallFeatures }>): void {
    this.#installed.set(input.namespace, input.installed)
    this.#cache(input.namespace, input.installed)
  }
}
