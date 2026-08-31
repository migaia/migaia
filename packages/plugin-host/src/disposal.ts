import type { IPluginDisposer, IPluginResource } from './typing.js'
import { asyncDisposeKey, asyncDisposeKeys, disposeKey, disposeKeys } from './symbols.js'
import { invokeCaptured } from './invocation.js'

export { asyncDisposeKey, disposeKey }

/** One disposer property value captured during admission, before user mutation can replace it. */
export type IDisposerCandidate = {
  readonly key: symbol
  readonly value: unknown
}

/** Complete disposer admission snapshot, including values needed for plugin validation. */
export type IDisposerSnapshot = {
  readonly disposer: IPluginDisposer | undefined
  readonly asyncCandidates: readonly IDisposerCandidate[]
  readonly disposeCandidates: readonly IDisposerCandidate[]
}

/** Invoke a disposer captured from an object while retaining that object's receiver. */
const invokeCapturedDisposer = (
  disposer: (...args: never[]) => void | Promise<void>,
  receiver: object
): void | Promise<void> => invokeCaptured(disposer, receiver, [])

/** Read all equivalent symbol keys once and capture the first async-then-sync disposer. */
export const snapshotDisposer = (resource: IPluginResource): IDisposerSnapshot => {
  if (typeof resource === 'function') {
    return { disposer: resource, asyncCandidates: [], disposeCandidates: [] }
  }
  if (!resource || typeof resource !== 'object') {
    return { disposer: undefined, asyncCandidates: [], disposeCandidates: [] }
  }

  const candidate = resource as Record<PropertyKey, unknown>
  const read = (keys: readonly symbol[]): IDisposerCandidate[] => {
    const seen = new Set<symbol>()
    const values: IDisposerCandidate[] = []
    for (const key of keys) {
      if (seen.has(key)) continue
      seen.add(key)
      values.push({ key, value: candidate[key] })
    }
    return values
  }
  const asyncCandidates = read(asyncDisposeKeys)
  const disposeCandidates = read(disposeKeys)
  const captured = [...asyncCandidates, ...disposeCandidates].find(
    (entry) => typeof entry.value === 'function'
  )
  const disposer = captured
    ? () =>
        invokeCapturedDisposer(
          captured.value as (...args: never[]) => void | Promise<void>,
          resource
        )
    : undefined
  return { disposer, asyncCandidates, disposeCandidates }
}

/** Resolve a resource disposer from its one-time admission snapshot. */
export const resolveDisposer = (resource: IPluginResource): IPluginDisposer | undefined =>
  snapshotDisposer(resource).disposer
