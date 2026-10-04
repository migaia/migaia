import type { IPluginRuntimeSharedSlot } from '@migaia/plugin-host'
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
    target: string,
    method: string,
    payload?: unknown,
    options?: IRemoteCallOptions
  ): Promise<IRpcPortableValue | undefined>
  notify(
    target: string,
    method: string,
    payload?: unknown,
    options?: IRemoteCallOptions
  ): Promise<void>
  stream(
    target: string,
    method: string,
    payload?: unknown,
    options?: IRemoteCallOptions
  ): AsyncIterableIterator<IRpcPortableValue>
  get(target: string): IRuntimeChild
  broadcast(
    method: string,
    payload?: unknown,
    options?: IRemoteCallOptions
  ): Promise<readonly IRuntimeBroadcastResult[]>
}>

/** Select a committed exact receipt before forwarding the original callable operation. */
export function createRuntimeOutlet(
  slot: IPluginRuntimeSharedSlot<IRuntimeOutlet>
): IRuntimeOutlet {
  /** All availability and Host closing checks remain in the original shared-slot owner. */
  const selected = (target: string): IRuntimePluginConnection => {
    if (typeof target !== 'string' || !target)
      throw new RpcError(RpcCoreErrorCode.invalidConfig, RuntimeApiErrorText.targetInvalid)
    /** The canonical index rejects multiple matches without selecting a winner. */
    const connection = slot.find(target)
    if (connection === null)
      throw new RpcError(RpcCoreErrorCode.capabilityConflict, RuntimeApiErrorText.targetAmbiguous)
    if (!connection)
      throw new RpcError(RpcCoreErrorCode.targetUnknown, RuntimeApiErrorText.targetUnknown)
    return connection as IRuntimePluginConnection
  }
  return Object.freeze({
    request: (target, method, payload, options) =>
      selected(target).peer.request(method, payload, options),
    notify: (target, method, payload, options) =>
      selected(target).peer.notify(method, payload, options),
    stream: (target, method, payload, options) =>
      selected(target).peer.stream(method, payload, options),
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
        /** The original name index checks Host/registration availability without copied booleans. */
        const connection = value as IRuntimePluginConnection
        return slot.find(connection.name) === connection
      }) as readonly IRuntimePluginConnection[]
      /** Every member records success or a reported original failure in snapshot order. */
      const results: IRuntimeBroadcastResult[] = []
      for (const connection of connections) {
        try {
          if (slot.find(connection.name) !== connection)
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
  interface IPluginHostRuntimeExtensions {
    readonly process?: IRuntimeOutlet
    readonly thread?: IRuntimeOutlet
  }
}
