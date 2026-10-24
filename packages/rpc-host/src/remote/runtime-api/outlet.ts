import { createRpcError } from '../../core/errors.js'
import { createRuntimeEventPublisher, type IRuntimeEventPublisher } from './events.js'
import {
  runtimeQueryOutput,
  type IRuntimeQueryOptions,
  type IRuntimeOverview,
  type IRuntimeConnectionDetail
} from './overview.js'
import {
  SupervisorState,
  type ISupervisor,
  type IReadyOutcome,
  type IReplaceOutcome
} from '@migaia/supervision'
import type { ISerializeTextFormat } from '@migaia/serialize'
import {
  RuntimeSourceKind,
  RuntimeConnectionDirection,
  RuntimeProcessSignal,
  RuntimePluginKey
} from './constants.js'
import type {
  IRuntimeTypedOutlet,
  IRuntimeTarget,
  IRuntimePluginTyping,
  IRuntimeExpose
} from './typing.js'
import type { IPluginConstraint, IPluginRuntimeSharedSlot } from '@migaia/plugin-host'
import type { IRpcPortableValue } from '@migaia/rpc-contract'
import { serializeRpcError } from '../../core/internal/error-wire-metadata.js'
import { RpcCoreErrorCode } from '../../core/errors.js'
import type { IRuntimeCallOptions } from './typing.js'
import type { IRuntimePeerDescription, IRuntimePeerIdentity } from './description.js'
import type { IRuntimePeer } from './peer.js'
import type { IRpcRuntimeStep, IRpcRuntimeOutcomeResult } from '@migaia/rpc-contract/runtime'
import type { IRpcRuntimeStepOutcome } from '@migaia/rpc-contract/v1'
import { RuntimeApiErrorText } from './constants.js'

/** Only the exact original facade retains its lifecycle publisher, without a connection registry. */
const eventPublisher = new WeakMap<object, IRuntimeEventPublisher>()
/** Only actual package facades provide this private lifecycle publication seam. */
export function readRuntimeOutletEvents(facade: object): IRuntimeEventPublisher {
  return eventPublisher.get(facade)!
}

/** Exact facade identity retains the original slot reader without a second connection table. */
const connectionReader = new WeakMap<
  object,
  (target: string) => IRuntimePluginConnection | null | undefined
>()

/** Resolve only a canonical facade's current exact receipt; absent names do not select a fallback. */
export function readRuntimeOutletConnection(
  facade: object | undefined,
  target: string
): IRuntimePluginConnection | null | undefined {
  return facade ? connectionReader.get(facade)?.(target) : undefined
}

/** Canonical slot receipts retain their exact prepared Peer; projection never exposes this object. */
export type IRuntimePluginConnection = Readonly<{
  name: string
  instanceId: string
  identity: IRuntimePeerIdentity | undefined
  description: IRuntimePeerDescription | undefined
  peer: IRuntimePeer
  report(error: unknown): void
}>

/** Each explicit broadcast member preserves its order and portable full error chain. */
export type IRuntimeBroadcastResult = Readonly<{
  instanceId: string
  ok: boolean
  error?: IRpcPortableValue
}>

/** Registration metadata lives on the Host's original reservation, including unavailable units. */
export type IRuntimePluginRegistration = Readonly<{
  name: string
  peer: Pick<IRuntimePeer, 'describe'>
  execution?: ISupervisor<unknown, unknown>
  /** The installed physical owner interprets opaque replacement input before native admission. */
  prepareReplacement?(spec: unknown): unknown
  /** Command readiness joins the original holder until its accepted receipt is published. */
  whenReady?(): Promise<number>
  /** Original safe identity reads select one target before any asynchronous sampler runs. */
  instanceIds(): readonly string[]
}>

/** Execution commands require the exact committed registration's original supervisor authority. */
type IRuntimeControlledRegistration = IRuntimePluginRegistration &
  Readonly<{ execution: ISupervisor<unknown, unknown> }>

/** Filters keep local source selection distinct from the connection's remote direction. */
export type IRuntimeListFilter = Readonly<{
  /** Optional original supervisor state filter; omission admits every state. */
  state?: SupervisorState
  /** Optional exact-name or prefix selection; supplying both is invalid. */
  name?: Readonly<{ exact: string; prefix?: never }> | Readonly<{ prefix: string; exact?: never }>
  /** Optional spawn/connect/listen source-mode filter. */
  kind?: RuntimeSourceKind
  /** Optional actual spawned/spawned-by/connect/listen direction filter. */
  direction?: RuntimeConnectionDirection
}>
/** Formatting never changes which canonical registration records the filter selects. */
export type IRuntimeListOptions = IRuntimeQueryOptions &
  Readonly<{
    /** Optional local selection; omission includes every current registration. */ filter?: IRuntimeListFilter
  }>
/** Format overloads preserve the safe object result when callers omit text formatting. */
export type IRuntimeListQuery = {
  (options?: IRuntimeListOptions & Readonly<{ format?: undefined }>): Promise<IRuntimeOverview>
  (options: IRuntimeListOptions & Readonly<{ format: ISerializeTextFormat }>): Promise<string>
  (options: IRuntimeListOptions): Promise<IRuntimeOverview | string>
}
/** Single-target queries return the same connection detail found in list and Peer descriptions. */
export type IRuntimeTargetQuery = {
  (
    target: IRuntimeTarget<string>,
    options?: Readonly<{ format?: undefined }>
  ): Promise<IRuntimeConnectionDetail>
  (
    target: IRuntimeTarget<string>,
    options: Readonly<{ format: ISerializeTextFormat }>
  ): Promise<string>
  (
    target: IRuntimeTarget<string>,
    options: IRuntimeQueryOptions
  ): Promise<IRuntimeConnectionDetail | string>
}

/** Invalid public filter values fail before sampling, lifecycle effects or native handle reads. */
function validateFilter(filter?: IRuntimeListFilter): void {
  if (filter === undefined) return
  /** Exact and prefix are discriminated by own properties; supplying both is always invalid. */
  const name = filter?.name
  if (
    !filter ||
    typeof filter !== 'object' ||
    (filter.state !== undefined && !Object.values(SupervisorState).includes(filter.state)) ||
    (filter.kind !== undefined && !Object.values(RuntimeSourceKind).includes(filter.kind)) ||
    (filter.direction !== undefined &&
      !Object.values(RuntimeConnectionDirection).includes(filter.direction)) ||
    (name !== undefined &&
      (!name ||
        typeof name !== 'object' ||
        Object.hasOwn(name, 'exact') === Object.hasOwn(name, 'prefix') ||
        typeof (Object.hasOwn(name, 'exact') ? name.exact : name.prefix) !== 'string'))
  )
    throw createRpcError(RpcCoreErrorCode.invalidConfig, RuntimeApiErrorText.filterInvalid)
}

/** Process signals are limited to the native graceful operation already owned by the launcher. */
export type IRuntimeProcessStopOptions = Readonly<{ graceMs?: number; signal?: 'SIGTERM' }>
/** Threads have no OS signal and never terminate their shared PID. */
export type IRuntimeThreadStopOptions = Readonly<{ graceMs?: number }>
/** Platform command types preserve the original supervision outcomes and native specifications. */
export type IRuntimeOutletControls<K> = Readonly<{
  stop(
    name: string,
    options?: K extends 'process' ? IRuntimeProcessStopOptions : IRuntimeThreadStopOptions
  ): Promise<void>
  kill(name: string): Promise<void>
  restart(name: string): Promise<IReadyOutcome<unknown>>
  replace(
    name: string,
    spec?: K extends 'process'
      ? import('@migaia/supervision/process').IProcessSpec
      : K extends 'coroutine'
        ? unknown
        : import('@migaia/supervision/threads').IThreadSpec
  ): Promise<IReplaceOutcome>
}>

/** This stable facade routes by the existing shared-slot indexes, with no second Host registry. */
export type IRuntimeOutlet = Pick<IRuntimeEventPublisher, 'on' | 'watch'> &
  IRuntimeOutletControls<'process'> &
  Readonly<{
    request(
      target: IRuntimeTarget<string>,
      method: string,
      payload?: unknown,
      options?: IRuntimeCallOptions
    ): Promise<IRpcPortableValue | undefined>
    notify(
      target: IRuntimeTarget<string>,
      method: string,
      payload?: unknown,
      options?: IRuntimeCallOptions
    ): Promise<void>
    stream(
      target: IRuntimeTarget<string>,
      method: string,
      payload?: unknown,
      options?: IRuntimeCallOptions
    ): AsyncIterableIterator<IRpcPortableValue>
    /** Complete groups keep one exact target receipt through the original Peer operation. */
    group(
      target: IRuntimeTarget<string>,
      steps: readonly IRpcRuntimeStep[],
      options?: Omit<
        Extract<
          import('@migaia/rpc-contract').IRpcRuntimeEnvelope,
          { kind: 'runtime-call' }
        >['options'],
        'timeoutMs'
      > &
        Pick<import('../../core/typing.js').ISendOptions, 'timeoutMs' | 'signal' | 'transfer'>
    ): Promise<readonly IRpcRuntimeStepOutcome[]>
    /** Read the selected provider's original result store without admission or execution. */
    outcome(
      target: IRuntimeTarget<string>,
      idempotencyKey: string
    ): Promise<IRpcRuntimeOutcomeResult>
    /** Read current canonical contributions without selecting a business target. */
    list: IRuntimeListQuery
    get: IRuntimeTargetQuery
    broadcast(
      method: string,
      payload?: unknown,
      options?: IRuntimeCallOptions
    ): Promise<readonly IRuntimeBroadcastResult[]>
  }>

/** Select a committed exact receipt before forwarding the original callable operation. */
/** Own the actual shared-slot facade's cold selection and lifecycle subscriber ports. */
class RuntimeOutlet {
  /** PluginHost remains the sole availability, publication, registration and closing authority. */
  #slot: IPluginRuntimeSharedSlot<IRuntimeOutlet>
  /** Safe local identity is captured from this genuine Host's shared slot. */
  #self: IRuntimePeerIdentity
  /** The installed physical family alone grants platform-specific control options. */
  #kind: keyof typeof RuntimePluginKey
  /** One local publisher belongs to this facade for its entire original shared-slot lifetime. */
  #events = createRuntimeEventPublisher()

  /** Capture existing committed selection and native lifecycle ports without another registry. */
  constructor(
    slot: IPluginRuntimeSharedSlot<IRuntimeOutlet>,
    self: IRuntimePeerIdentity,
    kind: keyof typeof RuntimePluginKey
  ) {
    this.#slot = slot
    this.#self = self
    this.#kind = kind
  }
  /** Select one original committed receipt, preserving ambiguous/unknown target diagnostics. */
  #selected = (target: IRuntimeTarget<string>): IRuntimePluginConnection => {
    /** Instance identity is checked through the same index, then correlated with its declared name. */
    const name = typeof target === 'string' ? target : target?.name
    const id = typeof target === 'string' ? target : target?.instanceId
    if (typeof name !== 'string' || !name || typeof id !== 'string' || !id)
      throw createRpcError(RpcCoreErrorCode.invalidConfig, RuntimeApiErrorText.targetInvalid)
    /** The canonical index rejects multiple matches without selecting a winner. */
    const connection = this.#slot.find(id)
    if (connection === null)
      throw createRpcError(RpcCoreErrorCode.capabilityConflict, RuntimeApiErrorText.targetAmbiguous)
    if (!connection)
      throw createRpcError(RpcCoreErrorCode.targetUnknown, RuntimeApiErrorText.targetUnknown)
    if (typeof target !== 'string' && (connection as IRuntimePluginConnection).name !== name)
      throw createRpcError(RpcCoreErrorCode.targetUnknown, RuntimeApiErrorText.targetUnknown)
    return connection as IRuntimePluginConnection
  }
  /** Native side effects require exact committed execution metadata from the original slot. */
  #controlled = (name: string): IRuntimeControlledRegistration => {
    if (typeof name !== 'string' || !name)
      throw createRpcError(RpcCoreErrorCode.invalidConfig, RuntimeApiErrorText.targetInvalid)
    this.#slot.find(name)
    const records = (this.#slot.registered() as readonly IRuntimePluginRegistration[]).filter(
      (record) => record.name === name
    )
    if (records.length !== 1)
      throw createRpcError(
        records.length ? RpcCoreErrorCode.capabilityConflict : RpcCoreErrorCode.targetUnknown,
        records.length ? RuntimeApiErrorText.targetAmbiguous : RuntimeApiErrorText.targetUnknown
      )
    /** Retain the same registration so readiness cannot accidentally join another logical owner. */
    const record = records[0]!
    const execution = record.execution
    if (!execution)
      throw createRpcError(RpcCoreErrorCode.capabilityConflict, RuntimeApiErrorText.controlBorrowed)
    return record as IRuntimeControlledRegistration
  }
  /** Delegate stop to the exact committed native execution without another command owner. */
  #stop: IRuntimeOutlet['stop'] = (name, options) => {
    /** Platform configuration errors precede execution selection and original queue admission. */
    if (
      (options?.graceMs !== undefined &&
        (!Number.isFinite(options.graceMs) || options.graceMs < 0)) ||
      (options &&
        Object.hasOwn(options, 'signal') &&
        (this.#kind !== RuntimePluginKey.process ||
          options.signal !== RuntimeProcessSignal.graceful))
    )
      throw createRpcError(RpcCoreErrorCode.invalidConfig, RuntimeApiErrorText.stopInvalid)
    return this.#controlled(name).execution.stop(
      options?.graceMs === undefined ? undefined : { graceMs: options.graceMs }
    )
  }

  /** Delegate kill to the exact committed native execution without another command owner. */
  #kill: IRuntimeOutlet['kill'] = (name) => this.#controlled(name).execution.kill()

  /** Delegate restart to the exact committed native execution without another command owner. */
  #restart: IRuntimeOutlet['restart'] = (name) => {
    /** Native readiness precedes channel preparation; join the exact existing resource owner. */
    const record = this.#controlled(name)
    return record.execution.restart().then(async (outcome) => {
      if (outcome.state === 'ready') await record.whenReady?.()
      return outcome
    })
  }

  /** Delegate replace to the exact committed native execution without another command owner. */
  #replace: IRuntimeOutlet['replace'] = (name, spec) => {
    /** Return the original outcome only after the replacement's outlet receipt is addressable. */
    const record = this.#controlled(name)
    /** Only the installed source interprets its opaque spec; the generic outlet owns publication. */
    const replacement =
      spec === undefined
        ? undefined
        : record.prepareReplacement
          ? record.prepareReplacement(spec)
          : spec
    return record.execution
      .replace(replacement === undefined ? undefined : { spec: replacement })
      .then(async (outcome) => {
        if (outcome.kind === 'replaced') await record.whenReady?.()
        return outcome
      })
  }

  /** Read cold actual native details from the original committed reservations. */
  #list: IRuntimeOutlet['list'] = (async (options?: IRuntimeListOptions) => {
    validateFilter(options?.filter)
    /** This is the original committed reservation inventory, independent from readiness indexes. */
    const records = this.#slot.registered() as readonly IRuntimePluginRegistration[]
    /** Names can be filtered before asynchronous resource reads without touching business admission. */
    const selected = records.filter((record) => {
      const name = options?.filter?.name
      return (
        !name ||
        ('exact' in name ? record.name === name.exact : record.name.startsWith(name.prefix!))
      )
    })
    /** Each exact registered Peer captures its own native generation before its cold sampler awaits. */
    const details = await Promise.all(
      selected.map(async (record) => (await record.peer.describe()).connections)
    )
    /**
     * State, local source kind and connection direction are separate canonical axes, combined by
     * AND.
     */
    const connections = details.flat().filter((detail) => {
      const filter = options?.filter
      return (
        (!filter?.state || ('state' in detail.unit && detail.unit.state === filter.state)) &&
        (!filter?.kind || detail.kind === filter.kind) &&
        (!filter?.direction || detail.direction === filter.direction)
      )
    })
    return runtimeQueryOutput(
      Object.freeze({ self: this.#self, connections: Object.freeze(connections) }),
      options
    )
  }) as IRuntimeListQuery

  /** Select the exact committed instance/name before sampling its original native receipt. */
  #get: IRuntimeOutlet['get'] = (async (
    target: IRuntimeTarget<string>,
    options?: IRuntimeQueryOptions
  ) => {
    /** A name addresses its original registration even while its native unit is unavailable. */
    const name = typeof target === 'string' ? target : target?.name
    const id = typeof target === 'string' ? target : target?.instanceId
    if (typeof name !== 'string' || !name || typeof id !== 'string' || !id)
      throw createRpcError(RpcCoreErrorCode.invalidConfig, RuntimeApiErrorText.targetInvalid)
    /** Captured reservations cannot select later installations while resource sampling awaits. */
    const records = this.#slot.registered() as readonly IRuntimePluginRegistration[]
    /** Exact instance identity has the same precedence as the original ready index. */
    const ids = records.filter(
      (record) =>
        record.instanceIds().includes(id) && (typeof target === 'string' || record.name === name)
    )
    /** Name selection never samples unrelated registered execution units. */
    const candidates =
      typeof target === 'string' && ids.length === 0
        ? records.filter((record) => record.name === name)
        : ids
    if (candidates.length !== 1)
      throw createRpcError(
        candidates.length ? RpcCoreErrorCode.capabilityConflict : RpcCoreErrorCode.targetUnknown,
        candidates.length ? RuntimeApiErrorText.targetAmbiguous : RuntimeApiErrorText.targetUnknown
      )
    /** This exact Peer captures one original native receipt before its own sampler awaits. */
    const details = (await candidates[0]!.peer.describe()).connections
    const matches = ids.length
      ? details.filter(
          (detail) => 'instanceId' in detail.identity && detail.identity.instanceId === id
        )
      : details
    if (matches.length !== 1)
      throw createRpcError(
        matches.length ? RpcCoreErrorCode.capabilityConflict : RpcCoreErrorCode.targetUnknown,
        matches.length ? RuntimeApiErrorText.targetAmbiguous : RuntimeApiErrorText.targetUnknown
      )
    return runtimeQueryOutput(matches[0]!, options)
  }) as IRuntimeTargetQuery

  /** Snapshot ready exact receipts and retain independent original one-way outcomes. */
  #broadcast: IRuntimeOutlet['broadcast'] = async (method, payload, options) => {
    /** Snapshot only ready exact receipts; later joins cannot enter this explicit one-way send. */
    const connections = this.#slot.values().filter((value) => {
      /** The original instance index preserves distinct ready sessions with an ambiguous name. */
      const connection = value as IRuntimePluginConnection
      return this.#slot.find(connection.instanceId) === connection
    }) as readonly IRuntimePluginConnection[]
    /** Every member records success or a reported original failure in snapshot order. */
    const results: IRuntimeBroadcastResult[] = []
    for (const connection of connections) {
      try {
        if (this.#slot.find(connection.instanceId) !== connection)
          throw createRpcError(RpcCoreErrorCode.targetUnknown, RuntimeApiErrorText.targetUnknown)
        await connection.peer.notify(method, payload, options)
        results.push(Object.freeze({ instanceId: connection.instanceId, ok: true }))
      } catch (error) {
        connection.report(error)
        results.push(
          Object.freeze({
            instanceId: connection.instanceId,
            ok: false,
            error: serializeRpcError(error, {
              report: ({ error: failure }) => connection.report(failure)
            }) as IRpcPortableValue
          })
        )
      }
    }
    return Object.freeze(results)
  }

  /** Publish the original frozen own-property callables; private readers borrow the same slot. */
  surface(): IRuntimeOutlet {
    /** Hot calls remain direct delegates and allocate no facade Promise or bound function. */
    const facade: IRuntimeOutlet = Object.freeze({
      on: this.#events.on,
      watch: this.#events.watch,
      stop: this.#stop,
      kill: this.#kill,
      restart: this.#restart,
      replace: this.#replace,
      request: (target, method, payload, options) =>
        this.#selected(target).peer.request(method, payload, options),
      notify: (target, method, payload, options) =>
        this.#selected(target).peer.notify(method, payload, options),
      stream: (target, method, payload, options) =>
        this.#selected(target).peer.stream(method, payload, options),
      group: (target, steps, options) => this.#selected(target).peer.group(steps, options),
      outcome: (target, idempotencyKey) => this.#selected(target).peer.outcome(idempotencyKey),
      list: this.#list,
      get: this.#get,
      broadcast: this.#broadcast
    })
    eventPublisher.set(facade, this.#events)
    connectionReader.set(
      facade,
      (target: string) => this.#slot.find(target) as IRuntimePluginConnection | null | undefined
    )
    return facade
  }
}

/** Reuse the original shared-slot authority for exact native calls and cold detail reads. */
export function createRuntimeOutlet(
  slot: IPluginRuntimeSharedSlot<IRuntimeOutlet>,
  self: IRuntimePeerIdentity,
  kind: keyof typeof RuntimePluginKey
): IRuntimeOutlet {
  return new RuntimeOutlet(slot, self, kind).surface()
}

/** TypeScript declaration merging exposes only actually committed optional runtime outlets. */
declare module '@migaia/plugin-host' {
  interface IPluginHostRuntimeExtensions<
    TInstalled extends readonly IPluginConstraint<any>[] = readonly [],
    _TCandidate = unknown
  > {
    readonly __pluginConstraint?: _TCandidate extends IRuntimePluginTyping<
      any,
      any,
      any,
      infer E extends readonly string[],
      any
    >
      ? Exclude<E[number], IRuntimeExpose<TInstalled>> extends never
        ? unknown
        : never
      : unknown
    readonly process?: IRuntimeTypedOutlet<TInstalled, 'process'>
    readonly thread?: IRuntimeTypedOutlet<TInstalled, 'thread'>
    readonly coroutine?: IRuntimeTypedOutlet<TInstalled, 'coroutine'>
  }
}
