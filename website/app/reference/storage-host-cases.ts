import type { ICaseDoc, IText } from './contract.js'
/** Keep the two languages attached to one runnable public-entry scenario. */
const t = (en: string, zh: string): IText => ({ en, zh })
/** Both author functions share one actual portable image round-trip scenario. */
const portableImageCases: readonly ICaseDoc[] = [
  {
    title: t('Round-trip a portable native image', '往返可移植原生镜像'),
    problem: t(
      'Native adapters need the original durable codec without copying a memory implementation.',
      '原生 adapter 需要原持久 codec，无需复制 memory 实现。'
    ),
    example: `import { encodeStorageJournalImage, decodeStorageJournalImage } from '@migaia/storage-host/authoring/backend'
const image = encodeStorageJournalImage(true, { value: null })
console.log(decodeStorageJournalImage(image).value)`,
    result: t(
      'Prints { value: null }; absence, bytes, codec identity/version and original codec errors retain their existing semantics.',
      '输出 { value: null }；缺失、字节、codec 身份/版本及原 codec 错误保持原语义。'
    )
  }
]
/** Application extensions retain their exact inputs while the host owns installation and cleanup. */
export const storageHostCases: Readonly<Record<string, readonly ICaseDoc[]>> = {
  IStorageJournalRedoAttempt: [
    {
      title: t('Record only an authentic text scope', '只记录真实文本 scope'),
      problem: t(
        'A text transaction must not pretend to implement bytes and records.',
        '文本事务不能伪装成字节与记录事务。'
      ),
      example: `import type { IStorageJournalRedoAttempt } from '@migaia/storage-host'
function record(attempt: IStorageJournalRedoAttempt, scope: object): Promise<void> {
  return attempt.record(scope)
}
console.log(typeof record)`,
      result: t(
        'Prints function. The original owner authenticates the supplied scope at runtime; object shape alone grants no authority.',
        '输出 function；原拥有者在运行时认证 scope，单凭对象形状不授予权限。'
      )
    }
  ],
  IStorageJournalRedoBinding: [
    {
      title: t('Keep redo scope authority bounded', '限制 redo 的 scope 权限'),
      problem: t(
        'Text authors must authenticate a real scope without returning their raw store.',
        '文本作者须认证真实 scope，而不返回 raw store。'
      ),
      example: `import type { IStorageJournalRedoBinding } from '@migaia/storage-host'
import type { ITransactionScope } from '@migaia/storage-contract'
function transactionId(binding: IStorageJournalRedoBinding, scope: Omit<ITransactionScope, 'use'>): string {
  return binding.transactionInfo(scope).id
}
console.log(typeof transactionId)`,
      result: t(
        'Prints function. The actual binding is issued only by an original admitted text owner; this type grants no installer, store or commit handle. Native protection accepts the original attempt signal, and a replay notification runs only after successful WAL completion.',
        '输出 function。实际 binding 仅由原已准入文本拥有者提供，此类型不授 installer、store 或 commit 句柄。原物理保护接收 attempt 取消信号，replay 通知仅在 WAL 完成后运行。'
      )
    }
  ],
  encodeStorageJournalImage: portableImageCases,
  decodeStorageJournalImage: portableImageCases,
  IStorageFeatureClientResolver: [
    {
      title: t('Declare a finite native client resolver', '声明有限原生客户端选择'),
      problem: t(
        'Backend authors need an explicit client selection shape without another capability or resource registry.',
        '后端作者需要显式客户端选择形状，不另建能力或资源登记表。'
      ),
      example:
        "import type { IStorageFeatureClientResolver } from '@migaia/storage-host'\nconst resolver: IStorageFeatureClientResolver<undefined, undefined> = {\n  getClient: (_orgId) => undefined,\n  getTransactionClient: (_scope, _orgId) => undefined\n}\nconsole.log(await resolver.getClient('00000000-0000-0000-0000-000000000000'))",
      result: t(
        'Prints undefined for a backend with no native client. Real native backends return their original client and already-open transaction; only their installation may register this resolver.',
        '无原生客户端的后端输出undefined。真实原生后端返回原客户端及已打开事务，仅原安装窗口能登记resolver。'
      )
    }
  ],
  asyncDisposeKey: [
    {
      title: t('Use the original disposal key', '使用原释放键'),
      problem: t(
        'Keep native and fallback resource cleanup on the same identity.',
        '原生与替代资源清理使用同一身份。'
      ),
      example:
        "import { asyncDisposeKey } from '@migaia/storage-host/authoring/backend'\nconsole.log(typeof asyncDisposeKey === 'symbol')",
      result: t('Prints true.', '输出true。')
    }
  ],

  storageLogStore: [
    {
      title: t('Open an isolated private log', '打开隔离的私有日志'),
      problem: t(
        'Keep committed history outside business clear and preserve watermarks on reopen.',
        '提交历史不受业务 clear 影响，重开保留水位。'
      ),
      example: `import { createStorageHost, memoryBackendPlugin } from '@migaia/storage-host'
import { storageLogStore } from '@migaia/storage-host/journal'
import { LogRecordState } from '@migaia/logger/plugins/durable'

await using host = await createStorageHost({ plugins: [memoryBackendPlugin()] })
await using log = await storageLogStore(host, 'memory', { prefix: 'history' })
await log.append([{ kind: 'order.created', payload: { id: 'o1' } }])
await log.setState(1, LogRecordState.done)
console.log(await log.lastSeq(), await log.states(LogRecordState.pending))`,
      result: t(
        'Prints 1 []. The original registration owns cleanup; opening does not enable global journaling.',
        '输出 1 []。原登记拥有清理；打开日志不自动启用全局 journal。'
      )
    }
  ],
  createBackendChangeIterator: [
    {
      title: t('Borrow the installed invalidation owner', '借用已安装的失效提示拥有者'),
      problem: t(
        'A Feature needs a fixed-organization stream without constructing another controller.',
        'Feature 需要固定组织的流，无需另建 controller。'
      ),
      example: `import { createStorageHost, defineFeature, memoryBackendKind, memoryBackendPlugin } from '@migaia/storage-host'
import { createBackendChangeIterator } from '@migaia/storage-host/authoring/backend'

const changes = defineFeature(memoryBackendKind, ({ featureExpose }) => ({
  capabilities: [], chain: {},
  api: { store: {
    async changes() {
      return createBackendChangeIterator(featureExpose.getChangeController()!, {
        orgId: this.orgId, channel: 'value'
      })
    }
  }, transaction: {} }
}))
await using host = await createStorageHost({ plugins: [memoryBackendPlugin(undefined, { changes })] })
await using stream = await host.api.memory.changes()
const next = stream.next()
await host.backend('memory').set('status', 'ready')
console.log((await next).value?.kind)`,
      result: t(
        'Prints put; the stream borrows the original controller and disposes its one subscription.',
        '输出 put；流借用原 controller，只释放自己的订阅。'
      )
    }
  ],
  memoryNativeVector: [
    {
      title: t('Rank points in the installed memory namespace', '在已安装 memory namespace 排名点'),
      problem: t(
        'Use native vector search while sharing original TTL and organization ownership.',
        '使用原生向量检索并共享原 TTL 与组织拥有者。'
      ),
      example:
        "import { createStorageHost, memoryBackendPlugin } from '@migaia/storage-host'\nimport { vector, ttl } from '@migaia/storage-contract'\nimport { lockKey } from '@migaia/storage-host/authoring/concurrency'\nawait using host = await createStorageHost({ plugins: [memoryBackendPlugin()] })\nconst store = host.backend('memory')\nconst collection = store.use(vector).collection<{ group: string }>('docs', { dimensions: 2, metric: 'dot' })\nawait collection.upsert([{ id: 'a', vector: [1, 0], payload: { group: 'docs' } }])\nconsole.log((await collection.near([1, 0]).where({ group: 'docs' }).topK(1).all())[0]?.id)\nawait store.transaction(async (scope) => { await scope.use(ttl).expire(lockKey.vector('docs', 'a'), 0) })\nconsole.log(await collection.search([1, 0], { k: 1 }))\n// a, []",
      result: t(
        'Returns a, then no hits after the original transaction expires the vector.',
        '返回 a，原事务设置向量立即到期后无命中。'
      )
    }
  ],
  recommendStorageVector: [
    {
      title: t('Synthesize a native recommendation direction', '合成原生推荐方向'),
      problem: t(
        'Backends need the same mean rule before native retrieval.',
        '后端在原生检索前需要同一均值规则。'
      ),
      example: `import { recommendStorageVector } from '@migaia/storage-host/authoring/vector'
console.log(recommendStorageVector([[2, 0], [0, 2]], [[1, 0]]))
console.log(recommendStorageVector([[2, 4]], []))
console.log(recommendStorageVector([[2, 4]]))
// [0, 1], [2, 4], [2, 4]`,
      result: t(
        'Returns detached readonly vectors. Native engines retain search and collection ownership.',
        '返回独立只读向量；检索与 collection 仍由原生引擎拥有。'
      )
    }
  ],

  observeStorageBatch: [
    {
      title: t('Share one batch observation pair', '共享一对批量操作观察事件'),
      problem: t(
        'A backend needs batch counts without a second runner or transaction owner.',
        '后端需要批量计数，同时复用原runner与事务owner。'
      ),
      example: `import { observeStorageBatch } from '@migaia/storage-host/authoring/backend'
import { StorageStageKind, type IStorageOperationStageObserver } from '@migaia/storage-contract'
import { systemScheduler } from '@migaia/utils/scheduler'

const events: string[] = []
const stages: IStorageOperationStageObserver = {
  kind: StorageStageKind.operation,
  forTransaction: () => stages,
  beforeStorageOperation: (operation, count) => { events.push(operation + ':' + count) },
  afterStorageOperation: (_operation, _elapsed, count) => { events.push('removed:' + count) },
  report: () => undefined
}
console.log(await observeStorageBatch(stages, systemScheduler, 'removeMany', 3, () => 2))
console.log(events)`,
      result: t(
        'Prints 2 and ["removeMany:3", "removed:2"]. Real authors supply the original admitted store stages.',
        '输出2和["removeMany:3", "removed:2"]。真实后端传入原store已准入的观察接点。'
      )
    }
  ],
  defineEntity: [
    {
      title: t('Commit entities beside native values', '实体与原生键值一起提交'),
      problem: t(
        'Two repository writes and a status value must share one real transaction.',
        '两个仓储写入与状态值需要共享同一个真实事务。'
      ),
      example: `import { createStorageHost, memoryBackendPlugin } from '@migaia/storage-host'
import { defineEntity } from '@migaia/storage-host/entity'

const users = defineEntity<{ id: string; name: string }>({ name: 'users', key: 'id' })
await using host = await createStorageHost({ plugins: [memoryBackendPlugin()] })
const store = host.backend('memory')
const repo = users.connect(store)
await store.transaction(async (scope) => {
  await repo.in(scope).put({ id: 'a', name: 'Ada' })
  await repo.in(scope).put({ id: 'b', name: 'Grace' })
  await scope.set('status', 'ready')
})
console.log(await repo.query().where({ name: 'Ada' }).orderByComparator((left, right) => left.name.localeCompare(right.name)).limit(1).select('id', 'name').all())`,
      result: t(
        'Prints Ada after all three changes commit atomically.',
        '三个变更原子提交后输出Ada。'
      )
    }
  ],
  memoryBackendPlugin: [
    {
      title: t('Update selected native records', '更新选中的原生记录'),
      problem: t(
        'Change matching records with one real commit and an actual count.',
        '通过一次真实提交修改匹配记录并返回实际数量。'
      ),
      example: `import { records } from '@migaia/storage-contract'
import { createStorageHost, memoryBackendPlugin } from '@migaia/storage-host'

await using host = await createStorageHost({ plugins: [memoryBackendPlugin()] })
const store = host.backend('memory')
await store.putRecord({ active: true }, 'one')
console.log(await store.use(records).query<{ active: boolean }>().where({ active: true }).update({ active: false }))`,
      result: t(
        'Prints 1 after commit. Records/RDF scoped writes share the original draft; vector delete keeps its bounded ranking.',
        '提交后输出1。records/RDF事务内写入共用原draft，vector删除保留原有界排名。'
      )
    },
    {
      title: t('Read an immutable native object range', '读取原生对象的不可变范围快照'),
      problem: t(
        'An application needs opaque objects without projecting them into KV or a transaction.',
        '业务需要独立的不透明对象，不将其投影为KV或事务。'
      ),
      example: `import { blob } from '@migaia/storage-contract'
import { createStorageHost, memoryBackendPlugin } from '@migaia/storage-host'

await using host = await createStorageHost({ plugins: [memoryBackendPlugin()] })
const objects = host.backend('memory').use(blob)
await objects.put('images/sample', new Uint8Array([1, 2, 3]), { ifNoneMatch: true })
await using object = (await objects.get('images/sample', { range: { start: 1, end: 1 } }))!
console.log((await object.bytes())[0])`,
      result: t(
        'Prints 2. Conditions precede upload ownership and are rechecked at commit; the inclusive range has one original content claim.',
        '输出2。条件先于上传reader接管并在提交时复核；包含end的范围只有一次原内容消费权。'
      )
    },
    {
      title: t('Commit native RDF with the original draft', '用原 draft 提交原生 RDF'),
      problem: t(
        'Ground graph data must share namespace and transaction ownership with KV.',
        'Ground 图数据需要与 KV 共用 namespace 和事务 owner。'
      ),
      example:
        "import { createStorageHost, memoryBackendPlugin } from '@migaia/storage-host'\nimport { rdf } from '@migaia/storage-contract'\nimport { term } from '@migaia/storage-host/authoring/rdf'\n\nawait using host = await createStorageHost({ plugins: [memoryBackendPlugin()] })\nconst memory = host.backend('memory')\nawait memory.transaction(async tx => {\n  await tx.set('status', 'ready')\n  await tx.use(rdf).add([{\n    subject: term.iri('urn:alice'), predicate: term.iri('urn:knows'),\n    object: term.iri('urn:bob'), graph: term.defaultGraph\n  }])\n})\nconsole.log(await memory.use(rdf).match({ subject: term.iri('urn:alice') }).count())",
      result: t(
        'Prints 1 after KV and the logical default graph commit together.',
        'KV 与逻辑 default graph 同提交后输出 1。'
      )
    },
    {
      title: t('Bound one memory namespace with native LRU', '用原生 LRU 限制一个内存 namespace'),
      problem: t(
        'Evict committed physical entries without a second cache or transaction owner.',
        '驱逐已提交物理条目，不另建缓存或事务 owner。'
      ),
      example: `import { createStorageHost, memoryBackendPlugin } from '@migaia/storage-host'
await using host = await createStorageHost({ plugins: [memoryBackendPlugin({ capacity: { maxEntries: 2 } })] })
const memory = host.backend('memory')
host.hooks.on('onEvict', event => console.log(event.channel, event.count))
await memory.set('a', 'a')
await memory.set('b', 'b')
await memory.get('a')
await memory.set('c', 'c')
console.log(await memory.get('b'))
// value 1
// null`,
      result: t(
        'Prints value 1 and null; only the committed least-recent entry is evicted.',
        '输出 value 1 和 null；仅驱逐已提交的最久未访问条目。'
      )
    },
    {
      title: t('Commit three native memory channels', '提交内存的三个原生通道'),
      problem: t(
        'One isolated backend needs text, bytes and queried records within the original transaction owner.',
        '一个隔离后端需要沿原事务owner提交文本、字节与可查询记录。'
      ),
      example: `import { createStorageHost, memoryBackendPlugin } from '@migaia/storage-host'
import { records } from '@migaia/storage-contract'

type Order = { state: string; total: number }
await using host = await createStorageHost({ plugins: [memoryBackendPlugin()] })
const memory = host.backend('memory')
await memory.transaction(async (tx) => {
  await tx.set('status', 'ready')
  await tx.setBytes('receipt', new Uint8Array([1, 2]))
  await tx.putRecord({ state: 'paid', total: 20 }, 'order-1')
})
console.log(await memory.use(records).query<Order>().where({ state: 'paid' }).select('total').all())`,
      result: t(
        'Prints [{ total: 20 }] after the native transaction commits.',
        '原生事务提交后输出[{ total: 20 }]。'
      )
    }
  ],
  resolveStorageNamespace: [
    {
      title: t('Retain per-instance organization prefixes', '保留各实例组织前缀'),
      problem: t(
        'Two backend instances need distinct configured targets even for the same organization.',
        '两个后端实例在同一组织中仍需保留不同配置目标。'
      ),
      example: `import { resolveStorageNamespace } from '@migaia/storage-host/authoring/backend'

const defaultOrg = '00000000-0000-0000-0000-000000000000'
const org = '10000000-0000-0000-0000-000000000000'
console.log(resolveStorageNamespace('prefs', defaultOrg, defaultOrg))
console.log(resolveStorageNamespace('prefs', org, defaultOrg))
console.log(resolveStorageNamespace('cache', org, defaultOrg))`,
      result: t(
        'Prints prefs, prefs/org and cache/org, where org is the supplied canonical UUID.',
        '输出prefs、prefs/org与cache/org，其中org为给出的规范UUID。'
      )
    }
  ],
  entityOrganizations: [
    {
      title: t(
        'Connect one entity layout to separate organizations',
        '将同一实体布局连接到不同组织'
      ),
      problem: t(
        'Entity repositories need organization isolation without owning a backend lifetime.',
        '实体仓储需要组织隔离，同时不取得后端生命周期所有权。'
      ),
      example: `import { createStorageHost, createOrgId, memoryBackendPlugin } from '@migaia/storage-host'
import { defineEntity } from '@migaia/storage-host/entity'

await using host = await createStorageHost({ plugins: [memoryBackendPlugin()] })
const users = defineEntity<{ id: string; name: string }>({ name: 'users', key: 'id' })
const left = users.connect(host.org(createOrgId()).backend('memory'))
const right = users.connect(host.org(createOrgId()).backend('memory'))
await left.put({ id: 'same', name: 'Ada' })
await right.put({ id: 'same', name: 'Grace' })
console.log(await left.get('same'), await right.get('same'))`,
      result: t(
        'Prints Ada and Grace from independent native namespaces; root resource syntax closes both.',
        '分别从独立原生namespace输出Ada与Grace；根资源语法统一关闭。'
      )
    }
  ],
  storageOrganizations: [
    {
      title: t(
        'Keep captured business methods inside one organization',
        '让提取的业务方法保持组织隔离'
      ),
      problem: t(
        'Two organizations share one host while writing the same logical key.',
        '两个组织共用宿主并写入相同逻辑键。'
      ),
      example: `import { createStorageHost, createOrgId, memoryBackendPlugin } from '@migaia/storage-host'

await using host = await createStorageHost({ plugins: [memoryBackendPlugin({ namespace: 'prefs' })] })
const left = host.org(createOrgId()).backend('memory')
const right = host.org(createOrgId()).backend('memory')
const writeLeft = left.set
await right.set('theme', 'light')
await writeLeft('theme', 'dark')
console.log(await left.get('theme'), await right.get('theme'))`,
      result: t(
        'Prints dark and light. The captured method retains its native namespace.',
        '输出dark和light，提取的方法保持原生namespace。'
      )
    }
  ],
  createOrgId: [
    {
      title: t('Generate native organization identity', '生成原生组织身份'),
      problem: t(
        'The host default organization needs a canonical identity generated by native cryptography.',
        '宿主默认组织需要由原生密码能力生成的规范身份。'
      ),
      example: `import { createOrgId, createStorageHost } from '@migaia/storage-host'

const org = createOrgId()
await using host = await createStorageHost({ org })
console.log(org)`,
      result: t('Prints a canonical lowercase UUID.', '输出规范小写UUID。')
    }
  ],
  repositoryMigrationKey: [
    {
      title: t('Share one persisted entity layout', '共享同一持久化实体布局'),
      problem: t(
        'A backend raw-record firewall must invalidate the same metadata record as its repository.',
        '后端raw-record firewall必须使repository使用的同一个metadata记录失效。'
      ),
      example: `import { repositoryMigrationKey } from '@migaia/storage-host/entity'

console.log(repositoryMigrationKey('users'))`,
      result: t(
        'Prints repository:users:migration. The package move changes no persisted key.',
        '输出repository:users:migration。包迁移不改变持久化key。'
      )
    }
  ],
  jsonCodec: [
    {
      title: t('Encode a portable record', '编码portable记录'),
      problem: t(
        'A text backend needs explicit rejection of values JSON would silently change.',
        '文本后端需要明确拒绝JSON会静默修改的值。'
      ),
      example: `import { jsonCodec } from '@migaia/storage-host/entity'

const encoded = await jsonCodec.encode({ active: true })
console.log(await jsonCodec.decode(encoded))`,
      result: t(
        'The record round-trips. Undefined and nonfinite numbers reject with SERIALIZE_FAILED before storage writes.',
        '记录往返保持值；undefined和非有限数字在写入前拒绝并携带SERIALIZE_FAILED。'
      )
    }
  ],
  createStorageHost: [
    {
      title: t('Record a real native memory commit', '记录真实 native memory 提交'),
      problem: t(
        'Build the same-registration private carrier before borrowing its logger.',
        '先建立同 registration 私有载体，再借用其 logger。'
      ),
      example: `import { Logger } from '@migaia/logger'
import { binlog } from '@migaia/logger/plugins/durable'
import { createStorageHost, memoryBackendPlugin } from '@migaia/storage-host'
const borrowed: Array<{ shutdown(reason: 'manual'): Promise<unknown> }> = []
await using host = await createStorageHost({
  plugins: [memoryBackendPlugin()],
  journal: async ({storageLogStore}) => {
    const records = await storageLogStore('memory', { prefix: 'commits' })
    const logger = new Logger({
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
      plugins: [binlog({ store: records })]
    })
    borrowed.push(logger)
    return { logger, namespace: 'orders', atomicBinlog: { memory: records } }
  }
})
try { await host.backend('memory').set('status', 'ready') }
finally { for (const logger of borrowed) await logger.shutdown('manual') }`,
      result: t(
        'The value and one storage.commit share the original native commit. Host owns private handles; the application still closes borrowed loggers. The memory namespace uses the same createBackendJournalNamespace resource owner and canonical storageJournalLockKey head/resource identities as native adapters. A namespace declaring indexExclusive:false rejects cached log construction before recovery I/O. Native clear retains per-row images, original epochs and one clear event. Without atomicBinlog the external append starts only after COMMIT; a false-atomic terminal is accepted only for this pure commit-only combination; failure reports without changing committed success. External WAL persists intent before data/marker commit and recovers only the complete fixed target. Native memory undo validates all full revisions and values before one new original commit. External undo requires WAL and original marker ports, preserving pending intent until complete mirror publication; exact repeated mirrors are idempotent. Telemetry uses the actual level plugin, preserves payload/Error references and observes one complete public retry loop. Blob capture and redo remain unfinished.',
        '值与一条 storage.commit 共用原 native 提交；宿主拥有私有句柄，应用仍关闭借用 logger。memory namespace 与 native adapter 复用同 createBackendJournalNamespace 资源拥有者和 storageJournalLockKey head/resource 规范身份；namespace 声明 indexExclusive:false 时在恢复 I/O 前拒绝缓存日志构造。原生 clear 保留逐项镜像、原 epoch 与一次 clear 事件。未选 atomicBinlog 时仅 COMMIT 后外置追加；false-atomic terminal 只准入此纯提交后组合，失败报告且不改变已提交成功。外置 WAL 在业务/marker 提交前持久化 intent，恢复只处理完整固定目标。memory 原生 undo 在一次新原提交前比较全部完整修订和值；外置 undo 要求 WAL 与原 marker 端口，完整镜像发布前保 pending，重复镜像仅内容相等时幂等略过；telemetry 复用真实 level 插件，保留 payload/原 Error 并观察一次完整公开重试循环；blob 捕获与 redo 尚未完成。'
      )
    },

    {
      title: t('Run environment checks explicitly', '显式执行环境检查'),
      problem: t(
        'A caller needs to control when environment checks run without triggering probes from a business endpoint.',
        '调用方需要控制环境检查时机，不让业务终点隐式执行探针。'
      ),
      example: `import { createStorageHost, definePlugin } from '@migaia/storage-host'

const check = definePlugin('environment', (core) => ({
  install: () => {
    core.registerDetect(async () => console.log('checked'))
    return {}
  }
}))
await using host = await createStorageHost({ plugins: [check], autoDetect: false })
await host.detect()
await host.detect()`,
      result: t(
        'Prints checked once. The second call reuses the successful detection Promise.',
        '只输出一次checked。第二次调用复用成功的检查Promise。'
      )
    },
    {
      title: t('Observe one host lifetime', '观察同一个宿主生命周期'),
      problem: t(
        'A caller needs cleanup counts without replacing cleanup or awaiting listeners.',
        '调用方需要清理数量，保留原清理流程且不等待监听器。'
      ),
      example: `import { createStorageHost } from '@migaia/storage-host'

await using host = await createStorageHost()
const off = host.hooks.on('beforeHostClose', ({ backendCount }) => console.log(backendCount))
await host.dispose()
off()`,
      result: t(
        'Prints 0 once. Cleanup retains its original owner; the returned unsubscribe handle is idempotent.',
        '输出一次0。清理由原owner执行，返回的取消句柄幂等。'
      )
    },
    {
      title: t('Bind a nested extension to its calling org', '把嵌套扩展绑定到调用组织'),
      problem: t(
        'A composed API needs its original borrowed backend and org without changing ordinary data extensions.',
        '组合API需要原借用后端与组织，同时保留普通数据扩展的身份。'
      ),
      example: `import { createStorageHost, createOrgId, definePlugin, memoryBackendPlugin, type IStoragePluginCallContext } from '@migaia/storage-host'
import { kv } from '@migaia/storage-contract'

const composition = definePlugin('composition', (core) => {
  const memory = core.getPublishedBackend('memory')
  return {
    contextualExtensions: ['archive'],
    install: () => ({
      archive: {
        async put(this: IStoragePluginCallContext, value: string) {
          await this.backend(memory).use(kv).set('title', value)
          return this.orgId
        }
      }
    })
  }
})
const base = await createStorageHost({ plugins: [memoryBackendPlugin()] })
const host = await base.use(composition)
try {
  const orgId = createOrgId()
  const org = host.org(orgId)
  const put = org.extensions.archive.put
  console.log(await put('draft') === orgId, await org.backend('memory').get('title'))
} finally { await host.dispose() }`,
      result: t(
        'Prints true and draft. Saved own methods keep their original receiver and org, while registration cleanup still rejects later calls.',
        '输出true和draft。保存的自有方法保持原receiver与组织，原registration清理仍会拒绝后续调用。'
      )
    },
    {
      title: t(
        'Install an application extension with owned cleanup',
        '安装由宿主负责清理的业务扩展'
      ),
      problem: t(
        'A request needs a small extension and one explicit owner for its lifetime. Define an ordinary plugin when no storage backend is needed.',
        '请求需要一个小型扩展和明确的生命周期拥有者。不需要存储后端时，可定义普通插件。'
      ),
      example: `import { createStorageHost, definePlugin } from '@migaia/storage-host'

const labels = definePlugin('labels', () => ({
  install: () => ({ label: (value: string) => value.toUpperCase() })
}))
await using host = await createStorageHost({ plugins: [labels] })
console.log(host.extensions.label('draft'))`,
      result: t(
        'Prints DRAFT. The literal plugin tuple retains the label method and resource syntax disposes one host.',
        '输出DRAFT。字面量插件元组保留label方法，资源语法释放同一个宿主。'
      )
    }
  ]
}
