import type { IEnhancerDoc, IModuleDoc, ISymbolDoc, IText, ITypeDoc } from './contract.js'
import { storageHostNativeAuthorTypes } from './storage-host-native-authors.js'
import { storageHostChangeIteratorOptions } from './storage-host-authoring.js'

/** Keep each optional boundary's reader explanation beside its working assembly program. */
const t = (en: string, zh: string): IText => ({ en, zh })
/** Private logs need explicit runtime admission before an original backend opens a namespace. */
export const explicitJournalExample = `import { createStorageHost, memoryBackendPlugin } from '@migaia/storage-host'
import { storageJournalPlugin, storageLogStore } from '@migaia/storage-host/journal'

await using host = await createStorageHost({
  plugins: [storageJournalPlugin(), memoryBackendPlugin()]
})
await using history = await storageLogStore(host, 'memory', { prefix: 'orders' })
await history.append([{ kind: 'order.saved', payload: { id: 'one' } }])
console.log(await history.lastSeq())`
/** A notification-only memory backend exposes subscriptions without allocating feed iterators. */
const memoryNotificationsExample = `import { createStorageHost, memoryBackendPlugin } from '@migaia/storage-host'
import { memoryNotificationsFeature } from '@migaia/storage-host/features/memory-notifications'

await using host = await createStorageHost({ plugins: [memoryBackendPlugin(undefined, {
  notifications: memoryNotificationsFeature()
})] })
const memory = host.backend('memory')
const release = memory.subscribeChanges(change => console.log(change.kind))
await memory.set('draft', 'saved')
release()`
/** Iterator ownership remains independent from the notification producer it consumes. */
const memoryFeedExample = `import { createStorageHost, memoryBackendPlugin } from '@migaia/storage-host'
import { memoryNotificationsFeature } from '@migaia/storage-host/features/memory-notifications'
import { memoryChangeFeedFeature } from '@migaia/storage-host/features/memory-change-feed'

await using host = await createStorageHost({ plugins: [memoryBackendPlugin(undefined, {
  notifications: memoryNotificationsFeature(), changeFeed: memoryChangeFeedFeature()
})] })
const memory = host.backend('memory')
await using changes = memory.watch('draft')
const next = changes.next()
await memory.set('draft', 'saved')
console.log((await next).value?.kind)`
/** Backend authors can choose physical admission and cleanup without notification allocation. */
const lifecycleExample = `import { createBackendLifecycleController } from '@migaia/storage-host/authoring/change-controller'

const lifecycle = createBackendLifecycleController({ backend: 'application-cache' })
const release = lifecycle.beginMutation()
const closed = lifecycle.dispose()
release()
await closed`
/** The explicit notification factory composes the same physical lifecycle with one event channel. */
const controllerExample = `import { createBackendChangeController } from '@migaia/storage-host/authoring/change-controller'

const controller = createBackendChangeController({ backend: 'application-cache' })
const release = controller.subscribe(change => console.log(change.kind))
controller.publish({
  orgId: '00000000-0000-0000-0000-000000000000',
  channel: 'value', kind: 'put', keys: ['draft']
})
release()
await controller.dispose()`
/** Entity examples assemble only operations exercised by their own business scenario. */
const entityExamples: Readonly<Record<string, string>> = {
  query: `import { createStorageHost, memoryBackendPlugin } from '@migaia/storage-host'
import { defineEntity } from '@migaia/storage-host/entity'
import { entityQueryFeature } from '@migaia/storage-host/entity/query'

const orders = defineEntity<{ id: string; status: string }>()({
  name: 'orders', key: 'id', features: [entityQueryFeature()]
})
await using host = await createStorageHost({ plugins: [memoryBackendPlugin()] })
const repository = orders.connect(host.backend('memory'))
await repository.put({ id: 'one', status: 'paid' })
console.log(await repository.query().where({ status: 'paid' }).all())`,
  indexes: `import { createStorageHost, memoryBackendPlugin } from '@migaia/storage-host'
import { defineEntity } from '@migaia/storage-host/entity'
import { entityQueryFeature } from '@migaia/storage-host/entity/query'
import { entityIndexesFeature } from '@migaia/storage-host/entity/indexes'

type IOrder = { id: string; status: string }
const orders = defineEntity<IOrder>()({
  name: 'orders', key: 'id', features: [entityQueryFeature(), entityIndexesFeature()],
  indexes: { status: { path: 'status' } }
})
await using host = await createStorageHost({ plugins: [memoryBackendPlugin()] })
const repository = orders.connect(host.backend('memory'))
await repository.put({ id: 'one', status: 'paid' })
console.log(await repository.query().index('status', 'paid').all())`,
  unique: `import { createStorageHost, memoryBackendPlugin } from '@migaia/storage-host'
import { defineEntity } from '@migaia/storage-host/entity'
import { entityIndexesFeature } from '@migaia/storage-host/entity/indexes'
import { entityUniqueFeature } from '@migaia/storage-host/entity/unique'

type IUser = { id: string; email: string }
const users = defineEntity<IUser>()({
  name: 'users', key: 'id', features: [entityIndexesFeature(), entityUniqueFeature()],
  indexes: { email: { path: 'email', unique: true } }
})
await using host = await createStorageHost({ plugins: [memoryBackendPlugin()] })
const repository = users.connect(host.backend('memory'))
await repository.put({ id: 'ada', email: 'ada@example.com' })
console.log(await repository.get('ada'))`,
  migration: `import { createStorageHost, memoryBackendPlugin } from '@migaia/storage-host'
import { defineEntity } from '@migaia/storage-host/entity'
import { entityMigrationFeature } from '@migaia/storage-host/entity/migration'

type IUser = { id: string; name: string }
await using host = await createStorageHost({ plugins: [memoryBackendPlugin()] })
const store = host.backend('memory')
await defineEntity<IUser>({ name: 'users', key: 'id' }).connect(store)
  .put({ id: 'ada', name: 'Ada' })
const users = defineEntity<IUser>()({
  name: 'users', key: 'id', version: 2,
  features: [entityMigrationFeature()], migrations: { 2: previous => previous }
}).connect(store)
await users.migrate()
console.log(await users.get('ada'))`,
  keyset: `import { createStorageHost, memoryBackendPlugin } from '@migaia/storage-host'
import { defineEntity } from '@migaia/storage-host/entity'
import { entityQueryFeature } from '@migaia/storage-host/entity/query'
import { entityKeysetFeature } from '@migaia/storage-host/entity/keyset'

const orders = defineEntity<{ id: string }>()({
  name: 'orders', key: 'id', features: [entityQueryFeature(), entityKeysetFeature()]
})
await using host = await createStorageHost({ plugins: [memoryBackendPlugin()] })
const repository = orders.connect(host.backend('memory'))
await repository.put({ id: 'one' })
await repository.put({ id: 'two' })
const first = await repository.query().page(1)
console.log(first.items)
if (first.next) console.log((await repository.query().after(first.next).page(1)).items)`
}
/** Each optional entity entry describes its own concrete work and omitted-call failure. */
const entityUnits = [
  [
    'query',
    'entityQueryFeature',
    'Add entity query, list and stream operations while reusing the canonical query executor.',
    '为实体装配查询、列表与流式读取，继续复用规范查询执行器。'
  ],
  [
    'indexes',
    'entityIndexesFeature',
    'Plan declared entity index sources and backfill through the backend owning those records.',
    '为已声明实体索引选择查询来源，并通过拥有记录的后端执行回填。'
  ],
  [
    'unique',
    'entityUniqueFeature',
    'Enforce unique projections through the original native record transaction or atomic text terminal.',
    '通过原生记录事务或原子文本终点维护唯一投影，冲突时拒绝写入。'
  ],
  [
    'migration',
    'entityMigrationFeature',
    'Apply contiguous entity envelope migrations and expose explicit persisted migration operations.',
    '执行连续实体版本迁移，并提供显式持久化迁移操作。'
  ],
  [
    'keyset',
    'entityKeysetFeature',
    'Enable bounded entity pages and continuation cursors on the original canonical query owner.',
    '在规范查询拥有者上启用有界实体分页与续读游标。'
  ]
] as const
/**
 * Ordinary Feature descriptions explain installation and behavior without adding a documentation
 * mechanism.
 */
function featureSymbol(purpose: IText, example: string): ISymbolDoc {
  return {
    role: 'enhancer',
    purpose,
    returns: t(
      'A Feature definition selected explicitly in its owning configuration; it does not open storage by itself.',
      '返回在所属配置中显式选择的特性定义，本身不打开存储。'
    ),
    example,
    exampleIntro: t(
      'Declare this optional capability before connecting or installing its owning backend.',
      '在连接实体或安装所属后端之前声明该可选能力。'
    ),
    exampleResult: t(
      'The example uses the selected capability and releases resources through the original host.',
      '示例调用所选能力，并通过原宿主释放资源。'
    )
  }
}
/** Feature guides use the same complete authored program as the first API example. */
function enhancer(target: string, summary: IText, example: string): IEnhancerDoc {
  return {
    kind: 'feature',
    target,
    summary,
    install: example,
    grants: [],
    behaviors: [summary],
    scenarios: [summary],
    example
  }
}
/** Host module descriptions keep all optional runtime owners outside the base entry. */
export const storageHostAssemblyModules: Readonly<Record<string, IModuleDoc>> = {
  'authoring/change-controller': {
    summary: t(
      'Choose createBackendLifecycleController for physical lifetime alone, or explicitly import createBackendChangeController for notifications.',
      '物理生命周期使用 `createBackendLifecycleController`，通知使用显式导入的 `createBackendChangeController`。'
    ),
    example: lifecycleExample
  },
  'authoring/change-iterator': {
    summary: t(
      'Build a change iterator only for an explicitly selected backend feed; import createBackendChangeIterator here.',
      '仅为显式选择的后端变更流创建迭代器，从此入口导入 `createBackendChangeIterator`。'
    ),
    example: memoryFeedExample
  },
  'features/memory-notifications': {
    summary: t(
      'Select memoryNotificationsFeature before backend construction to publish committed changes without enabling watch.',
      '在后端构造前选择 `memoryNotificationsFeature`，发布已提交变更但不启用 `watch`。'
    ),
    example: memoryNotificationsExample
  },
  'features/memory-change-feed': {
    summary: t(
      'Select memoryChangeFeedFeature together with notifications to enable cancellable memory watch iterators.',
      '选择 `memoryChangeFeedFeature` 并声明通知特性，启用可取消的内存变更迭代器。'
    ),
    example: memoryFeedExample
  },
  ...Object.fromEntries(
    entityUnits.map(([path, , en, zh]) => [
      `entity/${path}`,
      {
        summary: t(
          `${en} Omitted calls reject ENTITY_FEATURE_REQUIRED.`,
          `${zh} 未装配即调用会报 \`ENTITY_FEATURE_REQUIRED\`。`
        ),
        example: entityExamples[path]
      }
    ])
  )
}
/** Runtime symbols have concrete primary programs, including the absent-assembly contract. */
export const storageHostAssemblySymbols: Readonly<Record<string, ISymbolDoc>> = {
  storageJournalPlugin: featureSymbol(
    t(
      'Explicitly include journal runtime and private log storage, then install the plugin before backends in the same host batch. Journal options alone no longer load this code.',
      '显式引入日志运行时与私有日志存储，并在同一宿主批次内先于后端安装；仅配置日志选项不再自动加载实现。'
    ),
    explicitJournalExample
  ),
  memoryNotificationsFeature: featureSymbol(
    t(
      'Publish committed memory changes through subscribeChanges. The base memory backend has no notification channel; missing subscriptions reject CHANGE_CONTROLLER_NOT_ASSEMBLED.',
      '通过 `subscribeChanges` 发布已提交内存变更；基础内存后端没有通知通道，未装配即订阅会报 `CHANGE_CONTROLLER_NOT_ASSEMBLED`。'
    ),
    memoryNotificationsExample
  ),
  memoryChangeFeedFeature: featureSymbol(
    t(
      'Enable memory watch iterators after selecting notifications. The base reports changeFeed false and missing watch calls reject CHANGE_ITERATOR_NOT_ASSEMBLED.',
      '在显式选择通知后启用内存 `watch` 迭代器；基础后端声明变更流不可用，未装配即监听会报 `CHANGE_ITERATOR_NOT_ASSEMBLED`。'
    ),
    memoryFeedExample
  ),
  createBackendLifecycleController: {
    role: 'factory',
    purpose: t(
      'Construct physical liveness, mutation drain and idempotent finalization without a notification channel.',
      '构造物理存活检查、修改排空与幂等终结，不分配通知通道。'
    ),
    options: 'IBackendChangeControllerOptions',
    returns: t(
      'The original physical lifecycle controller with stable origin and construction snapshot.',
      '返回带稳定来源与构造快照的物理生命周期控制器。'
    ),
    example: lifecycleExample
  },
  createBackendChangeController: {
    role: 'factory',
    purpose: t(
      'Explicitly construct committed-change publication and subscriptions on the same physical lifecycle owner. Backend authors pass this factory to core.createChangeController.',
      '在同一物理生命周期拥有者上显式构造已提交变更发布与订阅；后端作者将此工厂传给 `core.createChangeController`。'
    ),
    options: 'IBackendChangeControllerOptions',
    returns: t(
      'A controller with the original event channel, physical admission and shared disposal completion.',
      '返回保留原事件通道、物理准入及共享关闭完成结果的控制器。'
    ),
    example: controllerExample
  },
  ...Object.fromEntries(
    entityUnits.map(([path, name, en, zh]) => [
      name,
      featureSymbol(
        t(
          `${en} Select it in defineEntity features; omitted calls reject ENTITY_FEATURE_REQUIRED.`,
          `${zh} 在 \`defineEntity\` 的特性列表中选择，缺失时调用会报 \`ENTITY_FEATURE_REQUIRED\`。`
        ),
        entityExamples[path]!
      )
    ])
  )
}
/** Returned Feature metadata remains opaque to applications, which select the public factory. */
export const storageHostAssemblyTypes: Readonly<Record<string, ITypeDoc>> = {
  IBackendLifecycleController: {
    ...storageHostNativeAuthorTypes.IBackendChangeController,
    summary: t(
      'Physical admission and cleanup without notification methods. Full and lightweight controllers share one same-realm origin allocator.',
      '只提供物理准入与清理，不包含通知方法；完整与轻量控制器共用同一运行域来源分配器。'
    ),
    example: lifecycleExample,
    members: Object.fromEntries(
      Object.entries(storageHostNativeAuthorTypes.IBackendChangeController.members).filter(
        ([name]) =>
          [
            'snapshot',
            'origin',
            'closingSignal',
            'assertLive',
            'beginMutation',
            'dispose'
          ].includes(name)
      )
    )
  },
  IBackendChangeControllerFactory: {
    summary: t(
      'Explicit backend-selected constructor for a notification controller; it is passed to the original installation port.',
      '由后端显式选择的通知控制器构造函数，传给原安装端口使用。'
    ),
    members: {},
    example: controllerExample
  },
  IBackendChangeIteratorOptions: {
    summary: t(
      'Fixed organization, channel and cancellation inputs captured for one explicitly selected change iterator.',
      '为一个显式选择的变更迭代器捕获固定组织、通道与取消输入。'
    ),
    members: storageHostChangeIteratorOptions
  },
  IEntityFeature: {
    summary: t(
      'A selected entity assembly definition returned by a public feature factory; each connection receives its own capability owner.',
      '由公开特性工厂返回的实体装配定义；每次连接获得自己的能力拥有者。'
    ),
    example: entityExamples.query,
    members: {
      name: {
        summary: t(
          'Stable capability name used in missing-assembly diagnostics.',
          '缺少装配时诊断使用的稳定能力名称。'
        )
      },
      create: {
        summary: t(
          'Called by the original repository when connecting the selected definition.',
          '连接所选定义时，由原仓储调用以创建对应能力。'
        ),
        params: {
          context: t(
            'Internal connected repository owner supplied by defineEntity; applications do not manufacture it.',
            '由 `defineEntity` 提供的内部已连接仓储拥有者，应用不自行构造。'
          )
        },
        returns: t(
          'Operations owned by this capability on the same repository.',
          '返回同一仓储上由此能力拥有的操作。'
        ),
        example: entityExamples.query
      },
      configure: {
        summary: t(
          'Optional definition-time admission of that capability configuration.',
          '可选的定义阶段准入，只处理本能力配置。'
        ),
        params: {
          options: t(
            'Original entity options supplied to defineEntity by the application.',
            '应用交给 `defineEntity` 的原实体选项。'
          )
        },
        returns: t(
          'Captured optional configuration without opening a backend.',
          '返回捕获的可选配置，不打开后端。'
        ),
        example: entityExamples.migration
      }
    }
  }
}
/** Installing Features changes the existing owner instead of adding facade APIs. */
export const storageHostAssemblyEnhancers: Readonly<Record<string, IEnhancerDoc>> = {
  storageJournalPlugin: {
    ...enhancer(
      'IStorageHost',
      storageHostAssemblySymbols.storageJournalPlugin!.purpose,
      explicitJournalExample
    ),
    kind: 'plugin'
  },
  memoryNotificationsFeature: enhancer(
    'IMemoryBackendStore',
    storageHostAssemblySymbols.memoryNotificationsFeature!.purpose,
    memoryNotificationsExample
  ),
  memoryChangeFeedFeature: enhancer(
    'IMemoryBackendStore',
    storageHostAssemblySymbols.memoryChangeFeedFeature!.purpose,
    memoryFeedExample
  ),
  ...Object.fromEntries(
    entityUnits.map(([path, name]) => [
      name,
      enhancer(
        'IEntityDefinition',
        storageHostAssemblySymbols[name]!.purpose,
        entityExamples[path]!
      )
    ])
  )
}
