import type {
  IBackendLifecycleController,
  IBackendChangeController
} from '@migaia/storage-host/sdk'
import { createBackendChangeController } from '@migaia/storage-host/sdk'
import { type IStorageChange } from '@migaia/storage-contract'
import { acquireIndexedDbCoordination } from './indexed-db-coordination.ts'
import {
  IIndexedDbContext,
  IIndexedDbNativeCallback,
  IIndexedDbNativeRun,
  type IIndexedDbStore,
  assertLive
} from './indexed-db.ts'
/** Route existing post-commit events through the one private controller owner. */
export function publishChange<TValue>(
  indexedDbContext: IIndexedDbContext<TValue>,
  change: Omit<IStorageChange, 'sequence' | 'origin' | 'scope'>
): void {
  const event = (indexedDbContext.controller as IBackendChangeController).publish({
    ...change,
    orgId: indexedDbContext.orgId
  })
  if (event !== undefined) indexedDbContext.coordination.publish(event)
}

/** Execute the original native afterCommit phase under its existing transaction owner. */
export function indexedDbNativeAfterCommit<TValue, T>(
  nativeState: IIndexedDbNativeCallback<TValue, T>
): ReturnType<NonNullable<IIndexedDbNativeRun<TValue, T>['afterCommit']>> {
  if (nativeState.attemptState.logicalTransaction.root !== undefined) {
    /** Root publication retains its existing kind, order and no-op suppression. */
    const notification = nativeState.attemptState.logicalTransaction.root.notification
    if (notification.channel === 'all') {
      if (nativeState.changed.size > 0)
        publishChange(nativeState.attemptState.logicalTransaction.indexedDbContext, {
          channel: 'all',
          kind: 'clear'
        })
      return
    }
    const keys = nativeState.changed.get(notification.channel)
    if (keys !== undefined)
      publishChange(nativeState.attemptState.logicalTransaction.indexedDbContext, {
        channel: notification.channel,
        kind: notification.kind,
        ...(notification.kind === 'clear' ? {} : { keys: [...keys.values()] })
      })
    for (const channel of ['value', 'bytes', 'record'] as const) {
      if (channel === notification.channel) continue
      const displaced = nativeState.changed.get(channel)
      if (displaced !== undefined && displaced.size > 0)
        publishChange(nativeState.attemptState.logicalTransaction.indexedDbContext, {
          channel,
          kind: notification.displacedKind ?? 'remove',
          keys: [...displaced.values()]
        })
    }
    return
  }
  for (const channel of ['value', 'bytes', 'record'] as const) {
    const keys = nativeState.changed.get(channel)
    if (keys !== undefined && keys.size > 0)
      publishChange(nativeState.attemptState.logicalTransaction.indexedDbContext, {
        channel,
        kind: 'batch',
        keys: [...keys.values()]
      })
  }
}

/** Commit notifications own event publication and transport; lifecycle remains with the backend. */
export class IndexedDbNotificationsAssembly {
  readonly controller = createBackendChangeController
  readonly coordination = acquireIndexedDbCoordination
  readonly afterCommit = indexedDbNativeAfterCommit
  readonly publish = publishChange
  /** External hints keep the original controller's ordering and org filtering. */
  external(controller: IBackendLifecycleController, change: IStorageChange): void {
    ;(controller as IBackendChangeController).publishExternal(change)
  }
  /** Subscribers observe only committed changes from this exact physical store. */
  subscribe<T>(
    context: IIndexedDbContext<T>,
    listener: Parameters<IIndexedDbStore<T>['subscribeChanges']>[0]
  ): ReturnType<IIndexedDbStore<T>['subscribeChanges']> {
    assertLive(context)
    return (context.controller as IBackendChangeController).subscribe(listener)
  }
}
