import { defineFeature, type IFeature, type IFeatureRecord } from '@migaia/plugin-host'
import { inspectFeatures } from '@migaia/plugin-host/composition'
import type { ILogEntry, ILogFeature, ILogFeatureDefinition } from './typing.ts'
import { FeaturePhase, LogDeliveryPolicy } from './state-constants.ts'
import { invalidOption } from './errors.ts'

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

/** Log-only policy data belongs to the native definition; scope markers carry no entry behavior. */
export type ILogFeatureMetadata = Readonly<{
  phase: IFeatureImplementation['phase']
  policy?: LogDeliveryPolicy
}>

/**
 * A singular slot is a policy an output can apply only once: its formatter or one built-in delivery
 * policy (batch, retry, timeout). Entry stages and gates repeat freely and have no slot.
 */
export function singularSlot(
  feature: IFeatureImplementation | ILogFeatureMetadata
): string | undefined {
  if (feature.phase === FeaturePhase.format) return FeaturePhase.format
  if (feature.phase === FeaturePhase.delivery) return feature.policy
  return undefined
}

/** Native features are the keys; this table describes log policies and grants no issuance authority. */
const logFeatureMetadata = new WeakMap<object, ILogFeatureMetadata>()

/** Describe an existing native feature; the native owner remains its sole identity authority. */
export function registerLogFeatureMetadata(
  feature: IFeature<any, any, any>,
  metadata: ILogFeatureMetadata
): void {
  logFeatureMetadata.set(feature, Object.freeze({ ...metadata }))
}

/** Define one real native feature and attach only log-specific, immutable metadata to its identity. */
export function defineNativeLogFeature<C extends object = Record<never, never>>(
  metadata: ILogFeatureMetadata,
  install: () => ILogFeatureRuntime<C>
): ILogFeature<C> {
  /** Only plugin-host creates, registers and later installs this opaque feature object. */
  const feature = defineFeature(install)
  registerLogFeatureMetadata(feature, metadata)
  return feature
}

/** Read log policy metadata without treating presence as proof of native feature identity. */
export function featureMetadata(feature: unknown): ILogFeatureMetadata | undefined {
  return feature !== null && typeof feature === 'object'
    ? logFeatureMetadata.get(feature)
    : undefined
}

/** Admit a plugin's native root record before enforcing its log-specific scope constraints. */
export function featureScope(
  record: IFeatureRecord = {},
  output = false
): Map<string, ILogFeature<any>> {
  if (Array.isArray(record)) throw invalidOption()
  /** Native inspection owns exact-identity and dependency-graph admission. */
  let roots: IFeatureRecord
  try {
    roots = inspectFeatures(record).roots
  } catch (cause) {
    // Preserve the log boundary identity while retaining the native admission diagnostic.
    throw invalidOption(cause)
  }
  /** Record aliases supply policy names without creating a second scope registry. */
  const selected = new Map<string, ILogFeature<any>>()
  /** Singular slots already used by this record; a plugin applies each at most once. */
  const slots = new Set<string>()
  for (const [alias, feature] of Object.entries(roots)) {
    /** Log plugin records hold only log features; the public types already require this. */
    const metadata = featureMetadata(feature)
    if (!metadata) throw invalidOption()
    if (output && metadata.phase === FeaturePhase.entry) throw invalidOption()
    /** Format or delivery policy this feature occupies, if any. */
    const slot = singularSlot(metadata)
    if (slot) {
      if (slots.has(slot)) throw invalidOption()
      slots.add(slot)
    }
    selected.set(alias, feature as ILogFeature<any>)
  }
  return selected
}

/** Select implementations only from outputs already constructed by the native registration. */
export function installedFeatureScope(
  record: IFeatureRecord,
  outputs: Readonly<Record<string, unknown>>
): Map<string, IFeatureImplementation> {
  /** This installed-policy projection is rebuilt only during configuration or installation. */
  const selected = new Map<string, IFeatureImplementation>()
  // featureScope admitted every alias as a log feature when the plugin was defined.
  for (const alias of Object.keys(record)) {
    /** Alias resolution uses the exact instance produced by plugin-host for this registration. */
    const runtime = outputs[alias] as ILogFeatureRuntime
    selected.set(alias, runtime.implementation)
  }
  return selected
}

/** Define a third-party entry, gate or format feature; delivery factories remain package-owned. */
export function defineLogFeature(definition: ILogFeatureDefinition): ILogFeature {
  if (!definition) throw invalidOption()
  /** Capture caller getters once in declaration order before selecting supported phase fields. */
  const snapshot = { ...definition }
  if (snapshot.phase === FeaturePhase.entry && typeof snapshot.stage === 'function') {
    /** Only the declared phase contract is captured; unrelated caller fields do not enter metadata. */
    const implementation = Object.freeze({ phase: FeaturePhase.entry, stage: snapshot.stage })
    return defineNativeLogFeature({ phase: FeaturePhase.entry }, () => ({
      implementation,
      controls: Object.freeze({})
    }))
  }
  if (snapshot.phase === FeaturePhase.gate && typeof snapshot.accept === 'function') {
    /** The cold definition preserves the exact predicate while native installation owns its output. */
    const implementation = Object.freeze({ phase: FeaturePhase.gate, accept: snapshot.accept })
    return defineNativeLogFeature({ phase: FeaturePhase.gate }, () => ({
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
    return defineNativeLogFeature({ phase: FeaturePhase.format }, () => ({
      implementation,
      controls: Object.freeze({})
    }))
  }
  throw invalidOption()
}

/**
 * Merge installed policies, host first then local. A local feature replaces the host feature with
 * the same alias, and a local format/batch/retry/timeout replaces the host one of the same slot.
 */
export function resolveFeatureScope(
  host: ReadonlyMap<string, IFeatureImplementation>,
  local: ReadonlyMap<string, IFeatureImplementation>
): readonly IFeatureImplementation[] {
  /** Singular slots the output configures itself. */
  const localSlots = new Set<string>()
  for (const implementation of local.values()) {
    /** Slot of this local policy, if it has one. */
    const slot = singularSlot(implementation)
    if (slot) localSlots.add(slot)
  }
  /** Entry implementations stay at host ingress and never enter an output's delivery chain. */
  const features: IFeatureImplementation[] = []
  for (const [alias, implementation] of host) {
    /** Slot of this host policy, if it has one. */
    const slot = singularSlot(implementation)
    if (
      !local.has(alias) &&
      implementation.phase !== FeaturePhase.entry &&
      !(slot && localSlots.has(slot))
    )
      features.push(implementation)
  }
  for (const implementation of local.values()) features.push(implementation)
  return features
}

/** Select built-in delivery policy from an installed chain without consulting definition metadata. */
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
