import { storageJournalPlugin, storageLogStore } from '@migaia/storage-host/plugins/journal'
import type {
  IStorageJournalBackendBinding,
  IStorageJournalNamespace,
  IStorageJournalNamespaceView,
  IStorageJournalImage,
  IStorageJournalTarget,
  IStorageJournalChange,
  IStorageJournalOptions,
  IStorageJournalConfiguration,
  IStorageJournalExecutionPort,
  IStorageJournalRedoBinding
} from '@migaia/storage-host'
import type { ITransactionScope } from '@migaia/storage-contract'
import { createOrgId, createStorageHost } from '@migaia/storage-host'
import { memoryBackendPlugin } from '@migaia/storage-host/plugins/memory'

/** Only actual admitted backend ids can select a private resource; org views grant no host close. */
export async function compileStorageLogStore(): Promise<void> {
  await using host = await createStorageHost({
    plugins: [storageJournalPlugin(), memoryBackendPlugin({ id: 'data' })]
  })
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
  const optIn: true | undefined = binding.requiresIndexedDbUndo
  void optIn
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
  logger: import('@migaia/log-host').ILogHost,
  levelLogger: import('@migaia/log-host').ILogHost & import('@migaia/log-host').ILevelPluginExt,
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
  logger: import('@migaia/log-host').ILogHost & import('@migaia/log-plugin-durable').IUndoLogExt,
  onlyBinlog: import('@migaia/log-host').ILogHost & import('@migaia/log-plugin-durable').IBinlogExt
): Promise<void> {
  const plugins = [memoryBackendPlugin()] as const
  await using plain = await createStorageHost({ plugins })
  // @ts-expect-error Without selected journal options the memory store does not promise undo.
  void plain.backend('memory').undo
  await using noUndo = await createStorageHost({
    plugins: [storageJournalPlugin({ logger: onlyBinlog, namespace: 'binlog' }), ...plugins]
  })
  // @ts-expect-error A binlog-only logger cannot add undo by shape inference.
  void noUndo.backend('memory').undo
  await using direct = await createStorageHost({
    plugins: [storageJournalPlugin({ logger, namespace: 'undo' }), ...plugins]
  })
  const result: { readonly txId: string } = await direct.backend('memory').undo('original-tx')
  await using initialized = await createStorageHost({
    plugins: [
      storageJournalPlugin(async ({ orgId, storageLogStore }) => {
        const images = await storageLogStore('memory', { prefix: orgId })
        return { logger, namespace: 'undo', atomicUndo: { memory: images } }
      }),
      ...plugins
    ]
  })
  const borrowed = initialized.org(createOrgId()).backend('memory')
  await borrowed.undo(result.txId)
  // @ts-expect-error Journal methods grant no borrowed lifecycle authority.
  void borrowed.dispose
  const old: import('@migaia/storage-host').IStorageHost<typeof plugins> = plain
  const journaled = [
    storageJournalPlugin({ logger, namespace: 'typed-options' }),
    ...plugins
  ] as const
  const options: import('@migaia/storage-host').IStorageHostCreateOptions<typeof journaled> = {
    plugins: journaled
  }
  await using explicit = await createStorageHost<typeof journaled>(options)
  await explicit.backend('memory').undo('typed-options-tx')
  void [old, explicit]
}

/** Original text writers receive only exact-scope and existing native-protection callbacks. */
export function compileRedoAuthor(
  binding: IStorageJournalRedoBinding,
  port: IStorageJournalExecutionPort,
  scope: object
) {
  const id: string = binding.transactionInfo(scope).id
  const protectedValue: Promise<number> = binding.protect(async () => 1)
  const operation: Promise<number> | undefined = port.runRedo?.(async () => 1)
  const captured: readonly IStorageJournalChange[] = binding.changes(scope)
  const recorded: Promise<void> | undefined = port.beginRedo?.(scope)?.record(scope)
  void [captured, recorded]
  // @ts-expect-error Redo grants no native commit or store installation authority.
  void binding.commit
  // @ts-expect-error Redo never gives the original store or shutdown handle to callers.
  void binding.getStore
  void [id, protectedValue, operation]
}

/** Optional journal extensions accept every approved selection without borrowing host methods. */
export function compileOptionalJournalExtensions(
  core: import('@migaia/log-host').ILogHost,
  level: import('@migaia/log-host').ILevelPluginExt,
  binlog: import('@migaia/log-plugin-durable').IBinlogExt,
  wal: import('@migaia/log-plugin-durable').IWalExt,
  undo: import('@migaia/log-plugin-durable').IUndoLogExt,
  binlogUndo: import('@migaia/log-plugin-durable').IBinlogExt &
    import('@migaia/log-plugin-durable').IUndoLogExt,
  binlogWal: import('@migaia/log-plugin-durable').IBinlogExt &
    import('@migaia/log-plugin-durable').IWalExt,
  undoWal: import('@migaia/log-plugin-durable').IUndoLogExt &
    import('@migaia/log-plugin-durable').IWalExt
): void {
  /** Each option preserves its exact borrowed logger type, including single-plugin selections. */
  const coreOnly: IStorageJournalOptions<typeof core> = { logger: core, namespace: 'core' }
  /** Standard level methods alone permit telemetry without any durable extension. */
  const levelOnly: IStorageJournalOptions<typeof level> = {
    logger: level,
    namespace: 'level',
    telemetry: true
  }
  /** A binlog selection grants no WAL or undo requirement. */
  const binlogOnly: IStorageJournalOptions<typeof binlog> = { logger: binlog, namespace: 'binlog' }
  /** A WAL selection grants no binlog or undo requirement. */
  const walOnly: IStorageJournalOptions<typeof wal> = { logger: wal, namespace: 'wal' }
  /** An undo selection grants no binlog or WAL requirement. */
  const undoOnly: IStorageJournalOptions<typeof undo> = { logger: undo, namespace: 'undo' }
  /** The native atomic pair does not require a WAL extension. */
  const selectedBinlogUndo: IStorageJournalOptions<typeof binlogUndo> = {
    logger: binlogUndo,
    namespace: 'binlog-undo'
  }
  /** The redo/commit pair does not require an undo extension. */
  const selectedBinlogWal: IStorageJournalOptions<typeof binlogWal> = {
    logger: binlogWal,
    namespace: 'binlog-wal'
  }
  /** The recovery pair does not require a binlog extension. */
  const selectedUndoWal: IStorageJournalOptions<typeof undoWal> = {
    logger: undoWal,
    namespace: 'undo-wal'
  }
  /** Exact selection keeps binlog methods available instead of widening to an optional member. */
  const exactBinlog: typeof binlog = binlogOnly.logger
  /** This counterexample guards against reintroducing a mandatory three-member view. */
  // @ts-expect-error Requiring all three members would incorrectly reject a supported single plugin.
  const required: Pick<typeof binlogUndo & typeof wal, 'binlog' | 'wal' | 'undo'> = binlog
  /** This counterexample guards the object intersection needed by a core-only host. */
  // @ts-expect-error A bare Partial weak type would incorrectly reject a supported core-only host.
  const weak: Partial<typeof binlogUndo & typeof wal> = core
  /** Durable capability ownership alone never supplies severity methods. */
  const withoutLevel: IStorageJournalOptions<typeof binlog> = {
    logger: binlog,
    namespace: 'no-level',
    // @ts-expect-error Telemetry still requires the actual level extension.
    telemetry: true
  }
  /** A malformed overlapping capability remains invalid despite optional selection. */
  // @ts-expect-error A present durable property must retain its original extension shape.
  const wrongWal: IStorageJournalOptions<{ wal: string }> = {
    logger: { wal: 'invalid' },
    namespace: 'wrong-wal'
  }
  /** Primitive values cannot represent a borrowed journal capability. */
  // @ts-expect-error Journal capabilities must be an object, never a primitive.
  const primitive: IStorageJournalOptions<number> = { logger: 1, namespace: 'primitive' }
  void [
    coreOnly,
    levelOnly,
    binlogOnly,
    walOnly,
    undoOnly,
    selectedBinlogUndo,
    selectedBinlogWal,
    selectedUndoWal,
    exactBinlog,
    required,
    weak,
    withoutLevel,
    wrongWal,
    primitive
  ]
}
