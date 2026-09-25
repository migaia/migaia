import { invokeCaptured } from './invocation.js'
import ERROR_TEXT, { createPluginHostTypeError, PluginHostError } from './error-text.js'
import { PluginHostErrorCode } from './error-code.js'
import { isFeatureReference, readDefinedFeature, snapshotFeatureRecord } from './define-feature.js'
import type { IFeature, IFeatureInspection, IFeatureRecord } from './feature-types.js'
import { buildCapabilityTopology } from '@migaia/capability/graph/topology'
import { assimilateCapturedThen, containAsyncRejection, probeThenable } from '@migaia/lifecycle'
import { reportTerminalFailure } from './diagnostic-report.js'

/** One canonical identity-to-topology compilation shared by preflight and registration execution. */
type IFeaturePlan = Readonly<{
  readonly ordered: readonly object[]
  readonly dependencies: ReadonlyMap<object, Readonly<Record<string, object>>>
}>

/** Projects opaque Feature identities into capability topology without evaluating user factories. */
export const compileFeatures = (roots: Readonly<Record<string, object>>): IFeaturePlan => {
  roots = snapshotFeatureRecord(roots)
  const identifiers = new Map<object, string>()
  const dependencies = new Map<object, Readonly<Record<string, object>>>()
  const pending: object[] = Object.values(roots)
  for (let index = 0; index < pending.length; index += 1) {
    const feature = pending[index]!
    if (isFeatureReference(feature)) continue
    if (identifiers.has(feature)) continue
    const definition = readDefinedFeature(feature)!
    const identifier = `feature-${identifiers.size}`
    identifiers.set(feature, identifier)
    dependencies.set(feature, definition.dependencies)
    for (const dependency of Object.values(definition.dependencies))
      if (!isFeatureReference(dependency)) pending.push(dependency)
  }
  const byIdentifier = new Map([...identifiers].map(([feature, id]) => [id, feature]))
  const topology = buildCapabilityTopology(
    [...identifiers].map(([feature, id], ordinal) => ({
      id,
      ordinal,
      dependencies: Object.values(dependencies.get(feature) ?? {})
        .filter((dependency) => !isFeatureReference(dependency))
        .map((dependency) => ({
          provider: identifiers.get(dependency)!,
          required: true as const
        }))
    })),
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

/** Inspects trusted Feature topology without invoking factories or creating registration state. */
export const inspectFeatures = <TFeatures extends IFeatureRecord>(
  roots: TFeatures
): IFeatureInspection<TFeatures> => {
  const plan = compileFeatures(roots)
  return Object.freeze({
    roots: Object.freeze({ ...roots }) as TFeatures,
    ordered: Object.freeze([...plan.ordered]) as readonly IFeature<any, any, any>[]
  })
}

/** Copies explicit expose methods into a registration-owned immutable facade. */
export const snapshotFeatureExpose = (value: object, isValid: () => boolean): object => {
  const snapshot: Record<PropertyKey, unknown> = Object.create(null)
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string')
      throw createPluginHostTypeError(ERROR_TEXT.PLUGIN_FEATURE_EXPOSE_DATA)
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (
      !descriptor ||
      !('value' in descriptor) ||
      !descriptor.enumerable ||
      typeof descriptor.value !== 'function'
    )
      throw createPluginHostTypeError(ERROR_TEXT.PLUGIN_FEATURE_EXPOSE_DATA)
    Object.defineProperty(snapshot, key, {
      value: (...args: unknown[]) => {
        if (!isValid())
          throw new PluginHostError(
            PluginHostErrorCode.registrationRevoked,
            ERROR_TEXT.REGISTRATION_REVOKED
          )
        return invokeCaptured(descriptor.value as Function, value, args)
      },
      enumerable: true,
      configurable: false,
      writable: false
    })
  }
  return Object.freeze(snapshot)
}

/** Creates one registration-local closure from trusted roots and one explicit expose surface. */
export const instantiateFeatures = (
  roots: Readonly<Record<string, object>>,
  featureExpose: object,
  plan = compileFeatures(roots),
  report?: (error: unknown) => void,
  resolveReference?: (
    reference: import('./feature-types.js').IFeatureReference<object, boolean>
  ) => object | undefined,
  /** Receives reporter failures that cannot be re-reported; defaults to the runtime sink. */
  terminal: (failure: unknown) => void = reportTerminalFailure
): Readonly<Record<string, object>> => {
  /**
   * Reports a rejected factory result. When the reporter itself fails, the rejection is re-reported
   * once inside a wrapper whose `cause` is an `AggregateError` of `[rejection, reporterFailure]`,
   * so both stay reachable and the rejection's own `cause` is never overwritten. A second reporter
   * failure is forwarded to the terminal sink instead of being swallowed.
   */
  const reportRejection = (error: unknown): void => {
    /** Re-reports the original rejection together with the reporter failure. */
    const reportFailure = (failure: unknown): void => {
      const wrapped = new PluginHostError(
        PluginHostErrorCode.pluginInstallFailed,
        ERROR_TEXT.FEATURE_REJECTION_REPORT_FAILED,
        { cause: new AggregateError([error, failure], ERROR_TEXT.FEATURE_REJECTION_REPORT_FAILED) }
      )
      try {
        containAsyncRejection(report?.(wrapped), terminal)
      } catch (terminalFailure) {
        terminal(terminalFailure)
      }
    }
    try {
      containAsyncRejection(report?.(error), reportFailure)
    } catch (failure) {
      reportFailure(failure)
    }
  }
  const outputs = new Map<object, object>()
  for (const feature of plan.ordered) {
    const definition = readDefinedFeature(feature)!
    const dependencies: Record<string, object> = Object.create(null)
    for (const [name, dependency] of Object.entries(plan.dependencies.get(feature) ?? {})) {
      if (isFeatureReference(dependency)) {
        const resolved = resolveReference?.(dependency)
        if (resolved !== undefined) dependencies[name] = resolved
        else if (!dependency.optional)
          throw new PluginHostError(
            PluginHostErrorCode.prerequisiteMissing,
            ERROR_TEXT.PREREQUISITE_MISSING(dependency.plugin, dependency.feature)
          )
      } else dependencies[name] = outputs.get(dependency)!
    }
    const output = invokeCaptured(definition.factory, undefined, [
      Object.freeze({ featureExpose }),
      Object.freeze(dependencies)
    ])
    const thenable = output && typeof output === 'object' ? probeThenable(output) : undefined
    if (
      !output ||
      typeof output !== 'object' ||
      thenable?.kind === 'thenable' ||
      thenable?.kind === 'failed'
    ) {
      const rejection = createPluginHostTypeError(ERROR_TEXT.FEATURE_FACTORY_OUTPUT)
      if (thenable?.kind === 'failed') {
        Object.defineProperty(rejection, 'cause', { value: thenable.error })
        reportRejection(thenable.error)
      }
      if (thenable?.kind === 'thenable')
        void assimilateCapturedThen(thenable.thenFn, output).catch((error) => {
          try {
            Object.defineProperty(rejection, 'cause', { value: error })
          } catch (attachFailure) {
            reportRejection(ERROR_TEXT.CAUSE_ATTACH_FAILED(String(attachFailure)))
          }
          reportRejection(error)
        })
      throw rejection
    }
    outputs.set(feature, Object.freeze(output))
  }
  const rootOutputs: Record<string, object> = Object.create(null)
  for (const [name, feature] of Object.entries(roots)) rootOutputs[name] = outputs.get(feature)!
  return Object.freeze(rootOutputs)
}
