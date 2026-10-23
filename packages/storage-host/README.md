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
