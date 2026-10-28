import { TrayEntryKind } from './state-constants.ts'
import { GraphReadinessState } from '@migaia/capability'
import {
  createCapabilityGraph,
  CapabilityGraphState,
  type IGraphNodeDefinition,
  type IGraphNodeId
} from '@migaia/capability/graph'
import { TrayErrorCode } from './error-code.ts'
import { attachTrayError, createTrayError } from './errors.ts'
import type {
  ITrayGraph,
  ITrayEntryDefinition,
  ITrayEntryContext,
  ITrayKey,
  ITrayState
} from './contract.ts'
import type { IGraphNodeState, IReleaseDescriptor } from './types.ts'

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

/**
 * Creates a fixed same-realm composition without starting entries. Captures keys, dependencies and
 * callbacks, rejecting invalid or duplicate entries synchronously. Call ready() before get(); a
 * blocked gate permits an explicit retry, while final gate and Graph failures remain cached.
 * Capability Graph owns startup rollback, primary/auxiliary release and disposal; its errors retain
 * their originating identity. Tray adds no timeout or forced termination policy.
 */
export function createTrayGraph(entries: readonly ITrayEntryDefinition<unknown>[]): ITrayGraph {
  return new TrayGraphOwner(entries).surface
}
/** Owns Tray admission and readiness projection; Capability Graph keeps startup and cleanup. */
class TrayGraphOwner {
  /** Original admitted facts retain caller definitions only until a final readiness result. */
  #admitted: IAdmittedEntry[]
  /** Key lookup points to the exact captured admission. */
  #definitions: Map<ITrayKey, IAdmittedEntry>
  /** Original gate error identity remains separate from Graph error projection. */
  #gateError: unknown
  /** A failed gate remains retryable only when its original fact was blocked. */
  #gateFailed: boolean
  /** Final gate outcomes share exactly one original Promise. */
  #gatePromise: Promise<void> | undefined
  /** Once delegated, observable state and error belong to Capability Graph. */
  #graphProjection: boolean
  /** Disposal permanently closes Tray readiness admission. */
  #disposed: boolean
  /** Canonical graph retains all dependency, rollback and release behavior. */
  #graph: ReturnType<typeof createCapabilityGraph>
  /** Original public own-property surface exposes no admission internals. */
  readonly surface: ITrayGraph
  /** Capture supported facts once, validate dependencies, and register original Graph nodes. */
  constructor(entries: readonly ITrayEntryDefinition<unknown>[]) {
    if (!Array.isArray(entries)) throw createTrayError(TrayErrorCode.invalidEntry)
    this.#admitted = []
    this.#definitions = new Map<ITrayKey, IAdmittedEntry>()
    this.#gateError = undefined
    this.#gateFailed = false
    this.#gatePromise = undefined
    this.#graphProjection = false
    this.#disposed = false
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
      if (this.#definitions.has(admittedEntry.key))
        throw createTrayError(TrayErrorCode.duplicateEntry)
      this.#definitions.set(admittedEntry.key, admittedEntry)
      this.#admitted.push(admittedEntry)
    }
    for (const entry of this.#admitted)
      for (const provider of entry.requires) {
        if (
          provider === entry.key ||
          typeof provider !== 'string' ||
          provider.trim() === '' ||
          !this.#definitions.has(provider)
        )
          throw createTrayError(TrayErrorCode.invalidEntry)
      }
    this.#graph = createCapabilityGraph()
    const nodes: IGraphNodeDefinition<unknown>[] = this.#admitted.map((entry) => {
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
    for (const node of nodes) this.#graph.register(node)
    this.surface = this.#surface()
  }
  /** Original runGate operation preserves readiness retry and error precedence. */
  #runGate = (): Promise<void> => {
    if (this.#disposed) {
      this.#graphProjection = true
      return this.#graph.ready()
    }
    if (this.#gatePromise) return this.#gatePromise
    /** Only a previous blocked gate lacks a cached Promise; other failures never reach this read. */
    const retry = this.#gateFailed
    this.#gateFailed = false
    this.#gateError = undefined
    try {
      for (const entry of this.#admitted) {
        /** Initial admission already captured a fact; retries obtain the provider's current fact. */
        let snapshot: IAdmittedEntry['readiness']
        try {
          snapshot = retry ? entry.source?.readiness : entry.readiness
        } catch (caught) {
          this.#gateFailed = true
          this.#gateError = attachTrayError(caught, TrayErrorCode.gateReadFailed)
          break
        }
        if (snapshot === undefined) continue
        if (typeof snapshot !== 'object' || snapshot === null) {
          this.#gateFailed = true
          this.#gateError = createTrayError(TrayErrorCode.invalidEntry)
          break
        }
        let state: unknown
        try {
          state = snapshot.state
        } catch (caught) {
          this.#gateFailed = true
          this.#gateError = attachTrayError(caught, TrayErrorCode.gateReadFailed)
          break
        }
        if (
          state !== GraphReadinessState.ready &&
          state !== GraphReadinessState.blocked &&
          state !== GraphReadinessState.failed
        ) {
          this.#gateFailed = true
          this.#gateError = createTrayError(TrayErrorCode.invalidEntry)
          break
        }
        let error: unknown
        try {
          error = snapshot.error
        } catch (caught) {
          this.#gateFailed = true
          this.#gateError = attachTrayError(caught, TrayErrorCode.gateReadFailed)
          break
        }
        if (state !== GraphReadinessState.ready) {
          this.#gateFailed = true
          this.#gateError = error ?? createTrayError(TrayErrorCode.unavailable)
          // Retry only on another explicit ready() call; no background work or extra Promise turn.
          if (state === GraphReadinessState.blocked) return Promise.reject(this.#gateError)
          break
        }
      }
      if (this.#gateFailed) {
        this.#gatePromise = Promise.reject(this.#gateError)
      } else {
        this.#graphProjection = true
        this.#gatePromise = this.#graph.ready()
      }
    } catch (error) {
      this.#gateError = error
      this.#gatePromise = Promise.reject(error)
    }
    // Cached final results cannot retry and no longer need the caller's full definition object.
    for (const entry of this.#admitted) entry.source = undefined
    return this.#gatePromise
  }
  /** Original find operation preserves readiness retry and error precedence. */
  #find = (key: ITrayKey): void => {
    if (!this.#definitions.has(key)) throw createTrayError(TrayErrorCode.unknownEntry)
  }
  /** Read the original state projection without changing Graph authority. */
  #readState = () => {
    if (this.#gateFailed && !this.#graphProjection) return CapabilityGraphState.failed
    if (this.#graphProjection) return this.#graph.state
    return CapabilityGraphState.open
  }
  /** Read the original error projection without changing Graph authority. */
  #readError = () => {
    return this.#graphProjection ? this.#graph.error : (this.#gateError ?? this.#graph.error)
  }
  /** Original get entry keeps Graph ownership and admitted key checks. */
  #getEntry = <T>(key: ITrayKey) => {
    this.#find(key)
    if (this.#graph.state !== CapabilityGraphState.ready)
      throw createTrayError(TrayErrorCode.unavailable)
    return this.#graph.readValue<T>(keyOf(key)) as T
  }
  /** Original entryState entry keeps Graph ownership and admitted key checks. */
  #entryStateEntry = (key: ITrayKey) => {
    this.#find(key)
    return this.#graph.nodeState(keyOf(key)).state as IGraphNodeState
  }
  /** Original dispose entry keeps Graph ownership and admitted key checks. */
  #disposeEntry = () => {
    this.#disposed = true
    for (const entry of this.#admitted) entry.source = undefined
    this.#graphProjection = true
    return this.#graph.dispose()
  }
  /** Assemble original public getters and callable identities around this explicit owner. */
  #surface(): ITrayGraph {
    const readState = this.#readState
    const readError = this.#readError
    return {
      keys: Object.freeze(this.#admitted.map((entry) => entry.key)),
      get state(): ITrayState {
        return readState()
      },
      get error() {
        return readError()
      },
      ready: this.#runGate,
      get: this.#getEntry,
      entryState: this.#entryStateEntry,
      dispose: this.#disposeEntry
    }
  }
}
