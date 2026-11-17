import type { IFeatureOverlayRole } from '@migaia/plugin-host/feature-overlay'
import { defineFeature, inspectFeatures } from '@migaia/plugin-host/features'
import type { IFeatureRecord } from '@migaia/plugin-host'
import type { ILogEntry, ILogFeature, ILogFeatureDefinition } from './typing.ts'
import { FeaturePhase, LogDeliveryPolicy } from './state-constants.ts'
import { invalidOption, isArrayOption } from './errors.ts'

/** Per-output batch capacity and drain options remain log-owned. */
export type IBatchOptions = {
  maxSize?: number
  maxWaitMs?: number
  maxConcurrentBatches?: number
  maxPendingBatches?: number
  drainTimeoutMs?: number
}
/** Retry attempts include the initial attempt; backoff uses its one-based failed attempt index. */
export type IRetryFeatureOptions = {
  attempts: number
  backoff?: number | ((attempt: number) => number)
}
/** Installed processing implementations carry log behavior without issuing feature identities. */
export type IFeatureImplementation =
  | {
      phase: 'entry'
      stage(
        entry: ILogEntry,
        randomUUID: () => string
      ): ILogEntry | undefined | Promise<ILogEntry | undefined>
    }
  | { phase: 'gate'; accept(entry: ILogEntry): boolean }
  | {
      phase: 'format'
      format(entry: ILogEntry): string
      paint?(tag: string, text: string): string
      dim?(text: string): string
      arguments?(entry: ILogEntry, isTTY: boolean): unknown[]
    }
  | { policy: typeof LogDeliveryPolicy.batch; phase: 'delivery'; options: Required<IBatchOptions> }
  | {
      policy: typeof LogDeliveryPolicy.retry
      phase: 'delivery'
      options: Required<IRetryFeatureOptions>
    }
  | { policy: typeof LogDeliveryPolicy.timeout; phase: 'delivery'; ms: number }

/** Native installation owns each runtime implementation and its caller-facing control methods. */
export type ILogFeatureRuntime<C extends object = Record<never, never>> = Readonly<{
  implementation: IFeatureImplementation
  controls: C
}>

/** One log-owned role projection serves installed-record admission and shared overlay composition. */
export function logFeatureRole(feature: IFeatureImplementation): IFeatureOverlayRole {
  return {
    role: feature.phase === FeaturePhase.delivery ? feature.policy : feature.phase,
    repeatable: feature.phase === FeaturePhase.entry || feature.phase === FeaturePhase.gate
  }
}

/**
 * Admit the native shape of a plugin's root record when the plugin is defined. Log roles are not
 * known here; `admitInstalledFeatures` checks them when the plugin installs.
 */
export function featureScope(record: IFeatureRecord = {}): void {
  if (isArrayOption(record)) throw invalidOption()
  try {
    // Native inspection owns exact-identity and dependency-graph admission.
    inspectFeatures(record)
  } catch (cause) {
    // Preserve the log boundary identity while retaining the native admission diagnostic.
    throw invalidOption(cause)
  }
}

/**
 * Admit one plugin's installed feature outputs and select their implementations by alias, in one
 * pass. Runs first in the plugin's install, before it owns any resource. Throws INVALID_OPTION when
 * an output is not a log feature, when a singular role repeats in the record, when an output plugin
 * (`output`) holds an entry feature, or when an entry-only output (`consumesText` false) holds a
 * format feature.
 */
export function admitInstalledFeatures(
  record: IFeatureRecord,
  outputs: Readonly<Record<string, unknown>>,
  output = false,
  consumesText = true
): Map<string, IFeatureImplementation> {
  /** This installed-policy projection is rebuilt only during installation. */
  const selected = new Map<string, IFeatureImplementation>()
  /** Singular roles already used by this record; a plugin applies each at most once. */
  const slots = new Set<PropertyKey>()
  for (const alias of Object.keys(record)) {
    /** Plugin-host guarantees an object output per alias; only log features carry this field. */
    const implementation = (outputs[alias] as Partial<ILogFeatureRuntime>).implementation
    if (!implementation) throw invalidOption()
    if (
      output &&
      (implementation.phase === FeaturePhase.entry ||
        (!consumesText && implementation.phase === FeaturePhase.format))
    )
      throw invalidOption()
    /** Format or delivery policy this feature occupies, if any. */
    const role = logFeatureRole(implementation)
    if (!role.repeatable) {
      if (slots.has(role.role)) throw invalidOption()
      slots.add(role.role)
    }
    selected.set(alias, implementation)
  }
  return selected
}

/** Define a third-party entry, gate or format feature; delivery factories remain package-owned. */
export function defineLogFeature(definition: ILogFeatureDefinition): ILogFeature {
  if (!definition) throw invalidOption()
  /** Capture caller getters once in declaration order before selecting supported phase fields. */
  const snapshot = { ...definition }
  if (snapshot.phase === FeaturePhase.entry && typeof snapshot.stage === 'function') {
    /**
     * Only the declared phase contract is captured; unrelated caller fields do not enter the
     * feature.
     */
    const implementation = Object.freeze({ phase: FeaturePhase.entry, stage: snapshot.stage })
    return defineFeature(() => ({
      implementation,
      controls: Object.freeze({})
    }))
  }
  if (snapshot.phase === FeaturePhase.gate && typeof snapshot.accept === 'function') {
    /** The cold definition preserves the exact predicate while native installation owns its output. */
    const implementation = Object.freeze({ phase: FeaturePhase.gate, accept: snapshot.accept })
    return defineFeature(() => ({
      implementation,
      controls: Object.freeze({})
    }))
  }
  if (snapshot.phase === FeaturePhase.format && typeof snapshot.format === 'function') {
    /** Console-specific callbacks remain formatter behavior, without identity or name fields. */
    const implementation = Object.freeze({
      phase: FeaturePhase.format,
      format: snapshot.format,
      paint: snapshot.paint,
      dim: snapshot.dim,
      arguments: snapshot.arguments
    })
    return defineFeature(() => ({
      implementation,
      controls: Object.freeze({})
    }))
  }
  throw invalidOption()
}

/** Select built-in delivery policy from an installed chain. */
export function deliveryFeature<P extends LogDeliveryPolicy>(
  features: readonly IFeatureImplementation[],
  policy: P
): Extract<IFeatureImplementation, { policy: P; phase: 'delivery' }> | undefined {
  for (const implementation of features)
    if (implementation.phase === FeaturePhase.delivery && implementation.policy === policy)
      return implementation as Extract<IFeatureImplementation, { policy: P; phase: 'delivery' }>
  return undefined
}

/** Apply every installed gate in declaring-record order within the output's gate phase. */
export function acceptsEntry(
  features: readonly Extract<IFeatureImplementation, { phase: 'gate' }>[],
  entry: ILogEntry
): boolean {
  for (const implementation of features) if (!implementation.accept(entry)) return false
  return true
}
