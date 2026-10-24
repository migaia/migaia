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
  ttl: `import { createStorageHost } from '@migaia/storage-host'
import { ttl } from '@migaia/storage-contract'
import { indexedDbBackendPlugin } from '@migaia/storage-web/indexed-db'
import { indexedDbTtlFeature } from '@migaia/storage-web/features/indexed-db-ttl'

await using host = await createStorageHost({ plugins: [indexedDbBackendPlugin(
  { dbName: 'expiring-drafts' }, { ttl: indexedDbTtlFeature() }
)] })
const drafts = host.backend('indexed-db')
await drafts.set('one', 'temporary')
await drafts.use(ttl).expire({ channel: 'text', key: 'one' }, 0)
console.log(await drafts.get('one'))`,
  batch: `import { createStorageHost } from '@migaia/storage-host'
import { kv } from '@migaia/storage-contract'
import { indexedDbBackendPlugin } from '@migaia/storage-web/indexed-db'
import { indexedDbBatchFeature } from '@migaia/storage-web/features/indexed-db-batch'

await using host = await createStorageHost({ plugins: [indexedDbBackendPlugin(
  { dbName: 'draft-batches' }, { batch: indexedDbBatchFeature() }
)] })
const drafts = host.backend('indexed-db').use(kv)
await drafts.setMany([{ key: 'one', value: 'first' }, { key: 'two', value: 'second' }])
console.log(await drafts.getMany(['one', 'two']))`,
  journal: `import { createStorageHost } from '@migaia/storage-host'
import { storageJournalPlugin, storageLogStore } from '@migaia/storage-host/journal'
import { indexedDbBackendPlugin } from '@migaia/storage-web/indexed-db'
import { indexedDbJournalFeature } from '@migaia/storage-web/features/indexed-db-journal'

await using host = await createStorageHost({ plugins: [
  storageJournalPlugin(), indexedDbBackendPlugin(
    { dbName: 'draft-history' }, { journal: indexedDbJournalFeature() }
  )
] })
await using history = await storageLogStore(host, 'indexed-db', { prefix: 'drafts' })
await history.append([{ kind: 'draft.saved', payload: { id: 'one' } }])
console.log(await history.lastSeq())`,
  notifications: `import { createStorageHost } from '@migaia/storage-host'
import { indexedDbBackendPlugin } from '@migaia/storage-web/indexed-db'
import { indexedDbNotificationsFeature } from '@migaia/storage-web/features/indexed-db-notifications'

await using host = await createStorageHost({ plugins: [indexedDbBackendPlugin(
  { dbName: 'draft-notifications' }, { notifications: indexedDbNotificationsFeature() }
)] })
const drafts = host.backend('indexed-db')
const release = drafts.subscribeChanges(change => console.log(change.kind))
await drafts.set('one', 'saved')
release()`,
  'change-feed': `import { createStorageHost } from '@migaia/storage-host'
import { asChangeFeedStore } from '@migaia/storage-contract'
import { indexedDbBackendPlugin } from '@migaia/storage-web/indexed-db'
import { indexedDbNotificationsFeature } from '@migaia/storage-web/features/indexed-db-notifications'
import { indexedDbChangeFeedFeature } from '@migaia/storage-web/features/indexed-db-change-feed'

await using host = await createStorageHost({ plugins: [indexedDbBackendPlugin(
  { dbName: 'draft-changes' }, {
    notifications: indexedDbNotificationsFeature(), changeFeed: indexedDbChangeFeedFeature()
  }
)] })
const drafts = asChangeFeedStore(host.backend('indexed-db'))
await using changes = drafts.watch('one')
const next = changes.next()
await drafts.set('one', 'saved')
console.log((await next).value?.kind)`,
  indexes: `import { createStorageHost } from '@migaia/storage-host'
import { indexedDbBackendPlugin } from '@migaia/storage-web/indexed-db'
import { indexedDbIndexesFeature } from '@migaia/storage-web/features/indexed-db-indexes'

await using host = await createStorageHost({ plugins: [indexedDbBackendPlugin(
  { dbName: 'indexed-orders' }, { indexes: indexedDbIndexesFeature() }
)] })
const orders = host.backend('indexed-db')
const handle = await orders.ensureRecordIndexes('orders', [
  { name: 'status', unique: false, multiEntry: false, revision: 1 }
])
console.log((await orders.getRecordIndexReadiness(handle)).status)`
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
