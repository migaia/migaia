import type { TrayEntryKind } from './state-constants.ts'
import type {
  IGraphNodeState,
  IGraphReleaseContext,
  IGraphReadinessSnapshot,
  IReleaseDescriptor
} from './types.ts'
import type { ICapabilityGraphState } from '@migaia/capability/graph'
import type { INativeAbortSignal } from '@migaia/utils/promise'

/** Application-owned nonblank identity shared by one entry and its declared dependencies. */
export type ITrayKey = string & { readonly __trayKey: unique symbol }
/** Diagnostic category: value, computed, resource or service; none adds a separate execution policy. */
export type ITrayEntryKind = TrayEntryKind
/** One successfully acquired primary value whose lifetime transfers to the Capability Graph. */
export type ITrayEntryInstance<T> = {
  /** Value made visible only after the whole static graph becomes ready. */
  readonly value: T
  /** Releases the primary value during rollback or disposal; Graph observes asynchronous settlement. */
  readonly release: (context: IGraphReleaseContext) => void | PromiseLike<void>
}
/** Node-scoped acquisition context; auxiliary resources and cancellation remain Graph-owned. */
export type ITrayEntryContext = {
  /** Cooperative cancellation for this node's acquisition and lifetime. */
  readonly signal: INativeAbortSignal
  /** Reads a ready, declared provider; undeclared or unavailable access follows Graph errors. */
  get<T>(key: ITrayKey): T
  /** Registers an auxiliary resource for Graph cleanup and returns the same resource. */
  own<T>(resource: T, descriptor: IReleaseDescriptor): T
}
/** Static same-realm definition captured before any start function runs. */
export type ITrayEntryDefinition<T> = {
  /** Unique nonblank key within this static composition. */
  readonly key: ITrayKey
  /** Category label retained in Graph diagnostics without changing acquisition behavior. */
  readonly kind: ITrayEntryKind
  /** Required provider keys; omission means no dependencies. Providers start before this entry. */
  readonly requires?: readonly ITrayKey[]
  /**
   * Initial fact is captured at admission. Only a blocked ready() may reacquire this property;
   * supply a getter for fresh provider snapshots. Failed results remain cached permanently.
   */
  readonly readiness?: IGraphReadinessSnapshot
  /** Acquires a complete value/release pair; partial construction before return remains entry-owned. */
  readonly start: (
    context: ITrayEntryContext
  ) => ITrayEntryInstance<T> | PromiseLike<ITrayEntryInstance<T>>
}
/** Graph lifecycle: open, starting, ready, failed, quiescing or terminal. */
export type ITrayState = ICapabilityGraphState
/** One fixed definition set backed by one Capability Graph, without another value or cleanup owner. */
export type ITrayGraph = {
  /** Frozen admission-order keys, available before startup and after disposal. */
  readonly keys: readonly ITrayKey[]
  /** Whole-graph lifecycle; a blocked readiness gate is exposed as failed until explicitly retried. */
  readonly state: ITrayState
  /** Retained readiness or Graph failure, or undefined before a failure occurs. */
  readonly error: unknown | undefined
  /** Checks gates then starts providers first. Only a blocked gate can be retried by another call. */
  ready(): Promise<void>
  /**
   * Reads a ready Graph value; unknown keys use TRAY_UNKNOWN_ENTRY, unavailable values
   * TRAY_UNAVAILABLE.
   */
  get<T>(key: ITrayKey): T
  /** Reads the Graph node state; an unknown key throws TRAY_UNKNOWN_ENTRY. */
  entryState(key: ITrayKey): IGraphNodeState
  /**
   * Closes admission and releases in dependency reverse order using Graph's shared disposal
   * Promise.
   */
  dispose(): Promise<void>
}
