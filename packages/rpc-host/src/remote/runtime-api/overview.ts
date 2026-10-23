import { emitOutput, type ISerializeTextFormat } from '@migaia/serialize'
import type { ISupervisorSnapshot } from '@migaia/supervision'
import type { IRpcRuntimeGeneration, IRpcPortableValue } from '@migaia/rpc-contract'
import { readEndpointClientCounters } from '../../core/internal/endpoint-projection.js'
import {
  runtimeIdentity,
  type IRuntimePeerDescription,
  type IRuntimePeerIdentity
} from './description.js'
import {
  RuntimeQueryStatus,
  RuntimeQueryReason,
  RuntimeMetricScope,
  RuntimeMetricUnit,
  RuntimeQueryClock,
  type RuntimeSourceKind,
  type RuntimeConnectionDirection
} from './constants.js'

/** Formatting is a local cold-query option, never application or wire configuration. */
export type IRuntimeQueryOptions = Readonly<{
  /** Omit for an object; json, yaml or toml selects text output. */ format?: ISerializeTextFormat
}>
/** Default queries return objects; selecting a format returns only the admitted projection. */
export type IRuntimeQuery<T> = {
  (options?: Readonly<{ format?: undefined }>): Promise<T>
  (options: Readonly<{ format: ISerializeTextFormat }>): Promise<string>
  (options: IRuntimeQueryOptions): Promise<T | string>
}
/** Missing facts are explicit instead of invented zero, null or healthy values. */
export type IRuntimeUnavailable = Readonly<{
  /** Explicit absence rather than an invented metric. */ status: 'unavailable'
  /** Safe explanation of the missing owner fact. */ reason: string
}>
/** Available metrics identify their exact scope, units and local monotonic observation time. */
export type IRuntimeMetric<T = number> = Readonly<{
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
export type IRuntimeCounters = Readonly<{
  /** Current canonical local client work, when observable. */
  inFlight: IRuntimeMetric | IRuntimeUnavailable
  /** Explicitly unavailable until an actual physical counter owner supplies it. */
  sent: IRuntimeUnavailable
  /** Explicitly unavailable without an actual physical counter owner. */
  received: IRuntimeUnavailable
  /** Explicitly unavailable without a canonical error counter owner. */
  errors: IRuntimeUnavailable
  /** Explicitly unavailable without a genuine activity observation owner. */
  lastActiveAt: IRuntimeUnavailable
}>
/** Cold resource values never contain native handles, errors or an aggregate parent heap. */
export type IRuntimeResources = Readonly<{
  /** Native unit/process scope of these observations. */
  scope: string
  /** Original native process id when observable. */
  pid?: number
  /** Shared host process id for a non-isolated unit, when applicable. */
  sharedPid?: number
  /** Original native thread id when observable. */
  threadId?: number
  /** RSS observation only when the original sampler supplies it. */
  rssBytes?: IRuntimeMetric | IRuntimeUnavailable
  /** Observed used heap bytes in the declared original scope. */
  heapUsedBytes?: IRuntimeMetric | IRuntimeUnavailable
  /** Observed total heap bytes in the declared original scope. */
  heapTotalBytes?: IRuntimeMetric | IRuntimeUnavailable
  /** Original CPU-time observation or explicit unavailable record. */
  cpu:
    | IRuntimeUnavailable
    | Readonly<{ kind: 'cpu-time'; user: IRuntimeMetric; system: IRuntimeMetric }>
  /** Optional original event-loop activity observation; it is not CPU time. */
  elu?: Readonly<{
    /** Event-loop utilization metric discriminator. */
    kind: 'elu'
    /** Observed active loop time in its declared units. */
    active: IRuntimeMetric
    /** Observed idle loop time in its declared units. */
    idle: IRuntimeMetric
    /** Observed dimensionless event-loop utilization. */
    utilization: IRuntimeMetric
  }>
}>
/** Cold source metadata comes from the actual factory branch, not binding ownership. */
export type IRuntimeConnectionOrigin = Readonly<{
  /** Actual local spawn/connect/listen source mode. */
  kind: RuntimeSourceKind
  /** Actual native/bootstrap connection direction. */
  direction: RuntimeConnectionDirection
}>
/** Safe directory metadata can survive retirement without retaining an endpoint or native handle. */
export type IRuntimeConnectionDirectory = IRuntimeConnectionOrigin &
  Readonly<{
    /** Compiled local method directory from this original owner. */
    localDescription: IRuntimePeerDescription
    /** Accepted remote directory, when available. */
    description?: IRuntimePeerDescription
    /** Actual physical carrier label. */
    carrier: string
  }>
/** Only original registration departures enter the bounded public history. */
export type IRuntimeRecent = Readonly<{
  /** Original departed unit generation. */
  generation: number
  /** Monotonic time of this owner's observation. */
  timestamp: number
  /** Timestamp domain label. */
  clock: string
  /** Safe lifecycle history kind. */
  kind: string
  /** Accepted connection identity if it was available. */
  identity?: IRuntimePeerIdentity
  /** Safe diagnostic error source, when supplied. */
  source?: string
  /** Safe semantic error code, when supplied. */
  code?: string
}>
/** Connection state and unit state remain separate owner facts. */
export type IRuntimeConnectionDetail = Readonly<{
  /** Accepted remote identity, or an explicit unavailable record. */
  identity: IRuntimePeerIdentity | IRuntimeUnavailable
  /** Accepted remote identity is distinct from the local supervisor's physical attempt number. */
  generation: IRpcRuntimeGeneration | IRuntimeUnavailable
  /** Actual local spawn/connect/listen source mode. */
  kind: RuntimeSourceKind
  /** Actual connection direction, independent of ownership. */
  direction: RuntimeConnectionDirection
  /** Actual physical carrier label. */
  carrier: string
  /** Connection availability reported by its original owner. */
  connection: Readonly<{ status: string | IRuntimeUnavailable }>
  /** Original execution-unit facts, or unavailable when no owned unit is observable. */
  unit:
    | IRuntimeUnavailable
    | Readonly<{
        kind: string
        state: string
        generation: number
        degraded: readonly string[]
      }>
  /** Original health metric or unavailable; channel readiness does not imply native health. */
  health: IRuntimeUnavailable | IRuntimeMetric<Readonly<{ state: string; failures: number }>>
  /** Original supervisor restart metric, or unavailable. */
  restartCount: IRuntimeUnavailable | IRuntimeMetric
  /** Accepted callable method names; erased TypeScript types do not supply this list. */
  methods: readonly string[]
  /** Canonical endpoint counters when available, with explicit absent fields. */
  counters: IRuntimeUnavailable | IRuntimeCounters
  /** Native resource observations when connected to the original sampler; otherwise unavailable. */
  resources: IRuntimeUnavailable | IRuntimeResources
  /** Bounded original departure history for this connection. */
  recent: readonly IRuntimeRecent[]
  /** Safe observed native exit facts, or unavailable. */
  lastExit:
    | IRuntimeUnavailable
    | Readonly<{
        generation: number
        reason: string
        code: number | IRuntimeUnavailable
        signal: string | IRuntimeUnavailable
        error?: Readonly<{ source?: string; code?: string }>
        observedAt?: number
      }>
}>
/** Local detail keeps its own identity distinct from every remote execution unit. */
export type IRuntimeDetail = Readonly<{
  /** A logical member assembler may append its package-owned portable scheduling state. */
  pool?: Readonly<Record<string, IRpcPortableValue>>
  /** Safe local query identity. */
  identity: IRuntimePeerIdentity
  /** Safe local Peer identity, separate from its remote connections. */
  self: IRuntimePeerIdentity
  /** Callable remote route names accepted by this Peer. */
  methods: readonly string[]
  /** Local callable method names compiled from provide. */
  provide: readonly string[]
  /** Safe detail records from the original connection owner. */
  connections: readonly IRuntimeConnectionDetail[]
  /** Explicitly unavailable for the local Peer view. */
  unit: IRuntimeUnavailable
  /** Explicitly unavailable without an original local unit health owner. */
  health: IRuntimeUnavailable
  /** Explicitly unavailable for the local Peer view. */
  restartCount: IRuntimeUnavailable
  /** Canonical local client counters when available. */
  counters: IRuntimeUnavailable | IRuntimeCounters
  /** Explicitly unavailable; this view does not sample an aggregate host heap. */
  resources: IRuntimeUnavailable
  /** Bounded original departure observations. */
  recent: readonly IRuntimeRecent[]
}>
/** Host summaries use the canonical Host identity and genuine contributed connection records. */
export type IRuntimeOverview = Readonly<{
  /** Safe Host identity belonging to this overview. */
  self: IRuntimePeerIdentity
  /** Current safe connection details contributed by genuine Host registrations. */
  connections: readonly IRuntimeConnectionDetail[]
}>

/** Explicit absence is a frozen own-data value, suitable for JSON, YAML and TOML. */
export function runtimeUnavailable(reason: string): IRuntimeUnavailable {
  return Object.freeze({ status: RuntimeQueryStatus.unavailable, reason })
}

/** One own-data metric shape is shared by resources, counters and lifecycle facts. */
export function runtimeMetric<T>(
  value: T,
  scope: string,
  unit: string,
  observedAt: number
): IRuntimeMetric<T> {
  return Object.freeze({ value, scope, unit, observedAt, clock: RuntimeQueryClock.scheduler })
}

/** Native endpoint cold counts read the original Map sizes without a diagnostic observer. */
export function runtimeCounters(endpoint: object): IRuntimeCounters {
  /** No sent/received/error/last-active source currently exists in the selected canonical owners. */
  const counts = readEndpointClientCounters(endpoint)
  return Object.freeze({
    inFlight: counts
      ? runtimeMetric(
          counts.inFlight,
          RuntimeMetricScope.client,
          RuntimeMetricUnit.calls,
          counts.observedAt
        )
      : runtimeUnavailable(RuntimeQueryReason.counters),
    sent: runtimeUnavailable(RuntimeQueryReason.counters),
    received: runtimeUnavailable(RuntimeQueryReason.counters),
    errors: runtimeUnavailable(RuntimeQueryReason.counters),
    lastActiveAt: runtimeUnavailable(RuntimeQueryReason.counters)
  })
}

/** Read only tagged own error fields; messages, stacks, causes and arbitrary getters stay private. */
export function runtimeErrorIdentity(
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
export function runtimeConnectionDetail(
  directory: IRuntimeConnectionDirectory,
  state?: string,
  facts?: Readonly<{
    supervisor?: ISupervisorSnapshot
    recent?: readonly IRuntimeRecent[]
    report(error: unknown): void
    observedAt?: number
    counters?: IRuntimeCounters
    resources?: IRuntimeResources | IRuntimeUnavailable
  }>
): IRuntimeConnectionDetail {
  /** Native facts and their reporter come from the same canonical registration. */
  const supervisor = facts?.supervisor
  return Object.freeze({
    identity: directory.description
      ? runtimeIdentity({
          name: directory.description.self.name,
          instanceId: directory.description.self.instanceId
        })
      : runtimeUnavailable(RuntimeQueryReason.owner),
    generation:
      directory.description?.self.generation ?? runtimeUnavailable(RuntimeQueryReason.owner),
    kind: directory.kind,
    direction: directory.direction,
    carrier: directory.carrier,
    connection: Object.freeze({ status: state ?? runtimeUnavailable(RuntimeQueryReason.owner) }),
    unit: supervisor
      ? Object.freeze({
          kind: supervisor.kind,
          state: supervisor.state,
          generation: supervisor.generation,
          degraded: Object.freeze([...supervisor.degraded])
        })
      : runtimeUnavailable(RuntimeQueryReason.owner),
    health:
      supervisor?.health?.observedAt === undefined
        ? runtimeUnavailable(RuntimeQueryReason.health)
        : runtimeMetric(
            Object.freeze({ state: supervisor.health.state, failures: supervisor.health.failures }),
            RuntimeMetricScope.unit,
            RuntimeMetricUnit.checks,
            supervisor.health.observedAt
          ),
    restartCount:
      supervisor?.restartCount === undefined || facts?.observedAt === undefined
        ? runtimeUnavailable(RuntimeQueryReason.restarts)
        : runtimeMetric(
            supervisor.restartCount,
            RuntimeMetricScope.unit,
            RuntimeMetricUnit.restarts,
            facts.observedAt
          ),
    methods: Object.freeze(directory.description?.methods.map((method) => method.name) ?? []),
    counters: facts?.counters ?? runtimeUnavailable(RuntimeQueryReason.counters),
    resources: facts?.resources ?? runtimeUnavailable(RuntimeQueryReason.resources),
    recent: Object.freeze([...(facts?.recent ?? [])]),
    lastExit: supervisor?.lastExit
      ? Object.freeze({
          generation: supervisor.lastExit.generation,
          reason: supervisor.lastExit.reason,
          code: supervisor.lastExit.status?.code ?? runtimeUnavailable(RuntimeQueryReason.native),
          signal:
            supervisor.lastExit.status?.signal ?? runtimeUnavailable(RuntimeQueryReason.native),
          ...(supervisor.lastExit.error === undefined
            ? {}
            : { error: runtimeErrorIdentity(supervisor.lastExit.error, facts!.report) }),
          ...(supervisor.lastExit.observedAt === undefined
            ? {}
            : { observedAt: supervisor.lastExit.observedAt })
        })
      : runtimeUnavailable(RuntimeQueryReason.owner)
  })
}

/** Build a whitelist object directly; never stringify an owner and redact afterwards. */
export function runtimeDetail(
  local: IRuntimePeerDescription,
  connections: readonly IRuntimeConnectionDetail[],
  recent: readonly IRuntimeRecent[] = [],
  provide: readonly string[] = local.methods.map((method) => method.name),
  counters?: IRuntimeCounters
): IRuntimeDetail {
  /** The public projection uses the same safe own-data identity shape as the configured Peer. */
  const self = runtimeIdentity({ name: local.self.name, instanceId: local.self.instanceId })
  return Object.freeze({
    identity: self,
    self,
    methods: Object.freeze(local.methods.map((method) => method.name)),
    provide: Object.freeze([...provide]),
    connections: Object.freeze([...connections]),
    unit: runtimeUnavailable(RuntimeQueryReason.localUnit),
    health: runtimeUnavailable(RuntimeQueryReason.health),
    restartCount: runtimeUnavailable(RuntimeQueryReason.restarts),
    counters: counters ?? runtimeUnavailable(RuntimeQueryReason.counters),
    resources: runtimeUnavailable(RuntimeQueryReason.resources),
    recent: Object.freeze([...recent])
  })
}

/** The same admitted projection is formatted for every local query without reflecting its owner. */
export function runtimeQueryOutput<T>(snapshot: T, options?: IRuntimeQueryOptions): T | string {
  return options?.format === undefined ? snapshot : emitOutput(snapshot, options.format)
}

/** Cold query overloads share one safe snapshot and the serialize-owned text emitter. */
export function runtimeQuery<T>(read: () => T | Promise<T>): IRuntimeQuery<T> {
  return (async (options?: IRuntimeQueryOptions) => {
    /** All representations use the same complete safe projection before any text is emitted. */
    const snapshot = await read()
    return runtimeQueryOutput(snapshot, options)
  }) as IRuntimeQuery<T>
}
