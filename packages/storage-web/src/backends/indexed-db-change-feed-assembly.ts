import { IndexedDbFeature } from '../constants.js'
import type { IBackendChangeController } from '@migaia/storage-host/authoring/change-controller'
import { createBackendChangeIterator } from '@migaia/storage-host/authoring/change-iterator'
import {
  assertStringStorageKey,
  StorageContractError,
  StorageContractErrorCode
} from '@migaia/storage-contract'
import { assertLive, type IIndexedDbContext, type IIndexedDbStore } from './indexed-db.js'
import { indexedDbFeatureMissing } from './indexed-db-base-access.js'
import { StorageBackend, storageBackendOperation } from '../constants.js'
/** Change-feed iteration is imported only by the explicit Feature and borrows post-commit events. */
export class IndexedDbChangeFeedAssembly {
  /** Watch the original value channel; notification assembly is an explicit prerequisite. */
  watch<T>(
    context: IIndexedDbContext<T>,
    ...[key, ctx]: Parameters<IIndexedDbStore<T>['watch']>
  ): ReturnType<IIndexedDbStore<T>['watch']> {
    assertLive(context)
    if (context.assemblies.notifications === undefined)
      return indexedDbFeatureMissing.fail(IndexedDbFeature.notifications)
    if (!context.capabilities.changeFeed)
      throw new StorageContractError(StorageContractErrorCode.unsupported, {
        backend: StorageBackend.indexedDb
      })
    assertStringStorageKey(key, StorageBackend.indexedDb, 'watch key')
    return createBackendChangeIterator(context.controller as IBackendChangeController, {
      orgId: context.orgId,
      channel: 'value',
      key,
      ctx,
      execute: (advance, operationContext) =>
        context.runtime.execution.run(
          {
            operation: storageBackendOperation(StorageBackend.indexedDb, 'watch'),
            input: key,
            ctx: operationContext
          },
          advance
        )
    })
  }
}
