import {
  storageWebAssemblyModules,
  storageWebAssemblySymbols,
  storageWebAssemblyTypes,
  storageWebAssemblyEnhancers
} from './storage-web-assembly.js'
/** Browser backend reference. Neutral host/entity contracts live in storage-host. */
import { storageContractReference } from './storage-contract.js'
import { storageWebCases } from './storage-web-cases.js'
import type {
  IEnhancerDoc,
  ILibraryReference,
  IMemberDoc,
  IOptionCaseDoc,
  ISymbolDoc,
  IText,
  ITypeDoc
} from './contract.js'

/** Keep both reader locales beside the same public API contract. */
const t = (en: string, zh: string): IText => ({ en, zh })
/** Describe pure external-owner refinements without manufacturing a local runtime contract. */
const alias = (en: string, zh: string): ITypeDoc => ({ summary: t(en, zh), members: {} })

/** A real targeted Feature attaches application methods to the original installed store. */
export const storageFeatureExample = `import {
  createStorageHost, defineFeature, memoryBackendKind, memoryBackendPlugin
} from '@migaia/storage-host'
import { kv } from '@migaia/storage-contract'

const metrics = defineFeature(memoryBackendKind, ({ featureExpose }) => ({
  capabilities: [],
  chain: {},
  api: {
    store: {
      async count() { return (await this.store.use(kv).keys()).length },
      backendId: () => featureExpose.getBackendId()
    },
    transaction: {}
  }
}))
const host = await createStorageHost({
  plugins: [memoryBackendPlugin({ id: 'cache' }, { metrics })]
})
try {
  const cache = host.backend('cache')
  await cache.set('user:1', JSON.stringify({ name: 'Ada' }))
  console.log(await cache.api.count(), cache.api.backendId())
} finally {
  await host.dispose()
}`

/** Native Blob requests share the same actual record transaction and original host cleanup. */
const blobExample =
  "import { createStorageHost } from '@migaia/storage-host'\nimport { indexedDbBackendPlugin } from '@migaia/storage-web/indexed-db'\nimport { indexedDbBlobFeature } from '@migaia/storage-web/features/blobs'\n\nconst host = await createStorageHost({\n  plugins: [\n    indexedDbBackendPlugin(\n      { dbName: 'attachments' },\n      { blobs: indexedDbBlobFeature() },\n    ),\n  ],\n})\ntry {\n  const store = host.backend('indexed-db')\n  await store.transaction(async (scope) => {\n    await scope.api.blobs.put(\n      'avatar',\n      new Blob(['avatar bytes'], { type: 'text/plain' }),\n    )\n    await scope.putRecord({ attachment: 'avatar' }, 'profile')\n  })\n  console.log(await (await store.api.blobs.get('avatar'))?.text())\n} finally {\n  await host.dispose()\n}"

/** Backend definitions provide installation recipes rather than independently owned stores. */
const backends = [
  [
    'local-storage',
    'localStorageBackendPlugin',
    'localStorageBackendKind',
    'local',
    'ILocalStorageOptions',
    'ILocalStorageBackendStore'
  ],
  [
    'session-storage',
    'sessionStorageBackendPlugin',
    'sessionStorageBackendKind',
    'session',
    'ISessionStorageOptions',
    'ISessionStorageBackendStore'
  ],
  [
    'cookies',
    'cookieBackendPlugin',
    'cookieBackendKind',
    'cookies',
    'ICookiesOptions',
    'ICookieBackendStore'
  ],
  [
    'indexed-db',
    'indexedDbBackendPlugin',
    'indexedDbBackendKind',
    'indexed-db',
    'IIndexedDbOptions',
    'IIndexedDbBackendStore'
  ]
] as const

/** Each example installs the actual native backend and closes its original owning host. */
const hostExample = (module: string, plugin: string, id: string, options = ''): string =>
  `import { createStorageHost } from '@migaia/storage-host'
import { ${plugin} } from '@migaia/storage-web/${module}'

const host = await createStorageHost({
  plugins: [${plugin}({
    ${options.trim()}
  })]
})
try {
  const store = host.backend('${id}')
  await store.set('theme', 'dark')
  console.log(await store.get('theme'))
} finally {
  await host.dispose()
}`

/** Text transactions share the selected original WAL, rather than an independent pending cache. */
const redoExample = (
  module: string,
  plugin: string,
  id: string
): string => `import { Logger } from '@migaia/logger'
import { memoryLogStore, wal } from '@migaia/logger/plugins/durable'
import { createStorageHost } from '@migaia/storage-host'
import { storageJournalPlugin } from '@migaia/storage-host/journal'
import { ${plugin} } from '@migaia/storage-web/${module}'

const logger = new Logger({
  execution: { mutationTimeoutMs: 5000, pipelineDrainTimeoutMs: 1000 },
  plugins: [wal({ store: memoryLogStore() })]
})
const host = await createStorageHost({
  plugins: [storageJournalPlugin(), ${plugin}({ redo: true })],
  journal: { logger, namespace: 'history', redoWal: logger.wal }
})
try {
  await host.backend('${id}').transaction(async (scope) => {
    await scope.set('theme', 'dark')
    await scope.set('locale', 'en')
  })
} finally {
  await host.dispose()
  await logger.shutdown('manual')
}`

/** Live queries add no host facade and retain the caller's Runtime ownership. */
const liveExample =
  "import { indexedDbNotificationsFeature } from '@migaia/storage-web/features/indexed-db-notifications'\nimport { createRuntime } from '@migaia/reactive'\nimport { records } from '@migaia/storage-contract'\nimport { createStorageHost } from '@migaia/storage-host'\nimport {\n  indexedDbBackendPlugin,\n  indexedDbBackendKind,\n} from '@migaia/storage-web/indexed-db'\nimport { reactiveFeature } from '@migaia/storage-web/features/reactive'\n\nconst runtime = createRuntime()\nconst host = await createStorageHost({\n  plugins: [\n    indexedDbBackendPlugin(\n      { dbName: 'users' },\n      {\n        notifications: indexedDbNotificationsFeature(),\n        reactive: reactiveFeature(indexedDbBackendKind),\n      },\n    ),\n  ],\n})\ntry {\n  const query = host.backend('indexed-db').use(records).query().live({ runtime })\n  try {\n    await query.ready\n    console.log(query.state.value)\n  } finally {\n    await query.dispose()\n  }\n} finally {\n  await host.dispose()\n}"

/** Explain browser-specific options, leaving native host/context contracts with their owners. */
const webStorageFields = (storage: string): Readonly<Record<string, IMemberDoc>> => ({
  namespace: {
    summary: t('Logical namespace owned by this backend.', '该后端拥有的逻辑命名空间。'),
    default: t('`default`.', '省略时采用 `default`。')
  },
  redo: {
    summary: t(
      'Explicitly enables WAL-backed text transactions; requires native Web Locks and the selected original WAL object.',
      '显式启用 WAL 文本事务；要求原生 Web Locks 与选定的原 WAL 对象。'
    ),
    default: t('Omitted; transactions remain disabled.', '省略时不启用事务。'),
    whenToUse: t(
      'All participating hosts must borrow one actual latest-pending WAL object. Matching names or independent caches do not establish cross-page recovery. Undo and raw native Feature clients are unavailable in this selected combination. While this instance has an active draft, root calls reject WRITE_CONFLICT even with wait policy; use its scope. Other instances retain native lock waiting.',
      '所有参与宿主必须借用同一个可见最新 pending 的真实 WAL 对象；同名或独立缓存不能证明跨页恢复。该组合不提供 undo 或 raw 原生 Feature 客户端。同实例 draft 活跃时根调用即使选择 wait 也报 WRITE_CONFLICT，须使用 scope；其它实例仍沿原生锁等待。'
    )
  },
  namespaceCodec: {
    summary: t(
      'Encodes and decodes physical keys without touching foreign namespaces.',
      '编码与解码物理键，跳过其他命名空间。'
    ),
    default: t('`lengthPrefixedNamespaceCodec`.', '省略时采用 `lengthPrefixedNamespaceCodec`。'),
    whenToUse: t(
      'Keep the default unless migrating an existing key layout.',
      '默认布局满足需求时保持不变，仅迁移既有键布局时替换。'
    ),
    example: `import { lengthPrefixedNamespaceCodec } from '@migaia/storage-web'
${hostExample(
  storage === 'localStorage' ? 'local-storage' : 'session-storage',
  storage === 'localStorage' ? 'localStorageBackendPlugin' : 'sessionStorageBackendPlugin',
  storage === 'localStorage' ? 'local' : 'session',
  ' namespaceCodec: lengthPrefixedNamespaceCodec '
)}`
  },
  storage: {
    summary: t(
      'Borrow the native Storage port; disposal does not erase its data.',
      '借用原生存储端口，释放不清空其数据。'
    ),
    default: t(`\`globalThis.${storage}\`.`, `省略时采用 \`globalThis.${storage}\`。`)
  }
})

/** Small option cases keep native layout separate from installation identity. */
const optionCases = (module: string, plugin: string, id: string): readonly IOptionCaseDoc[] => [
  {
    title: t('Choose the native data layout', '选择原生数据布局'),
    problem: t(
      'Keep this application separate from other browser data.',
      '让当前应用与其他浏览器数据隔离。'
    ),
    covers:
      module === 'indexed-db'
        ? ['dbName', 'kvStoreName', 'bytesStoreName', 'recordsStoreName']
        : module === 'cookies'
          ? ['namespace', 'scope', 'document']
          : ['namespace', 'storage'],
    example: hostExample(
      module,
      plugin,
      id,
      module === 'indexed-db'
        ? " dbName: 'editor', kvStoreName: 'values', bytesStoreName: 'files', recordsStoreName: 'rows' "
        : module === 'cookies'
          ? " namespace: 'editor', scope: { path: '/' }, document "
          : ` namespace: 'editor', storage: window.${module === 'local-storage' ? 'localStorage' : 'sessionStorage'} `
    ),
    result: t(
      'Reads and writes use the selected native layout until the host closes.',
      '宿主关闭前，读写始终使用所选原生布局。'
    )
  },
  ...(module === 'indexed-db'
    ? []
    : [
        {
          title: t('Select recoverable text drafts', '选择可恢复的文本事务草稿'),
          problem: t(
            'Commit multiple visible text values through one original WAL owner.',
            '通过同一个原始预写日志拥有者提交多个可见文本值。'
          ),
          covers: ['redo'],
          example: redoExample(module, plugin, id),
          result: t(
            'The draft applies only after its complete WAL intent has been retained.',
            '仅在完整写入意图已由预写日志保存后，才应用事务草稿。'
          )
        }
      ])
]

/** Native IndexedDB options remain exact inputs to its one preparation path. */
const indexedDbFields: Readonly<Record<string, IMemberDoc>> = {
  journalFactoryIsPrivate: {
    summary: t(
      'Explicit true only for an injected factory confined to this realm; it retains the original cached path. Without this declaration or native Web Locks, indexExclusive:false selects current native reads per operation without a cross-operation index.',
      '仅为数据宇宙局限当前 realm 的真实私有 factory 显式声明 true，保留原缓存路径；缺少该声明与原生 Web Locks 时，以 indexExclusive:false 在每操作原生事务中现读，不跨操作缓存。'
    ),
    default: t(
      'Omitted: no private data universe is asserted.',
      '省略时不声明工厂拥有私有数据域。'
    ),
    whenToUse: t(
      'Use only when the injected factory actually creates an isolated realm-local database universe.',
      '仅在注入工厂确实创建当前运行环境内的独立数据库域时使用。'
    ),
    example: `import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
${hostExample('indexed-db', 'indexedDbBackendPlugin', 'indexed-db', 'factory: new IDBFactory(), keyRange: IDBKeyRange, journalFactoryIsPrivate: true')}`
  },
  dbName: {
    summary: t('Database name used by this installation.', '本次安装使用的数据库名称。'),
    default: t('`storage-web`.', '省略时采用 `storage-web`。')
  },
  kvStoreName: {
    summary: t('Native text object store name.', '原生文本对象存储名称。'),
    default: t('`kv`.', '省略时采用 `kv`。')
  },
  bytesStoreName: {
    summary: t('Native byte object store name.', '原生字节对象存储名称。'),
    default: t('`bytes`.', '省略时采用 `bytes`。')
  },
  recordsStoreName: {
    summary: t('Native authoritative record object store name.', '原生权威记录对象存储名称。'),
    default: t('`records`.', '省略时采用 `records`。')
  },
  cleanupLegacyRecords: {
    summary: t(
      'Delete the old documents store only after migration completes.',
      '仅在迁移完成后删除旧文档存储。'
    ),
    default: t('`false`.', '省略时采用 `false`。'),
    example: hostExample(
      'indexed-db',
      'indexedDbBackendPlugin',
      'indexed-db',
      ' cleanupLegacyRecords: true '
    )
  },
  factory: {
    summary: t(
      'Borrow an IndexedDB factory and retain its matching keyRange constructor.',
      '借用索引数据库工厂，并提供对应的 `keyRange` 构造器。'
    ),
    default: t('`globalThis.indexedDB`.', '省略时采用 `globalThis.indexedDB`。'),
    example: hostExample(
      'indexed-db',
      'indexedDbBackendPlugin',
      'indexed-db',
      ' factory: window.indexedDB, keyRange: window.IDBKeyRange '
    )
  },
  keyRange: {
    summary: t(
      'Native IDBKeyRange implementation belonging to the supplied factory.',
      '与所提供工厂对应的原生键范围实现。'
    ),
    default: t('`globalThis.IDBKeyRange`.', '省略时采用 `globalThis.IDBKeyRange`。'),
    example: hostExample(
      'indexed-db',
      'indexedDbBackendPlugin',
      'indexed-db',
      ' factory: window.indexedDB, keyRange: window.IDBKeyRange '
    )
  },
  owner: {
    summary: t(
      'Optional human-readable label in lock diagnostics; never an identity.',
      '锁诊断中可选的可读标签，不作为身份。'
    ),
    default: t('The browser label.', '默认浏览器标签。'),
    example: hostExample(
      'indexed-db',
      'indexedDbBackendPlugin',
      'indexed-db',
      " owner: { label: 'editor-tab' } "
    )
  }
}

/** A fixed Cookie scope is reused for writes and removals. */
const cookieFields: Readonly<Record<string, IMemberDoc>> = {
  redo: {
    summary: t(
      'Selects visible-cookie WAL drafts through the original text transaction owner.',
      '通过原文本事务拥有者选择可见 Cookie WAL draft。'
    ),
    default: t('Omitted; ordinary cookie semantics remain.', '省略时保持普通 Cookie 语义。'),
    whenToUse: t(
      'Requires native Web Locks and the exact selected original WAL shared by every participant. maxAge resolves to one absolute expiry before WAL begin; replay never renews it. Root calls while this instance has an active draft reject WRITE_CONFLICT even with wait policy; use its scope.',
      '要求原生 Web Locks 及所有参与者共享的选定原 WAL；maxAge 在 WAL begin 前解析为绝对期限，重放不续期。同实例 draft 活跃时根调用即使选择 wait 也报 WRITE_CONFLICT，须使用 scope。'
    )
  },
  namespace: webStorageFields('localStorage').namespace!,
  namespaceCodec: webStorageFields('localStorage').namespaceCodec!,
  document: {
    summary: t('Borrow the JS-visible document.cookie port.', '借用脚本可见的 Cookie 文档端口。'),
    default: t('`globalThis.document`.', '省略时采用 `globalThis.document`。')
  },
  scope: {
    summary: t(
      'Fixed path/domain/SameSite/Secure/Partitioned attributes; secure is required for none or partitioned.',
      '固定的路径、域名、同站点、安全与分区属性；不限制同站点或启用分区时必须安全传输。'
    ),
    default: t(
      'Omitted: no explicit scope attributes; browser default path applies.',
      '省略时不追加显式作用域属性，由浏览器使用默认路径。'
    )
  }
}

/** Browser plugin symbols and kind identities share the same real installation examples. */
const backendSymbols: Readonly<Record<string, ISymbolDoc>> = Object.fromEntries(
  backends.flatMap(([module, plugin, kind, id, options]) => [
    [
      plugin,
      {
        role: 'enhancer',
        options,
        optionDocs: {
          id: {
            summary: t(
              'Exact host registration identity supplied by the application; select this name with host.backend().',
              '由应用指定的精确宿主注册标识，通过宿主后端方法按该标识获取存储。'
            ),
            default: t(
              `Omitted: use the native registration name ${id}.`,
              `省略时使用原生注册名称 ${id}。`
            ),
            example: hostExample(module, plugin, 'preferences', "id: 'preferences'")
          },
          ...(module === 'indexed-db'
            ? {
                'owner.label': {
                  summary: t(
                    'Caller-selected readable label shown in lock diagnostics, never an authority token.',
                    '由调用方选择并显示在锁诊断中的可读标签，不表示操作权限或锁身份。'
                  ),
                  default: t(
                    'Omitted: the original browser label remains.',
                    '省略时保留原浏览器标签。'
                  ),
                  example: hostExample(module, plugin, id, "owner: { label: 'editor-tab' }")
                }
              }
            : {})
        },
        purpose: t(
          `Install the native ${module} backend into storage-host. Preparation finishes before publication; the host owns cleanup.${module === 'indexed-db' ? ' The base provides text, bytes, records and transactions. Select TTL, batch, journal, notifications, change feed and secondary indexes explicitly before opening. Organization dbName mapping preserves the configured default and adds "/" + orgId otherwise. dropOrg drains and closes the target connection, deletes only that database, and keeps borrowed views reusable.' : ' Native localStorage watch requires its matching Window event source; injected ports alone retain changeFeed:false. Text organization views preserve the configured default namespace and use namespace + "/" + orgId otherwise; dropOrg clears only that target and keeps borrowed unique writes native.'}`,
          `把原生浏览器后端安装到 \`@migaia/storage-host\`，准备完成后才发布，由宿主拥有清理责任。${module === 'indexed-db' ? '基础后端提供文本、字节、记录与事务；期限、批量、日志、通知、变更流与次级索引须在打开前显式选择对应特性。组织 dbName 保留配置的缺省目标，其它组织追加"/" + orgId；dropOrg 排空并关闭目标连接，只删除该数据库，既有借用视图可复用。' : '原生localStorage watch须准入同Window事件源，单独注入端口仍changeFeed:false。文本组织视图保留配置的缺省namespace，其它组织使用namespace + "/" + orgId；dropOrg只清该目标，借用唯一写仍由原生拥有者完成。'}`
        ),
        params: {
          options: t(
            'Native backend options and optional host registration id.',
            '原生后端选项及可选宿主注册标识。'
          ),
          features: t(
            'Optional Feature record as the second argument; each installation gets its own output.',
            '第二参数为可选特性记录，每次安装拥有独立输出。'
          )
        },
        returns: t(
          'A typed plugin definition; calling it opens no native resource.',
          '返回类型化插件定义，调用本身不打开原生资源。'
        ),
        example: hostExample(module, plugin, id),
        cases: storageWebCases[plugin]
      } satisfies ISymbolDoc
    ],
    [
      kind,
      {
        role: 'constant',
        purpose: t(
          `Opaque identity for targeting Features at ${plugin}; labels do not authorize a backend.`,
          `为 \`${plugin}\` 选择特性目标的不透明身份，文本标签不授予后端权限。`
        ),
        example: `import { ${kind} } from '@migaia/storage-web/${module}'
import { reactiveFeature } from '@migaia/storage-web/features/reactive'
const reactive = reactiveFeature(${kind})`
      } satisfies ISymbolDoc
    ]
  ])
)

/** Installation grants the precise backend at its declared host registration id. */
const backendEnhancers: Readonly<Record<string, IEnhancerDoc>> = Object.fromEntries(
  backends.map(([module, plugin, , id]) => [
    plugin,
    {
      kind: 'plugin',
      target: 'IStorageHost',
      summary: t(
        'Adds the selected native store under its exact id; no default backend is implied.',
        '按精确标识增加选定原生存储，不隐含缺省后端。'
      ),
      install: hostExample(module, plugin, id),
      example: hostExample(module, plugin, id),
      scenarios: [
        t(
          'Use one browser persistence mechanism with host-owned cleanup.',
          '使用一种浏览器持久化机制，并由宿主拥有清理。'
        )
      ],
      grants: [
        {
          signature: `host.backend('${id}')`,
          summary: t('Return the actual installed native backend.', '返回实际已安装原生后端。'),
          params: { id: t('The id supplied to this backend plugin.', '传给该后端插件的标识。') },
          returns: t(
            'The precise store, sealed after its owner closes.',
            '精确存储，所有者关闭后封闭准入。'
          ),
          example: hostExample(module, plugin, id)
        }
      ]
    } satisfies IEnhancerDoc
  ])
)

/** Full live options and the chain subset describe the same original Resource generation fields. */
const liveQueryMembers: Readonly<Record<string, IMemberDoc>> = {
  runtime: {
    summary: t(
      'The caller Runtime created by createRuntime().',
      '调用者通过 `createRuntime()` 创建的运行时。'
    )
  },
  scope: {
    summary: t('Optional logical change scope.', '可选逻辑变化范围，用于排除已知无关的失效提示。'),
    default: t('No scope filter.', '默认不按范围过滤。')
  },
  matches: {
    summary: t(
      'Filter actual changes; throws report and conservatively refresh.',
      '过滤实际变化，抛错时报告并保守刷新。'
    ),
    default: t('No predicate.', '默认无谓词。')
  },
  keepPreviousData: {
    summary: t('Retain the last value while refreshing.', '重新读取进行期间保留最近一次可用结果。'),
    default: t('`true`.', '省略时采用 `true`。')
  },
  equals: {
    summary: t(
      'Suppress replacement for equivalent settled results.',
      '结果等价时抑制可见值替换。'
    ),
    default: t('No suppression.', '默认不抑制。')
  },
  timeoutMs: {
    summary: t(
      'Optional deadline per query generation.',
      '每一代实际查询操作单独采用的可选毫秒期限。'
    ),
    default: t('No deadline.', '默认无限期。')
  },
  signal: {
    summary: t('Cancel the entire live-query lifetime.', '取消整个实时查询生命周期。'),
    default: t('No external signal.', '默认无外部信号。')
  },
  report: {
    summary: t(
      'Receive existing Resource diagnostics without changing query results.',
      '接收已有资源诊断，不改变查询结果。'
    ),
    default: t('Use the original diagnostic boundary.', '默认使用原有诊断边界。')
  }
}

/** Reference includes only current public browser entries; neutral ownership is explicit. */
export const storageWebReference: ILibraryReference = {
  modules: {
    ...storageWebAssemblyModules,
    index: {
      summary: t(
        'Stable browser error and namespace contracts. Import host and memory from storage-host, entities and storage codecs from storage-host/entity.',
        '稳定浏览器错误与命名空间契约。宿主和内存从 `@migaia/storage-host` 导入，实体与存储编解码器从 `@migaia/storage-host/entity` 导入。'
      ),
      example: `import { StorageError, StorageErrorCode } from '@migaia/storage-web'`
    },
    ...Object.fromEntries(
      backends.flatMap(([module, plugin, , id]) =>
        [module, `plugins/${module}`].map((entry) => [
          entry,
          {
            summary: t(
              `Use ${plugin} with createStorageHost for native browser storage; no direct store factory is exported.`,
              `使用 \`${plugin}\` 与 \`createStorageHost\` 安装原生浏览器存储，不导出直接存储工厂。`
            ),
            example: hostExample(module, plugin, id)
          }
        ])
      )
    ),
    'features/blobs': {
      summary: t(
        'Select native Blob/File storage in the original IndexedDB transaction.',
        '在原索引数据库事务内读写原生二进制对象，并与记录共用提交和回滚。'
      ),
      example: blobExample
    },
    'features/reactive': {
      summary: t(
        'Add live terminals to selected query chains. Each installed Feature owns one lazily attached source and retains native eventual visibility.',
        '为选定查询链增加实时终点，每个已安装特性拥有独立的惰性来源，保留原生最终可见性。'
      ),
      example: liveExample
    }
  },
  symbols: {
    ...storageWebAssemblySymbols,
    indexedDbBlobFeature: {
      role: 'enhancer',
      optionDocs: {
        storeName: {
          summary: t(
            'A nonempty private IndexedDB object-store name declared before the original opener seals.',
            '原打开器封闭前声明的非空索引数据库对象仓库名称，不能与业务仓库重名。'
          ),
          default: t(
            'Omitted: use __migaia_blobs__.',
            '省略时使用内置二进制对象仓库名称 __migaia_blobs__。'
          ),
          example: blobExample.replace(
            'indexedDbBlobFeature()',
            "indexedDbBlobFeature({\n      storeName: 'attachments_blobs'\n    })"
          )
        }
      },
      purpose: t(
        'Declare a native Blob store before opening and share record commit or rollback. Active commit journaling rejects raw native Feature requests before client access; ordinary and telemetry-only installations retain this capability.',
        '打开数据库之前声明二进制对象仓库，根写入和事务请求均复用原记录提交拥有者。启用提交日志时，原生特性请求在获得客户端之前拒绝；普通安装与仅遥测配置保留该能力。'
      ),
      params: {
        options: t(
          'Optional storeName; defaults to __migaia_blobs__.',
          '可选 storeName，默认 __migaia_blobs__。'
        )
      },
      returns: t(
        'An IndexedDB-only Feature with root and transaction blobs APIs.',
        '仅用于 IndexedDB 的 Feature，包含根与事务 blobs API。'
      ),
      example: blobExample,
      cases: storageWebCases.indexedDbBlobFeature
    },
    lengthPrefixedNamespaceCodec: {
      role: 'constant',
      purpose: t(
        'Default namespace codec: encodes `(namespace, key)` as `sw1:<length>:<namespace>:<key>`. Decoding returns undefined for foreign namespaces or malformed encoded namespace text; enumeration and clearing skip these nonmatching physical keys and preserve unrelated data.',
        '默认命名空间编码器把 `(namespace, key)` 编码为 `sw1:<长度>:<命名空间>:<key>`。其他命名空间或命名空间编码损坏时解码返回空值；枚举和清理跳过这些不匹配的物理键，保留无关数据。'
      ),
      example: `lengthPrefixedNamespaceCodec.encode('app', 'theme') // 'sw1:3:app:theme'`
    },
    STORAGE_WEB_SOURCE: {
      role: 'constant',
      purpose: t(
        'The `source` value (`@migaia/storage-web`) of every `StorageError`; compare it before branching on `code`.',
        '每个 `StorageError` 上的 `source` 值（`@migaia/storage-web`）；先比对它确认错误来源，再按 `code` 分支处理。'
      ),
      example: `if (error.source === STORAGE_WEB_SOURCE && error.code === StorageErrorCode.duplicateKey) retryWithReplace()`
    },
    StorageError: {
      role: 'error',
      returns: t(
        'A frozen StorageError preserving native Error identity, package source, selected code and original cause, with supplied backend/key/channel/operation/stage diagnostics. Construction returns rather than throws it.',
        '返回冻结的存储错误，保留原生错误身份、本包来源、所选错误码与原始原因，附带传入的后端、键、通道、操作及阶段诊断；构造本身不主动抛出它。'
      ),
      purpose: t(
        'Error class of this package; frozen, with `code`, optional backend, key, channels, stage and the original `cause`.',
        '本包的错误类；对象被冻结，带有 `code`，以及可选的后端、key、通道、阶段和原始 `cause`。'
      ),
      params: {
        code: t('A `StorageErrorCode` value.', '一个 `StorageErrorCode` 取值。'),
        details: t(
          '`IStorageErrorDetails`: backend, key, channels, stage, operation, cause.',
          '`IStorageErrorDetails`：后端、key、通道、阶段、操作与原因。'
        ),
        message: t(
          'Message text; defaults to the code text.',
          '错误信息文本；默认为错误码对应的文本。'
        ),
        stage: t(
          'Repository stage `decode`, `migrate` or `validate`.',
          '仓储阶段：`decode`、`migrate` 或 `validate`。'
        )
      },
      example: `if (error instanceof StorageError && error.code === StorageErrorCode.invalidConfig) await retry()`
    },
    StorageErrorCode: {
      role: 'constant',
      purpose: t(
        'Table of this package’s stable error codes; values are the strings on error.code. `INDEX_BACKFILL_FAILED` identifies backfill and failed-readiness persistence failing together on a native AggregateError.',
        '本包稳定错误码的对照表，值为错误对象的 `code` 字符串。`INDEX_BACKFILL_FAILED` 标识回填与失败就绪状态保存同时失败，交付原生聚合错误。'
      ),
      example: `if (error.code === StorageErrorCode.quotaExceeded) await cleanupOldEntries()`
    },
    StorageErrorText: {
      role: 'constant',
      purpose: t(
        'Stable message texts used by this package, for custom backends and codecs that want the same wording; branch on `code`, not on text.',
        '本包使用的稳定错误文本，供自定义后端与编解码器复用相同措辞；业务分支请比较 `code`，不要比较文本。'
      ),
      example: `throw new StorageError(StorageErrorCode.invalidConfig, {}, StorageErrorText.namespaceCodecEncodeInvalid)`
    },
    ...backendSymbols,
    reactiveFeature: {
      role: 'enhancer',
      purpose: t(
        'Define per-registration live queries for an explicit backend kind or target union. Memory and IndexedDB require their notifications Feature before live; missing assembly rejects explicitly. The Feature starts its original native source on first live and owns cleanup through the host lifecycle.',
        '为明确后端种类或目标联合定义每次注册独立的实时查询；内存与 IndexedDB 须在调用实时终点前选择各自的通知特性，缺失时明确拒绝。首次实时终点接入原生来源，并通过宿主生命周期拥有清理。'
      ),
      params: {
        target: t(
          'Opaque kind exported by the selected backend, or a host-defined target union.',
          '由选定后端导出的不透明种类标识，或宿主定义的目标联合。'
        )
      },
      returns: t(
        'A Feature record value for the backend plugin second argument.',
        '返回用于后端插件第二参数记录的特性。'
      ),
      example: liveExample
    }
  },
  types: {
    ...storageWebAssemblyTypes,
    ILiveQueryOptions: {
      summary: t(
        'Full original live-query admission retains the exact backend, caller Runtime and one read callback per generation.',
        '完整实时查询准入保留精确后端与调用方运行时，每次查询代际只执行一个原读取回调。'
      ),
      members: {
        ...liveQueryMembers,
        backendId: {
          summary: t(
            'The exact earlier installed backend ID supplied by the application.',
            '由应用提供并已提前安装的精确后端注册标识，不执行缺省后端回退。'
          )
        },
        query: {
          summary: t(
            'Read the current result from the captured backend and observe the current generation cancellation signal.',
            '从已捕获的原后端读取当前结果，并响应当前查询代际的取消信号。'
          ),
          params: {
            context: t(
              'The original store, generation signal and optional logical scope supplied by the live query owner.',
              '由实时查询拥有者提供的原存储、本代取消信号及可选逻辑范围。'
            )
          },
          returns: t(
            'A value or PromiseLike value for this generation; failure settles its error state and stale results never overwrite newer generations.',
            '返回本代结果或其异步值；失败进入错误状态，迟到结果不能覆盖更新代际。'
          ),
          example: liveExample
        }
      }
    },
    ICookieRemoveContext: {
      summary: t(
        'Removal borrows the original operation cancellation and deadline without changing the fixed cookie scope.',
        '删除操作借用原取消与毫秒期限上下文，不改变安装时捕获的网页存储固定作用域。'
      ),
      members: {
        signal: storageContractReference.types.IOperationContext!.members!.signal!,
        timeoutMs: storageContractReference.types.IOperationContext!.members!.timeoutMs!
      }
    },
    ICookieWriteContext: {
      summary: t(
        'Cookie writes capture original lifecycle fields and native expiry attributes before any assignment.',
        '网页存储写入在原生赋值之前捕获生命周期控制字段和原生到期属性。'
      ),
      members: {
        signal: storageContractReference.types.IOperationContext!.members!.signal!,
        timeoutMs: storageContractReference.types.IOperationContext!.members!.timeoutMs!,
        expires: {
          summary: t(
            'Optional valid Date for native Expires; omission does not add an absolute expiry attribute.',
            '可选有效日期，用于原生绝对到期属性；省略时不追加该属性。'
          )
        },
        maxAge: {
          summary: t(
            'Optional safe integer seconds for native Max-Age, taking precedence over Expires; selected redo captures its absolute deadline once.',
            '可选安全整数秒数，原生优先于绝对到期属性；选中重放模式时只捕获一次绝对期限。'
          )
        }
      }
    },
    ISyncCookieStore: {
      summary: t(
        'Synchronous operations see only JavaScript-visible cookies in the fixed namespace; hidden cookies remain opaque.',
        '同步操作只观察固定命名空间内脚本可见的网页条目，隐藏条目仍是不透明数据。'
      ),
      example: hostExample('cookies', 'cookieBackendPlugin', 'cookies'),
      scenarios: [
        t(
          'Use an ordinary cookie backend synchronously when its selected pipeline has no asynchronous stage.',
          '仅在普通网页存储后端所选管线没有异步阶段时，通过同步入口读写。'
        )
      ],
      members: {
        get: storageContractReference.types.ISyncKeyValueStore!.members!.get!,
        has: {
          ...storageContractReference.types.ISyncKeyValueStore!.members!.has!,
          summary: t(
            'Report visible presence only; false cannot establish absence of an HttpOnly cookie.',
            '只报告脚本可见条目是否存在，假值不能证明隐藏条目已经不存在。'
          )
        },
        keys: storageContractReference.types.ISyncKeyValueStore!.members!.keys!,
        set: {
          summary: t(
            'Assign one text value using the captured cookie scope and optional native expiry attributes.',
            '按照已捕获的固定作用域及可选原生期限，为一个逻辑键写入文本值。'
          ),
          params: {
            key: t('Application-selected logical cookie name.', '由应用选择的逻辑网页存储键名。'),
            value: t(
              'String text to encode in the visible cookie.',
              '要编码到脚本可见条目中的字符串文本。'
            ),
            ctx: t(
              'Optional expiry and synchronous write policy; cancellation is not available on this entry.',
              '可选到期属性与同步写入策略，此入口不接受取消或异步等待。'
            )
          },
          returns: t(
            'Returns after native visibility verification; invalid input or a rejected assignment throws before reporting success.',
            '原生可见性复核完成后返回；输入无效或原生赋值被拒绝时抛错，不报告成功。'
          ),
          example: hostExample('cookies', 'cookieBackendPlugin', 'cookies').replace(
            "await store.set('theme', 'dark')",
            "store.sync?.set('theme', 'dark', { maxAge: 3600 })"
          )
        },
        remove: {
          summary: t(
            'Expire the visible name using the exact configured scope; hidden or differently scoped cookies may remain.',
            '使用已配置的精确作用域使可见键名到期，隐藏或其它作用域条目仍可能保留。'
          ),
          params: {
            key: t(
              'Logical cookie name chosen by the application.',
              '由应用选择的逻辑网页存储键名。'
            )
          },
          returns: t(
            'The native expiry assignment has run; this is not proof that every same-name hidden cookie was removed.',
            '原生到期赋值已执行，并不表示所有同名隐藏条目都已删除。'
          ),
          example: hostExample('cookies', 'cookieBackendPlugin', 'cookies').replace(
            "await store.set('theme', 'dark')",
            "store.sync?.remove('theme')"
          )
        },
        clearValues: {
          summary: t(
            'Expire visible names from this namespace and fixed scope without clearing other browser data.',
            '只使当前命名空间与固定作用域内可见键名到期，不清理其它浏览器数据。'
          ),
          returns: t(
            'All visible selected names have received expiry assignments; opaque hidden entries are not promised removed.',
            '已为所有选中可见键名执行到期赋值，不承诺删除脚本不可见条目。'
          ),
          example: hostExample('cookies', 'cookieBackendPlugin', 'cookies').replace(
            "await store.set('theme', 'dark')",
            'store.sync?.clearValues()'
          )
        }
      }
    },
    IIndexedDbBlobApi: {
      summary: t(
        'Native Blob/File requests borrow the original database lifetime.',
        '原生 Blob/File 请求借用原数据库生命周期。'
      ),
      members: {
        put: {
          summary: t(
            'Write a Blob/File and wait for actual commit.',
            '保存原生二进制对象并等待实际提交完成。'
          ),
          params: {
            key: t('String key.', '字符串键。'),
            value: t('Native Blob or File.', '调用方提供的原生二进制对象或文件。'),
            ctx: t('Optional operation context.', '可选操作上下文。')
          },
          returns: t(
            'Promise<void> after the native operation commits.',
            '原生操作提交完成后返回空值。'
          ),
          example: blobExample
        },
        get: {
          summary: t(
            'Read a detached native clone or undefined.',
            '读取脱离存储的原生克隆或 undefined。'
          ),
          params: {
            key: t('String key.', '字符串键。'),
            ctx: t('Optional operation context.', '可选操作上下文。')
          },
          returns: t(
            'Promise<Blob | undefined>, detached from stored data.',
            '返回脱离存储的二进制对象副本，缺失时返回空值。'
          ),
          example: blobExample
        },
        remove: {
          summary: t(
            'Remove a native Blob row idempotently.',
            '幂等删除对应的原生二进制对象记录。'
          ),
          params: {
            key: t('String key.', '字符串键。'),
            ctx: t('Optional operation context.', '可选操作上下文。')
          },
          returns: t(
            'Promise<void> after the native operation commits.',
            '原生操作提交完成后返回空值。'
          ),
          example: blobExample
        }
      }
    },
    ITransactionBlobApi: {
      summary: t(
        'The same Blob methods use the current native transaction with no extra context.',
        '相同 Blob 方法使用当前原生事务，不接受额外上下文。'
      ),
      members: {
        put: {
          summary: t(
            'Stage a native Blob/File in this transaction.',
            '在当前事务草稿内保存原生二进制对象。'
          ),
          params: {
            key: t('Application-selected string object key.', '由应用选择的字符串对象存储键。'),
            value: t(
              'Native Blob or File supplied by the application.',
              '调用方提供的原生二进制对象或文件。'
            )
          },
          returns: t(
            'The native request has staged its value; the outer transaction still owns commit or rollback.',
            '原生请求已暂存该值，最终提交或回滚仍由外层事务拥有者决定。'
          ),
          example: blobExample
        },
        get: {
          summary: t(
            'Read this transaction native Blob value.',
            '读取当前事务可见的原生二进制对象。'
          ),
          params: {
            key: t('Application-selected string object key.', '由应用选择的字符串对象存储键。')
          },
          returns: t(
            'The value visible in this transaction, or undefined when absent.',
            '返回当前事务可见的二进制对象，缺失时返回空值。'
          ),
          example: blobExample
        },
        remove: {
          summary: t(
            'Remove this transaction native Blob row.',
            '在当前事务中删除指定二进制对象记录。'
          ),
          params: {
            key: t('Application-selected string object key.', '由应用选择的字符串对象存储键。')
          },
          returns: t(
            'The delete request is staged in the original transaction without committing it.',
            '在原事务中暂存删除请求，不自行提交该事务。'
          ),
          example: blobExample
        }
      }
    },
    StorageError: {
      summary: t(
        'Error of this package with its detail fields. Entity stage wrappers preserve the complete original StorageError on the cause chain and keep its message, rather than retaining only the leaf cause.',
        '本包错误对象及其详情字段。实体阶段包装在原因链保留完整原始存储错误及其消息，而非只保留叶子原因。'
      ),
      scenarios: [
        t(
          'Recover from quota, conflict or unavailable backends by `code`.',
          '按 `code` 从配额不足、冲突或后端不可用中恢复。'
        )
      ],
      example: `import { StorageError, StorageErrorCode } from '@migaia/storage-web'
const error = new StorageError(StorageErrorCode.invalidConfig, { backend: 'indexeddb' })
console.error(error.source, error.code)`,
      members: {
        source: {
          summary: t(
            'Always `@migaia/storage-web`.',
            '固定为 `@migaia/storage-web`，用于确认错误来源。'
          )
        },
        code: {
          summary: t(
            'One of `StorageErrorCode`.',
            '`StorageErrorCode` 中的一个稳定错误码，用于分支。'
          )
        },
        backend: {
          summary: t(
            'Backend kind where it failed, when known.',
            '发生失败的后端类型（已知时才有）。'
          )
        },
        key: { summary: t('Key involved, when known.', '本次失败涉及的 key（已知时才有）。') },
        existingChannel: {
          summary: t(
            'Channel already holding the key (`value`, `bytes`, `record`).',
            '已经占用该 key 的存储通道（`value`、`bytes`、`record`）。'
          )
        },
        attemptedChannel: {
          summary: t('Channel the write tried to use.', '本次写入尝试使用的通道。')
        },
        extensionStage: {
          summary: t(
            'Extension that failed: `schema`, `codec`, `migration`, `comparator` or `diagnostic`.',
            '出错的扩展点名称取值：`schema`、`codec`、`migration`、`comparator` 或 `diagnostic`。'
          )
        },
        operation: {
          summary: t('Name of the operation, when known.', '出错操作的名称（已知时才有）。')
        },
        stage: {
          summary: t('Repository stage of an invalid record.', '无效记录出错时所处的仓储阶段。'),
          values: {
            decode: t('Decoding the stored value failed.', '解码已存储的值失败。'),
            migrate: t('A migration failed.', '某个迁移函数执行失败。'),
            validate: t('Schema validation failed.', 'schema 校验未通过。')
          }
        }
      }
    },
    IStorageErrorDetails: {
      summary: t(
        'Second argument of `new StorageError(code, details)`.',
        '构造 `new StorageError(code, details)` 时传入的详情参数。'
      ),
      members: {
        backend: { summary: t('Kind of the backend that failed.', '发生失败的存储后端类型。') },
        key: { summary: t('Key involved in the failure.', '本次存储失败所涉及的 key。') },
        existingChannel: {
          summary: t('Channel already holding the key.', '已经占用该 key 的存储通道。')
        },
        attemptedChannel: { summary: t('Channel the write tried.', '本次写入尝试使用的通道。') },
        extensionStage: {
          summary: t('Failing extension point.', '出错的扩展点名称，例如 codec。')
        },
        operation: {
          summary: t('Name of the failing operation.', '出错操作的方法名称，例如 set。')
        },
        cause: {
          summary: t('Original error, kept on `cause`.', '原始错误对象，会保存在 `cause` 上。')
        }
      }
    },
    INamespaceCodec: {
      summary: t(
        'Encoder between `(namespace, key)` and the physical key; custom codecs own migration and collision safety.',
        '`(namespace, key)` 与物理 key 之间的编码器；自定义编码器需自行负责迁移与防冲突。'
      ),
      members: {
        encode: {
          summary: t('Builds the physical key.', '由命名空间和 key 构建物理 key。'),
          params: {
            namespace: t('Store namespace.', '存储所用的命名空间。'),
            key: t('Logical key.', '调用方使用的逻辑 key。')
          },
          returns: t('The physical key string.', '物理 key 字符串。')
        },
        decode: {
          summary: t('Reads the logical key back.', '从物理 key 还原出调用方的逻辑 key。'),
          params: {
            namespace: t('Store namespace.', '存储所用的命名空间。'),
            physicalKey: t(
              'Key read from the browser storage, returned by an earlier `encode`.',
              '从浏览器存储中读到的 key，来自之前 `encode` 的返回值。'
            )
          },
          returns: t(
            'The logical key, or undefined for a nonmatching namespace. The default codec also treats malformed encoded namespace text as nonmatching, so enumeration skips it without deleting foreign physical data.',
            '返回逻辑键；其他命名空间返回空值。默认编码器还把损坏的命名空间编码视为不匹配，枚举时跳过且不删除无关物理数据。'
          )
        },
        encodeStorageKey: {
          summary: t(
            'Optionally encodes typed batch keys without colliding with the original string layout; provide it with decodeStorageKey.',
            '可选地编码结构批量键，并与原字符串布局隔离；必须与 decodeStorageKey 成对提供。'
          ),
          params: {
            namespace: t('The original configured namespace.', '原配置命名空间。'),
            key: t(
              'A canonical IStorageKey captured by the key owner.',
              '由共享键拥有者捕获的规范 IStorageKey。'
            )
          },
          returns: t('The physical key string.', '物理键字符串。')
        },
        decodeStorageKey: {
          summary: t(
            'Optionally identifies both string and typed entries for namespace cleanup; missing support rejects non-string batch reads before native I/O.',
            '可选地识别字符串和结构键供命名空间清理使用；缺少支持时，非字符串批量读取在原生 I/O 前拒绝。'
          ),
          params: {
            namespace: t('The original configured namespace.', '原配置命名空间。'),
            physicalKey: t(
              'A physical key returned by native enumeration or generated by this same namespace codec.',
              '来自原生枚举或由同一命名空间编码器生成的物理存储键。'
            )
          },
          returns: t(
            'An IStorageKey, or undefined for a foreign or malformed entry.',
            'IStorageKey；不属于该命名空间或格式损坏时返回空值。'
          )
        }
      }
    },
    ICookieDocument: {
      summary: t(
        'Object with a `cookie` string, used to inject `document` in tests.',
        '带 `cookie` 字符串的对象，用于在测试中注入 `document`。'
      ),
      members: {
        cookie: {
          summary: t(
            'The cookie string, as `document.cookie`.',
            '可读写的 cookie 字符串，与 `document.cookie` 相同。'
          )
        }
      }
    },
    ILiveQuery: {
      summary: t(
        'A live query returned by `query.live()`.',
        '`query.live()` 返回的、会自动刷新的实时查询对象。'
      ),
      scenarios: [
        t(
          'Show a list that updates when another tab writes to IndexedDB.',
          '展示一个在其它标签页写入 IndexedDB 时自动更新的列表。'
        )
      ],
      example: liveExample,
      members: {
        state: {
          summary: t(
            'Read-only reactive value `{ status, value?, error? }`; read it in an effect to follow changes.',
            '只读的响应式值 `{ status, value?, error? }`；在 effect 中读取即可跟随变化。'
          )
        },
        consistency: {
          summary: t(
            'What the adapter promises: `mode`, `visibility`, `pollIntervalMs`.',
            '适配器给出的一致性承诺：`mode`、`visibility`、`pollIntervalMs`。'
          )
        },
        ready: {
          summary: t(
            'Resolves after the first run settled (success or error).',
            '第一次查询结束（成功或失败）后 resolve。'
          )
        },
        refresh: {
          summary: t(
            'Starts a new run; an older late result never overwrites it.',
            '启动一次新的查询；更早的迟到结果不会覆盖它。'
          ),
          returns: t('Resolves when the run settled.', '本次查询结束后 resolve。'),
          example: `await query.refresh()`
        },
        dispose: {
          summary: t(
            'Stops refreshes, cancels the current run and releases the subscription; repeated calls share one Promise.',
            '停止刷新、取消当前查询并释放订阅；重复调用共享同一个 Promise。'
          ),
          returns: t('Resolves when released.', '释放完成后 resolve。'),
          example: `await query.dispose()`
        }
      }
    },
    ILocalStorageOptions: {
      summary: t(
        'Native local-storage options for localStorageBackendPlugin.',
        '`localStorageBackendPlugin` 使用的原生本地存储选项。'
      ),
      members: webStorageFields('localStorage'),
      optionCases: optionCases('local-storage', 'localStorageBackendPlugin', 'local')
    },
    ISessionStorageOptions: {
      summary: t(
        'Native session-storage options for sessionStorageBackendPlugin.',
        '`sessionStorageBackendPlugin` 使用的原生会话存储选项。'
      ),
      members: webStorageFields('sessionStorage'),
      optionCases: optionCases('session-storage', 'sessionStorageBackendPlugin', 'session')
    },
    ICookiesOptions: {
      summary: t(
        'Cookie native port, namespace and fixed scope.',
        '浏览器 Cookie 原生端口、命名空间及固定作用域。'
      ),
      members: cookieFields,
      optionCases: optionCases('cookies', 'cookieBackendPlugin', 'cookies')
    },
    IIndexedDbOptions: {
      summary: t(
        'Native database preparation and physical layout options. Select indexedDbJournalFeature and storageJournalPlugin before using private storageLogStore history in the original META store. Native Web Locks retain the cached path; indexExclusive:false restores current state inside each original journal-store readwrite transaction without a cross-operation index.',
        '原生数据库准备与物理布局选项；须先选择 indexedDbJournalFeature 和 storageJournalPlugin，私有 storageLogStore 历史才复用原 META 仓库。原生 Web Locks 保留缓存路径；indexExclusive:false 在每操作原 journal-store readwrite 事务现读，不跨操作缓存。'
      ),
      members: indexedDbFields,
      optionCases: optionCases('indexed-db', 'indexedDbBackendPlugin', 'indexed-db')
    },
    IStorageErrorCode: alias(
      'One value from the browser-owned error table.',
      '浏览器错误表中的一个错误码取值。'
    ),
    IStorageChannel: alias(
      'Browser diagnostic channel: value, bytes or record.',
      '浏览器诊断数据通道：值、字节或记录。'
    ),
    IExtensionStage: alias(
      'The failing extension boundary retained on a browser error.',
      '浏览器错误保留的失败扩展边界。'
    ),
    ILocalStorageBackendStore: {
      ...storageContractReference.types.IKeyValueStore!,
      summary: t(
        'Installed localStorage backend with its original synchronous text API.',
        '已安装的本地存储后端，保留原同步文本接口。'
      )
    },
    ISessionStorageBackendStore: {
      ...storageContractReference.types.IKeyValueStore!,
      summary: t(
        'Installed sessionStorage backend with its original synchronous text API.',
        '已安装的会话存储后端，保留原同步文本接口。'
      )
    },
    ICookieBackendStore: {
      ...storageContractReference.types.IKeyValueStore!,
      summary: t(
        'Installed JS-visible cookie backend with fixed-scope writes.',
        '已安装的脚本可见 Cookie 后端，写入使用固定作用域。'
      )
    },
    IIndexedDbBackendStore: {
      ...storageContractReference.types.IRecordStore!,
      summary: t(
        'Installed native IndexedDB backend with ordinary text, byte, record and same-transaction scope methods. TTL, batch, journal, notifications, change feed and secondary indexes require their explicit Features.',
        '已安装的原生索引数据库后端，提供普通文本、字节、记录及同事务作用域方法；期限、批量、日志、通知、变更流与次级索引须分别显式选择对应特性。'
      )
    },
    IIndexedDbFeatureExpose: {
      summary: t(
        'Borrow original native clients and declare stores during installation.',
        '借用原生客户端，并在安装期间声明对象存储。'
      ),
      members: {
        getClient: {
          summary: t(
            'Read the original prepared database for this registration.',
            '读取该注册原有且已准备的数据库。'
          ),
          returns: t('The original IDBDatabase.', '原有数据库对象。'),
          example: `const database = featureExpose.getClient()`
        },
        getTransactionClient: {
          summary: t(
            'Validate exact scope ownership before borrowing its native transaction.',
            '借用原生事务前校验精确作用域所有权。'
          ),
          params: {
            scope: t(
              'A current scope from this installed store.',
              '当前已安装存储提供的活跃作用域。'
            )
          },
          returns: t(
            'The same original native transaction; forged or closed scopes fail.',
            '同一个原生事务，伪造或已关闭作用域失败。'
          ),
          example: `const transaction = featureExpose.getTransactionClient(scope)`
        },
        getTransactionClientForOrg: {
          summary: t(
            'Validate the exact original scope within its fixed organization.',
            '校验固定组织中的精确原作用域。'
          ),
          params: {
            scope: t('Current original scope.', '当前原作用域。'),
            orgId: t(
              'The immutable organization ID from the original host view.',
              '来自原宿主固定组织视图的不可变调用组织标识。'
            )
          },
          returns: t(
            'The original synchronous IDBTransaction.',
            '返回同一原生同步事务对象，不创建新的事务。'
          )
        },
        requireObjectStore: {
          summary: t(
            'Declare an additional object store before the original opener is sealed.',
            '原有打开器封闭前声明额外对象存储。'
          ),
          params: {
            name: t('A nonempty application-owned store name.', '应用拥有的非空对象存储名称。')
          },
          returns: t(
            'Records the schema declaration; late declarations fail INVALID_CONFIG.',
            '登记结构声明，迟到声明报 `INVALID_CONFIG`。'
          ),
          example: `featureExpose.requireObjectStore('attachments')`
        }
      }
    },
    IChainLiveQueryOptions: {
      summary: t(
        'Caller-owned Runtime and generation options for query.live().',
        '`query.live()` 使用的调用者运行时及查询代际选项。'
      ),
      example: liveExample,
      members: liveQueryMembers
    },
    IReactiveLiveMethods: {
      summary: t(
        'The live terminal installed on an existing all-capable query.',
        '安装到已有可取全部结果查询上的实时终点。'
      ),
      members: {
        live: {
          summary: t(
            'Start a resource-backed live query from this exact query terminal.',
            '从当前精确查询终点启动资源支持的实时查询。'
          ),
          params: {
            this: t(
              'The original backend query receiver exposing all().',
              '来自后端查询链且具有全部结果终点的原查询接收者。'
            ),
            options: t(
              'Runtime and generation options supplied by the caller.',
              '调用者提供的运行时及代际选项。'
            )
          },
          returns: t(
            'An ILiveQuery retaining the original terminal result type.',
            '保留原终点结果类型的实时查询。'
          ),
          example: liveExample
        }
      }
    },
    IReactiveFeatureOutput: {
      summary: t(
        'Feature output with query/vector/rdf live methods and no added capability token.',
        '为普通、向量与图查询提供实时方法且不增加能力令牌的特性输出。'
      ),
      members: {
        capabilities: { summary: t('An empty capability tuple.', '空能力元组。') },
        chain: {
          summary: t(
            'Live methods attached to supported query families.',
            '附加到受支持查询族的实时方法。'
          )
        },
        api: { summary: t('Empty store and transaction API records.', '空存储及事务方法记录。') }
      }
    }
  },
  enums: {
    StorageErrorText: {
      summary: t(
        'Stable diagnostic messages keyed by the owning admission, backend, index or live-query failure scenario.',
        '按所属接纳、后端、索引或实时查询失败场景命名的稳定诊断消息。'
      ),
      values: {
        cookieValueInvalid: t(
          'Cookie text writes received a value that is not a string.',
          '可见网页存储写入收到非字符串值，在原生赋值之前拒绝。'
        ),
        cookieMaxAgeInvalid: t(
          'Cookie Max-Age is not a safe integer number of seconds.',
          '网页存储的相对秒数不是安全整数，在原生赋值之前拒绝。'
        ),
        cookieExpiresInvalid: t(
          'Cookie Expires is not an authentic valid Date.',
          '网页存储的绝对期限不是有效日期对象，不能产生到期属性。'
        ),
        cookieRedoScopeMismatch: t(
          'A visible cookie with the same name remains in an unknown scope during redo.',
          '重放时同名条目仍在未知作用域可见，不能声称目标已经正确删除。'
        ),
        cookieRedoWriteInvisible: t(
          'A cookie assignment was not visible through the active fixed scope.',
          '原生赋值后在已固定的当前作用域不可见，不能声称写入已经成功。'
        ),
        indexedDbJournalFactoryIsolationInvalid: t(
          'A private-factory declaration is neither true nor omitted.',
          '私有工厂声明既不是明确真值也没有省略，因此无法选择该原生隔离路径。'
        ),
        indexedDbJournalFactoryMustBeInjected: t(
          'The known shared realm factory cannot be declared a private data universe.',
          '当前运行环境已知共享工厂不能被声明为私有数据域，须注入真正独立工厂。'
        ),
        storageBatchKeysInvalid: t(
          'Batch keys must be a finite caller-provided array.',
          '批量键输入必须是调用方提供的数组，实际请求前完成捕获。'
        ),
        storageBatchEntriesInvalid: t(
          'Batch writes require an array of key and value entries.',
          '批量写入必须提供键值条目数组，实际请求前完成全部输入捕获。'
        ),
        storageBatchDuplicateKey: t(
          'A batch repeats one canonical logical storage-key identity.',
          '同一批量输入包含规范身份相同的重复键，在任何原生修改前拒绝。'
        ),
        indexedDbOwnerInvalid: t(
          'An owner label must be an object with an optional string label.',
          '锁拥有者配置必须是可含字符串标签的对象，该标签本身不授予权限。'
        ),
        indexedDbSchemaDeclarationInvalid: t(
          'A Feature attempted to declare an object store after the original opener sealed.',
          '特性在原打开器已封闭后声明额外对象仓库，不能修改已准备好的原生结构。'
        ),
        indexedDbTransactionEndedEarly: t(
          'The native transaction ended before the backend chose its commit outcome.',
          '后端作出提交决定之前原生事务已经结束，后续结果不能当作可靠提交。'
        ),
        storageValueInvalid: t(
          'The native text channel received a value that is not a string.',
          '原生文本通道收到非字符串值，不能按记录或可移植对象隐式转换。'
        ),
        storageBytesInvalid: t(
          'The native binary channel received a value that is not a Uint8Array.',
          '原生字节通道收到非字节数组视图，不能创建所承诺的分离字节副本。'
        ),

        namespaceCodecEncodeInvalid: t(
          'A namespace encoder returned a non-string physical key.',
          '命名空间编码器返回了非字符串的物理存储键。'
        ),
        namespaceCodecDecodeInvalid: t(
          'A namespace decoder returned neither a string key nor undefined for another namespace.',
          '命名空间解码器既未返回字符串键，也未以空值表示其他命名空间。'
        ),
        namespaceTypedCodecInvalid: t(
          'Typed namespace support supplies only one direction or a non-callable method.',
          '结构键命名空间支持只提供一个方向，或提供了不可调用的方法。'
        ),
        namespaceCodecInvalid: t(
          'The original namespace codec lacks callable encode and decode methods.',
          '原命名空间编码器缺少可调用的 encode 和 decode。'
        ),
        namespaceKeyInvalid: t(
          'String-key encoding received a non-string namespace or key.',
          '字符串键编码收到非字符串的命名空间或键。'
        ),
        namespacePhysicalKeyInvalid: t(
          'Namespace decoding received a non-string namespace or physical key.',
          '命名空间解码收到非字符串的命名空间或物理键。'
        ),
        webStorageInjectionInvalid: t(
          'Injected Web Storage lacks part of the required storage interface.',
          '注入的网页存储未实现必需的完整存储接口。'
        ),
        webStorageLengthInvalid: t(
          'The live Web Storage length is not a nonnegative safe integer.',
          '网页存储的实时长度不是非负安全整数，无法枚举。'
        ),
        webStorageKeyInvalid: t(
          'Live Web Storage enumeration did not provide a string key for a visible index.',
          '网页存储枚举没有为可见下标提供字符串键。'
        ),
        webStorageKeyDuplicate: t(
          'Live Web Storage enumeration returned the same physical key more than once.',
          '网页存储枚举多次返回同一个物理键，无法可靠遍历。'
        ),
        indexedDbChangeHintKeyInvalid: t(
          'An IndexedDB coordination hint contains an undecodable storage key.',
          '索引数据库协调提示包含无法解码的存储键。'
        ),
        indexedDbUpgradeTransactionMissing: t(
          'An IndexedDB upgrade event omitted the platform-owned upgrade transaction.',
          '索引数据库升级事件缺少平台应提供的升级事务。'
        ),
        cookieDocumentBecameInvalid: t(
          'An admitted cookie document stopped exposing its cookie property as a string.',
          '已接纳的网页文档不再以字符串形式提供存储属性。'
        ),
        liveQueryDisposeFailed: t(
          'Several live-query cleanup failures are summarized after disposal.',
          '实时查询释放后的多个清理失败被聚合汇总。'
        ),
        reactiveFeatureInvalid: t(
          'A reactive provider, feature or adapter descriptor has an invalid shape.',
          '响应式提供方、特性或适配器描述形状不合法。'
        ),
        reactiveAdapterNotInstalled: t(
          'The requested backend has no installed reactive adapter.',
          '请求的后端没有已安装的响应式适配器。'
        ),
        reactiveAdapterFailed: t(
          'An adapter event, polling operation or authoritative read failed recoverably.',
          '适配器事件、轮询或权威读取发生可恢复失败。'
        ),
        reactiveAdapterDisposeFailed: t(
          'Reactive adapter or service cleanup produced aggregated failures.',
          '响应式适配器或服务清理产生需要聚合的失败。'
        ),
        liveQueryFailed: t(
          'A live-query extension callback failed and its original cause is retained.',
          '实时查询扩展回调失败，并保留对应原始原因。'
        ),
        backendDisposeFailed: t(
          'Direct backend cleanup failed and is reported through the storage boundary.',
          '直接后端清理失败，通过存储边界交付错误。'
        ),
        indexOrphan: t(
          'An index sidecar row has no authoritative entity record.',
          '索引辅助行缺少对应的权威实体记录。'
        ),
        indexQueryInvalidated: t(
          'Concurrent mutation invalidated a native paged index query.',
          '并发变更使原生分页索引查询失去一致性。'
        ),
        liveQueryDisposed: t(
          'A permanently disposed live query was used again and must be recreated.',
          '已经永久释放的实时查询再次被使用，需要重建。'
        ),
        indexBackfillStale: t(
          'The index backfill handle is stale and the query must retry.',
          '索引回填句柄已经过期，需要重新发起查询。'
        ),
        indexBackfillProjectionTooLarge: t(
          'Backfill projection work exceeded its fixed bound before sidecar writes.',
          '回填投影工作在辅助行写入前超过固定规模上限。'
        ),
        indexBackfillDecodedTooLarge: t(
          'Decoded backfill payload exceeded its fixed bound before issuing a partial batch.',
          '回填解码载荷在提交部分批次前超过固定规模上限。'
        )
      }
    },
    StorageErrorCode: {
      summary: t(
        'Stable error codes of `@migaia/storage-web` and what to do.',
        '`@migaia/storage-web` 的稳定错误码及处理方式。'
      ),
      values: {
        unavailable: t(
          '`BACKEND_UNAVAILABLE`: storage is disabled or missing (private mode); pick `memoryBackendPlugin` from `@migaia/storage-host` or ask for access.',
          '`BACKEND_UNAVAILABLE`：存储被禁用或不存在（隐私模式）；从 `@migaia/storage-host` 显式选择 `memoryBackendPlugin` 或请用户开启。'
        ),
        quotaExceeded: t(
          '`QUOTA_EXCEEDED`: the browser quota is full; delete data or use IndexedDB.',
          '`QUOTA_EXCEEDED`：浏览器配额已满；删除数据或改用 IndexedDB。'
        ),
        valueTooLarge: t(
          '`VALUE_TOO_LARGE`: a cookie value is over 4 KB.',
          '`VALUE_TOO_LARGE`：网页小型存储值超过允许的大小上限。'
        ),
        serializeFailed: t(
          '`SERIALIZE_FAILED`: encoding the value failed.',
          '`SERIALIZE_FAILED`：存储值编码失败，应检查值与编解码器。'
        ),
        deserializeFailed: t(
          '`DESERIALIZE_FAILED`: decoding the stored value failed.',
          '`DESERIALIZE_FAILED`：解码已存储的值时失败。'
        ),
        transactionFailed: t(
          '`TRANSACTION_FAILED`: the IndexedDB transaction failed or the callback threw.',
          '`TRANSACTION_FAILED`：索引数据库事务失败，或事务回调执行时抛错。'
        ),
        duplicateKey: t(
          '`DUPLICATE_KEY`: the key is used by another channel; pass `conflictPolicy: "replace"` to overwrite.',
          '`DUPLICATE_KEY`：该 key 被另一个通道占用；传入 `conflictPolicy: "replace"` 才会覆盖。'
        ),
        versionUnsupported: t(
          '`VERSION_UNSUPPORTED`: stored data is newer than this code.',
          '`VERSION_UNSUPPORTED`：已存储数据的版本比当前代码更新。'
        ),
        extensionFailed: t(
          '`EXTENSION_FAILED`: a schema, codec or comparator threw.',
          '`EXTENSION_FAILED`：schema、编解码器或比较函数抛错。'
        ),
        writeFailed: t(
          '`WRITE_FAILED`: a written cookie was not visible afterwards.',
          '`WRITE_FAILED`：写入的网页小型存储值随后无法读取，应检查作用域。'
        ),
        cookieScopeAmbiguous: t(
          '`COOKIE_SCOPE_AMBIGUOUS`: one cookie name is visible in several scopes.',
          '`COOKIE_SCOPE_AMBIGUOUS`：同一个 cookie 名在多个作用域中可见。'
        ),
        invalidConfig: t(
          '`INVALID_CONFIG`: an option or scope is invalid.',
          '`INVALID_CONFIG`：某个选项或作用域不合法。'
        ),
        indexOrphan: t(
          '`INDEX_ORPHAN`: an index points to a missing record; rebuild it.',
          '`INDEX_ORPHAN`：索引指向不存在的记录；需要重建索引。'
        ),
        indexUniqueConflict: t(
          '`INDEX_UNIQUE_CONFLICT`: a unique index key belongs to another record.',
          '`INDEX_UNIQUE_CONFLICT`：唯一索引的 key 已属于另一条记录。'
        ),
        indexQueryInvalidated: t(
          '`INDEX_QUERY_INVALIDATED`: data changed during paging; restart the query.',
          '`INDEX_QUERY_INVALIDATED`：分页期间数据发生变化；需要重新开始查询。'
        ),
        liveQueryDisposed: t(
          '`LIVE_QUERY_DISPOSED`: the live query was disposed; create a new one.',
          '`LIVE_QUERY_DISPOSED`：实时查询已释放；需要创建新的查询。'
        ),
        indexBackfillStale: t(
          '`INDEX_BACKFILL_STALE`: an index backfill checkpoint expired; reconnect and retry.',
          '`INDEX_BACKFILL_STALE`：索引回填检查点已过期；重新连接后重试。'
        ),
        indexBackfillFailed: t(
          '`INDEX_BACKFILL_FAILED`: backfill and persisting failed readiness both failed. The native AggregateError keeps the primary error first in errors and as cause, followed by the persistence failure; inspect both original objects before retrying.',
          '`INDEX_BACKFILL_FAILED`：回填与保存失败就绪状态同时失败。原生聚合错误在错误数组首位及原因保留原始主错误，随后保留持久化失败；重试前检查两个原对象。'
        ),
        liveQueryDisposeFailed: t(
          '`LIVE_QUERY_DISPOSE_FAILED`: query cleanup failed; see `errors`.',
          '`LIVE_QUERY_DISPOSE_FAILED`：实时查询清理失败；查看 `errors`。'
        ),
        reactiveFeatureInvalid: t(
          '`REACTIVE_FEATURE_INVALID`: the reactive Feature does not match the backend.',
          '`REACTIVE_FEATURE_INVALID`：响应式特性描述或其后端对应关系不合法。'
        ),
        reactiveAdapterNotInstalled: t(
          '`REACTIVE_ADAPTER_NOT_INSTALLED`: the backend id is not reactive.',
          '`REACTIVE_ADAPTER_NOT_INSTALLED`：该后端 id 不具备响应式能力。'
        ),
        reactiveAdapterFailed: t(
          '`REACTIVE_ADAPTER_FAILED`: the adapter failed; later changes may recover.',
          '`REACTIVE_ADAPTER_FAILED`：适配器失败；之后的变化可能使其恢复。'
        ),
        reactiveAdapterDisposeFailed: t(
          '`REACTIVE_ADAPTER_DISPOSE_FAILED`: adapter cleanup failed.',
          '`REACTIVE_ADAPTER_DISPOSE_FAILED`：响应式适配器清理失败。'
        ),
        indexedDbFeatureNotInstalled: t(
          'Install the IndexedDB Feature named in the diagnostic before using the optional operation; base reads and writes remain available.',
          '调用可选操作之前安装诊断指出的索引数据库特性，基础读写仍可用。'
        ),
        backendDisposeFailed: t(
          '`BACKEND_DISPOSE_FAILED`: backend cleanup failed.',
          '`BACKEND_DISPOSE_FAILED`：直接后端清理失败，应检查保留的原始错误列表。'
        )
      }
    }
  },
  enhancers: {
    ...storageWebAssemblyEnhancers,
    ...backendEnhancers,
    indexedDbBlobFeature: {
      kind: 'feature',
      target: 'IIndexedDbBackendStore',
      summary: t(
        'Add Blob/File requests to the original native transaction.',
        '为原生索引数据库事务增加二进制对象请求，最终提交与回滚仍由原事务拥有者决定。'
      ),
      install: blobExample,
      example: blobExample,
      grants: [
        {
          signature: 'store.api.blobs / scope.api.blobs',
          summary: t(
            'Read and write native clones with one rollback boundary.',
            '在一个回滚边界内读写原生克隆。'
          ),
          example: blobExample
        }
      ],
      scenarios: [t('Store attachments with their records.', '随记录存储附件。')]
    },
    reactiveFeature: {
      kind: 'feature',
      target: 'IQueryChain',
      summary: t(
        'Adds live() to selected query families with per-registration source ownership.',
        '为选定查询族增加实时终点，每次注册独立拥有变化来源。'
      ),
      install: liveExample,
      example: liveExample,
      grants: [
        {
          signature: 'query.live(options)',
          summary: t(
            'Create a cancellable, disposable live query from its original terminal.',
            '从原有终点创建可取消及释放的实时查询。'
          ),
          params: {
            options: t('Runtime plus optional generation controls.', '运行时与可选代际控制。')
          },
          returns: t('An ILiveQuery and the shared resource protocol.', '实时查询与共享资源协议。'),
          example: liveExample
        }
      ],
      scenarios: [
        t(
          'Refresh browser record views after relevant native changes.',
          '相关原生变化后刷新浏览器记录视图。'
        )
      ]
    }
  }
}
