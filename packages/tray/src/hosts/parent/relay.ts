import { defineFeature, definePlugin, type IPluginConstraint } from '@migaia/plugin-host'
import type { IRpcContext } from '@migaia/rpc-host'
import { TrayInternal, TrayCallKind } from '../constants.ts'
import { createTrayError } from '../../errors.ts'
import { TrayErrorCode } from '../../error-code.ts'
import type { ITrayRegistry, ITrayRecord } from './registry.ts'
import type { ITraySender } from '../remote.ts'
import type { createRoutingRegistry } from '../routing.ts'
import type { IAnyTrayHost } from '../typing.ts'
import type { createParentTopics } from './topics.ts'
/** Relay envelope carries an admission receipt and omits an absent application payload. */
type IRelayCall = Readonly<{
  host: string
  id: string
  receipt: string
  path: string
  payload?: unknown
}>
/** Parent relay authenticates the sender through the outlet's accepted instance id projection. */
export function createRelay(
  registry: ITrayRegistry,
  send: (record: ITrayRecord) => ITraySender,
  routing: ReturnType<typeof createRoutingRegistry>,
  hosts: ReadonlyMap<string, IAnyTrayHost>,
  topics: ReturnType<typeof createParentTopics>,
  assertActive: () => void
): IPluginConstraint<any, any, any> {
  /** A removed or superseded child cannot originate new relayed calls. */
  const sender = (context: IRpcContext): void => {
    const admitted = registry.instanceIds.get(context.senderId)
    if (!admitted || admitted.record.removed || admitted.record.generation !== admitted.generation)
      throw createTrayError(TrayErrorCode.instanceUnknown)
  }
  /** Receipt validation and forwarding share the same currently admitted record. */
  const target = (input: IRelayCall, context: IRpcContext): ITraySender => {
    sender(context)
    return send(registry.receipt(input.host, input.id, input.receipt))
  }
  return definePlugin({
    name: TrayInternal.relayPlugin,
    features: {
      relay: defineFeature(() => ({
        bind: (input: { host: string; id: string }, context: IRpcContext) => {
          sender(context)
          return registry.bind(input.host, input.id)
        },
        call: (input: IRelayCall, context: IRpcContext) =>
          target(input, context).request(input, {
            signal: context.signal,
            timeoutMs: context.timeoutMs
          }),
        notify: (input: IRelayCall, context: IRpcContext) =>
          target(input, context).notify(input, {
            signal: context.signal,
            timeoutMs: context.timeoutMs
          }),
        stream: (input: IRelayCall, context: IRpcContext) =>
          target(input, context).stream(input, {
            signal: context.signal,
            timeoutMs: context.timeoutMs
          }),
        /** Only portable routing data crosses the relay; options come from provider context. */
        routed: (
          input: {
            host: string
            policy: string
            kind: TrayCallKind
            path: string
            payload?: unknown
          },
          context: IRpcContext
        ) => {
          assertActive()
          sender(context)
          if (!hosts.has(input.host)) throw createTrayError(TrayErrorCode.hostUnknown)
          const record = routing.pick(input.host, input.policy)
          const options = { signal: context.signal, timeoutMs: context.timeoutMs }
          if (input.kind === TrayCallKind.request)
            return registry.sendCounted(record, TrayCallKind.request, input, options)
          if (input.kind === TrayCallKind.notify)
            return registry.sendCounted(record, TrayCallKind.notify, input, options)
          return registry.sendCounted(record, TrayCallKind.stream, input, options)
        },
        /** Authenticated metadata is attached only by the parent topic owner. */
        publish: (input: { topic: string; payload?: unknown }, context: IRpcContext) => {
          assertActive()
          topics.publishChild(input, context)
        },
        /** First and last child listeners share one generation-bound parent membership. */
        subscribe: (input: { topic: string }, context: IRpcContext) => {
          assertActive()
          topics.register(input.topic, context)
        },
        unsubscribe: (input: { topic: string }, context: IRpcContext) =>
          topics.unregister(input.topic, context)
      }))
    },
    install: () => ({})
  })
}
