import { SupervisorState } from '@migaia/supervision'
import type { IAbortSignal } from '@migaia/utils/promise'
import { defineHost } from '@migaia/plugin-host'
import { defaultRpcReporter } from '@migaia/rpc-host'
import type { IRpcProbe } from '@migaia/rpc-host/probe'
import {
  RuntimeEventName,
  type IRuntimeEvent,
  type IRuntimeConnectionDetail
} from '@migaia/rpc-host/plugin'
import { createTrayError, TRAY_SOURCE } from '../../errors.js'
import { TrayErrorCode } from '../../error-code.js'
import {
  TrayInternal,
  TrayInstanceState,
  TrayInstanceEvent,
  TrayRuntimeMode,
  TrayManagementMode,
  TrayCallKind
} from '../constants.js'
import { readHost } from '../define-host.js'
import { readRoutingPolicy, type ITrayRoutingPolicy } from '../routing-policy.js'
import { toWire } from '../portable.js'
import {
  createRemote,
  createRoutedRemote,
  type ITraySender,
  type ITrayInvocation
} from '../remote.js'
import { createRoutingRegistry, createRoutingNamespace } from '../routing.js'
import { createParentTopics } from './topics.js'
import {
  runtimePlugin,
  outletOf,
  type ITrayRuntimeHost,
  type ITrayRuntimeOutlet
} from '../runtime.js'
import { serveChild } from '../child/serve.js'
import { createRegistry, type ITrayRecord } from './registry.js'
import { createTrayEvents } from './events.js'
import { createRelay } from './relay.js'
import type { IAnyTrayHost, ITray, ITrayInstance } from '../typing.js'
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
  /** Policy pick counters belong to this parent only. */
  #routingRegistry: ReturnType<typeof createRoutingRegistry>
  /** Generation topic memberships retain their canonical EventSubscriber owner. */
  #topics: ReturnType<typeof createParentTopics>
  /** Callable policy namespace shares the existing routing registry cursor. */
  #routing: ReturnType<typeof createRoutingNamespace>
  /** Read-only lifecycle observations remain separate from business topics. */
  #events: ReturnType<typeof createTrayEvents>
  /** Family receipts track actual outlet identity and release their original subscriptions. */
  #subscriptions: Map<string, { outlet: ITrayRuntimeOutlet; release: (() => void)[] }>
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
      const definition = readHost(value)
      if (this.#definitions.has(definition.name)) throw createTrayError(TrayErrorCode.hostInvalid)
      this.#definitions.set(definition.name, definition)
    }

    for (const policy of this.#options.routing ?? [])
      if (!readRoutingPolicy(policy)) throw createTrayError(TrayErrorCode.routingInvalid)

    /** One reporter carries native notices and contained lifecycle/relay failures. */
    this.#report = this.#options.report ?? defaultRpcReporter

    /** Parent PluginHost remains separate from every instance's plain PluginHost. */
    this.#host = defineHost({
      host: {
        execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
        diagnostic: (_message, _code, error) => {
          if (error !== undefined) this.#report(error)
        }
      }
    }) as ITrayRuntimeHost

    /** Registry owns only metadata, operation admission and parent-issued relay receipts. */
    this.#registry = createRegistry(this.#report, this.#sendUncounted)

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
        outletOf(this.#host, record.definition).notify(record.id, TrayInternal.deliver, delivery),
      this.#report
    )

    /** Both forms retain one shared cursor and exact frozen own members. */
    this.#routing = createRoutingNamespace(this.#routingRegistry.names, this.#routed)

    /** Lifecycle listeners share EventSubscriber's existing owner. */
    this.#events = createTrayEvents(this.#report)

    /** Family subscription identity follows the actual outlet object's lifetime. */
    this.#subscriptions = new Map<string, { outlet: ITrayRuntimeOutlet; release: (() => void)[] }>()

    /** Closing rejects operations synchronously while disposal keeps one completion promise. */
    this.#disposing = false

    /** Concurrent dispose calls share exactly one cleanup sequence. */
    this.#disposal = undefined

    /** Install relay before runtime factories inspect their exposure names. */
    this.#relayReady = this.#host
      .use(
        createRelay(
          this.#registry,
          this.#send,
          this.#routingRegistry,
          this.#definitions,
          this.#topics,
          this.#assertActive
        )
      )
      .then(() => undefined)
    this.#tray = this.#surface()
  }

  /** Validate host identity before creating a remote; candidates are selected only at each call. */
  #routed = (policy: string, definition: IAnyTrayHost) => {
    this.#assertActive()
    /** Branding is checked before selecting the parent's registered host definition. */
    const admitted = readHost(definition)
    if (this.#definitions.get(admitted.name) !== admitted)
      throw createTrayError(TrayErrorCode.hostUnknown)
    /** A kept remote observes closing before candidate lookup, preserving DISPOSED precedence. */
    const pick = () => {
      this.#assertActive()
      return this.#routingRegistry.pick(admitted.name, policy)
    }
    /** The lazy generator borrows this immutable registry identity without a mutable receiver. */
    const registry = this.#registry
    return createRoutedRemote(admitted.name, {
      request: async (input, callOptions) =>
        this.#registry.sendCounted(pick(), TrayCallKind.request, input, callOptions),
      notify: async (input, callOptions) =>
        this.#registry.sendCounted(pick(), TrayCallKind.notify, input, callOptions),
      stream: (input, callOptions) =>
        (async function* () {
          return yield* registry.sendCounted(pick(), TrayCallKind.stream, input, callOptions)
        })()
    })
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

  /** One transition emits once; safe errors are copied and frozen before any listener runs. */
  #transition = (
    record: ITrayRecord,
    state: ITrayRecord['state'],
    error?: IRuntimeEvent['error']
  ): void => {
    if (
      record.removed ||
      this.#registry.records.get(record.id) !== record ||
      record.state === state
    )
      return
    record.state = state
    const event = state === TrayInstanceState.starting ? TrayInstanceEvent.spawned : state
    this.#events.publish({
      ...this.#registry.snapshot(record),
      event,
      ...(error === undefined ? {} : { error: Object.freeze({ ...error }) })
    })
  }

  /** Calls select one current RPC receipt; calls already sent remain owned by that generation. */
  #send = (record: ITrayRecord): ITraySender => {
    return {
      request: (input, callOptions) =>
        this.#registry.sendCounted(record, TrayCallKind.request, input, callOptions),
      notify: (input, callOptions) =>
        this.#registry.sendCounted(record, TrayCallKind.notify, input, callOptions),
      stream: (input, callOptions) =>
        this.#registry.sendCounted(record, TrayCallKind.stream, input, callOptions)
    }
  }

  /** Native RPC dispatch keeps its existing readiness checks; accounting is solely registry-owned. */
  #sendUncounted = (record: ITrayRecord): ITraySender => {
    /** Readiness is a Tray init fact; never wait for a new generation or resend a call. */
    const ready = (input: ITrayInvocation): ITrayRuntimeOutlet => {
      this.#current(record)
      const outlet = outletOf(this.#host, record.definition)
      if (record.state !== TrayInstanceState.ready) {
        if (record.state === TrayInstanceState.stopped && outlet) {
          try {
            outlet.request(record.id, TrayInternal.invoke, input)
          } catch (error) {
            throw createTrayError(TrayErrorCode.instanceNotReady, error)
          }
        }
        throw createTrayError(TrayErrorCode.instanceNotReady)
      }
      return outlet
    }
    return {
      request: async (input, callOptions) =>
        ready(input).request(record.id, TrayInternal.invoke, input, callOptions),
      notify: async (input, callOptions) =>
        ready(input).notify(record.id, TrayInternal.invoke, input, callOptions),
      stream: (input, callOptions) => {
        /** Lazy iterator creation still checks the captured admission before dispatch. */
        const iterator = (async function* () {
          const outlet = ready(input)
          return yield* outlet.stream(record.id, TrayInternal.stream, input, callOptions)
        })()
        return iterator
      }
    }
  }

  /** Outlet detail contains the authoritative native generation and accepted remote identity. */
  #identify = (record: ITrayRecord, detail: IRuntimeConnectionDetail): number => {
    if (!('generation' in detail.unit) || !('instanceId' in detail.identity))
      throw createTrayError(TrayErrorCode.instanceStartFailed)
    this.#registry.identify(record, detail.unit.generation, detail.identity.instanceId)
    return detail.unit.generation
  }

  /** Init joins one promise per admission and native generation, never a readiness retry. */
  #initOnce = async (record: ITrayRecord, generation: number, config: unknown): Promise<void> => {
    let pending = record.inits.get(generation)
    if (!pending) {
      pending = outletOf(this.#host, record.definition)
        .request(record.id, TrayInternal.init, {
          id: record.id,
          host: record.definition.name,
          generation,
          ...(config === undefined ? {} : { config })
        })
        .then(() => undefined)
      record.inits.set(generation, pending)
    }
    await pending
    this.#current(record)
    if (record.generation !== generation) throw createTrayError(TrayErrorCode.instanceStartFailed)
  }

  /** Cleanup is the first step of each Tray stop entry while the current child can still answer. */
  #shutdown = async (record: ITrayRecord, graceMs = 5000): Promise<void> => {
    if (record.state !== TrayInstanceState.ready) return
    try {
      await outletOf(this.#host, record.definition).request(
        record.id,
        TrayInternal.shutdown,
        { graceMs },
        { timeoutMs: graceMs }
      )
    } catch (error) {
      this.#report(error)
    }
  }

  /** Native snapshots are read only after synchronous supervisor event transitions finish. */
  #reconcile = async (record: ITrayRecord, event: IRuntimeEvent): Promise<void> => {
    await Promise.resolve()
    if (record.removed || record.management === TrayManagementMode.manual) return
    const detail = await outletOf(this.#host, record.definition).get(record.id)
    if (
      record.removed ||
      this.#registry.records.get(record.id) !== record ||
      !('generation' in detail.unit)
    )
      return
    if (
      typeof event.generation !== 'number' ||
      detail.unit.generation !== event.generation ||
      record.generation > event.generation
    )
      return
    if (detail.unit.state === 'backoff' || detail.unit.state === 'starting')
      this.#transition(record, TrayInstanceState.restarting, event.error)
    else if (detail.unit.state === 'stopped')
      this.#transition(record, TrayInstanceState.stopped, event.error)
    else if (detail.unit.state === 'terminal')
      this.#transition(record, TrayInstanceState.failed, event.error)
  }

  /** Attach to a newly created family and correlate background ready entries with their receipt. */
  #subscribe = (record: ITrayRecord): void => {
    const family = record.definition.runtime
    const outlet = outletOf(this.#host, record.definition)
    if (this.#subscriptions.get(family)?.outlet === outlet) return
    for (const release of this.#subscriptions.get(family)?.release ?? []) release()
    const release = [
      outlet.on(RuntimeEventName.ready, (event) => {
        const admitted = this.#registry.records.get(event.name)
        if (
          !admitted ||
          admitted.removed ||
          admitted.management === TrayManagementMode.manual ||
          typeof event.generation !== 'number' ||
          typeof event.instanceId !== 'string'
        )
          return
        /** Initial spawn drives init itself; only later native ready receipts enter this queue. */
        if (admitted.state === TrayInstanceState.starting) return
        const receipt = {
          admission: admitted.admission,
          generation: event.generation,
          instanceId: event.instanceId
        }
        void admitted.queue
          .run(async () => {
            admitted.management = TrayManagementMode.background
            try {
              await Promise.resolve()
              if (admitted.removed || receipt.admission !== admitted.admission) return
              const detail = await outlet.get(admitted.id)
              if (
                !('generation' in detail.unit) ||
                !('instanceId' in detail.identity) ||
                detail.unit.generation !== receipt.generation ||
                detail.identity.instanceId !== receipt.instanceId
              )
                return
              this.#identify(admitted, detail)
              await this.#initOnce(admitted, receipt.generation, admitted.config)
              this.#transition(admitted, TrayInstanceState.ready)
            } catch (error) {
              if (!admitted.removed && !this.#disposing)
                this.#transition(admitted, TrayInstanceState.failed)
              this.#report(error)
            } finally {
              admitted.management = undefined
            }
          })
          .catch(this.#report)
      }),
      outlet.on(RuntimeEventName.exit, (event) => {
        const admitted = this.#registry.records.get(event.name)
        if (admitted && typeof event.generation === 'number') {
          this.#topics.remove(admitted, event.generation)
          this.#registry.depart(admitted, event.generation)
        }
        if (
          !admitted ||
          event.reason === 'replaced' ||
          admitted.management === TrayManagementMode.manual
        )
          return
        void this.#reconcile(admitted, event).catch(this.#report)
      }),
      outlet.on(RuntimeEventName.terminal, (event) => {
        const admitted = this.#registry.records.get(event.name)
        if (admitted) void this.#reconcile(admitted, event).catch(this.#report)
      })
    ]
    this.#subscriptions.set(family, { outlet, release })
  }

  /** Coroutine settlement maps only here; parent state handling is runtime-independent. */
  #coroutineTask = async (
    record: ITrayRecord,
    context: {
      connect: import('@migaia/rpc-plugin-coroutines').ICoroutineConnect
      signal: IAbortSignal
    }
  ): Promise<void> => {
    const child = await serveChild(
      record.definition,
      { report: this.#report, probe: this.#options.probe },
      context.connect
    )
    /** Abort resolves a cooperative task while an explicit crash retains the user's first error. */
    let release = (): void => undefined
    const aborted = new Promise<void>((resolve) => {
      release = () => context.signal.removeEventListener('abort', stop)
      function stop(): void {
        release()
        resolve()
      }
      if (context.signal.aborted) resolve()
      else context.signal.addEventListener('abort', stop, { once: true })
    })
    try {
      await Promise.race([aborted, child.exited])
    } finally {
      release()
      await child.host.dispose()
    }
  }

  /** Queue removal revokes metadata before awaiting the original install and resource cleanup. */
  #remove = async (record: ITrayRecord, graceMs?: number): Promise<void> => {
    const wasReady = record.state === TrayInstanceState.ready
    this.#topics.remove(record)
    this.#registry.revoke(record)
    if (record.install) {
      try {
        await record.install
      } catch (error) {
        this.#report(error)
      }
    }
    if (wasReady) {
      try {
        await outletOf(this.#host, record.definition).request(
          record.id,
          TrayInternal.shutdown,
          { graceMs: graceMs ?? 5000 },
          { timeoutMs: graceMs ?? 5000 }
        )
      } catch (error) {
        this.#report(error)
      }
    }
    try {
      const result = await this.#host.unUse(record.id)
      if (!result.ok) for (const error of result.errors) this.#report(error)
    } catch (error) {
      this.#report(error)
    }
    this.#events.publish({ ...this.#registry.snapshot(record), event: TrayInstanceEvent.removed })
  }

  /** Manual entries own config snapshot, cleanup, native outcome, init and returned snapshot. */
  #manage = async (
    record: ITrayRecord,
    operation: 'restart' | 'replace',
    replacement?: { config?: unknown }
  ): Promise<ITrayInstance> => {
    return record.queue.run(async () => {
      this.#current(record)
      const config =
        operation === 'replace' && replacement && Object.hasOwn(replacement, 'config')
          ? toWire(replacement.config)
          : record.config
      record.management = TrayManagementMode.manual
      try {
        await this.#shutdown(record)
        this.#transition(record, TrayInstanceState.restarting)
        const outlet = outletOf(this.#host, record.definition)
        const outcome =
          operation === 'restart'
            ? await outlet.restart(record.id)
            : await outlet.replace(record.id)
        this.#current(record)
        const accepted =
          'state' in outcome ? outcome.state === SupervisorState.ready : outcome.kind === 'replaced'
        if (!accepted) {
          if (
            'state' in outcome &&
            (outcome.state === SupervisorState.idle || outcome.state === SupervisorState.stopped)
          ) {
            this.#transition(record, TrayInstanceState.stopped)
            return this.#registry.snapshot(record)
          }
          if ('state' in outcome && outcome.state === SupervisorState.disposed)
            throw createTrayError(TrayErrorCode.disposed)
          /** Native non-ready outcomes never fabricate an error or commit replacement config. */
          const cause = 'error' in outcome ? outcome.error : undefined
          throw createTrayError(TrayErrorCode.instanceStartFailed, cause)
        }
        const generation = this.#identify(record, await outlet.get(record.id))
        await this.#initOnce(record, generation, config)
        record.config = config
        this.#transition(record, TrayInstanceState.ready)
        return this.#registry.snapshot(record)
      } catch (error) {
        if (!record.removed && !this.#disposing) {
          await Promise.resolve()
          try {
            const detail = await outletOf(this.#host, record.definition).get(record.id)
            if ('state' in detail.unit && detail.unit.state === 'stopped')
              this.#transition(record, TrayInstanceState.stopped)
            else this.#transition(record, TrayInstanceState.failed)
          } catch (secondary) {
            this.#report(secondary)
            this.#transition(record, TrayInstanceState.failed)
          }
        }
        if (this.#disposing) throw createTrayError(TrayErrorCode.disposed)
        if (error && typeof error === 'object' && 'source' in error && error.source === TRAY_SOURCE)
          throw error
        throw createTrayError(TrayErrorCode.instanceStartFailed, error)
      } finally {
        record.management = undefined
      }
    })
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
    listener: import('../topics.js').ITrayTopicListener
  ): (() => void) => {
    this.#assertActive()
    return this.#topics.subscribe(topic, listener)
  }

  /** Original spawn admission and result behavior stays with this parent owner. */
  #spawnEntry = async (name: string, spawnOptions: { id: string; config?: unknown }) => {
    this.#assertActive()
    const definition = this.#definitions.get(name)
    if (!definition) throw createTrayError(TrayErrorCode.hostUnknown)
    if (
      !spawnOptions ||
      typeof spawnOptions.id !== 'string' ||
      !spawnOptions.id ||
      [TrayInternal.childPlugin, TrayInternal.clientPlugin, TrayInternal.relayPlugin].some(
        (name) => name === spawnOptions.id
      )
    )
      throw createTrayError(TrayErrorCode.hostInvalid)
    const config = toWire(spawnOptions.config)
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
            task: (context) => this.#coroutineTask(record, context)
          })
        )
        .then(() => undefined)
      await record.install
      this.#current(record)
      this.#subscribe(record)
      const generation = this.#identify(
        record,
        await outletOf(this.#host, definition).get(record.id)
      )
      await this.#initOnce(record, generation, config)
      this.#transition(record, TrayInstanceState.ready)
      return createRemote(record.id, this.#send(record))
    } catch (primary) {
      if (!record.removed) {
        this.#transition(record, TrayInstanceState.failed)
        await this.#remove(record)
      }
      if (this.#disposing) throw createTrayError(TrayErrorCode.disposed)
      throw createTrayError(TrayErrorCode.instanceStartFailed, primary)
    }
  }

  /** Original instance admission and result behavior stays with this parent owner. */
  #instanceEntry = (definition: IAnyTrayHost, id: string) => {
    this.#assertActive()
    const admitted = readHost(definition)
    const record = this.#registry.get(id)
    if (record.definition !== admitted) throw createTrayError(TrayErrorCode.hostMismatch)
    return createRemote(id, this.#send(record))
  }

  /** Original list admission and result behavior stays with this parent owner. */
  #listEntry = (filter?: { host?: string; runtime?: string; state?: string }) => {
    this.#assertActive()
    return Object.freeze(
      [...this.#registry.records.values()]
        .filter(
          (record) =>
            (!filter?.host || record.definition.name === filter.host) &&
            (!filter?.runtime || record.definition.runtime === filter.runtime) &&
            (!filter?.state || record.state === filter.state)
        )
        .map(this.#registry.snapshot)
    )
  }

  /** Original get admission and result behavior stays with this parent owner. */
  #getEntry = async (id: string) => {
    this.#assertActive()
    const record = this.#registry.get(id)
    const detail = await outletOf(this.#host, record.definition).get(id)
    this.#current(record)
    return Object.freeze({ ...detail, ...this.#registry.snapshot(record) })
  }

  /** Original stop admission and result behavior stays with this parent owner. */
  #stopEntry = async (id: string, stopOptions?: { graceMs?: number }) => {
    this.#assertActive()
    const record = this.#registry.get(id)
    await record.queue.run(async () => {
      this.#current(record)
      record.management = TrayManagementMode.manual
      try {
        await this.#shutdown(record, stopOptions?.graceMs)
        this.#topics.remove(record)
        await outletOf(this.#host, record.definition).stop(id, stopOptions)
        this.#current(record)
        this.#transition(record, TrayInstanceState.stopped)
      } finally {
        record.management = undefined
      }
    })
  }

  /** Original restart admission and result behavior stays with this parent owner. */
  #restartEntry = (id: string) => {
    this.#assertActive()
    return this.#manage(this.#registry.get(id), 'restart')
  }

  /** Original replace admission and result behavior stays with this parent owner. */
  #replaceEntry = (id: string, replacement?: { config?: unknown }) => {
    this.#assertActive()
    return this.#manage(this.#registry.get(id), 'replace', replacement)
  }

  /** Original remove admission and result behavior stays with this parent owner. */
  #removeEntry = (id: string, removeOptions?: { graceMs?: number }) => {
    this.#assertActive()
    const record = this.#registry.get(id)
    return record.queue.run(() => {
      this.#current(record)
      return this.#remove(record, removeOptions?.graceMs)
    })
  }

  /** Original dispose admission and result behavior stays with this parent owner. */
  #disposeEntry = (disposeOptions?: { graceMs?: number }): Promise<void> => {
    if (this.#disposal) return this.#disposal
    this.#disposing = true
    this.#disposal = (async () => {
      const records = [...this.#registry.records.values()]
      for (const record of records) record.queue.close(createTrayError(TrayErrorCode.disposed))
      await Promise.all(
        records.map(async (record) => {
          await record.queue.whenIdle()
          await this.#remove(record, disposeOptions?.graceMs)
        })
      )
      for (const subscription of this.#subscriptions.values())
        for (const release of subscription.release) release()
      /** Parent-only topic users can close before relay installation commits. */
      await this.#relayReady
      await this.#host.dispose()
      this.#events.close()
      this.#topics.close()
    })()
    return this.#disposal
  }

  /** Original asyncDispose admission and result behavior stays with this parent owner. */
  #asyncDisposeEntry = (): Promise<void> => {
    return this.#tray.dispose()
  }
}
