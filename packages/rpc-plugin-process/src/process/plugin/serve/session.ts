/**
 * Retains one genuine Host Session handle, native capacity lease and member-control receipt. Drain,
 * fallback registration and physical retirement reuse those original owners.
 */
import type { IRpcSessionHandle, IRpcSessionView } from '@migaia/rpc-contract/interfaces'
import {
  rpcMemberConnectionDetail,
  RpcMemberConnectionDirection,
  RpcMemberSourceKind,
  RpcMemberQueryStatus,
  type IRpcTransportSetupContext,
  type IRpcNativeMemberRecord,
  type IRpcMemberCurrent
} from '@migaia/rpc-host/sdk'
import { createProcessCleanupError } from '../../error.js'
import type { IProcessConnectionLease } from './admission.js'
import type { IProcessServeFallback } from './types.js'

/** A committed native session borrows the host's one control and lifetime owner. */
export class ProcessServeSession implements IRpcNativeMemberRecord {
  /** Native source ownership grants lifecycle ports, never a business request facade. */
  readonly #context: IRpcTransportSetupContext
  /** Session owns its original codec, physical close and subscriptions. */
  readonly #handle: IRpcSessionHandle
  /** This original native slot is released after physical retirement or rollback. */
  readonly #lease: IProcessConnectionLease
  /** The serve owner removes this exact record without maintaining another peer index. */
  readonly #retire: (session: ProcessServeSession) => void
  /** Caller-selected remaining grace decreases on the original monotonic clock. */
  readonly #remaining: () => number
  /** Initial accepted identity remains available only for this original native resource record. */
  readonly #initial: IRpcSessionView
  /** Physical acquisition direction is supplied by the real child/listener recipe. */
  readonly #direction: 'child' | 'listener'
  /** Cold local overview exposes the real native carrier label without copying a peer index. */
  readonly #carrierId: string
  /** Cold local query timestamps borrow the original native scheduler. */
  readonly now: () => number
  /** Parent and accepted listener peers never gain native execution-unit control authority. */
  readonly ownership = 'borrowed'
  /** Exact original handle identity is the weak metadata key, never a second address index. */
  readonly handle: IRpcSessionHandle
  /** Exact fallback registration is withdrawn when this physical session retires. */
  #removeFallback: (() => void) | undefined
  /** Cleanup is shared by explicit close, fallback and native shutdown callers. */
  #closing: Promise<void> | undefined
  /** The original physical terminal releases its native slot at most once. */
  #retired = false

  /** Capture one already ready Session before adding its fallback resource registration. */
  constructor(
    context: IRpcTransportSetupContext,
    handle: IRpcSessionHandle,
    lease: IProcessConnectionLease,
    retire: (session: ProcessServeSession) => void,
    remaining: () => number,
    view: IRpcSessionView,
    direction: 'child' | 'listener',
    now: () => number,
    carrierId: string
  ) {
    this.#context = context
    this.#handle = handle
    this.#lease = lease
    this.#retire = retire
    this.#remaining = remaining
    this.#initial = view
    this.#direction = direction
    this.#carrierId = carrierId
    this.now = now
    this.handle = handle
    void handle.closed
      .then(this.#released, (error) => {
        this.#context.report(error)
        this.#released()
      })
      .catch(context.report)
  }
  /** Name always belongs to this exact accepted Session, even after a same-name successor arrives. */
  get name(): string {
    return this.current().session?.name ?? this.#initial.name
  }
  /** Borrow the existing canonical index; a successor handle never becomes this native record. */
  readonly current = (): IRpcMemberCurrent => {
    const selected = this.#context.lookup(this.#initial.peerId)
    const active = !this.#retired && selected?.handle === this.#handle
    return { generation: 1, active, ...(active ? { session: selected.view } : {}) }
  }
  /** The Session's real shared readiness remains the sole readiness Promise. */
  readonly whenReady = (): Promise<IRpcSessionView> => this.#handle.ready
  /** Borrowed connections expose accepted methods and explicit unavailable native resource facts. */
  readonly describe = async () => {
    const current = this.current()
    const view = current.session
    return [
      rpcMemberConnectionDetail(
        {
          kind:
            this.#direction === 'child' ? RpcMemberSourceKind.connect : RpcMemberSourceKind.listen,
          direction:
            this.#direction === 'child'
              ? RpcMemberConnectionDirection.spawnedBy
              : RpcMemberConnectionDirection.listen,
          carrier: this.#carrierId,
          ...(view
            ? {
                description: {
                  self: { name: view.name, instanceId: view.peerId, generation: view.generation },
                  methods: [...view.methods.values()]
                }
              }
            : {})
        },
        current.active ? RpcMemberQueryStatus.ready : RpcMemberQueryStatus.closed
      )
    ]
  }
  /** Fallback borrows only the exact original close operation and native connection identity. */
  activate(fallback: IProcessServeFallback | undefined, connectionId: string): void {
    this.#removeFallback = fallback?.add({ connectionId, close: this.close })
    if (this.#retired) this.#removeFallback?.()
  }
  /** Publish the shared Promise before a native drain or detach can synchronously reenter. */
  readonly close = (): Promise<void> => {
    return (this.#closing ??= Promise.resolve().then(() => this.#release()))
  }
  /** Drain the original admitted work, then join Session's sole physical cleanup on every outcome. */
  async #release(): Promise<void> {
    /** Independent cleanup failures retain their original order and identity. */
    const errors: unknown[] = []
    if (!this.#retired) {
      try {
        await this.#context.drain(this.#handle, this.#remaining())
      } catch (error) {
        this.#context.report(error)
      }
    }
    try {
      await this.#context.detach(this.#handle)
    } catch (error) {
      errors.push(error)
    }
    try {
      this.#released()
    } catch (error) {
      errors.push(error)
    }
    if (errors.length) throw createProcessCleanupError(errors)
  }
  /** Real physical retirement withdraws fallback and releases the same native admission slot. */
  readonly #released = (): void => {
    if (this.#retired) return
    this.#retired = true
    try {
      this.#removeFallback?.()
    } finally {
      this.#removeFallback = undefined
      this.#lease.release()
      this.#retire(this)
    }
  }
}
