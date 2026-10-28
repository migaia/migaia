/** Pool is a complete native resource feature installed by its concrete transport. */
import {
  RpcNativeFeatureKind,
  RpcNativeMembers,
  defaultRpcId,
  type IRpcNativeFeatureContext,
  type IRpcNativeTransportFeature,
  type IRpcNativeMemberRecord,
  type IRpcNativeMemberControls,
  type RpcNativeMemberKind
} from '@migaia/rpc-host/sdk'
import type {
  IRpcOriginHandle,
  IRpcSessionView,
  IRpcOriginSelection,
  IRpcSessionSelection
} from '@migaia/rpc-contract/interfaces'
import type { IAbortSignal } from '@migaia/utils/promise'
import { RpcPoolErrorCode } from '@migaia/rpc-contract/error-code'
import { PoolScheduler, validatePoolOptions } from './pool.ts'
import { PoolMedia } from './media.ts'
import { tagPoolError } from './error.ts'
import { RPC_POOL_PEER_ID, RpcPoolState, RpcPoolText } from './text.ts'
import type { IPoolPluginOptions, IRpcPoolControls } from './types.ts'

/** The sole native publication channel exposes original member and scheduler controls. */
export type IPoolExtensions = Readonly<{
  pool: IRpcPoolControls
  members: IRpcNativeMemberControls<RpcNativeMemberKind>
}>

/** Canonical native query lookup retains ambiguity instead of selecting another resource. */
function uniqueRecord(
  records: ReadonlySet<IRpcNativeMemberRecord> | undefined
): IRpcNativeMemberRecord | null | undefined {
  return records?.size === 1 ? records.values().next().value : records ? null : undefined
}

/** Native resource lookup and the logical projection belong to this feature installation. */
class PoolInstallation implements IRpcOriginSelection {
  /** One original scheduler owns FIFO, acquisition, capacity and shared drain. */
  readonly #pool: PoolScheduler<PoolMedia>
  /** Actual native construction and canonical Session authority come from the transport. */
  readonly #context: IRpcNativeFeatureContext
  /** Genuine source records form the one native resource collection used by member queries. */
  readonly #records = new Map<IRpcNativeMemberRecord, PoolMedia>()
  /** Native name collisions remain ambiguous instead of selecting another resource. */
  readonly #names = new Map<string, Set<IRpcNativeMemberRecord>>()
  /** Current accepted instance identities are a separate native query axis. */
  readonly #instances = new Map<string, Set<IRpcNativeMemberRecord>>()
  /** Index keys are attached to genuine resources solely to remove their previous generation. */
  readonly #keys = new WeakMap<PoolMedia, Readonly<{ name: string; instanceId?: string }>>()
  /** One actual accepted resource supplies descriptive metadata for the logical target. */
  #representative: PoolMedia | undefined
  /** One canonical passive receiver owns public member event subscribers. */
  readonly #members: RpcNativeMembers
  /** Only one logical target enters the Table after actual native readiness. */
  #logical: IRpcOriginHandle | undefined
  /** Cold numeric options were already admitted by the reusable factory. */
  constructor(options: IPoolPluginOptions, context: IRpcNativeFeatureContext) {
    this.#context = context
    this.#members = new RpcNativeMembers({
      kind: context.memberKind,
      self: context.self,
      report: context.report,
      source: {
        values: () => this.#records.keys(),
        byName: (name) => this.#byName(name),
        byInstance: (id) => uniqueRecord(this.#instances.get(id))
      }
    })
    this.#pool = new PoolScheduler(
      options,
      this.#openMember,
      context.report,
      (media) => media.record.current().active
    )
    void this.#pool.closed.then(
      () => this.#members.close(),
      () => this.#members.close()
    )
  }
  /** Acquire transactionally, then publish genuine accepted metadata without logical media. */
  async open(): Promise<Readonly<{ value: IPoolExtensions; dispose: () => Promise<void> }>> {
    try {
      await this.#pool.open()
      const media = this.#records.values().next().value!
      const view = this.#view(media)
      this.#logical = this.#context.attachOrigin({
        id: defaultRpcId(),
        view,
        origin: this,
        source: media,
        assertTransfer: (options) => media.assertTransfer('', options),
        closed: this.#pool.closed,
        close: this.#pool.close,
        ping: this.#ping,
        drain: this.#drain,
        announceDirectory: this.#announce
      })
      return {
        value: Object.freeze({
          pool: Object.freeze({
            stats: this.#pool.stats,
            resize: this.#pool.resize,
            close: this.#pool.close
          }),
          members: this.#members.value
        }),
        dispose: this.#pool.close
      }
    } catch (primary) {
      try {
        await this.#pool.close()
      } catch (cleanup) {
        this.#context.report(cleanup)
      }
      throw primary
    }
  }
  /** Reserve once before actual call/stream construction and release on its original completion. */
  run<T>(
    invoke: (selection: IRpcSessionSelection) => Promise<T>,
    signal?: IAbortSignal
  ): Promise<T> {
    return this.#pool.run(async (media) => invoke(await media.ready(signal)), signal)
  }
  /** Existing native callbacks feed the receiver without another native subscription. */
  readonly #openMember = async (): Promise<PoolMedia> => {
    const media = new PoolMedia(this.#context, this.#refresh, this.#remove)
    await media.open({
      changed: () => this.#refresh(media),
      ready: (record, view, generation) => this.#members.publishReady(record, view, generation),
      native: (record, event, current) => this.#members.publishNative(record, event, current)
    })
    this.#records.set(media.record, media)
    this.#refresh(media)
    return media
  }
  /** Only the local logical address changes; methods and codec are genuine accepted metadata. */
  #view(media: PoolMedia): IRpcSessionView {
    return Object.freeze({
      ...media.current('')!.view,
      name: RPC_POOL_PEER_ID,
      peerId: RPC_POOL_PEER_ID
    })
  }
  /** A genuine native transition updates only that resource's previous/current query keys. */
  readonly #refresh = (media: PoolMedia): void => {
    const record = media.record
    if (!this.#records.has(record)) return
    const previous = this.#keys.get(media)
    const current = media.current('')
    if (previous?.instanceId) this.#removeInstance(previous.instanceId, record)
    if (!previous) {
      let named = this.#names.get(record.name)
      if (!named) {
        named = new Set()
        this.#names.set(record.name, named)
      }
      named.add(record)
    }
    this.#keys.set(media, { name: record.name, instanceId: current?.view.peerId })
    if (current) {
      let instances = this.#instances.get(current.view.peerId)
      if (!instances) {
        instances = new Set()
        this.#instances.set(current.view.peerId, instances)
      }
      instances.add(record)
    }
    if (!this.#representative && current) this.#representative = media
    if (this.#representative === media) this.#project()
    this.#pool.refresh()
  }
  /** A representative change borrows the first ready record from the existing native instance index. */
  #project(): void {
    if (this.#pool.state !== RpcPoolState.open) return
    if (!this.#representative?.current('')) {
      const first = this.#instances.values().next().value?.values().next().value
      this.#representative = first === undefined ? undefined : this.#records.get(first)
    }
    if (this.#representative) this.#logical?.update(this.#view(this.#representative))
  }
  /** Remove exact keys once after the actual native resource cleanup settles. */
  readonly #remove = (media: PoolMedia): void => {
    const record = media.record
    const keys = this.#keys.get(media)
    this.#records.delete(record)
    if (keys) {
      const names = this.#names.get(keys.name)
      names?.delete(record)
      if (!names?.size) this.#names.delete(keys.name)
      if (keys.instanceId) this.#removeInstance(keys.instanceId, record)
      this.#keys.delete(media)
    }
    if (this.#representative === media) {
      this.#representative = undefined
      this.#project()
    }
  }
  /** Retirement removes only this record from one shared external instance identity. */
  #removeInstance(id: string, record: IRpcNativeMemberRecord): void {
    const records = this.#instances.get(id)
    records?.delete(record)
    if (!records?.size) this.#instances.delete(id)
  }

  /** The canonical receiver retains exact native name ambiguity. */
  #byName(name: string): IRpcNativeMemberRecord | null | undefined {
    const records = this.#names.get(name)
    return uniqueRecord(records)
  }
  /** Logical health borrows each real native Session rather than a fabricated logical pong. */
  readonly #ping = (
    options?: Parameters<NonNullable<PoolMedia['handle']>['ping']>[0]
  ): Promise<void> => this.#controls((handle) => handle.ping(options))
  /** Each actual Session receives the same remaining native grace budget. */
  readonly #drain = (remainingMs: number): Promise<void> =>
    this.#controls((handle) => handle.drain(remainingMs))
  /** Provider changes reuse each physical Session's own directory control counter. */
  readonly #announce = (): Promise<void> => this.#controls((handle) => handle.announceDirectory())

  /** Each real Session sends its own controls with its original codec and control counter. */
  async #controls(
    invoke: (handle: NonNullable<PoolMedia['handle']>) => Promise<void>
  ): Promise<void> {
    const operations: Promise<void>[] = []
    for (const media of this.#records.values()) {
      const handle = media.handle
      if (handle?.current()) operations.push(invoke(handle))
    }
    await Promise.all(operations)
  }
}

/** Validate before installation; each native transport acquires its own independent pool. */
export function pool(options: IPoolPluginOptions): IRpcNativeTransportFeature<IPoolExtensions> {
  validatePoolOptions(options)
  return Object.freeze({
    kind: RpcNativeFeatureKind.pool,
    install: async (context: IRpcNativeFeatureContext) => {
      if (!context.openMember)
        throw tagPoolError(
          new TypeError(RpcPoolText.transportUnsupported),
          RpcPoolErrorCode.transportUnsupported
        )
      return new PoolInstallation(options, context).open()
    }
  })
}
