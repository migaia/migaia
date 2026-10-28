import type { ILogEntry, ILogFeature, ILogFeatureDefinition } from './typing.ts'
import { FeatureKind, FeaturePhase } from './state-constants.ts'
import { invalidOption } from './errors.ts'

/** Per-output batch capacity and drain options remain host-owned. */
export type IBatchOptions = {
  maxSize?: number
  maxWaitMs?: number
  maxConcurrentBatches?: number
  maxPendingBatches?: number
  drainTimeoutMs?: number
}
/** Retry attempts include the initial attempt; backoff uses the failed attempt's one-based index. */
export type IRetryFeatureOptions = {
  attempts: number
  backoff?: number | ((attempt: number) => number)
}
/** Internal normalized descriptors carry delivery data without exporting a construction capability. */
export type IFeatureImplementation =
  | {
      kind: string
      phase: 'entry'
      stage(
        entry: ILogEntry,
        randomUUID: () => string
      ): ILogEntry | undefined | Promise<ILogEntry | undefined>
    }
  | { kind: string; phase: 'gate'; accept(entry: ILogEntry): boolean }
  | { kind: string; phase: 'format'; format(entry: ILogEntry): string }
  | { kind: 'batch'; phase: 'delivery'; options: Required<IBatchOptions> }
  | { kind: 'retry'; phase: 'delivery'; options: Required<IRetryFeatureOptions> }
  | { kind: 'timeout'; phase: 'delivery'; ms: number }

/** Object identity is authority; copied/branded-looking objects are never admitted. */
const issuedFeatures = new WeakMap<object, IFeatureImplementation>()

/** Register one frozen descriptor using the same private issuer for public and built-in factories. */
export function issueFeature<T extends object>(
  descriptor: T,
  implementation: IFeatureImplementation
): ILogFeature & Readonly<T> {
  /** Preserve the caller-visible descriptor identity after issuance. */
  const issued = Object.freeze(descriptor)
  issuedFeatures.set(issued, implementation)
  return issued as ILogFeature & Readonly<T>
}

/** Only factory-issued exact objects enter the host's normalized feature graph. */
export function featureImplementation(feature: ILogFeature): IFeatureImplementation {
  /** A registry lookup does not trust caller-supplied kind, phase or symbol fields. */
  const implementation =
    feature !== null && typeof feature === 'object' ? issuedFeatures.get(feature) : undefined
  if (!implementation) throw invalidOption()
  return implementation
}

/** Validate one scope once; output-local entry enrichment is intentionally unsupported. */
export function featureScope(
  features: readonly ILogFeature[] = [],
  output = false
): Map<string, ILogFeature> {
  /** Each kind is indexed once, making validation linear in the scope size. */
  const selected = new Map<string, ILogFeature>()
  /** Format selection has one candidate per scope regardless of caller-chosen kind names. */
  let hasFormat = false
  for (const feature of features) {
    /** Private normalization is also the identity admission check. */
    const implementation = featureImplementation(feature)
    if (
      selected.has(implementation.kind) ||
      (hasFormat && implementation.phase === FeaturePhase.format) ||
      (output && implementation.phase === FeaturePhase.entry)
    )
      throw invalidOption()
    if (implementation.phase === FeaturePhase.format) hasFormat = true
    selected.set(implementation.kind, feature)
  }
  return selected
}

/** Freeze a complete third-party entry, gate or format policy; delivery issuance stays internal. */
export function defineLogFeature<const D extends ILogFeatureDefinition>(
  definition: D
): ILogFeature & Readonly<D> {
  if (!definition || typeof definition.kind !== 'string' || definition.kind.length === 0)
    throw invalidOption()
  if (definition.phase === FeaturePhase.entry && typeof definition.stage === 'function')
    return issueFeature(
      { ...definition },
      Object.freeze({ kind: definition.kind, phase: FeaturePhase.entry, stage: definition.stage })
    )
  if (definition.phase === FeaturePhase.gate && typeof definition.accept === 'function')
    return issueFeature(
      { ...definition },
      Object.freeze({ kind: definition.kind, phase: FeaturePhase.gate, accept: definition.accept })
    )
  if (definition.phase === FeaturePhase.format && typeof definition.format === 'function')
    return issueFeature(
      { ...definition },
      Object.freeze({
        kind: definition.kind,
        phase: FeaturePhase.format,
        format: definition.format
      })
    )
  throw invalidOption()
}

/** Resolve host defaults without moving overridden gates ahead of output-local declaration order. */
export function resolveFeatureScope(
  host: ReadonlyMap<string, ILogFeature>,
  local: ReadonlyMap<string, ILogFeature>
): readonly ILogFeature[] {
  /** Entry policies stay outside every output chain and execute exactly once at host ingress. */
  const features: ILogFeature[] = []
  /** An output-local format replaces the host format even when their kinds differ. */
  let localFormat = false
  for (const feature of local.values())
    if (featureImplementation(feature).phase === FeaturePhase.format) localFormat = true
  for (const [kind, feature] of host)
    if (
      !local.has(kind) &&
      featureImplementation(feature).phase !== FeaturePhase.entry &&
      !(localFormat && featureImplementation(feature).phase === FeaturePhase.format)
    )
      features.push(feature)
  for (const feature of local.values()) features.push(feature)
  return features
}

/** Read only an issued built-in delivery policy with the selected stable kind. */
export function deliveryFeature<K extends 'batch' | 'retry' | 'timeout'>(
  features: readonly ILogFeature[],
  kind: K
): Extract<IFeatureImplementation, { kind: K; phase: 'delivery' }> | undefined {
  for (const feature of features) {
    /** Third-party kinds cannot forge internal delivery implementations. */
    const implementation = featureImplementation(feature)
    if (implementation.phase === FeaturePhase.delivery && implementation.kind === kind)
      return implementation as Extract<IFeatureImplementation, { kind: K; phase: 'delivery' }>
  }
  return undefined
}

/** Apply built-in threshold/filter before remaining gates while retaining each scope's order. */
export function acceptsEntry(features: readonly ILogFeature[], entry: ILogEntry): boolean {
  for (const kind of [FeatureKind.threshold, FeatureKind.filter]) {
    // Two built-in gate kinds form a compile-time bound, independent of runtime feature count.
    for (const feature of features) {
      /** Normalization was admitted once; the exact gate implementation retains its state owner. */
      const implementation = featureImplementation(feature)
      if (
        implementation.phase === FeaturePhase.gate &&
        implementation.kind === kind &&
        !implementation.accept(entry)
      )
        return false
    }
  }
  for (const feature of features) {
    /** Non-built-in gates follow resolved host-first/output-second declaration order. */
    const implementation = featureImplementation(feature)
    if (
      implementation.phase === FeaturePhase.gate &&
      implementation.kind !== FeatureKind.threshold &&
      implementation.kind !== FeatureKind.filter &&
      !implementation.accept(entry)
    )
      return false
  }
  return true
}
