import { defineFeature, type IStorageFeatureOutput } from '@migaia/storage-host'
import {
  implement,
  durableChangeFeed,
  StorageContractError,
  StorageContractErrorCode,
  type ICapabilityImpl,
  type IDurableChangeFeedApi,
  type IOperationContext
} from '@migaia/storage-contract'
import { createLifecycleScope } from '@migaia/lifecycle'
import { postgresBackendKind } from '../plugin.ts'
import { snapshotPgReplication } from '../logical-replication.ts'
import { pgResource } from '../driver-resource.ts'
import { PgNames } from '../constants.ts'
import type { IPgLogicalReplicationOptions } from '../types.ts'
/**
 * Selecting this Feature borrows one original persistent slot and never creates or drops it
 * implicitly.
 */
export function pgLogicalReplicationFeature(options: IPgLogicalReplicationOptions) {
  const captured = snapshotPgReplication(options)
  return defineFeature<
    typeof postgresBackendKind,
    {},
    IStorageFeatureOutput<
      readonly [ICapabilityImpl<typeof durableChangeFeed, IDurableChangeFeedApi>],
      {},
      {
        readonly store: {
          readonly logicalReplication: { dropSlot(ctx?: IOperationContext): Promise<void> }
        }
        readonly transaction: {}
      }
    >
  >(postgresBackendKind, ({ featureExpose: core }) => {
    const resources = createLifecycleScope({ scheduler: core.getScheduler() })
    core.onDispose(async () => {
      resources.close()
      await resources.dispose()
    })
    core.selectReplication({
      ...captured,
      own: (native) => {
        resources.own(native, { force: () => native.dispose() })
        return pgResource(async () => {
          resources.release(native)
          await native.dispose()
        })
      }
    })
    core.registerDetect(async (signal) => {
      const port = core.getClient().logicalReplication
      if (core.getServer() !== 'postgres' || port === undefined)
        throw new StorageContractError(StorageContractErrorCode.unsupported, {
          backend: PgNames.backend
        })
      const facts = await port.detect({ ...captured, ...core.getReplicationRoute() }, { signal })
      core.reportReplication(facts)
    })
    const api: IDurableChangeFeedApi = {
      readChanges: (...args) => core.createDurableApi().readChanges(...args),
      tailChanges: (...args) => core.createDurableApi().tailChanges(...args)
    }
    return {
      capabilities: [implement(durableChangeFeed, api)] as const,
      chain: {},
      api: {
        store: {
          logicalReplication: {
            async dropSlot(ctx) {
              core.assertNativeRoot(this.store)
              const port = core.getClient().logicalReplication
              if (port === undefined)
                throw new StorageContractError(StorageContractErrorCode.unsupported, {
                  backend: PgNames.backend
                })
              await port.dropSlot(captured.slot, ctx)
            }
          }
        },
        transaction: {}
      }
    }
  })
}
