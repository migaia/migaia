import { runtimeQuery, type IRuntimeQuery, type IRuntimeOverview } from './overview.js'
import type {
  IRuntimeTypedOutlet,
  IRuntimeTarget,
  IRuntimePluginTyping,
  IRuntimeExpose
} from './typing.js'
import type { IPluginConstraint, IPluginRuntimeSharedSlot } from '@migaia/plugin-host'
import type { IRpcPortableValue } from '../../contract/types.js'
import { serializeRpcError } from '../../contract/error.js'
import { RpcCoreErrorCode, RpcError } from '../../core/errors.js'
import type { IRemoteCallOptions } from '../types.js'
import type { IRuntimePeerDescription, IRuntimePeerIdentity } from './description.js'
import type { IRuntimePeer } from './peer.js'
import { RuntimeApiErrorText } from './constants.js'
import { RemoteMethodName } from '../constants.js'
import type { IRemoteHostRemovalOptions } from '../host.js'
import { RuntimeApiMode } from './constants.js'

/** Internal cold/current reads use the original slot's indexes without a second connection table. */
const connectionReader = Symbol('runtime-outlet-connection-reader')

/** Resolve only a canonical facade's current exact receipt; absent names do not select a fallback. */
export function readRuntimeOutletConnection(
  facade: object | undefined,
  target: string
): IRuntimePluginConnection | null | undefined {
  return facade && connectionReader in facade
    ? (
        facade as {
          [connectionReader]: (target: string) => IRuntimePluginConnection | null | undefined
        }
      )[connectionReader](target)
    : undefined
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

/** A captured child keeps its exact contribution and never retargets a same-name replacement. */
export type IRuntimeChild = Pick<IRuntimePeer, 'request' | 'notify' | 'stream'> &
  Readonly<{
    name: string
    instanceId: string
    /** The accepted safe method directory marks immediate forwarding without expanding connections. */
    methods: IRuntimePeerDescription['methods']
    host?: Readonly<{
      use(name: string, config?: IRpcPortableValue): Promise<IRpcPortableValue | undefined>
      unUse(
        name: string,
        options?: IRemoteHostRemovalOptions
      ): Promise<IRpcPortableValue | undefined>
      inspect(): Promise<IRpcPortableValue | undefined>
    }>
  }>

/** This stable facade routes by the existing shared-slot indexes, with no second Host registry. */
export type IRuntimeOutlet = Readonly<{
  request(
    target: IRuntimeTarget<string>,
    method: string,
    payload?: unknown,
    options?: IRemoteCallOptions
  ): Promise<IRpcPortableValue | undefined>
  notify(
    target: IRuntimeTarget<string>,
    method: string,
    payload?: unknown,
    options?: IRemoteCallOptions
  ): Promise<void>
  stream(
    target: IRuntimeTarget<string>,
    method: string,
    payload?: unknown,
    options?: IRemoteCallOptions
  ): AsyncIterableIterator<IRpcPortableValue>
  /** Read current canonical contributions without selecting a business target. */
  list: IRuntimeQuery<IRuntimeOverview>
  get(target: IRuntimeTarget<string>): IRuntimeChild
  broadcast(
    method: string,
    payload?: unknown,
    options?: IRemoteCallOptions
  ): Promise<readonly IRuntimeBroadcastResult[]>
}>

/** Select a committed exact receipt before forwarding the original callable operation. */
export function createRuntimeOutlet(
  slot: IPluginRuntimeSharedSlot<IRuntimeOutlet>,
  self: IRuntimePeerIdentity
): IRuntimeOutlet {
  /** All availability and Host closing checks remain in the original shared-slot owner. */
  const selected = (target: IRuntimeTarget<string>): IRuntimePluginConnection => {
    /** Instance identity is checked through the same index, then correlated with its declared name. */
    const name = typeof target === 'string' ? target : target?.name
    const id = typeof target === 'string' ? target : target?.instanceId
    if (typeof name !== 'string' || !name || typeof id !== 'string' || !id)
      throw new RpcError(RpcCoreErrorCode.invalidConfig, RuntimeApiErrorText.targetInvalid)
    /** The canonical index rejects multiple matches without selecting a winner. */
    const connection = slot.find(id)
    if (connection === null)
      throw new RpcError(RpcCoreErrorCode.capabilityConflict, RuntimeApiErrorText.targetAmbiguous)
    if (!connection)
      throw new RpcError(RpcCoreErrorCode.targetUnknown, RuntimeApiErrorText.targetUnknown)
    if (typeof target !== 'string' && (connection as IRuntimePluginConnection).name !== name)
      throw new RpcError(RpcCoreErrorCode.targetUnknown, RuntimeApiErrorText.targetUnknown)
    return connection as IRuntimePluginConnection
  }
  return Object.freeze({
    [connectionReader]: (target: string) =>
      slot.find(target) as IRuntimePluginConnection | null | undefined,
    request: (target, method, payload, options) =>
      selected(target).peer.request(method, payload, options),
    notify: (target, method, payload, options) =>
      selected(target).peer.notify(method, payload, options),
    stream: (target, method, payload, options) =>
      selected(target).peer.stream(method, payload, options),
    list: runtimeQuery(async () => {
      /** Capture exact original receipts; later accepted replacements cannot enter this read. */
      const connections = slot.values() as readonly IRuntimePluginConnection[]
      /** Each genuine Peer projects its own owner facts; exact identity excludes a newer generation. */
      const details = await Promise.all(
        connections.map(async (connection) => {
          const snapshot = await connection.peer.describe()
          return snapshot.connections.filter(
            (detail) =>
              'instanceId' in detail.identity &&
              detail.identity.instanceId === connection.instanceId
          )
        })
      )
      return Object.freeze({ self, connections: Object.freeze(details.flat()) })
    }),
    get: (target): IRuntimeChild => {
      /** This cold lookup captures exactly one generation; each later call checks the same receipt. */
      const connection = selected(target)
      /** Comparing receipt identity prevents a stale child handle from selecting its successor. */
      const current = (): IRuntimePeer => {
        if (selected(target) !== connection)
          throw new RpcError(RpcCoreErrorCode.targetUnknown, RuntimeApiErrorText.targetUnknown)
        return connection.peer
      }
      /** Only actual negotiated reserved routes permit the explicit Host-control facet. */
      const controls = [
        RemoteMethodName.hostUse,
        RemoteMethodName.hostUnUse,
        RemoteMethodName.hostInspect
      ].every((name) =>
        connection.description?.methods.some(
          (method) => method.name === name && method.supportedModes.includes(RuntimeApiMode.request)
        )
      )
      return Object.freeze({
        name: connection.name,
        instanceId: connection.instanceId,
        methods: connection.description?.methods ?? Object.freeze([]),
        request: (method, payload, options) => current().request(method, payload, options),
        notify: (method, payload, options) => current().notify(method, payload, options),
        stream: (method, payload, options) => current().stream(method, payload, options),
        ...(controls
          ? {
              host: Object.freeze({
                use: (name: string, config?: IRpcPortableValue) =>
                  current().request(
                    RemoteMethodName.hostUse,
                    config === undefined ? [name] : [name, config]
                  ),
                unUse: (name: string, options?: IRemoteHostRemovalOptions) =>
                  current().request(
                    RemoteMethodName.hostUnUse,
                    options === undefined ? [name] : [name, options]
                  ),
                inspect: () => current().request(RemoteMethodName.hostInspect, [])
              })
            }
          : {})
      })
    },
    broadcast: async (method, payload, options) => {
      /** Snapshot only ready exact receipts; later joins cannot enter this explicit one-way send. */
      const connections = slot.values().filter((value) => {
        /** The original instance index preserves distinct ready sessions with an ambiguous name. */
        const connection = value as IRuntimePluginConnection
        return slot.find(connection.instanceId) === connection
      }) as readonly IRuntimePluginConnection[]
      /** Every member records success or a reported original failure in snapshot order. */
      const results: IRuntimeBroadcastResult[] = []
      for (const connection of connections) {
        try {
          if (slot.find(connection.instanceId) !== connection)
            throw new RpcError(RpcCoreErrorCode.targetUnknown, RuntimeApiErrorText.targetUnknown)
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
  })
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
  }
}
