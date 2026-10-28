/**
 * Projects actual connection, supervision and resource facts into safe local member-query output.
 * Missing observations remain explicit unavailable values; formatting consumes inert snapshots
 * without sampling native units, indexing Sessions or exposing private handles and error contents.
 */
import { emitOutput, type ISerializeTextFormat } from '@migaia/serialize'
import type { ISupervisorSnapshot } from '@migaia/supervision'
import type { IRpcGeneration } from '@migaia/rpc-contract/protocol'
import {
  RpcMemberQueryStatus,
  RpcMemberQueryReason,
  RpcMemberMetricScope,
  RpcMemberMetricUnit,
  RpcMemberQueryClock,
  type RpcMemberSourceKind,
  type RpcMemberConnectionDirection
} from './native-members-constants.ts'
/** Only these two already-admitted native identity fields enter local member output. */
export type IRpcMemberIdentity = Readonly<{ name: string; instanceId: string }>
/** Formatting is a local cold-query option, never application or wire configuration. */
export type IRpcMemberQueryOptions = Readonly<{
  /** Omit for an object; json, yaml or toml selects text output. */ format?: ISerializeTextFormat
}>
/** Missing facts are explicit instead of invented zero, null or healthy values. */
export type IRpcMemberUnavailable = Readonly<{
  /** Explicit absence rather than an invented metric. */ status: 'unavailable'
  /** Safe explanation of the missing owner fact. */ reason: string
}>
/** Available metrics identify their exact scope, units and local monotonic observation time. */
export type IRpcMemberMetric<T = number> = Readonly<{
  /** Observed value in the declared units. */
  value: T
  /** Original owner scope, such as endpoint-client or execution-unit. */
  scope: string
  /** Explicit unit label; CPU time and utilization ratios are separate dimensions. */
  unit: string
  /** Local monotonic time at which the original owner sampled this value. */
  observedAt: number
  /** Clock domain used by observedAt. */
  clock: string
}>
/** Only inFlight has a current canonical source; absent physical counters are explicit. */
export type IRpcMemberCounters = Readonly<{
  /** Current canonical local client work, when observable. */
  inFlight: IRpcMemberMetric | IRpcMemberUnavailable
  /** Explicitly unavailable until an actual physical counter owner supplies it. */
  sent: IRpcMemberUnavailable
  /** Explicitly unavailable without an actual physical counter owner. */
  received: IRpcMemberUnavailable
  /** Explicitly unavailable without a canonical error counter owner. */
  errors: IRpcMemberUnavailable
  /** Explicitly unavailable without a genuine activity observation owner. */
  lastActiveAt: IRpcMemberUnavailable
}>
/** Cold resource values never contain native handles, errors or an aggregate parent heap. */
export type IRpcMemberResources = Readonly<{
  /** Native unit/process scope of these observations. */
  scope: string
  /** Original native process id when observable. */
  pid?: number
  /** Shared host process id for a non-isolated unit, when applicable. */
  sharedPid?: number
  /** Original native thread id when observable. */
  threadId?: number
  /** RSS observation only when the original sampler supplies it. */
  rssBytes?: IRpcMemberMetric | IRpcMemberUnavailable
  /** Observed used heap bytes in the declared original scope. */
  heapUsedBytes?: IRpcMemberMetric | IRpcMemberUnavailable
  /** Observed total heap bytes in the declared original scope. */
  heapTotalBytes?: IRpcMemberMetric | IRpcMemberUnavailable
  /** Original CPU-time observation or explicit unavailable record. */
  cpu:
    | IRpcMemberUnavailable
    | Readonly<{ kind: 'cpu-time'; user: IRpcMemberMetric; system: IRpcMemberMetric }>
  /** Optional original event-loop activity observation; it is not CPU time. */
  elu?: Readonly<{
    /** Event-loop utilization metric discriminator. */
    kind: 'elu'
    /** Observed active loop time in its declared units. */
    active: IRpcMemberMetric
    /** Observed idle loop time in its declared units. */
    idle: IRpcMemberMetric
    /** Observed dimensionless event-loop utilization. */
    utilization: IRpcMemberMetric
  }>
}>
/** Cold source metadata comes from the actual factory branch, not binding ownership. */
export type IRpcMemberConnectionOrigin = Readonly<{
  /** Actual local spawn/connect/listen source mode. */
  kind: RpcMemberSourceKind
  /** Actual native/bootstrap connection direction. */
  direction: RpcMemberConnectionDirection
}>
/** Safe directory metadata can survive retirement without retaining an endpoint or native handle. */
export type IRpcMemberConnectionDirectory = IRpcMemberConnectionOrigin &
  Readonly<{
    /** Accepted remote directory, when available. */
    description?: Readonly<{
      self: IRpcMemberIdentity & Readonly<{ generation: IRpcGeneration }>
      methods: readonly Readonly<{ name: string }>[]
    }>
    /** Actual physical carrier label. */
    carrier: string
  }>
/** Only original registration departures enter the bounded public history. */
export type IRpcMemberRecent = Readonly<{
  /** Original departed unit generation. */
  generation: number
  /** Monotonic time of this owner's observation. */
  timestamp: number
  /** Timestamp domain label. */
  clock: string
  /** Safe lifecycle history kind. */
  kind: string
  /** Accepted connection identity if it was available. */
  identity?: IRpcMemberIdentity
  /** Safe diagnostic error source, when supplied. */
  source?: string
  /** Safe semantic error code, when supplied. */
  code?: string
}>
/** Connection state and unit state remain separate owner facts. */
export type IRpcMemberConnectionDetail = Readonly<{
  /** Accepted remote identity, or an explicit unavailable record. */
  identity: IRpcMemberIdentity | IRpcMemberUnavailable
  /** Accepted remote identity is distinct from the local supervisor's physical attempt number. */
  generation: IRpcGeneration | IRpcMemberUnavailable
  /** Actual local spawn/connect/listen source mode. */
  kind: RpcMemberSourceKind
  /** Actual connection direction, independent of ownership. */
  direction: RpcMemberConnectionDirection
  /** Actual physical carrier label. */
  carrier: string
  /** Connection availability reported by its original owner. */
  connection: Readonly<{ status: string | IRpcMemberUnavailable }>
  /** Original execution-unit facts, or unavailable when no owned unit is observable. */
  unit:
    | IRpcMemberUnavailable
    | Readonly<{
        kind: string
        state: string
        generation: number
        degraded: readonly string[]
      }>
  /** Original health metric or unavailable; channel readiness does not imply native health. */
  health: IRpcMemberUnavailable | IRpcMemberMetric<Readonly<{ state: string; failures: number }>>
  /** Original supervisor restart metric, or unavailable. */
  restartCount: IRpcMemberUnavailable | IRpcMemberMetric
  /** Accepted callable method names; erased TypeScript types do not supply this list. */
  methods: readonly string[]
  /** Canonical endpoint counters when available, with explicit absent fields. */
  counters: IRpcMemberUnavailable | IRpcMemberCounters
  /** Native resource observations when connected to the original sampler; otherwise unavailable. */
  resources: IRpcMemberUnavailable | IRpcMemberResources
  /** Bounded original departure history for this connection. */
  recent: readonly IRpcMemberRecent[]
  /** Safe observed native exit facts, or unavailable. */
  lastExit:
    | IRpcMemberUnavailable
    | Readonly<{
        generation: number
        reason: string
        code: number | IRpcMemberUnavailable
        signal: string | IRpcMemberUnavailable
        error?: Readonly<{ source?: string; code?: string }>
        observedAt?: number
      }>
}>
/** Host summaries use the canonical Host identity and genuine contributed connection records. */
export type IRpcMemberOverview = Readonly<{
  /** Safe Host identity belonging to this overview. */
  self: IRpcMemberIdentity
  /** Current safe connection details contributed by genuine Host registrations. */
  connections: readonly IRpcMemberConnectionDetail[]
}>

/** Explicit absence is a frozen own-data value, suitable for JSON, YAML and TOML. */
export function rpcMemberUnavailable(reason: string): IRpcMemberUnavailable {
  return Object.freeze({ status: RpcMemberQueryStatus.unavailable, reason })
}

/** One own-data metric shape is shared by resources, counters and lifecycle facts. */
export function rpcMemberMetric<T>(
  value: T,
  scope: string,
  unit: string,
  observedAt: number
): IRpcMemberMetric<T> {
  return Object.freeze({ value, scope, unit, observedAt, clock: RpcMemberQueryClock.scheduler })
}

/** Native endpoint cold counts read the original Map sizes without a diagnostic observer. */
export function rpcMemberCounters(
  counts?: Readonly<{ inFlight: number; observedAt: number }>
): IRpcMemberCounters {
  /** No sent/received/error/last-active source currently exists in the selected canonical owners. */
  return Object.freeze({
    inFlight: counts
      ? rpcMemberMetric(
          counts.inFlight,
          RpcMemberMetricScope.client,
          RpcMemberMetricUnit.calls,
          counts.observedAt
        )
      : rpcMemberUnavailable(RpcMemberQueryReason.counters),
    sent: rpcMemberUnavailable(RpcMemberQueryReason.counters),
    received: rpcMemberUnavailable(RpcMemberQueryReason.counters),
    errors: rpcMemberUnavailable(RpcMemberQueryReason.counters),
    lastActiveAt: rpcMemberUnavailable(RpcMemberQueryReason.counters)
  })
}

/** Read only tagged own error fields; messages, stacks, causes and arbitrary getters stay private. */
export function rpcMemberErrorIdentity(
  error: unknown,
  report: (failure: unknown) => void
): Readonly<{ source?: string; code?: string }> {
  if (!error || (typeof error !== 'object' && typeof error !== 'function')) return {}
  /** Reflection failure cannot affect lifecycle transitions or reveal an untrusted value. */
  try {
    /** Error identity tags are own data fields in the package error contract. */
    const source = Object.getOwnPropertyDescriptor(error, 'source')?.value
    /** The semantic code alone is public; the native error graph remains with its original owner. */
    const code = Object.getOwnPropertyDescriptor(error, 'code')?.value
    return {
      ...(typeof source === 'string' ? { source } : {}),
      ...(typeof code === 'string' ? { code } : {})
    }
  } catch (failure) {
    report(failure)
    return {}
  }
}

/** Project genuine connection facts without exposing the private wire node or channel metadata. */
export function rpcMemberConnectionDetail(
  directory: IRpcMemberConnectionDirectory,
  state?: string,
  facts?: Readonly<{
    supervisor?: ISupervisorSnapshot
    recent?: readonly IRpcMemberRecent[]
    report(error: unknown): void
    observedAt?: number
    counters?: IRpcMemberCounters
    resources?: IRpcMemberResources | IRpcMemberUnavailable
  }>
): IRpcMemberConnectionDetail {
  /** Native facts and their reporter come from the same canonical registration. */
  const supervisor = facts?.supervisor
  return Object.freeze({
    identity: directory.description
      ? Object.freeze({
          name: directory.description.self.name,
          instanceId: directory.description.self.instanceId
        })
      : rpcMemberUnavailable(RpcMemberQueryReason.owner),
    generation:
      directory.description?.self.generation ?? rpcMemberUnavailable(RpcMemberQueryReason.owner),
    kind: directory.kind,
    direction: directory.direction,
    carrier: directory.carrier,
    connection: Object.freeze({
      status: state ?? rpcMemberUnavailable(RpcMemberQueryReason.owner)
    }),
    unit: supervisor
      ? Object.freeze({
          kind: supervisor.kind,
          state: supervisor.state,
          generation: supervisor.generation,
          degraded: Object.freeze([...supervisor.degraded])
        })
      : rpcMemberUnavailable(RpcMemberQueryReason.owner),
    health:
      supervisor?.health?.observedAt === undefined
        ? rpcMemberUnavailable(RpcMemberQueryReason.health)
        : rpcMemberMetric(
            Object.freeze({ state: supervisor.health.state, failures: supervisor.health.failures }),
            RpcMemberMetricScope.unit,
            RpcMemberMetricUnit.checks,
            supervisor.health.observedAt
          ),
    restartCount:
      supervisor?.restartCount === undefined || facts?.observedAt === undefined
        ? rpcMemberUnavailable(RpcMemberQueryReason.restarts)
        : rpcMemberMetric(
            supervisor.restartCount,
            RpcMemberMetricScope.unit,
            RpcMemberMetricUnit.restarts,
            facts.observedAt
          ),
    methods: Object.freeze(directory.description?.methods.map((method) => method.name) ?? []),
    counters: facts?.counters ?? rpcMemberUnavailable(RpcMemberQueryReason.counters),
    resources: facts?.resources ?? rpcMemberUnavailable(RpcMemberQueryReason.resources),
    recent: Object.freeze([...(facts?.recent ?? [])]),
    lastExit: supervisor?.lastExit
      ? Object.freeze({
          generation: supervisor.lastExit.generation,
          reason: supervisor.lastExit.reason,
          code:
            supervisor.lastExit.status?.code ?? rpcMemberUnavailable(RpcMemberQueryReason.native),
          signal:
            supervisor.lastExit.status?.signal ?? rpcMemberUnavailable(RpcMemberQueryReason.native),
          ...(supervisor.lastExit.error === undefined
            ? {}
            : { error: rpcMemberErrorIdentity(supervisor.lastExit.error, facts!.report) }),
          ...(supervisor.lastExit.observedAt === undefined
            ? {}
            : { observedAt: supervisor.lastExit.observedAt })
        })
      : rpcMemberUnavailable(RpcMemberQueryReason.owner)
  })
}

/** The same admitted projection is formatted for every local query without reflecting its owner. */
export function rpcMemberQueryOutput<T>(snapshot: T, options?: IRpcMemberQueryOptions): T | string {
  return options?.format === undefined ? snapshot : emitOutput(snapshot, options.format)
}
