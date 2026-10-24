import type {
  IStorageJournalBackendBinding,
  IStorageJournalNamespace,
  IStorageJournalNamespaceView,
  IStorageJournalImage,
  IStorageJournalTarget,
  IStorageJournalChange,
  IStorageJournalOptions,
  IStorageJournalConfiguration,
  IStorageJournalExecutionPort
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

/** Global configuration borrows the logger and exposes only fixed-org preparation to backends. */
export function compileJournalOptions(
  logger: import('@migaia/logger').ILoggerCore,
  levelLogger: import('@migaia/logger').ILoggerCore &
    import('@migaia/logger/plugins').ILevelPluginExt,
  port: IStorageJournalExecutionPort
): void {
  const ordinary: IStorageJournalOptions<typeof logger> = {
    logger,
    namespace: 'app',
    telemetry: false
  }
  const telemetry: IStorageJournalOptions<typeof levelLogger> = {
    logger: levelLogger,
    namespace: 'app',
    telemetry: true
  }
  const invalid: IStorageJournalOptions<typeof logger> = {
    logger,
    namespace: 'app',
    // @ts-expect-error telemetry=true requires the actual level plugin's public methods.
    telemetry: true
  }
  const configuration: IStorageJournalConfiguration = async ({ orgId, storageLogStore }) => {
    const store = await storageLogStore('data', { prefix: orgId })
    return { logger, namespace: 'app', atomicBinlog: { data: store } }
  }
  const prepared: Promise<void> = port.prepare()
  const active: boolean = port.active()
  // @ts-expect-error Native preparation grants no store installer or lifecycle handle.
  void port.registerStore
  void [ordinary, telemetry, invalid, configuration, prepared, active]
}

/** Real selected logger extensions add undo without widening older one-parameter host types. */
export async function compileUndoSelection(
  logger: import('@migaia/logger').ILoggerCore &
    import('@migaia/logger/plugins/durable').IUndoLogExt,
  onlyBinlog: import('@migaia/logger').ILoggerCore &
    import('@migaia/logger/plugins/durable').IBinlogExt
): Promise<void> {
  const plugins = [memoryBackendPlugin()] as const
  await using plain = await createStorageHost({ plugins })
  // @ts-expect-error Without selected journal options the memory store does not promise undo.
  void plain.backend('memory').undo
  await using noUndo = await createStorageHost({
    plugins,
    journal: { logger: onlyBinlog, namespace: 'binlog' }
  })
  // @ts-expect-error A binlog-only logger cannot add undo by shape inference.
  void noUndo.backend('memory').undo
  await using direct = await createStorageHost({ plugins, journal: { logger, namespace: 'undo' } })
  const result: { readonly txId: string } = await direct.backend('memory').undo('original-tx')
  await using initialized = await createStorageHost({
    plugins,
    journal: async ({ orgId, storageLogStore }) => {
      const images = await storageLogStore('memory', { prefix: orgId })
      return { logger, namespace: 'undo', atomicUndo: { memory: images } }
    }
  })
  const borrowed = initialized.org(createOrgId()).backend('memory')
  await borrowed.undo(result.txId)
  // @ts-expect-error Journal methods grant no borrowed lifecycle authority.
  void borrowed.dispose
  const old: import('@migaia/storage-host').IStorageHost<typeof plugins> = plain
  const options: import('@migaia/storage-host').IStorageHostCreateOptions<typeof plugins> = {
    plugins,
    journal: { logger, namespace: 'old-typed-options' }
  }
  await using explicit = await createStorageHost<typeof plugins>(options)
  void [old, explicit]
}
