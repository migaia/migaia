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

const host = await createStorageHost({ plugins: [${plugin}({${options}})] })
try {
  const store = host.backend('${id}')
  await store.set('theme', 'dark')
  console.log(await store.get('theme'))
} finally {
  await host.dispose()
}`

/** Live queries add no host facade and retain the caller's Runtime ownership. */
const liveExample = `import { createRuntime } from '@migaia/reactive'
import { records } from '@migaia/storage-contract'
import { createStorageHost } from '@migaia/storage-host'
import { indexedDbBackendPlugin, indexedDbBackendKind } from '@migaia/storage-web/indexed-db'
import { reactiveFeature } from '@migaia/storage-web/features/reactive'

const runtime = createRuntime()
const host = await createStorageHost({ plugins: [indexedDbBackendPlugin(
  { dbName: 'users' }, { reactive: reactiveFeature(indexedDbBackendKind) }
)] })
try {
  const query = host.backend('indexed-db').use(records).query().live({ runtime })
  try {
    await query.ready
    console.log(query.state.value)
  } finally {
    await query.dispose()
  }
} finally {
  await host.dispose()
}`

/** Explain browser-specific options, leaving native host/context contracts with their owners. */
const webStorageFields = (storage: string): Readonly<Record<string, IMemberDoc>> => ({
  namespace: {
    summary: t('Logical namespace owned by this backend.', '该后端拥有的逻辑命名空间。'),
    default: t('`default`.', '默认 `default`。')
  },
  namespaceCodec: {
    summary: t(
      'Encodes and decodes physical keys without touching foreign namespaces.',
      '编码与解码物理键，跳过其他命名空间。'
    ),
    default: t('`lengthPrefixedNamespaceCodec`.', '默认 `lengthPrefixedNamespaceCodec`。'),
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
    default: t(`\`globalThis.${storage}\`.`, `默认 \`globalThis.${storage}\`。`)
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
  }
]

/** Native IndexedDB options remain exact inputs to its one preparation path. */
const indexedDbFields: Readonly<Record<string, IMemberDoc>> = {
  dbName: {
    summary: t('Database name used by this installation.', '本次安装使用的数据库名称。'),
    default: t('`storage-web`.', '默认 `storage-web`。')
  },
  kvStoreName: {
    summary: t('Native text object store name.', '原生文本对象存储名称。'),
    default: t('`kv`.', '默认 `kv`。')
  },
  bytesStoreName: {
    summary: t('Native byte object store name.', '原生字节对象存储名称。'),
    default: t('`bytes`.', '默认 `bytes`。')
  },
  recordsStoreName: {
    summary: t('Native authoritative record object store name.', '原生权威记录对象存储名称。'),
    default: t('`records`.', '默认 `records`。')
  },
  cleanupLegacyRecords: {
    summary: t(
      'Delete the old documents store only after migration completes.',
      '仅在迁移完成后删除旧文档存储。'
    ),
    default: t('`false`.', '默认 `false`。'),
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
    default: t('`globalThis.indexedDB`.', '默认 `globalThis.indexedDB`。'),
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
    default: t('`globalThis.IDBKeyRange`.', '默认 `globalThis.IDBKeyRange`。'),
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
  namespace: webStorageFields('localStorage').namespace!,
  namespaceCodec: webStorageFields('localStorage').namespaceCodec!,
  document: {
    summary: t('Borrow the JS-visible document.cookie port.', '借用脚本可见的 Cookie 文档端口。'),
    default: t('`globalThis.document`.', '默认 `globalThis.document`。')
  },
  scope: {
    summary: t(
      'Fixed path/domain/SameSite/Secure/Partitioned attributes; secure is required for none or partitioned.',
      '固定的路径、域名、同站点、安全与分区属性；不限制同站点或启用分区时必须安全传输。'
    ),
    default: t("`{ path: '/' }`.", "默认 `{ path: '/' }`。")
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
        purpose: t(
          `Install the native ${module} backend into storage-host. Preparation finishes before publication; the host owns cleanup.${module === 'indexed-db' ? ' Native ttl covers text, bytes and records within the same transaction. Organization dbName mapping preserves the configured default and adds "/" + orgId otherwise. dropOrg drains and closes the target connection, deletes only that database, and keeps borrowed views reusable.' : ' Text organization views preserve the configured default namespace and use namespace + "/" + orgId otherwise; dropOrg clears only that target and keeps borrowed unique writes native.'}`,
          `把原生浏览器后端安装到 \`@migaia/storage-host\`，准备完成后才发布，由宿主拥有清理责任。${module === 'indexed-db' ? '原生 ttl 在同一事务支持文本、字节与记录期限。组织 dbName 保留配置的缺省目标，其它组织追加"/" + orgId；dropOrg 排空并关闭目标连接，只删除该数据库，既有借用视图可复用。' : '文本组织视图保留配置的缺省namespace，其它组织使用namespace + "/" + orgId；dropOrg只清该目标，借用唯一写仍由原生拥有者完成。'}`
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

/** Reference includes only current public browser entries; neutral ownership is explicit. */
export const storageWebReference: ILibraryReference = {
  modules: {
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
    'features/reactive': {
      summary: t(
        'Add live terminals to selected query chains. Each installed Feature owns one lazily attached source and retains native eventual visibility.',
        '为选定查询链增加实时终点，每个已安装特性拥有独立的惰性来源，保留原生最终可见性。'
      ),
      example: liveExample
    }
  },
  symbols: {
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
        'Define per-registration live queries for an explicit backend kind or target union. The Feature starts its original native source on first live and owns cleanup through the host lifecycle.',
        '为明确后端种类或目标联合定义每次注册独立的实时查询；首次实时终点接入原生来源，并通过宿主生命周期拥有清理。'
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
            physicalKey: t('One visible physical storage key.', '一个可见的物理存储键。')
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
        'Native database preparation and physical layout options.',
        '原生数据库准备与物理布局选项。'
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
        'Installed native IndexedDB backend with complete same-transaction scope methods.',
        '已安装的原生索引数据库后端，提供完整同事务作用域方法。'
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
      members: {
        runtime: {
          summary: t(
            'The caller Runtime created by createRuntime().',
            '调用者通过 `createRuntime()` 创建的运行时。'
          )
        },
        scope: {
          summary: t('Optional logical change scope.', '可选的逻辑变化范围。'),
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
          summary: t('Retain the last value while refreshing.', '刷新时保留上次值。'),
          default: t('`true`.', '默认 `true`。')
        },
        equals: {
          summary: t(
            'Suppress replacement for equivalent settled results.',
            '结果等价时抑制可见值替换。'
          ),
          default: t('No suppression.', '默认不抑制。')
        },
        timeoutMs: {
          summary: t('Optional deadline per query generation.', '每代查询的可选期限。'),
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
        backendDisposeFailed: t(
          '`BACKEND_DISPOSE_FAILED`: backend cleanup failed.',
          '`BACKEND_DISPOSE_FAILED`：直接后端清理失败，应检查保留的原始错误列表。'
        )
      }
    }
  },
  enhancers: {
    ...backendEnhancers,
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
