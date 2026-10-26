/**
 * Connects owned coroutine supervision or borrowed native-port custody to SDK member generations
 * and controls. Native task settlement and cleanup remain separate from Host request execution.
 */
import {
  createCoroutineSupervisor,
  type ICoroutineHandle,
  type ICoroutineSpec,
  type ICoroutineSupervisorOptions
} from '@migaia/supervision/coroutine'
import { BudgetOverflow, createUnitBudget, type ISupervisor } from '@migaia/supervision'
import { systemScheduler } from '@migaia/utils/scheduler'
import { deferred, type INativeAbortSignal } from '@migaia/utils/promise'
import type {
  IRpcSessionHandle,
  IRpcSessionView,
  IRpcTransportContext
} from '@migaia/rpc-contract/interfaces'
import { RpcError, RuntimeApiErrorText } from '@migaia/rpc-contract/errors'
import { RpcCoreErrorCode } from '@migaia/rpc-contract/error-code'
import {
  RpcMemberGeneration,
  RpcNativeMembers,
  rpcMemberConnectionDetail,
  RpcMemberSourceKind,
  RpcMemberConnectionDirection,
  defaultRpcId,
  type IRpcNativeMemberRecord,
  type IRpcNativePoolEvents,
  type IRpcLaunchFacts
} from '@migaia/rpc-host/sdk'
import {
  connectionOf,
  parentConnectionOf,
  wrapCoroutineTask,
  type ICoroutineConnection,
  type ICoroutineMessagePort,
  type ICoroutineReplaceSpec,
  type ICoroutineUserTask,
  type ICoroutineConnect
} from './coroutine-task.js'
import { coroutineCarrier } from './coroutine-port.js'
import type { ICoroutinePluginOptions } from './coroutine-plugin.js'

/** The original cooperative profile owns restart, terminal, capacity, stop and heartbeat policy. */
export type ICoroutineSupervisorPolicy = Readonly<
  Partial<
    Pick<
      ICoroutineSupervisorOptions<ICoroutineMessagePort>,
      'restart' | 'terminalPolicy' | 'startupTimeoutMs' | 'stop' | 'budget' | 'heartbeat'
    >
  >
>

/** The original exact-unit map retains native connection custody before accepted Session binding. */
type ICoroutineSessionBinding = {
  connection: ICoroutineConnection
  session?: IRpcSessionHandle
}

/**
 * One native installation borrows the shared generation/members algorithms without another
 * registry.
 */
export class CoroutineSource {
  /** Cold source configuration belongs to this genuine installation only. */
  readonly #options: ICoroutinePluginOptions
  /** Actual Host authority attaches Sessions and supplies parent identity/control. */
  readonly #context: IRpcTransportContext
  /** Initial and replacement task cleanup borrow the same original effective reporter. */
  readonly #report: (error: unknown) => void
  /** The original optional pool receiver determines whether native child naming stays private. */
  readonly #events: IRpcNativePoolEvents | undefined
  /** Repeated or reentrant installation cleanup joins the original completion Promise. */
  #closing: Promise<void> | undefined
  /** This actual native source is the unique issuer for all of its restart generations. */
  readonly #id = defaultRpcId()
  /** Native registration identity survives inactive generations without inventing a pool alias. */
  #memberName: string | undefined
  /** Supervision alone owns execution, cooperative stop, health and retained late-exit leases. */
  readonly #supervisor:
    | ReturnType<typeof createCoroutineSupervisor<ICoroutineMessagePort>>
    | undefined
  /** Owned modes use the unique SDK generation/rebind/resource owner. */
  readonly #generation:
    | RpcMemberGeneration<
        ICoroutineHandle<ICoroutineMessagePort>,
        ICoroutineSpec<ICoroutineMessagePort>
      >
    | undefined
  /** Borrowed child mode owns only its original parent's Session handle. */
  readonly #parent: IRpcSessionHandle | undefined
  /** A borrowed accepted directory remains safe descriptive data after its physical retirement. */
  #view: IRpcSessionView | undefined
  /** Native parent EOF is an actual physical fact, independent of a stale safe view. */
  #closed = false
  /** Native stop/drain selects the exact original unit instead of a replaceable display name. */
  readonly #sessions = new WeakMap<
    ICoroutineHandle<ICoroutineMessagePort>,
    ICoroutineSessionBinding
  >()
  /** Passive control/query/event projection borrows this one original native registration. */
  readonly members: RpcNativeMembers<'coroutine'> | undefined
  /** One installed source needs no parallel member map. */
  readonly record: IRpcNativeMemberRecord

  /** Acquire native policy/resources only during actual Host installation. */
  constructor(
    options: ICoroutinePluginOptions,
    context: IRpcTransportContext,
    source: Readonly<{ task?: ICoroutineUserTask; parent?: ICoroutineConnect }>,
    events?: IRpcNativePoolEvents
  ) {
    this.#options = options
    this.#context = context
    this.#report = options.report ?? context.report
    this.#events = events
    if (source.task) {
      this.#supervisor = createCoroutineSupervisor({
        ...options.supervisor,
        id: this.#id,
        spec: { task: wrapCoroutineTask(source.task, this.#report, this.#facts) },
        scheduler: systemScheduler,
        budget:
          options.supervisor?.budget ??
          createUnitBudget({ kind: 'coroutine', maxUnits: 1, overflow: BudgetOverflow.reject }),
        report: this.#report,
        stop: { ...options.supervisor?.stop, beforeTerminate: this.#beforeTerminate }
      })
      this.#generation = new RpcMemberGeneration({
        context,
        binding: {
          ownership: 'owned',
          supervisor: this.#supervisor,
          scheduler: systemScheduler,
          openCarrier: this.#openCarrier
        },
        signal: context.signal,
        report: this.#report,
        beforeRelease: () => this.#supervisor!.stop(),
        onReady: (view, generation, unit, session) => {
          /** Original carrier acquisition precedes this exact generation's accepted readiness. */
          const binding = this.#sessions.get(unit)!
          binding.session = session
          binding.connection.bindParent(session)
          if (events) {
            this.#memberName ??= view.name
            events.ready(this.record, view, generation)
            events.changed()
          } else this.members!.publishReady(this.record, view, generation)
        },
        onNative: (event, current) => {
          if (events) events.native(this.record, event, current)
          else this.members!.publishNative(this.record, event, current)
        }
      })
    } else {
      /** The exact token's physical port and stable launch facts were minted by its original task. */
      const connection = connectionOf(source.parent!)
      /** Only the original task token lends child naming and parent-generation facts. */
      const facts = connection.facts
      /** Construction rollback releases the acquired canonical carrier without closing task ports. */
      const carrier = coroutineCarrier(connection.port, this.#id, this.#report)
      try {
        this.#parent = context.attach(
          carrier,
          facts
            ? {
                ...(facts.childName === undefined
                  ? {}
                  : {
                      self: { name: facts.childName, instanceId: context.self().instanceId }
                    }),
                generation: facts.generation,
                expectedPeerId: facts.parent.instanceId
              }
            : {}
        )
        connection.bindChild(this.close)
      } catch (primary) {
        void carrier.close(primary).catch(this.#report)
        throw primary
      }
      void this.#parent.closed.then(
        () => {
          this.#closed = true
        },
        (error) => {
          this.#closed = true
          this.#report(error)
        }
      )
    }
    /** Private display names borrow actual native child identity without a pool naming policy. */
    const identity = { owner: this, name: options.name ?? context.namespace, events }
    this.record = {
      get name() {
        return identity.events ? (identity.owner.#memberName ?? identity.name) : identity.name
      },
      ownership: this.#supervisor ? 'owned' : 'borrowed',
      ...(this.#supervisor
        ? { supervisor: this.#supervisor as ISupervisor<unknown, unknown> }
        : {}),
      current: this.#current,
      whenReady: () => this.#generation?.rebind() ?? this.#parent!.ready,
      prepareReplacement: this.#replacement,
      describe: this.#describe,
      now: () => systemScheduler.now()
    }
    this.members = events
      ? undefined
      : new RpcNativeMembers({
          kind: 'coroutine',
          self: context.self,
          report: this.#report,
          source: {
            values: () => [this.record],
            byName: (name) => (name === this.record.name ? this.record : undefined),
            byInstance: (id) => (id === this.#current().session?.peerId ? this.record : undefined)
          }
        })
  }
  /** Only actual accepted readiness publishes the original member extension. */
  async open() {
    await this.ready()
    return { namespaceExtensions: { members: this.members!.value }, dispose: this.close }
  }
  /** The actual shared generation is borrowed only by repeatable owned source installation. */
  get generation() {
    return this.#generation
  }
  /** Join original readiness and preserve construction rollback for direct and private members. */
  async ready(): Promise<void> {
    try {
      if (this.#generation) await this.#generation.open()
      else {
        this.#view = await this.#parent!.ready
        this.members!.publishReady(this.record, this.#view, this.#view.generation.value)
      }
    } catch (primary) {
      try {
        await this.close()
      } catch (cleanup) {
        this.#report(cleanup)
      }
      throw primary
    }
  }
  /** Safe metadata is borrowed from the sole SDK generation or original parent Session. */
  readonly #current = () =>
    this.#generation?.current() ?? {
      generation: this.#view?.generation.value ?? 0,
      active: this.#view !== undefined && !this.#closed,
      ...(this.#view ? { session: this.#view } : {})
    }
  /**
   * Facts persist only with the genuine task token/physical native resource, never temporary launch
   * state.
   */
  readonly #facts = (): IRpcLaunchFacts => {
    /** Parent identity and execution generation come from their actual original owners. */
    const self = this.#context.self()
    return {
      ...(this.#events ? {} : { childName: this.record.name }),
      parent: { name: self.name, instanceId: self.instanceId },
      generation: { kind: 'restart', value: this.#supervisor!.generation, providerId: this.#id }
    }
  }
  /**
   * Replacement wraps exactly one new user task under the same supervisor/reporter/native fact
   * owner.
   */
  readonly #replacement = (value: unknown) => {
    /** Public task validation stays before native replacement can change the original specification. */
    if (value === undefined) return undefined
    const spec = value as ICoroutineReplaceSpec
    if (typeof spec?.task !== 'function')
      throw new RpcError(
        RpcCoreErrorCode.invalidConfig,
        RuntimeApiErrorText.coroutineReplaceInvalid
      )
    return {
      task: wrapCoroutineTask(spec.task, this.#report, this.#facts)
    }
  }
  /** Await only this native exposed port; host Session owns the one real handshake. */
  readonly #openCarrier = async (unit: ICoroutineHandle<ICoroutineMessagePort>) => {
    /** The exposed native port belongs to this task's existing private connection receipt. */
    const port = await unit.exposed
    this.#sessions.set(unit, { connection: parentConnectionOf(port) })
    return { carrier: coroutineCarrier(port, defaultRpcId(), this.#report) }
  }
  /** One native remaining grace drains actual work before the original cooperative stop hook. */
  readonly #beforeTerminate = async (
    unit: ICoroutineHandle<ICoroutineMessagePort>,
    signal: INativeAbortSignal,
    remainingMs: () => number
  ): Promise<void> => {
    /** Exact unit identity cannot accidentally drain a replacement coroutine. */
    const session = this.#sessions.get(unit)?.session
    try {
      if (session) await this.#context.drain(session, remainingMs())
      if (!signal.aborted)
        await this.#options.supervisor?.stop?.beforeTerminate?.(unit, signal, remainingMs)
    } catch (primary) {
      if (session) await this.#context.detach(session, primary).catch(this.#context.report)
      throw primary
    }
    /** Preserve preclose RPC in the original hook before cooperative stop can close its ports. */
    if (session) await this.#context.detach(session)
  }
  /**
   * Query uses the sole original native snapshot; coroutine resource sampling stays explicitly
   * unavailable.
   */
  readonly #describe = async () => {
    /** Safe Session metadata and native policy are captured synchronously in this cold local query. */
    const view = this.#current().session,
      snapshot = this.#supervisor?.inspect()
    return [
      rpcMemberConnectionDetail(
        {
          kind: this.#supervisor ? RpcMemberSourceKind.spawn : RpcMemberSourceKind.connect,
          direction: this.#supervisor
            ? RpcMemberConnectionDirection.spawned
            : RpcMemberConnectionDirection.spawnedBy,
          carrier: this.#id,
          ...(view
            ? {
                description: {
                  self: { name: view.name, instanceId: view.peerId, generation: view.generation },
                  methods: [...view.methods.values()]
                }
              }
            : {})
        },
        snapshot?.state,
        {
          ...(snapshot ? { supervisor: snapshot } : {}),
          observedAt: systemScheduler.now(),
          report: this.#report
        }
      )
    ]
  }
  /** Borrowed parent cleanup cannot stop execution; owned cleanup joins the unique SDK/native owner. */
  readonly close = (): Promise<void> => {
    if (this.#closing) return this.#closing
    /** Publish completion before native stop or physical detach can reenter cleanup. */
    const completion = deferred<void>()
    this.#closing = completion.promise
    void this.#release().then(completion.resolve, completion.reject)
    return this.#closing
  }
  /** Preserve physical/native cleanup before passive member listeners are finally removed. */
  async #release(): Promise<void> {
    try {
      if (this.#generation) await this.#generation.close()
      else if (this.#parent) await this.#context.detach(this.#parent)
    } finally {
      this.members?.close()
    }
  }
}
