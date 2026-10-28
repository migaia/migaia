/**
 * Defines the passive members query/control extension and its actual native source lookup ports.
 * Transport owners lend their existing records, indexes, samplers and supervisor controls; these
 * contracts add no connection registry, generation algorithm or business-request facade.
 */
import type {
  ISupervisor,
  SupervisorState,
  IReadyOutcome,
  IReplaceOutcome
} from '@migaia/supervision'
import type { ISerializeTextFormat } from '@migaia/serialize'
import type { IRpcMemberCurrent } from './member-types.ts'
import type {
  IRpcMemberIdentity,
  IRpcMemberOverview,
  IRpcMemberConnectionDetail,
  IRpcMemberQueryOptions
} from './native-members-overview.ts'
import type { IRpcMemberEventPublisher } from './native-members-events.ts'
import type {
  RpcMemberSourceKind,
  RpcMemberConnectionDirection,
  RpcNativeMemberKind
} from './native-members-constants.ts'

/** The exact native registration supplies all facts; no request directory or supervisor is copied. */
export type IRpcNativeMemberRecord = Readonly<{
  name: string
  ownership: 'owned' | 'borrowed'
  supervisor?: ISupervisor<unknown, unknown>
  current(): IRpcMemberCurrent
  whenReady?(): Promise<unknown>
  prepareReplacement?(spec: unknown): unknown
  describe(): Promise<readonly IRpcMemberConnectionDetail[]>
  now(): number
}>
/** Native owners lend their existing indexes; null retains an ambiguous match without a fallback. */
export type IRpcNativeMemberSource = Readonly<{
  values(): Iterable<IRpcNativeMemberRecord>
  byName(name: string): IRpcNativeMemberRecord | null | undefined
  byInstance(instanceId: string): IRpcNativeMemberRecord | null | undefined
}>
/** Name, native state, acquisition kind and direction remain independent local-query axes. */
export type IRpcMemberListFilter = Readonly<{
  state?: SupervisorState
  name?: Readonly<{ exact: string; prefix?: never }> | Readonly<{ prefix: string; exact?: never }>
  kind?: RpcMemberSourceKind
  direction?: RpcMemberConnectionDirection
}>
/** Formatting changes only the safe output representation after selection and cold sampling. */
export type IRpcMemberListOptions = IRpcMemberQueryOptions &
  Readonly<{ filter?: IRpcMemberListFilter }>
/** Exact instance identities take precedence over registered names for string queries. */
export type IRpcMemberTarget = string | Readonly<{ name: string; instanceId: string }>
/** Omitted formats keep safe own-data results; explicit formats return serialize-owned text. */
export type IRpcMemberListQuery = {
  (options?: IRpcMemberListOptions & Readonly<{ format?: undefined }>): Promise<IRpcMemberOverview>
  (options: IRpcMemberListOptions & Readonly<{ format: ISerializeTextFormat }>): Promise<string>
  (options: IRpcMemberListOptions): Promise<IRpcMemberOverview | string>
}
/** Every format samples the same exact captured registration and accepted instance. */
export type IRpcMemberTargetQuery = {
  (
    target: IRpcMemberTarget,
    options?: Readonly<{ format?: undefined }>
  ): Promise<IRpcMemberConnectionDetail>
  (target: IRpcMemberTarget, options: Readonly<{ format: ISerializeTextFormat }>): Promise<string>
  (
    target: IRpcMemberTarget,
    options: IRpcMemberQueryOptions
  ): Promise<IRpcMemberConnectionDetail | string>
}
/** Platform options retain native process SIGTERM and never expose a shared-process thread signal. */
export type IRpcNativeMemberControls<K extends RpcNativeMemberKind> = Pick<
  IRpcMemberEventPublisher,
  'on' | 'watch'
> &
  Readonly<{
    list: IRpcMemberListQuery
    get: IRpcMemberTargetQuery
    stop(
      name: string,
      options?: Readonly<{ graceMs?: number }> &
        (K extends 'process' ? Readonly<{ signal?: 'SIGTERM' }> : object)
    ): Promise<void>
    kill(name: string): Promise<void>
    restart(name: string): Promise<IReadyOutcome<unknown>>
    replace(name: string, spec?: unknown): Promise<IReplaceOutcome>
  }>
/** Only original native ownership, safe host identity and readonly lookup enter this receiver. */
export type IRpcNativeMembersOptions<K extends RpcNativeMemberKind> = Readonly<{
  kind: K
  /** Native child adoption remains visible; each query captures this identity before sampling. */
  self: IRpcMemberIdentity | (() => IRpcMemberIdentity)
  source: IRpcNativeMemberSource
  report(error: unknown): void
}>
