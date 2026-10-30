/**
 * Connects the original Thread supervisor and native Worker handles to SDK member generation and
 * resource views. It owns actual acquisition and shutdown, not RPC pending calls.
 */
import {
  createThreadSupervisor,
  type IThreadHandle,
  type IThreadSpec,
  type IThreadSupervisorOptions
} from '@migaia/supervision/threads'
import type { ISupervisor, ILaunchContext } from '@migaia/supervision'
import type { IScheduler } from '@migaia/utils/scheduler'
import type { IAbortSignal, INativeAbortSignal } from '@migaia/utils/promise'
import type {
  IRpcSessionHandle,
  IRpcSessionView,
  IRpcTransportContext,
  IRpcTimeoutExecution
} from '@migaia/rpc-contract/interfaces'
import {
  RpcMemberGeneration,
  RpcNativeMembers,
  withRpcLaunchFacts,
  rpcMemberConnectionDetail,
  rpcMemberResources,
  defaultRpcId,
  RpcMemberSourceKind,
  RpcMemberConnectionDirection,
  type IRpcNativeMemberRecord,
  type IRpcNativePoolEvents
} from '@migaia/rpc-host/sdk'
import type { IThreadChannelFactory } from './types.ts'
import { createRpcTimeoutExecution } from '@migaia/rpc-host/features/timeout'
import { portableThreadSpec } from './error.ts'

/** A full source preserves its actual launcher, budget, scheduler and native supervision policy. */
export type IThreadSpawn<THandle extends IThreadHandle = IThreadHandle> = Readonly<{
  spec: IThreadSpec
  launcher: IThreadSupervisorOptions<THandle>['launcher']
  budget: IThreadSupervisorOptions<THandle>['budget']
  scheduler: IScheduler
  channelFactory: IThreadChannelFactory<THandle>
  report(error: unknown): void
  health?: IThreadSupervisorOptions<THandle>['health']
  supervisor?: Partial<
    Pick<
      IThreadSupervisorOptions<THandle>,
      'id' | 'ready' | 'startupTimeoutMs' | 'restart' | 'terminalPolicy' | 'stop' | 'isolation'
    >
  >
}>

/** Adapt one original native supervisor to the shared SDK generation owner, with no Peer facade. */
export class ThreadSource<THandle extends IThreadHandle = IThreadHandle> {
  /** The full native recipe remains the unique source of execution and clock policy. */
  readonly #source: IThreadSpawn<THandle>
  /** Only the installed host can attach Sessions or issue lifecycle control. */
  readonly #context: IRpcTransportContext
  /** The source's stable issuer distinguishes its restart generations. */
  readonly #providerId: string
  /** Private members lend their original events to the pool's single receiver. */
  readonly #events: IRpcNativePoolEvents | undefined
  /** An omitted parent name remains absent from every actual generation's trusted launch facts. */
  readonly #childName: string | undefined
  /** The original pool registration keeps its first genuine accepted native name after retirement. */
  #memberName: string | undefined
  /** Health and beforeTerminate use the exact accepted Session for that original native unit. */
  readonly #sessions = new WeakMap<THandle, IRpcSessionHandle>()
  /** The original registration's admitted native wall cap stays fixed across generation replacement. */
  readonly #callTimeoutCap: IRpcTimeoutExecution | undefined
  /** Cold sampling retains only the accepted native unit and its exact directory receipt. */
  #accepted: Readonly<{ unit: THandle; view: IRpcSessionView }> | undefined
  /** The sole native supervisor still owns budgets, stop, restart and native actual-exit receipts. */
  readonly supervisor: ReturnType<typeof createThreadSupervisor<THandle>>
  /** The shared SDK algorithm owns all accepted/rebind/retire state. */
  readonly generation: RpcMemberGeneration<THandle, IThreadSpec>
  /** Passive member controls borrow this one registration and supervisor. */
  readonly members: RpcNativeMembers<'thread'> | undefined
  /** No second member registry is needed for a single installed source. */
  readonly record: IRpcNativeMemberRecord

  /** Capture portable input before constructing supervision and publish no member before readiness. */
  constructor(
    source: IThreadSpawn<THandle>,
    context: IRpcTransportContext,
    name: string | undefined,
    events?: IRpcNativePoolEvents
  ) {
    this.#source = source
    this.#context = context
    this.#providerId = defaultRpcId()
    this.#events = events
    this.#childName = name
    /** Data capture stays before native Worker or supervisor construction. */
    const spec = portableThreadSpec(source.spec)
    this.supervisor = createThreadSupervisor({
      ...source.supervisor,
      id: source.supervisor?.id ?? this.#providerId,
      spec,
      launcher: { capabilities: source.launcher.capabilities, launch: this.#launch },
      budget: source.budget,
      scheduler: source.scheduler,
      report: source.report,
      health:
        source.health ??
        (source.launcher.capabilities['exit-observation'] !== 'enforced'
          ? { check: this.#health }
          : undefined),
      stop: { ...source.supervisor?.stop, beforeTerminate: this.#beforeTerminate }
    })
    this.#callTimeoutCap =
      spec.limits?.callWallTimeMs === undefined
        ? undefined
        : createRpcTimeoutExecution({ ms: spec.limits.callWallTimeMs, scheduler: source.scheduler })
    this.generation = new RpcMemberGeneration({
      context,
      binding: {
        ownership: 'owned',
        supervisor: this.supervisor,
        scheduler: source.scheduler,
        openCarrier: this.#openCarrier
      },
      signal: context.signal,
      report: context.report,
      beforeRelease: () => this.supervisor.stop(),
      onReady: (view, generation, unit, session) => {
        this.#accepted = { unit, view }
        this.#memberName ??= view.name
        this.#sessions.set(unit, session)
        if (this.#events) {
          this.#events.ready(this.record, view, generation)
          this.#events.changed()
        } else this.members!.publishReady(this.record, view, generation)
      },
      onNative: (event, current) => {
        if (this.#accepted?.view !== this.generation.current().session) this.#accepted = undefined
        if (this.#events) this.#events.native(this.record, event, current)
        else this.members!.publishNative(this.record, event, current)
      }
    })
    /** Private naming borrows the actual accepted directory, never a generated pool alias. */
    const identity = { owner: this, name: name ?? context.namespace }
    this.record = {
      get name() {
        return identity.owner.#memberName ?? identity.name
      },
      ownership: 'owned',
      supervisor: this.supervisor as ISupervisor<unknown, unknown>,
      current: () => this.generation.current(),
      whenReady: () => this.generation.rebind(),
      prepareReplacement: (value) => portableThreadSpec(value as IThreadSpec),
      describe: this.#describe,
      now: () => source.scheduler.now()
    }
    this.members = events
      ? undefined
      : new RpcNativeMembers({
          kind: 'thread',
          self: context.self,
          report: context.report,
          source: {
            values: () => [this.record],
            byName: (value) => (value === this.record.name ? this.record : undefined),
            byInstance: (value) =>
              value === this.generation.current().session?.peerId ? this.record : undefined
          }
        })
  }
  /** Add only trusted cold facts while retaining the exact original custom launcher context. */
  readonly #launch = (input: IThreadSpec, context: ILaunchContext): Promise<THandle> => {
    /** Host remains the sole identity owner; bootstrap parent has exactly the original two fields. */
    const self = this.#context.self()
    /** One explicit invocation record keeps the callback capture below the v3 limit. */
    const invocation = { launcher: this.#source.launcher, input, context }
    return withRpcLaunchFacts(
      context,
      {
        ...(this.#childName === undefined ? {} : { childName: this.#childName }),
        parent: { name: self.name, instanceId: self.instanceId },
        generation: {
          kind: 'restart',
          value: context.executionGeneration ?? 0,
          providerId: this.#providerId
        }
      },
      () => invocation.launcher.launch(invocation.input, invocation.context)
    )
  }
  /** Keep the original health clock; false leaves its deadline entirely to supervision. */
  readonly #health = async (unit: THandle, signal: IAbortSignal): Promise<void> => {
    /** Startup is governed by the original native readiness deadline until Session attaches. */
    const session = this.#sessions.get(unit)
    if (session) await this.#context.ping(session, { timeoutMs: false, signal })
  }
  /** Drain exactly this native unit under the same remaining grace, then invoke its original hook. */
  readonly #beforeTerminate = async (
    unit: THandle,
    signal: INativeAbortSignal,
    remainingMs: () => number
  ): Promise<void> => {
    /** The actual accepted handle is never selected by a mutable peer name. */
    const session = this.#sessions.get(unit)
    try {
      if (session) await this.#context.drain(session, remainingMs())
      if (!signal.aborted)
        await (0, this.#source.supervisor?.stop?.beforeTerminate)?.(unit, signal, remainingMs)
    } catch (primary) {
      if (session) await this.#context.detach(session, primary).catch(this.#context.report)
      throw primary
    }
    /** The original hook may still use RPC; only afterwards does the same Session finish closing. */
    if (session) await this.#context.detach(session)
  }
  /** Link an acquired native unit to the shared SDK's subsequent real Session attachment. */
  readonly #openCarrier = async (unit: THandle, signal: IAbortSignal) => {
    /** Full custom factories retain the original acquisition signal and Promise failure. */
    const carrier = await this.#source.channelFactory.open(unit, signal)
    return {
      carrier,
      localSourceFacts: {
        expectedPeerId: unit.identity.fingerprint,
        callTimeoutCap: this.#callTimeoutCap,
        isExclusive: () => this.#source.channelFactory.isExclusive?.(unit) ?? false
      }
    }
  }
  /** Cold local queries project actual accepted directory and supervision facts without a facade. */
  readonly #describe = async () => {
    /** The selected snapshot is read once; resources await their canonical native sampler receiver. */
    const view = this.generation.current().session
    /** The original native unit and its accepted receipt are captured before asynchronous sampling. */
    const selected = this.#accepted?.view === view ? this.#accepted : undefined
    /** Supervisor diagnostics describe this same selection even if a replacement completes later. */
    const snapshot = this.supervisor.inspect()
    /** The shared original sampler never switches to a successor after awaiting native usage. */
    /** One borrowed operation carries the captured owner/selection across the native sampler await. */
    const selection = { owner: this, selected, view }
    /** Native metrics belong only to the originally captured unit and accepted receipt. */
    const resources = await rpcMemberResources(
      selected?.unit,
      'thread',
      () => this.#source.scheduler.now(),
      this.#context.report,
      () =>
        selection.owner.#accepted === selection.selected &&
        selection.owner.generation.current().session === selection.view
    )
    return [
      rpcMemberConnectionDetail(
        {
          kind: RpcMemberSourceKind.spawn,
          direction: RpcMemberConnectionDirection.spawned,
          carrier: this.#providerId,
          ...(view
            ? {
                description: {
                  self: { name: view.name, instanceId: view.peerId, generation: view.generation },
                  methods: [...view.methods.values()]
                }
              }
            : {})
        },
        snapshot.state,
        {
          supervisor: snapshot,
          resources,
          observedAt: this.#source.scheduler.now(),
          report: this.#context.report
        }
      )
    ]
  }
  /** Final cleanup joins the sole generation owner before closing passive member observers. */
  async close(): Promise<void> {
    try {
      await this.generation.close()
    } finally {
      this.#accepted = undefined
      this.members?.close()
    }
  }
}
