/**
 * Implements the passive local members namespace over genuine native records and existing indexes.
 * Queries project safe sampled facts and commands borrow original supervisor/generation operations;
 * only subscriber/watch lifetime is owned here, with native events supplied explicitly.
 */
import { SupervisorState, type ISupervisorEvent } from '@migaia/supervision'
import type { IRpcSessionView } from '@migaia/rpc-contract/interfaces'
import { RpcCoreErrorCode } from '@migaia/rpc-contract/error-code'
import { RuntimeApiErrorText } from '@migaia/rpc-contract/errors'
import { createRpcError } from '../host/error-owner.js'
import { createRpcMemberEventPublisher } from './native-members-events.js'
import {
  rpcMemberQueryOutput,
  rpcMemberUnavailable,
  rpcMemberErrorIdentity
} from './native-members-overview.js'
import {
  RpcMemberEventName as Event,
  RpcMemberQueryReason as Reason,
  RpcMemberQueryClock as Clock,
  RpcMemberSourceKind,
  RpcMemberConnectionDirection,
  RpcNativeMemberKind,
  RpcMemberStopSignal
} from './native-members-constants.js'
import type { IRpcMemberCurrent } from './member-types.js'
import type {
  IRpcNativeMembersOptions,
  IRpcNativeMemberRecord,
  IRpcMemberListFilter,
  IRpcNativeMemberControls,
  IRpcMemberListQuery,
  IRpcMemberTargetQuery,
  IRpcMemberTarget
} from './native-members-types.js'

/** Preserve the original query rejection before any sampler or native handle is touched. */
function validateMemberFilter(filter?: IRpcMemberListFilter): void {
  if (filter === undefined) return
  /** Own-key discrimination rejects exact+prefix even if one value is undefined. */
  const name = filter?.name
  if (
    !filter ||
    typeof filter !== 'object' ||
    (filter.state !== undefined && !Object.values(SupervisorState).includes(filter.state)) ||
    (filter.kind !== undefined && !Object.values(RpcMemberSourceKind).includes(filter.kind)) ||
    (filter.direction !== undefined &&
      !Object.values(RpcMemberConnectionDirection).includes(filter.direction)) ||
    (name !== undefined &&
      (!name ||
        typeof name !== 'object' ||
        Object.hasOwn(name, 'exact') === Object.hasOwn(name, 'prefix') ||
        typeof (Object.hasOwn(name, 'exact') ? name.exact : name.prefix) !== 'string'))
  )
    throw createRpcError(RpcCoreErrorCode.invalidConfig, RuntimeApiErrorText.filterInvalid)
}

/** One passive native receiver borrows original indexes and execution; no business calls live here. */
export class RpcNativeMembers<K extends RpcNativeMemberKind = RpcNativeMemberKind> {
  /** Configuration captures only genuine native owner ports and safe local identity. */
  readonly #options: IRpcNativeMembersOptions<K>
  /**
   * Subscriber/watch lifetime belongs here, while native observations arrive through explicit
   * ports.
   */
  readonly #events = createRpcMemberEventPublisher()
  /** The frozen namespace extension is installed through the sole native plugin-host channel. */
  readonly value: IRpcNativeMemberControls<K>

  /** Publish exact arrow callables without wrapping native stop/kill Promise identities. */
  constructor(options: IRpcNativeMembersOptions<K>) {
    this.#options = options
    this.value = Object.freeze({
      list: this.#list,
      get: this.#get,
      stop: this.#stop,
      kill: this.#kill,
      restart: this.#restart,
      replace: this.#replace,
      on: this.#events.on,
      watch: this.#events.watch
    })
  }

  /** Null is an ambiguous original index result and never grants a fallback target. */
  #require(record: IRpcNativeMemberRecord | null | undefined): IRpcNativeMemberRecord {
    if (!record)
      throw createRpcError(
        record === null ? RpcCoreErrorCode.capabilityConflict : RpcCoreErrorCode.targetUnknown,
        record === null ? RuntimeApiErrorText.targetAmbiguous : RuntimeApiErrorText.targetUnknown
      )
    return record
  }
  /** Commands select committed registrations, including stopped owners, before their native queue. */
  #controlled(
    name: string
  ): IRpcNativeMemberRecord & { supervisor: NonNullable<IRpcNativeMemberRecord['supervisor']> } {
    if (typeof name !== 'string' || !name)
      throw createRpcError(RpcCoreErrorCode.invalidConfig, RuntimeApiErrorText.targetInvalid)
    /** Native ownership cannot be upgraded by accepted wire metadata or a borrowed supervisor. */
    const record = this.#require(this.#options.source.byName(name))
    if (record.ownership !== 'owned' || !record.supervisor)
      throw createRpcError(RpcCoreErrorCode.capabilityConflict, RuntimeApiErrorText.controlBorrowed)
    return record as IRpcNativeMemberRecord & {
      supervisor: NonNullable<IRpcNativeMemberRecord['supervisor']>
    }
  }
  /** Reject invalid commands through their Promise boundary without wrapping native stop completion. */
  readonly #stop = (
    name: string,
    options?: Readonly<{ graceMs?: number; signal?: string }>
  ): Promise<void> => {
    try {
      if (
        (options?.graceMs !== undefined &&
          (!Number.isFinite(options.graceMs) || options.graceMs < 0)) ||
        (options &&
          Object.hasOwn(options, 'signal') &&
          (this.#options.kind !== RpcNativeMemberKind.process ||
            options.signal !== RpcMemberStopSignal))
      )
        throw createRpcError(RpcCoreErrorCode.invalidConfig, RuntimeApiErrorText.stopInvalid)
      return this.#controlled(name).supervisor.stop(
        options?.graceMs === undefined ? undefined : { graceMs: options.graceMs }
      )
    } catch (error) {
      return Promise.reject(error)
    }
  }
  /** Force upgrades the native supervisor's actual pending stop and preserves its Promise identity. */
  readonly #kill = (name: string): Promise<void> => {
    try {
      return this.#controlled(name).supervisor.kill()
    } catch (error) {
      return Promise.reject(error)
    }
  }
  /**
   * Native ready outcome is retained until the same registration's shared generation is
   * addressable.
   */
  readonly #restart: IRpcNativeMemberControls<K>['restart'] = (name) => {
    try {
      /** Capture before await so a later installation can never become this command's target. */
      const record = this.#controlled(name)
      return record.supervisor.restart().then(async (outcome) => {
        if (outcome.state === SupervisorState.ready) await record.whenReady?.()
        return outcome
      })
    } catch (error) {
      return Promise.reject(error)
    }
  }
  /**
   * Original platform spec preparation precedes native replacement and exact generation
   * publication.
   */
  readonly #replace: IRpcNativeMemberControls<K>['replace'] = (name, spec) => {
    try {
      /** The native registration alone understands its process/thread/coroutine specification. */
      const record = this.#controlled(name)
      /** Undefined retains the supervisor's original spec rather than manufacturing a new one. */
      const replacement =
        spec === undefined
          ? undefined
          : record.prepareReplacement
            ? record.prepareReplacement(spec)
            : spec
      return record.supervisor
        .replace(replacement === undefined ? undefined : { spec: replacement })
        .then(async (outcome) => {
          if (outcome.kind === 'replaced') await record.whenReady?.()
          return outcome
        })
    } catch (error) {
      return Promise.reject(error)
    }
  }
  /** Name filtering happens before asynchronous native sampling; other axes combine by AND. */
  readonly #list: IRpcMemberListQuery = (async (options) => {
    validateMemberFilter(options?.filter)
    /** Native bootstrap may adopt self after installation; one query keeps one identity snapshot. */
    const self =
      typeof this.#options.self === 'function' ? (0, this.#options.self)() : this.#options.self
    /** Capture exact committed registration receipts before the first native sampler can yield. */
    const records = Array.from(this.#options.source.values()).filter((record) => {
      const name = options?.filter?.name
      return (
        !name ||
        ('exact' in name ? record.name === name.exact : record.name.startsWith(name.prefix!))
      )
    })
    /** Each native describe owner captures its original unit before its own asynchronous work. */
    const details = await Promise.all(records.map((record) => record.describe()))
    /** Projection selection never triggers hidden management or business frames. */
    const connections = details.flat().filter((detail) => {
      const filter = options?.filter
      return (
        (!filter?.state || ('state' in detail.unit && detail.unit.state === filter.state)) &&
        (!filter?.kind || detail.kind === filter.kind) &&
        (!filter?.direction || detail.direction === filter.direction)
      )
    })
    return rpcMemberQueryOutput(
      Object.freeze({ self, connections: Object.freeze(connections) }),
      options
    )
  }) as IRpcMemberListQuery
  /** Exact instance selection precedes name fallback and never samples unrelated units. */
  readonly #get: IRpcMemberTargetQuery = (async (target: IRpcMemberTarget, options) => {
    /** Names and accepted ids remain distinct even when their strings happen to collide. */
    const name = typeof target === 'string' ? target : target?.name
    /** Structured queries must match both supplied identity fields on one exact receipt. */
    const id = typeof target === 'string' ? target : target?.instanceId
    if (typeof name !== 'string' || !name || typeof id !== 'string' || !id)
      throw createRpcError(RpcCoreErrorCode.invalidConfig, RuntimeApiErrorText.targetInvalid)
    /** An ambiguous id is terminal; only an absent id permits the original name fallback. */
    const instance = this.#options.source.byInstance(id)
    /** Capture the selected receipt before its cold describe may suspend. */
    const record = this.#require(
      instance === undefined && typeof target === 'string'
        ? this.#options.source.byName(name)
        : instance
    )
    if (typeof target !== 'string' && record.name !== name) this.#require(undefined)
    /** Exact instance queries select one corresponding safe connection from the original sampler. */
    const details = await record.describe()
    /** Name-only reads preserve stopped registrations that no longer have an accepted Session. */
    const matches = instance
      ? details.filter(
          (detail) => 'instanceId' in detail.identity && detail.identity.instanceId === id
        )
      : details
    if (matches.length !== 1) this.#require(matches.length ? null : undefined)
    return rpcMemberQueryOutput(matches[0]!, options)
  }) as IRpcMemberTargetQuery

  /** Accept actual Session readiness after the native generation owner has committed its pointer. */
  publishReady(record: IRpcNativeMemberRecord, session: IRpcSessionView, generation: number): void {
    this.#events.publish(
      Object.freeze({
        type: Event.ready,
        name: record.name,
        instanceId: session.peerId,
        generation,
        timestamp: record.now(),
        clock: Clock.scheduler
      }),
      this.#options.report
    )
  }
  /** Project the original native event once; no second native subscription or lifecycle is created. */
  publishNative(
    record: IRpcNativeMemberRecord,
    event: ISupervisorEvent<unknown>,
    current?: IRpcMemberCurrent
  ): void {
    if (
      event.type !== Event.exit &&
      event.type !== Event.restart &&
      event.type !== Event.degraded &&
      event.type !== Event.terminal
    )
      return
    /** Terminal has no event generation; the exact supervisor retains its final native attempt. */
    const generation =
      event.type === Event.terminal ? record.supervisor?.generation : event.generation
    /** A pre-retirement snapshot preserves accepted identity for the original departing generation. */
    const identity =
      current && current.generation === generation ? current.session?.peerId : undefined
    this.#events.publish(
      Object.freeze({
        type: event.type,
        name: record.name,
        generation: generation || rpcMemberUnavailable(Reason.owner),
        instanceId: identity ?? rpcMemberUnavailable(Reason.owner),
        timestamp:
          event.type === Event.terminal
            ? rpcMemberUnavailable(Reason.owner)
            : (event.observedAt ?? rpcMemberUnavailable(Reason.owner)),
        clock: Clock.scheduler,
        ...(event.type === Event.exit
          ? {
              reason: event.reason,
              code: event.status?.code ?? rpcMemberUnavailable(Reason.native),
              signal: event.status?.signal ?? rpcMemberUnavailable(Reason.native),
              ...(event.error === undefined
                ? {}
                : { error: rpcMemberErrorIdentity(event.error, this.#options.report) })
            }
          : event.type === Event.terminal
            ? { error: rpcMemberErrorIdentity(event.error, this.#options.report) }
            : event.type === Event.restart
              ? { count: event.count }
              : { degraded: Object.freeze([...event.degraded]) })
      }),
      this.#options.report
    )
  }
  /** Transport disposal ends only passive subscriber lifetime; supervision remains native-owned. */
  close(): void {
    this.#events.close()
  }
}
