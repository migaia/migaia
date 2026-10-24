import type { IEnhancerDoc, IModuleDoc, ISymbolDoc, IText, ITypeDoc } from './contract.js'
import { storageHostNativeAuthorTypes } from './storage-host-native-authors.js'
import { storageHostChangeIteratorOptions } from './storage-host-authoring.js'

/** Keep each optional boundary's reader explanation beside its working assembly program. */
const t = (en: string, zh: string): IText => ({ en, zh })
/** Private logs need explicit runtime admission before an original backend opens a namespace. */
export const explicitJournalExample =
  "import { createStorageHost, memoryBackendPlugin } from '@migaia/storage-host'\nimport { storageJournalPlugin, storageLogStore } from '@migaia/storage-host/journal'\n\nawait using host = await createStorageHost({\n  plugins: [storageJournalPlugin(), memoryBackendPlugin()],\n})\nawait using history = await storageLogStore(host, 'memory', { prefix: 'orders' })\nawait history.append([{ kind: 'order.saved', payload: { id: 'one' } }])\nconsole.log(await history.lastSeq())"
/** A notification-only memory backend exposes subscriptions without allocating feed iterators. */
const memoryNotificationsExample =
  "import { createStorageHost, memoryBackendPlugin } from '@migaia/storage-host'\nimport { memoryNotificationsFeature } from '@migaia/storage-host/features/memory-notifications'\n\nawait using host = await createStorageHost({\n  plugins: [\n    memoryBackendPlugin(undefined, {\n      notifications: memoryNotificationsFeature(),\n    }),\n  ],\n})\nconst memory = host.backend('memory')\nconst release = memory.subscribeChanges((change) => console.log(change.kind))\nawait memory.set('draft', 'saved')\nrelease()"
/** Iterator ownership remains independent from the notification producer it consumes. */
const memoryFeedExample =
  "import { createStorageHost, memoryBackendPlugin } from '@migaia/storage-host'\nimport { memoryNotificationsFeature } from '@migaia/storage-host/features/memory-notifications'\nimport { memoryChangeFeedFeature } from '@migaia/storage-host/features/memory-change-feed'\n\nawait using host = await createStorageHost({\n  plugins: [\n    memoryBackendPlugin(undefined, {\n      notifications: memoryNotificationsFeature(),\n      changeFeed: memoryChangeFeedFeature(),\n    }),\n  ],\n})\nconst memory = host.backend('memory')\nawait using changes = memory.watch('draft')\nconst next = changes.next()\nawait memory.set('draft', 'saved')\nconsole.log((await next).value?.kind)"
/** Backend authors can choose physical admission and cleanup without notification allocation. */
const lifecycleExample =
  "import { createBackendLifecycleController } from '@migaia/storage-host/authoring/change-controller'\n\nconst lifecycle = createBackendLifecycleController({\n  backend: 'application-cache',\n  platform: { label: 'local' },\n  options: { namespace: 'drafts' },\n  origin: 'application-cache:one',\n  finalize: () => console.log('closed'),\n})\nconst release = lifecycle.beginMutation()\nconst closed = lifecycle.dispose()\nrelease()\nawait closed"
/** The explicit notification factory composes the same physical lifecycle with one event channel. */
const controllerExample =
  "import { createBackendChangeController } from '@migaia/storage-host/authoring/change-controller'\n\nconst controller = createBackendChangeController({\n  backend: 'application-cache',\n  platform: { label: 'local' },\n  options: { namespace: 'drafts' },\n  origin: 'application-cache:one',\n  finalize: () => console.log('closed'),\n})\nconst release = controller.subscribe((change) => console.log(change.kind))\ncontroller.publish({\n  orgId: '00000000-0000-0000-0000-000000000000',\n  channel: 'value',\n  kind: 'put',\n  keys: ['draft'],\n})\nrelease()\nawait controller.dispose()"
/** Entity examples assemble only operations exercised by their own business scenario. */
const entityExamples: Readonly<Record<string, string>> = {
  query:
    "import { createStorageHost, memoryBackendPlugin } from '@migaia/storage-host'\nimport { defineEntity } from '@migaia/storage-host/entity'\nimport { entityQueryFeature } from '@migaia/storage-host/entity/query'\n\nconst orders = defineEntity<{ id: string; status: string }>()({\n  name: 'orders',\n  key: 'id',\n  features: [entityQueryFeature()],\n})\nawait using host = await createStorageHost({ plugins: [memoryBackendPlugin()] })\nconst repository = orders.connect(host.backend('memory'))\nawait repository.put({ id: 'one', status: 'paid' })\nconsole.log(await repository.query().where({ status: 'paid' }).all())",
  indexes:
    "import { createStorageHost, memoryBackendPlugin } from '@migaia/storage-host'\nimport { defineEntity } from '@migaia/storage-host/entity'\nimport { entityQueryFeature } from '@migaia/storage-host/entity/query'\nimport { entityIndexesFeature } from '@migaia/storage-host/entity/indexes'\n\ntype IOrder = { id: string; status: string }\nconst orders = defineEntity<IOrder>()({\n  name: 'orders',\n  key: 'id',\n  features: [entityQueryFeature(), entityIndexesFeature()],\n  indexes: { status: { path: 'status' } },\n})\nawait using host = await createStorageHost({ plugins: [memoryBackendPlugin()] })\nconst repository = orders.connect(host.backend('memory'))\nawait repository.put({ id: 'one', status: 'paid' })\nconsole.log(await repository.query().index('status', 'paid').all())",
  unique:
    "import { createStorageHost, memoryBackendPlugin } from '@migaia/storage-host'\nimport { defineEntity } from '@migaia/storage-host/entity'\nimport { entityUniqueFeature } from '@migaia/storage-host/entity/unique'\n\ntype IUser = { id: string; email: string }\nconst users = defineEntity<IUser>()({\n  name: 'users',\n  key: 'id',\n  features: [entityUniqueFeature()],\n  indexes: { email: { path: 'email', unique: true } },\n})\nawait using host = await createStorageHost({ plugins: [memoryBackendPlugin()] })\nconst repository = users.connect(host.backend('memory'))\nawait repository.put({ id: 'ada', email: 'ada@example.com' })\nconsole.log(await repository.get('ada'))",
  migration:
    "import { createStorageHost, memoryBackendPlugin } from '@migaia/storage-host'\nimport { defineEntity } from '@migaia/storage-host/entity'\nimport { entityMigrationFeature } from '@migaia/storage-host/entity/migration'\n\ntype IUser = { id: string; name: string }\nawait using host = await createStorageHost({ plugins: [memoryBackendPlugin()] })\nconst store = host.backend('memory')\nawait defineEntity<IUser>({ name: 'users', key: 'id' })\n  .connect(store)\n  .put({ id: 'ada', name: 'Ada' })\nconst users = defineEntity<IUser>()({\n  name: 'users',\n  key: 'id',\n  version: 2,\n  features: [entityMigrationFeature()],\n  migrations: { 2: (previous) => previous },\n}).connect(store)\nawait users.migrate()\nconsole.log(await users.get('ada'))",
  keyset:
    "import { createStorageHost, memoryBackendPlugin } from '@migaia/storage-host'\nimport { defineEntity } from '@migaia/storage-host/entity'\nimport { entityQueryFeature } from '@migaia/storage-host/entity/query'\nimport { entityKeysetFeature } from '@migaia/storage-host/entity/keyset'\n\nconst orders = defineEntity<{ id: string }>()({\n  name: 'orders',\n  key: 'id',\n  features: [entityQueryFeature(), entityKeysetFeature()],\n})\nawait using host = await createStorageHost({ plugins: [memoryBackendPlugin()] })\nconst repository = orders.connect(host.backend('memory'))\nawait repository.put({ id: 'one' })\nawait repository.put({ id: 'two' })\nconst first = await repository.query().page(1)\nconsole.log(first.items)\nif (first.next) console.log((await repository.query().after(first.next).page(1)).items)"
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
      '物理资源的准入、排空与清理使用 `createBackendLifecycleController`，需要发布已提交变更时才显式导入 `createBackendChangeController`。'
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
      '在内存后端构造前选择 `memoryNotificationsFeature`，让订阅者接收已提交变更；此选择本身不启用监听迭代器。'
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
    params: {
      input: t(
        'Backend construction facts supplied by the physical owner, including its original finalizer.',
        '由物理拥有者提供的后端构造事实，包括原清理回调。'
      )
    },
    optionCases: [
      {
        title: t('Retain physical lifetime and identity', '保留物理生命周期与身份'),
        problem: t(
          'Drain accepted mutations while retaining the caller-selected native snapshot.',
          '排空已接受修改，并保留调用方选择的原生构造快照。'
        ),
        covers: ['backend', 'platform', 'options', 'origin', 'finalize'],
        example: lifecycleExample,
        result: t(
          'The original finalizer runs once after accepted work drains.',
          '已接受工作排空后，原清理回调只执行一次。'
        )
      }
    ],
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
    params: {
      input: t(
        'Backend construction facts supplied by the physical owner, including its original finalizer.',
        '由物理拥有者提供的后端构造事实，包括原清理回调。'
      )
    },
    optionCases: [
      {
        title: t('Retain notification origin and cleanup', '保留通知来源与清理语义'),
        problem: t(
          'Publish committed changes while retaining the caller-selected native snapshot.',
          '发布已提交变更，并保留调用方选择的原生构造快照。'
        ),
        covers: ['backend', 'platform', 'options', 'origin', 'finalize'],
        example: controllerExample,
        result: t(
          'Publications retain the selected origin and cleanup runs once.',
          '发布保留所选来源，原生清理只执行一次。'
        )
      }
    ],
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
  IEntityKeysetOwner: {
    summary: t(
      'The selected keyset assembly delegates bounded page work to the original query owner.',
      '所选分页装配将有界页面工作交给原查询拥有者执行。'
    ),
    scenarios: [
      t('Continue an entity page using its existing cursor.', '使用已有游标继续读取实体分页。')
    ],
    example: entityExamples.keyset,
    members: {
      run: {
        summary: t(
          'Invoke the admitted page operation without replacing its cursor or failure.',
          '调用已准入的原分页操作，不替换其游标或失败。'
        ),
        params: {
          invoke: t(
            'Original query operation supplied by the connected repository.',
            '已连接仓储提供的原查询操作。'
          )
        },
        returns: t('The exact result of the original operation.', '返回该原操作的准确结果。'),
        example: entityExamples.keyset
      }
    }
  },
  IEntityFeature: {
    scenarios: [
      t(
        'Select optional operations before connecting a reusable entity definition.',
        '连接可复用实体定义之前，选择实际需要的可选操作。'
      )
    ],
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
