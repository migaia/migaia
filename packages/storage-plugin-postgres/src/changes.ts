import type { IStorageResource } from '@migaia/storage-contract'
import type { IBackendChangeController } from '@migaia/storage-host/sdk'
import { createStorageOperationReporter, reportCleanupError } from '@migaia/storage-host/sdk'
import type { IPgConfiguration } from './schema.js'
import type { IPgState } from './native.js'
import { PgNotificationChannel } from './constants.js'
/** Native LISTEN transports only bounded hints, never portable values or a second replay log. */
export async function createPgChanges(
  configuration: IPgConfiguration,
  controller: IBackendChangeController
): Promise<{
  readonly resource: IStorageResource | undefined
  beforeCommit(state: IPgState): Promise<void>
  publish(state: IPgState): void
}> {
  let sequence = 0
  const report = createStorageOperationReporter()
  const resource =
    configuration.server === 'postgres' && configuration.driver.listen !== undefined
      ? await configuration.driver.listen(PgNotificationChannel, (payload) => {
          try {
            const event: unknown = JSON.parse(payload)
            if (
              event === null ||
              typeof event !== 'object' ||
              !('schema' in event) ||
              event.schema !== configuration.schema ||
              !('prefix' in event) ||
              event.prefix !== configuration.prefix ||
              !('origin' in event) ||
              typeof event.origin !== 'string' ||
              event.origin === controller.origin ||
              !('orgId' in event) ||
              typeof event.orgId !== 'string' ||
              !('sequence' in event) ||
              typeof event.sequence !== 'number'
            )
              return
            controller.publishExternal({
              origin: event.origin,
              sequence: event.sequence,
              orgId: event.orgId,
              channel: 'all',
              kind: 'batch'
            })
          } catch (cause) {
            reportCleanupError(report, cause)
          }
        })
      : undefined
  return {
    resource,
    beforeCommit: async (state) => {
      if (configuration.server !== 'postgres' || state.changed.size === 0) return
      sequence += 1
      await state.client.query(
        'SELECT pg_notify($1,$2)',
        [
          PgNotificationChannel,
          JSON.stringify({
            schema: configuration.schema,
            prefix: configuration.prefix,
            origin: controller.origin,
            sequence,
            orgId: state.orgId
          })
        ],
        state.ctx
      )
    },
    publish: (state) => {
      for (const [channel, keys] of state.changed) {
        if (channel === 'metadata' || keys.size === 0) continue
        controller.publish({
          orgId: state.orgId,
          channel: channel === 'vector' ? 'all' : channel === 'text' ? 'value' : channel,
          kind: 'batch',
          keys: [...keys.values()]
        })
      }
    }
  }
}
