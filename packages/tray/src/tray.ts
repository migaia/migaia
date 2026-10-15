import { TrayEntryKind } from './state-constants.js'
import { GraphReadinessState } from '@migaia/capability'
import {
  createCapabilityGraph,
  CapabilityGraphState,
  CapabilityGraphNodeState,
  type IGraphNodeDefinition,
  type IGraphNodeId
} from '@migaia/capability/graph'
import { TrayErrorCode } from './error-code.js'
import { attachTrayError, createTrayError } from './errors.js'
import type {
  ITrayGraph,
  ITrayEntryDefinition,
  ITrayEntryContext,
  ITrayKey,
  ITrayState
} from './contract.js'
import type { IGraphNodeState, IReleaseDescriptor } from './types.js'

const keyOf = (key: ITrayKey): IGraphNodeId => key as unknown as IGraphNodeId

type IAdmittedEntry = {
  /** Original definitions are needed only while blocked can retry; final gates/dispose release them. */
  source: ITrayEntryDefinition<unknown> | undefined
  readonly key: ITrayKey
  readonly kind: ITrayEntryDefinition<unknown>['kind']
  readonly requires: readonly ITrayKey[]
  readonly readiness: ITrayEntryDefinition<unknown>['readiness']
  readonly start: ITrayEntryDefinition<unknown>['start']
}

/** Creates one immutable static composition root over one Capability Graph. */
export function createTrayGraph(entries: readonly ITrayEntryDefinition<unknown>[]): ITrayGraph {
  if (!Array.isArray(entries)) throw createTrayError(TrayErrorCode.invalidEntry)
  const admitted: IAdmittedEntry[] = []
  const definitions = new Map<ITrayKey, IAdmittedEntry>()
  let gateError: unknown
  let gateFailed = false
  let gatePromise: Promise<void> | undefined
  let graphProjection = false
  let disposed = false
  for (const entry of entries) {
    let key: unknown, kind: unknown, requires: unknown, readiness: unknown, start: unknown
    try {
      key = entry?.key
      kind = entry?.kind
      requires = entry?.requires
      readiness = entry?.readiness
      start = entry?.start
    } catch (error) {
      throw createTrayError(TrayErrorCode.invalidEntry, error)
    }
    if (
      typeof key !== 'string' ||
      key.trim() === '' ||
      (kind !== TrayEntryKind.value &&
        kind !== TrayEntryKind.computed &&
        kind !== TrayEntryKind.resource &&
        kind !== TrayEntryKind.service) ||
      typeof start !== 'function' ||
      (requires !== undefined && !Array.isArray(requires)) ||
      (readiness !== undefined && (typeof readiness !== 'object' || readiness === null))
    )
      throw createTrayError(TrayErrorCode.invalidEntry)
    let admittedEntry: IAdmittedEntry
    try {
      admittedEntry = {
        source: entry,
        key: key as ITrayKey,
        kind: kind as IAdmittedEntry['kind'],
        requires: Object.freeze([...((requires as readonly ITrayKey[] | undefined) ?? [])]),
        readiness: readiness as IAdmittedEntry['readiness'],
        start: start as IAdmittedEntry['start']
      }
    } catch (error) {
      throw createTrayError(TrayErrorCode.invalidEntry, error)
    }
    if (definitions.has(admittedEntry.key)) throw createTrayError(TrayErrorCode.duplicateEntry)
    definitions.set(admittedEntry.key, admittedEntry)
    admitted.push(admittedEntry)
  }
  for (const entry of admitted)
    for (const provider of entry.requires) {
      if (
        provider === entry.key ||
        typeof provider !== 'string' ||
        provider.trim() === '' ||
        !definitions.has(provider)
      )
        throw createTrayError(TrayErrorCode.invalidEntry)
    }
  const graph = createCapabilityGraph()
  const nodes: IGraphNodeDefinition<unknown>[] = admitted.map((entry) => {
    const key = entry.key
    const dependencies = (entry.requires ?? []).map((provider) => ({
      provider: keyOf(provider),
      required: true as const
    }))
    return {
      id: keyOf(key),
      kind: entry.kind,
      dependencies,
      start: (context) => {
        const entryContext: ITrayEntryContext = {
          signal: context.signal,
          get: <T>(provider: ITrayKey): T => context.get<T>(keyOf(provider)),
          own: <T>(resource: T, descriptor: IReleaseDescriptor): T =>
            context.own(resource, descriptor)
        }
        // Return foreign thenables unchanged; Graph owns assimilation and primary release admission.
        return entry.start(entryContext)
      }
    }
  })
  for (const node of nodes) graph.register(node)
  const runGate = (): Promise<void> => {
    if (disposed) {
      graphProjection = true
      return graph.ready()
    }
    if (gatePromise) return gatePromise
    /** Only a previous blocked gate lacks a cached Promise; other failures never reach this read. */
    const retry = gateFailed
    gateFailed = false
    gateError = undefined
    try {
      for (const entry of admitted) {
        /** Initial admission already captured a fact; retries obtain the provider's current fact. */
        let snapshot: IAdmittedEntry['readiness']
        try {
          snapshot = retry ? entry.source?.readiness : entry.readiness
        } catch (caught) {
          gateFailed = true
          gateError = attachTrayError(caught, TrayErrorCode.gateReadFailed)
          break
        }
        if (snapshot === undefined) continue
        if (typeof snapshot !== 'object' || snapshot === null) {
          gateFailed = true
          gateError = createTrayError(TrayErrorCode.invalidEntry)
          break
        }
        let state: unknown
        try {
          state = snapshot.state
        } catch (caught) {
          gateFailed = true
          gateError = attachTrayError(caught, TrayErrorCode.gateReadFailed)
          break
        }
        if (
          state !== GraphReadinessState.ready &&
          state !== GraphReadinessState.blocked &&
          state !== GraphReadinessState.failed
        ) {
          gateFailed = true
          gateError = createTrayError(TrayErrorCode.invalidEntry)
          break
        }
        let error: unknown
        try {
          error = snapshot.error
        } catch (caught) {
          gateFailed = true
          gateError = attachTrayError(caught, TrayErrorCode.gateReadFailed)
          break
        }
        if (state !== GraphReadinessState.ready) {
          gateFailed = true
          gateError = error ?? createTrayError(TrayErrorCode.unavailable)
          // Retry only on another explicit ready() call; no background work or extra Promise turn.
          if (state === GraphReadinessState.blocked) return Promise.reject(gateError)
          break
        }
      }
      if (gateFailed) {
        gatePromise = Promise.reject(gateError)
      } else {
        graphProjection = true
        gatePromise = graph.ready()
      }
    } catch (error) {
      gateError = error
      gatePromise = Promise.reject(error)
    }
    // Cached final results cannot retry and no longer need the caller's full definition object.
    for (const entry of admitted) entry.source = undefined
    return gatePromise
  }
  const find = (key: ITrayKey): void => {
    if (!definitions.has(key)) throw createTrayError(TrayErrorCode.unknownEntry)
  }
  return {
    keys: Object.freeze(admitted.map((entry) => entry.key)),
    get state(): ITrayState {
      if (gateFailed && !graphProjection) return CapabilityGraphState.failed
      if (graphProjection) return graph.state
      return CapabilityGraphState.open
    },
    get error() {
      return graphProjection ? graph.error : (gateError ?? graph.error)
    },
    ready: runGate,
    get<T>(key: ITrayKey) {
      find(key)
      const diagnostic = graph.nodeState(keyOf(key))
      if (graph.state !== CapabilityGraphState.ready || diagnostic.state !== CapabilityGraphNodeState.ready)
        throw createTrayError(TrayErrorCode.unavailable)
      return diagnostic.value as T
    },
    entryState(key) {
      find(key)
      return graph.nodeState(keyOf(key)).state as IGraphNodeState
    },
    dispose() {
      disposed = true
      for (const entry of admitted) entry.source = undefined
      graphProjection = true
      return graph.dispose()
    }
  }
}
