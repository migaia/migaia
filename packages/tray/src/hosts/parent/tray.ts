/** Own parent admission, subscriptions and Tray lifecycle; RPC retains native generations and IO. */
import { LaunchCause } from '@migaia/supervision'
import { defineHost } from '@migaia/plugin-host'
import { defaultRpcReporter } from '@migaia/rpc-host'
import { probe, type IRpcProbe } from '@migaia/rpc-host/plugins/probe'
import { rpcHostPipelines } from '@migaia/rpc-host/sdk'
import { createTrayError } from '../../errors.ts'
import { TrayErrorCode } from '../../error-code.ts'
import {
  TrayInternal,
  TrayInstanceState,
  TrayInstanceEvent,
  TrayRuntimeMode,
  TrayManagementMode
} from '../constants.ts'
import { readHost } from '../define-host.ts'
import { readRoutingPolicy, type ITrayRoutingPolicy } from '../routing-policy.ts'
import { toWire } from '../portable.ts'
import { createRemote } from '../remote.ts'
import { createRoutingRegistry, createRoutingNamespace } from '../routing.ts'
import { createParentTopics } from './topics.ts'
import {
  runtimePlugin,
  parentRuntimeTransport,
  membersOf,
  outletOf,
  type ITrayRuntimeHost
} from '../runtime.ts'
import { runCoroutineTask } from './coroutine-task.ts'
import { TrayCalls } from './calls.ts'
import { TrayInstances } from './instances.ts'
import { createRegistry, type ITrayRecord } from './registry.ts'
import { createTrayEvents } from './events.ts'
import { createRelay } from './relay.ts'
import type { IAnyTrayHost, ITray } from '../typing.ts'
/** Parent construction options retain the host and routing tuples for public inference. */
export type ICreateTrayOptions<
  THosts extends readonly IAnyTrayHost[],
  TRouting extends readonly ITrayRoutingPolicy[] = readonly []
> = Readonly<{
  /** Trusted host definitions with unique names; no instance is spawned during construction. */
  hosts: THosts
  /** Optional custom policies, combined with host-declared tuples; built-ins are always present. */
  routing?: TRouting
  /** Optional borrowed probe handle(s) forwarded to the original RPC runtime factories. */
  probe?: IRpcProbe | readonly IRpcProbe[]
  /** Contains native/lifecycle diagnostics; defaults to Core's defaultRpcReporter. */
  report?(error: unknown): void
}>
/**
 * Creates a frozen parent registry for trusted host definitions, without spawning instances. The
 * registry owns admission metadata and its parent PluginHost; native connections and generations
 * remain RPC/supervision-owned. Invalid definitions/policies reject synchronously. spawn() awaits
 * generation initialization; remotes never replay failed business calls. dispose() closes admission
 * and shares one cleanup Promise. report defaults to defaultRpcReporter; routing/probe are
 * omitted.
 */
export function createTray<
  const THosts extends readonly IAnyTrayHost[],
  const TRouting extends readonly ITrayRoutingPolicy[] = readonly []
>(options: ICreateTrayOptions<THosts, TRouting>): ITray<THosts, TRouting> {
  return createTrayRuntime(options).tray
}
/** Assemble canonical private Host and registry; internal consumers can observe their owning outlet. */
export function createTrayRuntime<
  const THosts extends readonly IAnyTrayHost[],
  const TRouting extends readonly ITrayRoutingPolicy[] = readonly []
>(
  options: ICreateTrayOptions<THosts, TRouting>
): { tray: ITray<THosts, TRouting>; host: ITrayRuntimeHost } {
  /** Construction retains the exact internal Host and public registry pair for internal consumers. */
  const runtime = new TrayRuntime(options)
  return { tray: runtime.tray, host: runtime.host }
}
/**
 * One parent registry owns admission, subscriptions and cleanup; native generations remain
 * SDK-owned.
 */
class TrayRuntime<
  THosts extends readonly IAnyTrayHost[],
  TRouting extends readonly ITrayRoutingPolicy[]
> {
  /** Original branded host/routing tuple is read only during cold construction and coroutine launch. */
  readonly #options: ICreateTrayOptions<THosts, TRouting>
  /** Trusted definitions retain exact identity for direct and routed admission checks. */
  #definitions: Map<string, IAnyTrayHost>
  /** Original contained reporter owns native and lifecycle diagnostics. */
  #report: (error: unknown) => void
  /** Native PluginHost installation is the existing RPC SDK prepared integration path. */
  #host: ITrayRuntimeHost
  /** Business metadata and receipts remain registry-owned, separate from native RPC state. */
  #registry: ReturnType<typeof createRegistry>
  /** Parent call admission owns direct/routed target selection without duplicating RPC state. */
  #calls: TrayCalls
  /** Native generation init, subscription receipts and queued management have one explicit owner. */
  #instances: TrayInstances
  /** Policy pick counters belong to this parent only. */
  #routingRegistry: ReturnType<typeof createRoutingRegistry>
  /** Generation topic memberships retain their canonical EventSubscriber owner. */
  #topics: ReturnType<typeof createParentTopics>
  /** Callable policy namespace shares the existing routing registry cursor. */
  #routing: ReturnType<typeof createRoutingNamespace>
  /** Read-only lifecycle observations remain separate from business topics. */
  #events: ReturnType<typeof createTrayEvents>
  /** Parent admission closes synchronously before any asynchronous disposal work. */
  #disposing: boolean
  /** Concurrent callers share exactly one original disposal promise. */
  #disposal: Promise<void> | undefined
  /** Relay registration must commit before runtime exposure names are consumed. */
  #relayReady: Promise<void>
  /** Frozen public surface retains the original own members and borrowed callback identities. */
  #tray: ITray<THosts, TRouting>

  /** Capture cold definitions and install only the original parent relay. */
  constructor(options: ICreateTrayOptions<THosts, TRouting>) {
    this.#options = options

    if (!this.#options || !Array.isArray(this.#options.hosts))
      throw createTrayError(TrayErrorCode.hostInvalid)

    /** Branded definitions are captured once; business plugin factories stay entirely child-side. */
    this.#definitions = new Map<string, IAnyTrayHost>()

    for (const value of this.#options.hosts) {
      /** Only this branded definition identity can later create a matching instance remote. */
      const definition = readHost(value)
      if (this.#definitions.has(definition.name)) throw createTrayError(TrayErrorCode.hostInvalid)
      this.#definitions.set(definition.name, definition)
    }

    for (const policy of this.#options.routing ?? [])
      if (!readRoutingPolicy(policy)) throw createTrayError(TrayErrorCode.routingInvalid)

    /** One reporter carries native notices and contained lifecycle/relay failures. */
    this.#report = this.#options.report ?? defaultRpcReporter

    /** This exact parent's handle lends execution only when native installation requests its core. */
    const rpc = rpcHostPipelines(
      () => this.#host,
      (name, request) => this.#host.pipeline(name, request)
    )

    /** Parent PluginHost remains separate from every instance's plain PluginHost. */
    this.#host = defineHost({
      ...rpc,
      host: {
        execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
        diagnostic: (_message, _code, error) => {
          if (error !== undefined) this.#report(error)
        }
      }
    }) as ITrayRuntimeHost

    /** Registry owns only metadata, operation admission and parent-issued relay receipts. */
    this.#registry = createRegistry(this.#report, (record) => this.#calls.uncounted(record))

    /** Parent registration combines explicit policies and every branded host DSL tuple. */
    this.#routingRegistry = createRoutingRegistry(
      this.#options.hosts,
      this.#options.routing ?? [],
      this.#registry
    )

    /** Infrastructure delivery stays outside business-send accounting. */
    this.#topics = createParentTopics(
      this.#registry,
      (record, delivery) =>
        outletOf(this.#host, record.definition, record.id).notify(
          TrayInternal.deliver,
          toWire(delivery),
          { targetId: record.instanceId! }
        ) as Promise<void>,
      this.#report
    )

    /** Lifecycle listeners share EventSubscriber's existing owner. */
    this.#events = createTrayEvents(this.#report)

    /** Sender objects retain exact original admission metadata and native ready checks. */
    this.#calls = new TrayCalls({
      host: this.#host,
      registry: this.#registry,
      definitions: this.#definitions,
      routing: this.#routingRegistry,
      assertActive: this.#assertActive,
      current: this.#current
    })
    /** Both namespace forms retain the same original policy registry and shared cursor. */
    this.#routing = createRoutingNamespace(this.#routingRegistry.names, (policy, definition) =>
      this.#calls.routed(policy, definition)
    )
    /** Instance management borrows the same owners and the original live closing observation. */
    this.#instances = new TrayInstances({
      host: this.#host,
      registry: this.#registry,
      topics: this.#topics,
      events: this.#events,
      report: (error) => this.#report(error),
      observe: this.#report,
      current: this.#current,
      isDisposing: () => this.#disposing
    })

    /** Closing rejects operations synchronously while disposal keeps one completion promise. */
    this.#disposing = false

    /** Concurrent dispose calls share exactly one cleanup sequence. */
    this.#disposal = undefined

    /** Install relay before runtime factories inspect their exposure names. */
    this.#relayReady = this.#host
      .use(
        ...(options.probe === undefined
          ? []
          : [probe(...(Array.isArray(options.probe) ? options.probe : [options.probe]))]),
        createRelay(
          this.#registry,
          (record) => this.#calls.send(record),
          this.#routingRegistry,
          this.#definitions,
          this.#topics,
          this.#assertActive
        )
      )
      .then(() => this.#host.use(parentRuntimeTransport()))
      .then(() => undefined)
    this.#tray = this.#surface()
  }

  /** Public operations cannot admit new work once the parent is closing. */
  #assertActive = (): void => {
    if (this.#disposing) throw createTrayError(TrayErrorCode.disposed)
  }

  /** Return a snapshot only for this original admission and an active registry. */
  #current = (record: ITrayRecord): void => {
    this.#assertActive()
    this.#registry.assertCurrent(record)
  }

  /** Assemble the exact frozen user surface; all mutable state stays with this owner. */
  #surface = (): ITray<THosts, TRouting> => {
    return Object.freeze({
      routing: this.#routing,
      /** Business publications follow the registry's existing closing admission boundary. */
      publish: this.#publishEntry,
      /** A closing registry cannot retain new topic listeners. */
      subscribe: this.#subscribeEntry,
      spawn: this.#spawnEntry,
      instance: this.#instanceEntry,
      list: this.#listEntry,
      get: this.#getEntry,
      stop: this.#stopEntry,
      restart: this.#restartEntry,
      replace: this.#replaceEntry,
      remove: this.#removeEntry,
      on: this.#events.on,
      watch: this.#events.watch,
      dispose: this.#disposeEntry,
      [Symbol.asyncDispose]: this.#asyncDisposeEntry
    }) as ITray<THosts, TRouting>
  }
  /** Internal consumers borrow the original receiving Host. */
  get host(): ITrayRuntimeHost {
    return this.#host
  }
  /** User facade contains no publisher, native handle or admission token. */
  get tray(): ITray<THosts, TRouting> {
    return this.#tray
  }
  /** Original publish admission and result behavior stays with this parent owner. */
  #publishEntry = (topic: string, payload?: unknown): void => {
    this.#assertActive()
    this.#topics.publish(topic, payload)
  }

  /** Original subscribe admission and result behavior stays with this parent owner. */
  #subscribeEntry = (
    topic: string,
    listener: import('../topics.ts').ITrayTopicListener
  ): (() => void) => {
    this.#assertActive()
    return this.#topics.subscribe(topic, listener)
  }

  /** Original spawn admission and result behavior stays with this parent owner. */
  #spawnEntry = async (name: string, spawnOptions: { id: string; config?: unknown }) => {
    this.#assertActive()
    /** Host lookup remains O(1) and precedes any instance id or config admission. */
    const definition = this.#definitions.get(name)
    if (!definition) throw createTrayError(TrayErrorCode.hostUnknown)
    if (
      !spawnOptions ||
      typeof spawnOptions.id !== 'string' ||
      !spawnOptions.id ||
      // Exactly three reserved names are fixed by TrayInternal; preserve short-circuit id reads.
      [TrayInternal.childPlugin, TrayInternal.clientPlugin, TrayInternal.relayPlugin].some(
        (name) => name === spawnOptions.id
      )
    )
      throw createTrayError(TrayErrorCode.hostInvalid)
    /** Portable input is captured before the original record and native unit are admitted. */
    const config = toWire(spawnOptions.config)
    /** The registry owns this new exact id admission independently of native generations. */
    const record = this.#registry.admit(definition, spawnOptions.id, config)
    this.#events.publish({
      ...this.#registry.snapshot(record),
      event: TrayInstanceEvent.spawned
    })
    try {
      await this.#relayReady
      this.#current(record)
      record.install = this.#host
        .use(
          runtimePlugin(definition, TrayRuntimeMode.parent, {
            id: record.id,
            report: this.#report,
            probe: this.#options.probe,
            task: (context) => runCoroutineTask(record, this.#options, this.#report, context)
          })
        )
        .then(() => undefined)
      await record.install
      this.#current(record)
      this.#instances.subscribe(record)
      /** Native accepted identity is correlated before the first application init. */
      const generation = this.#instances.identify(
        record,
        await membersOf(this.#host, record.id).get(record.id)
      )
      await this.#instances.initOnce(record, generation, config)
      this.#instances.transition(record, TrayInstanceState.ready)
      return createRemote(record.id, this.#calls.send(record))
    } catch (primary) {
      if (!record.removed) {
        this.#instances.transition(record, TrayInstanceState.failed)
        await this.#instances.remove(record)
      }
      if (this.#disposing) throw createTrayError(TrayErrorCode.disposed)
      throw createTrayError(TrayErrorCode.instanceStartFailed, primary)
    }
  }

  /** Original instance admission and result behavior stays with this parent owner. */
  #instanceEntry = (definition: IAnyTrayHost, id: string) => {
    this.#assertActive()
    /** Branding is checked before resolving the requested id and enforcing host identity. */
    const admitted = readHost(definition)
    /** Every operation retains the current admission before any queued or asynchronous work. */
    const record = this.#registry.get(id)
    if (record.definition !== admitted) throw createTrayError(TrayErrorCode.hostMismatch)
    return createRemote(id, this.#calls.send(record))
  }

  /** Original list admission and result behavior stays with this parent owner. */
  #listEntry = (filter?: { host?: string; runtime?: string; state?: string }) => {
    this.#assertActive()
    /** Capture the original admission set before filter getters can reenter registry operations. */
    const records = [...this.#registry.records.values()]
    /** Preserve filter reads before snapshot construction while avoiding hot-path filter calls. */
    const selected: ITrayRecord[] = []
    for (const record of records)
      if (
        (!filter?.host || record.definition.name === filter.host) &&
        (!filter?.runtime || record.definition.runtime === filter.runtime) &&
        (!filter?.state || record.state === filter.state)
      )
        selected.push(record)
    return Object.freeze(selected.map(this.#registry.snapshot))
  }

  /** Original get admission and result behavior stays with this parent owner. */
  #getEntry = async (id: string) => {
    this.#assertActive()
    /** Every operation retains the current admission before any queued or asynchronous work. */
    const record = this.#registry.get(id)
    /** The original actual native detail is merged only if this admission remains current. */
    const detail = await membersOf(this.#host, record.id).get(id)
    this.#current(record)
    return Object.freeze({ ...detail, ...this.#registry.snapshot(record) })
  }

  /** Original stop admission and result behavior stays with this parent owner. */
  #stopEntry = async (id: string, stopOptions?: { graceMs?: number }) => {
    this.#assertActive()
    /** Every operation retains the current admission before any queued or asynchronous work. */
    const record = this.#registry.get(id)
    /** Stop options belong to this admitted queue entry, even if execution begins later. */
    const operation = { record, id, stopOptions }
    await record.queue.run(async () => {
      const { record, id, stopOptions } = operation
      this.#current(record)
      record.management = TrayManagementMode.manual
      try {
        await this.#instances.shutdown(record, stopOptions?.graceMs)
        this.#topics.remove(record)
        await membersOf(this.#host, record.id).stop(id, stopOptions)
        this.#current(record)
        this.#instances.transition(record, TrayInstanceState.stopped)
      } finally {
        record.management = undefined
      }
    })
  }

  /** Original restart admission and result behavior stays with this parent owner. */
  #restartEntry = (id: string) => {
    this.#assertActive()
    return this.#instances.manage(this.#registry.get(id), LaunchCause.restart)
  }

  /** Original replace admission and result behavior stays with this parent owner. */
  #replaceEntry = (id: string, replacement?: { config?: unknown }) => {
    this.#assertActive()
    return this.#instances.manage(this.#registry.get(id), LaunchCause.replace, replacement)
  }

  /** Original remove admission and result behavior stays with this parent owner. */
  #removeEntry = (id: string, removeOptions?: { graceMs?: number }) => {
    this.#assertActive()
    /** Every operation retains the current admission before any queued or asynchronous work. */
    const record = this.#registry.get(id)
    return record.queue.run(() => {
      this.#current(record)
      return this.#instances.remove(record, removeOptions?.graceMs)
    })
  }

  /** Original dispose admission and result behavior stays with this parent owner. */
  #disposeEntry = (disposeOptions?: { graceMs?: number }): Promise<void> => {
    if (this.#disposal) return this.#disposal
    this.#disposing = true
    this.#disposal = this.#dispose(disposeOptions?.graceMs)
    return this.#disposal
  }

  /** Close every original admission queue before joining its actual removal and Host cleanup. */
  async #dispose(graceMs?: number): Promise<void> {
    /** One snapshot fixes the original admitted resource and release order. */
    const records = [...this.#registry.records.values()]
    for (const record of records) record.queue.close(createTrayError(TrayErrorCode.disposed))
    await Promise.all(records.map((record) => this.#disposeRecord(record, graceMs)))
    this.#instances.releaseSubscriptions()
    /** Parent-only topic users can close before relay installation commits. */
    await this.#relayReady
    await this.#host.dispose()
    this.#events.close()
    this.#topics.close()
  }

  /** An admitted operation finishes before removal releases this record's actual native source. */
  async #disposeRecord(record: ITrayRecord, graceMs?: number): Promise<void> {
    await record.queue.whenIdle()
    await this.#instances.remove(record, graceMs)
  }

  /** Original asyncDispose admission and result behavior stays with this parent owner. */
  #asyncDisposeEntry = (): Promise<void> => {
    return this.#tray.dispose()
  }
}
