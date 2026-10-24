import type { IEnumDoc, IMemberDoc, ISymbolDoc, IText, ITypeDoc } from './contract.js'
import { storageHostCases } from './storage-host-cases.js'

/** Runtime and type reference share exact descriptions for the same native host surface. */
const t = (en: string, zh: string): IText => ({ en, zh })
/** These examples create an actual public memory installation and release its original host. */
const hostExample = (statement: string): string =>
  `import { createStorageHost, memoryBackendPlugin, createOrgId } from '@migaia/storage-host'\n\nawait using host = await createStorageHost({ plugins: [memoryBackendPlugin()] })\n${statement}`
/** Memory examples keep native configuration separate from Feature selection. */
const memoryExample = (options: string): string =>
  `import { createStorageHost, memoryBackendPlugin } from '@migaia/storage-host'\n\nawait using host = await createStorageHost({\n  plugins: [memoryBackendPlugin(${options})]\n})\nawait host.backend('memory').set('theme', 'dark')\nconsole.log(await host.backend('memory').get('theme'))`
/** Host construction examples never retain a global client or close another owner. */
const hostOptionsExample = (options: string): string =>
  `import { createStorageHost, createOrgId } from '@migaia/storage-host'\n\nawait using host = await createStorageHost(${options})\nawait host.detect()`
/** Options are captured once before initial plugin installation or native acquisition. */
const hostOptions: Readonly<Record<string, IMemberDoc>> = {
  journal: {
    summary: t(
      'Borrow an immutable per-org logger configuration or once initializer. Commit capture selects an asynchronous stage; sync writes then reject before their native terminal.',
      '借用不可变的逐组织日志配置或一次初始化器；提交捕获选择异步阶段，同步写入随后在原生终点之前拒绝。'
    ),
    default: t(
      'Omitted: no global journal stage or logger is installed.',
      '省略时不安装全局日志阶段或日志对象。'
    ),
    whenToUse: t(
      'Select explicit binlog, WAL, undo or ordinary operation telemetry.',
      '显式选择提交日志、预写日志、撤销或普通操作遥测时使用。'
    ),
    example: storageHostCases.createStorageHost![0]!.example
  },
  org: {
    summary: t(
      'Canonical lowercase UUID selected by the caller as the immutable default organization.',
      '调用方选择的规范小写组织编号，安装后作为不可变缺省组织使用。'
    ),
    default: t(
      'The all-zero UUID; nondefault native targets use configured namespace + "/" + orgId.',
      '缺省为全零组织编号；其它组织原生目标采用配置命名空间加斜线及组织编号。'
    ),
    example: hostOptionsExample('{ org: createOrgId() }')
  },
  autoDetect: {
    whenToUse: t(
      'Disable automatic checks when the application chooses an explicit detection point.',
      '应用需要自行选择环境检查时机时关闭自动检查。'
    ),
    summary: t(
      'Run registered original backend environment checks after the initial install completes.',
      '初始安装完成之后，执行已登记的原后端环境检查。'
    ),
    default: t(
      'true: createStorageHost awaits detection before returning.',
      '缺省为真，创建函数等待环境检查完成后返回。'
    ),
    values: {
      true: t('Detect the initial installed tuple immediately.', '立即检查初始已安装的插件元组。'),
      false: t('The caller explicitly awaits host.detect().', '调用方显式等待宿主环境检查。')
    },
    example: hostOptionsExample('{ autoDetect: false }')
  },
  installTimeoutMs: {
    summary: t(
      'Nonnegative finite millisecond budget covering the complete original install batch, including preparation.',
      '覆盖完整原安装批次及其准备过程的非负有限毫秒预算。'
    ),
    default: t('30000 milliseconds for the whole batch.', '整个批次缺省使用三万毫秒。'),
    example: hostOptionsExample('{ installTimeoutMs: 10_000 }')
  },
  scheduler: {
    summary: t(
      'Borrow an IScheduler from @migaia/utils/scheduler for original deadlines and elapsed-time observations.',
      '借用工具包调度器处理原期限与耗时观察，不创建第二超时拥有者。'
    ),
    default: t(
      'The original systemScheduler; this host does not close a borrowed scheduler.',
      '缺省使用原系统调度器，宿主不关闭借入的调度器。'
    ),
    example: `import { systemScheduler } from '@migaia/utils/scheduler'\nimport { createStorageHost } from '@migaia/storage-host'\nawait using host = await createStorageHost({ scheduler: systemScheduler })`
  },
  report: {
    summary: t(
      'Observe the exact secondary Error or thrown value; returned thenables are observed and reporter failures are contained.',
      '观察准确次要错误或抛出值；返回异步结果时会被观察，报告函数自身失败被收容。'
    ),
    default: t(
      'The original final diagnostic fallback observes unreported failures.',
      '省略时由原最终诊断回退观察未报告失败。'
    ),
    whenToUse: t(
      'Route hook and cleanup failures to the application’s diagnostic sink.',
      '需要把观察与清理失败交给应用诊断出口时使用。'
    ),
    example: hostOptionsExample('{ report: (error) => console.error(error) }')
  },
  hooks: {
    whenToUse: t(
      'Observe original host or backend boundaries from the first installation.',
      '需要从首次安装开始观察原宿主或后端边界时使用。'
    ),
    summary: t(
      'Initial synchronous observer map, sharing the same registry as host.hooks.on; observer failures report without vetoing storage results.',
      '初始同步观察映射，与宿主监听共用同一登记表；观察失败只报告，不否决存储结果。'
    ),
    default: t('Omitted: no initial observers are registered.', '省略时不登记初始观察函数。'),
    example: hostOptionsExample(
      `{\n  hooks: {\n    beforeHostClose: ({ backendCount }) => console.log(backendCount)\n  }\n}`
    )
  },
  plugins: {
    summary: t(
      'Explicit initial readonly plugin tuple; literal ids, Features and duplicate rejection participate in inference.',
      '显式初始只读插件元组，字面量编号、特性与重复拒绝共同参与类型推断。'
    ),
    default: t('Omitted: create an empty original host.', '省略时创建没有初始插件的原宿主。'),
    example: hostExample("console.log(await host.backend('memory').get('theme'))")
  }
}
/** Native memory options describe one isolated original data universe. */
const memoryOptions: Readonly<Record<string, IMemberDoc>> = {
  id: {
    summary: t(
      'Caller-selected bounded backend id used by the host registry and backend lookup.',
      '调用方选择的有界后端编号，供宿主登记表与后端查找使用。'
    ),
    default: t(
      'memory; multiple installations need distinct literal ids.',
      '缺省为 `memory`，多次安装需要不同字面量编号。'
    ),
    example: `import { createStorageHost, memoryBackendPlugin } from '@migaia/storage-host'\nawait using host = await createStorageHost({ plugins: [memoryBackendPlugin({ id: 'draft' })] })\nconsole.log(await host.backend('draft').get('theme'))`
  },
  namespace: {
    summary: t(
      'Configured physical target prefix captured before installation. Slash-UUID suffixes reject; a bare UUID is allowed.',
      '安装之前捕获的物理目标配置前缀；斜线加组织编号后缀会拒绝，单独组织编号字符串允许。'
    ),
    default: t(
      'memory; nondefault organizations retain the configured prefix.',
      '缺省为 `memory`，其它组织仍保留配置前缀。'
    ),
    example: memoryExample("{ namespace: 'session' }")
  },
  capacity: {
    summary: t(
      'Optional namespace-local committed entry/encoded-byte limits and native eviction policy; expiration is reclaimed before live victims.',
      '可选逐命名空间已提交条目及编码字节上限与原生驱逐策略，先回收过期项再驱逐活项。'
    ),
    default: t(
      'Omitted: unbounded original structuredClone domain with no capacity index.',
      '省略时保留原无限容量结构克隆值域，不创建容量索引。'
    ),
    example: memoryExample('{ capacity: { maxEntries: 100, eviction: "lru" } }')
  },
  'capacity.maxEntries': {
    summary: t(
      'Positive safe integer counting committed entries across native channels in this namespace.',
      '正安全整数，统计本命名空间内原生通道的已提交条目总数。'
    ),
    default: t('Omitted: no entry-count limit.', '省略时没有条目数量上限。'),
    example: memoryExample('{ capacity: { maxEntries: 100 } }')
  },
  'capacity.maxBytes': {
    summary: t(
      'Positive safe integer limiting the canonical encoded value bytes, not native JavaScript heap size.',
      '限制规范编码值字节的正安全整数，不表示原生 JavaScript 堆内存大小。'
    ),
    default: t(
      'Omitted: no byte accounting and the original cloneable value domain is retained.',
      '省略时不统计字节，保留原可克隆值域。'
    ),
    example: memoryExample('{ capacity: { maxBytes: 65_536 } }')
  },
  'capacity.eviction': {
    whenToUse: t(
      'Choose frequency retention for repeatedly read entries, or keep the default recency policy.',
      '反复读取条目需要保留频次时选择频次策略，否则保留缺省最近使用策略。'
    ),
    summary: t(
      'Choose the original linked policy used after expiration reclaim; ties remain least-recently used.',
      '选择过期回收之后使用的原链式策略，相同频次仍按最久未使用顺序处理。'
    ),
    default: t('lru: least recently used.', '缺省为最近最少使用策略。'),
    values: {
      lru: t('Evict the least recently used live entry.', '驱逐最久未使用的活条目。'),
      lfu: t(
        'Evict the least frequently used live entry, with recency breaking ties.',
        '驱逐使用频次最低的活条目，频次相同时按最近使用时间处理。'
      )
    },
    example: memoryExample('{ capacity: { maxEntries: 100, eviction: "lfu" } }')
  },
  concurrency: {
    summary: t(
      'Authentic fallback ConcurrencyPolicy for the original native attempt loop; per-call policy still takes precedence.',
      '原生尝试循环使用的真实后备并发策略，逐调用显式策略仍优先。'
    ),
    default: t(
      'Omitted: resolve the original owner policy, ultimately the contract default.',
      '省略时沿原拥有者解析策略，最终使用契约缺省策略。'
    ),
    example: `import { ConcurrencyPolicy } from '@migaia/storage-contract'\nimport { createStorageHost, memoryBackendPlugin } from '@migaia/storage-host'\nawait using host = await createStorageHost({\n  plugins: [memoryBackendPlugin({ concurrency: ConcurrencyPolicy.wait() })]\n})\nawait host.backend('memory').set('theme', 'dark')`
  },
  owner: {
    summary: t(
      'Optional native lock owner diagnostics; the label never grants lock or store authority.',
      '可选原生锁拥有者诊断信息，标签不授予锁权限或存储权限。'
    ),
    default: t(
      'Omitted: original generated owner identity without an application label.',
      '省略时使用原生成拥有者身份，不附应用标签。'
    ),
    example: memoryExample("{ owner: { label: 'drafts' } }")
  },
  'owner.label': {
    summary: t(
      'Caller-authored diagnostic label returned with the original holder observation.',
      '调用方编写的诊断标签，由原持有者观察记录返回。'
    ),
    default: t('Omitted: no human-readable owner label.', '省略时没有可读拥有者标签。'),
    example: memoryExample("{ owner: { label: 'drafts' } }")
  }
}

/** Existing source/code errors retain their public native class and original cause. */
export const storageHostRuntimeSymbols: Readonly<Record<string, ISymbolDoc>> = {
  STORAGE_HOST_SOURCE: {
    role: 'error',
    purpose: t(
      'The existing storage-host error source constant; use it with a semantic code instead of matching messages.',
      '既有存储宿主错误来源常量；应与语义码一起判断，不通过消息文本猜测失败。'
    ),
    example: `import { STORAGE_HOST_SOURCE } from '@migaia/storage-host'\nconsole.log(STORAGE_HOST_SOURCE)`
  },
  StorageError: {
    role: 'error',
    purpose: t(
      'Construct a frozen native Error with host source/code and exact diagnostic references; original failures remain on cause.',
      '构造冻结原生错误，附宿主来源与语义码并保留准确诊断引用，原失败保留在原因链。'
    ),
    params: {
      code: t('A semantic value from StorageErrorCode.', '来自 `StorageErrorCode` 的语义码值。'),
      details: t(
        'Optional original backend/key/channel/operation details and cause.',
        '可选原后端、键、通道及操作详情和原因。'
      ),
      message: t(
        'Optional owning-boundary text; omission uses the canonical code label.',
        '可选所属边界文本，省略使用规范错误码标签。'
      ),
      stage: t(
        'Optional entity decode/migrate/validate stage used by its invalid-record policy.',
        '实体无效记录策略使用的可选解码、迁移或校验阶段。'
      )
    },
    returns: t(
      'A frozen Error retaining native stack and original cause references.',
      '返回冻结错误，保留原生调用栈与准确原因引用。'
    ),
    example: `import { StorageError, StorageErrorCode } from '@migaia/storage-host'\nconst cause = new TypeError('invalid value')\nconst error = new StorageError(StorageErrorCode.validationFailed, { cause })\nconsole.error(error.code, error.cause)`
  },
  StorageErrorCode: {
    role: 'error',
    purpose: t(
      'Stable semantic host failure scenarios; inspect source together with a code and retain every original cause.',
      '稳定宿主语义失败场景，须同时检查来源与错误码，并保留每个原始错误原因。'
    )
  },
  StorageErrorText: {
    role: 'constant',
    purpose: t(
      'Canonical host messages and parameterized text factories; applications branch on semantic codes rather than these diagnostic strings. The vectorMmr entry diagnoses invalid MMR lambda, topN or hit vectors from the independent scorer.',
      '宿主规范消息与参数化文本工厂，应用应按语义码分支，不把诊断字符串当作协议；vectorMmr 条目说明独立评分器的 MMR 权重、topN 或候选向量非法。'
    ),
    example: `import { StorageErrorText } from '@migaia/storage-host'
console.log(StorageErrorText.vectorMmr)`
  },
  StorageHostFacade: {
    role: 'factory',
    purpose: t(
      'Construct the original lifecycle shell synchronously; createStorageHost is the asynchronous initial-install and detection entry.',
      '同步构造原生命周期外壳；需要初始安装与环境检查时使用异步创建入口。'
    ),
    params: {
      options: t(
        'Captured original host lifecycle options; plugins are installed separately with use.',
        '捕获的原宿主生命周期选项，插件通过安装方法另行安装。'
      )
    },
    options: 'IStorageHostOptions',
    returns: t(
      'The original host facade, owned and closed by its caller.',
      '返回由调用方拥有并关闭的原宿主外壳。'
    ),
    example: `import { StorageHostFacade, memoryBackendPlugin } from '@migaia/storage-host'\nawait using host = new StorageHostFacade()\nconst installed = await host.use(memoryBackendPlugin())\nawait installed.detect()\nconsole.log(installed.backend('memory'))`
  }
}

/** Literal-id projection aliases preserve inference without granting runtime ownership. */
export const storageHostRuntimeTypes: Readonly<Record<string, ITypeDoc>> = {
  IStorageErrorDetails: {
    summary: t(
      'Optional original host failure context; nested values and cause keep their original identities and are not deep-frozen.',
      '可选原宿主失败上下文，嵌套值及原因保持原身份，不进行深度冻结或替换。'
    ),
    members: {
      backend: {
        summary: t(
          'Original backend kind associated with this failure.',
          '本次失败关联的原后端种类。'
        )
      },
      key: {
        summary: t(
          'Original application string or structured key, when known.',
          '已知时保留原应用字符串或结构键。'
        )
      },
      existingChannel: {
        summary: t('Actual channel already owning a conflicting key.', '已经拥有冲突键的真实通道。')
      },
      attemptedChannel: {
        summary: t(
          'Actual channel requested by the rejected mutation.',
          '被拒绝修改请求的真实目标通道。'
        )
      },
      extensionStage: {
        summary: t(
          'Original schema, codec, migration or query callback phase.',
          '原模式、编解码、迁移或查询回调阶段。'
        )
      },
      operation: {
        summary: t(
          'Canonical operation name issued by the original owner.',
          '由原拥有者发出的规范操作名称。'
        )
      },
      cause: {
        summary: t(
          'Exact original thrown value, reachable through native Error.cause.',
          '准确原抛出值，可沿原生错误原因链到达。'
        )
      }
    }
  },
  StorageError: {
    summary: t(
      'Frozen native Error carrying host source/code, shallow diagnostic details and the exact original cause.',
      '携带宿主来源与语义码、浅层诊断详情及准确原原因的冻结原生错误。'
    ),
    scenarios: [
      t(
        'Inspect the semantic boundary without losing the original callback or native error.',
        '检查语义边界，同时保留原回调或原生错误。'
      )
    ],
    example: storageHostRuntimeSymbols.StorageError!.example,
    members: {
      source: {
        summary: t(
          'Exact STORAGE_HOST_SOURCE value stamped by the original host owner.',
          '原宿主拥有者附加的准确来源常量值。'
        )
      },
      code: {
        summary: t(
          'Semantic StorageErrorCode value; do not branch on diagnostic text.',
          '语义错误码值，不应通过诊断文本分支。'
        )
      },
      backend: {
        summary: t(
          'Original backend kind associated with this failure.',
          '本次失败关联的原后端种类。'
        )
      },
      key: {
        summary: t(
          'Original application string or structured key, when known.',
          '已知时保留原应用字符串或结构键。'
        )
      },
      existingChannel: {
        summary: t('Actual channel already owning a conflicting key.', '已经拥有冲突键的真实通道。')
      },
      attemptedChannel: {
        summary: t(
          'Actual channel requested by the rejected mutation.',
          '被拒绝修改请求的真实目标通道。'
        )
      },
      extensionStage: {
        summary: t(
          'Original schema, codec, migration or query callback phase.',
          '原模式、编解码、迁移或查询回调阶段。'
        )
      },
      operation: {
        summary: t(
          'Canonical operation name issued by the original owner.',
          '由原拥有者发出的规范操作名称。'
        )
      },
      stage: {
        summary: t(
          'Optional entity decode, migrate or validate stage for the original invalid-record policy.',
          '原实体无效记录策略使用的可选解码、迁移或校验阶段。'
        )
      }
    }
  },
  IStorageErrorFamily: {
    summary: t(
      'The same original host/contract error or explicitly admitted backend Error, preserved by normalizeError without rebuilding it.',
      '由规范化函数保留的同一个原宿主、契约或明确准入后端错误，不重建其对象。'
    ),
    scenarios: [
      t(
        'Keep a recognized coded boundary intact when a native owner normalizes unknown failures.',
        '原生拥有者规范化未知失败时保留已识别语义边界。'
      )
    ],
    example: `import { normalizeError } from '@migaia/storage-host/authoring/backend'\nimport { StorageError, StorageErrorCode } from '@migaia/storage-host'\nconst original = new StorageError(StorageErrorCode.invalidConfig)\nconst error = normalizeError(original, (cause) =>\n  new StorageError(StorageErrorCode.transactionFailed, { cause })\n)\nconsole.log(error.code)`,
    members: {
      source: {
        summary: t(
          'Original semantic source retained from the actual error owner.',
          '实际错误拥有者保留的原语义来源。'
        )
      },
      code: {
        summary: t(
          'Original semantic code from that same error owner.',
          '来自同一错误拥有者的原语义码。'
        )
      },
      backend: {
        summary: t(
          'Original backend diagnostic when this family member provides it.',
          '该家族成员提供时的原后端诊断。'
        )
      },
      key: {
        summary: t(
          'Original application key when this family member provides it.',
          '该家族成员提供时的原应用键。'
        )
      },
      existingChannel: {
        summary: t('Existing conflicting native channel when known.', '已知时的原生已有冲突通道。')
      },
      attemptedChannel: {
        summary: t('Requested native channel when known.', '已知时请求的原生目标通道。')
      },
      extensionStage: {
        summary: t(
          'Original extension failure phase when supplied by the owner.',
          '拥有者提供时的原扩展失败阶段。'
        )
      },
      operation: {
        summary: t(
          'Original operation name, without inventing missing context.',
          '原操作名称，不虚构缺失上下文。'
        )
      },
      stage: {
        summary: t(
          'Original entity invalid-record stage when present.',
          '存在时保留原实体无效记录阶段。'
        )
      }
    }
  },
  IMemoryOptions: {
    summary: t(
      'Captured native memory options; only an explicit capacity limit narrows the original unbounded storage domain.',
      '捕获的原生内存选项；只有显式容量限制才收窄原无限容量存储值域。'
    ),
    members: Object.fromEntries(
      Object.entries(memoryOptions).filter(([name]) => !name.includes('.') && name !== 'id')
    ),
    optionCases: [
      {
        title: t('Bound the committed namespace', '限制已提交命名空间'),
        problem: t(
          'Keep a bounded number of committed entries with native eviction diagnostics.',
          '按原生驱逐策略限制已提交条目数量，并保留拥有者诊断。'
        ),
        result: t(
          'The stored theme stays readable; the bound applies to later native commits.',
          '已保存主题仍可读取，上限在后续原生提交中执行。'
        ),
        covers: [
          'capacity',
          'capacity.maxEntries',
          'capacity.eviction',
          'namespace',
          'owner',
          'owner.label'
        ],
        example: memoryExample(
          "{ namespace: 'drafts', capacity: { maxEntries: 100, eviction: 'lru' }, owner: { label: 'ui' } }"
        )
      }
    ]
  },
  IStorageHostOptions: {
    summary: t(
      'Single-read original lifecycle options; the host owns installation and disposal while loggers and schedulers remain borrowed.',
      '单读的原生命周期选项，宿主拥有安装与释放，而日志对象及调度器保持借用。'
    ),
    members: Object.fromEntries(Object.entries(hostOptions).filter(([name]) => name !== 'plugins'))
  },
  IStorageHostCreateOptions: {
    summary: t(
      'Initial literal plugin tuple plus the same captured host options; selected journal inference is retained separately.',
      '初始字面量插件元组与相同捕获宿主选项，所选日志类型推断独立保留。'
    ),
    members: hostOptions
  },
  IMemoryBackendStore: {
    summary: t(
      'The installed memory store’s authentic native channels, sync view, transaction scope, feed and selected Feature methods.',
      '已安装内存存储的真实原生通道、同步视图、事务作用域、变更流及所选特性方法。'
    ),
    members: {}
  },
  IPluginStoreMap: {
    summary: t(
      'Map an installed plugin tuple’s literal ids to its exact original backend/Feature result types.',
      '把已安装插件元组的字面量编号映射到准确原后端及特性结果类型，不创建运行时表。'
    ),
    members: {}
  },
  IRejectInstalledOrDuplicateIds: {
    summary: t(
      'Static admission rejects duplicate literal ids in the same tuple or ids already installed in this typed host.',
      '静态准入拒绝同元组重复字面量编号，或当前类型化宿主已经安装的编号。'
    ),
    members: {}
  },
  IStorageErrorCode: {
    summary: t(
      'Value union of the canonical StorageErrorCode object, interpreted with STORAGE_HOST_SOURCE.',
      '规范宿主错误码对象的值联合，须与宿主来源常量同时解释，不单独依赖字符串。'
    ),
    members: {}
  },
  IStoragePluginId: {
    summary: t(
      'Extract the literal id from the exact opaque plugin handle; this type creates no registration.',
      '从准确不透明插件句柄提取字面量编号，该类型本身不创建任何登记。'
    ),
    members: {}
  },
  IStoragePluginExtensions: {
    summary: t(
      'Intersect installed plugins’ selected public extension outputs while retaining their actual receiver-free call shape.',
      '合并已安装插件所选公开扩展输出，保留真实且无需显式接收者的调用形状。'
    ),
    members: {}
  },
  IStorageNativePluginExtensions: {
    summary: t(
      'Infer an original descriptor’s install/expose output and remove only explicitly contextualized method receivers.',
      '推断原描述器的安装与暴露输出，仅去除明确按组织绑定的方法接收者参数。'
    ),
    members: {}
  },
  IStorageStoreWithFeatures: {
    summary: t(
      'Compose the original backend with selected capability implementations, separated chain families and Feature API methods.',
      '组合原后端与所选能力实现、彼此分离的链家族及特性接口方法，不替换后端身份。'
    ),
    members: {}
  },
  IStorageDefineFeature: {
    summary: t(
      'Overload-preserving Feature author function; exact kind and dependency identity constrain every selected output.',
      '保留重载的特性作者函数，准确种类及依赖身份约束每一个所选输出。'
    ),
    members: {}
  },
  IStorageDefinePlugin: {
    summary: t(
      'Overload-preserving plugin author function retaining the descriptor factory’s actual generic backend and extension types.',
      '保留重载的插件作者函数，维护描述器工厂真实泛型后端与扩展类型，不提前构造资源。'
    ),
    members: {}
  },
  IStorageFeatureRecord: {
    summary: t(
      'Readonly named selection of original Feature handles; names are local choices and do not replace target identities.',
      '对原特性句柄的只读具名选择，名称只是局部选择，不能替代真实目标身份。'
    ),
    members: {}
  },
  IStorageFeatureTarget: {
    summary: t(
      'One authentic kind token or a nonempty readonly tuple of authentic targets; matching names are insufficient.',
      '一个真实种类令牌或非空只读真实目标元组，仅名称相同不构成目标匹配。'
    ),
    members: {}
  },
  IStorageFeature: {
    summary: t(
      'Original PluginHost Feature handle carrying private storage target metadata and precise selected output/dependency types.',
      '携带私有存储目标元数据及准确输出与依赖类型的原插件宿主特性句柄。'
    ),
    members: {}
  },
  IStorageFeatureStoreCompatibility: {
    summary: t(
      'Static proof that the selected kind and concrete native store satisfy each Feature’s required expose surface.',
      '所选种类与具体原生存储满足每个特性所需暴露面的静态证明，不建立运行时准入替代路径。'
    ),
    members: {}
  },
  IStorageKindStore: {
    summary: t(
      'Extract the exact native store shape carried by an authentic backend kind without obtaining an instance.',
      '从真实后端种类提取准确原生存储形状，不因此取得任何存储实例。'
    ),
    members: {}
  },
  IStorageKindClient: {
    summary: t(
      'Extract the native client type carried by the original backend kind; no client is created or returned.',
      '提取原后端种类携带的原生客户端类型，不创建或返回客户端实例。'
    ),
    members: {}
  },
  IStorageKindExpose: {
    summary: t(
      'Extract only the original kind’s declared extra author functions, retaining the concrete client/scope types.',
      '只提取原种类声明的额外作者函数，保留具体客户端与作用域类型。'
    ),
    members: {}
  },
  IStorageKindTransactionClient: {
    summary: t(
      'Return type of the original kind’s transaction-client getter; kinds without that getter retain no transaction client.',
      '原种类事务客户端取值函数的返回类型，没有该函数的种类不取得事务客户端。'
    ),
    members: {}
  },
  IStorageKindTransactionScope: {
    summary: t(
      'Exact scope parameter of the original kind’s transaction-client getter, preserving native scope authentication.',
      '原种类事务客户端取值函数的准确作用域参数，保留原生作用域认证边界。'
    ),
    members: {}
  },
  storageBackendPluginExtensionsBrand: {
    summary: t(
      'Erased declaration-only identity carrying inferred descriptor extensions; export type does not publish a runtime symbol.',
      '只在声明中存在的擦除身份，携带推断描述器扩展；类型导出不发布运行时符号。'
    ),
    members: {}
  }
}

/** Option documents are reused by their true factory rather than inferred from unrelated APIs. */
export const storageHostFactoryOptionDocs = { host: hostOptions, memory: memoryOptions }

/** Host methods retain one registry and lifecycle; organization views omit root authority. */
const hostMembers: Readonly<Record<string, IMemberDoc>> = {
  hooks: {
    summary: t(
      'The original typed synchronous observer registry; failures only report.',
      '原类型化同步观察登记表，观察失败只报告而不改变业务结果。'
    )
  },
  extensions: {
    summary: t(
      'Frozen installed plugin extensions; explicitly contextual methods use this fixed organization.',
      '冻结的已安装插件扩展，明确上下文化的方法使用当前固定组织。'
    )
  },
  api: {
    summary: t(
      'Per-backend selected Feature API, preserving original client and authentic transaction projection.',
      '按后端提供所选特性接口，保留原客户端及真实事务投影。'
    )
  },
  detect: {
    summary: t(
      'Run only the registered original backend checks and await their cleanup.',
      '只执行已登记原后端检查，并等待相应清理完成。'
    ),
    returns: t(
      'Completes detection or rejects its original coded failure.',
      '检查完成后返回，失败时保留原语义错误。'
    ),
    example: hostExample('await host.detect()')
  },
  org: {
    summary: t(
      'Return a new immutable business view under this root lifecycle, retaining exact plugin inference.',
      '返回根生命周期下的新不可变业务视图，并保留准确插件推断。'
    ),
    params: {
      orgId: t(
        'Caller-created canonical UUID, normally returned by createOrgId.',
        '调用方创建的规范组织编号，通常来自 `createOrgId` 返回值。'
      )
    },
    returns: t(
      'A fixed-org view with no installation, deletion or disposal authority.',
      '返回固定组织视图，不授予安装、组织删除或释放权限。'
    ),
    example: hostExample(
      "const org = host.org(createOrgId())\nawait org.backend('memory').set('theme', 'dark')"
    )
  },
  dropOrg: {
    summary: t(
      'Attempt every admitted backend target for this organization without closing existing business views.',
      '尝试删除该组织的每个已准入后端目标，不关闭已有业务视图。'
    ),
    params: {
      orgId: t(
        'Canonical UUID returned by createOrgId or an existing org view.',
        '来自 `createOrgId` 或已有组织视图返回的规范编号。'
      )
    },
    returns: t(
      'Completes all deletions; failures aggregate original errors and successful targets are not rolled back.',
      '等待全部删除，失败时聚合原始错误，不回滚已成功目标。'
    ),
    example: hostExample('await host.dropOrg(createOrgId())')
  },
  use: {
    summary: t(
      'Atomically install one readonly tuple through the original PluginHost batch and rollback failed preparation.',
      '通过原插件宿主批次原子安装只读元组，准备失败时沿原路径回滚。'
    ),
    params: {
      plugins: t(
        'Original handles returned by definePlugin or native backend plugin factories.',
        '来自 `definePlugin` 或原生后端插件工厂返回的原句柄。'
      )
    },
    returns: t(
      'The same runtime host with the widened installed tuple; await detect after later native installation. Duplicate or overlapping batches reject.',
      '返回同一运行时宿主及拓宽的已安装元组；后续原生安装后应等待环境检查，重复或重叠批次拒绝。'
    ),
    example: `import { createStorageHost, memoryBackendPlugin } from '@migaia/storage-host'\nawait using original = await createStorageHost()\nconst host = await original.use(memoryBackendPlugin())\nawait host.detect()\nconsole.log(await host.backend('memory').get('theme'))`
  },
  backend: {
    summary: t(
      'Look up the exact original admitted backend by its installed literal id.',
      '按已安装字面量编号查找准确原准入后端，不按名称重建实例。'
    ),
    params: {
      id: t(
        'Literal id returned on the originally installed plugin handle.',
        '来自原已安装插件句柄返回的字面量编号。'
      )
    },
    returns: t(
      'Exact native store with selected Features; org views return a close-free fixed-org borrow.',
      '返回准确原生存储及所选特性，组织视图返回无关闭权的固定组织借用。'
    ),
    example: hostExample("await host.backend('memory').set('theme', 'dark')")
  },
  hasBackend: {
    summary: t(
      'Check original published membership without preparing or opening a backend.',
      '检查原已发布成员关系，不准备或打开后端。'
    ),
    params: {
      id: t(
        'Candidate id chosen by the caller from installed plugin ids.',
        '调用方从已安装插件编号中选择的候选编号。'
      )
    },
    returns: t(
      'True narrows the id to this host’s published registry keys.',
      '返回真时把编号收窄为该宿主已发布登记键。'
    ),
    example: hostExample("console.log(host.hasBackend('memory'))")
  },
  backends: {
    summary: t(
      'Return the current readonly membership snapshot with exact admitted backend values.',
      '返回当前只读成员快照，其中值保持准确准入后端身份。'
    ),
    returns: t(
      'Readonly map; org views project each value into the same fixed organization.',
      '返回只读映射，组织视图把每个值投影到同一固定组织。'
    ),
    example: hostExample('for (const [id] of host.backends()) console.log(id)')
  },
  dispose: {
    summary: t(
      'Seal the original host, drain accepted work and release installed resources in their existing order.',
      '封闭原宿主、排空已接纳工作，并按既有顺序释放已安装资源。'
    ),
    returns: t(
      'The original cached cleanup Promise; all failures remain inspectable through causes or aggregate errors.',
      '返回原缓存清理承诺，所有失败可沿原因链或聚合错误检查。'
    ),
    example: hostExample('await host.dispose()')
  },
  ...Object.fromEntries(
    [
      ['codecStages', 'codec encoding and decoding', '编解码的编码与解码'],
      ['queryStages', 'query planning and completion', '查询规划与完成'],
      ['transactionStages', 'native transaction boundaries', '原生事务边界'],
      ['concurrencyStages', 'original concurrency decisions', '原并发决策'],
      ['backendStages', 'original backend creation and disposal', '原后端创建与释放'],
      ['sqlStages', 'original native SQL request observations', '原生语句请求观察'],
      ['operationStages', 'original storage endpoint observations', '原存储终点观察']
    ].map(([name, en, zh]) => [
      name!,
      {
        summary: t(
          `Bind report-only ${en} to this exact store registration.`,
          `把只报告的${zh}绑定到本准确存储登记，不取得业务修改权限。`
        ),
        params: {
          store: t(
            'Exact backend returned by this host, or its authenticated fixed-org borrow.',
            '由该宿主返回的准确后端，或其已经认证的固定组织借用。'
          )
        },
        returns: t(
          'Original observer methods; they allocate no backend, transaction or diagnostic queue.',
          '返回原观察方法，不分配后端、事务或诊断队列。'
        ),
        example: hostExample(
          `const observer = host.${name}(host.backend('memory'))\nconsole.log(observer)`
        )
      }
    ])
  ),
  envelopeStages: {
    summary: t(
      'Bind report-only archive validation/migration stages to one exact store and operation.',
      '把只报告的存档校验与迁移阶段绑定到一个准确存储及操作。'
    ),
    params: {
      store: t(
        'Exact admitted store or authenticated business borrow returned by this host.',
        '该宿主返回的准确准入存储或认证业务借用。'
      ),
      operation: t(
        'Original repository operation name and target version.',
        '原仓储操作名称与目标版本。'
      )
    },
    returns: t(
      'Original envelope observers retaining only primitive operation context.',
      '返回原存档观察接点，只保留基本操作上下文。'
    ),
    example: hostExample(
      "const stages = host.envelopeStages(host.backend('memory'), {\n  operation: 'read', targetVersion: 1\n})\nconsole.log(stages)"
    )
  }
}

/** Root and organization views share only actual common methods, not hidden root rights. */
export const storageHostInstanceTypes: Readonly<Record<string, ITypeDoc>> = {
  IStorageHost: {
    summary: t(
      'The exact installed plugin tuple’s original registry, business access, hooks and root lifecycle.',
      '准确已安装插件元组的原登记表、业务访问、观察接点及根生命周期。'
    ),
    scenarios: [
      t(
        'Own native backend installation and application cleanup in one host.',
        '通过一个宿主拥有原生后端安装与应用清理。'
      )
    ],
    example: hostExample("await host.backend('memory').set('theme', 'dark')"),
    members: hostMembers
  },
  StorageHostFacade: {
    summary: t(
      'Synchronous original lifecycle shell implementing the host surface; initial installation and detection remain explicit.',
      '实现宿主公开面的同步原生命周期外壳，初始安装与环境检查保持显式。'
    ),
    scenarios: [
      t(
        'Use createStorageHost for the normal asynchronous factory path; construct a facade for explicit staged installation.',
        '正常异步路径使用创建工厂，需要显式分阶段安装时构造宿主外壳。'
      )
    ],
    example: storageHostRuntimeSymbols.StorageHostFacade!.example,
    members: hostMembers
  },
  IStorageOrgView: {
    summary: t(
      'Immutable fixed-org business view sharing its root lifecycle; it never grants root install, drop or close authority.',
      '共享根生命周期的不可变固定组织业务视图，始终不授予根安装、组织删除或关闭权限。'
    ),
    scenarios: [
      t(
        'Keep separate organization closures for repositories, Features and native queries.',
        '为仓储、特性与原生查询保留彼此独立的组织闭包。'
      )
    ],
    example: hostExample(
      "const org = host.org(createOrgId())\nawait org.backend('memory').set('theme', 'dark')"
    ),
    members: {
      ...Object.fromEntries(
        Object.entries(hostMembers).filter(
          ([name]) => !['use', 'dropOrg', 'dispose'].includes(name)
        )
      ),
      orgId: {
        summary: t(
          'Canonical UUID captured when this original business view was created.',
          '本原业务视图创建时捕获的规范组织编号，之后保持不可变。'
        )
      }
    }
  }
}

/** Each failure code retains a distinct user action and original error cause. */
export const storageHostRuntimeEnums: Readonly<Record<string, IEnumDoc>> = {
  StorageErrorCode: {
    summary: t(
      'Stable host failure scenarios retain native errors and original causes; these codes are not lifecycle states.',
      '稳定宿主失败场景保留原生错误与原始原因，这些语义码不是生命周期状态。'
    ),
    values: {
      backendIdInvalid: t(
        'Repair the plugin’s bounded ASCII id before installing.',
        '安装前修正插件的有界后端编号。'
      ),
      backendDuplicate: t(
        'Choose a distinct id or retry after the original batch settles.',
        '选择不同编号，或在原批次结算后重试。'
      ),
      backendNotInstalled: t(
        'Install this exact id or select a currently installed backend.',
        '安装此准确编号，或选择当前已安装后端。'
      ),
      backendPluginInvalid: t(
        'Repair the descriptor or store that failed runtime admission.',
        '修复运行时准入失败的描述器或存储。'
      ),
      backendInstallFailed: t(
        'Inspect original creation/preparation failure; the batch remains unpublished.',
        '检查原创建或准备失败，该批次仍未发布。'
      ),
      storageHostBusy: t(
        'Wait for the active original install batch, then explicitly retry.',
        '等待原活跃安装批次结束，再显式重试。'
      ),
      storageHostDisposed: t(
        'Use a new host after closure; sealed resources are not revived.',
        '关闭后使用新宿主，不恢复已经封闭的资源。'
      ),
      storageHostDisposeFailed: t(
        'Inspect all original cleanup failures and treat the resource as terminal.',
        '检查所有原清理失败，并把资源视为终态。'
      ),
      orgDeleteFailed: t(
        'Every target was attempted; inspect original failures and retry without rolling back successful deletions.',
        '已经尝试所有目标，应检查原失败并重试，不回滚成功删除。'
      ),
      backendKindMismatch: t(
        'Use the authentic backend kind selected by this installed store.',
        '使用该已安装存储所选的真实后端种类。'
      ),
      invalidConfig: t(
        'Repair malformed schema, codec or author configuration.',
        '修复非法模式、编解码或作者配置。'
      ),
      validationFailed: t(
        'Inspect the original schema rejection before changing the proposed value.',
        '检查原模式拒绝原因，再修改候选值。'
      ),
      serializeFailed: t(
        'Encoding rejected before backend I/O; inspect the original codec cause.',
        '编码在后端读写前拒绝，应检查原编解码原因。'
      ),
      deserializeFailed: t(
        'Preserve stored bytes and inspect the original decoding failure.',
        '保留持久字节并检查原解码失败。'
      ),
      duplicateKey: t(
        'Another channel owns the key; explicit replace removes that owner.',
        '其它通道已拥有该键，显式替换会移除该拥有者。'
      ),
      indexUniqueConflict: t(
        'Another record owns the projected unique value; repair the proposed commit.',
        '其它记录已拥有投影唯一值，应修复提交提案。'
      ),
      indexBackfillFailed: t(
        'Backfill and failed-readiness persistence both failed; inspect every cause.',
        '补录及失败就绪状态持久化均失败，应检查全部原因。'
      ),
      migrationFailed: t(
        'Correct the original application migration failure before retrying.',
        '重试之前修正原应用迁移失败。'
      ),
      versionUnsupported: t(
        'Stored data is newer than this definition; use a compatible entity version.',
        '持久数据比定义更新，应采用兼容实体版本。'
      ),
      transactionFailed: t(
        'Inspect the original memory native transaction failure.',
        '检查内存原生事务的原始失败。'
      ),
      journalRecordInvalid: t(
        'Owned journal bytes are malformed; retain them and stop using the damaged payload.',
        '自有日志字节损坏，应保留原字节并停止使用损坏负载。'
      ),
      journalRecoveryFailed: t(
        'Recovery or commit result is uncertain; close and reopen from durable head.',
        '恢复或提交结局不确定，应关闭并从持久头重新打开。'
      ),
      undoConflict: t(
        'Current full revision or value differs; no restoration was written.',
        '当前完整修订或值不同，未执行任何恢复写入。'
      ),
      undoNotFound: t(
        'No committed images exist for this target and transaction id.',
        '该目标及事务编号没有已提交镜像。'
      ),
      extensionFailed: t(
        'Inspect the original callback failure retained with operation and phase.',
        '检查随操作与阶段保留的原回调失败。'
      )
    }
  },
  StorageJournalLock: {
    summary: t(
      'Canonical parts of the existing private journal lock identity, not separate lock providers.',
      '既有私有日志锁身份的规范组成部分，不代表独立锁提供者或新的取锁权限。'
    ),
    values: {
      head: t(
        'Serialize the original journal head and append protocol.',
        '串行化原日志头与追加协议。'
      ),
      resource: t(
        'Reserve the original namespace’s cached-index lifetime when exclusivity is guaranteed.',
        '保证独占时保留原命名空间的缓存索引资源期。'
      )
    }
  }
}
