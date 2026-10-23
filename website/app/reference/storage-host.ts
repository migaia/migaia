import type { ILibraryReference, IText } from './contract.js'
import { storageHostCases } from './storage-host-cases.js'
/** Shared bilingual text keeps the reference descriptions aligned. */
const t = (en: string, zh: string): IText => ({ en, zh })
/** Neutral host and authoring entry, with no browser or native driver import. */
export const storageHostReference: ILibraryReference = {
  modules: {
    journal: {
      summary: t(
        'Open a fixed-organization private log through its original admitted backend binding.',
        '沿原已准入后端绑定打开固定组织私有日志。'
      ),
      example: storageHostCases.storageLogStore![0]!.example
    },
    'authoring/vector': {
      summary: t(
        'Expose only standard query vector synthesis; memory scoring and ranking remain private.',
        '只公开标准查询向量合成；memory 评分与排名仍私有。'
      ),
      example: storageHostCases.recommendStorageVector![0]!.example
    },
    'authoring/backend': {
      summary: t(
        'Share channel, unique-index, error and cancellation rules through finite backend functions. Controller and local key-lock construction stay on the original core; only their types are public through this entry. Features retain only controller lookup. The controller closing signal cancels its own pending lock admission without closing the shared provider. Its key-lock port excludes only the exact original live attempt lease when requested and probes canonical point identities directly, scans only selected channel buckets for ranges, and runs synchronous root writes after a final conflict recheck in the original attempt/FIFO.',
        '通过有限后端函数共享通道、唯一索引、错误和取消规则。controller和本地键锁构造归原core，本入口只公开其类型；Feature只保留controller读取。controller关闭信号只取消自身尚未启动的锁准入，不关闭共享provider。'
      ),
      example: `import { createStorageOperationReporter, reportCleanupError } from '@migaia/storage-host/authoring/backend'

const report = createStorageOperationReporter()
reportCleanupError(report, new Error('cleanup failed'))`
    },
    entity: {
      summary: t(
        'Compose entity repositories through the original transaction scope, immutable versioned envelopes, bounded queries, neutral schema adapters and strict portable codecs.',
        '实体仓储复用原事务scope、共享版本存档、有界查询、中立schema与严格portable codec。'
      ),
      example: `import { jsonCodec } from '@migaia/storage-host/entity'

const encoded = await jsonCodec.encode({ active: true })
console.log(await jsonCodec.decode(encoded))`
    },
    index: {
      summary: t(
        'Install exact backend plugins and application extensions with one runtime-neutral host. Installation-scoped borrowing reads committed dependencies without acquiring close authority. Browser adapters and native clients remain in their owning packages.',
        '用同一个运行时中立宿主安装精确后端插件和业务扩展。安装窗口借用已提交依赖，不授予关闭权。浏览器适配与原生客户端由各自包拥有。'
      ),
      example: `import { createStorageHost, definePlugin } from '@migaia/storage-host'

const labels = definePlugin('labels', () => ({
  install: () => ({ label: (value: string) => value.toUpperCase() })
}))
await using host = await createStorageHost({ plugins: [labels] })
console.log(host.extensions.label('draft'))`
    }
  },
  symbols: {
    asyncDisposeKey: {
      role: 'constant',
      purpose: t(
        'The original plugin-host disposal symbol, re-exported through the backend authoring entry. It preserves the same identity on runtimes with or without native Symbol.asyncDispose.',
        '通过后端作者入口重导出的原plugin-host释放symbol；无论运行时是否提供原生Symbol.asyncDispose，都保留同一身份。'
      ),
      example: storageHostCases.asyncDisposeKey![0]!.example,
      cases: storageHostCases.asyncDisposeKey
    },
    storageLogStore: {
      role: 'factory',
      purpose: t(
        'Recover a caller-closeable private ILogStore without granting raw backend or host authority. Native selection certifies the exact original registration, including across hosts with matching ids and orgs.',
        '恢复可由调用方释放的私有 ILogStore，不授予 raw 后端或宿主权；原生选择认证精确原 registration，跨宿主的同名 id/org 也不能替代。'
      ),
      params: {
        host: t(
          'The original host or its immutable organization view.',
          '原宿主或不可变组织视图。'
        ),
        id: t(
          'An exact installed backend ID with an authentic private journal binding.',
          '具备真实私有 journal binding 的准确已安装后端 ID。'
        ),
        options: t(
          'A nonempty private prefix, exclusive within this backend and organization.',
          '在该后端与组织中独占的非空私有 prefix。'
        )
      },
      returns: t(
        'Promise<ILogStore> after recovery; uncertain writes seal the handle, and reopening reads the durable head.',
        '恢复后的 Promise<ILogStore>；未确认写入停止句柄准入，重开读取持久 head。'
      ),
      example: storageHostCases.storageLogStore![0]!.example,
      cases: storageHostCases.storageLogStore
    },
    recommendStorageVector: {
      role: 'operation',
      purpose: t(
        'Compute positive mean minus negative mean for native retrieval.',
        '为原生检索计算正均值减负均值。'
      ),
      params: {
        positive: t(
          'Nonempty readonly sample vectors with common finite dimensions.',
          '具有相同有限维度的非空只读样本向量。'
        ),
        negative: t(
          'Optional readonly samples; omission or empty input contributes zero.',
          '可选只读样本；省略或空输入贡献零。'
        )
      },
      returns: t(
        'Independent readonly vector; invalid samples reject with INVALID_ARGUMENT and retain original causes. The collection validates cosine zero direction.',
        '独立只读向量；非法样本报 INVALID_ARGUMENT 并保留原 cause；cosine 零方向由 collection 校验。'
      ),
      example: storageHostCases.recommendStorageVector![0]!.example,
      cases: storageHostCases.recommendStorageVector
    },
    createBackendChangeIterator: {
      role: 'operation',
      purpose: t(
        'Bridge the installed controller to its original iterator lifetime with one pending invalidation slot.',
        '把已安装 controller 接到原 iterator 生命周期，仅保留一个待消费失效提示。'
      ),
      params: {
        controller: t(
          'The exact installed controller borrowed through the original core or Feature port.',
          '沿原 core 或 Feature 接点借用的准确已安装 controller。'
        ),
        options: t(
          'Fixed orgId/channel, optional text key/context, and optional original per-next execute callback. Context is captured once and supplied to execute.',
          '固定 orgId/channel，可选文本 key/context 与原逐 next execute 回调；context 单次捕获并传给 execute。'
        )
      },
      returns: t(
        'The native IStorageIterator<IStorageChange>. Multiple unconsumed matches coalesce to the latest sequence with channel all and no keys/scope. Disposal wakes pending reads before draining and unsubscribes once.',
        '原生 IStorageIterator<IStorageChange>；多个未消费匹配提示合并为最新 sequence 的 all，省略 keys/scope。释放先唤醒 pending read 再排空，只取消订阅一次。'
      ),
      example: storageHostCases.createBackendChangeIterator![0]!.example,
      cases: storageHostCases.createBackendChangeIterator
    },
    observeStorageBatch: {
      role: 'operation',
      purpose: t(
        'Observe one already-admitted native batch through the original operation stages and scheduler.',
        '借用原operation stages与scheduler观察一个已准入的原生批量操作。'
      ),
      params: {
        stages: t(
          'Original store or authenticated transaction operation observer.',
          '原store或真实事务的操作观察接点。'
        ),
        scheduler: t(
          'Original host scheduler used only for elapsed time.',
          '原宿主scheduler，仅用于测量耗时。'
        ),
        operation: t('Owning backend operation name.', '所属后端的操作名。'),
        count: t(
          'Input entry count, or undefined for a prefix operation.',
          '输入条目数，前缀操作可为undefined。'
        ),
        invoke: t(
          'Already-admitted native work, invoked exactly once.',
          '已准入的原生工作，仅调用一次。'
        )
      },
      returns: t(
        'Promise of the unchanged native result; original errors reject unchanged.',
        '返回原生结果的Promise；拒绝保持原异常对象。'
      )
    },
    registerRecordIndexBackfillStore: {
      role: 'operation',
      purpose: t(
        'Register the existing native backfill provider in its moved neutral owner.',
        '在迁入的中立拥有者登记已有原生补录 provider。'
      ),
      params: {
        backend: t('Original constructed backend object.', '原构造后端对象。'),
        provider: t(
          'Captured native backfill protocol; no methods are called during registration.',
          '捕获的原生补录协议；登记不调用其方法。'
        )
      },
      returns: t(
        'void; no transaction or close authority is granted.',
        'void；不授予事务或关闭权限。'
      )
    },
    markRecordIndexBackfillContentionFailure: {
      role: 'operation',
      purpose: t(
        'Mark an original coded native contention error without replacing it.',
        '标记原 coded 原生争用错误，不替换原对象。'
      ),
      params: { error: t('Original coded native error object.', '原 coded 原生错误对象。') },
      returns: t(
        'void; entity orchestration recognizes this same identity for its existing fallback.',
        'void；实体编排按同一身份识别已有回退。'
      )
    },
    RecordIndexBackfillPhase: {
      role: 'constant',
      purpose: t(
        'Retain canonical and legacy persisted scan phase values.',
        '保留 canonical 与 legacy 持久化扫描阶段值。'
      ),
      returns: t(
        'The existing phase vocabulary with no new backend state.',
        '已有阶段词汇，不新增后端状态。'
      )
    },
    defineEntity: {
      role: 'factory',
      purpose: t(
        'Define one immutable entity schema and migration plan, then connect it to an admitted native backend.',
        '定义冻结实体schema与迁移计划，再连接合法原生后端。'
      ),
      returns: t(
        'A typed repository with same-owner transaction binding, final-draft unique checks and bounded list/stream queries.',
        '带同owner事务绑定、最终草稿唯一检查与有界list/stream的类型化仓储。'
      ),
      cases: storageHostCases.defineEntity
    },
    memoryBackendPlugin: {
      role: 'factory',
      purpose: t(
        'Define an isolated memory backend without acquiring data before installation. Optional namespace-local capacity captures positive maxEntries/maxBytes and lru (default) or lfu once. Linked policy nodes and the original deadline radix select committed victims; native transactions and root writes share the original owner, budget and victim locks. onEvict reports only per-channel counts after commit. Explicit maxBytes requires a real canonical encoding; unsupported records reject before mutation. Omitted capacity and maxEntries preserve the original structuredClone domain.',
        '定义独立内存后端，安装前不获取数据。可选 namespace 容量单次捕获正 maxEntries/maxBytes 与 lru（缺省）或 lfu。策略双链节点和原 deadline radix 选择提交后的驱逐项，原生事务、根写共用原 owner、预算与目标锁。onEvict 只在提交后报告逐通道数量。显式 maxBytes 必须有真实 canonical 编码，不能编码的 record 修改前拒绝；省略容量及 maxEntries 保留原 structuredClone 值域。'
      ),
      returns: t(
        'A literal-id memory plugin retaining selected Features from the separate final argument memoryBackendPlugin(options, features). Native RDF uses six fixed canonical-term radix indexes, fixed-org graphs and the original transaction draft. Pattern matching is native; traversal and paging retain the shared query reader. Records use the shared records query core. Native blob keeps independent fixed-org object entries, conditional final commits, snapshot ranges and prefix pages, sharing original capacity and content resources without transaction projection.',
        '通过独立最后参数memoryBackendPlugin(options, features)保留所选Feature的字面量id内存插件。原生RDF以六个固定term radix索引、固定org图与原事务draft执行；pattern原生匹配，traversal和分页沿共享query reader；records复用原查询核心。原生blob保持独立固定org对象条目、条件最终提交、范围快照与前缀分页，复用原容量与内容资源，不提供事务投影。'
      ),
      cases: [
        ...(storageHostCases.memoryBackendPlugin ?? []),
        ...storageHostCases.createBackendChangeIterator!,
        ...storageHostCases.memoryNativeVector!
      ]
    },
    memoryBackendKind: {
      role: 'constant',
      purpose: t(
        'Target memory Features using exact backend kind identity.',
        '以准确后端种类身份绑定memory Feature。'
      ),
      returns: t(
        'The authentic memory kind; its client is undefined and its transaction client checks the original scope and returns undefined.',
        '真实memory种类；client为undefined，事务client校验原scope后返回undefined。'
      )
    },
    resolveStorageNamespace: {
      role: 'operation',
      purpose: t(
        'Resolve one configured backend namespace while keeping each instance prefix and canonical organization identity.',
        '解析后端配置namespace，保留各实例前缀与规范组织身份。'
      ),
      returns: t(
        'One argument validates and returns the configured target. Three arguments return the configured default target, or configured/orgId for another organization. A slash UUID configuration suffix rejects before I/O.',
        '单参校验并返回原配置；三参在缺省组织返回原配置目标，其它组织返回configured/orgId。配置的slash UUID后缀在I/O前拒绝。'
      ),
      cases: storageHostCases.resolveStorageNamespace
    },
    createOrgId: {
      role: 'factory',
      purpose: t(
        'Generate a lowercase UUID using the host native crypto.randomUUID capability.',
        '通过宿主原生crypto.randomUUID能力生成小写UUID。'
      ),
      returns: t(
        'A canonical UUID string. Missing native UUID support rejects with UNSUPPORTED_CAPABILITY and preserves the original cause.',
        '规范UUID字符串。缺少原生UUID能力时以UNSUPPORTED_CAPABILITY拒绝，并保留原cause。'
      ),
      example: `import { createOrgId } from '@migaia/storage-host'

console.log(createOrgId())`,
      cases: storageHostCases.createOrgId
    },
    repositoryMigrationKey: {
      role: 'operation',
      purpose: t(
        'Read the existing entity metadata layout identity shared by repositories and backend raw-record firewalls.',
        '读取repository与后端raw-record firewall共用的既有实体metadata布局身份。'
      ),
      returns: t(
        'The unchanged repository:<entityName>:migration metadata key.',
        '保持原格式的repository:<entityName>:migration metadata key。'
      ),
      example: `import { repositoryMigrationKey } from '@migaia/storage-host/entity'

console.log(repositoryMigrationKey('users'))`,
      cases: storageHostCases.repositoryMigrationKey
    },
    jsonCodec: {
      role: 'operation',
      purpose: t(
        'Encode portable values with the original version-one JSON codec. Unsupported values reject before backend I/O.',
        '使用原version-one JSON codec编码portable值。不支持的值在后端I/O前拒绝。'
      ),
      returns: t(
        'An asynchronous json@1 text codec whose errors retain the contract and original codec causes.',
        '异步json@1文本codec，错误cause保留contract与原codec错误。'
      ),
      cases: storageHostCases.jsonCodec
    },
    createStorageHost: {
      role: 'factory',
      purpose: t(
        'Create the original PluginHost-backed storage lifecycle and atomically install its initial tuple. Backend lookup retains the exact admitted object.',
        '建立复用原PluginHost的存储生命周期，并原子安装初始插件元组。后端查找保留准入的原对象。'
      ),
      returns: t(
        'A Promise of the exact installed host after default environment detection; a failed install or check is cleaned up before rejection. Set autoDetect:false for explicit host.detect().',
        '完成默认环境检查后返回精确宿主的Promise；安装或检查失败后完成清理再拒绝。autoDetect:false改为显式host.detect()。'
      ),
      example: `import { createStorageHost, definePlugin } from '@migaia/storage-host'

const labels = definePlugin('labels', () => ({
  install: () => ({ label: (value: string) => value.toUpperCase() })
}))
await using host = await createStorageHost({ plugins: [labels] })
console.log(host.extensions.label('draft'))`,
      cases: storageHostCases.createStorageHost
    },
    definePlugin: {
      role: 'factory',
      purpose: t(
        'Capture a named descriptor factory and selected Features without opening a backend. Named generic descriptor factories retain the actual store and extension types. The original core reads the captured defaultOrgId and creates revision facts for a physical backend through createRevisionPort().',
        '捕获具名descriptor工厂与选中的Feature，不提前打开后端。具名泛型工厂保留实际store和扩展类型。原core读取已捕获的defaultOrgId，并经createRevisionPort()创建物理后端修订事实。'
      ),
      returns: t(
        'An opaque literal-id plugin handle consumed by createStorageHost or host.use.',
        '由createStorageHost或host.use消费的字面量id插件句柄。'
      )
    },
    defineFeature: {
      role: 'factory',
      purpose: t(
        'Bind a synchronous Feature definition to authentic backend kind identities. Its selected capabilities, chain methods and grouped API retain precise author types. Original scope factories project transaction methods before freezing; original query and builder branches retain fluent methods and their receivers.',
        '把同步Feature定义绑定到真实后端种类身份，保留所选能力、链方法和分组API的作者类型；原scope工厂冻结前投影事务方法，原query和builder分支保留链方法与receiver。'
      ),
      returns: t(
        'The original opaque PluginHost Feature with private storage target metadata.',
        '带私有存储目标元数据的原PluginHost Feature。'
      )
    },
    defineStorageBackendKind: {
      role: 'factory',
      purpose: t(
        'Create an identity token describing the backend store, native client and extra function expose. Equal names do not make two tokens interchangeable.',
        '创建描述后端store、原生client与额外函数暴露面的身份令牌。同名令牌不能互换。'
      ),
      returns: t(
        'A kind factory whose result is checked by exact object identity at installation.',
        '种类工厂；安装时按结果对象的准确身份校验。'
      )
    },
    assertStorageBackendId: {
      role: 'operation',
      purpose: t(
        'Reject an invalid bounded ASCII backend id before installation changes membership.',
        '安装改变成员前拒绝非法的有界ASCII后端id。'
      ),
      returns: t(
        'Returns void for valid input; invalid input throws a coded native TypeError.',
        '合法输入返回void；非法输入抛带语义码的原生TypeError。'
      )
    }
  },
  types: {
    IBackendKeyLockPort: {
      summary: t(
        'Installation-issued canonical key locks shared by native backends.',
        '原安装窗口提供的规范键锁，由原生后端共享。'
      ),
      members: {
        attemptMetadata: {
          summary: t(
            'Hold only private metadata through the original point-lock owner; business clear ranges exclude this row.',
            '仅通过原点锁拥有者持有私有元数据；业务 clear 范围排除该行。'
          )
        }
      }
    },
    IStorageJournalNamespaceView: {
      summary: t(
        'Six original string KV methods plus actual private keys; business bulk and TTL capabilities are absent.',
        '原六个字符串 KV 方法与真实私有 keys，不继承业务批量和 TTL。'
      ),
      members: {}
    },
    IStorageJournalNamespace: {
      summary: t(
        'Private native run, actual commit/rollback callbacks and accepted-work disposal; it never closes its backend.',
        '私有原生 run、真实 commit/rollback 回调和已接纳工作清理，不关闭其后端。'
      ),
      members: {
        runCommitted: {
          summary: t(
            'Optionally publish an ordinary result inside the original actual commit terminal, before its head lease ends. Native append composition requires this port; ordinary logs do not.',
            '可选地在原真实提交 terminal 内、head lease 释放前发布普通操作结果；原生追加组合需要此接点，普通日志不需要。'
          )
        },
        transactionInfo: {
          summary: t(
            'Read the original authenticated transaction identity for this exact native namespace.',
            '读取精确原生 namespace 的原认证事务身份。'
          )
        }
      }
    },
    IStorageJournalBackendBinding: {
      summary: t(
        'Descriptor-captured original native I/O with immutable forOrg projection, never public KV prefixes.',
        'descriptor 捕获的原生 I/O 与不可变 forOrg 投影，不使用公开 KV 前缀。'
      ),
      members: {
        changes: {
          summary: t(
            'Memory enables ordered draft capture on the first call before business writes. Later reads return immutable images with final per-key revisions; late activation rejects instead of inventing history.',
            'memory 首次调用在业务写前开启原 draft 按序捕获；后续返回不可变镜像与每键最终修订，迟到开启明确拒绝而不猜历史。'
          )
        },
        writeCommitMarker: {
          summary: t(
            'Memory writes only its authentic native transaction id into the same private draft. Actual commit exposes the marker; rollback leaves none.',
            'memory 只把原认证 native 事务 id 写入同一私有 draft；真实 commit 后可见，rollback 不留 marker。'
          )
        },
        hasCommitMarker: {
          summary: t(
            'Read fixed-org private commit evidence through the original native owner, isolated from business clear and arbitrary user log prefixes.',
            '经原 native owner 读取固定组织的私有提交证据，与业务 clear 及任意用户日志 prefix 隔离。'
          )
        },
        removeCommitMarker: {
          summary: t(
            'Remove only terminal intent evidence in this original org through its existing native transaction path.',
            '沿本组织既有 native 事务路径仅回收已终态 intent 的提交证据。'
          )
        },
        readImage: {
          summary: t(
            'Read a missing/present durable image from the exact authenticated org scope. Memory uses the existing versioned portable JSON codec, original bytes encoding and logical RDF identity.',
            '从精确认证组织 scope 读取缺失或存在的持久镜像；memory 复用已有版本化 portable JSON codec、字节编码与逻辑 RDF 身份。'
          )
        },
        writeImage: {
          summary: t(
            'Restore through the original native draft and write validators; the same transaction commits or rolls back every restored channel and deadline.',
            '经原 native draft 与写入校验恢复；同一事务提交或回滚各恢复通道与 deadline。'
          )
        },
        readRevision: {
          summary: t(
            'Read complete original revision facts, including clear epochs and tombstones; memory own writes predict its one final per-key commit increment.',
            '读取含 clear epoch 与墓碑的完整原修订；memory 自有写入沿每键最终一次提交递增。'
          )
        }
      }
    },
    IStorageJournalTarget: {
      summary: t(
        'Original lock identity or backend-private metadata target.',
        '原锁身份或后端私有 metadata 目标。'
      ),
      members: {}
    },
    IStorageJournalImage: {
      summary: t(
        'Missing versus present encoded wire value; null never substitutes absence.',
        '区分缺失与存在的编码值，null 不替代缺失。'
      ),
      members: {}
    },
    IStorageJournalChange: {
      summary: t(
        'Original transaction before/after images with complete committed revision.',
        '原事务 before/after 镜像及完整已提交修订。'
      ),
      members: {}
    },
    IRecordIndexBackfillPhase: {
      summary: t(
        'Existing canonical or legacy persisted scan phase.',
        '已有 canonical 或 legacy 持久化扫描阶段。'
      ),
      members: {}
    },
    IRecordIndexBackfillCandidate: {
      summary: t(
        'Native candidate retaining key, raw value, revision and optional phase.',
        '保留 key、原值、revision 与可选阶段的原生候选。'
      ),
      members: {}
    },
    IRecordIndexBackfillPreparation: {
      summary: t(
        'Entity preparation result retaining decoded byte budget and projection outcome.',
        '保留解码字节预算与投影结果的实体准备记录。'
      ),
      members: {}
    },
    IRecordIndexBackfillReadOptions: {
      summary: t(
        'Optional asynchronous preparation outside the original native transaction.',
        '在原生事务外执行的可选异步准备。'
      ),
      members: {}
    },
    IRecordIndexBackfillProjection: {
      summary: t(
        'Prepared projection with expected native revision for the same commit.',
        '具备同次提交所需预期原生 revision 的已准备投影。'
      ),
      members: {}
    },
    IRecordIndexBackfillBatch: {
      summary: t(
        'Existing generation, owner token, checkpoints and native batch projections.',
        '已有 generation、owner token、checkpoint 与原生批投影。'
      ),
      members: {}
    },
    IRecordIndexBackfillRetryReceipt: {
      summary: t(
        'Durable receipt permitting the original exact batch retry.',
        '允许原精确批次重试的持久化回执。'
      ),
      members: {}
    },
    IRecordIndexBackfillSession: {
      summary: t(
        'Original native backfill renew/read/commit/fail/release protocol.',
        '原生补录原有 renew/read/commit/fail/release 协议。'
      ),
      members: {}
    },
    IRecordIndexBackfillStore: {
      summary: t(
        'Captured native provider owning preparation, index readiness and backfill sessions.',
        '拥有准备、索引就绪与补录会话的捕获原生 provider。'
      ),
      members: {}
    },
    IEntityQuery: {
      summary: t(
        'Immutable entity source selection over the original query core, retaining installed Feature methods.',
        '原查询核心上的不可变实体源选择，保留已安装的Feature方法。'
      ),
      members: {
        index: {
          summary: t(
            'Choose a declared index and optional key or range before filtering.',
            '在过滤前选择声明索引及可选键或范围。'
          )
        },
        all: {
          summary: t(
            'Materialize the shared query result; transaction queries inherit the original operation context.',
            '收集原查询结果；事务查询继承原操作上下文。'
          )
        },
        stream: {
          summary: t(
            'Advance the actual disposable iterator; each scoped next borrows the original transaction owner.',
            '推进实际可释放迭代器；每次事务next借用原transaction owner。'
          )
        }
      }
    },
    IEntityConnectStore: {
      summary: t(
        'Entity input accepts a complete raw KV store or an exact host-authenticated business view. Raw inputs retain full resource admission; borrowed views reuse private method facts without exposing close authority.',
        '实体输入接受完整raw KV或原宿主认证的精确业务视图。raw输入保留完整资源准入；借用视图复用私有方法事实，不暴露关闭权。'
      ),
      example: storageHostCases.entityOrganizations?.[0]?.example,
      members: {}
    },
    IEntityConnectOptions: {
      summary: t(
        'Explicit original codec/query observer ports; failures only report.',
        '显式原codec/query观察接点；失败只报告。'
      ),
      members: {}
    },
    IStorageOrgView: {
      summary: t(
        'Immutable business access to one organization under the root host lifecycle. Native backends retain their own data and transaction owners.',
        '在根宿主生命周期内固定访问单个组织；原生后端保留自己的数据与事务owner。'
      ),
      example: storageHostCases.storageOrganizations?.[0]?.example,
      members: {
        orgId: {
          summary: t(
            'Canonical UUID captured when the view is created.',
            '创建视图时捕获的规范UUID。'
          )
        },
        org: {
          summary: t(
            'Create another immutable business view with the same plugin inference.',
            '创建保留相同插件推断的另一个不可变业务视图。'
          ),
          params: {
            orgId: t(
              'Canonical UUID from createOrgId or the application default configuration.',
              '由createOrgId生成或应用缺省配置提供的规范UUID。'
            )
          },
          returns: t(
            'Another business view without installation or close authority.',
            '返回没有安装与关闭权的业务视图。'
          ),
          example: storageHostCases.storageOrganizations?.[0]?.example
        },
        backend: {
          summary: t(
            'Resolve this organization through the installed native registration and remove close ownership.',
            '通过已安装原生registration解析本组织后端，并移除关闭所有权。'
          ),
          params: {
            id: t(
              'Literal id of a plugin installed on the root host.',
              '根宿主已安装插件的字面量id。'
            )
          },
          returns: t(
            'Precisely typed borrowed backend; extracted methods retain this organization.',
            '精确类型的借用后端；提取的方法保持本组织。'
          ),
          example: storageHostCases.storageOrganizations?.[0]?.example
        },
        backends: {
          summary: t(
            'Return a detached map of this organization business backends.',
            '返回本组织业务后端的脱离Map。'
          ),
          returns: t(
            'A readonly map whose mutation cannot change the host registry.',
            '返回readonly Map，修改副本不会影响宿主registry。'
          ),
          example: storageHostCases.storageOrganizations?.[0]?.example
        },
        api: {
          summary: t(
            'Selected Feature APIs bound to the immutable organization and original native scope.',
            '绑定不可变组织与原生scope的已选Feature API。'
          )
        },
        extensions: {
          summary: t(
            'Original extension definitions with immutable organization call contexts and captured dependencies.',
            '拥有不可变组织调用上下文与已捕获依赖的原扩展定义。'
          )
        },
        hooks: {
          summary: t(
            'Original host observations filtered by this organization identity.',
            '按本组织身份过滤的原宿主观察。'
          )
        }
      }
    },
    IStorageOrgBinding: {
      summary: t(
        'Installation-only native target and deletion callbacks owned by the exact store cell. No second registry or lifecycle is introduced.',
        '由精确storeCell拥有的安装期原生目标与删除回调，不建立第二registry或生命周期。'
      ),
      members: {
        backend: {
          summary: t(
            'Resolve a canonical organization to its existing native physical target.',
            '将规范组织解析到既有原生物理目标。'
          ),
          params: {
            orgId: t(
              'Canonical UUID validated by the host organization boundary.',
              '已由宿主组织边界校验的规范UUID。'
            )
          },
          returns: t(
            'Original native provider store for that organization.',
            '该组织的原生provider store。'
          )
        },
        drop: {
          summary: t(
            'Delete only the requested physical organization without changing other targets.',
            '只删除请求的物理组织，不改变其它目标。'
          ),
          params: {
            orgId: t('Canonical UUID supplied to host.dropOrg.', '传给host.dropOrg的规范UUID。')
          },
          returns: t(
            'Completion of that native target deletion; failures retain the original error.',
            '返回该原生目标删除的完成结果，失败保留原错误。'
          )
        }
      }
    },
    IStorageOrgAuthoringPort: {
      summary: t(
        'Backend-only authority captured by core.createOrgAuthoringPort during installation. Lazy physical children share the original controller, key-lock and exact-store registry implementations and existing registration cleanup. Revocation seals this port; business views never receive it.',
        '后端作者在安装窗口通过core.createOrgAuthoringPort捕获的有限权限；按需物理子后端复用原controller、键锁、精确store登记及原registration清理。撤销后拒绝，业务视图不接收此端口。'
      ),
      members: {
        createChangeController: {
          summary: t(
            'Construct the original controller under this registration cleanup.',
            '由本registration清理拥有原controller构造。'
          )
        },
        createKeyLockPort: {
          summary: t(
            'Construct the original shared key-lock port; its physical backend retains final ownership.',
            '构造原共享键锁接点，最终关闭权仍归物理后端。'
          )
        },
        registerChangeController: {
          summary: t(
            'Register the exact child store in the original controller registry.',
            '将精确子store登记到原controller登记表。'
          )
        },
        registerValueCommit: {
          summary: t(
            'Register the child native atomic value writer in the same exact-store row.',
            '在同一精确store行登记子后端原子value写端点。'
          )
        }
      }
    },
    IStorageBackendOrgContext: {
      summary: t(
        'Read-only immutable invocation ports from the original registration. The context grants no store registration, provider installation or close authority.',
        '来自原registration的只读不可变调用接点；不授予store登记、provider安装或关闭权。'
      ),
      members: {
        orgId: {
          summary: t(
            'Canonical organization fixed for every derived invocation.',
            '固定用于所有派生调用的规范组织身份。'
          )
        },
        execution: {
          summary: t(
            'Original shared sync and async runners with original registration admission.',
            '保留原registration准入的共享同步与异步runner。'
          )
        },
        stageBindings: {
          summary: t(
            'Original observation factories emitting the captured organization identity.',
            '发出已捕获组织身份的原观察工厂。'
          )
        },
        callContext: {
          summary: t(
            'Immutable orgId and projection of installation-captured borrowed dependencies.',
            '不可变orgId与安装时已捕获借用依赖的投影。'
          )
        },
        createTransactionApi: {
          summary: t(
            'Bind selected API methods to one authentic native scope before freeze.',
            '在冻结前将已选API方法绑定到真实原生scope。'
          ),
          params: {
            scope: t(
              'Fresh scope created and registered by the native transaction owner.',
              '由原生事务owner构造并登记的新scope。'
            )
          },
          returns: t(
            'Original Feature transaction projection or undefined when absent.',
            '返回原Feature事务投影，未选时返回undefined。'
          )
        }
      }
    },
    IStorageHooks: {
      summary: t(
        'One synchronous registry shared by constructor hooks, host listeners and original plugin installation scopes.',
        '构造hooks、宿主监听器与原插件安装scope共用的同步注册表。'
      ),
      example: `import { createStorageHost } from '@migaia/storage-host'

await using host = await createStorageHost()
const off = host.hooks.on('beforeHostClose', ({ backendCount }) => console.log(backendCount))
await host.dispose()
off()`,
      scenarios: [
        t(
          'Observe cleanup or storage stage counts while retaining the original lifecycle owner.',
          '观察清理或存储阶段数量，保留原生命周期owner。'
        )
      ],
      members: {
        on: {
          summary: t(
            'Register one synchronous observer on the original host channel. Listener failures are reported without changing storage results.',
            '在原宿主通道登记同步observer。监听失败只报告，不改变存储结果。'
          ),
          params: {
            name: t(
              'An event key from the single augmentable hook map.',
              '唯一可扩充hook map中的事件键。'
            ),
            handler: t(
              'Receives the exact payload for that event; its return value is not awaited.',
              '接收该事件的精确载荷；不等待其返回值。'
            )
          },
          returns: t(
            'The original idempotent unsubscribe handle. Registration after host closure rejects.',
            '原幂等取消句柄。宿主关闭后登记会被拒绝。'
          ),
          example: `import { createStorageHost } from '@migaia/storage-host'

await using host = await createStorageHost()
const off = host.hooks.on('beforeHostClose', ({ backendCount }) => console.log(backendCount))
await host.dispose()
off()`
        }
      }
    }
  },
  enums: {
    StorageErrorCode: {
      summary: t(
        'Stable host errors retain native types and original causes.',
        '宿主稳定错误保留原生类型与原错误cause。'
      ),
      values: {
        orgDeleteFailed: t(
          'At least one organization target failed after every backend was attempted. Inspect all original errors and retry without rolling back successful deletions.',
          '尝试全部后端后仍有组织目标删除失败；检查所有原错误并重试，不回滚已成功删除。'
        )
      }
    }
  },
  enhancers: {}
}
