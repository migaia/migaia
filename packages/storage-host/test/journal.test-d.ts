import type {
  IStorageJournalBackendBinding,
  IStorageJournalNamespace,
  IStorageJournalNamespaceView,
  IStorageJournalImage,
  IStorageJournalTarget,
  IStorageJournalChange
} from '@migaia/storage-host'
import type { ITransactionScope } from '@migaia/storage-contract'
import { createOrgId, createStorageHost, memoryBackendPlugin } from '@migaia/storage-host'
import { storageLogStore } from '@migaia/storage-host/journal'

/** Only actual admitted backend ids can select a private resource; org views grant no host close. */
export async function compileStorageLogStore(): Promise<void> {
  await using host = await createStorageHost({ plugins: [memoryBackendPlugin({ id: 'data' })] })
  await using log = await storageLogStore(host, 'data', { prefix: 'history' })
  const view = host.org(createOrgId())
  await using projected = await storageLogStore(view, 'data', { prefix: 'other' })
  // @ts-expect-error A backend id must come from this exact installed tuple.
  await storageLogStore(host, 'missing', { prefix: 'history' })
  // @ts-expect-error A public KV backend does not grant private journal authority.
  await storageLogStore(host.backend('data'), 'data', { prefix: 'history' })
  // @ts-expect-error An org view never gains root cleanup authority by opening a journal.
  void view.dispose
  void [log, projected]
}

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
  await namespace.runCommitted?.(
    async (view) => {
      await view.set('head', 'committed')
      return { committed: true }
    },
    (result) => {
      const committed: boolean = result.committed
      void committed
    }
  )
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
