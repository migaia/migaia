import type {
  IStorageJournalBackendBinding,
  IStorageJournalNamespace,
  IStorageJournalNamespaceView,
  IStorageJournalImage,
  IStorageJournalTarget,
  IStorageJournalChange
} from '@migaia/storage-host'
import type { ITransactionScope } from '@migaia/storage-contract'

/** Native authors retain only private data I/O and the authentic scope's actual terminal callbacks. */
export async function compileJournalBinding(
  binding: IStorageJournalBackendBinding,
  orgId: string,
  scope: Omit<ITransactionScope, 'use'>
): Promise<void> {
  const namespace: IStorageJournalNamespace = await binding.forOrg(orgId).openNamespace('history')
  const transactionId: string = namespace.transactionInfo(scope).id
  void transactionId
  const off = namespace.onCommit(scope, () => undefined)
  await namespace.run(async (view: IStorageJournalNamespaceView) => {
    await view.set('head', 'encoded')
    const raw: string | null = await view.get('head')
    const keys: readonly string[] = await view.keys()
    void [raw, keys]
    // @ts-expect-error Private metadata does not acquire business batch or TTL methods.
    void view.setMany
    // @ts-expect-error The authentic outer scope owns budgets and private metadata has no TTL.
    await view.set('head', 'encoded', { ttlMs: 1 })
  }, scope)
  off()
  await namespace.dispose()
  // @ts-expect-error Private I/O does not grant backend installation authority.
  void namespace.registerStore
}

/** Mirror types preserve encoded absence, original physical targets and committed revisions. */
export function compileJournalChange(target: IStorageJournalTarget): IStorageJournalChange {
  const before: IStorageJournalImage = { present: false }
  const after: IStorageJournalImage = { present: true, value: 'encoded null' }
  return { target, before, after, afterRevision: { generation: 1 } }
}
