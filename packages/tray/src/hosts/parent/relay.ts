import { defineFeature, definePlugin, type IPluginConstraint } from '@migaia/plugin-host'
import type { IRpcContext } from '@migaia/rpc-core'
import { TrayInternal } from '../constants.js'
import { createTrayError } from '../../errors.js'
import { TrayErrorCode } from '../../error-code.js'
import type { ITrayRegistry, ITrayRecord } from './registry.js'
import type { ITraySender } from '../remote.js'
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
  send: (record: ITrayRecord) => ITraySender
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
          })
      }))
    },
    install: () => ({})
  })
}
