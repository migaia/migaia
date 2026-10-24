# @migaia/storage-host

运行时中立的存储宿主与后端作者 API。宿主复用唯一 PluginHost 生命周期，负责原子安装、精确后端查找和清理；浏览器适配与数据库客户端由各自后端拥有。

```ts
import { createStorageHost, definePlugin } from '@migaia/storage-host'

const labels = definePlugin('labels', () => ({
  install: () => ({ label: (name: string) => name.toUpperCase() })
}))
await using host = await createStorageHost({ plugins: [labels] })
console.log(host.extensions.label('draft'))
```

后端 descriptor 声明真实 `kind`、仅包含函数的惰性 `featureExpose` 与安装函数；需要由 Feature 补充能力时，交出原 provider 的 `capabilityInstaller`。通过 `defineStorageBackendKind<Store, Client, ExtraExpose>()('name')` 创建种类令牌。安装中只登记一次完整 store，准入后由宿主负责回滚与最终释放。

后端 Feature 使用 `defineFeature(kind, factory, dependencies?)`。同步工厂只返回 `capabilities`、`chain`、`api`；API 方法分为 `store` 与 `transaction` 两组。只有应用选中的根输出参与发布，依赖输出只用于构造，不自动成为运行服务。Feature 工厂先于后端安装，因此 store/client getter 必须保持惰性。

后端原 scope factory 在冻结同一个视图前调用 `core.createTransactionApi(scope)`；没有选中事务方法时返回 undefined。已选方法通过原 `runTransactionOperation` 登记、排空和保留首错，再进入同一 execution 与当前 scope 的惰性 client getter；过期方法保留原后端事务错误。`core.getChainMethods(family)` 把已选链方法交给原 query/builder creator，所有派生分支保留同一方法引用和原 this。纯链配置同步执行且不进入干预阶段，实际 I/O 终点才进入原 runner；内置方法和重复名称在能力发布前拒绝。

`core.execution.run/runSync` 转发同一原 middleware owner。宿主固定 async 模式；存在异步阶段时，同步操作在阶段与终点执行前拒绝 `ASYNC_STAGE_IN_SYNC_ENTRY`。阶段截断且未调用终点时，操作报 storage-contract 已有的 `ABORTED`。零阶段保留原值或原 Promise 身份。

`host.api[id]` 直接取用该已发布后端的原 `store.api`，两个实例可保留同名方法。每次读取返回冻结的后端 id 快照，旧快照不随 `use` 批次变动；失败批次不发布新 id。方法仍受原 Feature 有效期保护，关闭后提取的方法也会拒绝。

`host.backend(id)` 返回准入的原对象；`host.backends()` 返回脱离内部状态的 Map。`host.use(...)` 整批成功后发布；重叠批次拒绝 `STORAGE_HOST_BUSY`。宿主错误 source 为 `@migaia/storage-host`，原错误保留在 cause 链。

显式 `dispose()` 保留清理失败，重复调用返回同一个 Promise。资源语法使用另一个缓存 Promise，报告清理失败后成功完成，避免覆盖外层主错误。两个入口只执行一次实际清理。宿主释放自己的登记与准入 store，不关闭调用方借来的原生客户端。

Schema 与 codec 适配位于 `@migaia/storage-host/entity`：`passthrough`、`fromStandardSchema`、`jsonCodec`、`structuredCodec`、`binaryCodec` 和 `selectCodec`。Codec 协议仍由 `@migaia/storage-contract` 拥有。JSON 路由名为 `json@1`，直接复用 portable JSON codec；undefined、非有限数字等不支持的值会被拒绝。编码和解码错误分别携带宿主 `SERIALIZE_FAILED`、`DESERIALIZE_FAILED`，cause 保留 contract 与原 codec 错误。Structured 和 binary 恒等 codec 保留原对象引用；文本后端可显式选择 binary 的 base64 路由。

实体入口同时拥有既有 `REPOSITORY_KEY_PREFIX` 与 `repositoryMigrationKey(entityName)` 布局标识，供 repository 与后端 raw-record firewall 共用；持久化字符串保持不变。

`host.hooks.on(name, listener)` 与构造选项 `hooks` 共用同一同步观察注册表。插件在原安装窗口使用 `core.hooks.on`，原 registration 负责取消句柄。`core.emit(name, () => payload)` 与 Feature 注入的 `emit` 仅在有监听时构造一次载荷。监听器同步抛错、then getter 失败和异步拒绝只报告，不改变存储结果。后端包可扩充公开 `IStorageHookMap` interface。

后端构造时通过 `core.stageBindings` 绑定真实 store，再交给 `registerStore`。七类 observer 只观察。`codecStages(store)`、`transactionStages(store)` 等宿主方法仅接受本宿主已发布的原 store；事务投影验证原事务 owner。先构造的 observer 仍实时响应之后的监听登记与取消。

环境检查通过 `core.registerDetect(check)` 或 Feature 注入的同名函数登记，只能在原安装窗口调用。检查按插件安装顺序和登记顺序执行，使用原 registration 的取消信号。`createStorageHost` 默认在返回前完成检查；失败保留原错误并逆序释放已构造资源。设置 `autoDetect: false` 可延迟到显式 `await host.detect()`：未完成时，真实执行终点在业务 I/O 前拒绝 contract `UNSUPPORTED_CAPABILITY`，不会隐式调用检查。并发 `detect()` 返回同一个 Promise，成功缓存，失败可重试；新增插件批次需要再显式检查新增登记。关闭沿原资源 scope 排空已经开始的检查。

`createOrgId()` 使用宿主原 `crypto.randomUUID()` 生成小写 UUID。`org` 选项在任何插件执行前经 contract 校验并捕获，省略时为零 UUID；观察事件使用这个不可变的默认组织身份。

`host.org(orgId)` 返回不可变的业务视图，保留同一插件、Feature API 与事务推断；提取的方法仍绑定原组织。视图及其后端不暴露安装、drop 或关闭权。原生后端通过原安装窗口的 `core.registerOrgBinding(store, { backend, drop })` 提供实际组织目标；`core.getOrgContext(orgId)` 只返回同一执行器、观察、调用上下文与事务 API 投影。它不提供登记或关闭句柄。普通扩展及 Feature API 的 `this.orgId` 是固定身份，`this.backend(borrowed)` 只投影该插件安装时已经借用的依赖。

需要按需创建物理组织后端的作者，在原安装窗口捕获 core.createOrgAuthoringPort()，只把端口保存在后端闭包。安装后它仍复用原 controller、本地键锁、createRevisionPort 的原独立修订事实工厂与精确 store 的 controller/value-commit 登记函数；子资源由同一 registration 清理，撤销后拒绝使用。业务视图和 getOrgContext 不暴露该权限。组织借用优先使用其物理后端已登记的原 controller，保留资源生命周期与组织通知过滤。

作者入口还从原 plugin-host 拥有者重导出 asyncDisposeKey；支持环境缺少原生 Symbol.asyncDispose 时，后端仍使用同一 symbol，不新建符号或生命周期拥有者。

实体可直接使用 `defineEntity(...).connect(host.org(orgId).backend(id))`，具备 KV 声明的安装期 `core.getPublishedBackend(id)` 借用视图也可连接；动态 ID 的缺省类型不声明 KV 渠道，调用方需明确已知依赖的渠道类型。只有原宿主 registry 认证的精确视图能复用 KV/record 方法事实；复制对象或再包一层 Proxy 不继承认证。实体不取得关闭权，事务校验仍由原生 owner 执行；任意 raw 输入继续要求原资源准入。记录 metadata 仍通过同一业务视图读取。

memory 缺省组织和普通根后端共用配置 namespace；其它组织使用 `namespace + "/" + orgId`，每个插件实例仍独立。各 namespace 的数据、期限、修订和锁独立，关闭共用原 controller。根变更订阅接收全部组织事件；org 后端与 org hooks 仅接收本组织。`host.dropOrg(orgId)` 尝试全部已发布后端，成功目标不回滚；失败抛原生 `AggregateError`，code 为 `ORG_DELETE_FAILED`，`errors` 和首个 `cause` 保留原错误。

组织后端只授予该 native namespace 自身 provider 中的能力；捕获根 store 的任意自定义 Feature capability 不会隐式复制到非缺省组织，缺少时 `has` 为 false，`use` 报 `UNSUPPORTED_CAPABILITY`。原根自定义能力保持不变。Feature 的 store/transaction API 则经上述调用上下文投影。组织原生 SQL/SPARQL 入口在驱动前拒绝；根入口保留原行为。

`host.envelopeStages(store, { operation, targetVersion })` 绑定本宿主已发布的原 store，捕获本次不可变操作信息。其 `observe` 直接交给 contract 的 `migrateEnvelope` 或 `migrateEnvelopeSync`；其余回调观察原 envelope 检查与迁移完成边界。它不执行迁移，不携带 state，缺失版本保持 undefined，监听失败只报告。

后端作者从 `@migaia/storage-host/authoring/backend` 消费有限共享函数与 `IBackendChangeController` 类型。`core.createChangeController(options)` 与 `core.registerChangeController(store, controller)` 只在原安装窗口调用：先构造，再 `registerStore` 准入，最后登记同一个 store 的 controller。原 scope 负责未完成构造的回滚，controller 保留原 mutation lease、事件队列和幂等清理 Promise。Feature 用注入的 `getChangeController()` 读取自身原 store 的 controller，未登记时返回 undefined；作者不能覆盖该 getter。

`/authoring/backend` 同时提供既有平面键 encode/decode、range 快照/比较、JSON 字节预算与 opaque token 函数；纯键与 context 校验仍直接从 contract 消费。`resolveStorageNamespace(configured)` 仅校验配置并返回原值；三参形式 `resolveStorageNamespace(configured, orgId, defaultOrgId)` 保留各实例配置前缀：缺省组织使用 configured，其它组织使用 `configured + "/" + orgId`。配置值本身以 `/` 加规范 UUID 结尾时拒绝 contract `INVALID_ARGUMENT`，单独 UUID 配置允许；空值和配置缺省规则仍由各后端处理。

opaque token 保留原格式和条件 fallback；原生 entropy 获取失败以 contract `UNSUPPORTED_CAPABILITY` 拒绝，原错误保留为 cause。

`planChannelWrite` 与 `collectUniqueIndexOwners` 复用同一套通道冲突和唯一索引规则，后端仅传入自身错误构造函数。`normalizeError`、`isStorageErrorFamily` 与 `invokeExtension` 保留真实错误对象、原 cause 和扩展上下文；取消与超时助手继续复用 utils 的原 signal 执行路径，清理失败走原 operation reporter。

`observeStorageBatch(stages, scheduler, operation, count, invoke)` 复用同一份批量操作观察算法。作者先用原 store/scope 完成准入，再传入真实 operation stages 与宿主 scheduler；助手只调用一次原工作，发出一次 before/after 或 before/error，计时包含原 pipeline 与 native 终结。before/error 的 count 为输入条目数，after 对数字结果使用实际计数，其余结果使用输入条目数；异常对象原样拒绝。助手不拥有 pipeline、事务或关闭权，空批由调用方在准入后直接返回。

`core.getPublishedBackend(id)` 与 Feature 的同名入口只在原安装窗口借用更早批次的已发布后端；本批、未来和未知 id 拒绝 `BACKEND_NOT_INSTALLED`。借用视图不暴露 `dispose` 或异步清理 symbol，组合释放不关闭被借资源；业务方法保留原 receiver、原 Promise 与原注册准入。视图的 `has`/`use` 直接读取 contract 的同一个能力表，冻结或未经过 provider 的合法 base 也可借用，后续能力发布和撤销立即可见。

后端 core 的 `createKeyLockPort()` 只在原安装窗口构造共享本地键锁端口；`/authoring/backend` 仅导出其 `IBackendKeyLockPort` 类型。`attempt(ctx, holder, native, stages?, admissionSignal?, ranges?)` 消费 contract 原规范身份和尝试序号：先 try，只有 wait 决策进入原 utils FIFO，锁持续到 native attempt 真正提交、回滚和清理结束。`inspectLocks()` 返回按规范顺序排列的脱离快照。物理后端的原闭包持有端口并在最后一个引用释放时清理；共享端口不随首次创建它的插件自动关闭。端口释放先停止接纳并真正排空，主清理与 symbol 各保留缓存 Promise。 可选 ranges 为异步根写启用同一 FIFO 的点和范围保护（空数组仅保护点）；optimistic 仍等待已有悲观 holder，未传时保留原事务行为。

`probe(identities, ranges?, current?)` 从同一原锁表直接探测规范身份，返回首个脱离的 `ILockHolding` 或 undefined；单键最多进行固定三个通道的 Map.get，范围只扫描所选通道的活锁。范围项为 `{channel,lower,upper}`，边界来自 contract 的 `snapshotConcurrencyLockRange`。`attemptWrite(ctx,holder,write,stages?,admissionSignal?,ranges?,admit?)` 复用同一尝试与 FIFO，write 必须是同步原生修改；最终锁检查与 write 在同一同步执行段。optimistic 根写不创建持锁行，仍尊重已有悲观锁。等待或观察回调之后必须重新检查，排除本尝试已持有的 lease；不创建范围锁。可选 current 必须是原活跃 attempt context，只跳过其实际持有的同一 lease，继续查找其它 holder；声明键或相同 owner 文本不授予豁免。可选 admit(commit) 接后端已有物理准入：先逻辑键、再物理门，commit 至多一次且最终重查操作与成员 signal；原 lease 等物理清理真实结算后释放。

`core.registerValueCommit(store, commit)` 只在原安装窗口接纳已交接的同一 store。`/authoring/backend` 的 `IBackendValueCommit` 接收固定 `{prefix,expected,key,value}` 与可选写上下文；expected 是原始字符串键值快照。实体在异步 schema/codec/投影准备完成后借用该终点，原生后端在原物理准入内同步复核与写入，期间没有 await。它与 controller、envelope 观察共享同一内部 row，卸载由原 scope 清理；登记权与关闭权不向实体开放。 同一个 frozen/raw store 被多个宿主接纳时，envelope 边界向其仍登记的原宿主观察者扇出；释放只移除所属绑定，单宿主保持原观察接点。

controller 的只读 `closingSignal` 代表原关闭阶段。将其作为可选 admission signal 传入，可在直接释放成员时移除该成员的排队请求；不关闭共享 provider，也不提前释放已运行的 native attempt。

后端原安装 core 的 `defaultOrgId` 只读返回宿主已捕获的缺省组织身份。`createRevisionPort()` 在同一安装窗口创建本地修订事实；一个物理数据宇宙共享该对象，`read/write/epoch/clear` 使用既有 text/bytes/record 通道和后端已捕获的键身份。仅原生提交成功后推进修订；clear 清墓碑并推进通道 epoch，防止旧快照通过 ABA 检查。此口不拥有资源或其它成员的关闭权。

`memoryBackendPlugin()` 与 `memoryBackendKind` 由宿主根入口提供。每次安装拥有独立内存数据，即使 namespace 相同也不共享。文本、字节、记录事务复用原事务 owner、并发策略和本地锁；`scope.use(kv)` 提供同事务的八个文本方法，`scope.use(records)` 使用同一实际记录游标执行查询。配置的 owner.label 捕获后保持稳定；没有标签时使用运行时与 pid，浏览器使用 browser。原生 client getter 返回 undefined，事务 client 校验原 scope 后返回 undefined。 所选 Feature 记录独立放在最后一个参数：`memoryBackendPlugin(options, features)`；省略 options 可传 undefined，缺省 id 仍为 memory。

memory 的根异步 `set/setBytes/putRecord/remove/removeBytes/deleteRecord`、clear 与 records 前缀删除使用同一原并发策略和单次预算；单次 ctx.concurrency 覆盖原默认。replace 按固定顺序保护目标和可能删除的其它通道。同步 set/remove/clearValues 只直接探测活锁，忙时立即 LOCK_REJECTED，不运行异步策略。clear 和前缀删除只检查受影响通道的活锁；最终检查与实际数据、修订修改无 await 间隙。输入键与可变 payload 在等待前捕获。读取不加写锁；并发策略不改变 ConflictPolicy 的 duplicate/replace 语义。

```ts
import { createStorageHost, memoryBackendPlugin } from '@migaia/storage-host'
import { records } from '@migaia/storage-contract'

type Order = { state: string; total: number }
await using host = await createStorageHost({ plugins: [memoryBackendPlugin()] })
const memory = host.backend('memory')
await memory.transaction(async (tx) => {
  await tx.set('status', 'ready')
  await tx.setBytes('receipt', new Uint8Array([1, 2]))
  await tx.putRecord({ state: 'paid', total: 20 }, 'order-1')
})
console.log(await memory.use(records).query<Order>().where({ state: 'paid' }).select('total').all())
```

memory 的根 `getMany`、`setMany`、`removeMany` 与 `removeByPrefix` 也可从 `use(kv)` 取用。批量结构键与原文本通道共享身份；字符串写入可由单点与 sync 方法读取。非空写批量在原事务草稿里一次提交，失败不留下先前项；重复写键在事务前拒绝，重复删除只计一次。每次高层调用只进入一次 pipeline 和一组操作观察，空批不进入 pipeline 或新事务；前缀删除沿原 radix 范围定位。

记录查询的 where/select/all 复用 contract 查询核心；当前内存 source 如实声明客户端执行。tx 文本批量方法支持规范结构键、prefix 与经校验的 ttlMs。事务失败丢弃草稿，提交前检查键修订和 clear epoch，实际提交后发布批量变化。根资源关闭会取消本实例排队锁准入，并等待已接纳的事务真实结算。

普通范围、事务草稿与前缀删除复用同一包内压缩 radix 索引。基础数据仍用哈希点查；范围仅定位边界并归并命中草稿，tombstone 抑制同键基础项。树维护首尾与相邻叶，不在查询时全量排序；记录和文本各自拥有独立索引实例。

/entity 的 registerRecordIndexBackfillStore 只登记原后端工厂捕获的补录 provider；RecordIndexBackfillPhase 保留原持久化 canonical/legacy 值。原生后端创建既有 coded 争用错误后调用 markRecordIndexBackfillContentionFailure，原对象不变。会话、checkpoint 与真实原生事务仍归后端，实体编排复用这同一原私表。

memory 的根操作在原并发 budget 内包住完整 pipeline：阶段修改一次输入，终点调用唯一原 loop，`await next()` 仍等待实际写入和失败。阶段等待计入同一期限；取消后不派生锁或执行原生写入。事务的 loop 位于 pipeline 外，每个真实 attempt 重新进入同一 pipeline，提交冲突重放 callback 时也重新运行阶段。

`defineEntity` 从 `@migaia/storage-host/entity` 导入。记录仓储通过原 `repo.in(scope)` 组合，`repo.batch` 只开一个原生事务。schema、codec 与迁移借用该事务的原 signal。唯一约束检查最终草稿，交换和删除后重用保持原子性。历史索引句柄只有经当前原生 scope 确认就绪才使用；否则在同一 scope 扫描，不建索引。

实体存档使用 `{version, state}` 与共享冻结迁移计划。畸形读取和非法写入保留宿主 `DESERIALIZE_FAILED`/`SERIALIZE_FAILED`，第一层 cause 为 contract `ENVELOPE_INVALID`；不支持版本和迁移失败保留宿主错误码与原 contract cause。不接纳旧 `{__v,data}`。比较函数必须有有限 limit，复用共享有界堆；流返回实际可释放迭代器。

实体查询复用原不可变核心：`repo.query().index(name, keyOrRange).where(...).select(...).all()` 替代 `findManyBy`，`.stream()` 替代 `streamBy`。根查询与事务查询保留已安装的 query Feature 方法。此源的对象与字段条件在客户端执行；显式索引查询仍使用原生索引准备或权威扫描回退。比较器必须指定有限上限，候选由原有界堆保留。事务查询继承原 signal 和期限，终点不接另一个 context。

```ts
import { createStorageHost, memoryBackendPlugin } from '@migaia/storage-host'
import { defineEntity } from '@migaia/storage-host/entity'

await using host = await createStorageHost({ plugins: [memoryBackendPlugin()] })
const memory = host.backend('memory')
const orders = defineEntity<{ id: string; state: string; total: number }>()({
  name: 'orders',
  key: 'id',
  indexes: { byState: { path: 'state' } }
}).connect(memory)
const paid = await orders
  .query()
  .index('byState', 'paid')
  .where('total', 'gt', 100)
  .orderByComparator((left, right) => right.total - left.total)
  .limit(20)
  .select('id', 'total')
  .all()
await using stream = orders.query().limit(20).stream()
for await (const order of stream) console.log(order)
await memory.transaction(async (tx) => {
  await orders.in(tx).put({ id: 'next', state: 'paid', total: 200 })
  console.log(await orders.in(tx).query().where({ state: 'paid' }).select('id').all())
})
```

`connect(store, {codecStages, queryStages})` 接收原宿主相应的观察接点。codec 围绕每次实际转换；query 的每次 `all` 和 stream 的每次 `next` 观察实际操作。stream 统计累计，消费方两次推进之间的停顿不计执行时间。观察不等待、不否决，抛错与迟到拒绝进入原报告渠道。

自定义 value-only 后端的 unique 写入必须具备 record 事务或原子 value commit 接点；仅有 sync 通道不等于具备该原子终点。两者都缺少时，仅这个 unique 写入组合在修改前拒绝 `UNSUPPORTED_CAPABILITY`；普通 KV 写入仍可使用。原后端安装窗口内，先 `core.registerStore(store)`，再 `core.registerValueCommit(store, commit)`。`IBackendValueCommit` 从 `@migaia/storage-host/authoring/backend` 导出：`commit({prefix, expected, key, value}, ctx?)` 返回 `Promise<void>`；`expected` 是该前缀捕获的原始 `[key,value]` 对。异步 schema/codec 准备完成后，后端须原子复核这份前缀快照并写入 `key/value`，复核和修改之间不得有 await 缝隙；快照变化时以 `WRITE_CONFLICT` 拒绝且不修改数据。该接点只借用原 native store，不新增资源或关闭权。

memory 原生发布 `ttl` 与 `counter`。`expire`、`remaining`、`persist` 指向既有 text、bytes 或 record 通道，结构文本键与批量键共享规范身份。期限为有限非负毫秒，0 立即过期；sync/async 读取、枚举与跨通道冲突检查使用同一惰性到期路径。覆盖活记录保留期限，删除、clear 与跨通道 replace 清除旧期限；`setMany` 的 `ttlMs` 与值在同一原子草稿提交。事务首次读保留值与期限，提交经原修订检查发现观察后的到期。

`store.use(counter).increment('visits', 1)` 在原单键原子写路径修改规范十进制文本。缺失从 0 开始；非规范文本、非安全整数增量与溢出在修改前拒绝 `INVALID_ARGUMENT`。`tx.use(ttl)` 与 `tx.use(counter)` 使用当前原生草稿和原事务预算。

`@migaia/storage-host/authoring/vector` 只导出 `recommendStorageVector(positive, negative?)`，按输入次序计算正样本均值减负样本均值，返回独立只读向量。正样本非空，负样本可空，维度须一致且分量有限；非法输入沿共享 contract 报 `INVALID_ARGUMENT`，getter 原错保留在 cause。函数不创建 collection、查询或连接；原 collection 查询校验 cosine 零范数，再由原生引擎检索。memory 的评分、过滤执行和排名不从作者入口导出。

memory 原生提供 `vector`：`store.use(vector).collection('docs', { dimensions: 2, metric: 'cosine' })` 建立同 namespace 的集合描述，后续可省略一致配置。`upsert` 全批先快照，重复 ID 保留末值；`near(...).topK(k)`、`similarTo`、`recommend` 共用 contract 查询链。memory 始终精确，分数从高到低，同分按 ID 的 UTF-16 顺序；不提供原生 groupBy。声明式 payload 条件与组织/TTL 在排名前处理，函数谓词只作用于原 topK 命中且不补搜。`search` 的 `k: 0` 校验后不扫描；链式 `topK` 保留正安全整数契约。

向量期限沿原物理行与原事务 draft；`tx.use(ttl)` 可为向量目标设置期限并与 KV 同提交或回滚，vector 能力本身没有通用事务投影。`deleteWhere` 不过滤物理过期匹配点，返回实际删除数；两种 count 策略在 memory 等价。组织集合、提取的查询和原生迭代器绑定原 namespace，drop 清空该目标，根关闭统一失效。所有写仍经过同一 pipeline、concurrency attempt、vector 锁桶与 controller；原三通道之间的 replace 规则保持。

可选 `capacity: { maxEntries?, maxBytes?, eviction? }` 按原生 namespace 限制公开物理条目；省略容量保持无上限。两个上限须为正安全整数，`eviction` 为 `lru`（缺省）或 `lfu`，创建插件时单次捕获，非法项在分配原生状态前报 `INVALID_ARGUMENT`。LRU 与 LFU 以双向节点和频次桶维护，不扫描历史；LFU 写入也记一次命中，新增低频项可能成为自身淘汰目标。命中读更新策略，过期项通过原 deadline 与压缩 radix 索引先惰性回收，再选择容量目标，无 timer。事务和批量驱逐只随原 draft 提交；等待或回滚不先删数据，忙目标沿原锁预算等待或拒绝。`onEvict` 每个受影响通道只发一次 `{ backendId, backend, orgId, count, channel }`，普通删除、过期不发，监听失败仅报告。

`maxBytes` 使用实际 canonical 编码长度：文本为 UTF-8，bytes 为 byteLength，record 与 vector payload 为 serialize 的 collections-json 编码，vector 另计每分量 8 字节；键、容量索引和 TTL 元数据不重复计入。单条超限也按相同策略驱逐，不保证仍保留。原 memory record 的 structuredClone 域更宽；仅显式 maxBytes 下，现有 codec 无法编码的值（如 Date、循环、undefined与非有限数）在任何修改前报 `UNSUPPORTED_CAPABILITY`，原错经 cause 可达。默认无上限及仅 maxEntries 保留原值域；Map、Set 和 codec 可编码的 Uint8Array 继续可用。

这是 canonical 编码预算，不是 JavaScript 堆占用估算。原 codec 的 own-field 投影同样适用：raw record 中的 ArrayBuffer 按 `{}` 编码计费，原生读取仍保留其真实 structured-clone 值。

所选 Feature API 与查询族保留原生 optimistic 事务 builder 的实际 scope 和原有 builder 方法。run 仍可直接调用，key lock 仍不存在，concurrency 只接纳 optimistic 策略。宿主发布原生 tx 方法，不创建替代 builder。

memory 原生提供 `rdf`：`store.use(rdf).add(quads)`、`delete(quads)` 与 `match(pattern)` 使用共享 ground term 校验与 canonical 身份，完整批次先快照，重复 quad 幂等；blank node 仍只用于 raw/parser 域。六个固定压缩 radix 索引覆盖全局及 graph 内的 SPO/POS/OSP 访问，匹配按实际 bound prefix 定位，流式推进，不另存完整候选数组。逻辑 default/named graph 都映射为当前 org 的真实 named graph，返回时沿共享 helper 还原；namespace、提取方法、查询与原事务 scope 固定 org。`tx.use(rdf)` 与 KV 共用原 draft、revision、提交、回滚和迭代器生命周期，RDF 锁与容量驱逐都使用同 namespace 的逻辑 quad 身份。RDF 新变更沿 `all` 通道宽失效；`maxBytes` 计共享 canonical quad 编码，六个索引不重复计条目。

RDF pattern 是原生访问路径；`where`、`follow`、`inverse`、排序与 page/after 保留共享 query reader 的客户端执行，`requirePushdown()` 如实拒绝所需客户端步骤。没有原生 traversal 或跨每次 next 的全库快照承诺；原生 pattern watch 沿真实 change-feed 接点，事务仍保留原 first-read/draft 语义。合法大 literal 不会被再次当作 public binary key 而收窄到 1 MiB。

memory 的真实文本 `watch(key, ctx?)` 与原 `subscribeChanges` 共用 controller。root watch 固定缺省 org，org view 固定自身 org；root 的既有 subscribeChanges 仍观察全部 org。watch 是提交后失效提示：一个未消费槽合并多次匹配为最新 sequence 的 `all` 提示，省略 keys/scope，不提供逐事件历史或 replay。原 native generator 串行推进，原 iterator owner 保留主/符号双缓存 Promise，dispose/abort/根关闭先唤醒已接受 next 再排空、取消订阅；原取消 reason 保留。真实 change-feed guard 通过后，records、原生 RDF pattern 与完成 topK 的 vector query 可 watch；需要客户端谓词或 traversal 的查询在订阅前拒绝。

后端作者可复用 `createBackendChangeIterator(controller, { orgId, channel, key?, ctx?, execute? })`；它只借用原 controller 的订阅和关闭 signal，固定组织/通道/可选文本键，在一个槽合并失效提示，复用原资源、context 与诊断 owner。可选 execute 接收原 advance 与单次捕获的 context，以保留该后端逐 next 的原 pipeline；没有新的 controller、事件队列、registry 或重试平台。

memory 原生提供 `blob`，与同名 KV/record 条目独立。`put` 先用共享规则快照字节和 metadata；条件不匹配时不接管上传 reader，流完整消费且清理成功后，在原同步提交窗口再次复核 etag/不存在条件并提交容量变化。取消、关闭或流失败不写入半个对象。`get` 返回读取时的 metadata/内容快照，range 的 end 包含在内；stream 与 bytes 共用一次消费权，释放沿原共享资源 owner。`list` 在原压缩 radix 上按 UTF-16 键顺序分页，cursor 绑定 org 与 prefix；`removeByPrefix` 只删除当前 org 的匹配对象。blob 不提供事务投影或文本锁。容量按每个对象一条、正文 byteLength 计入，metadata 与索引不重复计入；通知沿 all 宽失效且不外露内部 org key。

```ts
import { blob } from '@migaia/storage-contract'
import { createStorageHost, memoryBackendPlugin } from '@migaia/storage-host'

await using host = await createStorageHost({ plugins: [memoryBackendPlugin()] })
const objects = host.backend('memory').use(blob)
await objects.put('images/sample', new Uint8Array([1, 2, 3]), { ifNoneMatch: true })
await using object = (await objects.get('images/sample', { range: { start: 1, end: 1 } }))!
console.log((await object.bytes())[0]) // 2
```

memory 的 records 查询 `delete/update`、完成 topK 的 vector 查询 `delete`、RDF 查询 `delete/replace` 均可直接写入；返回实际接受的去重条目数。根终点等待真实提交，事务内终点只修改当前 draft，回滚不泄露写入。记录 patch 修改实际原行并保留 memory 的 Date/Map 等值域；选出的投影仍只读。RDF replace 只作用于查询实际选中的 old quad，同 quad 替换返回 0；new quad 已存在时移除 old 而不重复插入。向量删除保持原 topK，客户端过滤不会补搜。写入保留原并发策略、取消与一次高层 pipeline，查询失败或冲突交原事务处理。

```ts
import { records } from '@migaia/storage-contract'
import { createStorageHost, memoryBackendPlugin } from '@migaia/storage-host'

await using host = await createStorageHost({ plugins: [memoryBackendPlugin()] })
const store = host.backend('memory')
await store.putRecord({ active: true }, 'one')
console.log(
  await store
    .use(records)
    .query<{ active: boolean }>()
    .where({ active: true })
    .update({ active: false })
) // 1
```

后端 descriptor 可提供 `journalBinding(store)`。原安装窗口在精确 store 准入后调用一次，并把原生回调捕获到该 registration 的 storeCell。`forOrg(orgId)` 必须返回固定物理组织的原 I/O 闭包，不能用公开 KV 前缀或其它连接替代。`IStorageJournalNamespaceView` 只含原六个字符串方法（`get`、`has`、`set`、`remove`、`clearValues`、`clearAll`）和 `keys`，不继承业务批量或 TTL 能力。namespace 转发原生事务及真实 commit/rollback 回调，保留独立的 main/符号清理 Promise，并排空已接纳工作直到原生终态。事务、资源和登记权仍归原后端。

memory 已提供该私有 namespace 接点。私有字符串行与原业务 draft 一起稀疏暂存、原子提交，提交前与回滚后均不可见。业务 keys、clear、capacity 和 change-feed 不包含这些元数据行；dropOrg 删除目标组织的私有行。显式组织绑定拒绝其它组织的 scope，提取出的私有 view 随原操作失效。该作者接点本身不增加自动 binlog、undo/redo 或公开 storageLogStore 工厂。

memory 日志 namespace 在整个资源期持有原规范 resource-owner 文本 lease；同组织、同 prefix 再次打开报 `LOCK_REJECTED`。普通私有事务在最初的原生锁集合中取得另一个固定 head 键。原后端关闭信号也会关闭部分构造的 namespace 资源。`transactionInfo(scope)` 返回精确 store/org 的原认证事务身份，同事务追加归并不信任调用方 id。后端作者仅对私有元数据 lease 使用 `IBackendKeyLockPort.attemptMetadata`：规范点身份冲突和原 acquire/release/wait 拥有者不变，业务 clear 范围跳过其本就不能触及的私有行；普通业务锁保持原范围行为。

memory 的 `readImage`、`writeImage`、`readRevision` 只接受该固定组织的真实 native scope，并复用原 draft、写入校验与完整 `{epoch, revision}` 墓碑修订。覆盖 text、bytes、record、vector、逻辑 RDF quad 和同点锁下的 deadline 元数据；镜像明确携带原 JSON codec id/version，bytes 复用原 base64 编码，缺失不等于 null。可持久镜像使用原 serialize portable 值域；Date、Map、undefined 等不在该值域的记录读取镜像时保留原校验错误，普通 memory 的 structured-clone 支持不变。恢复仍参加同一原子提交与回滚；镜像方法本身不自动开启全局 journal，自动 undo 使用下述显式全局配置。

memory 的 `changes(scope)` 首次调用须在该真实 attempt 的首项业务写前，之后原 `stageDraft` 在修改前检查可记录性，并保留 text/bytes/record/vector/RDF 与 deadline 的实际顺序。返回值冻结，反映每键最终修订；先新增再删除且最终没有物理变更的身份不生成变更。迟到首次调用报 `UNSUPPORTED_CAPABILITY`，普通未开启事务不分配镜像。`writeCommitMarker` 只接受原认证事务 id，marker 与业务同提交/回滚，使用原私有 namespace Map 的不可公开 symbol 分区；同名用户 prefix、业务 clear 与其它 org 均不能触及。`hasCommitMarker`/`removeCommitMarker` 沿原 native 事务读取或回收。下述全局选项已接根写与 capacity victim，blob 仍没有 journal target。

包内 native journal 提交桥已用真实 logger 的 binlog/undoLog 与两份 storageLogStore 验证：ready 在业务 native scope 前完成，head 锁交回原第一次规范取锁，按序 storage.commit 与按原身份合并的 undo 镜像在同一事务追加。binlogValues 默认不含值，undo 始终保留完整编码镜像与 afterRevision；rollback 不推进两个日志的已提交索引。原 storeCell 的冻结空身份仅用于私有精确 registration 比较；另一个宿主即使 backend id/org 相同，也不能选其日志。logger 自己继续检查实际载体身份。下述全局配置已消费此桥接支持 memory 路径；下述外置 WAL 已接 memory；memory 自动 undo 已接下述原拥有者路径。

### 私有日志资源

`storageLogStore(host, id, { prefix })` 仅从 `@migaia/storage-host/journal` 导出。传入真实宿主或固定组织视图及其已安装后端 ID；它不接受 public KV、raw store 或伪造宿主。后端必须提供原私有 journal binding 与可靠独占，打开先完成恢复。同组织与 prefix 同时只允许一个日志句柄；不同组织相互隔离。句柄由原宿主登记接管，调用方也可提前释放。显式日志关闭排空已入 FIFO 的工作；宿主关闭保留原 pipeline 准入，尚未进入后端的工作可能以原 HOST_DISPOSING cause 拒绝，全部已接纳 Promise 仍排空；业务枚举、clear 与容量不触及私有日志。

namespace 的可选只读事实 `indexExclusive:false` 表示原拥有者不能在整个句柄期保证缓存索引独占；storageLogStore 在恢复 I/O 和索引建立前拒绝并释放该原资源。同一个 namespace 仍可向提交桥提供真实 transactionInfo/terminal，不能用 nativeAtomic 冒充索引独占。省略此事实保持原有绑定语义。

追加先捕获原 logger JSON，再沿既有 FIFO 写入记录并最终提交唯一 head；只有真实非空 commit 才更新原 logger 索引并发布一次冻结通知。状态只从 pending 前进到 done/aborted；截断先提交水位再回收物理行，重开保留最高序号与时间，不复用序号。未确认写入使句柄停止准入，必须关闭并重开；恢复忽略未提交记录及状态候选并清理残留，原错误留在 cause。私有记录或载荷损坏统一报 `JOURNAL_RECORD_INVALID`，原 logger 校验错误仍在 cause。无原生事务的私有 namespace 仍可沿同协议工作，但必须由后端提供可靠独占与单键原子 head 写入。当前内置绑定为 memory；host 内部原生追加端口已接同一日志对象与准确组织，复用原 native scope/terminal，绕过普通日志 FIFO；同一事务并发批次分配不同序号，真实 commit 才一次发布，rollback 不发布。后端还须提供可选 `runCommitted(work, committed)`，在原 head lease 释放前将实际结果交给同步发布回调；缺此接点仅不支持该原生追加组合，普通日志照常。其 callback 是提交后观察，错误仅 report，不能假回滚。该端口不从公开 entry 导出；打开日志不自动启用全局 journal，必须由宿主 journal 选项显式选择。

```ts
import { createStorageHost, memoryBackendPlugin } from '@migaia/storage-host'
import { storageLogStore } from '@migaia/storage-host/journal'
import { LogRecordState } from '@migaia/logger/plugins/durable'

await using host = await createStorageHost({ plugins: [memoryBackendPlugin()] })
await using log = await storageLogStore(host, 'memory', { prefix: 'history' })
await log.append([{ kind: 'order.created', payload: { id: 'o1' } }])
await log.setState(1, LogRecordState.done)
console.log(await log.lastSeq(), await log.states(LogRecordState.pending)) // 1 []
```

全局 `journal` 接受借用 logger 配置或 `async ({orgId,storageLogStore}) => 配置`。缺省组织由原安装批次最后的 bootstrap 准备；后续组织在首次受支持异步终点准备一次，共享同一 Promise，准备时间计入原操作预算并由原 controller 排空。配置在后续 use 中固定，准备失败也不重新执行 initializer；宿主不会 shutdown 借用 logger。`atomicBinlog[id]`、`atomicUndo[id]` 必须选择同一真实 registration 的载体，head 锁加入原第一次规范取锁。

当前自动 memory 单元覆盖根 text/bytes/record 写入、批量、前缀删除、counter/TTL、vector/RDF、clear、查询写及显式 native 事务；原 draft 在修改前捕获 portable 镜像。capacity victim 同属该 draft 的镜像，异步追加后重查原修订和实际容量计划；victim 改变沿原 commit conflict 回滚暂存日志。真实数据和 victim 完成后才发布已提交日志索引，原淘汰通知顺序保持。空写不生成 storage.commit，选中异步 journal 时同步入口沿原 guard 拒绝。clear 按实际删除项捕获镜像，保留原通道 epoch 重置与一次粗粒度 clear 通知；空 clear 不生成 storage.commit。blob 写暂在修改前报 UNSUPPORTED_CAPABILITY，不接管上传 reader，不伪造 blob 锁或镜像格式。其它后端全局路由与 redo 仍待完成；缺失的已选保证明确拒绝，不静默漏记。

未选 `atomicBinlog[id]` 的 memory backend 使用外置 binlog：仅在原生 COMMIT 后追加，原操作等该追加结算；失败通过宿主原 `report` 和 `onBinlogAppendError` 元数据观察事件报告，已提交数据和成功结果不回滚，后续写入仍可继续。回滚与空写不追加。仅当未选 WAL、undo、atomicBinlog 和 atomicUndo 时，纯外置 binlog 可借用 nativeAtomic:false 的真实成功 terminal；其原 fact 不变，仍由原 onCommit 决定追加，凡涉及其它日志保证均要求原 nativeAtomic:true。后端作者的 `IStorageJournalAttempt.settle?()` 只用于排空原 terminal 已启动的外置工作；同原生追加路径不增加该等待。外置 WAL 使用下述原 intent/marker 协议。

外置 binlog 选中真实 `logger.wal` 时，原 binding 必须声明只读 `externalWal:true`，并提供原提交 marker 的写入/读取/回收接点；这表示原生拥有者允许在最终镜像后等待外部 I/O，不从后端名或 nativeAtomic 推断。memory 已接，严格 IDB 未声明即拒绝。先持久写 storage.binlog-intent，再把原 txId marker 与业务同原生事务提交；提交后追加 binlog、complete intent，最后回收 marker。失败保 pending 和 marker，不把数据假回滚。准备恢复只读原 logger pending 索引，仅对完整 namespace/backendInstanceId/orgId 目标读取 marker：存在则补录相同 txId，不存在则 abort；补录可能重复。其它 kind 和其它目标不修改，自有 kind 损坏报 JOURNAL_RECORD_INVALID，目标恢复失败报 JOURNAL_RECOVERY_FAILED 并保持未开放。WAL 始终保存完整编码镜像，不受 binlogValues 开关影响；恢复和追加观察仅含元数据。

选中实际 logger.undo 的全局配置为已接线 memory 提供 `store.undo(txId, ctx?)`，返回本次撤销的新 txId；未选 journal、只有 binlog 或宽化为旧单参数 Host 类型时不静态声称存在该方法。直接配置与 initializer 保留所选 logger 的真实类型，组织借用视图的提取方法仍固定原组织且没有关闭权。全局准备要求原 physical backend 自己提供 callable undo，缺少时在业务准入前拒绝该组合，宿主不改 frozen/raw base 或替换 root store。

undo 从原 logger 读取已提交镜像，使用后端的原 tx().lock(...).run 一次取得全部锁。私有 deadline 目标由 binding.lockTarget 映射回原点锁；不建锁表。先比较全部完整 afterRevision（含 clear epoch/墓碑）及当前编码值和存在性，再写任一 before；冲突报 UNDO_CONFLICT、无记录报 UNDO_NOT_FOUND，foreign target 或重复的规范镜像身份报 JOURNAL_RECORD_INVALID；合法 value/deadline 两镜像仍保持不同身份并共享原点锁。撤销继续沿原 draft/修订/容量/单 pipeline 提交，生成一条新 storage.commit 与新的 undo 镜像；并发或净零事务不能双重撤销，原 ctx getter 单读并继承原预算。当前已验证 memory 的 text/bytes/record/null/缺失/TTL/vector/RDF 与原组织隔离；其它后端接线和 redo 仍待完成。

PENDING-USER-REVIEW：dropOrg 遇到存活的全局 journal 时，原私有 namespace generation 失效；storageLogStore 缓存读取与旧 native port 均报 STORE_DISPOSED，后续选中 journal 的写入在修改前拒绝，普通未选 journal 的 org 视图仍可复用。同一借用 logger 在 drop 后继续，需要原 logger 的正式 reset 契约；宿主不重跑一次性 initializer、不替换或关闭 logger。比较隐式复用缓存、重跑 initializer 与安全隔离后选择安全隔离，保数据/日志一致；回退只能撤回新增全局组合，或由原 owner 显式 reset 协议替换隔离。

后端作者可在原安装窗口调用 core.registerFeatureClientResolver(store, resolver)，为精确已登记 store 提供组织原生客户端选择。resolver.getClient(orgId) 可先沿原 opener 准备再返回客户端；只有真实异步结果才等待，完成后再次核对原 registration。可选 getTransactionClient(scope, orgId) 必须同步返回该原认证 scope 已打开的事务，不得另开或等待。未登记 resolver 时，原 Feature 的 getClient/getTransactionClient 调用顺序与行为保持。resolver 只占原 storeCell 的一个可选字段，业务视图不能登记或获得该接点，Feature factory 不重跑。

外置 undo 必须选中真实 `logger.wal`，并由原 binding 同时提供 `nativeAtomic:true`、`externalWal:true` 与提交 marker；没有 atomicUndo 又没有 WAL 时在业务准入前拒绝。undo-only 或与 binlog 共用同一 storage.binlog-intent，完整按序变更沿原归并算法生成首次 before/最终 after/完整 afterRevision，提交后补镜像再 complete 和回收 marker。已提交数据不因镜像发布失败而回滚；原 report 保留错误，pending 与 marker 保持以便重开恢复。同 txId 已有镜像只有完整内容相等时才略过，差异报 JOURNAL_RECORD_INVALID，不覆盖借用日志。严格 IDB 不提供外部等待事实，继续只接原同库 atomicUndo 路径。

`journal.telemetry:true` 要求真实 `level()` 的 `atLevel` 接点。普通操作沿原 logger schema 输出 tag 为 `storage` 的条目，成功按 debug、失败按 error 经过原门槛与 filters；meta 含 backend/orgId/operation、原后端提供的 keys、durationMs/outcome/source/code/level 和正常 payload，args 保留原错误，不增加字段屏蔽或脱敏。失败与关闭的 logger 只走宿主 report，不改变存储结果；宿主不关闭借用 logger。关闭 telemetry 不读取 atLevel、不生成日志数据。

后端作者的原 `execution` 接点可用 `keys?:()=>readonly ILockKey[]` 提供已规范的原生身份，`internal?:true` 排除私有日志及已由外层覆盖的执行；orgId 由原不可变闭包补入。需要多次原 attempt 的终点用可选 `execution.observe(describe, invoke)` 包住原完整循环，invoke 的 boolean 仅表示是否需要采集观察事实，未启用时直接调用原工作；内层原 pipeline 保持且标 internal。memory 已验证一次真实重试只输出一个事务条目、无子操作重复。其它后端继续由各自原 owner 提供完整事实。

`@migaia/storage-host/authoring/backend` 的 `createBackendJournalNamespace(options)` 复用原 namespace 资源 reservation、quiescence 排空和双释放 Promise；memory 的私有 namespace 已直接消费。`IBackendJournalNamespaceOptions` 只借用原 assertLive/closingSignal/report、nativeAtomic/indexExclusive、reserve、authenticate(scope) 和原 transaction。`IBackendJournalTransaction` 仅有私有 run(viewWork) 与 onCommit/onRollback/onEnd 观察，无原生句柄、commit 或后端关闭权；onEnd 在结果未知时也仅排空，不冒充 rollback。数据、代际、跨实例独占和实际终态仍归原后端。

同作者入口重导原 `storageJournalLockKey(prefix, part)` 与 `StorageJournalLock`（head/resource）。后端把这一个规范身份交给原并发 provider，普通私有事务和同原生 append 共用相同 head，资源持有另用 resource；函数只产生只读逻辑 key，不授予获取锁、安装或关闭权限。空 prefix 或非法 part 按原 INVALID_ARGUMENT 拒绝，不复制锁元组编码。

首个显式组织终点的 telemetry 等原操作内的 journal prepare 完成后，读取同一 org cell 的配置；观察本身不额外 prepare、不开新预算，首事务也不漏记。已经明确关闭时仍直接进入原工作且不生成普通日志条目。

选择全局 `journal` 后，既有 bootstrap 会安装异步 stage。公开 `sync.set`、`sync.remove`、`sync.clearValues` 在修改数据或历史前报原 ASYNC_STAGE_IN_SYNC_ENTRY。同一 stage 目前也拒绝同步读取，包括仅启用遥测的配置。此组合使用异步方法；未选 journal 的宿主保留原同步方法。同步日志写入需要既有 logger 拥有者提供真实同步 append 完成接点。

`/authoring/backend` 的 `encodeStorageJournalImage(present, value?, bytes?)` 与 `decodeStorageJournalImage(image, bytes?)` 为原生 adapter 复用原 memory 可移植镜像 codec。缺失与存在的 null 保持区分；字节镜像沿既有 base64 拥有者处理。codec id/version 与原 serialize 错误均不变。Memory 消费同一实现；调用方不获得原生、提交或安装权限。

原生 binding 可声明 `requiresIndexedDbUndo?: true`，原 descriptor 快照单读并冻结该事实。当借用 logger 含 undo 时，同一配置拥有者要求 `indexedDbUndo: true`，缺省或 false 在打开原生终点前报 UNSUPPORTED_CAPABILITY。其它后端 binding 保持原缺省语义，仅 binlog 或仅遥测的配置不要求 undo 选择。

原生作者的 `core.emit` 在宿主 closing 期间跳过可选诊断，且不执行延迟 payload 工厂，避免用 HOST_DISPOSING 替换已准入原生操作的结算结果。open 期间仍复用原 registration 检查和原事件通道；完全 closed 或失效 registration 的旧句柄继续拒绝。宿主关闭事件本身仍由原宿主拥有者发布。
