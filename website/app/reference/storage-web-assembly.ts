import type { IEnhancerDoc, IModuleDoc, ISymbolDoc, IText, ITypeDoc } from './contract.js'

/** Browser capability explanations remain bilingual at the original reference owner. */
const t = (en: string, zh: string): IText => ({ en, zh })
/**
 * Feature definitions are explicit roots; the base IndexedDB backend performs ordinary storage
 * only.
 */
const units = [
  [
    'ttl',
    'indexedDbTtlFeature',
    'Attach expiry metadata and TTL operations to the original IndexedDB transaction. Basic storage does not expire entries implicitly.',
    '为原索引数据库事务加入期限元数据和期限操作，基础存储不隐式启用过期处理。'
  ],
  [
    'batch',
    'indexedDbBatchFeature',
    'Add native getMany, setMany, removeMany and prefix removal through the same transaction owner.',
    '通过同一事务拥有者增加批量读取、写入、删除和前缀删除。'
  ],
  [
    'journal',
    'indexedDbJournalFeature',
    'Provide private journal namespaces, images and native undo binding only when explicitly selected before database opening.',
    '仅在数据库打开前显式选择时提供私有日志命名空间、镜像和原生撤销绑定。'
  ],
  [
    'notifications',
    'indexedDbNotificationsFeature',
    'Publish committed local and cross-context invalidation hints without enabling watch iterators.',
    '发布已提交的本地与跨上下文失效提示，但不启用监听迭代器。'
  ],
  [
    'change-feed',
    'indexedDbChangeFeedFeature',
    'Enable cancellable change-feed iterators after explicitly selecting the notification producer.',
    '在显式选择通知生产者之后，启用可取消的变更流迭代器。'
  ],
  [
    'indexes',
    'indexedDbIndexesFeature',
    'Provide native secondary-index declarations, readiness and backfill through the original IndexedDB owner.',
    '通过原索引数据库拥有者提供原生次级索引声明、就绪状态与回填能力。'
  ]
] as const
/** Every Feature has a complete program exercising the capability it installs. */
const examples: Readonly<Record<string, string>> = {
  ttl: "import { createStorageHost } from '@migaia/storage-host'\nimport { ttl } from '@migaia/storage-contract'\nimport { indexedDbBackendPlugin } from '@migaia/storage-web/indexed-db'\nimport { indexedDbTtlFeature } from '@migaia/storage-web/features/indexed-db-ttl'\n\nawait using host = await createStorageHost({\n  plugins: [\n    indexedDbBackendPlugin(\n      { dbName: 'expiring-drafts' },\n      { ttl: indexedDbTtlFeature() },\n    ),\n  ],\n})\nconst drafts = host.backend('indexed-db')\nawait drafts.set('one', 'temporary')\nawait drafts.use(ttl).expire({ channel: 'text', key: 'one' }, 0)\nconsole.log(await drafts.get('one'))",
  batch:
    "import { createStorageHost } from '@migaia/storage-host'\nimport { kv } from '@migaia/storage-contract'\nimport { indexedDbBackendPlugin } from '@migaia/storage-web/indexed-db'\nimport { indexedDbBatchFeature } from '@migaia/storage-web/features/indexed-db-batch'\n\nawait using host = await createStorageHost({\n  plugins: [\n    indexedDbBackendPlugin(\n      { dbName: 'draft-batches' },\n      { batch: indexedDbBatchFeature() },\n    ),\n  ],\n})\nconst drafts = host.backend('indexed-db').use(kv)\nawait drafts.setMany([\n  { key: 'one', value: 'first' },\n  { key: 'two', value: 'second' },\n])\nconsole.log(await drafts.getMany(['one', 'two']))",
  journal:
    "import { createStorageHost } from '@migaia/storage-host'\nimport { storageJournalPlugin, storageLogStore } from '@migaia/storage-host/journal'\nimport { indexedDbBackendPlugin } from '@migaia/storage-web/indexed-db'\nimport { indexedDbJournalFeature } from '@migaia/storage-web/features/indexed-db-journal'\n\nawait using host = await createStorageHost({\n  plugins: [\n    storageJournalPlugin(),\n    indexedDbBackendPlugin(\n      { dbName: 'draft-history' },\n      { journal: indexedDbJournalFeature() },\n    ),\n  ],\n})\nawait using history = await storageLogStore(host, 'indexed-db', { prefix: 'drafts' })\nawait history.append([{ kind: 'draft.saved', payload: { id: 'one' } }])\nconsole.log(await history.lastSeq())",
  notifications:
    "import { createStorageHost } from '@migaia/storage-host'\nimport { indexedDbBackendPlugin } from '@migaia/storage-web/indexed-db'\nimport { indexedDbNotificationsFeature } from '@migaia/storage-web/features/indexed-db-notifications'\n\nawait using host = await createStorageHost({\n  plugins: [\n    indexedDbBackendPlugin(\n      { dbName: 'draft-notifications' },\n      { notifications: indexedDbNotificationsFeature() },\n    ),\n  ],\n})\nconst drafts = host.backend('indexed-db')\nconst release = drafts.subscribeChanges((change) => console.log(change.kind))\nawait drafts.set('one', 'saved')\nrelease()",
  'change-feed':
    "import { createStorageHost } from '@migaia/storage-host'\nimport { asChangeFeedStore } from '@migaia/storage-contract'\nimport { indexedDbBackendPlugin } from '@migaia/storage-web/indexed-db'\nimport { indexedDbNotificationsFeature } from '@migaia/storage-web/features/indexed-db-notifications'\nimport { indexedDbChangeFeedFeature } from '@migaia/storage-web/features/indexed-db-change-feed'\n\nawait using host = await createStorageHost({\n  plugins: [\n    indexedDbBackendPlugin(\n      { dbName: 'draft-changes' },\n      {\n        notifications: indexedDbNotificationsFeature(),\n        changeFeed: indexedDbChangeFeedFeature(),\n      },\n    ),\n  ],\n})\nconst drafts = asChangeFeedStore(host.backend('indexed-db'))\nawait using changes = drafts.watch('one')\nconst next = changes.next()\nawait drafts.set('one', 'saved')\nconsole.log((await next).value?.kind)",
  indexes:
    "import { createStorageHost } from '@migaia/storage-host'\nimport { indexedDbBackendPlugin } from '@migaia/storage-web/indexed-db'\nimport { indexedDbIndexesFeature } from '@migaia/storage-web/features/indexed-db-indexes'\n\nawait using host = await createStorageHost({\n  plugins: [\n    indexedDbBackendPlugin(\n      { dbName: 'indexed-orders' },\n      { indexes: indexedDbIndexesFeature() },\n    ),\n  ],\n})\nconst orders = host.backend('indexed-db')\nconst handle = await orders.ensureRecordIndexes('orders', [\n  { name: 'status', unique: false, multiEntry: false, revision: 1 },\n])\nconsole.log((await orders.getRecordIndexReadiness(handle)).status)"
}
/** Module descriptions identify the exact first factory imported by application code. */
export const storageWebAssemblyModules: Readonly<Record<string, IModuleDoc>> = Object.fromEntries(
  units.map(([path, name, en, zh]) => [
    `features/indexed-db-${path}`,
    {
      summary: t(
        `${en} Start with ${name} in the backend's Feature record.`,
        `${zh} 在后端特性配置中选择 \`${name}\`。`
      ),
      example: examples[path]
    }
  ])
)
/** Function docs name the missing-assembly failure and explicit notification prerequisite. */
export const storageWebAssemblySymbols: Readonly<Record<string, ISymbolDoc>> = Object.fromEntries(
  units.map(([path, name, en, zh]) => [
    name,
    {
      role: 'enhancer',
      purpose: t(
        `${en} Calls that need an omitted assembly reject with INDEXED_DB_FEATURE_NOT_INSTALLED and name the missing Feature.`,
        `${zh} 未装配即调用会报 \`INDEXED_DB_FEATURE_NOT_INSTALLED\` 并指出缺少的特性。`
      ),
      returns: t(
        'A Feature definition selected before native database opening; it does not open a database by itself.',
        '返回在原生数据库打开前选择的特性定义，本身不打开数据库。'
      ),
      example: examples[path],
      exampleIntro: t(
        'Install this Feature together with the backend, then use its native operation.',
        '将此特性与后端一起安装，再调用对应原生操作。'
      ),
      exampleResult: t(
        'The selected operation uses the original native transaction and host cleanup.',
        '所选操作使用原生事务，并由原宿主负责清理。'
      )
    }
  ])
)
/** Each enhancer changes the original backend behavior rather than adding another storage owner. */
export const storageWebAssemblyEnhancers: Readonly<Record<string, IEnhancerDoc>> =
  Object.fromEntries(
    units.map(([path, name]) => [
      name,
      {
        kind: 'feature',
        target: 'IIndexedDbBackendStore',
        summary: storageWebAssemblySymbols[name]!.purpose,
        install: examples[path]!,
        grants: [],
        behaviors: [storageWebAssemblySymbols[name]!.purpose],
        scenarios: [storageWebAssemblySymbols[name]!.purpose],
        example: examples[path]!
      }
    ])
  )
/** Backend assembly definitions are passed directly to indexedDbBackendPlugin, not invoked manually. */
export const storageWebAssemblyTypes: Readonly<Record<string, ITypeDoc>> = {
  IIndexedDbAssemblyFeature: {
    summary: t(
      'A native assembly Feature returned by its public IndexedDB factory, selected before the database opener seals.',
      '由公开索引数据库工厂返回的原生装配特性，在数据库打开器封闭前选择。'
    ),
    members: {},
    example: examples.ttl
  }
}
