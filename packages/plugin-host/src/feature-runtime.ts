/**
 * Compiles trusted Feature graphs and constructs registration-local outputs; Host owns their
 * lifecycle.
 */
import { assimilateCapturedThen, probeThenable } from '@migaia/utils/function'
import { invokeCaptured } from './invocation.ts'
import ERROR_TEXT, { createPluginHostTypeError, PluginHostError } from './error-text.ts'
import { PluginHostErrorCode } from './error-code.ts'
import { isFeatureReference, readDefinedFeature, snapshotFeatureRecord } from './define-feature.ts'
import type { IFeature, IFeatureInspection, IFeatureRecord } from './feature-types.ts'
import { buildCapabilityTopology } from '@migaia/capability/graph/topology'
import { containAsyncRejection } from '@migaia/lifecycle'
import { reportTerminalFailure } from './diagnostic-report.ts'

/** One canonical identity-to-topology compilation shared by preflight and registration execution. */
type IFeaturePlan = Readonly<{
  readonly ordered: readonly object[]
  readonly dependencies: ReadonlyMap<object, Readonly<Record<string, object>>>
}>

/** Projects opaque Feature identities into capability topology without evaluating user factories. */
export const compileFeatures = (roots: Readonly<Record<string, object>>): IFeaturePlan => {
  roots = snapshotFeatureRecord(roots)
  /** Each trusted local Feature receives one stable topology identity during this compilation. */
  const identifiers = new Map<object, string>()
  /** Direct aliases remain attached to their canonical Feature identity. */
  const dependencies = new Map<object, Readonly<Record<string, object>>>()
  /** Cursor traversal visits each local Feature once and adds its direct dependencies. */
  const pending: object[] = Object.values(roots)
  for (let index = 0; index < pending.length; index += 1) {
    /** Current trusted identity is skipped if an earlier alias already compiled it. */
    const feature = pending[index]!
    if (isFeatureReference(feature)) continue
    if (identifiers.has(feature)) continue
    /** Trusted metadata supplies factories and aliases without running user code. */
    const definition = readDefinedFeature(feature)!
    /** Local topology key is one-off compilation data, never a public identifier. */
    const identifier = `feature-${identifiers.size}`
    identifiers.set(feature, identifier)
    dependencies.set(feature, definition.dependencies)
    for (const dependency of Object.values(definition.dependencies))
      if (!isFeatureReference(dependency)) pending.push(dependency)
  }
  /** Reverse identity index is built once for the complete local Feature graph. */
  const byIdentifier = new Map<string, object>()
  /** Capability receives one node and edge record per trusted graph item. */
  const nodes: Array<{
    id: string
    ordinal: number
    dependencies: Array<{ provider: string; required: true }>
  }> = []
  for (const [feature, id] of identifiers) {
    byIdentifier.set(id, feature)
    /** Only local edges enter this topology; cross-plugin references retain their external owner. */
    const edges: Array<{ provider: string; required: true }> = []
    for (const dependency of Object.values(dependencies.get(feature) ?? {}))
      if (!isFeatureReference(dependency))
        edges.push({ provider: identifiers.get(dependency)!, required: true })
    nodes.push({ id, ordinal: nodes.length, dependencies: edges })
  }
  /** Existing capability topology retains dependency-first ordering and failure classification. */
  const topology = buildCapabilityTopology(
    nodes,
    () => {
      throw createPluginHostTypeError(ERROR_TEXT.FEATURE_DEPENDENCIES_DEFINED)
    },
    () => {
      throw createPluginHostTypeError(ERROR_TEXT.FEATURE_DEPENDENCIES_CYCLE)
    },
    () => {
      throw createPluginHostTypeError(ERROR_TEXT.FEATURE_DEPENDENCIES_DEFINED)
    }
  )
  return Object.freeze({
    ordered: Object.freeze(
      topology.ordered.map((node: { readonly id: string }) => byIdentifier.get(node.id)!)
    ),
    dependencies
  })
}

/**
 * Returns a frozen root map and dependency-first local-closure array without running factories or
 * creating a registration. Use it for definition inspection; cross-plugin references remain
 * external edges. Invalid/untrusted roots or cyclic local dependencies throw INVALID_OPTION.
 */
export const inspectFeatures = <TFeatures extends IFeatureRecord>(
  roots: TFeatures
): IFeatureInspection<TFeatures> => {
  /** Inspection reuses the same canonical graph compilation as installation. */
  const plan = compileFeatures(roots)
  return Object.freeze({
    roots: Object.freeze({ ...roots }) as TFeatures,
    ordered: Object.freeze([...plan.ordered]) as readonly IFeature<any, any, any>[]
  })
}

/** Owns the explicit expose receiver and revocation check for one captured Feature method. */
class FeatureExposeInvocation {
  /** Original admitted expose surface remains the callable receiver. */
  readonly #receiver: object
  /** Captured data descriptor value is never re-read from the input object. */
  readonly #value: Function
  /** Registration owner decides when the exposed capability is revoked. */
  readonly #isValid: () => boolean

  /** Captures one method without transferring lifecycle ownership. */
  constructor(receiver: object, value: Function, isValid: () => boolean) {
    this.#receiver = receiver
    this.#value = value
    this.#isValid = isValid
  }

  /** Checks revocation synchronously and forwards the original receiver and arguments. */
  invoke(args: unknown[]): unknown {
    /** Preserve the original standalone predicate receiver. */
    const isValid = this.#isValid
    if (!isValid())
      throw new PluginHostError(
        PluginHostErrorCode.registrationRevoked,
        ERROR_TEXT.REGISTRATION_REVOKED
      )
    return invokeCaptured(this.#value, this.#receiver, args)
  }
}

/** Copies explicit expose methods into a registration-owned immutable facade. */
export const snapshotFeatureExpose = (value: object, isValid: () => boolean): object => {
  /** Null-prototype output owns only explicitly admitted enumerable callable descriptors. */
  const snapshot: Record<PropertyKey, unknown> = Object.create(null)
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string')
      throw createPluginHostTypeError(ERROR_TEXT.PLUGIN_FEATURE_EXPOSE_DATA)
    /** Own-data admission avoids executing accessors while capturing the public facade. */
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (
      !descriptor ||
      !('value' in descriptor) ||
      !descriptor.enumerable ||
      typeof descriptor.value !== 'function'
    )
      throw createPluginHostTypeError(ERROR_TEXT.PLUGIN_FEATURE_EXPOSE_DATA)
    /** Invocation state belongs to one explicit owner rather than the descriptor-building loop. */
    const owner = new FeatureExposeInvocation(value, descriptor.value, isValid)
    Object.defineProperty(snapshot, key, {
      value: (...args: unknown[]) => owner.invoke(args),
      enumerable: true,
      configurable: false,
      writable: false
    })
  }
  return Object.freeze(snapshot)
}

/** Owns rejection reporting and the existing single reporter-failure fallback. */
class FeatureRejectionReporter {
  /** Registration diagnostic outlet may be absent; reporting stays optional as before. */
  readonly #report: ((error: unknown) => void) | undefined
  /** Final sink receives a second reporter failure without starting another reporting loop. */
  readonly #terminal: (failure: unknown) => void

  /** Captures the existing outlets without registering listeners or pending work. */
  constructor(
    report: ((error: unknown) => void) | undefined,
    terminal: (failure: unknown) => void
  ) {
    this.#report = report
    this.#terminal = terminal
  }

  /** Reports the original rejection and retains its identity if that outlet fails. */
  report(error: unknown): void {
    /** The original reporter is invoked as a standalone callback, never as an owner method. */
    const report = this.#report
    try {
      containAsyncRejection(report?.(error), (failure) => this.#reportFailure(error, failure))
    } catch (failure) {
      this.#reportFailure(error, failure)
    }
  }

  /** Re-reports once with both original errors reachable, then delegates any failure to the sink. */
  #reportFailure(error: unknown, failure: unknown): void {
    /** Error order and native aggregate identity remain part of the existing reporting contract. */
    const wrapped = new PluginHostError(
      PluginHostErrorCode.pluginInstallFailed,
      ERROR_TEXT.FEATURE_REJECTION_REPORT_FAILED,
      { cause: new AggregateError([error, failure], ERROR_TEXT.FEATURE_REJECTION_REPORT_FAILED) }
    )
    /** Reporter and terminal sink retain their original standalone receivers. */
    const report = this.#report
    /** The existing sink receives a second failure without another wrapper or retry. */
    const terminal = this.#terminal
    try {
      containAsyncRejection(report?.(wrapped), terminal)
    } catch (terminalFailure) {
      terminal(terminalFailure)
    }
  }
}

/** Creates one registration-local closure from trusted roots and one explicit expose surface. */
export const instantiateFeatures = (
  roots: Readonly<Record<string, object>>,
  featureExpose: object,
  plan = compileFeatures(roots),
  report?: (error: unknown) => void,
  resolveReference?: (
    reference: import('./feature-types.ts').IFeatureReference<object, boolean>
  ) => object | undefined,
  /** Receives reporter failures that cannot be re-reported; defaults to the runtime sink. */
  terminal: (failure: unknown) => void = reportTerminalFailure,
  /** Registration-scoped pipeline authority is borrowed from the original native core. */
  pipeline?: (name: string, feature: object) => object
): Readonly<Record<string, object>> => {
  /** Shared explicit reporting owner preserves the existing one-fallback failure policy. */
  const reporter = new FeatureRejectionReporter(report, terminal)
  /** Registration-local outputs become available only after their dependencies initialize. */
  const outputs = new Map<object, object>()
  for (const feature of plan.ordered) {
    /** Trusted metadata supplies factories and aliases without running user code. */
    const definition = readDefinedFeature(feature)!
    /** Factory receives only declared local and cross-plugin dependency outputs. */
    const dependencies: Record<string, object> = Object.create(null)
    for (const [name, dependency] of Object.entries(plan.dependencies.get(feature) ?? {})) {
      if (isFeatureReference(dependency)) {
        /** Canonical Host handle resolution enforces cross-plugin availability. */
        const resolved = resolveReference?.(dependency)
        if (resolved !== undefined) dependencies[name] = resolved
        else if (!dependency.optional)
          throw new PluginHostError(
            PluginHostErrorCode.prerequisiteMissing,
            ERROR_TEXT.PREREQUISITE_MISSING(dependency.plugin, dependency.feature)
          )
      } else dependencies[name] = outputs.get(dependency)!
    }
    /** Exact synchronous factory output is validated before it becomes visible to dependents. */
    const output = invokeCaptured(definition.factory, undefined, [
      Object.freeze({ featureExpose, pipeline: (name: string) => pipeline?.(name, feature) }),
      Object.freeze(dependencies)
    ])
    /** Captured thenable inspection preserves one-time property reads and original rejection. */
    const thenable = output && typeof output === 'object' ? probeThenable(output) : undefined
    if (
      !output ||
      typeof output !== 'object' ||
      thenable?.kind === 'thenable' ||
      thenable?.kind === 'failed'
    ) {
      /** Primary output-admission error remains linked to any late original factory failure. */
      const rejection = createPluginHostTypeError(ERROR_TEXT.FEATURE_FACTORY_OUTPUT)
      if (thenable?.kind === 'failed') {
        Object.defineProperty(rejection, 'cause', { value: thenable.error })
        reporter.report(thenable.error)
      }
      if (thenable?.kind === 'thenable')
        void assimilateCapturedThen(thenable.thenFn, output).catch((error) => {
          Object.defineProperty(rejection, 'cause', { value: error })
          reporter.report(error)
        })
      throw rejection
    }
    outputs.set(feature, Object.freeze(output))
  }
  /** Only selected roots enter the public map; local dependencies stay private. */
  const rootOutputs: Record<string, object> = Object.create(null)
  for (const [name, feature] of Object.entries(roots)) rootOutputs[name] = outputs.get(feature)!
  return Object.freeze(rootOutputs)
}
