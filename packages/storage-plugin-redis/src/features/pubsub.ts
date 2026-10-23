import { RedisOperation } from '../constants.js'
import { RedisCommand } from '../constants.js'
import { defineFeature, type IStorageFeatureOutput } from '@migaia/storage-host'
import type { IOperationContext, IStorageResource } from '@migaia/storage-contract'
import { encodeUtf8 } from '@migaia/utils/bytes'
import { inspectThenable, observeThenableRejection } from '@migaia/utils/function'
import { redisBackendKind } from '../plugin.js'
import { readNativeFeaturePort } from '../native-feature.js'
import { featureName, featureInteger, featureBytes, readFeatureBytes } from '../feature-input.js'
import { replyInteger } from '../layout.js'
import { invalidArgument } from '../errors.js'
/** Messages are best-effort native Pub/Sub payloads, with no replay or expiry-delivery guarantee. */
export type IRedisPubSubApi = {
  readonly pubsub: {
    publish(channel: string, payload: Uint8Array, ctx?: IOperationContext): Promise<number>
    subscribe(
      channel: string,
      listener: (payload: Uint8Array) => void,
      ctx?: IOperationContext
    ): Promise<IStorageResource>
    keyspace(
      database: number,
      event: 'expired' | 'del' | 'set',
      listener: (key: Uint8Array) => void,
      ctx?: IOperationContext
    ): Promise<IStorageResource>
  }
}
/** Subscription resources stay with the exact original store and never enter WATCH scopes. */
export type IRedisPubSubOutput = IStorageFeatureOutput<
  readonly [],
  {},
  { readonly store: IRedisPubSubApi; readonly transaction: {} }
>
/** Native subscriptions are owned by the injected driver; the backend seals callbacks on disposal. */
export function redisPubSubFeature() {
  return defineFeature<typeof redisBackendKind, {}, IRedisPubSubOutput>(redisBackendKind, () => ({
    capabilities: [] as const,
    chain: {},
    api: {
      transaction: {},
      store: {
        pubsub: {
          async publish(channel: string, payload: Uint8Array, ctx?: IOperationContext) {
            const input = { name: featureName(channel), payload: featureBytes(payload) }
            return readNativeFeaturePort(this.store).run(
              RedisOperation.pubsubPublish,
              input,
              ctx,
              true,
              async (actual, connection, layout) =>
                replyInteger(
                  await connection.command([
                    RedisCommand.publish,
                    layout.tag + ':pubsub:' + layout.encode(featureName(actual.name)),
                    actual.payload
                  ])
                ),
              false
            )
          },
          async subscribe(
            channel: string,
            listener: (payload: Uint8Array) => void,
            ctx?: IOperationContext
          ) {
            const name = featureName(channel)
            if (typeof listener !== 'function') throw invalidArgument()
            const port = readNativeFeaturePort(this.store)
            return port.resource(
              RedisOperation.pubsubSubscribe,
              { name },
              ctx,
              async (input, layout) => {
                const resource = await port.driver.subscribe(
                  layout.tag + ':pubsub:' + layout.encode(featureName(input.name)),
                  (wire) => {
                    try {
                      const result: unknown = listener(readFeatureBytes(wire))
                      observeThenableRejection(result, inspectThenable(result), port.report)
                    } catch (error) {
                      port.report(error)
                    }
                  }
                )
                return resource
              },
              false
            )
          },
          async keyspace(
            database: number,
            event: 'expired' | 'del' | 'set',
            listener: (key: Uint8Array) => void,
            ctx?: IOperationContext
          ) {
            const db = featureInteger(database, true)
            if (!['expired', 'del', 'set'].includes(event) || typeof listener !== 'function')
              throw invalidArgument()
            const port = readNativeFeaturePort(this.store)
            return port.resource(
              RedisOperation.pubsubKeyspace,
              { db, event },
              ctx,
              async (input, layout) => {
                featureInteger(input.db, true)
                if (!['expired', 'del', 'set'].includes(input.event)) throw invalidArgument()
                const resource = await port.driver.subscribe(
                  '__keyevent@' + input.db + '__:' + input.event,
                  (wire) => {
                    if (
                      !wire.startsWith(layout.tag + ':') ||
                      (!port.allOrganizations && !layout.owns(wire))
                    )
                      return
                    try {
                      const result: unknown = listener(encodeUtf8(wire))
                      observeThenableRejection(result, inspectThenable(result), port.report)
                    } catch (error) {
                      port.report(error)
                    }
                  }
                )
                return resource
              },
              false
            )
          }
        }
      }
    }
  }))
}
