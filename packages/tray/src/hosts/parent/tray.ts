import { SupervisorState } from '@migaia/supervision'
import type { IAbortSignal } from '@migaia/utils/promise'
import { defineHost } from '@migaia/plugin-host'
import { defaultRpcReporter } from '@migaia/rpc-core'
import type { IRpcProbe } from '@migaia/rpc-core/probe'
import {
  RuntimeEventName,
  type IRuntimeEvent,
  type IRuntimeConnectionDetail
} from '@migaia/rpc-core/remote'
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
  hosts: THosts
  routing?: TRouting
  probe?: IRpcProbe | readonly IRpcProbe[]
  report?(error: unknown): void
}>
/** The public registry exposes only frozen management and observation capabilities. */
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
  if (!options || !Array.isArray(options.hosts)) throw createTrayError(TrayErrorCode.hostInvalid)
  /** Branded definitions are captured once; business plugin factories stay entirely child-side. */
  const definitions = new Map<string, IAnyTrayHost>()
  for (const value of options.hosts) {
    const definition = readHost(value)
    if (definitions.has(definition.name)) throw createTrayError(TrayErrorCode.hostInvalid)
    definitions.set(definition.name, definition)
  }
  for (const policy of options.routing ?? [])
    if (!readRoutingPolicy(policy)) throw createTrayError(TrayErrorCode.routingInvalid)
  /** One reporter carries native notices and contained lifecycle/relay failures. */
  const report = options.report ?? defaultRpcReporter
  /** Parent PluginHost remains separate from every instance's plain PluginHost. */
  const host = defineHost({
    host: {
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
      diagnostic: (_message, _code, error) => {
        if (error !== undefined) report(error)
      }
    }
  }) as ITrayRuntimeHost
  /** Registry owns only metadata, operation admission and parent-issued relay receipts. */
  const registry = createRegistry(report, sendUncounted)
  /** Parent registration combines explicit policies and every branded host DSL tuple. */
  const routingRegistry = createRoutingRegistry(options.hosts, options.routing ?? [], registry)
  /** Infrastructure delivery stays outside business-send accounting. */
  const topics = createParentTopics(
    registry,
    (record, delivery) =>
      outletOf(host, record.definition).notify(record.id, TrayInternal.deliver, delivery),
    report
  )
  /** Validate host identity before creating a remote; candidates are selected only at each call. */
  const routed = (policy: string, definition: IAnyTrayHost) => {
    assertActive()
    /** Branding is checked before selecting the parent's registered host definition. */
    const admitted = readHost(definition)
    if (definitions.get(admitted.name) !== admitted)
      throw createTrayError(TrayErrorCode.hostUnknown)
    /** A kept remote observes closing before candidate lookup, preserving DISPOSED precedence. */
    const pick = () => {
      assertActive()
      return routingRegistry.pick(admitted.name, policy)
    }
    return createRoutedRemote(admitted.name, {
      request: async (input, callOptions) =>
        registry.sendCounted(pick(), TrayCallKind.request, input, callOptions),
      notify: async (input, callOptions) =>
        registry.sendCounted(pick(), TrayCallKind.notify, input, callOptions),
      stream: (input, callOptions) =>
        (async function* () {
          return yield* registry.sendCounted(pick(), TrayCallKind.stream, input, callOptions)
        })()
    })
  }
  /** Both forms retain one shared cursor and exact frozen own members. */
  const routing = createRoutingNamespace(routingRegistry.names, routed)
  /** Lifecycle listeners share EventSubscriber's existing owner. */
  const events = createTrayEvents(report)
  /** Family subscription identity follows the actual outlet object's lifetime. */
  const subscriptions = new Map<string, { outlet: ITrayRuntimeOutlet; release: (() => void)[] }>()
  /** Closing rejects operations synchronously while disposal keeps one completion promise. */
  let disposing = false
  /** Concurrent dispose calls share exactly one cleanup sequence. */
  let disposal: Promise<void> | undefined
  /** Install relay before runtime factories inspect their exposure names. */
  const relayReady = host
    .use(createRelay(registry, send, routingRegistry, definitions, topics, assertActive))
    .then(() => undefined)
  /** Public operations cannot admit new work once the parent is closing. */
  function assertActive(): void {
    if (disposing) throw createTrayError(TrayErrorCode.disposed)
  }
  /** Return a snapshot only for this original admission and an active registry. */
  function current(record: ITrayRecord): void {
    assertActive()
    registry.assertCurrent(record)
  }
  /** One transition emits once; safe errors are copied and frozen before any listener runs. */
  function transition(
    record: ITrayRecord,
    state: ITrayRecord['state'],
    error?: IRuntimeEvent['error']
  ): void {
    if (record.removed || registry.records.get(record.id) !== record || record.state === state)
      return
    record.state = state
    const event = state === TrayInstanceState.starting ? TrayInstanceEvent.spawned : state
    events.publish({
      ...registry.snapshot(record),
      event,
      ...(error === undefined ? {} : { error: Object.freeze({ ...error }) })
    })
  }
  /** Calls select one current RPC receipt; calls already sent remain owned by that generation. */
  function send(record: ITrayRecord): ITraySender {
    return {
      request: (input, callOptions) =>
        registry.sendCounted(record, TrayCallKind.request, input, callOptions),
      notify: (input, callOptions) =>
        registry.sendCounted(record, TrayCallKind.notify, input, callOptions),
      stream: (input, callOptions) =>
        registry.sendCounted(record, TrayCallKind.stream, input, callOptions)
    }
  }
  /** Native RPC dispatch keeps its existing readiness checks; accounting is solely registry-owned. */
  function sendUncounted(record: ITrayRecord): ITraySender {
    /** Readiness is a Tray init fact; never wait for a new generation or resend a call. */
    const ready = (input: ITrayInvocation): ITrayRuntimeOutlet => {
      current(record)
      const outlet = outletOf(host, record.definition)
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
  function identify(record: ITrayRecord, detail: IRuntimeConnectionDetail): number {
    if (!('generation' in detail.unit) || !('instanceId' in detail.identity))
      throw createTrayError(TrayErrorCode.instanceStartFailed)
    registry.identify(record, detail.unit.generation, detail.identity.instanceId)
    return detail.unit.generation
  }
  /** Init joins one promise per admission and native generation, never a readiness retry. */
  async function initOnce(record: ITrayRecord, generation: number, config: unknown): Promise<void> {
    let pending = record.inits.get(generation)
    if (!pending) {
      pending = outletOf(host, record.definition)
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
    current(record)
    if (record.generation !== generation) throw createTrayError(TrayErrorCode.instanceStartFailed)
  }
  /** Cleanup is the first step of each Tray stop entry while the current child can still answer. */
  async function shutdown(record: ITrayRecord, graceMs = 5000): Promise<void> {
    if (record.state !== TrayInstanceState.ready) return
    try {
      await outletOf(host, record.definition).request(
        record.id,
        TrayInternal.shutdown,
        { graceMs },
        { timeoutMs: graceMs }
      )
    } catch (error) {
      report(error)
    }
  }
  /** Native snapshots are read only after synchronous supervisor event transitions finish. */
  async function reconcile(record: ITrayRecord, event: IRuntimeEvent): Promise<void> {
    await Promise.resolve()
    if (record.removed || record.management === TrayManagementMode.manual) return
    const detail = await outletOf(host, record.definition).get(record.id)
    if (
      record.removed ||
      registry.records.get(record.id) !== record ||
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
      transition(record, TrayInstanceState.restarting, event.error)
    else if (detail.unit.state === 'stopped')
      transition(record, TrayInstanceState.stopped, event.error)
    else if (detail.unit.state === 'terminal')
      transition(record, TrayInstanceState.failed, event.error)
  }
  /** Attach to a newly created family and correlate background ready entries with their receipt. */
  function subscribe(record: ITrayRecord): void {
    const family = record.definition.runtime
    const outlet = outletOf(host, record.definition)
    if (subscriptions.get(family)?.outlet === outlet) return
    for (const release of subscriptions.get(family)?.release ?? []) release()
    const release = [
      outlet.on(RuntimeEventName.ready, (event) => {
        const admitted = registry.records.get(event.name)
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
              identify(admitted, detail)
              await initOnce(admitted, receipt.generation, admitted.config)
              transition(admitted, TrayInstanceState.ready)
            } catch (error) {
              if (!admitted.removed && !disposing) transition(admitted, TrayInstanceState.failed)
              report(error)
            } finally {
              admitted.management = undefined
            }
          })
          .catch(report)
      }),
      outlet.on(RuntimeEventName.exit, (event) => {
        const admitted = registry.records.get(event.name)
        if (admitted && typeof event.generation === 'number') {
          topics.remove(admitted, event.generation)
          registry.depart(admitted, event.generation)
        }
        if (
          !admitted ||
          event.reason === 'replaced' ||
          admitted.management === TrayManagementMode.manual
        )
          return
        void reconcile(admitted, event).catch(report)
      }),
      outlet.on(RuntimeEventName.terminal, (event) => {
        const admitted = registry.records.get(event.name)
        if (admitted) void reconcile(admitted, event).catch(report)
      })
    ]
    subscriptions.set(family, { outlet, release })
  }
  /** Coroutine settlement maps only here; parent state handling is runtime-independent. */
  async function coroutineTask(
    record: ITrayRecord,
    context: { connect: import('@migaia/rpc-core/remote').ICoroutineConnect; signal: IAbortSignal }
  ): Promise<void> {
    const child = await serveChild(
      record.definition,
      { report, probe: options.probe },
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
  async function remove(record: ITrayRecord, graceMs?: number): Promise<void> {
    const wasReady = record.state === TrayInstanceState.ready
    topics.remove(record)
    registry.revoke(record)
    if (record.install) {
      try {
        await record.install
      } catch (error) {
        report(error)
      }
    }
    if (wasReady) {
      try {
        await outletOf(host, record.definition).request(
          record.id,
          TrayInternal.shutdown,
          { graceMs: graceMs ?? 5000 },
          { timeoutMs: graceMs ?? 5000 }
        )
      } catch (error) {
        report(error)
      }
    }
    try {
      const result = await host.unUse(record.id)
      if (!result.ok) for (const error of result.errors) report(error)
    } catch (error) {
      report(error)
    }
    events.publish({ ...registry.snapshot(record), event: TrayInstanceEvent.removed })
  }
  /** Manual entries own config snapshot, cleanup, native outcome, init and returned snapshot. */
  async function manage(
    record: ITrayRecord,
    operation: 'restart' | 'replace',
    replacement?: { config?: unknown }
  ): Promise<ITrayInstance> {
    return record.queue.run(async () => {
      current(record)
      const config =
        operation === 'replace' && replacement && Object.hasOwn(replacement, 'config')
          ? toWire(replacement.config)
          : record.config
      record.management = TrayManagementMode.manual
      try {
        await shutdown(record)
        transition(record, TrayInstanceState.restarting)
        const outlet = outletOf(host, record.definition)
        const outcome =
          operation === 'restart'
            ? await outlet.restart(record.id)
            : await outlet.replace(record.id)
        current(record)
        const accepted =
          'state' in outcome ? outcome.state === SupervisorState.ready : outcome.kind === 'replaced'
        if (!accepted) {
          if (
            'state' in outcome &&
            (outcome.state === SupervisorState.idle || outcome.state === SupervisorState.stopped)
          ) {
            transition(record, TrayInstanceState.stopped)
            return registry.snapshot(record)
          }
          if ('state' in outcome && outcome.state === SupervisorState.disposed)
            throw createTrayError(TrayErrorCode.disposed)
          /** Native non-ready outcomes never fabricate an error or commit replacement config. */
          const cause = 'error' in outcome ? outcome.error : undefined
          throw createTrayError(TrayErrorCode.instanceStartFailed, cause)
        }
        const generation = identify(record, await outlet.get(record.id))
        await initOnce(record, generation, config)
        record.config = config
        transition(record, TrayInstanceState.ready)
        return registry.snapshot(record)
      } catch (error) {
        if (!record.removed && !disposing) {
          await Promise.resolve()
          try {
            const detail = await outletOf(host, record.definition).get(record.id)
            if ('state' in detail.unit && detail.unit.state === 'stopped')
              transition(record, TrayInstanceState.stopped)
            else transition(record, TrayInstanceState.failed)
          } catch (secondary) {
            report(secondary)
            transition(record, TrayInstanceState.failed)
          }
        }
        if (disposing) throw createTrayError(TrayErrorCode.disposed)
        if (error && typeof error === 'object' && 'source' in error && error.source === TRAY_SOURCE)
          throw error
        throw createTrayError(TrayErrorCode.instanceStartFailed, error)
      } finally {
        record.management = undefined
      }
    })
  }
  /** Frozen surface exposes no publisher, runtime Host or original admission token. */
  const tray = Object.freeze({
    routing,
    /** Business publications follow the registry's existing closing admission boundary. */
    publish(topic: string, payload?: unknown): void {
      assertActive()
      topics.publish(topic, payload)
    },
    /** A closing registry cannot retain new topic listeners. */
    subscribe(topic: string, listener: import('../topics.js').ITrayTopicListener): () => void {
      assertActive()
      return topics.subscribe(topic, listener)
    },
    async spawn(name: string, spawnOptions: { id: string; config?: unknown }) {
      assertActive()
      const definition = definitions.get(name)
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
      const record = registry.admit(definition, spawnOptions.id, config)
      events.publish({ ...registry.snapshot(record), event: TrayInstanceEvent.spawned })
      try {
        await relayReady
        current(record)
        record.install = host
          .use(
            runtimePlugin(definition, TrayRuntimeMode.parent, {
              id: record.id,
              report,
              probe: options.probe,
              task: (context) => coroutineTask(record, context)
            })
          )
          .then(() => undefined)
        await record.install
        current(record)
        subscribe(record)
        const generation = identify(record, await outletOf(host, definition).get(record.id))
        await initOnce(record, generation, config)
        transition(record, TrayInstanceState.ready)
        return createRemote(record.id, send(record))
      } catch (primary) {
        if (!record.removed) {
          transition(record, TrayInstanceState.failed)
          await remove(record)
        }
        if (disposing) throw createTrayError(TrayErrorCode.disposed)
        throw createTrayError(TrayErrorCode.instanceStartFailed, primary)
      }
    },
    instance(definition: IAnyTrayHost, id: string) {
      assertActive()
      const admitted = readHost(definition)
      const record = registry.get(id)
      if (record.definition !== admitted) throw createTrayError(TrayErrorCode.hostMismatch)
      return createRemote(id, send(record))
    },
    list(filter?: { host?: string; runtime?: string; state?: string }) {
      assertActive()
      return Object.freeze(
        [...registry.records.values()]
          .filter(
            (record) =>
              (!filter?.host || record.definition.name === filter.host) &&
              (!filter?.runtime || record.definition.runtime === filter.runtime) &&
              (!filter?.state || record.state === filter.state)
          )
          .map(registry.snapshot)
      )
    },
    async get(id: string) {
      assertActive()
      const record = registry.get(id)
      const detail = await outletOf(host, record.definition).get(id)
      current(record)
      return Object.freeze({ ...detail, ...registry.snapshot(record) })
    },
    async stop(id: string, stopOptions?: { graceMs?: number }) {
      assertActive()
      const record = registry.get(id)
      await record.queue.run(async () => {
        current(record)
        record.management = TrayManagementMode.manual
        try {
          await shutdown(record, stopOptions?.graceMs)
          topics.remove(record)
          await outletOf(host, record.definition).stop(id, stopOptions)
          current(record)
          transition(record, TrayInstanceState.stopped)
        } finally {
          record.management = undefined
        }
      })
    },
    restart(id: string) {
      assertActive()
      return manage(registry.get(id), 'restart')
    },
    replace(id: string, replacement?: { config?: unknown }) {
      assertActive()
      return manage(registry.get(id), 'replace', replacement)
    },
    remove(id: string, removeOptions?: { graceMs?: number }) {
      assertActive()
      const record = registry.get(id)
      return record.queue.run(() => {
        current(record)
        return remove(record, removeOptions?.graceMs)
      })
    },
    on: events.on,
    watch: events.watch,
    dispose(disposeOptions?: { graceMs?: number }): Promise<void> {
      if (disposal) return disposal
      disposing = true
      disposal = (async () => {
        const records = [...registry.records.values()]
        for (const record of records) record.queue.close(createTrayError(TrayErrorCode.disposed))
        await Promise.all(
          records.map(async (record) => {
            await record.queue.whenIdle()
            await remove(record, disposeOptions?.graceMs)
          })
        )
        for (const subscription of subscriptions.values())
          for (const release of subscription.release) release()
        /** Parent-only topic users can close before relay installation commits. */
        await relayReady
        await host.dispose()
        events.close()
        topics.close()
      })()
      return disposal
    },
    [Symbol.asyncDispose](): Promise<void> {
      return tray.dispose()
    }
  }) as ITray<THosts, TRouting>
  return { tray, host }
}
