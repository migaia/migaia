/**
 * Owns one-time disposer admission and receiver capture; lifecycle scopes execute the resulting
 * disposer.
 */
import type { IPluginDisposer, IPluginResource } from './plugin-lifecycle-types.js'
import { asyncDisposeKeys, disposeKeys } from './symbols.js'
import { invokeCaptured } from './invocation.js'

/** One disposer property value captured during admission, before user mutation can replace it. */
type IDisposerCandidate = {
  readonly key: symbol
  readonly value: unknown
}

/** Complete disposer admission snapshot, including values needed for plugin validation. */
type IDisposerSnapshot = {
  readonly disposer: IPluginDisposer | undefined
  readonly asyncCandidates: readonly IDisposerCandidate[]
  readonly disposeCandidates: readonly IDisposerCandidate[]
}

/** Invoke a disposer captured from an object while retaining that object's receiver. */
const invokeCapturedDisposer = (
  disposer: (...args: never[]) => void | Promise<void>,
  receiver: object
): void | Promise<void> => invokeCaptured(disposer, receiver, [])

/** Reads the supported native/fallback symbols once, retaining the original property-read order. */
function readDisposerCandidates(
  candidate: Record<PropertyKey, unknown>,
  keys: readonly symbol[]
): IDisposerCandidate[] {
  /** Equivalent native/fallback symbols are read only once even if their identities coincide. */
  const seen = new Set<symbol>()
  /** Admission preserves every captured value for the caller's existing validation. */
  const values: IDisposerCandidate[] = []
  // symbols.ts fixes at most two async keys (package and native) or one native sync key.
  for (const key of keys) {
    if (seen.has(key)) continue
    seen.add(key)
    values.push({ key, value: candidate[key] })
  }
  return values
}

/** Selects the first callable under the existing async-before-sync protocol priority. */
function firstDisposerCandidate(
  asyncCandidates: readonly IDisposerCandidate[],
  disposeCandidates: readonly IDisposerCandidate[]
): IDisposerCandidate | undefined {
  // symbols.ts fixes two async entries and one sync entry: both protocol groups total at most three.
  for (const candidates of [asyncCandidates, disposeCandidates])
    for (const candidate of candidates) if (typeof candidate.value === 'function') return candidate
  return undefined
}

/** Read all equivalent symbol keys once and capture the first async-then-sync disposer. */
export const snapshotDisposer = (resource: IPluginResource): IDisposerSnapshot => {
  if (typeof resource === 'function')
    return { disposer: resource, asyncCandidates: [], disposeCandidates: [] }
  if (!resource || typeof resource !== 'object')
    return { disposer: undefined, asyncCandidates: [], disposeCandidates: [] }
  /** Original object is the receiver for the admitted disposer. */
  const candidate = resource as Record<PropertyKey, unknown>
  /** Both protocol families are captured before choosing or invoking any disposer. */
  const asyncCandidates = readDisposerCandidates(candidate, asyncDisposeKeys)
  /** Synchronous values remain visible even when an async candidate wins. */
  const disposeCandidates = readDisposerCandidates(candidate, disposeKeys)
  /** Fixed-size priority selection never searches a growable collection. */
  const captured = firstDisposerCandidate(asyncCandidates, disposeCandidates)
  return {
    /** Only the captured function and its original receiver survive admission. */
    disposer: captured
      ? () =>
          invokeCapturedDisposer(
            captured.value as (...args: never[]) => void | Promise<void>,
            resource
          )
      : undefined,
    asyncCandidates,
    disposeCandidates
  }
}

/** Resolve a resource disposer from its one-time admission snapshot. */
export const resolveDisposer = (resource: IPluginResource): IPluginDisposer | undefined =>
  snapshotDisposer(resource).disposer
