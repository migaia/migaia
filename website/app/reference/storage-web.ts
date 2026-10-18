/**
 * Reference documentation of `@migaia/storage-web`. Rules: `app/reference/contract.ts`. Verified
 * against `packages/storage-web/src` (backends/_, entity/_, host/_, plugins/_, reactive-adapter.ts,
 * schema/_, serialize/_, error-code.ts), README and USEGUIDE follow-ups on 2026-10-18. Store
 * interfaces (`IKeyValueStore`, `IRecordStore`, ...) belong to `@migaia/storage-contract`.
 */
import { storageContractReference } from './storage-contract.js'
import type {
  ICode,
  IEnhancerDoc,
  ILibraryReference,
  IMemberDoc,
  ISymbolDoc,
  IText,
  ITypeDoc
} from './contract.js'

/** A custom Feature, its concrete memory backend, and the Host that owns their installation. */
export const storageFeatureExample = `import { createStorageHost, defineFeature, definePlugin } from '@migaia/storage-web/host'
import { memoryStorageHost } from '@migaia/storage-web/memory'

const metrics = defineFeature((core) => ({
  backendId: () => core.featureExpose.getBackendId(),
  count: async () => (await core.featureExpose.getStore().keys()).length
}))
const cachePlugin = definePlugin('cache', (core) => {
  core.registerStore(memoryStorageHost())
  return {
    install: async () => {
      await core.getStore().set('user:1', JSON.stringify({ name: 'Ada' }))
      return {
        count: () => core.features.metrics.count(),
        backendId: () => core.features.metrics.backendId()
      }
    }
  }
}, { metrics })

const host = await createStorageHost()
try {
  const cache = await host.use(cachePlugin)
  console.assert(await cache.extensions.count() === 1)
  console.assert(cache.extensions.backendId() === 'cache')
  console.log(await cache.extensions.count(), cache.extensions.backendId())
} finally {
  await host.dispose()
}`

/** Builds one bilingual text. */
const t = (en: string, zh: string): IText => ({ en, zh })

/** Short type doc for unions and helper types. */
const alias = (en: string, zh: string): ITypeDoc => ({ summary: t(en, zh), members: {} })

/** Fields of Web Storage options (`ILocalStorageOptions`, `ISessionStorageOptions`). */
const webStorageFields = (global: string): Readonly<Record<string, IMemberDoc>> => ({
  namespace: {
    summary: t(
      'Prefix that isolates this store; `keys()` and `clearValues()` only see this namespace.',
      '隔离当前存储的前缀；`keys()` 与 `clearValues()` 只作用于该命名空间。'
    ),
    default: t('`default`.', '默认值为 `default`。')
  },
  namespaceCodec: {
    summary: t(
      'How namespace and key become one physical key; changing it changes the stored format.',
      '命名空间与 key 组合为物理 key 的方式；更换它会改变持久化格式。'
    ),
    default: t(
      '`lengthPrefixedNamespaceCodec` (`sw1:3:app:theme`).',
      '默认使用 `lengthPrefixedNamespaceCodec`（形如 `sw1:3:app:theme`）。'
    )
  },
  storage: {
    summary: t(
      'Storage object to use, for tests or non-browser hosts.',
      '要使用的存储对象，用于测试或非浏览器环境。'
    ),
    default: t(`\`globalThis.${global}\`.`, `默认使用全局的 \`globalThis.${global}\`。`)
  }
})

/** Fields of `ICookiesOptions`. */
const cookieFields: Readonly<Record<string, IMemberDoc>> = {
  namespace: webStorageFields('localStorage').namespace as IMemberDoc,
  namespaceCodec: webStorageFields('localStorage').namespaceCodec as IMemberDoc,
  scope: {
    summary: t(
      'Fixed cookie scope `{ path, domain, sameSite, secure, partitioned }` used for every write and delete; `sameSite: "none"` and `partitioned` require `secure: true`.',
      '固定的 cookie 作用域 `{ path, domain, sameSite, secure, partitioned }`，所有写入与删除都使用它；`sameSite: "none"` 与 `partitioned` 要求 `secure: true`。'
    ),
    default: t('`{ path: "/" }`.', '默认值为 `{ path: "/" }`。')
  },
  document: {
    summary: t('Object with a `cookie` string, for tests.', '带 `cookie` 字符串的对象，用于测试。'),
    default: t(
      '`globalThis.document`; missing throws `BACKEND_UNAVAILABLE`.',
      '`globalThis.document`；不存在时抛 `BACKEND_UNAVAILABLE`。'
    )
  }
}

/** Fields of `IIndexedDbOptions`. */
const indexedDbFields: Readonly<Record<string, IMemberDoc>> = {
  dbName: {
    summary: t('IndexedDB database name.', '要打开或创建的 IndexedDB 数据库名称。'),
    default: t('`storage-web`.', '默认值为 `storage-web`。')
  },
  kvStoreName: {
    summary: t('Object store for plain values.', '用于存放普通键值的 object store 名称。'),
    default: t('`kv`.', '默认值为 `kv`。')
  },
  bytesStoreName: {
    summary: t('Object store for byte values.', '存放二进制字节数据的 object store 名称。'),
    default: t('`bytes`.', '默认值为 `bytes`。')
  },
  recordsStoreName: {
    summary: t(
      'Object store for records; the three names must differ and avoid reserved names.',
      '存放记录的 object store 名称；三个名称必须互不相同，且不能使用保留名。'
    ),
    default: t('`records`.', '默认值为 `records`。')
  },
  cleanupLegacyRecords: {
    summary: t(
      'Delete the old `documents` store after it was fully migrated; enable only when no client needs to roll back.',
      '在旧的 `documents` store 完整迁移后删除它；只在确认没有客户端需要回滚时开启。'
    ),
    default: t('`false`.', '`false`：保留旧数据。')
  },
  factory: {
    summary: t(
      'IndexedDB factory for tests (e.g. `fake-indexeddb`).',
      '测试环境使用的 IndexedDB 工厂（例如 `fake-indexeddb`）。'
    ),
    default: t(
      '`globalThis.indexedDB`; missing throws `BACKEND_UNAVAILABLE`.',
      '`globalThis.indexedDB`；不存在时抛 `BACKEND_UNAVAILABLE`。'
    )
  },
  keyRange: {
    summary: t(
      '`IDBKeyRange` constructor, passed together with `factory` in tests.',
      '`IDBKeyRange` 构造函数，测试时与 `factory` 一起传入。'
    ),
    default: t('`globalThis.IDBKeyRange`.', '默认使用全局的 `globalThis.IDBKeyRange`。')
  }
}

/**
 * Built-in backend plugins: [symbol, module, default id, store en, store zh, options type, reactive
 * mode].
 */
const backends = [
  [
    'memory',
    'memory',
    'memory',
    'an in-memory record store',
    '内存记录存储',
    undefined,
    'push / instance'
  ],
  [
    'localStorage',
    'local-storage',
    'local',
    'a namespaced `localStorage` store',
    '带命名空间的 `localStorage` 存储',
    'ILocalStorageOptions',
    'hybrid / document-eventual / 1000 ms'
  ],
  [
    'sessionStorage',
    'session-storage',
    'session',
    'a namespaced `sessionStorage` store',
    '带命名空间的 `sessionStorage` 存储',
    'ISessionStorageOptions',
    'hybrid / top-level-context-eventual / 1000 ms'
  ],
  [
    'cookie',
    'cookies',
    'cookies',
    'a `document.cookie` store',
    '基于 `document.cookie` 的存储',
    'ICookiesOptions',
    'hybrid / origin-js-visible-eventual'
  ],
  [
    'indexedDb',
    'indexed-db',
    'indexed-db',
    'an IndexedDB record store with indexes and transactions',
    '支持索引与事务的 IndexedDB 记录存储',
    'IIndexedDbOptions',
    'hybrid / origin-eventual / 1000 ms'
  ]
] as const

/** Example of a host with one backend plugin. */
const hostExample = (
  factory: string,
  module: string,
  id: string
) => `import { createStorageHost } from '@migaia/storage-web/host'
import { ${factory} } from '@migaia/storage-web/${module}'

const host = await createStorageHost({ plugins: [${factory}({ id: '${id}' })] as const })
const store = host.backend('${id}')
await store.set('theme', 'dark')
await host.dispose()`

/** Live query example. */
const liveQueryExample: ICode = {
  en: `import { createRuntime } from '@migaia/reactive'
import { createStorageHost } from '@migaia/storage-web/host'
import { indexedDbReactive } from '@migaia/storage-web/plugins/reactive/indexed-db'

const runtime = createRuntime()
const host = await createStorageHost({ plugins: [indexedDbReactive({ id: 'app', dbName: 'app-data' })] as const })
const query = host.liveQuery({
  backendId: 'app',
  runtime,
  scope: 'users',
  query: ({ store, signal }) => store.getRecord(['users', 'ada'], { signal }),
  timeoutMs: 5_000
})
await query.ready
runtime.effect(() => console.log(query.state.value.status)) // re-runs on every change
await query.dispose()
await host.dispose()`,
  zh: `import { createRuntime } from '@migaia/reactive'
import { createStorageHost } from '@migaia/storage-web/host'
import { indexedDbReactive } from '@migaia/storage-web/plugins/reactive/indexed-db'

const runtime = createRuntime()
const host = await createStorageHost({ plugins: [indexedDbReactive({ id: 'app', dbName: 'app-data' })] as const })
const query = host.liveQuery({
  backendId: 'app',
  runtime,
  scope: 'users',
  query: ({ store, signal }) => store.getRecord(['users', 'ada'], { signal }),
  timeoutMs: 5_000
})
await query.ready
runtime.effect(() => console.log(query.state.value.status)) // 每次数据变化都会重新执行
await query.dispose()
await host.dispose()`
}

/** Plugin symbols and enhancer docs for every built-in backend, plain and reactive. */
const pluginSymbols: Record<string, ISymbolDoc> = {}
const pluginEnhancers: Record<string, IEnhancerDoc> = {}
for (const [prefix, module, id, en, zh, optionsType, reactive] of backends) {
  /** Factory names of the plain and reactive variants. */
  const plain = `${prefix}BackendPlugin`
  const live = `${prefix === 'cookie' ? 'cookies' : prefix}Reactive`
  for (const [name, isReactive, path] of [
    [plain, false, `plugins/${module}`],
    [live, true, `plugins/reactive/${module}`]
  ] as const) {
    pluginSymbols[name] = {
      role: 'enhancer',
      optionDocs: {
        id: {
          summary: t(
            'Caller-selected backend registration id; use this exact value with `host.backend()` and live-query `backendId`.',
            '调用方选择的后端登记标识；在 `host.backend()` 与实时查询的 `backendId` 中使用同一值。'
          ),
          default: t(`Omitted: register under \`${id}\`.`, `省略时以 \`${id}\` 登记后端。`)
        }
      },
      purpose: isReactive
        ? t(
            `Plugin that installs ${en} under an id and also its reactive adapter (${reactive}), so the host gains \`liveQuery\` for that id.`,
            `安装${zh}并同时安装其响应式适配器（${reactive}）的插件，使宿主为该 id 获得 \`liveQuery\`。`
          )
        : t(
            `Plugin that installs ${en} into a storage host under an id (default \`${id}\`); no reactive capability.`,
            `把${zh}以指定 id（默认 \`${id}\`）安装进存储宿主的插件；不带响应式能力。`
          ),
      ...(optionsType
        ? { options: optionsType }
        : {
            params: {
              options: t(
                '`{ id? }`: the backend id, default the plugin name.',
                '`{ id? }`：要使用的后端 id，默认为该插件的名称。'
              )
            }
          }),
      returns: t(
        'A plugin handle for `createStorageHost({ plugins })` or `host.use()`.',
        '可交给 `createStorageHost({ plugins })` 或 `host.use()` 的插件句柄。'
      ),
      example: hostExample(name, path, id)
    }
    pluginEnhancers[name] = {
      kind: 'plugin',
      target: 'IStorageHost',
      summary: isReactive
        ? t(
            `After installation \`host.backend("${id}")\` returns the store, \`host.reactiveBackend("${id}")\` returns its reactive handle, and \`host.liveQuery({ backendId: "${id}", ... })\` keeps a query fresh when the store changes.`,
            `安装后 \`host.backend("${id}")\` 返回该存储，\`host.reactiveBackend("${id}")\` 返回其响应式句柄，\`host.liveQuery({ backendId: "${id}", ... })\` 会在存储变化时保持查询结果最新。`
          )
        : t(
            `After installation \`host.backend("${id}")\` returns the store with exact types, and \`host.hasBackend("${id}")\` is true.`,
            `安装后 \`host.backend("${id}")\` 返回带精确类型的存储对象，\`host.hasBackend("${id}")\` 返回 true，宿主释放时一并释放该存储。`
          ),
      install: hostExample(name, path, id),
      grants: [
        {
          signature: `host.backend('${id}')`,
          summary: t(
            'Returns the installed store with its exact type.',
            '返回已安装的存储，并带有其精确类型。'
          ),
          params: {
            id: t(
              `The id given to the plugin, \`${id}\` by default.`,
              `插件给出的 id，默认为 \`${id}\`。`
            )
          },
          returns: t(
            'The store; unknown ids throw `BACKEND_NOT_INSTALLED`.',
            '存储对象；id 未安装时抛 `BACKEND_NOT_INSTALLED`。'
          ),
          example: `await host.backend('${id}').set('k', 'v')`
        },
        ...(isReactive
          ? [
              {
                signature: 'host.liveQuery(options)',
                summary: t(
                  'Creates a live query on this backend; see `ILiveQueryOptions`.',
                  '在该后端上创建实时查询，见 `ILiveQueryOptions`。'
                ),
                params: {
                  options: t(
                    `\`{ backendId: "${id}", runtime, query, ... }\`.`,
                    `实时查询选项 \`{ backendId: "${id}", runtime, query, ... }\`。`
                  )
                },
                returns: t('An `ILiveQuery`.', '一个实时查询对象 `ILiveQuery`。'),
                example: `const query = host.liveQuery({ backendId: '${id}', runtime, query: ({ store }) => store.get('theme') })`
              }
            ]
          : [])
      ],
      behaviors: [
        t(
          'Disposing the host disposes the store and, for reactive plugins, its adapter.',
          '释放宿主时会一并释放该存储；响应式插件还会释放其适配器。'
        )
      ],
      scenarios: [
        isReactive
          ? t(
              'Update the UI automatically when stored data changes.',
              '在存储数据变化时自动更新界面。'
            )
          : t(
              'Select one storage backend by id in application code.',
              '在应用代码中按 id 选择某个存储后端。'
            )
      ],
      example: hostExample(name, path, id)
    }
  }
}

/** Members of `IStorageHostBase` / `IStorageHost` / `StorageHostFacade`. */
const hostMembers: Readonly<Record<string, IMemberDoc>> = {
  extensions: {
    summary: t(
      'APIs added by installed plugins (custom `definePlugin` installs).',
      '已安装插件新增的 API（来自自定义的 `definePlugin`）。'
    )
  },
  use: {
    summary: t(
      'Installs more plugins after creation; the whole batch is published atomically or rolled back. A second `use()` during installation throws `STORAGE_HOST_BUSY`.',
      '在创建之后安装更多插件；整批要么原子发布，要么回滚。安装进行中再次调用 `use()` 抛 `STORAGE_HOST_BUSY`。'
    ),
    params: { plugins: t('Plugin handles with new, unique ids.', '带有新且唯一 id 的插件句柄。') },
    returns: t('The same host, typed with the new backends.', '同一个宿主，类型中加入了新的后端。'),
    example: `const next = await host.use(indexedDbBackendPlugin({ id: 'primary' }))`
  },
  backend: {
    summary: t('Returns the store installed under an id.', '返回以某个 id 安装的存储对象。'),
    params: {
      id: t(
        'Id given to the plugin (`memoryBackendPlugin({ id })`).',
        '插件给出的 id（如 `memoryBackendPlugin({ id })`）。'
      )
    },
    returns: t(
      'The store; unknown ids throw `BACKEND_NOT_INSTALLED`.',
      '存储对象；id 未安装时抛 `BACKEND_NOT_INSTALLED`。'
    ),
    example: `const cache = host.backend('cache')`
  },
  hasBackend: {
    summary: t(
      'Tells whether an id is installed (also narrows its type).',
      '判断某个 id 是否已安装（同时收窄类型）。'
    ),
    params: { id: t('Backend id to check.', '要检查的后端 id。') },
    returns: t('`true` when installed.', '已安装时返回 `true`。'),
    example: `if (host.hasBackend('primary')) await host.backend('primary').get('k')`
  },
  backends: {
    summary: t(
      'Returns a copied map of all installed stores by id; its ReadonlyMap type prevents typed mutation, but the map is not frozen at runtime.',
      '返回按标识索引的全部已安装存储的映射副本；`ReadonlyMap` 类型限制类型层面的修改，运行时并未冻结映射。'
    ),
    returns: t(
      'A fresh `ReadonlyMap<string, IKeyValueStore>`; mutating the copy never changes host registrations.',
      '新的 `ReadonlyMap<string, IKeyValueStore>`；修改副本不会改变宿主登记。'
    ),
    example: `[...host.backends().keys()]`
  },
  hasReactiveBackend: {
    summary: t(
      'Tells whether an id has a reactive adapter.',
      '判断某个 id 是否安装了响应式适配器。'
    ),
    params: { id: t('Backend id to check.', '要检查的后端 id。') },
    returns: t('`true` when reactive.', '具备响应式能力时返回 `true`。'),
    example: `host.hasReactiveBackend('app')`
  },
  reactiveBackend: {
    summary: t(
      'Returns the reactive handle of an id: `{ id, store, liveQuery }`.',
      '返回某个 id 的响应式句柄：`{ id, store, liveQuery }`。'
    ),
    params: {
      id: t(
        'Id of a backend installed with a `*Reactive` plugin.',
        '通过 `*Reactive` 插件安装的后端 id。'
      )
    },
    returns: t(
      'An `IReactiveBackendHandle`; non-reactive ids throw `REACTIVE_ADAPTER_NOT_INSTALLED`.',
      '一个 `IReactiveBackendHandle`；非响应式 id 抛 `REACTIVE_ADAPTER_NOT_INSTALLED`。'
    ),
    example: `const handle = host.reactiveBackend('app')`
  },
  dispose: {
    summary: t(
      'Stops admission, cancels an installation in progress, waits for running work, then releases adapters and stores. Repeated calls share one Promise; afterwards every call throws `STORAGE_HOST_DISPOSED`.',
      '停止接纳、取消进行中的安装、等待运行中的工作，然后释放适配器与存储。重复调用共享同一个 Promise；之后的调用都会抛 `STORAGE_HOST_DISPOSED`。'
    ),
    returns: t(
      'Resolves when released; cleanup errors are aggregated.',
      '释放完成后 resolve；清理错误会被聚合。'
    ),
    example: `await host.dispose()`
  },
  liveQuery: {
    summary: t(
      'Only with reactive backends: creates a live query; see `ILiveQueryOptions`.',
      '仅在有响应式后端时可用：创建实时查询，见 `ILiveQueryOptions`。'
    ),
    params: {
      options: t(
        '`{ backendId, runtime, query, ... }`.',
        '实时查询选项 `{ backendId, runtime, query, ... }`。'
      )
    },
    returns: t('An `ILiveQuery`.', '一个实时查询对象 `ILiveQuery`。'),
    example: `const query = host.liveQuery({ backendId: 'app', runtime, query: ({ store }) => store.get('theme') })`
  }
}

/** Host example used by the host instance types. */
const createHostExample = `import { createStorageHost } from '@migaia/storage-web/host'
import { indexedDbBackendPlugin } from '@migaia/storage-web/plugins/indexed-db'
import { memoryBackendPlugin } from '@migaia/storage-web/plugins/memory'

const host = await createStorageHost({
  plugins: [memoryBackendPlugin({ id: 'cache' }), indexedDbBackendPlugin({ id: 'primary', dbName: 'app-data' })] as const
})
await host.backend('cache').set('theme', 'dark')
console.log(host.hasBackend('primary'), [...host.backends().keys()])
await host.dispose()`

/** Repository members (`IRepository`). */
const repositoryMembers: Readonly<Record<string, IMemberDoc>> = {
  get: {
    summary: t(
      'Reads one record by primary key, migrating and validating it.',
      '按主键读取一条记录，并执行迁移与校验。'
    ),
    params: {
      id: t(
        'Primary key value (the `key` property of the record).',
        '主键值（即记录上 `key` 指定的属性）。'
      ),
      ctx: t('`{ signal?, timeoutMs? }`.', '操作上下文 `{ signal?, timeoutMs? }`。')
    },
    returns: t('The record, or `undefined` when absent.', '读取到的记录；不存在时为 `undefined`。'),
    example: `const user = await users.get('ada')`
  },
  put: {
    summary: t(
      'Validates, normalises, encodes and writes a record (and its index entries).',
      '校验、规范化、编码并写入一条记录（以及其索引项）。'
    ),
    params: {
      value: t(
        'The domain object; its `key` property is the primary key.',
        '领域对象；其 `key` 属性就是主键。'
      ),
      ctx: t('Write context.', '写入时的操作上下文。')
    },
    returns: t(
      'The stored key; unique index clashes throw `INDEX_UNIQUE_CONFLICT`.',
      '写入的存储 key；唯一索引冲突时抛 `INDEX_UNIQUE_CONFLICT`。'
    ),
    example: `await users.put({ id: 'ada', email: 'ada@example.com' })`
  },
  remove: {
    summary: t('Deletes a record by primary key.', '按主键删除一条记录及其索引。'),
    params: {
      id: t('Primary key value.', '要删除记录的主键值。'),
      ctx: t('Operation context.', '操作上下文，可用于取消。')
    },
    returns: t('Resolves after removal.', '删除完成后 resolve。'),
    example: `await users.remove('ada')`
  },
  list: {
    summary: t(
      'Reads many records, optionally by key range, order and limit; invalid records follow `onInvalid`.',
      '读取多条记录，可按 key 范围、排序与数量限制；无效记录按 `onInvalid` 处理。'
    ),
    params: {
      options: t(
        '`IListOptions` or indexed options `{ index, range }`.',
        '`IListOptions`，或带索引的选项 `{ index, range }`。'
      ),
      ctx: t('Operation context.', '操作上下文，可用于取消。')
    },
    returns: t('An array of records.', '记录数组。'),
    example: `const recent = await users.list({ limit: 20, direction: 'prev' })`
  },
  stream: {
    summary: t('Same as `list` but yields records one by one.', '与 `list` 相同，但逐条产出记录。'),
    params: {
      options: t('Same as `list`.', '与 `list` 相同的选项。'),
      ctx: t('Operation context.', '操作上下文，可用于取消。')
    },
    returns: t('An async iterator.', '记录的异步迭代器。'),
    example: `for await (const user of users.stream()) console.log(user.id)`
  },
  findBy: {
    summary: t('Finds the first record with an index key.', '按索引 key 查找第一条记录。'),
    params: {
      index: t('Index name declared in `indexes`.', '在 `indexes` 中声明的索引名称。'),
      key: t('Index key value.', '要查找的索引 key 值。'),
      ctx: t('Operation context.', '操作上下文，可用于取消。')
    },
    returns: t('The record or `undefined`.', '找到的记录或 `undefined`。'),
    example: `await users.findBy('byEmail', 'ada@example.com')`
  },
  findManyBy: {
    summary: t('Finds records whose index key is in a range.', '查找索引 key 位于某范围内的记录。'),
    params: {
      index: t('Index name.', '在 `indexes` 中声明的索引名称。'),
      range: t('`{ lower?, upper? }` of index keys.', '索引 key 的范围 `{ lower?, upper? }`。'),
      options: t(
        '`limit`, `direction`, `onInvalid`.',
        '查询选项：`limit`、`direction`、`onInvalid`。'
      ),
      ctx: t('Operation context.', '操作上下文，可用于取消。')
    },
    returns: t('An array of records.', '匹配的记录数组。'),
    example: `await users.findManyBy('byTag', { lower: 'compiler', upper: 'compiler' })`
  },
  streamBy: {
    summary: t(
      'Same as `findManyBy` but yields records one by one.',
      '与 `findManyBy` 相同，但逐条产出记录。'
    ),
    params: {
      index: t('Index name.', '在 `indexes` 中声明的索引名称。'),
      range: t('Index key range.', '索引 key 的范围。'),
      options: t('Query options.', '查询选项，例如 `limit`。'),
      ctx: t('Operation context.', '操作上下文，可用于取消。')
    },
    returns: t('An async iterator.', '记录的异步迭代器。'),
    example: `for await (const user of users.streamBy('byTag', { lower: 'a', upper: 'b' })) console.log(user)`
  },
  migrate: {
    summary: t(
      'Upgrades stored records to the current version in batches; IndexedDB keeps a checkpoint to resume. Record backends materialize the current raw value inside the write transaction. A concurrently upgraded current-version value is preserved and counted as alreadyCurrent; without contention each migration callback runs once.',
      '分批把已存储记录升级到当前版本；索引数据库保存检查点以便续跑。记录后端在写事务内物化当前原始值；并发更新已达到当前版本时保留该值并计入 `alreadyCurrent`，无竞争时每个迁移回调仍执行一次。'
    ),
    params: {
      options: t(
        '`{ batchSize? (default 100), onInvalid? }`.',
        '迁移选项 `{ batchSize?（默认 100）, onInvalid? }`。'
      ),
      ctx: t('Operation context.', '操作上下文，可用于取消。')
    },
    returns: t(
      'Counts `{ scanned, eligible, migrated, skipped, alreadyCurrent, conflicted }`.',
      '统计结果 `{ scanned, eligible, migrated, skipped, alreadyCurrent, conflicted }`。'
    ),
    example: `const result = await users.migrate({ batchSize: 200 })`
  },
  batch: {
    summary: t(
      'Runs reads and writes in one transaction on structured backends; key-value backends throw `UNSUPPORTED_CAPABILITY`. Fallback unique constraints check the final draft, allowing a previous owner to be deleted later in the same batch. Failure leaves the draft uncommitted.',
      '在结构化后端的一个事务中执行读写；键值后端抛 `UNSUPPORTED_CAPABILITY`。回退唯一约束校验最终草稿，允许在同批次后续删除旧所有者；失败不提交草稿。'
    ),
    params: {
      run: t(
        '`(tx) => Promise`; `tx` has `get`, `put`, `remove`.',
        '事务回调 `(tx) => Promise`；`tx` 提供 `get`、`put`、`remove`。'
      ),
      ctx: t('Operation context.', '操作上下文，可用于取消。')
    },
    returns: t(
      'The callback result; concurrent writes throw `TRANSACTION_CONFLICT` (retry).',
      '回调的结果；并发写冲突时抛 `TRANSACTION_CONFLICT`（可重试）。'
    ),
    example: `await orders.batch(async (tx) => {
  for (const item of items) await tx.put(item)
})`
  }
}

/** Repository example. */
const repositoryExample = `import { defineEntity } from '@migaia/storage-web/entity'
import { indexedDbHost } from '@migaia/storage-web/indexed-db'

type IUser = { id: string; email: string }
const users = defineEntity<IUser>()({
  name: 'users',
  key: 'id',
  version: 2,
  migrations: { 2: async (previous) => previous },
  indexes: { byEmail: { path: 'email', unique: true } }
}).connect(indexedDbHost({ dbName: 'app-data' }))
await users.put({ id: 'ada', email: 'ada@example.com' })
console.log(await users.findBy('byEmail', 'ada@example.com'))`

/** Reference of `@migaia/storage-web`. */
export const storageWebReference: ILibraryReference = {
  modules: {
    index: {
      summary: t(
        'Root entry point: ten exports covering the stable error contract, `StorageErrorText` and the default namespace codec. Import host APIs from `@migaia/storage-web/host`, memory storage from `@migaia/storage-web/memory`, other backends from their exact subpaths, and neutral store types from `@migaia/storage-contract`.',
        '根入口只有错误契约、`StorageErrorText` 与默认命名空间编码器相关的十项导出。宿主从 `@migaia/storage-web/host` 导入，内存存储从 `@migaia/storage-web/memory` 导入，其他后端使用各自精确子路径；中立存储类型从 `@migaia/storage-contract` 导入。'
      ),
      example: `import { StorageError, StorageErrorCode } from '@migaia/storage-web'

try {
  await store.set('k', 'v')
} catch (error) {
  if (error instanceof StorageError && error.code === StorageErrorCode.quotaExceeded) freeSpace()
}`
    },
    'local-storage': {
      summary: t(
        'Keep small text settings in browser `localStorage`, with a namespace that separates your keys from other users of the same storage. Import this backend subpath to create a store directly; the package root supplies shared error and key utilities.\n\nStart with `localStorageHost({ namespace })`, then use `get()` and `set()` for asynchronous calls or `sync` for immediate access. This backend stores strings; use the IndexedDB entry for records or transactions.',
        '将少量文本设置保存在浏览器的 `localStorage` 中，并用命名空间隔离不同用途的键。直接创建存储时导入此后端子路径；包的根入口提供共享的错误与键处理工具。\n\n从 `localStorageHost({ namespace })` 开始，通过 `get()`、`set()` 异步读写，或通过 `sync` 立即读写。此后端只保存字符串；需要记录或事务时选择 IndexedDB 入口。'
      ),
      example: `import { localStorageHost } from '@migaia/storage-web/local-storage'\n\nconst store = localStorageHost({ namespace: 'settings' })`
    },
    'session-storage': {
      summary: t(
        'Use browser `sessionStorage` through a namespaced store when that is where your page keeps temporary text values. Choose this subpath for the session-storage backend rather than the shared utilities at the package root.\n\nStart with `sessionStorageHost({ namespace })`; its `get()` and `set()` methods wrap text reads and writes, and `sync` exposes immediate access. Choose the local-storage entry when you intend to use `localStorage` instead.',
        '通过带命名空间的存储访问浏览器 `sessionStorage`，用于页面保存在该处的临时文本值。此子路径创建会话存储后端，根入口则提供共享工具。\n\n从 `sessionStorageHost({ namespace })` 开始，用 `get()`、`set()` 读写文本，也可通过 `sync` 立即读写。如果目标是 `localStorage`，应选择对应的本地存储入口。'
      ),
      example: `import { sessionStorageHost } from '@migaia/storage-web/session-storage'\n\nconst store = sessionStorageHost({ namespace: 'wizard' })`
    },
    cookies: {
      summary: t(
        'Read and write cookies visible through `document.cookie` using the same key-value interface as other stores. Import this subpath for a cookie store; the root entry contains shared utilities rather than backend factories.\n\nStart with `cookiesHost({ scope })` to fix the path and other cookie scope settings used by both writes and removals. Cookies marked `HttpOnly` are hidden from JavaScript, so a missing result does not prove that no such cookie exists.',
        '通过其他存储也使用的键值接口，读写 `document.cookie` 能看到的浏览器小型数据条目。创建此类存储时使用这个子路径，根入口提供共享工具而非后端工厂。\n\n从 `cookiesHost({ scope })` 开始，固定写入和删除共同使用的路径等作用范围。标有 `HttpOnly` 的条目对脚本不可见，因此读不到并不代表它不存在。'
      ),
      example: `import { cookiesHost } from '@migaia/storage-web/cookies'\n\nconst jar = cookiesHost({ scope: { path: '/', secure: true, sameSite: 'lax' } })`
    },
    'indexed-db': {
      summary: t(
        'Store browser records and bytes when text storage is too limited, or group related changes in a transaction so they commit together. Choose this subpath for the IndexedDB backend; the root entry does not create stores.\n\nStart with `indexedDbHost({ dbName })`, then use `putRecord()` and `getRecord()` to save and retrieve structured values. It also supports indexes for looking up records by fields other than their primary key; use the entity entry to define typed record operations above the backend.',
        '当文本存储无法满足需求时，在浏览器中保存记录和字节数据，也可用事务让一组相关修改一起提交。此子路径提供 IndexedDB 后端，根入口不负责创建存储。\n\n从 `indexedDbHost({ dbName })` 开始，用 `putRecord()` 和 `getRecord()` 保存、读取结构化值。此后端还支持索引，即按主键之外的字段查找记录；需要定义带类型的记录操作时，再使用实体入口。'
      ),
      example: `import { indexedDbHost } from '@migaia/storage-web/indexed-db'\n\nconst db = indexedDbHost({ dbName: 'app-data' })`
    },
    memory: {
      summary: t(
        'Use an isolated in-memory store for tests, server rendering, or an explicit fallback when browser storage is unavailable. Import this subpath for `memoryStorageHost()` without requiring browser document or storage types; the root entry is for shared utilities.\n\nEach call creates a separate store with text, byte and record operations. Values stay in that instance rather than a persistent browser database, and this backend does not provide secondary indexes.',
        '在测试、服务端渲染或浏览器存储不可用时，用独立的内存存储承接数据。此子路径提供 `memoryStorageHost()`，不要求浏览器文档或存储接口的类型；根入口则提供共享工具。\n\n每次调用都创建一份独立存储，可保存文本、字节和记录。数据只留在该实例中，不会保存到浏览器数据库；此后端不提供按其他字段查找记录的二级索引。'
      ),
      example: `import { memoryStorageHost } from '@migaia/storage-web/memory'\n\nconst store = memoryStorageHost()`
    },
    entity: {
      summary: t(
        'Define typed records once and reuse their read and write operations with different storage backends. Choose this subpath for record definitions and repositories, rather than the shared utilities at the package root.\n\nStart with `defineEntity()` to describe the record name, primary key and optional validation or version changes. Its `connect(store)` method returns operations such as `get()` and `put()`; create the actual store through a backend entry first.',
        '一次定义带类型的记录，再把同一套读写规则用于不同存储后端。此子路径提供记录定义与读写接口，根入口则提供共享工具。\n\n从 `defineEntity()` 开始，声明记录名称、主键，以及可选的数据校验或版本转换规则。调用定义上的 `connect(store)` 后即可使用 `get()`、`put()` 等操作；实际存储仍需先从对应后端入口创建。'
      ),
      example: repositoryExample
    },
    schema: {
      summary: t(
        'Adapt record validation and version changes without creating a store or repository. Import this subpath for these data-shape tools; the package root does not export them.\n\nStart with `fromStandardSchema()` to wrap a validator implementing Standard Schema, a shared interface used by validation libraries. Use `runMigrations()` to apply declared conversions between saved versions in order; `passthrough()` is available when validation is deliberately omitted.',
        '为记录接入数据校验和版本转换，而不在此创建存储或记录读写接口。需要这些数据结构工具时导入本子路径，根入口不导出它们。\n\n从 `fromStandardSchema()` 开始，适配支持标准校验协议的校验器；该协议让不同校验库通过同一接口工作。用 `runMigrations()` 按顺序执行保存版本之间的转换；明确不需要校验时可选 `passthrough()`。'
      ),
      example: `import { fromStandardSchema } from '@migaia/storage-web/schema'\n\nconst schema = fromStandardSchema(UserSchema)`
    },
    serialize: {
      summary: t(
        'Choose how application values become storage data and how they are read back. Import this subpath for storage codecs, the paired encode and decode operations; the package root only exposes shared utilities.\n\nStart with `jsonCodec` for JSON text and `selectCodec()` to match a codec to the store capabilities. A byte codec can use a text encoding on a text-only store, but structured values are rejected there rather than silently converted to JSON.',
        '决定应用值如何转成可保存的数据，以及如何读回原值。此子路径提供编解码器，也就是成对的编码和解码操作；包的根入口只提供共享工具。\n\n从处理 JSON 文本的 `jsonCodec` 开始，再用 `selectCodec()` 根据存储能力选择写入方式。字节编解码器可在纯文本存储上转成文本保存，但结构化值不能在此被悄悄改成 JSON，而会被拒绝。'
      ),
      example: `import { jsonCodec } from '@migaia/storage-web/serialize'\n\nawait jsonCodec.encode({ a: 1 })`
    },
    host: {
      summary: t(
        'Manage several storage backends together and retrieve each by its configured identifier. Import this subpath for host creation and custom plugin contracts; choose a backend subpath when you only need a standalone store.\n\nStart with `createStorageHost({ plugins })`, then use `host.backend(id)` to access an installed store. Reactive plugins additionally enable `host.liveQuery()`, which refreshes a query as storage changes; ordinary backend plugins do not enable that API.',
        '集中管理多个存储后端，并按配置的标识取用各自的存储。创建宿主或编写自定义插件时导入此子路径；只需独立存储时直接选择后端入口。\n\n从 `createStorageHost({ plugins })` 开始，再用 `host.backend(id)` 取得已安装的存储。响应式插件还会启用 `host.liveQuery()`，让查询随存储变化而刷新；普通后端插件不启用这个接口。'
      ),
      example: createHostExample
    },
    'reactive-adapter': {
      summary: t(
        'Teach a custom storage backend how to tell the host that a query may need refreshing. Choose this advanced subpath for your own change source; built-in stores already have reactive plugin entries.\n\nStart with `defineReactiveAdapterFeature()` and provide a `subscribe` callback that calls `invalidate()` after a relevant change. Declare whether changes arrive as notifications, periodic checks, or both, and provide a check interval when polling is involved.',
        '为自定义存储后端接入变化通知，让宿主知道何时需要刷新查询。自行实现变化来源时选择此高级入口；内置后端已有对应的响应式插件入口。\n\n从 `defineReactiveAdapterFeature()` 开始，提供 `subscribe` 回调，在相关变化后调用 `invalidate()`。声明变化来自主动通知、定时检查，还是两者结合；使用定时检查时还须提供检查间隔。'
      ),
      example: `import { defineReactiveAdapterFeature } from '@migaia/storage-web/reactive-adapter'`
    },
    'plugins/reactive': {
      summary: t(
        'Choose a built-in storage backend and enable queries that refresh when its data changes. This subpath groups all five reactive plugin factories, while the root entry contains shared utilities; individual backend subpaths are also available.\n\nStart with `memoryReactive()` for an isolated memory store, or `indexedDbReactive()` for browser records and indexes. Pass the returned plugin to `createStorageHost({ plugins })` from the host entry to make `host.liveQuery()` available for that backend.',
        '选择内置存储后端，并启用随数据变化而刷新的查询。此子路径汇集五种响应式插件工厂，根入口则提供共享工具；也可从各后端的独立子路径导入。\n\n从 `memoryReactive()` 创建独立的内存后端，或用 `indexedDbReactive()` 保存浏览器记录并使用索引。把返回的插件交给宿主入口的 `createStorageHost({ plugins })`，即可为该后端使用 `host.liveQuery()`。'
      ),
      example: `import { memoryReactive } from '@migaia/storage-web/plugins/reactive/memory'`
    },
    'plugins/memory': {
      summary: t(
        'Install an isolated in-memory record store as a named backend in a storage host. Import this subpath for `memoryBackendPlugin()`; use the standalone backend entry when you do not need a host.\n\nPass the plugin to `createStorageHost({ plugins })`, then retrieve its store with `host.backend(id)`; the default identifier is `memory`. This plugin supplies storage access; choose the matching reactive plugin when queries must refresh after changes.',
        '把独立的内存记录存储作为具名后端装入存储宿主。此子路径提供 `memoryBackendPlugin()`；不需要宿主时可直接使用独立后端入口。\n\n把插件交给 `createStorageHost({ plugins })`，再通过 `host.backend(id)` 取得存储，默认标识为 `memory`。此插件提供存储访问；查询需要随变化刷新时，选择对应的响应式插件。'
      ),
      example: hostExample('memoryBackendPlugin', 'plugins/memory', 'memory')
    },
    'plugins/reactive/memory': {
      summary: t(
        'Install an isolated in-memory record store together with change tracking for queries that refresh as data changes. Choose this subpath for `memoryReactive()` when a plain backend plugin would not provide `host.liveQuery()`.\n\nPass its plugin to `createStorageHost({ plugins })`, then create queries for the configured backend identifier. Changes from this isolated store are pushed to the host; other memory instances do not share its data.',
        '安装独立的内存记录存储，并接入变化追踪，让查询随数据变化刷新。需要普通后端插件不提供的 `host.liveQuery()` 时，从此子路径导入 `memoryReactive()`。\n\n把返回的插件交给 `createStorageHost({ plugins })`，再为配置的后端标识创建查询。此独立存储将变化主动通知宿主；其他内存实例不共享它的数据。'
      ),
      example: hostExample('memoryReactive', 'plugins/reactive/memory', 'memory')
    },
    'plugins/local-storage': {
      summary: t(
        'Install a namespaced browser text store using `localStorage` as a named backend in a storage host. Import this subpath for `localStorageBackendPlugin()`; use the standalone backend entry when you do not need a host.\n\nPass the plugin to `createStorageHost({ plugins })`, then retrieve its store with `host.backend(id)`; the default identifier is `local`. This plugin supplies storage access; choose the matching reactive plugin when queries must refresh after changes.',
        '把基于 `localStorage`、按命名空间隔离的浏览器文本存储作为具名后端装入存储宿主。此子路径提供 `localStorageBackendPlugin()`；不需要宿主时可直接使用独立后端入口。\n\n把插件交给 `createStorageHost({ plugins })`，再通过 `host.backend(id)` 取得存储，默认标识为 `local`。此插件提供存储访问；查询需要随变化刷新时，选择对应的响应式插件。'
      ),
      example: hostExample('localStorageBackendPlugin', 'plugins/local-storage', 'local')
    },
    'plugins/reactive/local-storage': {
      summary: t(
        'Install a namespaced browser text store using `localStorage` together with change tracking for queries that refresh as data changes. Choose this subpath for `localStorageReactive()` when a plain backend plugin would not provide `host.liveQuery()`.\n\nPass its plugin to `createStorageHost({ plugins })`, then create queries for the configured backend identifier. The adapter combines change notifications with checks every 1000 ms, so updates are not a promise of immediate observation.',
        '安装基于 `localStorage`、按命名空间隔离的浏览器文本存储，并接入变化追踪，让查询随数据变化刷新。需要普通后端插件不提供的 `host.liveQuery()` 时，从此子路径导入 `localStorageReactive()`。\n\n把返回的插件交给 `createStorageHost({ plugins })`，再为配置的后端标识创建查询。适配器结合变化通知与每 1000 毫秒一次的检查，因此不保证变化会被立即观察到。'
      ),
      example: hostExample('localStorageReactive', 'plugins/reactive/local-storage', 'local')
    },
    'plugins/session-storage': {
      summary: t(
        'Install a namespaced browser text store using `sessionStorage` as a named backend in a storage host. Import this subpath for `sessionStorageBackendPlugin()`; use the standalone backend entry when you do not need a host.\n\nPass the plugin to `createStorageHost({ plugins })`, then retrieve its store with `host.backend(id)`; the default identifier is `session`. This plugin supplies storage access; choose the matching reactive plugin when queries must refresh after changes.',
        '把基于 `sessionStorage`、按命名空间隔离的浏览器文本存储作为具名后端装入存储宿主。此子路径提供 `sessionStorageBackendPlugin()`；不需要宿主时可直接使用独立后端入口。\n\n把插件交给 `createStorageHost({ plugins })`，再通过 `host.backend(id)` 取得存储，默认标识为 `session`。此插件提供存储访问；查询需要随变化刷新时，选择对应的响应式插件。'
      ),
      example: hostExample('sessionStorageBackendPlugin', 'plugins/session-storage', 'session')
    },
    'plugins/reactive/session-storage': {
      summary: t(
        'Install a namespaced browser text store using `sessionStorage` together with change tracking for queries that refresh as data changes. Choose this subpath for `sessionStorageReactive()` when a plain backend plugin would not provide `host.liveQuery()`.\n\nPass its plugin to `createStorageHost({ plugins })`, then create queries for the configured backend identifier. The adapter combines change notifications with checks every 1000 ms for the session storage it can access.',
        '安装基于 `sessionStorage`、按命名空间隔离的浏览器文本存储，并接入变化追踪，让查询随数据变化刷新。需要普通后端插件不提供的 `host.liveQuery()` 时，从此子路径导入 `sessionStorageReactive()`。\n\n把返回的插件交给 `createStorageHost({ plugins })`，再为配置的后端标识创建查询。适配器结合变化通知与每 1000 毫秒一次的检查，观察当前可访问的会话存储。'
      ),
      example: hostExample('sessionStorageReactive', 'plugins/reactive/session-storage', 'session')
    },
    'plugins/cookies': {
      summary: t(
        'Install a scoped cookie store using `document.cookie` as a named backend in a storage host. Import this subpath for `cookieBackendPlugin()`; use the standalone backend entry when you do not need a host.\n\nPass the plugin to `createStorageHost({ plugins })`, then retrieve its store with `host.backend(id)`; the default identifier is `cookies`. This plugin supplies storage access; choose the matching reactive plugin when queries must refresh after changes.',
        '把基于 `document.cookie`、固定作用范围的存储作为具名后端装入存储宿主。此子路径提供 `cookieBackendPlugin()`；不需要宿主时可直接使用独立后端入口。\n\n把插件交给 `createStorageHost({ plugins })`，再通过 `host.backend(id)` 取得存储，默认标识为 `cookies`。此插件提供存储访问；查询需要随变化刷新时，选择对应的响应式插件。'
      ),
      example: hostExample('cookieBackendPlugin', 'plugins/cookies', 'cookies')
    },
    'plugins/reactive/cookies': {
      summary: t(
        'Install a scoped cookie store using `document.cookie` together with change tracking for queries that refresh as data changes. Choose this subpath for `cookiesReactive()` when a plain backend plugin would not provide `host.liveQuery()`.\n\nPass its plugin to `createStorageHost({ plugins })`, then create queries for the configured backend identifier. The adapter combines notifications with checks every 1000 ms, and can observe only cookies visible to JavaScript.',
        '安装基于 `document.cookie`、固定作用范围的存储，并接入变化追踪，让查询随数据变化刷新。需要普通后端插件不提供的 `host.liveQuery()` 时，从此子路径导入 `cookiesReactive()`。\n\n把返回的插件交给 `createStorageHost({ plugins })`，再为配置的后端标识创建查询。适配器结合通知与每 1000 毫秒一次的检查，只能观察脚本可见的数据条目。'
      ),
      example: hostExample('cookiesReactive', 'plugins/reactive/cookies', 'cookies')
    },
    'plugins/indexed-db': {
      summary: t(
        'Install a browser record store with indexes and transactions as a named backend in a storage host. Import this subpath for `indexedDbBackendPlugin()`; use the standalone backend entry when you do not need a host.\n\nPass the plugin to `createStorageHost({ plugins })`, then retrieve its store with `host.backend(id)`; the default identifier is `indexed-db`. This plugin supplies storage access; choose the matching reactive plugin when queries must refresh after changes.',
        '把支持索引与事务的浏览器记录存储作为具名后端装入存储宿主。此子路径提供 `indexedDbBackendPlugin()`；不需要宿主时可直接使用独立后端入口。\n\n把插件交给 `createStorageHost({ plugins })`，再通过 `host.backend(id)` 取得存储，默认标识为 `indexed-db`。此插件提供存储访问；查询需要随变化刷新时，选择对应的响应式插件。'
      ),
      example: hostExample('indexedDbBackendPlugin', 'plugins/indexed-db', 'indexed-db')
    },
    'plugins/reactive/indexed-db': {
      summary: t(
        'Install a browser record store with indexes and transactions together with change tracking for queries that refresh as data changes. Choose this subpath for `indexedDbReactive()` when a plain backend plugin would not provide `host.liveQuery()`.\n\nPass its plugin to `createStorageHost({ plugins })`, then create queries for the configured backend identifier. The adapter combines notifications with checks every 1000 ms; the underlying store still supports indexes and transactions.',
        '安装支持索引与事务的浏览器记录存储，并接入变化追踪，让查询随数据变化刷新。需要普通后端插件不提供的 `host.liveQuery()` 时，从此子路径导入 `indexedDbReactive()`。\n\n把返回的插件交给 `createStorageHost({ plugins })`，再为配置的后端标识创建查询。适配器结合通知与每 1000 毫秒一次的检查，底层存储仍支持索引与事务。'
      ),
      example: hostExample('indexedDbReactive', 'plugins/reactive/indexed-db', 'indexed-db')
    }
  },
  symbols: {
    localStorageHost: {
      role: 'factory',
      purpose: t(
        'Creates a namespaced `localStorage` store with async and `sync` APIs. A probe write at creation detects private-mode failures early (`BACKEND_UNAVAILABLE`).',
        '创建带命名空间的 `localStorage` 存储，提供异步与 `sync` 两套 API。创建时会写入一次探测值，提前发现隐私模式下的失败（`BACKEND_UNAVAILABLE`）。'
      ),
      returns: t(
        'A key-value store with `sync`; capabilities: text only, about 5 MiB.',
        '带 `sync` 的键值存储；能力：仅文本，约 5 MiB。'
      ),
      options: 'ILocalStorageOptions',
      example: `const store = localStorageHost({ namespace: 'settings' })
await store.set('theme', 'dark')
store.sync.get('theme') // 'dark'`
    },
    sessionStorageHost: {
      role: 'factory',
      purpose: t(
        'Same as `localStorageHost` on `sessionStorage`: data lives until the tab closes.',
        '与 `localStorageHost` 相同，但使用 `sessionStorage`：数据在当前标签页关闭前一直存在。'
      ),
      returns: t('A key-value store with `sync`.', '带 `sync` 同步接口的键值存储。'),
      options: 'ISessionStorageOptions',
      example: `const draft = sessionStorageHost({ namespace: 'checkout' })`
    },
    cookiesHost: {
      role: 'factory',
      purpose: t(
        'Creates a cookie store with a fixed scope. `set(key, value, { maxAge | expires })` writes a cookie; values over 4096 bytes throw `VALUE_TOO_LARGE`; several visible scopes of one name throw `COOKIE_SCOPE_AMBIGUOUS`.',
        '创建具有固定作用域的 cookie 存储。`set(key, value, { maxAge | expires })` 写入 cookie；值超过 4096 字节抛 `VALUE_TOO_LARGE`；同名 cookie 在多个作用域可见时抛 `COOKIE_SCOPE_AMBIGUOUS`。'
      ),
      returns: t(
        'A cookie store with `sync`; HttpOnly cookies are invisible, so `has()` false does not prove absence.',
        '带 `sync` 的 cookie 存储；HttpOnly cookie 不可见，因此 `has()` 为 false 并不代表不存在。'
      ),
      options: 'ICookiesOptions',
      example: `const jar = cookiesHost({ namespace: 'app', scope: { path: '/', secure: true, sameSite: 'lax' } })
await jar.set('session', 'abc123', { maxAge: 3600 })`
    },
    indexedDbHost: {
      role: 'factory',
      purpose: t(
        'Creates an IndexedDB store with values, bytes, records, transactions, iteration and secondary indexes. The connection opens once and yields to version upgrades from other tabs. `ensureRecordIndexes` races shared opening against the operation deadline through `raceWithAbort`; stopping one waiter leaves shared preparation owned by the backend. `iterateRecordIndex` uses one deadline across the whole iterator, including buffered yields, and releases its abort subscription and timer in finally when iteration completes or the consumer calls return.',
        '创建支持值、字节、记录、事务、迭代与二级索引的 IndexedDB 存储。连接只打开一次，并为其他标签页的版本升级让路。`ensureRecordIndexes` 通过 `raceWithAbort` 让共享打开与操作截止时间竞争；单个等待者停止等待后，共享准备仍由后端持有。`iterateRecordIndex` 在整个迭代生命周期共用一个截止时间，包括缓冲结果产出期间；迭代结束或消费者调用返回方法时，在最终清理中释放中止订阅与计时器。'
      ),
      returns: t(
        'A record store with change feed; capabilities report what is native.',
        '支持变更通知的记录存储；能力字段如实说明哪些是原生支持的。'
      ),
      options: 'IIndexedDbOptions',
      example: `const db = indexedDbHost<{ id: string }>({ dbName: 'app-data' })
await db.putRecord({ id: 'ada' }, 'ada')
for await (const [key, value] of db.iterateRecords()) console.log(key, value)`
    },
    memoryStorageHost: {
      role: 'factory',
      purpose: t(
        'Creates an independent volatile store in memory with records, bytes, transactions and change feed. Cross-channel replacement commits all removals and the destination write before publishing remove then put notifications, so reentrant observers see the complete commit. Nothing is shared between calls.',
        '在内存中创建独立的易失存储，支持记录、字节、事务与变更通知。跨通道替换先完成所有删除和目标写入，再依次发布删除与写入通知，重入观察者看到完整提交；每次调用之间不共享数据。'
      ),
      returns: t('A record store with `sync` and change feed.', '带 `sync` 与变更通知的记录存储。'),
      example: `const store = memoryStorageHost<{ id: string }>()
await store.putRecord({ id: '1' }, '1')`
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
      example: `if (error instanceof StorageError && error.code === StorageErrorCode.transactionConflict) await retry()`
    },
    StorageErrorCode: {
      role: 'constant',
      purpose: t(
        'Table of this package’s 37 stable error codes; values are the strings on error.code. `INDEX_BACKFILL_FAILED` identifies backfill and failed-readiness persistence failing together on a native AggregateError.',
        '本包三十七个稳定错误码的对照表，值为错误对象的 `code` 字符串。`INDEX_BACKFILL_FAILED` 标识回填与失败就绪状态保存同时失败，交付原生聚合错误。'
      ),
      example: `if (error.code === StorageErrorCode.quotaExceeded) await cleanupOldEntries()`
    },
    StorageErrorText: {
      role: 'constant',
      purpose: t(
        'Stable message texts used by this package, for custom backends and codecs that want the same wording; branch on `code`, not on text.',
        '本包使用的稳定错误文本，供自定义后端与编解码器复用相同措辞；业务分支请比较 `code`，不要比较文本。'
      ),
      example: `throw new StorageError(StorageErrorCode.invalidConfig, {}, StorageErrorText.backendIdInvalid)`
    },
    defineEntity: {
      role: 'factory',
      purpose: t(
        'Defines a typed record kind: primary key, schema, codec, version with migrations, read validation and secondary indexes. Use the curried form `defineEntity<T>()({...})` when declaring `indexes`. `connect(store)` binds it to a store.',
        '定义一类类型化记录：主键、schema、编解码器、带迁移的版本、读取校验以及二级索引。声明 `indexes` 时使用柯里化形式 `defineEntity<T>()({...})`。`connect(store)` 把它绑定到某个存储。'
      ),
      returns: t(
        'An `IEntityDefinition`; every target step from 2 through version must be declared. A version above 1 with omitted migrations is also incomplete and throws `INVALID_CONFIG`.',
        '返回 `IEntityDefinition`；必须声明从二到当前版本的每个目标迁移步骤。高于一的版本省略迁移表也属于不完整，抛 `INVALID_CONFIG`。'
      ),
      options: 'IEntityOptions',
      example: repositoryExample,
      scenarios: [
        t(
          'Store user preferences or cached records with validation and safe upgrades.',
          '在校验与安全升级的前提下保存用户偏好或缓存记录。'
        )
      ]
    },
    createStorageHost: {
      role: 'factory',
      purpose: t(
        'Creates a storage host and installs the initial plugins atomically before resolving: either every backend is ready or nothing is published.',
        '创建存储宿主，并在 resolve 前原子地安装初始插件：要么所有后端都就绪，要么什么都不发布。'
      ),
      returns: t(
        'An `IStorageHost` typed by the plugin ids; installation failures throw `BACKEND_INSTALL_FAILED`.',
        '一个按插件 id 类型化的 `IStorageHost`；安装失败时抛 `BACKEND_INSTALL_FAILED`。'
      ),
      options: 'IStorageHostCreateOptions',
      example: createHostExample,
      scenarios: [
        t(
          'Choose between memory, local and IndexedDB storage by id at runtime.',
          '在运行时按 id 在内存、本地存储与 IndexedDB 之间选择。'
        )
      ]
    },
    StorageHostFacade: {
      role: 'factory',
      returns: t(
        'A new empty StorageHostFacade with snapped scheduler and installation budget; no backend is installed by construction. Install backend plugins through use() and await dispose() at the end of its lifetime.',
        '返回已捕获调度器与安装预算的新空存储宿主，构造不会安装后端；通过安装方法加入后端插件，生命周期结束时等待释放方法。'
      ),
      purpose: t(
        'The host class used by `createStorageHost`; constructing it directly gives an empty host to fill with `await host.use(plugin)`.',
        '`createStorageHost` 所使用的宿主类；直接构造会得到一个空宿主，之后用 `await host.use(plugin)` 安装后端。'
      ),
      options: 'IStorageHostOptions',
      example: `const host = new StorageHostFacade({ installTimeoutMs: 10_000 })
await host.use(memoryBackendPlugin({ id: 'cache' }))`
    },
    definePlugin: {
      role: 'factory',
      purpose: t(
        'Defines a custom backend plugin: `descriptorFactory(core)` must call `core.registerStore(store)` and may return `install` / `expose` APIs; `features` can add a reactive adapter.',
        '定义自定义后端插件：`descriptorFactory(core)` 必须调用 `core.registerStore(store)`，并可返回 `install` / `expose` API；`features` 可以加入响应式适配器。'
      ),
      params: {
        name: t('Backend id of the plugin.', '该插件的后端 id。'),
        descriptorFactory: t(
          '`(core) => descriptor`, called once at installation with an `IStoragePluginCore`.',
          '`(core) => descriptor`，安装时以 `IStoragePluginCore` 调用一次。'
        ),
        features: t(
          'Optional Features, e.g. `{ reactive: defineReactiveAdapterFeature(...) }`.',
          '可选的 Feature，例如 `{ reactive: defineReactiveAdapterFeature(...) }`。'
        )
      },
      returns: t(
        'A plugin handle for `createStorageHost` / `host.use`.',
        '可交给 `createStorageHost` / `host.use` 的插件句柄。'
      ),
      example: `const remote = definePlugin('remote', (core) => {
  core.registerStore(createRemoteStore())
  return {}
})`
    },
    defineFeature: {
      role: 'factory',
      purpose: t(
        'Defines an optional capability for a storage plugin, such as reading its key count. A Host manages plugin installation and cleanup. A Feature is the recipe for one capability; a Plugin combines a store and selected capabilities for the Host to install. Calling defineFeature only saves the recipe: it creates no Host and opens no storage. Pass the result as the third argument of definePlugin, then install the plugin with createStorageHost({ plugins }) or host.use(). Each installation uses its own store and capability output. To let application code call capability methods, return those methods from install.',
        '给存储插件定义一项可选能力，例如读取键的数量。Host 是管理插件安装和清理的宿主对象。Feature 是创建一项能力的定义；Plugin 把存储和选定能力组合起来，供宿主安装。调用 defineFeature 只保存能力定义，不会创建宿主或打开存储。把返回值作为第三个参数交给 `definePlugin()`，再通过 `createStorageHost({ plugins })` 或 `host.use()` 安装插件。每次安装使用各自的存储和能力输出。应用需要调用能力方法时，从 `install` 返回这些方法。'
      ),
      params: {
        factory: t(
          'A required synchronous function that builds the capability object during plugin installation. core.featureExpose supplies getStore() and getBackendId() for this installation. The second argument contains the outputs of other capabilities listed in dependencies. Return the object whose methods the plugin will use; the factory itself must not return a Promise.',
          '必填的同步函数，在插件安装期间创建能力对象。`core.featureExpose` 提供本次安装的 getStore() 和 getBackendId()，用来访问存储和后端名称。第二个参数包含 dependencies 所列其他能力的输出。返回插件要使用的能力对象，工厂自身不能返回 Promise。'
        ),
        dependencies: t(
          'List other capabilities this factory needs by assigning each Feature reference a name. Their outputs are passed to the factory’s second argument under those names. Omit the record when the factory only needs the store and backend id supplied by core.featureExpose.',
          '如果工厂需要其他能力，把相应 Feature 引用按名称放在这个对象中。工厂的第二个参数会按这些名称提供对应的能力输出。只需要 `core.featureExpose` 提供的存储和后端名称时，可以省略。'
        )
      },
      returns: t(
        'A Feature for `definePlugin(name, factory, features)`.',
        '可交给 `definePlugin(name, factory, features)` 的 Feature。'
      ),
      exampleIntro: t(
        'The example adds key-counting behavior to an in-memory cache. metrics builds the counting methods, cachePlugin registers the memory store, and install saves one user before returning methods that application code can call.',
        '下面为内存缓存添加统计键数量的能力。metrics 创建统计方法，cachePlugin 登记内存存储，install 保存一个用户后返回供应用调用的方法。'
      ),
      example: storageFeatureExample,
      exampleResult: t(
        'Both assertions pass and the output is 1 cache: one stored key and the plugin’s backend name. The empty Host has no count method. After cachePlugin is installed, cache.extensions.count() calls the method returned by install. The finally block closes the Host, removes the plugin and releases its memory store.',
        '两项断言通过，输出为 `1 cache`，分别表示一个已保存的键和插件的后端名称。空宿主没有统计方法；安装 cachePlugin 后，`cache.extensions.count()` 才能调用 install 返回的方法。finally 中关闭宿主，会移除插件并释放内存存储。'
      )
    },
    assertStorageBackendId: {
      role: 'operation',
      purpose: t(
        'Checks that a value is a valid backend id: `^[A-Za-z][A-Za-z0-9._-]{0,63}$`.',
        '检查某个值是否为合法的后端 id，规则为字母开头、最长 64 个字符：`^[A-Za-z][A-Za-z0-9._-]{0,63}$`。'
      ),
      params: { id: t('Value to check.', '要检查的值，通常来自配置。') },
      returns: t(
        'Nothing; invalid ids throw `BACKEND_ID_INVALID`.',
        '无返回值；id 不合法时抛 `BACKEND_ID_INVALID`。'
      ),
      example: `assertStorageBackendId(config.backend)`
    },
    storageBackendPluginExtensionsBrand: {
      role: 'constant',
      purpose: t(
        'Type-level brand carrying the extension type of a plugin handle; not used at runtime.',
        '在类型层面携带插件句柄扩展类型的品牌标记；运行时不使用。'
      ),
      example: `type IExt = IStorageBackendPluginHandle[typeof storageBackendPluginExtensionsBrand]`
    },
    prepareIndexedDbStore: {
      role: 'operation',
      purpose: t(
        'Opens and upgrades an IndexedDB store inside a custom plugin, after its disposer was registered.',
        '在自定义插件中、登记好清理函数之后，打开并升级 IndexedDB 存储。'
      ),
      params: {
        store: t('Store created by `indexedDbHost()`.', '由 `indexedDbHost()` 创建的存储。')
      },
      returns: t('Resolves when the database is ready.', '数据库就绪后 resolve。'),
      example: `await prepareIndexedDbStore(store)`
    },
    defineReactiveAdapterFeature: {
      role: 'factory',
      purpose: t(
        'Defines the reactive adapter Feature of a custom backend: `mode`, `visibility`, optional `pollIntervalMs` and `subscribe(context)` which calls `context.invalidate(change)` when data changes.',
        '为自定义后端定义响应式适配器 Feature：`mode`、`visibility`、可选的 `pollIntervalMs`，以及在数据变化时调用 `context.invalidate(change)` 的 `subscribe(context)`。'
      ),
      params: {
        definition: t('`IReactiveAdapterDefinition`.', '适配器定义 `IReactiveAdapterDefinition`。')
      },
      returns: t(
        'A Feature to pass as `definePlugin(name, factory, { reactive })`.',
        '可作为 `definePlugin(name, factory, { reactive })` 传入的 Feature。'
      ),
      example: `const reactive = defineReactiveAdapterFeature({
  mode: 'push',
  visibility: 'instance',
  subscribe: ({ store, invalidate }) => store.onChange((change) => invalidate(change))
})`
    },
    passthrough: {
      role: 'factory',
      purpose: t(
        'Schema adapter that accepts any value without validation; the default of `defineEntity`.',
        '不做任何校验、原样接受值的 schema 适配器；是 `defineEntity` 的默认值。'
      ),
      returns: t(
        '`{ name: "passthrough", validate }`.',
        '`{ name: "passthrough", validate }` 适配器对象。'
      ),
      example: `defineEntity<IUser>({ name: 'users', key: 'id', schema: passthrough<IUser>() })`
    },
    fromStandardSchema: {
      role: 'factory',
      purpose: t(
        'Adapts a Standard Schema v1 validator (zod 3.24+, valibot 1+, arktype 2+) for entities.',
        '把实现了 Standard Schema v1 规范的第三方校验器（zod 3.24+、valibot 1+、arktype 2+）适配为实体可直接使用的 schema。'
      ),
      params: {
        schema: t('A schema object with `~standard`.', '带 `~standard` 属性的 schema 对象。')
      },
      returns: t(
        'A schema adapter; invalid schema descriptors throw `INVALID_CONFIG` at construction. Validator synchronous throws and asynchronous rejections become `VALIDATION_FAILED` with the original failure on cause; issue results use joined issue messages.',
        '返回结构校验适配器；构造时描述器无效抛 `INVALID_CONFIG`。校验器同步抛错与异步拒绝统一为 `VALIDATION_FAILED`，原始失败保留在原因链；问题结果使用拼接后的问题信息。'
      ),
      example: `const schema = fromStandardSchema(z.object({ id: z.string() }))`
    },
    runMigrations: {
      role: 'operation',
      purpose: t(
        'Runs migration functions from `fromVersion + 1` to `toVersion` in order; a missing step is treated as no change.',
        '按顺序执行从 `fromVersion + 1` 到 `toVersion` 的迁移函数；缺少的步骤视为无变化。'
      ),
      params: {
        value: t('Stored value to upgrade.', '需要升级的已存储值。'),
        fromVersion: t(
          'Version of `value`, a non-negative safe integer.',
          '`value` 当前的版本号，非负安全整数。'
        ),
        toVersion: t('Target version.', '要升级到的目标版本号。'),
        migrations: t(
          '`{ [version]: (previous, ctx) => Promise }`.',
          '迁移函数表 `{ [版本]: (previous, ctx) => Promise }`。'
        ),
        signal: t('Optional cancellation.', '可选的取消信号。')
      },
      returns: t(
        'The upgraded value; failures throw `MIGRATION_FAILED`.',
        '升级后的值；失败时抛 `MIGRATION_FAILED`。'
      ),
      example: `await runMigrations(old, 1, 3, { 2: async (v) => ({ ...(v as object), a: 1 }), 3: async (v) => v })`
    },
    jsonCodec: {
      role: 'constant',
      purpose: t(
        'Codec storing JSON text; works on every backend but loses `Date`, `Map`, `Set`, bytes and cycles.',
        '保存 JSON 文本的编解码器；适用于所有后端，但会丢失 `Date`、`Map`、`Set`、字节与循环引用。'
      ),
      example: `await jsonCodec.encode({ a: 1 }) // '{"a":1}'`
    },
    structuredCodec: {
      role: 'constant',
      purpose: t(
        'Codec that passes objects through so record backends store them with structured clone (keeps `Date`, `Map`, `Set`, bytes, cycles); rejected on text-only backends.',
        '原样传递对象、由记录后端以 structured clone 保存的编解码器（保留 `Date`、`Map`、`Set`、字节与循环引用）；在仅文本后端上会被拒绝。'
      ),
      example: `const codec = selectCodec(structuredCodec, db.capabilities)`
    },
    binaryCodec: {
      role: 'constant',
      purpose: t(
        'Codec for `Uint8Array` values; text-only backends store them as Base64 through `selectCodec`.',
        '用于 `Uint8Array` 字节值的编解码器；仅文本后端经 `selectCodec` 自动以 Base64 形式保存。'
      ),
      example: `await binaryCodec.encode(new Uint8Array([1, 2, 3]))`
    },
    selectCodec: {
      role: 'operation',
      purpose: t(
        'Chooses how a codec writes on a backend: direct, reversible Base64 fallback for bytes on text backends, or rejection (`UNSUPPORTED_CAPABILITY`) for structured data on text backends.',
        '决定编解码器在某个后端上如何写入：直接写入；字节数据在仅文本后端上可逆地回退为 Base64；结构化数据在仅文本后端上直接拒绝（`UNSUPPORTED_CAPABILITY`）。'
      ),
      params: {
        codec: t(
          '`jsonCodec`, `structuredCodec`, `binaryCodec` or a custom codec.',
          '`jsonCodec`、`structuredCodec`、`binaryCodec` 或自定义编解码器。'
        ),
        capabilities: t(
          '`store.capabilities` of the target backend.',
          '目标后端的 `store.capabilities`。'
        ),
        onDiagnostic: t(
          'Receives a message when a fallback is used.',
          '使用回退路径时接收提示信息。'
        )
      },
      returns: t(
        'An `ISelectedCodec` with `encode` / `decode`.',
        '带 `encode` / `decode` 方法的 `ISelectedCodec`。'
      ),
      example: `const selected = selectCodec(binaryCodec, store.capabilities, console.warn)`
    },
    ...pluginSymbols
  },
  types: {
    ICodec: storageContractReference.types.ICodec!,
    ICodecOutput: storageContractReference.types.ICodecOutput!,
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
import { defineEntity } from '@migaia/storage-web/entity'
import { memoryStorageHost } from '@migaia/storage-web/memory'

const original = new StorageError(StorageErrorCode.validationFailed, { cause: new TypeError('invalid input') })
const store = memoryStorageHost()
const users = defineEntity<{ id: string }>({
  name: 'users',
  key: 'id',
  schema: { name: 'reject', validate: async () => { throw original } }
}).connect(store)
try {
  await users.put({ id: 'ada' })
} catch (error) {
  if (!(error instanceof Error)) throw error
  let current: unknown = error
  while (current instanceof Error && current !== original) current = current.cause
  console.log(current === original, error.message === original.message, original.cause)
} finally {
  await store.dispose()
}`,
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
    IStorageErrorCode: alias(
      'Union of `StorageErrorCode` values.',
      '`StorageErrorCode` 全部取值组成的联合类型。'
    ),
    IStorageChannel: alias(
      'Storage channels of one key: `value`, `bytes`, `record`.',
      '同一个 key 的三种存储通道：`value`、`bytes`、`record`。'
    ),
    IExtensionStage: alias(
      'Extension points: `schema`, `codec`, `migration`, `comparator`, `diagnostic`.',
      '出错的扩展点名称取值：`schema`、`codec`、`migration`、`comparator`、`diagnostic`。'
    ),
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
        }
      }
    },
    ILocalStorageOptions: {
      summary: t(
        'Options of `localStorageHost()` and `localStorageBackendPlugin()`.',
        '`localStorageHost()` 与本地存储插件共用的构造选项。'
      ),
      members: webStorageFields('localStorage')
    },
    ISessionStorageOptions: {
      summary: t(
        'Options of `sessionStorageHost()` and `sessionStorageBackendPlugin()`.',
        '`sessionStorageHost()` 与会话存储插件共用的构造选项。'
      ),
      members: webStorageFields('sessionStorage')
    },
    ICookiesOptions: {
      summary: t(
        'Options of `cookiesHost()` and the cookie plugins.',
        '`cookiesHost()` 与两个 cookie 插件共用的选项。'
      ),
      members: cookieFields
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
    IIndexedDbOptions: {
      summary: t(
        'Options of `indexedDbHost()` and the IndexedDB plugins.',
        '`indexedDbHost()` 与两个 IndexedDB 插件共用的选项。'
      ),
      members: indexedDbFields
    },
    IEntityOptions: {
      summary: t(
        'Options of `defineEntity()`.',
        '`defineEntity()` 的选项：主键、schema、版本与索引。'
      ),
      members: {
        name: {
          summary: t(
            'Entity name; non-empty and not starting with `__`.',
            '实体名称；非空，且不能以 `__` 开头。'
          )
        },
        key: {
          summary: t(
            'Property of the domain object used as primary key.',
            '作为主键的领域对象属性名。'
          )
        },
        schema: {
          summary: t('Validation and stored-shape conversion.', '校验以及存储形态的转换。'),
          default: t('`passthrough()`: no validation.', '`passthrough()`：不做校验。')
        },
        codec: {
          summary: t('How records are encoded on the backend.', '记录在后端上的编码方式。'),
          default: t(
            '`structuredCodec` on IndexedDB / memory, `jsonCodec` on text backends.',
            'IndexedDB / 内存上为 `structuredCodec`，仅文本后端上为 `jsonCodec`。'
          )
        },
        version: {
          summary: t(
            'Current data version, a positive safe integer.',
            '当前的数据版本号，正的安全整数。'
          ),
          default: t('`1`.', '默认值为 `1`。')
        },
        migrations: {
          summary: t(
            'Functions for every version from 2 to `version`; a missing step throws `INVALID_CONFIG`.',
            '从版本 2 到 `version` 的每一步迁移函数；缺一步就抛 `INVALID_CONFIG`。'
          ),
          default: t(
            'Not set: only valid with `version: 1`.',
            '不设置：只能与 `version: 1` 一起使用。'
          )
        },
        validateOnRead: {
          summary: t('Validate records when reading them.', '读取记录时也进行 schema 校验。'),
          default: t('`true`.', '`true`：读取时也校验。')
        },
        onDiagnostic: {
          summary: t(
            'Receives diagnostic messages (full scans, fallbacks).',
            '接收诊断信息（全表扫描、回退路径等）。'
          ),
          default: t('`console.warn`.', '`console.warn`：输出到控制台。')
        },
        defaultOrderBy: {
          summary: t(
            'Default sort of `list` / `stream`.',
            '`list` / `stream` 未指定排序时使用的默认比较函数。'
          ),
          default: t('Not set: key order.', '不设置：按 key 顺序。')
        },
        indexes: {
          summary: t(
            'Secondary indexes `{ name: { path | paths | select, unique?, multiEntry?, revision? } }`.',
            '实体自带的二级索引定义 `{ 名称: { path | paths | select, unique?, multiEntry?, revision? } }`。'
          ),
          default: t('Not set: no indexes.', '不设置：没有二级索引。')
        }
      }
    },
    IEntityDefinition: {
      summary: t(
        'Entity returned by `defineEntity()`.',
        '`defineEntity()` 返回的实体定义对象，可连接存储。'
      ),
      scenarios: [
        t(
          'Connect the same entity to IndexedDB in production and to memory in tests.',
          '在生产中把同一个实体连接到 IndexedDB，在测试中连接到内存存储。'
        )
      ],
      example: repositoryExample,
      members: {
        name: {
          summary: t('Entity name used to isolate its records.', '实体的名称，用于隔离记录。')
        },
        version: { summary: t('Current data version of the entity.', '实体当前的数据版本号。') },
        connect: {
          summary: t(
            'Binds the entity to a store and returns its repository.',
            '把实体绑定到某个存储，并返回其仓储。'
          ),
          params: {
            store: t(
              'Any store, e.g. `indexedDbHost()` or `host.backend(id)`.',
              '任意存储，例如 `indexedDbHost()` 或 `host.backend(id)`。'
            )
          },
          returns: t('An `IRepository`.', '一个仓储对象 `IRepository`。'),
          example: `const users = definition.connect(memoryStorageHost())`
        }
      }
    },
    IRepository: {
      summary: t(
        'Typed access to one entity on one store. Fallback unique validation adds full-scan schema and projection reads without a persistent sidecar or a native capability claim. Record put, batch and migration validate the final draft and update the internal two-slot key `[REPOSITORY_KEY_PREFIX, entityName]` (`REPOSITORY_KEY_PREFIX` is `"__storage_web_entity_v2__"`) to detect concurrent new owners; raw record enumeration can see this marker, while entity queries and migration exclude it. KV preparation runs schema and codec callbacks outside the lock, then verifies the raw-text snapshot under an exclusive commit lock; changes during preparation yield retryable `TRANSACTION_CONFLICT`. Host Web Locks guarantee cross-page uniqueness and are provided by modern browsers. Injected ports without a host lock serialize within one module instance. Server-rewritten cookies follow the server and are outside this uniqueness constraint.',
        '提供单个存储上的实体记录访问。回退唯一约束增加全扫描及结构校验、投影读取，不增加持久化辅助索引，也不声称原生能力。记录写入、批处理和迁移校验最终草稿，并更新内部两段键 `[REPOSITORY_KEY_PREFIX, entityName]`（前缀值为 `"__storage_web_entity_v2__"`） 以检测并发新增所有者；原始记录枚举可见该标记，实体查询与迁移排除它。键值后端在锁外执行结构校验和编解码准备，再在独占提交锁内核对原始文本快照；准备期间发生变化返回可重试的 `TRANSACTION_CONFLICT`。跨页面唯一性由宿主 `Web Locks` 保证，现代浏览器均已提供。没有宿主锁的注入端口只在同一模块实例内串行。服务端改写的 `cookie` 以服务端为准，不在该唯一约束范围内。'
      ),
      scenarios: [
        t(
          'Query users by email index and page through recent orders.',
          '按 email 索引查询用户，并分页浏览最近的订单。'
        )
      ],
      example: repositoryExample,
      members: repositoryMembers
    },
    IEntityTransactionScope: {
      summary: t(
        'The `tx` argument of `repository.batch(run)`.',
        '`repository.batch(run)` 的回调函数收到的 `tx` 参数。'
      ),
      members: {
        get: {
          summary: t('Reads in the transaction.', '在事务内读取一条记录。'),
          params: { id: t('Primary key.', '要读取记录的主键值。') },
          returns: t('The record or `undefined`.', '读到的记录或 `undefined`。')
        },
        put: {
          summary: t('Writes in the transaction.', '在事务内写入一条记录。'),
          params: { value: t('The record.', '要写入的领域对象。') },
          returns: t('The stored key.', '写入的存储 key。')
        },
        remove: {
          summary: t('Deletes in the transaction.', '在事务内删除一条记录。'),
          params: { id: t('Primary key.', '要删除记录的主键值。') },
          returns: t('Resolves when removed.', '删除完成后 resolve。')
        }
      }
    },
    IEntityIndex: {
      summary: t(
        'Caller-authored secondary-index projection: choose exactly one path, compound paths or synchronous selector with an explicit revision.',
        '调用方编写的二级索引投影：路径、复合路径或带显式修订号的同步选择器，三者必须只选其一。'
      ),
      members: {
        path: {
          summary: t(
            'Caller-selected `IObjectPathInput<TDomain>` identifying one domain value used as the index key or multi-entry source.',
            '调用方选择的 `IObjectPathInput<TDomain>`，指出用于索引键或多项来源的领域值。'
          )
        },
        paths: {
          summary: t(
            'Nonempty caller-selected path list; each record projects a compound tuple key in this exact order, with multi-entry disabled.',
            '调用方指定的非空路径列表；每条记录按此顺序投影复合元组键，并禁用多项展开。'
          )
        },
        unique: {
          summary: t(
            'Whether each projected logical key may belong to only one record. Native and fallback paths use the same owner rule: a different owner rejects with `INDEX_UNIQUE_CONFLICT`, while replacement by the same id, reuse after deletion, compound keys and multi-entry keys follow the same rule.',
            '每个投影逻辑键是否只能属于一条记录。原生与回退路径共用所有者判定：不同所有者冲突以 `INDEX_UNIQUE_CONFLICT` 拒绝；同标识替换、删除后复用、复合键与多项键均适用同一规则。'
          ),
          default: t(
            '`false`: several records may share one logical index key.',
            '`false`：多条记录可以共享同一个逻辑索引键。'
          ),
          values: {
            true: t(
              'Enforce uniqueness across different records for every projected key.',
              '对每个投影键强制执行跨记录唯一性。'
            ),
            false: t(
              'Permit different records to share a projected key.',
              '允许不同记录共享相同的投影索引键。'
            )
          }
        },
        multiEntry: {
          summary: t(
            'Single-path option expanding an array projection into several keys. Compound paths permit only false; custom selectors must express multiplicity in their result and reject this field.',
            '单路径选项，把数组投影展开成多个键。复合路径只允许假值；自定义选择器必须在结果中表达多项，并拒绝此字段。'
          ),
          default: t(
            '`false` for path projections; absent for custom selectors.',
            '路径投影默认为 `false`；自定义选择器必须省略。'
          ),
          values: {
            true: t(
              'Expand a single path’s array elements into separate index entries.',
              '把单路径的数组元素展开为独立索引条目。'
            ),
            false: t(
              'Keep one projected key, including a compound tuple.',
              '保留单个投影键，包括复合元组键。'
            )
          }
        },
        revision: {
          summary: t(
            'Positive safe integer chosen by the caller for projection identity and backfill fingerprinting; custom selectors require it explicitly.',
            '调用方指定的正安全整数，用于投影身份与回填指纹；自定义选择器必须显式提供。'
          ),
          default: t(
            '`1` for path and compound projections; no omission is allowed for custom selectors.',
            '路径与复合投影默认为 `1`；自定义选择器不允许省略。'
          )
        },
        select: {
          summary: t(
            'Synchronous caller-owned `(value) => projection` receiving the domain record. Return a single key, multiple keys or undefined to omit indexing. Ordinary throws in fallback write validation cross the existing `EXTENSION_FAILED` boundary with operation `entity.index.project` and the original cause; native backfill preserves original error identity.',
            '调用方持有的同步 `(value) => projection`，接收领域记录，返回单键、多键或空值以跳过索引。回退写校验中的普通抛错经既有 `EXTENSION_FAILED` 边界交付，操作为 `entity.index.project`，保留原始原因；原生回填保留原错误身份。'
          ),
          params: {
            value: t(
              'Domain record supplied by the entity repository during index projection.',
              '实体仓库执行索引投影时提供的领域记录。'
            )
          },
          returns: t(
            '`{ kind: "single", key }`, `{ kind: "multiple", keys }` or undefined; every returned key must satisfy `IStorageKey`.',
            '`{ kind: "single", key }`、`{ kind: "multiple", keys }` 或空值；各键必须满足 `IStorageKey`。'
          ),
          example: `const byStatus = {
  revision: 1,
  select: (value: { status: string }) => ({ kind: 'single' as const, key: value.status })
}
console.log(byStatus.select({ status: 'ready' }))`
        }
      }
    },
    IEntityIndexMap: alias(
      'Map of index names to their key types, inferred from the definition.',
      '索引名称到其 key 类型的映射，由定义自动推导。'
    ),
    IIndexedListOptions: alias(
      'List options with `index` and an index key `range`.',
      '带 `index` 与索引 key 范围 `range` 的列表查询选项。'
    ),
    IListOptions: {
      summary: t(
        'Options of `list` / `stream`.',
        '`list` / `stream` 的选项：范围、数量、排序与无效记录处理。'
      ),
      members: {
        range: {
          summary: t(
            'Primary key range `{ lower?, upper? }`.',
            '要读取记录的主键范围 `{ lower?, upper? }`。'
          ),
          default: t('Not set: all records.', '不设置：读取全部记录。')
        },
        index: {
          summary: t(
            'Not allowed here; use indexed options.',
            '此处不允许使用；请改用带索引的选项。'
          )
        },
        limit: {
          summary: t('Maximum number of records.', '最多返回的记录数量上限。'),
          default: t('Not set: no limit.', '不设置：不限制数量。')
        },
        orderBy: {
          summary: t(
            'Comparator `(left, right) => number`.',
            '决定结果排序的比较函数 `(left, right) => number`。'
          ),
          default: t('`defaultOrderBy` or key order.', '`defaultOrderBy` 或按 key 顺序。')
        },
        direction: {
          summary: t('Iteration direction over keys.', '按 key 遍历记录时采用的方向。'),
          default: t('`next`.', '`next`：升序。'),
          values: {
            next: t('Ascending keys.', '按 key 升序遍历。'),
            prev: t('Descending keys.', '按 key 降序遍历。')
          }
        },
        onInvalid: {
          summary: t(
            '`skip`, `throw` or `(issue) => action` for records that fail decode, migrate or validate.',
            '对解码、迁移或校验失败的记录：`skip`、`throw` 或 `(issue) => action`。'
          ),
          default: t('`skip`.', '`skip`：跳过无效记录。')
        }
      }
    },
    IMigrateOptions: {
      summary: t(
        'Options of `repository.migrate()`.',
        '`repository.migrate()` 的选项：批次大小与无效记录处理。'
      ),
      members: {
        batchSize: {
          summary: t('Records handled per batch.', '每个批次处理的记录数量。'),
          default: t('`100`.', '默认值为 `100` 条。')
        },
        onInvalid: {
          summary: t('What to do with invalid records.', '遇到无效记录时的处理方式。'),
          default: t('`skip`.', '`skip`：跳过无效记录。')
        }
      }
    },
    IMigrateResult: {
      summary: t(
        'Counts returned by `repository.migrate()`.',
        '调用 `repository.migrate()` 后返回的统计结果。'
      ),
      members: {
        scanned: { summary: t('Records read in this run.', '本次迁移读取的记录总数。') },
        eligible: {
          summary: t(
            'Records older than the current version.',
            '版本低于当前版本、需要迁移的记录数。'
          )
        },
        migrated: {
          summary: t('Records upgraded to the current version.', '成功升级到当前版本的记录数。')
        },
        skipped: { summary: t('Invalid records skipped.', '因无效而被跳过的记录数。') },
        alreadyCurrent: {
          summary: t(
            'Records already at the current version, including concurrent upgrades observed inside the write transaction and preserved without overwrite.',
            '已经是当前版本的记录数，包括写事务内观察到并保留、未被覆写的并发升级。'
          )
        },
        conflicted: {
          summary: t(
            'Records changed concurrently and left for later.',
            '被并发修改、留待之后处理的记录数。'
          )
        }
      }
    },
    IInvalidRecordIssue: {
      summary: t('Argument of an `onInvalid` handler.', '`onInvalid` 处理函数收到的问题描述。'),
      members: {
        key: { summary: t('Storage key of the invalid record.', '该条无效记录在存储中的 key。') },
        raw: { summary: t('Raw value read from the store.', '从存储中读出的原始值。') },
        record: {
          summary: t('Decoded record, when decoding worked.', '解码后的记录（解码成功时才有）。')
        },
        stage: {
          summary: t(
            '`decode`, `migrate` or `validate`.',
            '记录出错时所处的阶段：`decode`、`migrate` 或 `validate`。'
          )
        },
        cause: { summary: t('The error of that stage.', '该阶段产生的原始错误。') }
      }
    },
    IInvalidRecordAction: alias(
      'Action for an invalid record: `skip` or `throw`.',
      '对无效记录采取的动作：`skip` 或 `throw`。'
    ),
    IInvalidRecordHandler: alias(
      'Handler `(issue) => "skip" | "throw"`.',
      '处理无效记录的回调函数 `(issue) => "skip" | "throw"`。'
    ),
    IRecordComparator: alias(
      'Comparator `(left, right) => number` used for ordering.',
      '用于记录排序的比较函数 `(left, right) => number`。'
    ),
    IStorageHostCreateOptions: {
      summary: t(
        'Options of `createStorageHost()`.',
        '`createStorageHost()` 的选项：初始插件与安装设置。'
      ),
      members: {
        plugins: {
          summary: t(
            'Initial plugins installed atomically; ids must be unique.',
            '原子安装的初始插件；id 必须唯一。'
          ),
          default: t('`[]`: an empty host.', '`[]`：创建一个空宿主。')
        },
        installTimeoutMs: {
          summary: t('Deadline of one whole installation batch.', '一整批插件安装的截止时间。'),
          default: t('`30000`.', '默认值为 `30000` 毫秒。')
        },
        scheduler: {
          summary: t(
            'Clock for installation, rollback and cleanup.',
            '安装、回滚与清理所用的时钟。'
          ),
          default: t('`systemScheduler`.', '`systemScheduler`：宿主原生计时器。')
        },
        report: {
          summary: t(
            'Receives late rejections and cleanup diagnostics.',
            '接收迟到的拒绝与清理诊断。'
          ),
          default: t('Not set: diagnostics are dropped.', '不设置：诊断信息被丢弃。')
        }
      }
    },
    IStorageHostOptions: {
      summary: t(
        'Options of `new StorageHostFacade()`.',
        '`new StorageHostFacade()` 的选项：安装超时、时钟与上报。'
      ),
      members: {
        installTimeoutMs: {
          summary: t('Deadline of one installation batch.', '一整批插件安装的截止时间。'),
          default: t('`30000`.', '默认值为 `30000` 毫秒。')
        },
        scheduler: {
          summary: t('Clock for installation and cleanup.', '安装与清理所用的时钟。'),
          default: t('`systemScheduler`.', '`systemScheduler`：宿主原生计时器。')
        },
        report: {
          summary: t(
            'Receives late rejections and cleanup diagnostics.',
            '接收迟到的拒绝与清理诊断。'
          ),
          default: t('Not set.', '不设置：诊断信息被丢弃。')
        }
      }
    },
    IStorageHost: {
      summary: t(
        'Storage host returned by `createStorageHost()`.',
        '`createStorageHost()` 返回的存储宿主对象，按 id 管理后端。'
      ),
      scenarios: [
        t(
          'Keep several storage backends behind ids and dispose them together.',
          '按 id 管理多个存储后端，并统一释放。'
        )
      ],
      example: createHostExample,
      members: hostMembers
    },
    IStorageHostBase: {
      summary: t('Members every storage host has.', '每个存储宿主都具备的成员。'),
      members: hostMembers
    },
    StorageHostFacade: {
      summary: t(
        'Host class; same members as `IStorageHost`.',
        '存储宿主类；其成员与 `IStorageHost` 完全相同。'
      ),
      scenarios: [
        t('Create an empty host and install backends later.', '先创建空宿主，之后再安装后端。')
      ],
      example: createHostExample,
      members: hostMembers
    },
    IStorageHostReactiveApi: {
      summary: t(
        '`liveQuery` added when a reactive backend is installed.',
        '安装响应式后端后增加的 `liveQuery`。'
      ),
      members: { liveQuery: hostMembers.liveQuery as IMemberDoc }
    },
    ILiveQueryOptions: {
      summary: t(
        'Options of `host.liveQuery()`.',
        '`host.liveQuery()` 的选项：后端、运行时、查询与刷新策略。'
      ),
      example: liveQueryExample,
      members: {
        backendId: {
          summary: t(
            'Id of a backend installed with a `*Reactive` plugin.',
            '通过 `*Reactive` 插件安装的后端的 id。'
          )
        },
        runtime: {
          summary: t(
            'Reactive runtime from `createRuntime()`; `state` is a computed on it.',
            '由 `createRuntime()` 创建的响应式运行时；`state` 是其上的 computed。'
          )
        },
        query: {
          summary: t(
            '`({ store, signal, scope }) => value`: reads the data; re-run on every relevant change.',
            '`({ store, signal, scope }) => value`：读取数据；每次相关变化都会重新执行。'
          )
        },
        scope: {
          summary: t(
            'Entity scope that lets unrelated changes be ignored.',
            '实体范围，用于忽略不相关的变化。'
          ),
          default: t('Not set: every change refreshes.', '不设置：任何变化都会刷新。')
        },
        matches: {
          summary: t(
            '`(change) => boolean`; a throw is reported and refreshes anyway.',
            '`(change) => boolean`；抛错会被上报，并照常刷新。'
          ),
          default: t('Not set.', '不设置：不额外过滤变化。')
        },
        keepPreviousData: {
          summary: t(
            'Keep showing the last value while refreshing (`refreshing` state).',
            '刷新期间继续显示上一次的值（`refreshing` 状态）。'
          ),
          default: t('`true`.', '`true`：刷新时保留旧值。')
        },
        equals: {
          summary: t(
            '`(previous, next) => boolean`; equal results do not replace the visible value.',
            '`(previous, next) => boolean`；结果相等时不替换显示的值。'
          ),
          default: t('Not set: every result replaces it.', '不设置：每次结果都替换显示值。')
        },
        timeoutMs: {
          summary: t('Deadline of each query run.', '每次查询执行的截止时间。'),
          default: t('Not set: no deadline.', '不设置：没有截止时间。')
        },
        signal: {
          summary: t('Cancels the whole live query.', '用于取消整个实时查询的信号。'),
          default: t('Not set.', '不设置：只能通过 `dispose()` 结束。')
        },
        report: {
          summary: t(
            'Receives late settlements and cleanup failures.',
            '接收迟到的结果与清理失败。'
          ),
          default: t('Not set.', '不设置：这类诊断被丢弃。')
        }
      }
    },
    ILiveQuery: {
      summary: t(
        'A live query returned by `host.liveQuery()`.',
        '`host.liveQuery()` 返回的、会自动刷新的实时查询对象。'
      ),
      scenarios: [
        t(
          'Show a list that updates when another tab writes to IndexedDB.',
          '展示一个在其它标签页写入 IndexedDB 时自动更新的列表。'
        )
      ],
      example: liveQueryExample,
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
    ILiveQueryState: {
      summary: t(
        'Live-query state projected from the authoritative resource result, retaining a previous value during refresh, failure or disposal when available.',
        '从权威资源结果投影的实时查询状态；有旧值时，在刷新、失败或释放期间保留。'
      ),
      members: {
        status: {
          summary: t(
            'Query discriminant selecting initial load, usable value, refresh, failure or disposed state.',
            '查询判别状态，选择首次加载、可用值、刷新、失败或已释放状态。'
          ),
          values: {
            loading: t(
              'The initial query is pending; a previous value is optional.',
              '初始查询尚未完成，旧值可能不存在。'
            ),
            ready: t(
              'A successful result is available and no refresh is in progress.',
              '已有成功结果，当前没有正在进行的刷新。'
            ),
            refreshing: t(
              'Keep the last successful value while a new query is running.',
              '新查询运行期间保留上一次成功结果。'
            ),
            error: t(
              'The query failed; inspect the error and any retained prior value.',
              '查询失败，应检查错误与可能保留的旧值。'
            ),
            disposed: t(
              'The query has stopped permanently, with its final optional value or error.',
              '查询已永久停止，可能保留最终值或错误。'
            )
          }
        },
        value: {
          summary: t(
            'Last usable result, required for ready and refreshing, and optional for loading, error and disposed states.',
            '最后可用结果；就绪与刷新时必填，加载、错误和释放状态下可选。'
          )
        },
        error: {
          summary: t(
            'Original query failure required in the error branch and optionally retained after disposal.',
            '错误分支必填的原始查询失败，也可能在释放后保留。'
          )
        }
      }
    },
    ILiveQueryStateView: {
      summary: t(
        'Read-only, non-disposable view of the computed live-query state.',
        '计算得到的实时查询状态只读视图，不授予释放内部节点的权限。'
      ),
      members: {
        runtime: {
          summary: t(
            'The exact reactive runtime supplied to the query.',
            '创建查询时提供的同一个响应式运行时。'
          )
        },
        debugName: {
          summary: t(
            'Internal computed-node diagnostic name while the query node exists.',
            '内部计算节点存在期间使用的诊断名称。'
          )
        },
        observed: {
          summary: t(
            'Whether a reactive observer reads the node; always false after disposal.',
            '是否有响应式观察者读取该节点；查询释放后始终为假。'
          )
        },
        value: {
          summary: t(
            'Current query state; reading tracks a dependency, and disposal returns the terminal state.',
            '当前查询状态；读取会记录依赖，释放后返回终态快照。'
          )
        },
        peek: {
          summary: t(
            'Read the same query state without tracking a dependency.',
            '读取相同的查询状态，但不记录响应式依赖。'
          ),
          returns: t(
            'Current state or the disposed terminal snapshot; query failures live in the error branch.',
            '当前状态或释放后的终态快照；查询失败保留在错误分支中。'
          ),
          example: `console.log(query.state.peek().status)`
        }
      }
    },
    IReactiveBackendHandle: {
      summary: t(
        'Handle returned by `host.reactiveBackend(id)`.',
        '`host.reactiveBackend(id)` 返回的响应式后端句柄。'
      ),
      scenarios: [
        t(
          'Give a feature module one backend with live queries but without the whole host.',
          '把带实时查询的单个后端交给某个功能模块，而不暴露整个宿主。'
        )
      ],
      example: `const handle = host.reactiveBackend('app')
const query = handle.liveQuery({ runtime, query: ({ store }) => store.get('theme') })`,
      members: {
        id: { summary: t('Backend id of the handle.', '该响应式句柄对应的后端 id。') },
        store: { summary: t('The store of the backend.', '该后端对应的存储对象本身。') },
        liveQuery: {
          summary: t(
            'Creates a live query on this backend (`backendId` is implied).',
            '在该后端上创建实时查询（隐含 `backendId`）。'
          ),
          params: {
            options: t(
              'Live query options without `backendId`.',
              '不含 `backendId` 的实时查询选项。'
            )
          },
          returns: t('An `ILiveQuery`.', '一个实时查询对象 `ILiveQuery`。'),
          example: `handle.liveQuery({ runtime, query: ({ store }) => store.keys() })`
        }
      }
    },
    IReactiveConsistency: {
      summary: t(
        'Consistency promise of a reactive adapter, shown on `query.consistency`.',
        '响应式适配器的一致性承诺，显示在 `query.consistency` 上。'
      ),
      members: {
        mode: {
          summary: t('How changes are detected.', '检测数据变化的具体方式。'),
          values: {
            push: t('The store reports every change at once.', '存储会立即报告每一次变化。'),
            hybrid: t('Change events plus polling as a safety net.', '变化事件加上轮询作为兜底。'),
            polling: t('Only periodic re-reads.', '只通过定期重新读取发现变化。')
          }
        },
        pollIntervalMs: {
          summary: t('Polling interval, when polling is used.', '使用轮询时的轮询间隔（毫秒）。')
        },
        visibility: {
          summary: t(
            'Which writers are seen; see `IStorageReactiveVisibility`.',
            '能观察到哪些写入方，见 `IStorageReactiveVisibility`。'
          )
        }
      }
    },
    IStorageReactiveVisibility: alias(
      'Which writes a reactive adapter can see: `instance`, `document-eventual`, `top-level-context-eventual`, `origin-js-visible-eventual`, `origin-eventual`.',
      '响应式适配器能观察到哪些写入：`instance`、`document-eventual`、`top-level-context-eventual`、`origin-js-visible-eventual`、`origin-eventual`。'
    ),
    IReactiveAdapterDefinition: {
      summary: t(
        'Input of `defineReactiveAdapterFeature()`.',
        '`defineReactiveAdapterFeature()` 的输入：模式、可见性与订阅函数。'
      ),
      members: {
        mode: {
          summary: t('How the adapter detects changes.', '该适配器检测数据变化的方式。'),
          values: {
            push: t('`subscribe` reports every change.', '由 `subscribe` 报告每一次变化。'),
            hybrid: t('Events plus polling.', '变化事件加上定期轮询。'),
            polling: t('Only polling every `pollIntervalMs`.', '只按 `pollIntervalMs` 定期轮询。')
          }
        },
        pollIntervalMs: {
          summary: t(
            'Polling interval for `hybrid` / `polling`.',
            '`hybrid` / `polling` 模式下的轮询时间间隔。'
          ),
          default: t('Not set: no polling.', '不设置：不轮询。')
        },
        visibility: {
          summary: t('Which writers the adapter can observe.', '该适配器能观察到哪些写入方。'),
          values: {
            instance: t(
              'Only writes through this store instance.',
              '只能观察到通过本存储实例的写入。'
            ),
            'document-eventual': t(
              'Writes from other documents of the origin, eventually.',
              '最终能观察到同源其它文档的写入。'
            ),
            'top-level-context-eventual': t(
              'Writes within the same top-level browsing context, eventually.',
              '最终能观察到同一顶层浏览上下文中的写入。'
            ),
            'origin-js-visible-eventual': t(
              'JS-visible writes of the origin (no HttpOnly), eventually.',
              '最终能观察到同源中 JS 可见的写入（不含 HttpOnly）。'
            ),
            'origin-eventual': t(
              'Writes from any context of the origin, eventually.',
              '最终能观察到同源任意上下文的写入。'
            )
          }
        },
        subscribe: {
          summary: t(
            'Starts listening and calls `context.invalidate(change)` for known changes, or `context.invalidate()` to refresh every query on this adapter when no payload is available.',
            '开始监听；已知变化时调用 `context.invalidate(change)`，没有具体载荷时调用 `context.invalidate()` 刷新本适配器全部查询。'
          ),
          params: {
            context: t(
              'Host-supplied `{ store, scheduler, signal, invalidate, report }` for this adapter; the signal ends source listening when the adapter stops.',
              '宿主为本适配器提供的订阅上下文 `{ store, scheduler, signal, invalidate, report }`；适配器停止时信号结束来源监听。'
            )
          },
          returns: t('A disposer that stops listening.', '停止监听的清理函数。')
        }
      }
    },
    IReactiveAdapterContext: {
      summary: t(
        'Argument of `subscribe` in a reactive adapter.',
        '响应式适配器中 `subscribe` 收到的上下文。'
      ),
      members: {
        store: { summary: t('The store being observed.', '正在被观察的存储对象。') },
        scheduler: { summary: t('Host clock used for timers.', '计时器所用的宿主时钟。') },
        signal: { summary: t('Aborts when the adapter stops.', '适配器停止时中止的信号。') },
        invalidate: {
          summary: t(
            'Marks queries stale; pass a known change to permit filtering. Calling invalidate() without a change refreshes every live query on the same adapter, bypassing scope and matches filters without inventing sequence or origin values.',
            '把查询标记为过期；已知变化时传入变更以允许过滤。无参数调用使同一适配器全部实时查询刷新，跳过作用域和匹配过滤，不虚构序号或来源值。'
          )
        },
        report: { summary: t('Reports adapter failures.', '上报适配器内部的失败。') }
      }
    },
    IStorageReactiveSubscribeContext: {
      summary: t(
        'Low-level subscribe context of reactive metadata.',
        '响应式元数据所用的底层订阅上下文。'
      ),
      members: {
        store: { summary: t('The store being observed.', '正在被观察的存储对象。') },
        scheduler: {
          summary: t(
            'Host clock shared with installation deadlines.',
            '与安装截止时间共用的宿主时钟。'
          )
        },
        signal: { summary: t('Aborts when the adapter stops.', '适配器停止时中止的信号。') },
        report: { summary: t('Reports adapter failures.', '上报适配器内部的失败。') },
        onChange: {
          summary: t(
            'Receives an optional backend change. Undefined invalidates all queries on this adapter; a known change permits scope and matches filtering, with no fabricated sequence or origin.',
            '接收可选后端变更。空值使本适配器全部查询失效；已知变更允许作用域与匹配过滤，不虚构序号或来源。'
          )
        }
      }
    },
    IStorageReactiveFeatureMetadata: {
      summary: t('Reactive metadata of a built-in adapter.', '内置适配器的响应式元数据。'),
      members: {
        mode: {
          summary: t(
            '`push`, `hybrid` or `polling`.',
            '检测数据变化的方式：`push`、`hybrid` 或 `polling`。'
          ),
          values: {
            push: t('Immediate change reports.', '立即报告每一次变化。'),
            hybrid: t('Events plus polling.', '变化事件加上定期轮询。'),
            polling: t('Polling only.', '只通过定期轮询发现变化。')
          }
        },
        visibility: { summary: t('Which writers are observed.', '该适配器能观察到哪些写入方。') },
        pollIntervalMs: {
          summary: t('Polling interval in milliseconds.', '定期轮询的时间间隔，单位毫秒。')
        },
        subscribe: { summary: t('Starts listening for changes.', '开始监听存储变化的函数。') }
      }
    },
    IStorageReactiveSourceDisposer: alias(
      'Function returned by `subscribe` that stops listening.',
      '`subscribe` 返回的、用于停止监听的函数。'
    ),
    IStoragePluginCore: {
      summary: t(
        'The `core` passed to `definePlugin(name, (core) => ...)`.',
        '传给 `definePlugin(name, (core) => ...)` 工厂函数的插件核心 `core` 对象。'
      ),
      members: {
        registerStore: {
          summary: t(
            'Registers the store of this plugin; must be called once.',
            '登记该插件的存储；必须调用且只调用一次。'
          )
        },
        getStore: { summary: t('Returns the registered store.', '返回已登记的存储对象。') },
        getBackendId: {
          summary: t('Returns the backend id of the plugin.', '返回该插件安装时的后端 id。')
        },
        features: {
          summary: t('Outputs of the declared Features.', '已声明的各 Feature 的输出对象。')
        },
        featureExpose: {
          summary: t(
            'Values exposed to Features of this plugin.',
            '暴露给本插件各个 Feature 的值。'
          )
        }
      }
    },
    IStorageNativePluginDescriptor: {
      summary: t(
        'What a `definePlugin` factory may return.',
        '`definePlugin` 工厂函数可以返回的描述对象。'
      ),
      members: {
        install: {
          summary: t(
            'Returns extension APIs added to `host.extensions`.',
            '返回会被合并进 `host.extensions` 的扩展 API。'
          )
        },
        expose: {
          summary: t('Returns APIs exposed to other plugins.', '返回暴露给其它插件的 API。')
        },
        featureExpose: {
          summary: t('Returns values exposed to Features.', '返回暴露给本插件各个 Feature 的值。')
        }
      }
    },
    IStorageBackendPluginHandle: {
      summary: t(
        'Opaque handle of a backend plugin; carries its id and store type.',
        '后端插件的不透明句柄；携带其 id 与存储类型。'
      ),
      scenarios: [
        t(
          'Pass plugins around before deciding which host installs them.',
          '在决定由哪个宿主安装之前传递插件。'
        )
      ],
      example: `const plugin = memoryBackendPlugin({ id: 'cache' })
await host.use(plugin)`,
      members: {
        id: { summary: t('Backend id the plugin installs under.', '插件安装时使用的后端 id。') }
      }
    },
    IStorageBackendPlugin: {
      summary: t('Typed plugin handle of a built-in backend.', '内置后端的类型化插件句柄。'),
      scenarios: [
        t(
          'Keep the literal backend id returned by a built-in plugin factory so installation and backend lookup retain the same typed identity.',
          '保留内置插件工厂返回的字面量后端 id，使插件安装与后端查找使用同一个类型化标识。'
        )
      ],
      example: `import { createStorageHost } from '@migaia/storage-web/host'
import { memoryBackendPlugin } from '@migaia/storage-web/plugins/memory'

const cache = memoryBackendPlugin({ id: 'cache' })
const host = await createStorageHost({ plugins: [cache] as const })
try {
  await host.backend(cache.id).set('theme', 'dark')
} finally {
  await host.dispose()
}`,
      members: {
        id: { summary: t('Backend id the plugin installs under.', '插件安装时使用的后端 id。') }
      }
    },
    IStorageBackendKind: {
      summary: t(
        'Opaque token of a backend kind used to match adapters.',
        '用于匹配适配器的后端类型不透明标记。'
      ),
      members: {
        name: {
          summary: t('Kind name, e.g. `indexed-db`.', '该后端类型的名称，例如 `indexed-db`。')
        }
      }
    },
    IPluginStoreMap: alias(
      'Map from plugin ids to store types for a plugin tuple.',
      '插件元组中插件 id 到存储类型的映射。'
    ),
    IRejectInstalledOrDuplicateIds: alias(
      'Type check that rejects already installed or duplicate ids at compile time.',
      '在编译期拒绝已安装或重复 id 的类型检查。'
    ),
    IStoragePluginExtensions: alias(
      'Extension API type of a plugin.',
      '某个插件安装后提供的扩展 API 类型。'
    ),
    IStoragePluginId: alias('Literal id type of a plugin.', '某个插件的字面量 id 类型。'),
    IStoragePluginReactiveId: alias('Id type of a reactive plugin.', '某个响应式插件的 id 类型。'),
    IStoragePluginStore: alias('Store type provided by a plugin.', '某个插件所提供的存储类型。'),
    IMigration: alias(
      'Migration function `(previous, ctx) => Promise<next>`.',
      '单个版本步骤的迁移函数类型 `(previous, ctx) => Promise<next>`。'
    ),
    IMigrationContext: {
      summary: t('Second argument of a migration function.', '迁移函数收到的第二个参数。'),
      members: {
        fromVersion: { summary: t('Version being migrated from.', '本步迁移开始时的版本号。') },
        toVersion: { summary: t('Version being migrated to.', '本步迁移要达到的版本号。') },
        signal: {
          summary: t('Optional signal to cancel the migration.', '可选的取消信号，用于协作取消。')
        }
      }
    },
    ISchemaAdapter: {
      summary: t(
        'Schema adapter used by entities: validation plus optional stored-shape conversion.',
        '实体使用的 schema 适配器：校验以及可选的存储形态转换。'
      ),
      scenarios: [
        t(
          'Store dates as ISO strings while the domain uses `Date`.',
          '领域对象使用 `Date`，存储时保存为 ISO 字符串。'
        )
      ],
      example: `const schema: ISchemaAdapter<IEvent, IStoredEvent> = {
  name: 'event',
  validate: async (value) => value as IEvent,
  encode: async (event) => ({ ...event, at: event.at.toISOString() }),
  decode: async (raw) => ({ ...raw, at: new Date(raw.at) })
}`,
      members: {
        name: { summary: t('Name used in diagnostics.', '诊断信息中使用的名称。') },
        validate: {
          summary: t(
            'Checks a value and returns the domain object (may be async).',
            '校验某个值并返回领域对象（可以是异步的）。'
          ),
          params: {
            value: t('Value to check.', '要校验的值。'),
            ctx: t('Operation context.', '操作上下文，可用于取消。')
          },
          returns: t('The domain object.', '校验通过后的领域对象。'),
          example: `await schema.validate(input)`
        },
        encode: {
          summary: t('Domain object to stored shape.', '把领域对象转换为存储形态。'),
          params: {
            value: t('Domain object.', '要转换的领域对象。'),
            ctx: t('Operation context.', '操作上下文，可用于取消。')
          },
          returns: t('Stored shape.', '转换后的存储形态。'),
          example: `await schema.encode?.(event)`
        },
        decode: {
          summary: t('Stored shape to domain object.', '把存储形态转换回领域对象。'),
          params: {
            raw: t('Stored shape.', '已存储的值。'),
            ctx: t('Operation context.', '操作上下文，可用于取消。')
          },
          returns: t('Domain object.', '转换后的领域对象。'),
          example: `await schema.decode?.(raw)`
        },
        normalize: {
          summary: t('Optional clean-up before writing.', '写入前可选的规范化处理。'),
          params: {
            value: t('Validated value.', '已校验的值。'),
            ctx: t('Operation context.', '操作上下文，可用于取消。')
          },
          returns: t('Normalised value.', '规范化后的值。'),
          example: `await schema.normalize?.(value)`
        }
      }
    },
    IStandardSchemaV1: alias(
      'Standard Schema v1 shape (`~standard.validate`) implemented by zod, valibot and arktype.',
      '由 zod、valibot、arktype 等校验库实现的 Standard Schema v1 形状（`~standard.validate`）。'
    ),
    ISelectedCodec: {
      summary: t(
        'Codec route chosen by `selectCodec()` for one backend.',
        '`selectCodec()` 为某个后端选定的编解码路径。'
      ),
      scenarios: [
        t(
          'Write bytes to localStorage as Base64 and read them back as bytes.',
          '把字节以 Base64 写入 localStorage，读取时还原为字节。'
        )
      ],
      example: `const selected = selectCodec(binaryCodec, localStorageHost().capabilities)
const text = await selected.encode(new Uint8Array([1, 2]))
const bytes = await selected.decode(text)`,
      members: {
        encode: {
          summary: t(
            'Produces what the backend stores (string, bytes or object).',
            '生成后端实际保存的值（字符串、字节或对象）。'
          ),
          params: {
            value: t('Value to encode.', '要编码的值。'),
            ctx: t('`{ signal? }`.', '可选的上下文 `{ signal? }`。')
          },
          returns: t('Encoded value.', '编码后的值。'),
          example: `await selected.encode(value)`
        },
        decode: {
          summary: t(
            'Reverses `encode` and returns the value.',
            '执行 `encode` 的逆过程，还原原始值。'
          ),
          params: {
            raw: t('Stored value.', '已存储的值。'),
            ctx: t('`{ signal? }`.', '可选的上下文 `{ signal? }`。')
          },
          returns: t('Decoded value.', '解码后的值。'),
          example: `await selected.decode(raw)`
        }
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
        entityUniqueSnapshotChanged: t(
          'The KV raw-text snapshot changed during preparation; `TRANSACTION_CONFLICT` asks the caller to retry the complete write.',
          '键值原始文本快照在准备期间发生变化；`TRANSACTION_CONFLICT` 要求调用方重试完整写入。'
        ),
        entityMigrationGraphIncomplete: t(
          'Entity construction omitted an upgrade step from 2 through the current version; correct the graph before retrying.',
          '实体构造缺少从二到当前版本的升级步骤；重试前必须补全迁移图。'
        ),
        standardSchemaIssuesInvalid: t(
          'A Standard Schema implementation returned malformed issue entries rather than message-bearing objects.',
          '标准结构校验实现返回了格式错误的问题条目，而非携带消息的对象。'
        ),
        namespaceCodecEncodeInvalid: t(
          'A namespace encoder returned a non-string physical key.',
          '命名空间编码器返回了非字符串的物理存储键。'
        ),
        namespaceCodecDecodeInvalid: t(
          'A namespace decoder returned neither a string key nor undefined for another namespace.',
          '命名空间解码器既未返回字符串键，也未以空值表示其他命名空间。'
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
        entityComparatorInvalid: t(
          'An entity ordering callback returned an invalid comparison number.',
          '实体排序回调返回无效比较数字，无法确定记录顺序。'
        ),
        storageKeyDecodeLimitExceeded: t(
          'An encoded key exceeded the supported decode depth or node limits.',
          '编码存储键超过支持的解码深度或节点数量上限。'
        ),
        storageKeyWireInvalid: t(
          'An encoded key is not the required two-slot wire tuple.',
          '编码存储键不符合必需的双位置传输元组格式。'
        ),
        storageKeyBinaryTooLarge: t(
          'A binary storage key exceeds the public encoded-key size bound.',
          '二进制存储键超过公开允许的编码键大小上限。'
        ),
        storageKeyWireTagInvalid: t(
          'An encoded storage key uses an unknown wire type tag.',
          '编码存储键使用了未知的传输类型标记。'
        ),
        backendIdInvalid: t(
          'A backend identifier violates the registration name grammar before mutation.',
          '后端标识不符合登记命名语法，在变更前拒绝。'
        ),
        backendDuplicate: t(
          'A backend identifier is already installed or duplicated in the install batch.',
          '后端标识已经安装，或在安装批次中重复出现。'
        ),
        backendNotInstalled: t(
          'A valid backend identifier has no installed registry entry.',
          '有效后端标识没有对应的已安装注册表条目。'
        ),
        backendPluginInvalid: t(
          'A backend plugin or returned store violates its public contract.',
          '后端插件或返回存储违反公开契约，无法接纳。'
        ),
        backendInstallFailed: t(
          'Backend factory creation, preparation or PluginHost installation failed.',
          '后端工厂创建、准备或插件宿主安装阶段失败。'
        ),
        storageHostBusy: t(
          'A host mutation was requested while another install batch was running.',
          '其他安装批次正在运行时又请求修改存储宿主。'
        ),
        storageHostDisposed: t(
          'A host operation ran after the host sealed or reached terminal disposal.',
          '宿主封闭或终止释放后仍然调用宿主操作。'
        ),
        storageHostDisposeFailed: t(
          'Several host cleanup failures are summarized while disposal remains terminal.',
          '宿主多个清理失败被汇总，释放状态仍保持终止。'
        ),
        liveQueryDisposeFailed: t(
          'Several live-query cleanup failures are summarized after disposal.',
          '实时查询释放后的多个清理失败被聚合汇总。'
        ),
        reactiveFeatureInvalid: t(
          'A reactive provider, feature or adapter descriptor has an invalid shape.',
          '响应式提供方、特性或适配器描述形状不合法。'
        ),
        reactiveTopologyInvalid: t(
          'Reactive feature topology has an unknown dependency, duplicate or cycle.',
          '响应式特性拓扑包含未知依赖、重复声明或环。'
        ),
        reactiveServiceNotInstalled: t(
          'A live-query service was requested before installing its reactive plugin.',
          '响应式插件尚未安装就请求使用实时查询服务。'
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
          '`BACKEND_UNAVAILABLE`: storage is disabled or missing (private mode); pick `memoryStorageHost` or ask for access.',
          '`BACKEND_UNAVAILABLE`：存储被禁用或不存在（隐私模式）；改用 `memoryStorageHost` 或请用户开启。'
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
        validationFailed: t(
          '`VALIDATION_FAILED`: the schema rejected the value.',
          '`VALIDATION_FAILED`：结构校验拒绝此值，应检查对应校验问题。'
        ),
        migrationFailed: t(
          '`MIGRATION_FAILED`: a migration function threw.',
          '`MIGRATION_FAILED`：某个迁移函数执行时抛错。'
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
        transactionConflict: t(
          '`TRANSACTION_CONFLICT`: data changed concurrently; re-read and retry.',
          '`TRANSACTION_CONFLICT`：数据被并发修改；重新读取后重试。'
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
        backendIdInvalid: t(
          '`BACKEND_ID_INVALID`: the backend id breaks the id rule.',
          '`BACKEND_ID_INVALID`：后端标识不符合命名规则，应修正后重新安装。'
        ),
        backendDuplicate: t(
          '`BACKEND_DUPLICATE`: the id is already installed.',
          '`BACKEND_DUPLICATE`：此后端标识已经安装，或在同一批次重复。'
        ),
        backendNotInstalled: t(
          '`BACKEND_NOT_INSTALLED`: no backend with this id; there is no default.',
          '`BACKEND_NOT_INSTALLED`：没有这个 id 的后端；不存在默认后端。'
        ),
        backendPluginInvalid: t(
          '`BACKEND_PLUGIN_INVALID`: the plugin or its store breaks the contract.',
          '`BACKEND_PLUGIN_INVALID`：插件或其存储不符合契约。'
        ),
        backendInstallFailed: t(
          '`BACKEND_INSTALL_FAILED`: installation failed and was rolled back; see `cause`.',
          '`BACKEND_INSTALL_FAILED`：安装失败并已回滚；查看 `cause`。'
        ),
        storageHostBusy: t(
          '`STORAGE_HOST_BUSY`: another installation is running; retry after it settles.',
          '`STORAGE_HOST_BUSY`：另一批安装正在进行；结束后再重试。'
        ),
        storageHostDisposed: t(
          '`STORAGE_HOST_DISPOSED`: the host was disposed; create a new one.',
          '`STORAGE_HOST_DISPOSED`：宿主已释放；需要创建新的宿主。'
        ),
        storageHostDisposeFailed: t(
          '`STORAGE_HOST_DISPOSE_FAILED`: cleanup failed; the host is still terminal.',
          '`STORAGE_HOST_DISPOSE_FAILED`：清理失败；宿主仍处于终态。'
        ),
        liveQueryDisposeFailed: t(
          '`LIVE_QUERY_DISPOSE_FAILED`: query cleanup failed; see `errors`.',
          '`LIVE_QUERY_DISPOSE_FAILED`：实时查询清理失败；查看 `errors`。'
        ),
        reactiveFeatureInvalid: t(
          '`REACTIVE_FEATURE_INVALID`: the reactive Feature does not match the backend.',
          '`REACTIVE_FEATURE_INVALID`：响应式特性描述或其后端对应关系不合法。'
        ),
        reactiveTopologyInvalid: t(
          '`REACTIVE_TOPOLOGY_INVALID`: the Feature graph is unknown, duplicated or cyclic.',
          '`REACTIVE_TOPOLOGY_INVALID`：Feature 依赖图未知、重复或存在环。'
        ),
        reactiveServiceNotInstalled: t(
          '`REACTIVE_SERVICE_NOT_INSTALLED`: install a reactive plugin before creating queries.',
          '`REACTIVE_SERVICE_NOT_INSTALLED`：创建查询前需要先安装响应式插件。'
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
        backendDisposeFailed: t(
          '`BACKEND_DISPOSE_FAILED`: backend cleanup failed.',
          '`BACKEND_DISPOSE_FAILED`：直接后端清理失败，应检查保留的原始错误列表。'
        )
      }
    }
  },
  enhancers: pluginEnhancers
}
