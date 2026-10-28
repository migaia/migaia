import { defineFeature, type IStorageFeatureOutput } from '@migaia/storage-host'
import { StorageContractError, StorageContractErrorCode } from '@migaia/storage-contract'
import { createLifecycleScope } from '@migaia/lifecycle'
import { postgresBackendKind } from '../plugin.ts'
import type { IPgListenApi, IPgTransactionNotifyApi } from '../types.ts'
import { PgNames, PgOperation } from '../constants.ts'
import { invalidArgument } from '../errors.ts'
import type {} from '../hooks.ts'
import { pgResource } from '../driver-resource.ts'
/** PostgreSQL channel and payload limits are measured in native UTF-8 bytes before I/O. */
function notification(channel: string, payload?: string): void {
  if (
    typeof channel !== 'string' ||
    channel.includes('\0') ||
    !channel.isWellFormed() ||
    new TextEncoder().encode(channel).length > 63 ||
    channel.length === 0 ||
    (payload !== undefined &&
      (typeof payload !== 'string' ||
        payload.includes('\0') ||
        !payload.isWellFormed() ||
        new TextEncoder().encode(payload).length >= 8000))
  )
    throw invalidArgument()
}
/** Native subscriptions reuse original lifecycle ownership; transaction APIs publish only. */
export function pgListenFeature() {
  return defineFeature<
    typeof postgresBackendKind,
    {},
    IStorageFeatureOutput<
      readonly [],
      {},
      {
        readonly store: { readonly notifications: IPgListenApi }
        readonly transaction: { readonly notifications: IPgTransactionNotifyApi }
      }
    >
  >(postgresBackendKind, ({ featureExpose: core }) => {
    const resources = createLifecycleScope({ scheduler: core.getScheduler() })
    core.onDispose(async () => {
      resources.close()
      await resources.dispose()
    })
    return {
      capabilities: [] as const,
      chain: {},
      api: {
        store: {
          notifications: {
            async listen(channel, listener, ctx) {
              core.assertNativeRoot(this.store)
              notification(channel)
              if (typeof listener !== 'function') throw invalidArgument()
              const driver = core.getClient()
              if (!driver.listen)
                throw new StorageContractError(StorageContractErrorCode.unsupported, {
                  backend: PgNames.backend
                })
              const native = await core.runNative(undefined, PgOperation.watch, ctx, async () =>
                driver.listen!(
                  channel,
                  (payload) => {
                    core.emit('onNotify', () => ({
                      backendId: core.getBackendId(),
                      backend: PgNames.backend,
                      channel,
                      orgId: this.orgId
                    }))
                    return listener(payload)
                  },
                  ctx
                )
              )
              resources.own(native, { force: () => native.dispose() })
              return pgResource(async () => {
                resources.release(native)
                await native.dispose()
              })
            },
            async notify(channel, payload, ctx) {
              core.assertNativeRoot(this.store)
              notification(channel, payload)
              await core.runNative(undefined, PgOperation.notify, ctx, async (client, context) => {
                await client.query('SELECT pg_notify($1,$2)', [channel, payload], context)
              })
            }
          }
        },
        transaction: {
          notifications: {
            async notify(channel, payload, ctx) {
              core.assertNativeRoot(this.store)
              notification(channel, payload)
              await core.runNative(this.scope, PgOperation.notify, ctx, async (client, context) => {
                await client.query('SELECT pg_notify($1,$2)', [channel, payload], context)
              })
            }
          }
        }
      }
    }
  })
}
