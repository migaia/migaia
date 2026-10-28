/** Own native-generation observations and instance management; RPC retains physical unit lifetime. */
import { LaunchCause, SupervisorState } from '@migaia/supervision'
import {
  RpcMemberEventName,
  type IRpcMemberEvent,
  type IRpcMemberConnectionDetail
} from '@migaia/rpc-host/sdk'
import { createTrayError, TRAY_SOURCE } from '../../errors.ts'
import { TrayErrorCode } from '../../error-code.ts'
import {
  TrayInstanceState,
  TrayInstanceEvent,
  TrayManagementMode,
  TrayNativeReplacement,
  TrayInternal
} from '../constants.ts'
import {
  membersOf,
  outletOf,
  rpcCallOptions,
  type ITrayRuntimeHost,
  type ITrayRuntimeMembers
} from '../runtime.ts'
import { toWire } from '../portable.ts'
import type { ITrayInstance } from '../typing.ts'
import type { ITrayRecord, ITrayRegistry } from './registry.ts'
import type { createParentTopics } from './topics.ts'
import type { createTrayEvents } from './events.ts'

/** Explicit borrowed parent context keeps metadata, events and native work in their original owners. */
export type ITrayInstancesContext = Readonly<{
  host: ITrayRuntimeHost
  registry: ITrayRegistry
  topics: ReturnType<typeof createParentTopics>
  events: ReturnType<typeof createTrayEvents>
  /** Direct reports keep the original parent's invocation receiver. */
  report(error: unknown): void
  /** Promise reactions borrow the exact original callback, preserving their receiver semantics. */
  observe(error: unknown): void
  current(record: ITrayRecord): void
  isDisposing(): boolean
}>

/** One instance manager owns subscription receipts, generation init and queued management semantics. */
export class TrayInstances {
  /** Original parent authorities are borrowed without duplicating connection or lifecycle state. */
  readonly #context: ITrayInstancesContext
  /** Family receipts retain the actual outlet identity and its original native remover functions. */
  readonly #subscriptions = new Map<
    string,
    { members: ITrayRuntimeMembers; release: (() => void)[] }
  >()

  /** Borrow the parent's exact context before any instance is admitted. */
  constructor(context: ITrayInstancesContext) {
    this.#context = context
  }
  /** One transition emits once; safe errors are copied and frozen before any listener runs. */
  transition = (
    record: ITrayRecord,
    state: ITrayRecord['state'],
    error?: IRpcMemberEvent['error']
  ): void => {
    if (
      record.removed ||
      this.#context.registry.records.get(record.id) !== record ||
      record.state === state
    )
      return
    record.state = state
    /** Public lifecycle event matches the committed state before any listener executes. */
    const event = state === TrayInstanceState.starting ? TrayInstanceEvent.spawned : state
    this.#context.events.publish({
      ...this.#context.registry.snapshot(record),
      event,
      ...(error === undefined ? {} : { error: Object.freeze({ ...error }) })
    })
  }

  /** Outlet detail contains the authoritative native generation and accepted remote identity. */
  identify = (record: ITrayRecord, detail: IRpcMemberConnectionDetail): number => {
    if (!('generation' in detail.unit) || !('instanceId' in detail.identity))
      throw createTrayError(TrayErrorCode.instanceStartFailed)
    this.#context.registry.identify(record, detail.unit.generation, detail.identity.instanceId)
    return detail.unit.generation
  }

  /** Init joins one promise per admission and native generation, never a readiness retry. */
  initOnce = async (record: ITrayRecord, generation: number, config: unknown): Promise<void> => {
    /** One native init Promise is shared only by this exact admission and generation. */
    let pending = record.inits.get(generation)
    if (!pending) {
      pending = outletOf(this.#context.host, record.definition, record.id)
        .send(
          record.instanceId!,
          TrayInternal.init,
          toWire({
            id: record.id,
            host: record.definition.name,
            generation,
            ...(config === undefined ? {} : { config })
          })
        )
        .then(() => undefined)
      record.inits.set(generation, pending)
    }
    await pending
    this.#context.current(record)
    if (record.generation !== generation) throw createTrayError(TrayErrorCode.instanceStartFailed)
  }

  /** Cleanup is the first step of each Tray stop entry while the current child can still answer. */
  shutdown = async (record: ITrayRecord, graceMs = 5000): Promise<void> => {
    if (record.state !== TrayInstanceState.ready) return
    try {
      await outletOf(this.#context.host, record.definition, record.id).send(
        record.instanceId!,
        TrayInternal.shutdown,
        { graceMs },
        rpcCallOptions({ timeoutMs: graceMs })
      )
    } catch (error) {
      this.#context.report(error)
    }
  }

  /** Native snapshots are read only after synchronous supervisor event transitions finish. */
  #reconcile = async (record: ITrayRecord, event: IRpcMemberEvent): Promise<void> => {
    await Promise.resolve()
    if (record.removed || record.management === TrayManagementMode.manual) return
    /** Snapshot is deliberately requested after the preceding synchronous supervisor transition. */
    const detail = await membersOf(this.#context.host, record.id).get(record.id)
    if (
      record.removed ||
      this.#context.registry.records.get(record.id) !== record ||
      !('generation' in detail.unit)
    )
      return
    if (
      typeof event.generation !== 'number' ||
      detail.unit.generation !== event.generation ||
      record.generation > event.generation
    )
      return
    if (
      detail.unit.state === SupervisorState.backoff ||
      detail.unit.state === SupervisorState.starting
    )
      this.transition(record, TrayInstanceState.restarting, event.error)
    else if (detail.unit.state === SupervisorState.stopped)
      this.transition(record, TrayInstanceState.stopped, event.error)
    else if (detail.unit.state === SupervisorState.terminal)
      this.transition(record, TrayInstanceState.failed, event.error)
  }

  /** Attach to a newly created family and correlate background ready entries with their receipt. */
  subscribe = (record: ITrayRecord): void => {
    /** Native family identity remains scoped to this original admission id. */
    const family = record.id
    /** Retain the actual native source identity rather than a copied control facade. */
    const members = membersOf(this.#context.host, record.id)
    if (this.#subscriptions.get(family)?.members === members) return
    this.#releaseSubscription(family)
    /** Every native subscription remover belongs to this exact retained source. */
    const release = [
      members.on(RpcMemberEventName.ready, (event) => this.#memberReady(members, event)),
      members.on(RpcMemberEventName.exit, (event) => {
        /** The event can affect only the currently admitted record with this native name. */
        const admitted = this.#context.registry.records.get(event.name)
        if (admitted && typeof event.generation === 'number') {
          this.#context.topics.remove(admitted, event.generation)
          this.#context.registry.depart(admitted, event.generation)
        }
        if (
          !admitted ||
          event.reason === TrayNativeReplacement ||
          admitted.management === TrayManagementMode.manual
        )
          return
        void this.#reconcile(admitted, event).catch(this.#context.observe)
      }),
      members.on(RpcMemberEventName.terminal, (event) => {
        /** The event can affect only the currently admitted record with this native name. */
        const admitted = this.#context.registry.records.get(event.name)
        if (admitted) void this.#reconcile(admitted, event).catch(this.#context.observe)
      })
    ]
    this.#subscriptions.set(family, { members, release })
  }

  /** Logical removal drops the exact retained outlet before invoking its original native removers. */
  #releaseSubscription(family: string): void {
    /** An absent receipt has no remaining native callback or map ownership to release. */
    const subscription = this.#subscriptions.get(family)
    if (!subscription) return
    this.#subscriptions.delete(family)
    for (const release of subscription.release) release()
  }

  /** Only a genuine later native ready event may enqueue background initialization. */
  #memberReady(members: ITrayRuntimeMembers, event: IRpcMemberEvent): void {
    /** The original admission must still own this safe registered member name. */
    const admitted = this.#context.registry.records.get(event.name)
    if (
      !admitted ||
      admitted.removed ||
      admitted.management === TrayManagementMode.manual ||
      typeof event.generation !== 'number' ||
      typeof event.instanceId !== 'string' ||
      admitted.state === TrayInstanceState.starting
    )
      return
    /** This original event's exact facts fence the queued inspection against later replacements. */
    const receipt = {
      admission: admitted.admission,
      generation: event.generation,
      instanceId: event.instanceId
    }
    /** One queued input retains the original admission and its exact native ready receipt. */
    const initialization = { admitted, members, receipt }
    void admitted.queue
      .run(() =>
        this.#reinitialize(initialization.admitted, initialization.members, initialization.receipt)
      )
      .catch(this.#context.observe)
  }

  /** Recheck the exact ready receipt after native event publication and before application init. */
  async #reinitialize(
    admitted: ITrayRecord,
    members: ITrayRuntimeMembers,
    receipt: Readonly<{ admission: object; generation: number; instanceId: string }>
  ): Promise<void> {
    admitted.management = TrayManagementMode.background
    try {
      await Promise.resolve()
      if (admitted.removed || receipt.admission !== admitted.admission) return
      /** This actual source samples its original accepted/native generation, never a copied state. */
      const detail = await members.get(admitted.id)
      if (
        !('generation' in detail.unit) ||
        !('instanceId' in detail.identity) ||
        detail.unit.generation !== receipt.generation ||
        detail.identity.instanceId !== receipt.instanceId
      )
        return
      this.identify(admitted, detail)
      await this.initOnce(admitted, receipt.generation, admitted.config)
      this.transition(admitted, TrayInstanceState.ready)
    } catch (error) {
      if (!admitted.removed && !this.#context.isDisposing())
        this.transition(admitted, TrayInstanceState.failed)
      this.#context.report(error)
    } finally {
      admitted.management = undefined
    }
  }

  /** Queue removal revokes metadata before awaiting the original install and resource cleanup. */
  remove = async (record: ITrayRecord, graceMs?: number): Promise<void> => {
    /** Removal captures readiness before revoking public admission and topic membership. */
    const wasReady = record.state === TrayInstanceState.ready
    this.#context.topics.remove(record)
    this.#context.registry.revoke(record)
    this.#releaseSubscription(record.id)
    if (record.install) {
      try {
        await record.install
      } catch (error) {
        this.#context.report(error)
      }
    }
    if (wasReady) {
      try {
        await outletOf(this.#context.host, record.definition, record.id).send(
          record.instanceId!,
          TrayInternal.shutdown,
          { graceMs: graceMs ?? 5000 },
          rpcCallOptions({ timeoutMs: graceMs ?? 5000 })
        )
      } catch (error) {
        this.#context.report(error)
      }
    }
    try {
      /** Original Host removal owns physical retirement and its reported cleanup failures. */
      const result = await this.#context.host.unUse(record.id)
      if (!result.ok) for (const error of result.errors) this.#context.report(error)
    } catch (error) {
      this.#context.report(error)
    }
    this.#context.events.publish({
      ...this.#context.registry.snapshot(record),
      event: TrayInstanceEvent.removed
    })
  }

  /** Manual entries own config snapshot, cleanup, native outcome, init and returned snapshot. */
  manage = async (
    record: ITrayRecord,
    operation: 'restart' | 'replace',
    replacement?: { config?: unknown }
  ): Promise<ITrayInstance> => {
    /** Queue admission captures this operation's inputs without sharing mutable closure state. */
    const management = { record, operation, replacement }
    return record.queue.run(async () => {
      const { record, operation, replacement } = management
      this.#context.current(record)
      /** Replacement config is read in queue order and commits only after successful init. */
      const config =
        operation === LaunchCause.replace && replacement && Object.hasOwn(replacement, 'config')
          ? toWire(replacement.config)
          : record.config
      record.management = TrayManagementMode.manual
      try {
        await this.shutdown(record)
        this.transition(record, TrayInstanceState.restarting)
        /** This queued operation borrows its current actual native member controls. */
        const members = membersOf(this.#context.host, record.id)
        /** Native outcome determines whether generation init is allowed to begin. */
        const outcome =
          operation === LaunchCause.restart
            ? await members.restart(record.id)
            : await members.replace(record.id)
        this.#context.current(record)
        /** Only the original ready/replaced outcomes may initialize or commit new config. */
        const accepted =
          'state' in outcome
            ? outcome.state === SupervisorState.ready
            : outcome.kind === TrayNativeReplacement
        if (!accepted) {
          if (
            'state' in outcome &&
            (outcome.state === SupervisorState.idle || outcome.state === SupervisorState.stopped)
          ) {
            this.transition(record, TrayInstanceState.stopped)
            return this.#context.registry.snapshot(record)
          }
          if ('state' in outcome && outcome.state === SupervisorState.disposed)
            throw createTrayError(TrayErrorCode.disposed)
          /** Native non-ready outcomes never fabricate an error or commit replacement config. */
          const cause = 'error' in outcome ? outcome.error : undefined
          throw createTrayError(TrayErrorCode.instanceStartFailed, cause)
        }
        /** Read and correlate the native accepted generation before sending application init. */
        const generation = this.identify(record, await members.get(record.id))
        await this.initOnce(record, generation, config)
        record.config = config
        this.transition(record, TrayInstanceState.ready)
        return this.#context.registry.snapshot(record)
      } catch (error) {
        if (!record.removed && !this.#context.isDisposing()) {
          await Promise.resolve()
          try {
            /** A deferred current native snapshot classifies the original failed management entry. */
            const detail = await membersOf(this.#context.host, record.id).get(record.id)
            if ('state' in detail.unit && detail.unit.state === SupervisorState.stopped)
              this.transition(record, TrayInstanceState.stopped)
            else this.transition(record, TrayInstanceState.failed)
          } catch (secondary) {
            this.#context.report(secondary)
            this.transition(record, TrayInstanceState.failed)
          }
        }
        if (this.#context.isDisposing()) throw createTrayError(TrayErrorCode.disposed)
        if (error && typeof error === 'object' && 'source' in error && error.source === TRAY_SOURCE)
          throw error
        throw createTrayError(TrayErrorCode.instanceStartFailed, error)
      } finally {
        record.management = undefined
      }
    })
  }
  /** Disposal releases every remaining original native subscription receipt once. */
  releaseSubscriptions(): void {
    for (const family of this.#subscriptions.keys()) this.#releaseSubscription(family)
  }
}
