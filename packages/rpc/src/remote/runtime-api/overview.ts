import { emitOutput, type ISerializeTextFormat } from '@migaia/serialize'
import type { ISupervisorSnapshot } from '@migaia/supervision'
import {
  runtimeIdentity,
  type IRuntimePeerDescription,
  type IRuntimePeerIdentity
} from './description.js'
import {
  RuntimeQueryStatus,
  RuntimeQueryReason,
  type RuntimeSourceKind,
  type RuntimeConnectionDirection
} from './constants.js'

/** Formatting is a local cold-query option, never application or wire configuration. */
export type IRuntimeQueryOptions = Readonly<{ format?: ISerializeTextFormat }>
/** Default queries return objects; selecting a format returns only the admitted projection. */
export type IRuntimeQuery<T> = {
  (options?: Readonly<{ format?: undefined }>): Promise<T>
  (options: Readonly<{ format: ISerializeTextFormat }>): Promise<string>
  (options: IRuntimeQueryOptions): Promise<T | string>
}
/** Missing facts are explicit instead of invented zero, null or healthy values. */
export type IRuntimeUnavailable = Readonly<{ status: 'unavailable'; reason: string }>
/** Cold source metadata comes from the actual factory branch, not binding ownership. */
export type IRuntimeConnectionOrigin = Readonly<{
  kind: RuntimeSourceKind
  direction: RuntimeConnectionDirection
}>
/** Safe directory metadata can survive retirement without retaining an endpoint or native handle. */
export type IRuntimeConnectionDirectory = IRuntimeConnectionOrigin &
  Readonly<{
    localDescription: IRuntimePeerDescription
    description?: IRuntimePeerDescription
    carrier: string
  }>
/** Only original registration departures enter the bounded public history. */
export type IRuntimeRecent = Readonly<{
  generation: number
  timestamp: number
  clock: string
  kind: string
  identity?: IRuntimePeerIdentity
  source?: string
  code?: string
}>
/** Connection state and unit state remain separate owner facts. */
export type IRuntimeConnectionDetail = Readonly<{
  identity: IRuntimePeerIdentity | IRuntimeUnavailable
  kind: RuntimeSourceKind
  direction: RuntimeConnectionDirection
  carrier: string
  connection: Readonly<{ status: string | IRuntimeUnavailable }>
  unit:
    | IRuntimeUnavailable
    | Readonly<{
        kind: string
        state: string
        generation: number
        degraded: readonly string[]
      }>
  health: IRuntimeUnavailable
  restartCount: IRuntimeUnavailable
  methods: readonly string[]
  counters: IRuntimeUnavailable
  resources: IRuntimeUnavailable
  recent: readonly IRuntimeRecent[]
  lastExit:
    | IRuntimeUnavailable
    | Readonly<{ generation: number; kind: string; source?: string; code?: string }>
}>
/** Local detail keeps its own identity distinct from every remote execution unit. */
export type IRuntimeDetail = Readonly<{
  identity: IRuntimePeerIdentity
  self: IRuntimePeerIdentity
  methods: IRuntimePeerDescription['methods']
  provide: readonly string[]
  connections: readonly IRuntimeConnectionDetail[]
  unit: IRuntimeUnavailable
  health: IRuntimeUnavailable
  restartCount: IRuntimeUnavailable
  counters: IRuntimeUnavailable
  resources: IRuntimeUnavailable
  recent: readonly IRuntimeRecent[]
}>
/** Host summaries use the canonical Host identity and genuine contributed connection records. */
export type IRuntimeOverview = Readonly<{
  self: IRuntimePeerIdentity
  connections: readonly IRuntimeConnectionDetail[]
}>

/** Explicit absence is a frozen own-data value, suitable for JSON, YAML and TOML. */
export function runtimeUnavailable(reason: string): IRuntimeUnavailable {
  return Object.freeze({ status: RuntimeQueryStatus.unavailable, reason })
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
    supervisor: ISupervisorSnapshot
    recent: readonly IRuntimeRecent[]
    report(error: unknown): void
  }>
): IRuntimeConnectionDetail {
  /** Native facts and their reporter come from the same canonical registration. */
  const supervisor = facts?.supervisor
  return Object.freeze({
    identity: directory.description
      ? runtimeIdentity(directory.description.self)
      : runtimeUnavailable(RuntimeQueryReason.owner),
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
    health: runtimeUnavailable(RuntimeQueryReason.health),
    restartCount: runtimeUnavailable(RuntimeQueryReason.restarts),
    methods: Object.freeze(directory.description?.methods.map((method) => method.name) ?? []),
    counters: runtimeUnavailable(RuntimeQueryReason.counters),
    resources: runtimeUnavailable(RuntimeQueryReason.resources),
    recent: Object.freeze([...(facts?.recent ?? [])]),
    lastExit: supervisor?.lastExit
      ? Object.freeze({
          generation: supervisor.lastExit.generation,
          kind: supervisor.lastExit.reason,
          ...runtimeErrorIdentity(supervisor.lastExit.error, facts!.report)
        })
      : runtimeUnavailable(RuntimeQueryReason.owner)
  })
}

/** Build a whitelist object directly; never stringify an owner and redact afterwards. */
export function runtimeDetail(
  local: IRuntimePeerDescription,
  connections: readonly IRuntimeConnectionDetail[],
  recent: readonly IRuntimeRecent[] = [],
  provide: readonly string[] = local.methods.map((method) => method.name)
): IRuntimeDetail {
  /** The public projection uses the same safe own-data identity shape as the configured Peer. */
  const self = runtimeIdentity(local.self)
  return Object.freeze({
    identity: self,
    self,
    methods: local.methods,
    provide: Object.freeze([...provide]),
    connections: Object.freeze([...connections]),
    unit: runtimeUnavailable(RuntimeQueryReason.localUnit),
    health: runtimeUnavailable(RuntimeQueryReason.health),
    restartCount: runtimeUnavailable(RuntimeQueryReason.restarts),
    counters: runtimeUnavailable(RuntimeQueryReason.counters),
    resources: runtimeUnavailable(RuntimeQueryReason.resources),
    recent: Object.freeze([...recent])
  })
}

/** Cold query overloads share one safe snapshot and the serialize-owned text emitter. */
export function runtimeQuery<T>(read: () => T | Promise<T>): IRuntimeQuery<T> {
  return (async (options?: IRuntimeQueryOptions) => {
    /** All representations use the same complete safe projection before any text is emitted. */
    const snapshot = await read()
    return options?.format === undefined ? snapshot : emitOutput(snapshot, options.format)
  }) as IRuntimeQuery<T>
}
